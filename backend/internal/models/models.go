package models

import (
	"time"
)

// ServiceStatus represents the health status of a monitored service.
type ServiceStatus string

const (
	StatusHealthy   ServiceStatus = "healthy"
	StatusDegraded  ServiceStatus = "degraded"
	StatusUnhealthy ServiceStatus = "unhealthy"
	StatusDown      ServiceStatus = "down"
)

// Service defines a registered service monitored by Ops Co-pilot.
type Service struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	EndpointURL    string    `json:"endpointUrl"`
	ControlAPIURL  string    `json:"controlApiUrl"`
	ControlAPIKey  string    `json:"-"` // Omit sensitive control key from API JSON
	CurrentStatus  string    `json:"currentStatus"`
	Replicas       int       `json:"replicas"`
	MinReplicas    int       `json:"minReplicas"`
	MaxReplicas    int       `json:"maxReplicas"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// ServiceHealth aggregates real-time metrics for a monitored service.
type ServiceHealth struct {
	ServiceID    string        `json:"serviceId"`
	ServiceName  string        `json:"serviceName"`
	Status       ServiceStatus `json:"status"`
	ErrorRate    float64       `json:"errorRate"`    // percentage: 0.0 to 100.0
	CPUUsage     float64       `json:"cpuUsage"`     // percentage: 0.0 to 100.0
	MemoryUsage  float64       `json:"memoryUsage"`  // percentage: 0.0 to 100.0
	Uptime       string        `json:"uptime"`       // human-readable format e.g. "99.98%" or duration
	UptimeSec    int64         `json:"uptimeSec"`    // seconds elapsed since start
	ActiveAlerts int           `json:"activeAlerts"` // count of currently active alerts
	LastAction   *string       `json:"lastAction,omitempty"`
	CheckedAt    time.Time     `json:"checkedAt"`
	IsReachable  bool          `json:"isReachable"`
}

// RawMetrics represents the raw metric payload received from a service health/metrics endpoint.
type RawMetrics struct {
	Status      string  `json:"status"`
	ErrorRate   float64 `json:"error_rate"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemoryUsage float64 `json:"memory_usage"`
	UptimeSec   int64   `json:"uptime_sec"`
	Replicas    int     `json:"replicas"`
}

// AlertSeverity defines the urgency of an alert.
type AlertSeverity string

const (
	SeverityInfo     AlertSeverity = "info"
	SeverityWarning  AlertSeverity = "warning"
	SeverityCritical AlertSeverity = "critical"
)

// AlertStatus defines the current lifecycle state of an alert.
type AlertStatus string

const (
	AlertStatusFiring       AlertStatus = "firing"
	AlertStatusAcknowledged AlertStatus = "acknowledged"
	AlertStatusResolved     AlertStatus = "resolved"
)

// Alert represents an infrastructure or service health alert.
type Alert struct {
	ID             string        `json:"id"`
	ServiceID      string        `json:"serviceId"`
	ServiceName    string        `json:"serviceName"`
	Severity       AlertSeverity `json:"severity"`
	Title          string        `json:"title"`
	Message        string        `json:"message"`
	MetricName     string        `json:"metricName"`
	ThresholdValue float64       `json:"thresholdValue"`
	ObservedValue  float64       `json:"observedValue"`
	Status         AlertStatus   `json:"status"`
	AcknowledgedBy *string       `json:"acknowledgedBy,omitempty"`
	AcknowledgedAt *time.Time    `json:"acknowledgedAt,omitempty"`
	ResolvedAt     *time.Time    `json:"resolvedAt,omitempty"`
	CreatedAt      time.Time     `json:"createdAt"`
	UpdatedAt      time.Time     `json:"updatedAt"`
	Notes          []IncidentNote `json:"notes,omitempty"`
}

// IncidentNote represents a contextual note appended to an alert during incident triage.
type IncidentNote struct {
	ID        string    `json:"id"`
	AlertID   string    `json:"alertId"`
	Author    string    `json:"author"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

// AuditEntry is an immutable record of an operational action attempt.
type AuditEntry struct {
	ID           string    `json:"id"`
	Actor        string    `json:"actor"`        // e.g. "agent" or "human:admin"
	ActionType   string    `json:"actionType"`   // e.g. "restart_service", "scale_service", "acknowledge_alert"
	ServiceID    string    `json:"serviceId"`
	ServiceName  string    `json:"serviceName"`
	Parameters   string    `json:"parameters"`   // JSON-encoded string of parameters
	ResultStatus string    `json:"resultStatus"` // "success", "failed", "rejected", "confirmation_required"
	ErrorMessage *string   `json:"errorMessage,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ConfirmationChallenge represents a pending high-risk action requiring human approval.
type ConfirmationChallenge struct {
	ChallengeID    string    `json:"challengeId"`
	ServiceID      string    `json:"serviceId"`
	ServiceName    string    `json:"serviceName"`
	ActionType     string    `json:"actionType"`
	Parameters     string    `json:"parameters"` // JSON string
	Reason         string    `json:"reason"`
	Initiator      string    `json:"initiator"` // "agent" or "human"
	Status         string    `json:"status"`    // "pending", "approved", "rejected", "executed", "expired"
	CreatedAt      time.Time `json:"createdAt"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

// ConfirmationToken represents a cryptographically verified single-use execution token.
type ConfirmationToken struct {
	TokenHash   string    `json:"-"`
	ChallengeID string    `json:"challengeId"`
	ServiceID   string    `json:"serviceId"`
	ActionType  string    `json:"actionType"`
	ParamsHash  string    `json:"-"`
	ExpiresAt   time.Time `json:"expiresAt"`
	UsedAt      *time.Time `json:"usedAt,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

// ActionExecutionRequest represents the payload for triggering or confirming an action.
type ActionExecutionRequest struct {
	ServiceID         string                 `json:"serviceId"`
	ActionType        string                 `json:"actionType"`
	Parameters        map[string]interface{} `json:"parameters,omitempty"`
	Reason            string                 `json:"reason,omitempty"`
	Initiator         string                 `json:"initiator,omitempty"` // "agent" or "human"
	ConfirmationToken string                 `json:"confirmationToken,omitempty"`
}

// ActionExecutionResponse is returned by the action executor.
type ActionExecutionResponse struct {
	Success              bool                   `json:"success"`
	Status               string                 `json:"status"` // "executed", "confirmation_required", "rejected", "failed"
	Message              string                 `json:"message"`
	ChallengeID          string                 `json:"challengeId,omitempty"`
	RequiredConfirmation *ConfirmationChallenge `json:"requiredConfirmation,omitempty"`
	ExecutionResult      map[string]interface{} `json:"executionResult,omitempty"`
}

// AcknowledgeAlertRequest is the payload for acknowledging an alert.
type AcknowledgeAlertRequest struct {
	Actor  string `json:"actor"`
	Reason string `json:"reason,omitempty"`
}

// AddIncidentNoteRequest is the payload for adding a note to an alert.
type AddIncidentNoteRequest struct {
	Author  string `json:"author"`
	Content string `json:"content"`
}

// ConfirmActionRequest is the payload for a human approving/rejecting a pending action challenge.
type ConfirmActionRequest struct {
	ChallengeID string `json:"challengeId"`
	Approved    bool   `json:"approved"`
	Reviewer    string `json:"reviewer"`
}

// ConfirmActionResponse returns the single-use execution token if approved.
type ConfirmActionResponse struct {
	Approved          bool      `json:"approved"`
	ConfirmationToken string    `json:"confirmationToken,omitempty"`
	ExpiresAt         time.Time `json:"expiresAt,omitempty"`
	Message           string    `json:"message"`
}
