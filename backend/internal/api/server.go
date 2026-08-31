package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"ops-copilot/backend/internal/config"
)

// Server wraps the HTTP server and router.
type Server struct {
	httpServer  *http.Server
	handler     *Handler
	rateLimiter *RateLimiter
}

// NewServer constructs the HTTP server with configured middleware and routes.
func NewServer(cfg *config.Config, handler *Handler) *Server {
	limiter := NewRateLimiter(cfg.RateLimitRPS, cfg.RateLimitBurst)
	mux := http.NewServeMux()

	s := &Server{
		handler:     handler,
		rateLimiter: limiter,
	}

	// Register API routes
	mux.HandleFunc("/", s.handleRoot)
	mux.HandleFunc("/health", s.handleSelfHealth)
	mux.HandleFunc("/api/health", s.handleSelfHealth)
	mux.HandleFunc("/api/services", s.handleServices)
	mux.HandleFunc("/api/services/", s.handleServiceRoute)
	mux.HandleFunc("/api/alerts", s.handleAlerts)
	mux.HandleFunc("/api/alerts/", s.handleAlertRoute)
	mux.HandleFunc("/api/audit-log", s.handleAuditLog)
	mux.HandleFunc("/api/challenges/", s.handleChallengeRoute)
	mux.HandleFunc("/api/actions/execute", s.handleActionExecute)

	// Apply middleware stack: Recovery -> CORS -> Rate Limiting -> Auth Session Verification
	handlerChain := RecoveryMiddleware(CORSMiddleware(cfg.AllowedOrigins)(RateLimitMiddleware(limiter)(AuthMiddleware(cfg.AuthSecret)(mux))))

	s.httpServer = &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           handlerChain,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	return s
}

// Start runs the HTTP server listening on the configured port.
func (s *Server) Start() error {
	return s.httpServer.ListenAndServe()
}

// Shutdown initiates a graceful shutdown of the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		writeJSONError(w, http.StatusNotFound, "endpoint not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"service":   "Ops Co-pilot Backend API",
		"status":    "healthy",
		"version":   "1.0.0",
		"endpoints": map[string]string{
			"health":    "/api/health",
			"services":  "/api/services",
			"alerts":    "/api/alerts",
			"auditLog":  "/api/audit-log",
			"actions":   "/api/actions/execute",
		},
		"message": "Protected API endpoints require Authorization: Bearer <token>",
	})
}

func (s *Server) handleSelfHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.handler.SelfHealth(w, r)
}

func (s *Server) handleServices(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handler.ListServices(w, r)
	case http.MethodPost:
		s.handler.RegisterService(w, r)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleServiceRoute(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/health") && r.Method == http.MethodGet {
		s.handler.GetServiceHealth(w, r)
		return
	}
	if r.Method == http.MethodDelete {
		serviceID := strings.TrimPrefix(r.URL.Path, "/api/services/")
		serviceID = strings.Trim(serviceID, "/")
		if serviceID != "" {
			s.handler.DeleteService(w, r, serviceID)
			return
		}
	}
	writeJSONError(w, http.StatusNotFound, "endpoint not found")
}

func (s *Server) handleAlerts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.handler.ListAlerts(w, r)
}

func (s *Server) handleAlertRoute(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/acknowledge") && r.Method == http.MethodPost {
		s.handler.AcknowledgeAlert(w, r)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/notes") && r.Method == http.MethodPost {
		s.handler.AddIncidentNote(w, r)
		return
	}
	writeJSONError(w, http.StatusNotFound, "endpoint not found")
}

func (s *Server) handleAuditLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.handler.ListAuditLogs(w, r)
}

func (s *Server) handleChallengeRoute(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/review") && r.Method == http.MethodPost {
		s.handler.ReviewChallenge(w, r)
		return
	}
	if r.Method == http.MethodGet {
		s.handler.GetChallenge(w, r)
		return
	}
	writeJSONError(w, http.StatusNotFound, "endpoint not found")
}

func (s *Server) handleActionExecute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.handler.ExecuteAction(w, r)
}
