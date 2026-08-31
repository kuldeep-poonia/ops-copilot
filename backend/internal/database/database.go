package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// DB wraps standard sql.DB with application-specific helpers.
type DB struct {
	*sql.DB
}

// Connect initializes the SQLite database at the specified path and runs initial migrations.
func Connect(dbPath string) (*DB, error) {
	if dbPath == "" {
		return nil, fmt.Errorf("database path cannot be empty")
	}

	dir := filepath.Dir(dbPath)
	if dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0750); err != nil {
			return nil, fmt.Errorf("failed to create database directory %s: %w", dir, err)
		}
	}

	// SQLite connection string with foreign keys enabled and WAL mode for concurrency
	dsn := fmt.Sprintf("%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database connection: %w", err)
	}

	// Enable connection pooling for concurrent readers in WAL mode
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	wrapped := &DB{DB: db}
	if err := wrapped.runMigrations(); err != nil {
		wrapped.Close()
		return nil, fmt.Errorf("migration failure: %w", err)
	}

	return wrapped, nil
}

// runMigrations executes schema creation statements for services, alerts, audit logs, and tokens.
func (db *DB) runMigrations() error {
	schema := `
	CREATE TABLE IF NOT EXISTS services (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		endpoint_url TEXT NOT NULL,
		control_api_url TEXT NOT NULL,
		control_api_key TEXT NOT NULL,
		current_status TEXT NOT NULL DEFAULT 'healthy',
		replicas INTEGER NOT NULL DEFAULT 1,
		min_replicas INTEGER NOT NULL DEFAULT 1,
		max_replicas INTEGER NOT NULL DEFAULT 10,
		created_at TIMESTAMP NOT NULL,
		updated_at TIMESTAMP NOT NULL
	);

	CREATE TABLE IF NOT EXISTS alerts (
		id TEXT PRIMARY KEY,
		service_id TEXT NOT NULL,
		service_name TEXT NOT NULL,
		severity TEXT NOT NULL,
		title TEXT NOT NULL,
		message TEXT NOT NULL,
		metric_name TEXT NOT NULL,
		threshold_value REAL NOT NULL,
		observed_value REAL NOT NULL,
		status TEXT NOT NULL,
		acknowledged_by TEXT,
		acknowledged_at TIMESTAMP,
		resolved_at TIMESTAMP,
		created_at TIMESTAMP NOT NULL,
		updated_at TIMESTAMP NOT NULL,
		FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_alerts_service_status ON alerts(service_id, status);
	CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);

	CREATE TABLE IF NOT EXISTS incident_notes (
		id TEXT PRIMARY KEY,
		alert_id TEXT NOT NULL,
		author TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at TIMESTAMP NOT NULL,
		FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_notes_alert_id ON incident_notes(alert_id);

	CREATE TABLE IF NOT EXISTS audit_logs (
		id TEXT PRIMARY KEY,
		actor TEXT NOT NULL,
		action_type TEXT NOT NULL,
		service_id TEXT NOT NULL,
		service_name TEXT NOT NULL,
		parameters TEXT NOT NULL,
		result_status TEXT NOT NULL,
		error_message TEXT,
		created_at TIMESTAMP NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_audit_service_id ON audit_logs(service_id);
	CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);

	CREATE TABLE IF NOT EXISTS confirmation_challenges (
		challenge_id TEXT PRIMARY KEY,
		service_id TEXT NOT NULL,
		service_name TEXT NOT NULL,
		action_type TEXT NOT NULL,
		parameters TEXT NOT NULL,
		reason TEXT NOT NULL,
		initiator TEXT NOT NULL,
		status TEXT NOT NULL,
		created_at TIMESTAMP NOT NULL,
		expires_at TIMESTAMP NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_challenges_expires ON confirmation_challenges(expires_at);

	CREATE TABLE IF NOT EXISTS confirmation_tokens (
		token_hash TEXT PRIMARY KEY,
		challenge_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		action_type TEXT NOT NULL,
		params_hash TEXT NOT NULL,
		expires_at TIMESTAMP NOT NULL,
		used_at TIMESTAMP,
		created_at TIMESTAMP NOT NULL,
		FOREIGN KEY (challenge_id) REFERENCES confirmation_challenges(challenge_id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_tokens_expires ON confirmation_tokens(expires_at);
	`

	_, err := db.Exec(schema)
	return err
}
