package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
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
	if err := reg.SeedDefaultServices(ctx); err != nil {
		log.Fatalf("Failed to initialize service registry seeds: %v", err)
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
