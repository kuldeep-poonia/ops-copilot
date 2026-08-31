package metrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ops-copilot/backend/internal/models"
)

func TestHTTPCollectorAdapter_UnreachableService(t *testing.T) {
	adapter := NewHTTPCollector()
	service := &models.Service{
		ID:          "test-unreachable",
		Name:        "Unreachable Service",
		EndpointURL: "http://127.0.0.1:59999/metrics", // non-existent port
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	health, err := adapter.GetServiceHealth(ctx, service)
	if err != nil {
		t.Fatalf("expected nil error (graceful degradation), got %v", err)
	}

	if health.IsReachable {
		t.Errorf("expected IsReachable=false for unreachable service")
	}
	if health.Status != models.StatusDown {
		t.Errorf("expected status=down, got %s", health.Status)
	}
}

func TestHTTPCollectorAdapter_MalformedAndExtremeMetrics(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Malformed & extreme: negative CPU, >100% memory, negative uptime
		_, _ = w.Write([]byte(`{
			"status": "ok",
			"cpu_percent": -45.5,
			"memory_usage": 999.9,
			"error_rate": -10.0,
			"uptime_sec": -500
		}`))
	}))
	defer ts.Close()

	adapter := NewHTTPCollector()
	service := &models.Service{
		ID:          "test-extreme",
		Name:        "Extreme Metrics Service",
		EndpointURL: ts.URL,
	}

	health, err := adapter.GetServiceHealth(context.Background(), service)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if health.CPUUsage < 0 || health.CPUUsage > 100 {
		t.Errorf("CPU was not sanitized: got %f", health.CPUUsage)
	}
	if health.MemoryUsage > 100 {
		t.Errorf("Memory was not clamped: got %f", health.MemoryUsage)
	}
	if health.ErrorRate < 0 {
		t.Errorf("Error rate was not clamped: got %f", health.ErrorRate)
	}
	if health.UptimeSec < 0 {
		t.Errorf("Uptime was negative: got %d", health.UptimeSec)
	}
}

func TestHTTPCollectorAdapter_InvalidJSON(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte(`502 Bad Gateway: upstream server error`))
	}))
	defer ts.Close()

	adapter := NewHTTPCollector()
	service := &models.Service{
		ID:          "test-bad-json",
		Name:        "Bad JSON Service",
		EndpointURL: ts.URL,
	}

	health, err := adapter.GetServiceHealth(context.Background(), service)
	if err != nil {
		t.Fatalf("expected graceful handle on bad json, got %v", err)
	}

	if health.Status != models.StatusDegraded {
		t.Errorf("expected degraded status for invalid json response, got %s", health.Status)
	}
}
