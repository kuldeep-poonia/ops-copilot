package audit

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"ops-copilot/backend/internal/database"
	"ops-copilot/backend/internal/models"
)

var (
	// Regex pattern to scrub sensitive keys/tokens from audit parameters and messages
	secretPattern = regexp.MustCompile(`(?i)(token|key|password|secret|auth|bearer)[\"':\s=]+([a-zA-Z0-9_\-\.]{8,})`)
)

// Logger manages the immutable audit log table.
type Logger struct {
	db *database.DB
}

// NewLogger creates a new audit log manager.
func NewLogger(db *database.DB) *Logger {
	return &Logger{db: db}
}

// Record inserts an immutable audit entry after scrubbing any sensitive values.
func (l *Logger) Record(ctx context.Context, entry models.AuditEntry) error {
	if entry.ID == "" {
		entry.ID = "aud-" + uuid.New().String()[:8]
	}
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = time.Now().UTC()
	}

	sanitizedParams := l.ScrubSecrets(entry.Parameters)
	var sanitizedError *string
	if entry.ErrorMessage != nil {
		cleaned := l.ScrubSecrets(*entry.ErrorMessage)
		sanitizedError = &cleaned
	}

	query := `
		INSERT INTO audit_logs (id, actor, action_type, service_id, service_name, parameters, result_status, error_message, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := l.db.ExecContext(
		ctx, query,
		entry.ID, entry.Actor, entry.ActionType, entry.ServiceID, entry.ServiceName,
		sanitizedParams, entry.ResultStatus, sanitizedError, entry.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to persist audit entry: %w", err)
	}

	return nil
}

// ListEntries returns paginated audit records and total count.
func (l *Logger) ListEntries(ctx context.Context, serviceID string, limit, offset int) ([]models.AuditEntry, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	var whereClause string
	var args []interface{}
	if strings.TrimSpace(serviceID) != "" {
		whereClause = "WHERE service_id = ?"
		args = append(args, serviceID)
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM audit_logs %s", whereClause)
	var total int
	err := l.db.QueryRowContext(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count audit logs: %w", err)
	}

	selectQuery := fmt.Sprintf(`
		SELECT id, actor, action_type, service_id, service_name, parameters, result_status, error_message, created_at
		FROM audit_logs
		%s
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, whereClause)

	queryArgs := append(args, limit, offset)
	rows, err := l.db.QueryContext(ctx, selectQuery, queryArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to query audit logs: %w", err)
	}
	defer rows.Close()

	var entries []models.AuditEntry
	for rows.Next() {
		var e models.AuditEntry
		err := rows.Scan(
			&e.ID, &e.Actor, &e.ActionType, &e.ServiceID, &e.ServiceName,
			&e.Parameters, &e.ResultStatus, &e.ErrorMessage, &e.CreatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to scan audit entry: %w", err)
		}
		entries = append(entries, e)
	}

	return entries, total, nil
}

// ScrubSecrets redacts sensitive credentials from strings before persistence.
func (l *Logger) ScrubSecrets(input string) string {
	if input == "" {
		return input
	}
	return secretPattern.ReplaceAllString(input, `$1: "***REDACTED***"`)
}
