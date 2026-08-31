package registry

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"ops-copilot/backend/internal/database"
	"ops-copilot/backend/internal/models"
)

var (
	ErrServiceNotFound = errors.New("service not found in registry")
	ErrInvalidService  = errors.New("invalid service parameters")
)

// Registry manages the collection of monitored services backed by SQLite.
type Registry struct {
	db *database.DB
}

// NewRegistry creates a new service registry manager.
func NewRegistry(db *database.DB) *Registry {
	return &Registry{db: db}
}

// ListServices returns all registered services ordered by name.
func (r *Registry) ListServices(ctx context.Context) ([]models.Service, error) {
	query := `
		SELECT id, name, description, endpoint_url, control_api_url, control_api_key,
		       current_status, replicas, min_replicas, max_replicas, created_at, updated_at
		FROM services
		ORDER BY name ASC
	`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query services: %w", err)
	}
	defer rows.Close()

	var services []models.Service
	for rows.Next() {
		var s models.Service
		err := rows.Scan(
			&s.ID, &s.Name, &s.Description, &s.EndpointURL, &s.ControlAPIURL, &s.ControlAPIKey,
			&s.CurrentStatus, &s.Replicas, &s.MinReplicas, &s.MaxReplicas, &s.CreatedAt, &s.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan service row: %w", err)
		}
		services = append(services, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error reading services rows: %w", err)
	}

	return services, nil
}

// GetService retrieves a single registered service by its identifier.
func (r *Registry) GetService(ctx context.Context, id string) (*models.Service, error) {
	cleanID := strings.TrimSpace(id)
	if cleanID == "" {
		return nil, ErrInvalidService
	}

	query := `
		SELECT id, name, description, endpoint_url, control_api_url, control_api_key,
		       current_status, replicas, min_replicas, max_replicas, created_at, updated_at
		FROM services
		WHERE id = ?
	`
	var s models.Service
	err := r.db.QueryRowContext(ctx, query, cleanID).Scan(
		&s.ID, &s.Name, &s.Description, &s.EndpointURL, &s.ControlAPIURL, &s.ControlAPIKey,
		&s.CurrentStatus, &s.Replicas, &s.MinReplicas, &s.MaxReplicas, &s.CreatedAt, &s.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrServiceNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("database query error for service %s: %w", cleanID, err)
	}

	return &s, nil
}

// UpdateServiceStatus records the latest aggregated status for a service.
func (r *Registry) UpdateServiceStatus(ctx context.Context, id string, status string) error {
	query := `UPDATE services SET current_status = ?, updated_at = ? WHERE id = ?`
	res, err := r.db.ExecContext(ctx, query, status, time.Now().UTC(), id)
	if err != nil {
		return fmt.Errorf("failed to update service status: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrServiceNotFound
	}
	return nil
}

// UpdateServiceReplicas updates the replica count in the registry.
func (r *Registry) UpdateServiceReplicas(ctx context.Context, id string, replicas int) error {
	query := `UPDATE services SET replicas = ?, updated_at = ? WHERE id = ?`
	res, err := r.db.ExecContext(ctx, query, replicas, time.Now().UTC(), id)
	if err != nil {
		return fmt.Errorf("failed to update service replicas: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrServiceNotFound
	}
	return nil
}

// SeedDefaultServices initializes default microservice definitions if the table is empty.
func (r *Registry) SeedDefaultServices(ctx context.Context) error {
	var count int
	err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM services").Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to count existing services: %w", err)
	}
	if count > 0 {
		return nil
	}

	defaults := []models.Service{
		{
			ID:            "payment-service",
			Name:          "Payment Processing API",
			Description:   "Core payments gateway handling card transactions and settlement webhooks",
			EndpointURL:   "http://127.0.0.1:8081/metrics",
			ControlAPIURL: "http://127.0.0.1:8081/control",
			ControlAPIKey: "dev-payment-key",
			CurrentStatus: "healthy",
			Replicas:      3,
			MinReplicas:   1,
			MaxReplicas:   10,
			CreatedAt:     time.Now().UTC(),
			UpdatedAt:     time.Now().UTC(),
		},
		{
			ID:            "auth-service",
			Name:          "Authentication & IAM",
			Description:   "OAuth2 token issuance, session validation, and directory integration",
			EndpointURL:   "http://127.0.0.1:8082/metrics",
			ControlAPIURL: "http://127.0.0.1:8082/control",
			ControlAPIKey: "dev-auth-key",
			CurrentStatus: "healthy",
			Replicas:      2,
			MinReplicas:   1,
			MaxReplicas:   8,
			CreatedAt:     time.Now().UTC(),
			UpdatedAt:     time.Now().UTC(),
		},
		{
			ID:            "inventory-service",
			Name:          "Inventory & Catalog Engine",
			Description:   "Real-time warehouse stock tracking and product catalog caching",
			EndpointURL:   "http://127.0.0.1:8083/metrics",
			ControlAPIURL: "http://127.0.0.1:8083/control",
			ControlAPIKey: "dev-inventory-key",
			CurrentStatus: "healthy",
			Replicas:      4,
			MinReplicas:   2,
			MaxReplicas:   12,
			CreatedAt:     time.Now().UTC(),
			UpdatedAt:     time.Now().UTC(),
		},
	}

	for _, s := range defaults {
		query := `
			INSERT INTO services (id, name, description, endpoint_url, control_api_url, control_api_key,
			                      current_status, replicas, min_replicas, max_replicas, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`
		_, err := r.db.ExecContext(
			ctx, query,
			s.ID, s.Name, s.Description, s.EndpointURL, s.ControlAPIURL, s.ControlAPIKey,
			s.CurrentStatus, s.Replicas, s.MinReplicas, s.MaxReplicas, s.CreatedAt, s.UpdatedAt,
		)
		if err != nil {
			return fmt.Errorf("failed to seed service %s: %w", s.ID, err)
		}
	}

	return nil
}
