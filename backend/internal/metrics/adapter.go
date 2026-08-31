package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"

	"ops-copilot/backend/internal/models"
)

// MetricsSource defines the pluggable contract for fetching live health and metrics from services.
type MetricsSource interface {
	GetServiceHealth(ctx context.Context, service *models.Service) (*models.ServiceHealth, error)
}

// HTTPCollectorAdapter queries service HTTP endpoints for live metrics.
type HTTPCollectorAdapter struct {
	client *http.Client
}

// NewHTTPCollector creates a new HTTP collector with an explicit 3-second timeout.
func NewHTTPCollector() *HTTPCollectorAdapter {
	return &HTTPCollectorAdapter{
		client: &http.Client{
			Timeout: 3 * time.Second,
		},
	}
}

// GetServiceHealth queries the service's endpoint, normalizes metrics, and handles unreachable states gracefully.
func (h *HTTPCollectorAdapter) GetServiceHealth(ctx context.Context, service *models.Service) (*models.ServiceHealth, error) {
	if service == nil {
		return nil, fmt.Errorf("service cannot be nil")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, service.EndpointURL, nil)
	if err != nil {
		return &models.ServiceHealth{
			ServiceID:   service.ID,
			ServiceName: service.Name,
			Status:      models.StatusDown,
			IsReachable: false,
			CheckedAt:   time.Now().UTC(),
		}, nil
	}

	resp, err := h.client.Do(req)
	if err != nil {
		// Network down, refused connection, or timeout
		return &models.ServiceHealth{
			ServiceID:   service.ID,
			ServiceName: service.Name,
			Status:      models.StatusDown,
			IsReachable: false,
			CheckedAt:   time.Now().UTC(),
		}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &models.ServiceHealth{
			ServiceID:   service.ID,
			ServiceName: service.Name,
			Status:      models.StatusUnhealthy,
			IsReachable: true,
			CheckedAt:   time.Now().UTC(),
		}, nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1MB limit prevents memory exhaustion
	if err != nil {
		return &models.ServiceHealth{
			ServiceID:   service.ID,
			ServiceName: service.Name,
			Status:      models.StatusDegraded,
			IsReachable: true,
			CheckedAt:   time.Now().UTC(),
		}, nil
	}

	var raw models.RawMetrics
	if err := json.Unmarshal(body, &raw); err != nil {
		// Response received was malformed JSON
		return &models.ServiceHealth{
			ServiceID:   service.ID,
			ServiceName: service.Name,
			Status:      models.StatusDegraded,
			IsReachable: true,
			CheckedAt:   time.Now().UTC(),
		}, nil
	}

	// Sanitize values against negative or absurd inputs
	cpu := sanitizePercentage(raw.CPUPercent)
	mem := sanitizePercentage(raw.MemoryUsage)
	errRate := sanitizePercentage(raw.ErrorRate)
	uptimeSec := raw.UptimeSec
	if uptimeSec < 0 {
		uptimeSec = 0
	}

	status := deriveStatus(raw.Status, cpu, mem, errRate)

	return &models.ServiceHealth{
		ServiceID:   service.ID,
		ServiceName: service.Name,
		Status:      status,
		ErrorRate:   errRate,
		CPUUsage:    cpu,
		MemoryUsage: mem,
		Uptime:      formatUptime(uptimeSec),
		UptimeSec:   uptimeSec,
		IsReachable: true,
		CheckedAt:   time.Now().UTC(),
	}, nil
}

func sanitizePercentage(val float64) float64 {
	if math.IsNaN(val) || math.IsInf(val, 0) || val < 0 {
		return 0.0
	}
	if val > 100.0 {
		return 100.0
	}
	return math.Round(val*100) / 100
}

func deriveStatus(reported string, cpu, mem, errRate float64) models.ServiceStatus {
	if reported == "down" || reported == "critical" {
		return models.StatusUnhealthy
	}
	if errRate > 15.0 || cpu > 95.0 || mem > 95.0 {
		return models.StatusUnhealthy
	}
	if errRate > 3.0 || cpu > 80.0 || mem > 85.0 || reported == "degraded" {
		return models.StatusDegraded
	}
	return models.StatusHealthy
}

func formatUptime(seconds int64) string {
	if seconds < 60 {
		return fmt.Sprintf("%ds", seconds)
	}
	if seconds < 3600 {
		return fmt.Sprintf("%dm %ds", seconds/60, seconds%60)
	}
	hours := seconds / 3600
	mins := (seconds % 3600) / 60
	if hours < 24 {
		return fmt.Sprintf("%dh %dm", hours, mins)
	}
	days := hours / 24
	remHours := hours % 24
	return fmt.Sprintf("%dd %dh", days, remHours)
}
