package alerts

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"ops-copilot/backend/internal/database"
	"ops-copilot/backend/internal/models"
)

func setupTestDB(t *testing.T) (*database.DB, func()) {
	tmpDir, err := os.MkdirTemp("", "alert_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	dbPath := filepath.Join(tmpDir, "test.db")
	db, err := database.Connect(dbPath)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	// Seed dummy service
	_, err = db.Exec(`
		INSERT INTO services (id, name, description, endpoint_url, control_api_url, control_api_key, current_status, replicas, min_replicas, max_replicas, created_at, updated_at)
		VALUES ('svc-test', 'Test Service', 'Desc', 'http://127.0.0.1:8080/metrics', 'http://127.0.0.1:8080/control', 'key', 'healthy', 1, 1, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`)
	if err != nil {
		t.Fatalf("failed to insert test service: %v", err)
	}

	cleanup := func() {
		db.Close()
		_ = os.RemoveAll(tmpDir)
	}
	return db, cleanup
}

func TestAlertEngine_FlappingDeduplication(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	engine := NewEngine(db)
	ctx := context.Background()

	// High CPU triggers alert
	health := &models.ServiceHealth{
		ServiceID:   "svc-test",
		ServiceName: "Test Service",
		Status:      models.StatusDegraded,
		CPUUsage:    95.0,
		MemoryUsage: 40.0,
		ErrorRate:   0.0,
		IsReachable: true,
	}

	// First evaluation -> creates alert
	alerts1, err := engine.EvaluateHealth(ctx, health)
	if err != nil {
		t.Fatalf("evaluation failed: %v", err)
	}
	if len(alerts1) == 0 {
		t.Fatalf("expected alert generated, got 0")
	}
	alertID := alerts1[0].ID

	// Repeat evaluation 20 times (simulating rapid flapping)
	for i := 0; i < 20; i++ {
		health.CPUUsage = 92.0 + float64(i%5)
		alertsN, err := engine.EvaluateHealth(ctx, health)
		if err != nil {
			t.Fatalf("evaluation failed at iteration %d: %v", i, err)
		}
		if len(alertsN) != 1 {
			t.Fatalf("expected 1 alert returned, got %d", len(alertsN))
		}
		if alertsN[0].ID != alertID {
			t.Fatalf("flapping created new alert row %s instead of updating %s", alertsN[0].ID, alertID)
		}
	}

	// Verify database only has 1 alert row for this service and metric
	allAlerts, err := engine.ListAlerts(ctx, "svc-test", "")
	if err != nil {
		t.Fatalf("failed to list alerts: %v", err)
	}
	if len(allAlerts) != 1 {
		t.Errorf("expected exactly 1 alert row in DB, found %d", len(allAlerts))
	}
}

func TestAlertEngine_AcknowledgmentAndNotes(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	engine := NewEngine(db)
	ctx := context.Background()

	health := &models.ServiceHealth{
		ServiceID:   "svc-test",
		ServiceName: "Test Service",
		Status:      models.StatusDegraded,
		CPUUsage:    96.0,
		MemoryUsage: 20.0,
		ErrorRate:   0.0,
		IsReachable: true,
	}

	alertsList, err := engine.EvaluateHealth(ctx, health)
	if err != nil || len(alertsList) == 0 {
		t.Fatalf("expected alert creation")
	}
	alertID := alertsList[0].ID

	// Acknowledge alert
	err = engine.AcknowledgeAlert(ctx, alertID, "agent-bob", "Investigating load spike")
	if err != nil {
		t.Fatalf("acknowledge failed: %v", err)
	}

	// Add incident note
	note, err := engine.AddIncidentNote(ctx, alertID, "engineer-alice", "Identified memory leak in worker queue")
	if err != nil {
		t.Fatalf("add note failed: %v", err)
	}
	if note.ID == "" || note.Content != "Identified memory leak in worker queue" {
		t.Errorf("invalid note content: %+v", note)
	}

	// Verify listing includes note
	queried, err := engine.ListAlerts(ctx, "svc-test", string(models.AlertStatusAcknowledged))
	if err != nil || len(queried) != 1 {
		t.Fatalf("expected 1 acknowledged alert, got %d", len(queried))
	}
	if len(queried[0].Notes) < 2 { // 1 from acknowledge reason + 1 manual note
		t.Errorf("expected at least 2 notes, got %d", len(queried[0].Notes))
	}
}

func TestAlertEngine_AcknowledgeNonExistent(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	engine := NewEngine(db)
	err := engine.AcknowledgeAlert(context.Background(), "non-existent-alert-id", "operator", "reason")
	if err != ErrAlertNotFound {
		t.Errorf("expected ErrAlertNotFound, got %v", err)
	}
}
