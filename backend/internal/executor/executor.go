package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"ops-copilot/backend/internal/alerts"
	"ops-copilot/backend/internal/audit"
	"ops-copilot/backend/internal/guardrail"
	"ops-copilot/backend/internal/models"
	"ops-copilot/backend/internal/registry"
)

var (
	ErrUnknownAction       = errors.New("unsupported or unknown action type")
	ErrControlAPIFailed    = errors.New("service control API returned an error")
	ErrControlAPITimeout   = errors.New("service control API request timed out")
)

// Executor coordinates action dispatch, guardrail validation, and control API communication.
type Executor struct {
	registry    *registry.Registry
	guardrail   *guardrail.Guardrail
	alertEngine *alerts.Engine
	auditLogger *audit.Logger
	httpClient  *http.Client
}

// NewExecutor creates a new action executor.
func NewExecutor(
	reg *registry.Registry,
	guard *guardrail.Guardrail,
	alertEng *alerts.Engine,
	auditLog *audit.Logger,
) *Executor {
	return &Executor{
		registry:    reg,
		guardrail:   guard,
		alertEngine: alertEng,
		auditLogger: auditLog,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

// Execute processes an action request according to its risk tier.
func (e *Executor) Execute(ctx context.Context, req models.ActionExecutionRequest) (*models.ActionExecutionResponse, error) {
	if req.Initiator == "" {
		req.Initiator = "agent"
	}
	if req.Parameters == nil {
		req.Parameters = make(map[string]interface{})
	}

	paramsJSON, _ := json.Marshal(req.Parameters)

	switch req.ActionType {
	case "acknowledge_alert":
		return e.executeAcknowledgeAlert(ctx, req, string(paramsJSON))
	case "add_incident_note":
		return e.executeAddIncidentNote(ctx, req, string(paramsJSON))
	case "restart_service":
		return e.executeRestartService(ctx, req, string(paramsJSON))
	case "scale_service":
		return e.executeScaleService(ctx, req, string(paramsJSON))
	default:
		return nil, ErrUnknownAction
	}
}

// executeAcknowledgeAlert handles the low-risk acknowledge action immediately.
func (e *Executor) executeAcknowledgeAlert(ctx context.Context, req models.ActionExecutionRequest, paramsStr string) (*models.ActionExecutionResponse, error) {
	alertID, ok := req.Parameters["alertId"].(string)
	if !ok || alertID == "" {
		return nil, errors.New("parameter 'alertId' is required")
	}

	reason, _ := req.Parameters["reason"].(string)
	err := e.alertEngine.AcknowledgeAlert(ctx, alertID, req.Initiator, reason)
	if err != nil {
		errMsg := err.Error()
		_ = e.auditLogger.Record(ctx, models.AuditEntry{
			Actor:        req.Initiator,
			ActionType:   req.ActionType,
			ServiceID:    req.ServiceID,
			ServiceName:  req.ServiceID,
			Parameters:   paramsStr,
			ResultStatus: "failed",
			ErrorMessage: &errMsg,
		})
		return nil, err
	}

	_ = e.auditLogger.Record(ctx, models.AuditEntry{
		Actor:        req.Initiator,
		ActionType:   req.ActionType,
		ServiceID:    req.ServiceID,
		ServiceName:  req.ServiceID,
		Parameters:   paramsStr,
		ResultStatus: "success",
	})

	return &models.ActionExecutionResponse{
		Success: true,
		Status:  "executed",
		Message: fmt.Sprintf("Alert %s acknowledged successfully", alertID),
	}, nil
}

// executeAddIncidentNote handles the low-risk note appending action immediately.
func (e *Executor) executeAddIncidentNote(ctx context.Context, req models.ActionExecutionRequest, paramsStr string) (*models.ActionExecutionResponse, error) {
	alertID, ok := req.Parameters["alertId"].(string)
	if !ok || alertID == "" {
		return nil, errors.New("parameter 'alertId' is required")
	}
	content, ok := req.Parameters["content"].(string)
	if !ok || content == "" {
		return nil, errors.New("parameter 'content' is required")
	}

	note, err := e.alertEngine.AddIncidentNote(ctx, alertID, req.Initiator, content)
	if err != nil {
		errMsg := err.Error()
		_ = e.auditLogger.Record(ctx, models.AuditEntry{
			Actor:        req.Initiator,
			ActionType:   req.ActionType,
			ServiceID:    req.ServiceID,
			ServiceName:  req.ServiceID,
			Parameters:   paramsStr,
			ResultStatus: "failed",
			ErrorMessage: &errMsg,
		})
		return nil, err
	}

	_ = e.auditLogger.Record(ctx, models.AuditEntry{
		Actor:        req.Initiator,
		ActionType:   req.ActionType,
		ServiceID:    req.ServiceID,
		ServiceName:  req.ServiceID,
		Parameters:   paramsStr,
		ResultStatus: "success",
	})

	return &models.ActionExecutionResponse{
		Success: true,
		Status:  "executed",
		Message: "Incident note recorded",
		ExecutionResult: map[string]interface{}{
			"noteId": note.ID,
		},
	}, nil
}

// executeRestartService handles high-risk service restart with mandatory confirmation.
func (e *Executor) executeRestartService(ctx context.Context, req models.ActionExecutionRequest, paramsStr string) (*models.ActionExecutionResponse, error) {
	service, err := e.registry.GetService(ctx, req.ServiceID)
	if err != nil {
		return nil, err
	}

	// First call without token -> create challenge and demand human interaction
	if req.ConfirmationToken == "" {
		challenge, err := e.guardrail.CreateChallenge(
			ctx, service.ID, service.Name, req.ActionType,
			req.Parameters, req.Reason, req.Initiator,
		)
		if err != nil {
			return nil, err
		}

		_ = e.auditLogger.Record(ctx, models.AuditEntry{
			Actor:        req.Initiator,
			ActionType:   req.ActionType,
			ServiceID:    service.ID,
			ServiceName:  service.Name,
			Parameters:   paramsStr,
			ResultStatus: "confirmation_required",
		})

		return &models.ActionExecutionResponse{
			Success:              false,
			Status:               "confirmation_required",
			Message:              fmt.Sprintf("Restarting %s is a high-risk action requiring human confirmation", service.Name),
			ChallengeID:          challenge.ChallengeID,
			RequiredConfirmation: challenge,
		}, nil
	}

	// Validate and consume single-use token
	if err := e.guardrail.ValidateAndConsumeToken(ctx, req.ConfirmationToken, req.ServiceID, req.ActionType, req.Parameters); err != nil {
		errMsg := err.Error()
		_ = e.auditLogger.Record(ctx, models.AuditEntry{
			Actor:        req.Initiator,
			ActionType:   req.ActionType,
			ServiceID:    service.ID,
			ServiceName:  service.Name,
			Parameters:   paramsStr,
			ResultStatus: "rejected",
			ErrorMessage: &errMsg,
		})
		return nil, fmt.Errorf("guardrail check failed: %w", err)
	}

	// Serialize execution to prevent race conditions on the same service
	unlock := e.guardrail.AcquireServiceLock(service.ID)
	defer unlock()

	// Call the real service control API (supports both custom REST and Render API)
	controlURL := fmt.Sprintf("%s/restart", service.ControlAPIURL)
	if strings.Contains(service.ControlAPIURL, "api.render.com") {
		controlURL = fmt.Sprintf("%s/deploys", strings.TrimSuffix(service.ControlAPIURL, "/restart"))
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, controlURL, bytes.NewBuffer([]byte(`{}`)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("X-API-Key", service.ControlAPIKey)
	if service.ControlAPIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+service.ControlAPIKey)
	}

	resp, err := e.httpClient.Do(httpReq)
	if err != nil {
		errMsg := fmt.Sprintf("Failed to communicate with control API at %s: %v", controlURL, err)
		_ = e.auditLogger.Record(ctx, models.AuditEntry{
			Actor:        req.Initiator,
			ActionType:   req.ActionType,
			ServiceID:    service.ID,
			ServiceName:  service.Name,
			Parameters:   paramsStr,
			ResultStatus: "failed",
			ErrorMessage: &errMsg,
		})
		return nil, fmt.Errorf("%w: %v", ErrControlAPIFailed, err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errMsg := fmt.Sprintf("Control API returned status %d: %s", resp.StatusCode, string(bodyBytes))
		_ = e.auditLogger.Record(ctx, models.AuditEntry{
			Actor:        req.Initiator,
			ActionType:   req.ActionType,
			ServiceID:    service.ID,
			ServiceName:  service.Name,
			Parameters:   paramsStr,
			ResultStatus: "failed",
			ErrorMessage: &errMsg,
		})
		return nil, fmt.Errorf("%w: HTTP %d %s", ErrControlAPIFailed, resp.StatusCode, string(bodyBytes))
	}

	_ = e.registry.UpdateServiceStatus(ctx, service.ID, "restarting")

	_ = e.auditLogger.Record(ctx, models.AuditEntry{
		Actor:        req.Initiator,
		ActionType:   req.ActionType,
		ServiceID:    service.ID,
		ServiceName:  service.Name,
		Parameters:   paramsStr,
		ResultStatus: "success",
	})

	return &models.ActionExecutionResponse{
		Success: true,
		Status:  "executed",
		Message: fmt.Sprintf("Service %s restart initiated successfully", service.Name),
		ExecutionResult: map[string]interface{}{
			"serviceId":   service.ID,
			"serviceName": service.Name,
			"action":      "restart",
			"timestamp":   time.Now().UTC().Format(time.RFC3339),
		},
	}, nil
}

// executeScaleService handles high-risk replica scaling with mandatory confirmation.
func (e *Executor) executeScaleService(ctx context.Context, req models.ActionExecutionRequest, paramsStr string) (*models.ActionExecutionResponse, error) {
	service, err := e.registry.GetService(ctx, req.ServiceID)
	if err != nil {
		return nil, err
	}

	rawReplicas, ok := req.Parameters["replicas"]
	if !ok {
		return nil, errors.New("parameter 'replicas' is required")
	}

	var targetReplicas int
	switch v := rawReplicas.(type) {
	case float64:
		targetReplicas = int(v)
	case int:
		targetReplicas = v
	default:
		return nil, errors.New("invalid 'replicas' parameter type")
	}

	if targetReplicas < service.MinReplicas || targetReplicas > service.MaxReplicas {
		return nil, fmt.Errorf("target replicas %d is outside allowed range [%d - %d]", targetReplicas, service.MinReplicas, service.MaxReplicas)
	}

	// First call without token -> create challenge
	if req.ConfirmationToken == "" {
		challenge, err := e.guardrail.CreateChallenge(
			ctx, service.ID, service.Name, req.ActionType,
			req.Parameters, req.Reason, req.Initiator,
		)
		if err != nil {
			return nil, err
		}

		_ = e.auditLogger.Record(ctx, models.AuditEntry{
			Actor:        req.Initiator,
			ActionType:   req.ActionType,
			ServiceID:    service.ID,
			ServiceName:  service.Name,
			Parameters:   paramsStr,
			ResultStatus: "confirmation_required",
		})

		return &models.ActionExecutionResponse{
			Success:              false,
			Status:               "confirmation_required",
			Message:              fmt.Sprintf("Scaling %s to %d replicas requires human confirmation", service.Name, targetReplicas),
			ChallengeID:          challenge.ChallengeID,
			RequiredConfirmation: challenge,
		}, nil
	}

	// Validate and consume single-use token
	if err := e.guardrail.ValidateAndConsumeToken(ctx, req.ConfirmationToken, req.ServiceID, req.ActionType, req.Parameters); err != nil {
		errMsg := err.Error()
		_ = e.auditLogger.Record(ctx, models.AuditEntry{
			Actor:        req.Initiator,
			ActionType:   req.ActionType,
			ServiceID:    service.ID,
			ServiceName:  service.Name,
			Parameters:   paramsStr,
			ResultStatus: "rejected",
			ErrorMessage: &errMsg,
		})
		return nil, fmt.Errorf("guardrail check failed: %w", err)
	}

	unlock := e.guardrail.AcquireServiceLock(service.ID)
	defer unlock()

	// Call the real service control API
	controlURL := fmt.Sprintf("%s/scale", service.ControlAPIURL)
	payload, _ := json.Marshal(map[string]int{"replicas": targetReplicas, "numInstances": targetReplicas})
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, controlURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("X-API-Key", service.ControlAPIKey)
	if service.ControlAPIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+service.ControlAPIKey)
	}

	resp, err := e.httpClient.Do(httpReq)
	if err != nil {
		errMsg := fmt.Sprintf("Failed to communicate with scale API at %s: %v", controlURL, err)
		_ = e.auditLogger.Record(ctx, models.AuditEntry{
			Actor:        req.Initiator,
			ActionType:   req.ActionType,
			ServiceID:    service.ID,
			ServiceName:  service.Name,
			Parameters:   paramsStr,
			ResultStatus: "failed",
			ErrorMessage: &errMsg,
		})
		return nil, fmt.Errorf("%w: %v", ErrControlAPIFailed, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		errMsg := fmt.Sprintf("Scale API returned status %d: %s", resp.StatusCode, string(bodyBytes))
		_ = e.auditLogger.Record(ctx, models.AuditEntry{
			Actor:        req.Initiator,
			ActionType:   req.ActionType,
			ServiceID:    service.ID,
			ServiceName:  service.Name,
			Parameters:   paramsStr,
			ResultStatus: "failed",
			ErrorMessage: &errMsg,
		})
		return nil, fmt.Errorf("%w: HTTP %d %s", ErrControlAPIFailed, resp.StatusCode, string(bodyBytes))
	}

	_ = e.registry.UpdateServiceReplicas(ctx, service.ID, targetReplicas)

	_ = e.auditLogger.Record(ctx, models.AuditEntry{
		Actor:        req.Initiator,
		ActionType:   req.ActionType,
		ServiceID:    service.ID,
		ServiceName:  service.Name,
		Parameters:   paramsStr,
		ResultStatus: "success",
	})

	return &models.ActionExecutionResponse{
		Success: true,
		Status:  "executed",
		Message: fmt.Sprintf("Service %s scaled to %d replicas", service.Name, targetReplicas),
		ExecutionResult: map[string]interface{}{
			"serviceId":      service.ID,
			"targetReplicas": targetReplicas,
		},
	}, nil
}
