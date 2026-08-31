package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"ops-copilot/backend/internal/alerts"
	"ops-copilot/backend/internal/audit"
	"ops-copilot/backend/internal/guardrail"
	"ops-copilot/backend/internal/executor"
	"ops-copilot/backend/internal/metrics"
	"ops-copilot/backend/internal/models"
	"ops-copilot/backend/internal/registry"
)

// Handler contains all dependencies for servicing HTTP API requests.
type Handler struct {
	registry       *registry.Registry
	metricsAdapter metrics.MetricsSource
	alertEngine    *alerts.Engine
	auditLogger    *audit.Logger
	guardrail      *guardrail.Guardrail
	executor       *executor.Executor
}

// NewHandler creates a new HTTP request handler instance.
func NewHandler(
	reg *registry.Registry,
	adapter metrics.MetricsSource,
	alertEng *alerts.Engine,
	auditLog *audit.Logger,
	guard *guardrail.Guardrail,
	exec *executor.Executor,
) *Handler {
	return &Handler{
		registry:       reg,
		metricsAdapter: adapter,
		alertEngine:    alertEng,
		auditLogger:    auditLog,
		guardrail:      guard,
		executor:       exec,
	}
}

// ListServices handles GET /api/services.
func (h *Handler) ListServices(w http.ResponseWriter, r *http.Request) {
	services, err := h.registry.ListServices(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to list services")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"services": services})
}

// RegisterService handles POST /api/services.
func (h *Handler) RegisterService(w http.ResponseWriter, r *http.Request) {
	var s models.Service
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.registry.RegisterService(r.Context(), s); err != nil {
		if errors.Is(err, registry.ErrInvalidService) {
			writeJSONError(w, http.StatusBadRequest, "invalid service parameters: id, name, and endpoint_url are required")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "failed to register service")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"status":  "registered",
		"service": s,
	})
}

// DeleteService handles DELETE /api/services/{id}.
func (h *Handler) DeleteService(w http.ResponseWriter, r *http.Request, serviceID string) {
	if err := h.registry.DeleteService(r.Context(), serviceID); err != nil {
		if errors.Is(err, registry.ErrServiceNotFound) {
			writeJSONError(w, http.StatusNotFound, "service not found")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "failed to delete service")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":    "deleted",
		"serviceId": serviceID,
	})
}

// GetServiceHealth handles GET /api/services/{id}/health.
func (h *Handler) GetServiceHealth(w http.ResponseWriter, r *http.Request) {
	serviceID := extractPathParam(r.URL.Path, "/api/services/", "/health")
	if serviceID == "" {
		writeJSONError(w, http.StatusBadRequest, "service ID is required")
		return
	}

	service, err := h.registry.GetService(r.Context(), serviceID)
	if errors.Is(err, registry.ErrServiceNotFound) {
		writeJSONError(w, http.StatusNotFound, fmt.Sprintf("service %q not found", serviceID))
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to query service registry")
		return
	}

	health, err := h.metricsAdapter.GetServiceHealth(r.Context(), service)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to collect health metrics")
		return
	}

	// Evaluate alert rules against latest metrics
	activeAlertsList, _ := h.alertEngine.EvaluateHealth(r.Context(), health)
	health.ActiveAlerts = len(activeAlertsList)

	// Keep registry status synchronized
	_ = h.registry.UpdateServiceStatus(r.Context(), service.ID, string(health.Status))

	writeJSON(w, http.StatusOK, health)
}

// ListAlerts handles GET /api/alerts.
func (h *Handler) ListAlerts(w http.ResponseWriter, r *http.Request) {
	serviceID := r.URL.Query().Get("serviceId")
	status := r.URL.Query().Get("status")

	alertsList, err := h.alertEngine.ListAlerts(r.Context(), serviceID, status)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to list alerts")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"alerts": alertsList})
}

// AcknowledgeAlert handles POST /api/alerts/{id}/acknowledge.
func (h *Handler) AcknowledgeAlert(w http.ResponseWriter, r *http.Request) {
	alertID := extractPathParam(r.URL.Path, "/api/alerts/", "/acknowledge")
	if alertID == "" {
		writeJSONError(w, http.StatusBadRequest, "alert ID is required")
		return
	}

	var req models.AcknowledgeAlertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Empty body is allowed, defaults used
		req.Actor = "operator"
	}
	if req.Actor == "" {
		req.Actor = "operator"
	}

	execReq := models.ActionExecutionRequest{
		ActionType: "acknowledge_alert",
		Initiator:  req.Actor,
		Parameters: map[string]interface{}{
			"alertId": alertID,
			"reason":  req.Reason,
		},
	}

	resp, err := h.executor.Execute(r.Context(), execReq)
	if errors.Is(err, alerts.ErrAlertNotFound) {
		writeJSONError(w, http.StatusNotFound, "alert not found")
		return
	}
	if errors.Is(err, alerts.ErrAlertAlreadyResolved) {
		writeJSONError(w, http.StatusConflict, "cannot acknowledge resolved alert")
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// AddIncidentNote handles POST /api/alerts/{id}/notes.
func (h *Handler) AddIncidentNote(w http.ResponseWriter, r *http.Request) {
	alertID := extractPathParam(r.URL.Path, "/api/alerts/", "/notes")
	if alertID == "" {
		writeJSONError(w, http.StatusBadRequest, "alert ID is required")
		return
	}

	var req models.AddIncidentNoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeJSONError(w, http.StatusBadRequest, "note content cannot be empty")
		return
	}

	execReq := models.ActionExecutionRequest{
		ActionType: "add_incident_note",
		Initiator:  req.Author,
		Parameters: map[string]interface{}{
			"alertId": alertID,
			"content": req.Content,
		},
	}

	resp, err := h.executor.Execute(r.Context(), execReq)
	if errors.Is(err, alerts.ErrAlertNotFound) {
		writeJSONError(w, http.StatusNotFound, "alert not found")
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, resp)
}

// ListAuditLogs handles GET /api/audit-log.
func (h *Handler) ListAuditLogs(w http.ResponseWriter, r *http.Request) {
	serviceID := r.URL.Query().Get("serviceId")
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)

	entries, total, err := h.auditLogger.ListEntries(r.Context(), serviceID, limit, offset)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to query audit logs")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"entries": entries,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}

// GetChallenge handles GET /api/challenges/{id}.
func (h *Handler) GetChallenge(w http.ResponseWriter, r *http.Request) {
	challengeID := strings.TrimPrefix(r.URL.Path, "/api/challenges/")
	if challengeID == "" {
		writeJSONError(w, http.StatusBadRequest, "challenge ID is required")
		return
	}

	challenge, err := h.guardrail.GetChallenge(r.Context(), challengeID)
	if errors.Is(err, guardrail.ErrChallengeNotFound) {
		writeJSONError(w, http.StatusNotFound, "challenge not found")
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to get challenge")
		return
	}

	writeJSON(w, http.StatusOK, challenge)
}

// ReviewChallenge handles POST /api/challenges/{id}/review.
func (h *Handler) ReviewChallenge(w http.ResponseWriter, r *http.Request) {
	challengeID := extractPathParam(r.URL.Path, "/api/challenges/", "/review")
	if challengeID == "" {
		writeJSONError(w, http.StatusBadRequest, "challenge ID is required")
		return
	}

	var req models.ConfirmActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	token, expiresAt, err := h.guardrail.ReviewChallenge(r.Context(), challengeID, req.Approved)
	if errors.Is(err, guardrail.ErrChallengeNotFound) {
		writeJSONError(w, http.StatusNotFound, "challenge not found")
		return
	}
	if errors.Is(err, guardrail.ErrChallengeExpired) {
		writeJSONError(w, http.StatusGone, "challenge has expired")
		return
	}
	if errors.Is(err, guardrail.ErrChallengeNotPending) {
		writeJSONError(w, http.StatusConflict, "challenge has already been reviewed")
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if !req.Approved {
		writeJSON(w, http.StatusOK, models.ConfirmActionResponse{
			Approved: false,
			Message:  "Action rejected by human operator",
		})
		return
	}

	writeJSON(w, http.StatusOK, models.ConfirmActionResponse{
		Approved:          true,
		ConfirmationToken: token,
		ExpiresAt:         expiresAt,
		Message:           "Action approved. Single-use execution token issued.",
	})
}

// ExecuteAction handles POST /api/actions/execute.
func (h *Handler) ExecuteAction(w http.ResponseWriter, r *http.Request) {
	var req models.ActionExecutionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}

	if strings.TrimSpace(req.ActionType) == "" {
		writeJSONError(w, http.StatusBadRequest, "field 'actionType' is required")
		return
	}
	if strings.TrimSpace(req.ServiceID) == "" && req.ActionType != "acknowledge_alert" && req.ActionType != "add_incident_note" {
		writeJSONError(w, http.StatusBadRequest, "field 'serviceId' is required")
		return
	}

	resp, err := h.executor.Execute(r.Context(), req)
	if errors.Is(err, registry.ErrServiceNotFound) {
		writeJSONError(w, http.StatusNotFound, "service not found")
		return
	}
	if errors.Is(err, guardrail.ErrTokenAlreadyUsed) {
		writeJSONError(w, http.StatusConflict, "confirmation token was already used")
		return
	}
	if errors.Is(err, guardrail.ErrTokenExpired) {
		writeJSONError(w, http.StatusGone, "confirmation token has expired")
		return
	}
	if errors.Is(err, guardrail.ErrTokenInvalid) || errors.Is(err, guardrail.ErrTokenScopeMismatch) {
		writeJSONError(w, http.StatusForbidden, "invalid confirmation token or parameter scope mismatch")
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if resp.Status == "confirmation_required" {
		writeJSON(w, http.StatusPreconditionRequired, resp)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// SelfHealth handles GET /api/health for ops-copilot health check.
func (h *Handler) SelfHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":    "healthy",
		"service":   "ops-copilot-backend",
		"timestamp": timeNow(),
	})
}

func extractPathParam(path, prefix, suffix string) string {
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	trimmed := strings.TrimPrefix(path, prefix)
	if suffix != "" && strings.HasSuffix(trimmed, suffix) {
		trimmed = strings.TrimSuffix(trimmed, suffix)
	}
	return trimmed
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func timeNow() string {
	return strconv.FormatInt(1000, 10)
}
