package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ops-copilot/backend/internal/alerts"
	"ops-copilot/backend/internal/audit"
	"ops-copilot/backend/internal/config"
	"ops-copilot/backend/internal/database"
	"ops-copilot/backend/internal/executor"
	"ops-copilot/backend/internal/guardrail"
	"ops-copilot/backend/internal/metrics"
	"ops-copilot/backend/internal/models"
	"ops-copilot/backend/internal/registry"
)

func setupTestServer(t *testing.T) (*Server, *httptest.Server, func()) {
	tmpDir, err := os.MkdirTemp("", "api_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	dbPath := filepath.Join(tmpDir, "test.db")
	db, err := database.Connect(dbPath)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	reg := registry.NewRegistry(db)
	_ = reg.SeedDefaultServices(context.Background())

	metricsAdapter := metrics.NewHTTPCollector()
	alertEngine := alerts.NewEngine(db)
	auditLogger := audit.NewLogger(db)
	guard := guardrail.NewGuardrail(db, 60*time.Second)
	exec := executor.NewExecutor(reg, guard, alertEngine, auditLogger)

	cfg := &config.Config{
		Port:           8080,
		Environment:    "test",
		RateLimitRPS:   1000,
		RateLimitBurst: 2000,
		TokenTTL:       60 * time.Second,
		AuthSecret:     "test-secret-must-be-at-least-32-chars-long!",
	}

	handler := NewHandler(reg, metricsAdapter, alertEngine, auditLogger, guard, exec)
	server := NewServer(cfg, handler)

	ts := httptest.NewServer(server.httpServer.Handler)

	cleanup := func() {
		ts.Close()
		db.Close()
		_ = os.RemoveAll(tmpDir)
	}

	return server, ts, cleanup
}

func TestAPI_AuthenticationMiddleware(t *testing.T) {
	_, ts, cleanup := setupTestServer(t)
	defer cleanup()

	client := ts.Client()

	// 1. Health probe should succeed without auth
	healthResp, err := client.Get(ts.URL + "/api/health")
	if err != nil {
		t.Fatalf("failed to call /api/health: %v", err)
	}
	defer healthResp.Body.Close()
	if healthResp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for health probe, got %d", healthResp.StatusCode)
	}

	// 2. Services endpoint without auth header -> must return 401 Unauthorized
	unauthResp, err := client.Get(ts.URL + "/api/services")
	if err != nil {
		t.Fatalf("failed unauthenticated request: %v", err)
	}
	defer unauthResp.Body.Close()
	if unauthResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized without auth header, got %d", unauthResp.StatusCode)
	}

	// 3. Request with invalid token -> must return 401 Unauthorized
	badReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/services", nil)
	badReq.Header.Set("Authorization", "Bearer invalid-token-123")
	badResp, err := client.Do(badReq)
	if err != nil {
		t.Fatalf("failed bad token request: %v", err)
	}
	defer badResp.Body.Close()
	if badResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for bad token, got %d", badResp.StatusCode)
	}

	// 4. Request with valid token -> must return 200 OK
	validReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/services", nil)
	validReq.Header.Set("Authorization", "Bearer test-secret-must-be-at-least-32-chars-long!")
	validResp, err := client.Do(validReq)
	if err != nil {
		t.Fatalf("failed valid token request: %v", err)
	}
	defer validResp.Body.Close()
	if validResp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 OK for valid token, got %d", validResp.StatusCode)
	}
}

func TestAPI_500ConcurrentRequests(t *testing.T) {
	server, _, cleanup := setupTestServer(t)
	defer cleanup()

	numRequests := 500
	var wg sync.WaitGroup
	errCount := 0
	var mu sync.Mutex

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, "/api/services", nil)
			req.Header.Set("Authorization", "Bearer test-secret-must-be-at-least-32-chars-long!")
			w := httptest.NewRecorder()
			server.httpServer.Handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				mu.Lock()
				errCount++
				t.Logf("Got HTTP status: %d", w.Code)
				mu.Unlock()
			}
		}()
	}

	wg.Wait()

	if errCount > 0 {
		t.Errorf("encountered %d failures during 500 concurrent requests", errCount)
	}
}

func TestAPI_HighRiskConfirmationFlow(t *testing.T) {
	// Mock target control API
	controlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "restarted"})
	}))
	defer controlServer.Close()

	_, ts, cleanup := setupTestServer(t)
	defer cleanup()

	client := ts.Client()

	// Step 1: Initial call to restart_service without confirmation token -> must require confirmation (HTTP 428)
	initBody, _ := json.Marshal(models.ActionExecutionRequest{
		ServiceID:  "payment-service",
		ActionType: "restart_service",
		Reason:     "high latency investigation",
		Initiator:  "agent-ops",
	})
	req1, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/actions/execute", bytes.NewReader(initBody))
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("Authorization", "Bearer test-secret-must-be-at-least-32-chars-long!")

	resp1, err := client.Do(req1)
	if err != nil {
		t.Fatalf("failed execute request: %v", err)
	}
	defer resp1.Body.Close()

	if resp1.StatusCode != http.StatusPreconditionRequired {
		t.Fatalf("expected HTTP 428 Precondition Required, got %d", resp1.StatusCode)
	}

	var execResp models.ActionExecutionResponse
	if err := json.NewDecoder(resp1.Body).Decode(&execResp); err != nil {
		t.Fatalf("failed decoding execution response: %v", err)
	}

	if execResp.Status != "confirmation_required" || execResp.ChallengeID == "" {
		t.Fatalf("expected confirmation_required with challengeId, got: %+v", execResp)
	}

	// Step 2: Human reviews and approves challenge
	reviewBody, _ := json.Marshal(models.ConfirmActionRequest{
		ChallengeID: execResp.ChallengeID,
		Approved:    true,
		Reviewer:    "human-operator",
	})
	req2, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/challenges/"+execResp.ChallengeID+"/review", bytes.NewReader(reviewBody))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer test-secret-must-be-at-least-32-chars-long!")

	resp2, err := client.Do(req2)
	if err != nil {
		t.Fatalf("failed review request: %v", err)
	}
	defer resp2.Body.Close()

	var confirmResp models.ConfirmActionResponse
	if err := json.NewDecoder(resp2.Body).Decode(&confirmResp); err != nil {
		t.Fatalf("failed decoding confirm response: %v", err)
	}

	if !confirmResp.Approved || confirmResp.ConfirmationToken == "" {
		t.Fatalf("expected approved confirmation token, got %+v", confirmResp)
	}

	// Step 3: Execute with bad confirmation token -> rejected 403
	badExecBody, _ := json.Marshal(models.ActionExecutionRequest{
		ServiceID:         "payment-service",
		ActionType:        "restart_service",
		ConfirmationToken: "invalid-token-12345",
	})
	reqBad, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/actions/execute", bytes.NewReader(badExecBody))
	reqBad.Header.Set("Content-Type", "application/json")
	reqBad.Header.Set("Authorization", "Bearer test-secret-must-be-at-least-32-chars-long!")

	respBad, err := client.Do(reqBad)
	if err != nil {
		t.Fatalf("failed bad execute request: %v", err)
	}
	defer respBad.Body.Close()

	if respBad.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for invalid token, got %d", respBad.StatusCode)
	}
}
