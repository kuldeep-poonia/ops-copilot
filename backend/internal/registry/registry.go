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
		WHERE id = ? OR id LIKE ? OR LOWER(name) LIKE ? OR endpoint_url LIKE ?
		ORDER BY CASE WHEN id = ? THEN 1 ELSE 2 END
		LIMIT 1
	`
	likePattern := "%" + cleanID + "%"
	lowerPattern := "%" + strings.ToLower(cleanID) + "%"

	var s models.Service
	err := r.db.QueryRowContext(ctx, query, cleanID, likePattern, lowerPattern, likePattern, cleanID).Scan(
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

// RegisterService adds or updates a monitored infrastructure service.
func (r *Registry) RegisterService(ctx context.Context, s models.Service) error {
	cleanID := strings.TrimSpace(s.ID)
	if cleanID == "" || strings.TrimSpace(s.Name) == "" || strings.TrimSpace(s.EndpointURL) == "" {
		return ErrInvalidService
	}

	if s.MinReplicas < 1 {
		s.MinReplicas = 1
	}
	if s.MaxReplicas < s.MinReplicas {
		s.MaxReplicas = s.MinReplicas + 5
	}
	if s.Replicas < s.MinReplicas {
		s.Replicas = s.MinReplicas
	}
	if s.CurrentStatus == "" {
		s.CurrentStatus = "healthy"
	}

	now := time.Now().UTC()
	query := `
		INSERT INTO services (id, name, description, endpoint_url, control_api_url, control_api_key,
		                      current_status, replicas, min_replicas, max_replicas, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			description = excluded.description,
			endpoint_url = excluded.endpoint_url,
			control_api_url = excluded.control_api_url,
			control_api_key = excluded.control_api_key,
			current_status = excluded.current_status,
			replicas = excluded.replicas,
			min_replicas = excluded.min_replicas,
			max_replicas = excluded.max_replicas,
			updated_at = excluded.updated_at
	`
	_, err := r.db.ExecContext(
		ctx, query,
		cleanID, s.Name, s.Description, s.EndpointURL, s.ControlAPIURL, s.ControlAPIKey,
		s.CurrentStatus, s.Replicas, s.MinReplicas, s.MaxReplicas, now, now,
	)
	if err != nil {
		return fmt.Errorf("failed to register service %s: %w", cleanID, err)
	}
	return nil
}

// DeleteService removes a monitored service from the registry.
func (r *Registry) DeleteService(ctx context.Context, id string) error {
	cleanID := strings.TrimSpace(id)
	if cleanID == "" {
		return ErrInvalidService
	}

	query := `DELETE FROM services WHERE id = ?`
	res, err := r.db.ExecContext(ctx, query, cleanID)
	if err != nil {
		return fmt.Errorf("failed to delete service %s: %w", cleanID, err)
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

// SeedDefaultServices is a no-op placeholder maintained for initialization compatibility.
func (r *Registry) SeedDefaultServices(ctx context.Context) error {
	return nil
}
