package guardrail

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ops-copilot/backend/internal/database"
)

func setupTestDB(t *testing.T) (*database.DB, func()) {
	tmpDir, err := os.MkdirTemp("", "guardrail_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	dbPath := filepath.Join(tmpDir, "test.db")
	db, err := database.Connect(dbPath)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	cleanup := func() {
		db.Close()
		_ = os.RemoveAll(tmpDir)
	}
	return db, cleanup
}

func TestGuardrail_EndToEndChallengeApprovalAndSingleUse(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	guard := NewGuardrail(db, 60*time.Second)
	ctx := context.Background()

	params := map[string]interface{}{"replicas": 4}
	challenge, err := guard.CreateChallenge(ctx, "payment-service", "Payment API", "scale_service", params, "scale up for peak traffic", "agent-1")
	if err != nil {
		t.Fatalf("failed to create challenge: %v", err)
	}

	// Approve challenge and obtain single-use token
	token, expiresAt, err := guard.ReviewChallenge(ctx, challenge.ChallengeID, true)
	if err != nil {
		t.Fatalf("failed to review challenge: %v", err)
	}
	if token == "" || expiresAt.IsZero() {
		t.Fatalf("expected valid token and expiry, got empty")
	}

	// 1st consumption -> Success
	err = guard.ValidateAndConsumeToken(ctx, token, "payment-service", "scale_service", params)
	if err != nil {
		t.Fatalf("1st token consumption failed: %v", err)
	}

	// 2nd consumption (Replay Attack) -> Must be Rejected!
	err = guard.ValidateAndConsumeToken(ctx, token, "payment-service", "scale_service", params)
	if err != ErrTokenAlreadyUsed {
		t.Fatalf("expected ErrTokenAlreadyUsed on replay attack, got %v", err)
	}
}

func TestGuardrail_ParameterAndScopeTampering(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	guard := NewGuardrail(db, 60*time.Second)
	ctx := context.Background()

	paramsOriginal := map[string]interface{}{"replicas": 2}
	challenge, err := guard.CreateChallenge(ctx, "payment-service", "Payment API", "scale_service", paramsOriginal, "reason", "agent-1")
	if err != nil {
		t.Fatalf("failed to create challenge: %v", err)
	}

	token, _, err := guard.ReviewChallenge(ctx, challenge.ChallengeID, true)
	if err != nil {
		t.Fatalf("failed to approve challenge: %v", err)
	}

	// Tampered parameters: attacker approved 2 replicas, but tries to execute 20 replicas!
	paramsTampered := map[string]interface{}{"replicas": 20}
	err = guard.ValidateAndConsumeToken(ctx, token, "payment-service", "scale_service", paramsTampered)
	if err != ErrTokenScopeMismatch {
		t.Errorf("expected ErrTokenScopeMismatch for tampered parameters, got %v", err)
	}

	// Tampered service ID: attacker approved for payment-service, but tries on auth-service!
	err = guard.ValidateAndConsumeToken(ctx, token, "auth-service", "scale_service", paramsOriginal)
	if err != ErrTokenScopeMismatch {
		t.Errorf("expected ErrTokenScopeMismatch for tampered service ID, got %v", err)
	}

	// Tampered action type: attacker approved scale, but tries restart!
	err = guard.ValidateAndConsumeToken(ctx, token, "payment-service", "restart_service", paramsOriginal)
	if err != ErrTokenScopeMismatch {
		t.Errorf("expected ErrTokenScopeMismatch for tampered action, got %v", err)
	}
}

func TestGuardrail_ExpiredToken(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	// 1 millisecond TTL to simulate instantaneous expiration
	guard := NewGuardrail(db, 1*time.Millisecond)
	ctx := context.Background()

	params := map[string]interface{}{}
	challenge, err := guard.CreateChallenge(ctx, "payment-service", "Payment API", "restart_service", params, "reason", "agent-1")
	if err != nil {
		t.Fatalf("failed to create challenge: %v", err)
	}

	token, _, err := guard.ReviewChallenge(ctx, challenge.ChallengeID, true)
	if err != nil {
		t.Fatalf("failed to approve challenge: %v", err)
	}

	time.Sleep(50 * time.Millisecond)

	err = guard.ValidateAndConsumeToken(ctx, token, "payment-service", "restart_service", params)
	if err != ErrTokenExpired {
		t.Errorf("expected ErrTokenExpired, got %v", err)
	}
}

func TestGuardrail_RejectionFlow(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	guard := NewGuardrail(db, 60*time.Second)
	ctx := context.Background()

	params := map[string]interface{}{}
	challenge, err := guard.CreateChallenge(ctx, "payment-service", "Payment API", "restart_service", params, "reason", "agent-1")
	if err != nil {
		t.Fatalf("failed to create challenge: %v", err)
	}

	token, _, err := guard.ReviewChallenge(ctx, challenge.ChallengeID, false)
	if err != nil {
		t.Fatalf("failed to reject challenge: %v", err)
	}
	if token != "" {
		t.Errorf("expected empty token on rejection, got %s", token)
	}

	// Verify challenge status is marked rejected
	retrieved, err := guard.GetChallenge(ctx, challenge.ChallengeID)
	if err != nil {
		t.Fatalf("failed to get challenge: %v", err)
	}
	if retrieved.Status != "rejected" {
		t.Errorf("expected status 'rejected', got %s", retrieved.Status)
	}
}

func TestGuardrail_ConcurrentTokenConsumption(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	guard := NewGuardrail(db, 60*time.Second)
	ctx := context.Background()

	params := map[string]interface{}{"replicas": 3}
	challenge, _ := guard.CreateChallenge(ctx, "payment-service", "Payment API", "scale_service", params, "reason", "agent-1")
	token, _, _ := guard.ReviewChallenge(ctx, challenge.ChallengeID, true)

	// Attempt 50 simultaneous token consumptions in parallel
	numGoroutines := 50
	var wg sync.WaitGroup
	var mu sync.Mutex
	successCount := 0
	alreadyUsedCount := 0

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := guard.ValidateAndConsumeToken(ctx, token, "payment-service", "scale_service", params)
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				successCount++
			} else if err == ErrTokenAlreadyUsed {
				alreadyUsedCount++
			}
		}()
	}

	wg.Wait()

	if successCount != 1 {
		t.Fatalf("critical concurrency violation: expected exactly 1 successful consumption, got %d", successCount)
	}
	if alreadyUsedCount != numGoroutines-1 {
		t.Errorf("expected %d rejected replay attempts, got %d", numGoroutines-1, alreadyUsedCount)
	}
}
