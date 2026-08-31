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
	Port              int
	Environment       string
	DatabasePath      string
	AuthSecret        string
	TokenTTL          time.Duration
	RateLimitRPS      float64
	RateLimitBurst    int
	ActionRateLimit   int
	PaymentServiceKey string
	AuthServiceKey    string
	InventoryKey      string
	AllowedOrigins    []string
}

// Load reads and strictly validates configuration from the environment.
// It fails fast if any required setting is missing or invalid.
func Load() (*Config, error) {
	portStr := getEnvOrDefault("OPS_COPILOT_PORT", "8080")
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return nil, fmt.Errorf("invalid OPS_COPILOT_PORT %q: must be a valid port between 1 and 65535", portStr)
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
		Port:              port,
		Environment:       env,
		DatabasePath:      dbPath,
		AuthSecret:        authSecret,
		TokenTTL:          time.Duration(ttlSeconds) * time.Second,
		RateLimitRPS:      rps,
		RateLimitBurst:    burst,
		ActionRateLimit:   actionLimit,
		PaymentServiceKey: getEnvOrDefault("OPS_COPILOT_SERVICE_PAYMENT_API_KEY", "dev-payment-key"),
		AuthServiceKey:    getEnvOrDefault("OPS_COPILOT_SERVICE_AUTH_API_KEY", "dev-auth-key"),
		InventoryKey:      getEnvOrDefault("OPS_COPILOT_SERVICE_INVENTORY_API_KEY", "dev-inventory-key"),
		AllowedOrigins:    allowedOrigins,
	}

	return cfg, nil
}

func getEnvOrDefault(key, fallback string) string {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	return val
}
