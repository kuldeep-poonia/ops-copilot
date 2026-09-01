package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"ops-copilot/backend/internal/alerts"
	"ops-copilot/backend/internal/api"
	"ops-copilot/backend/internal/audit"
	"ops-copilot/backend/internal/config"
	"ops-copilot/backend/internal/database"
	"ops-copilot/backend/internal/executor"
	"ops-copilot/backend/internal/guardrail"
	"ops-copilot/backend/internal/metrics"
	"ops-copilot/backend/internal/models"
	"ops-copilot/backend/internal/registry"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Fatal configuration error: %v", err)
	}

	db, err := database.Connect(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("Fatal database connection error: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	reg := registry.NewRegistry(db)
	if cfg.MonitoredServiceURL != "" {
		serviceID := "srv-da76eg0ae00c73ar5vr0"
		if cfg.RenderServiceID != "" {
			serviceID = cfg.RenderServiceID
		}
		controlURL := fmt.Sprintf("https://api.render.com/v1/services/%s", serviceID)
		name := cfg.MonitoredServiceName
		if name == "" {
			name = "Social Publishing MCP Server"
		}
		// Clean up any legacy self-referencing entries in SQLite DB
		_, _ = db.ExecContext(ctx, "DELETE FROM services WHERE id = 'srv-daamgkon74is73bduu30' OR id = 'default'")

		err := reg.RegisterService(ctx, models.Service{
			ID:            serviceID,
			Name:          name,
			Description:   fmt.Sprintf("Live monitored service deployed on %s", cfg.MonitoredServiceURL),
			EndpointURL:   strings.TrimSuffix(cfg.MonitoredServiceURL, "/") + "/metrics",
			ControlAPIURL: controlURL,
			ControlAPIKey: cfg.RenderAPIKey,
			CurrentStatus: "healthy",
			Replicas:      1,
			MinReplicas:   1,
			MaxReplicas:   5,
		})
		if err != nil {
			log.Printf("Warning: failed to auto-register monitored service: %v", err)
		} else {
			log.Printf("Successfully registered monitored service %q (%s)", name, serviceID)
		}
	}

	metricsAdapter := metrics.NewHTTPCollector()
	alertEngine := alerts.NewEngine(db)
	auditLogger := audit.NewLogger(db)
	guard := guardrail.NewGuardrail(db, cfg.TokenTTL)
	exec := executor.NewExecutor(reg, guard, alertEngine, auditLogger)

	handler := api.NewHandler(reg, metricsAdapter, alertEngine, auditLogger, guard, exec)
	server := api.NewServer(cfg, handler)

	// Channel to catch OS shutdown signals
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("Ops Co-pilot server listening on port %d (%s mode)...", cfg.Port, cfg.Environment)
		if err := server.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	<-stop
	log.Println("Shutting down Ops Co-pilot server gracefully...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("Graceful shutdown encountered error: %v", err)
	}
	log.Println("Ops Co-pilot backend stopped.")
}
