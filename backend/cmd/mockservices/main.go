package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"
)

type MonitoredService struct {
	ID          string
	Name        string
	Port        int
	APIKey      string
	mu          sync.Mutex
	startTime   time.Time
	replicas    int
	status      string
	errorRate   float64
	cpuBase     float64
	memBase     float64
	restarting  bool
}

func newService(id, name string, port int, apiKey string, replicas int, cpuBase, memBase, errorRate float64) *MonitoredService {
	return &MonitoredService{
		ID:        id,
		Name:      name,
		Port:      port,
		APIKey:    apiKey,
		startTime: time.Now().Add(-time.Duration(rand.Intn(72)+1) * time.Hour),
		replicas:  replicas,
		status:    "healthy",
		errorRate: errorRate,
		cpuBase:   cpuBase,
		memBase:   memBase,
	}
}

func (s *MonitoredService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	w.Header().Set("Access-Control-Allow-Methods", "*")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.URL.Path {
	case "/metrics", "/health":
		s.handleMetrics(w, r)
	case "/control/restart":
		s.handleRestart(w, r)
	case "/control/scale":
		s.handleScale(w, r)
	case "/chaos/spike":
		s.handleChaos(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *MonitoredService) handleMetrics(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	uptime := int64(time.Since(s.startTime).Seconds())

	// Add minor realistic jitter around baseline
	jitter := (rand.Float64() - 0.5) * 4.0
	cpu := s.cpuBase + jitter
	if cpu < 5.0 {
		cpu = 5.0
	}
	if cpu > 99.0 {
		cpu = 99.0
	}

	memJitter := (rand.Float64() - 0.5) * 2.0
	mem := s.memBase + memJitter
	if mem < 10.0 {
		mem = 10.0
	}
	if mem > 99.0 {
		mem = 99.0
	}

	errRate := s.errorRate
	if errRate < 0.05 {
		errRate = rand.Float64() * 0.15
	}

	currentStatus := s.status
	if s.restarting {
		currentStatus = "restarting"
		cpu = 15.0
		errRate = 0.0
	}

	payload := map[string]interface{}{
		"service":      s.ID,
		"status":       currentStatus,
		"cpu_percent":  cpu,
		"memory_usage": mem,
		"error_rate":   errRate,
		"uptime_sec":   uptime,
		"replicas":     s.replicas,
	}

	_ = json.NewEncoder(w).Encode(payload)
}

func (s *MonitoredService) handleRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"POST required"}`, http.StatusMethodNotAllowed)
		return
	}

	key := r.Header.Get("X-API-Key")
	if key != s.APIKey {
		http.Error(w, `{"error":"invalid API key"}`, http.StatusUnauthorized)
		return
	}

	s.mu.Lock()
	s.restarting = true
	s.errorRate = 0.02
	s.mu.Unlock()

	// Simulate brief restart delay then restore clean state
	go func() {
		time.Sleep(2 * time.Second)
		s.mu.Lock()
		s.restarting = false
		s.startTime = time.Now()
		s.status = "healthy"
		s.mu.Unlock()
	}()

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "restarting",
		"service":   s.ID,
		"message":   "Graceful restart initiated",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *MonitoredService) handleScale(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"POST required"}`, http.StatusMethodNotAllowed)
		return
	}

	key := r.Header.Get("X-API-Key")
	if key != s.APIKey {
		http.Error(w, `{"error":"invalid API key"}`, http.StatusUnauthorized)
		return
	}

	var req struct {
		Replicas int `json:"replicas"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Replicas < 1 {
		http.Error(w, `{"error":"invalid replica count"}`, http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	s.replicas = req.Replicas
	// Scaling out reduces CPU load baseline proportionally
	if req.Replicas >= 4 && s.cpuBase > 60.0 {
		s.cpuBase = 45.0
	}
	s.mu.Unlock()

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "scaled",
		"service":  s.ID,
		"replicas": req.Replicas,
	})
}

func (s *MonitoredService) handleChaos(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.errorRate = 18.5 // Trigger critical error alert
	s.cpuBase = 94.0   // Trigger critical CPU alert
	s.status = "degraded"

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "chaos_injected",
		"service":   s.ID,
		"errorRate": s.errorRate,
		"cpu":       s.cpuBase,
	})
}

func main() {
	services := []*MonitoredService{
		newService("payment-service", "Payment Processing API", 8081, "dev-payment-key", 3, 54.0, 68.0, 0.04),
		newService("auth-service", "Authentication & IAM", 8082, "dev-auth-key", 2, 88.0, 72.0, 0.08), // Slightly elevated CPU to demonstrate alert
		newService("inventory-service", "Inventory & Catalog Engine", 8083, "dev-inventory-key", 4, 38.0, 45.0, 0.02),
	}

	var wg sync.WaitGroup
	for _, svc := range services {
		wg.Add(1)
		go func(s *MonitoredService) {
			defer wg.Done()
			addr := fmt.Sprintf("127.0.0.1:%d", s.Port)
			log.Printf("Starting monitored service %s on http://%s...", s.ID, addr)
			server := &http.Server{
				Addr:              addr,
				Handler:           s,
				ReadHeaderTimeout: 3 * time.Second,
			}
			if err := server.ListenAndServe(); err != nil {
				log.Printf("Service %s exited: %v", s.ID, err)
			}
		}(svc)
	}

	wg.Wait()
}
