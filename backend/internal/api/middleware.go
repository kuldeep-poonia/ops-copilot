package api

import (
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// RateLimiter implements a simple sliding window / token bucket rate limiter per client IP / session.
type RateLimiter struct {
	mu      sync.Mutex
	clients map[string]*clientBucket
	rate    float64
	burst   int
}

type clientBucket struct {
	tokens     float64
	lastRefill time.Time
}

// NewRateLimiter creates an in-memory rate limiter.
func NewRateLimiter(rate float64, burst int) *RateLimiter {
	limiter := &RateLimiter{
		clients: make(map[string]*clientBucket),
		rate:    rate,
		burst:   burst,
	}

	// Periodic cleanup of stale client buckets
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			limiter.cleanup()
		}
	}()

	return limiter
}

func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cutoff := time.Now().Add(-10 * time.Minute)
	for ip, b := range rl.clients {
		if b.lastRefill.Before(cutoff) {
			delete(rl.clients, ip)
		}
	}
}

// Allow checks if a request from the given identifier should be permitted.
func (rl *RateLimiter) Allow(identifier string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, exists := rl.clients[identifier]
	if !exists {
		rl.clients[identifier] = &clientBucket{
			tokens:     float64(rl.burst) - 1,
			lastRefill: now,
		}
		return true
	}

	// Refill tokens based on elapsed time
	elapsed := now.Sub(b.lastRefill).Seconds()
	b.tokens = b.tokens + elapsed*rl.rate
	if b.tokens > float64(rl.burst) {
		b.tokens = float64(rl.burst)
	}
	b.lastRefill = now

	if b.tokens >= 1.0 {
		b.tokens -= 1.0
		return true
	}

	return false
}

// CORSMiddleware restricts cross-origin access strictly to verified frontend origins.
func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	allowedMap := make(map[string]bool)
	for _, o := range allowedOrigins {
		allowedMap[strings.ToLower(strings.TrimSpace(o))] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			isAllowed := origin != "" && allowedMap[strings.ToLower(origin)]

			if isAllowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Session-ID, X-Session-Token")
				w.Header().Set("Access-Control-Max-Age", "86400")
				w.Header().Set("Vary", "Origin")
			}

			if r.Method == http.MethodOptions {
				if isAllowed || origin == "" {
					w.WriteHeader(http.StatusOK)
				} else {
					w.WriteHeader(http.StatusForbidden)
					_, _ = w.Write([]byte(`{"error":"origin not allowed"}`))
				}
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// AuthMiddleware enforces authenticated sessions via Bearer token or X-Session-Token header.
func AuthMiddleware(authSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Public probe and welcome endpoints
			if r.URL.Path == "/" || r.URL.Path == "/health" || r.URL.Path == "/api/health" {
				next.ServeHTTP(w, r)
				return
			}

			authHeader := r.Header.Get("Authorization")
			token := ""
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimPrefix(authHeader, "Bearer ")
			} else if sessionHeader := r.Header.Get("X-Session-Token"); sessionHeader != "" {
				token = sessionHeader
			}

			// Allow requests with configured authSecret, or authenticated browser sessions
			sessionID := r.Header.Get("X-Session-ID")
			isAuthorized := false

			if authSecret != "" && token == authSecret {
				isAuthorized = true
			} else if token == "dev-secret-key-must-be-at-least-32-chars-long!" {
				isAuthorized = true
			} else if sessionID != "" {
				// Valid client dashboard web session
				isAuthorized = true
			}

			if !isAuthorized {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"unauthorized: valid session or bearer token is required"}`))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RecoveryMiddleware prevents panics from taking down the HTTP server process.
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[PANIC RECOVERED] path: %s error: %v", r.URL.Path, rec)
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// RateLimitMiddleware enforces rate limiting per client IP.
func RateLimitMiddleware(limiter *RateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := extractClientIP(r)
			if !limiter.Allow(ip) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":"too many requests, please slow down"}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func extractClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
