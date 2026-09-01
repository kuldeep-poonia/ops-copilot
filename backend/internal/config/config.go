package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config holds all validated configuration parameters required for running the backend service.
type Config struct {
	Port                 int
	Environment          string
	DatabasePath         string
	AuthSecret           string
	TokenTTL             time.Duration
	RateLimitRPS         float64
	RateLimitBurst       int
	ActionRateLimit      int
	PaymentServiceKey    string
	AuthServiceKey       string
	InventoryKey         string
	AllowedOrigins       []string
	RenderAPIKey         string
	RenderServiceID      string
	MonitoredServiceURL  string
	MonitoredServiceName string
}

// loadDotEnv parses a local .env file if present, populating process environment variables.
func loadDotEnv() {
	candidates := []string{".env", "../.env", "../../.env"}
	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "#") {
					continue
				}
				parts := strings.SplitN(line, "=", 2)
				if len(parts) == 2 {
					key := strings.TrimSpace(parts[0])
					val := strings.TrimSpace(parts[1])
					val = strings.Trim(val, `"'`)
					if os.Getenv(key) == "" {
						_ = os.Setenv(key, val)
					}
				}
			}
			return
		}
	}
}

// Load reads and strictly validates configuration from the environment.
// It fails fast if any required setting is missing or invalid.
func Load() (*Config, error) {
	// Auto-load .env if present in local workspace
	loadDotEnv()

	portStr := os.Getenv("PORT")
	if portStr == "" {
		portStr = getEnvOrDefault("OPS_COPILOT_PORT", "8080")
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return nil, fmt.Errorf("invalid port %q: must be a valid port between 1 and 65535", portStr)
	}

	env := strings.ToLower(getEnvOrDefault("OPS_COPILOT_ENV", "development"))
	if env != "development" && env != "staging" && env != "production" && env != "test" {
		return nil, fmt.Errorf("invalid OPS_COPILOT_ENV %q: must be development, staging, production, or test", env)
	}

	dbPath := getEnvOrDefault("OPS_COPILOT_DB_PATH", "./data/opscopilot.db")
	if strings.TrimSpace(dbPath) == "" {
		return nil, errors.New("OPS_COPILOT_DB_PATH cannot be empty")
	}

	authSecret := os.Getenv("OPS_COPILOT_AUTH_SECRET")
	if authSecret == "" {
		if env == "production" {
			return nil, errors.New("OPS_COPILOT_AUTH_SECRET is required in production environment")
		}
		// Provide a default secret for local development only
		authSecret = "dev-secret-key-must-be-at-least-32-chars-long!"
	}
	if len(authSecret) < 32 {
		return nil, fmt.Errorf("OPS_COPILOT_AUTH_SECRET must be at least 32 characters long for security, got %d", len(authSecret))
	}

	ttlSecondsStr := getEnvOrDefault("OPS_COPILOT_TOKEN_TTL_SECONDS", "60")
	ttlSeconds, err := strconv.Atoi(ttlSecondsStr)
	if err != nil || ttlSeconds < 5 || ttlSeconds > 600 {
		return nil, fmt.Errorf("invalid OPS_COPILOT_TOKEN_TTL_SECONDS %q: must be between 5 and 600 seconds", ttlSecondsStr)
	}

	rpsStr := getEnvOrDefault("OPS_COPILOT_RATE_LIMIT_RPS", "20")
	rps, err := strconv.ParseFloat(rpsStr, 64)
	if err != nil || rps <= 0 {
		return nil, fmt.Errorf("invalid OPS_COPILOT_RATE_LIMIT_RPS %q: must be positive float", rpsStr)
	}

	burstStr := getEnvOrDefault("OPS_COPILOT_RATE_LIMIT_BURST", "40")
	burst, err := strconv.Atoi(burstStr)
	if err != nil || burst < 1 {
		return nil, fmt.Errorf("invalid OPS_COPILOT_RATE_LIMIT_BURST %q: must be positive integer", burstStr)
	}

	actionLimitStr := getEnvOrDefault("OPS_COPILOT_ACTION_RATE_LIMIT", "10")
	actionLimit, err := strconv.Atoi(actionLimitStr)
	if err != nil || actionLimit < 1 {
		return nil, fmt.Errorf("invalid OPS_COPILOT_ACTION_RATE_LIMIT %q: must be positive integer", actionLimitStr)
	}

	// Ensure the parent directory for database file exists
	dbDir := filepath.Dir(dbPath)
	if dbDir != "." && dbDir != "" {
		if err := os.MkdirAll(dbDir, 0750); err != nil {
			return nil, fmt.Errorf("failed to create directory for database at %q: %w", dbDir, err)
		}
	}

	originsRaw := getEnvOrDefault("OPS_COPILOT_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080")
	var allowedOrigins []string
	for _, orig := range strings.Split(originsRaw, ",") {
		if trimmed := strings.TrimSpace(orig); trimmed != "" {
			allowedOrigins = append(allowedOrigins, trimmed)
		}
	}

	cfg := &Config{
		Port:                 port,
		Environment:          env,
		DatabasePath:         dbPath,
		AuthSecret:           authSecret,
		TokenTTL:             time.Duration(ttlSeconds) * time.Second,
		RateLimitRPS:         rps,
		RateLimitBurst:       burst,
		ActionRateLimit:      actionLimit,
		PaymentServiceKey:    getEnvOrDefault("OPS_COPILOT_SERVICE_PAYMENT_API_KEY", "dev-payment-key"),
		AuthServiceKey:       getEnvOrDefault("OPS_COPILOT_SERVICE_AUTH_API_KEY", "dev-auth-key"),
		InventoryKey:         getEnvOrDefault("OPS_COPILOT_SERVICE_INVENTORY_API_KEY", "dev-inventory-key"),
		AllowedOrigins:       allowedOrigins,
		RenderAPIKey:         getEnvOrDefault("RENDER_API_KEY", "rnd_KxuVZhRnLMCHZgEJcnSa1dUc9OJE"),
		RenderServiceID:      resolveMonitoredServiceID(),
		MonitoredServiceURL:  getEnvOrDefault("MONITORED_SERVICE_URL", "https://social-mcp.duckdns.org"),
		MonitoredServiceName: getEnvOrDefault("MONITORED_SERVICE_NAME", "Social Publishing MCP Server"),
	}

	return cfg, nil
}

func resolveMonitoredServiceID() string {
	// If explicitly set via OPS_COPILOT_MONITORED_RENDER_SERVICE_ID or MONITORED_RENDER_SERVICE_ID
	for _, key := range []string{"OPS_COPILOT_MONITORED_RENDER_SERVICE_ID", "MONITORED_RENDER_SERVICE_ID"} {
		if val := strings.TrimSpace(os.Getenv(key)); val != "" {
			return val
		}
	}
	val := strings.TrimSpace(os.Getenv("RENDER_SERVICE_ID"))
	// On Render, RENDER_SERVICE_ID is auto-set to the hosting app itself (srv-daamgkon74is73bduu30).
	// If it matches that or is empty, use the monitored service srv-da76eg0ae00c73ar5vr0.
	if val == "" || val == "srv-daamgkon74is73bduu30" {
		return "srv-da76eg0ae00c73ar5vr0"
	}
	return val
}

func getEnvOrDefault(key, fallback string) string {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	return val
}
