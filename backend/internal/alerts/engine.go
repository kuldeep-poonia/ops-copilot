package alerts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"ops-copilot/backend/internal/database"
	"ops-copilot/backend/internal/models"
)

var (
	ErrAlertNotFound      = errors.New("alert not found")
	ErrAlertAlreadyResolved = errors.New("cannot modify already resolved alert")
	ErrInvalidAlertInput  = errors.New("invalid alert input parameters")
)

// Engine manages threshold evaluations, alert lifecycle, and flapping deduplication.
type Engine struct {
	db *database.DB
}

// NewEngine creates a new Alert Engine instance.
func NewEngine(db *database.DB) *Engine {
	return &Engine{db: db}
}

// ThresholdRule defines metric thresholds triggering alerts.
type ThresholdRule struct {
	MetricName string
	Warning    float64
	Critical   float64
}

var defaultRules = []ThresholdRule{
	{MetricName: "error_rate", Warning: 3.0, Critical: 15.0},
	{MetricName: "cpu_percent", Warning: 80.0, Critical: 92.0},
	{MetricName: "memory_usage", Warning: 85.0, Critical: 95.0},
}

// EvaluateHealth checks service health against defined rules and creates or updates alerts.
func (e *Engine) EvaluateHealth(ctx context.Context, health *models.ServiceHealth) ([]models.Alert, error) {
	if health == nil {
		return nil, ErrInvalidAlertInput
	}

	var generatedAlerts []models.Alert

	if !health.IsReachable || health.Status == models.StatusDown {
		alert, err := e.upsertAlert(ctx, models.Alert{
			ServiceID:      health.ServiceID,
			ServiceName:    health.ServiceName,
			Severity:       models.SeverityCritical,
			Title:          fmt.Sprintf("Service %s is unreachable", health.ServiceName),
			Message:        "Health endpoint connection failed or timed out. System is unreachable.",
			MetricName:     "service_reachability",
			ThresholdValue: 1.0,
			ObservedValue:  0.0,
			Status:         models.AlertStatusFiring,
		})
		if err != nil {
			return nil, err
		}
		generatedAlerts = append(generatedAlerts, *alert)
		return generatedAlerts, nil
	}

	for _, rule := range defaultRules {
		var observed float64
		var title string

		switch rule.MetricName {
		case "error_rate":
			observed = health.ErrorRate
			title = fmt.Sprintf("High Error Rate (%.2f%%) on %s", observed, health.ServiceName)
		case "cpu_percent":
			observed = health.CPUUsage
			title = fmt.Sprintf("High CPU Usage (%.2f%%) on %s", observed, health.ServiceName)
		case "memory_usage":
			observed = health.MemoryUsage
			title = fmt.Sprintf("High Memory Pressure (%.2f%%) on %s", observed, health.ServiceName)
		}

		if observed >= rule.Critical {
			alert, err := e.upsertAlert(ctx, models.Alert{
				ServiceID:      health.ServiceID,
				ServiceName:    health.ServiceName,
				Severity:       models.SeverityCritical,
				Title:          title,
				Message:        fmt.Sprintf("Observed %.2f exceeds critical threshold of %.2f", observed, rule.Critical),
				MetricName:     rule.MetricName,
				ThresholdValue: rule.Critical,
				ObservedValue:  observed,
				Status:         models.AlertStatusFiring,
			})
			if err != nil {
				return nil, err
			}
			generatedAlerts = append(generatedAlerts, *alert)
		} else if observed >= rule.Warning {
			alert, err := e.upsertAlert(ctx, models.Alert{
				ServiceID:      health.ServiceID,
				ServiceName:    health.ServiceName,
				Severity:       models.SeverityWarning,
				Title:          title,
				Message:        fmt.Sprintf("Observed %.2f exceeds warning threshold of %.2f", observed, rule.Warning),
				MetricName:     rule.MetricName,
				ThresholdValue: rule.Warning,
				ObservedValue:  observed,
				Status:         models.AlertStatusFiring,
			})
			if err != nil {
				return nil, err
			}
			generatedAlerts = append(generatedAlerts, *alert)
		} else {
			// Auto-resolve any active alerts for this metric if conditions returned to normal
			if err := e.autoResolveMetricAlert(ctx, health.ServiceID, rule.MetricName); err != nil {
				return nil, err
			}
		}
	}

	return generatedAlerts, nil
}

// upsertAlert prevents alert flapping by deduplicating against open alerts.
func (e *Engine) upsertAlert(ctx context.Context, a models.Alert) (*models.Alert, error) {
	now := time.Now().UTC()

	// Check if an open alert exists for this service and metric
	query := `
		SELECT id, service_id, service_name, severity, title, message, metric_name,
		       threshold_value, observed_value, status, acknowledged_by, acknowledged_at,
		       resolved_at, created_at, updated_at
		FROM alerts
		WHERE service_id = ? AND metric_name = ? AND status IN ('firing', 'acknowledged')
		ORDER BY created_at DESC
		LIMIT 1
	`
	var existing models.Alert
	err := e.db.QueryRowContext(ctx, query, a.ServiceID, a.MetricName).Scan(
		&existing.ID, &existing.ServiceID, &existing.ServiceName, &existing.Severity,
		&existing.Title, &existing.Message, &existing.MetricName, &existing.ThresholdValue,
		&existing.ObservedValue, &existing.Status, &existing.AcknowledgedBy,
		&existing.AcknowledgedAt, &existing.ResolvedAt, &existing.CreatedAt, &existing.UpdatedAt,
	)

	if err == nil {
		// Existing open alert found -> update value and timestamp without duplicating
		updateQuery := `
			UPDATE alerts
			SET observed_value = ?, severity = ?, title = ?, message = ?, updated_at = ?
			WHERE id = ?
		`
		_, err := e.db.ExecContext(ctx, updateQuery, a.ObservedValue, a.Severity, a.Title, a.Message, now, existing.ID)
		if err != nil {
			return nil, fmt.Errorf("failed to update existing alert: %w", err)
		}
		existing.ObservedValue = a.ObservedValue
		existing.Severity = a.Severity
		existing.Title = a.Title
		existing.Message = a.Message
		existing.UpdatedAt = now
		return &existing, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("failed to query existing alert: %w", err)
	}

	// No active alert found -> create new alert
	newID := "alt-" + uuid.New().String()[:8]
	insertQuery := `
		INSERT INTO alerts (id, service_id, service_name, severity, title, message, metric_name,
		                    threshold_value, observed_value, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err = e.db.ExecContext(
		ctx, insertQuery,
		newID, a.ServiceID, a.ServiceName, a.Severity, a.Title, a.Message,
		a.MetricName, a.ThresholdValue, a.ObservedValue, a.Status, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to insert new alert: %w", err)
	}

	a.ID = newID
	a.CreatedAt = now
	a.UpdatedAt = now
	return &a, nil
}

// autoResolveMetricAlert marks active alerts as resolved when metrics return to normal range.
func (e *Engine) autoResolveMetricAlert(ctx context.Context, serviceID, metricName string) error {
	now := time.Now().UTC()
	query := `
		UPDATE alerts
		SET status = 'resolved', resolved_at = ?, updated_at = ?
		WHERE service_id = ? AND metric_name = ? AND status IN ('firing', 'acknowledged')
	`
	_, err := e.db.ExecContext(ctx, query, now, now, serviceID, metricName)
	return err
}

// ListAlerts fetches alerts with optional filtering by service and status.
func (e *Engine) ListAlerts(ctx context.Context, serviceID, status string) ([]models.Alert, error) {
	var conditions []string
	var args []interface{}

	if strings.TrimSpace(serviceID) != "" {
		conditions = append(conditions, "service_id = ?")
		args = append(args, serviceID)
	}
	if strings.TrimSpace(status) != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, status)
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	query := fmt.Sprintf(`
		SELECT id, service_id, service_name, severity, title, message, metric_name,
		       threshold_value, observed_value, status, acknowledged_by, acknowledged_at,
		       resolved_at, created_at, updated_at
		FROM alerts
		%s
		ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC
		LIMIT 100
	`, whereClause)

	rows, err := e.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query alerts: %w", err)
	}
	defer rows.Close()

	var alerts []models.Alert
	for rows.Next() {
		var a models.Alert
		err := rows.Scan(
			&a.ID, &a.ServiceID, &a.ServiceName, &a.Severity, &a.Title, &a.Message,
			&a.MetricName, &a.ThresholdValue, &a.ObservedValue, &a.Status,
			&a.AcknowledgedBy, &a.AcknowledgedAt, &a.ResolvedAt, &a.CreatedAt, &a.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan alert row: %w", err)
		}
		alerts = append(alerts, a)
	}

	// Populate notes for each alert
	for i := range alerts {
		notes, err := e.getAlertNotes(ctx, alerts[i].ID)
		if err == nil {
			alerts[i].Notes = notes
		}
	}

	return alerts, nil
}

// AcknowledgeAlert transitions an alert to acknowledged status.
func (e *Engine) AcknowledgeAlert(ctx context.Context, alertID, actor, reason string) error {
	cleanID := strings.TrimSpace(alertID)
	if cleanID == "" {
		return ErrInvalidAlertInput
	}
	if strings.TrimSpace(actor) == "" {
		actor = "operator"
	}

	now := time.Now().UTC()
	query := `
		UPDATE alerts
		SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ?, updated_at = ?
		WHERE id = ? AND status = 'firing'
	`
	res, err := e.db.ExecContext(ctx, query, actor, now, now, cleanID)
	if err != nil {
		return fmt.Errorf("failed to acknowledge alert: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		// Check why it wasn't updated
		var status string
		err := e.db.QueryRowContext(ctx, "SELECT status FROM alerts WHERE id = ?", cleanID).Scan(&status)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrAlertNotFound
		}
		if status == string(models.AlertStatusResolved) {
			return ErrAlertAlreadyResolved
		}
		// Already acknowledged is fine, treat as idempotent success
	}

	if strings.TrimSpace(reason) != "" {
		_, _ = e.AddIncidentNote(ctx, cleanID, actor, "Alert acknowledged: "+reason)
	}

	return nil
}

// AddIncidentNote adds a collaborative note to an active or resolved incident.
func (e *Engine) AddIncidentNote(ctx context.Context, alertID, author, content string) (*models.IncidentNote, error) {
	if strings.TrimSpace(alertID) == "" || strings.TrimSpace(content) == "" {
		return nil, ErrInvalidAlertInput
	}
	if strings.TrimSpace(author) == "" {
		author = "operator"
	}

	// Confirm alert exists
	var dummy string
	err := e.db.QueryRowContext(ctx, "SELECT id FROM alerts WHERE id = ?", alertID).Scan(&dummy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrAlertNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to check alert existence: %w", err)
	}

	note := models.IncidentNote{
		ID:        "note-" + uuid.New().String()[:8],
		AlertID:   alertID,
		Author:    author,
		Content:   content,
		CreatedAt: time.Now().UTC(),
	}

	query := `INSERT INTO incident_notes (id, alert_id, author, content, created_at) VALUES (?, ?, ?, ?, ?)`
	_, err = e.db.ExecContext(ctx, query, note.ID, note.AlertID, note.Author, note.Content, note.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to insert incident note: %w", err)
	}

	return &note, nil
}

func (e *Engine) getAlertNotes(ctx context.Context, alertID string) ([]models.IncidentNote, error) {
	query := `SELECT id, alert_id, author, content, created_at FROM incident_notes WHERE alert_id = ? ORDER BY created_at ASC`
	rows, err := e.db.QueryContext(ctx, query, alertID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []models.IncidentNote
	for rows.Next() {
		var n models.IncidentNote
		if err := rows.Scan(&n.ID, &n.AlertID, &n.Author, &n.Content, &n.CreatedAt); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	return notes, nil
}
