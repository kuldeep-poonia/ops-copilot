package guardrail

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"ops-copilot/backend/internal/database"
	"ops-copilot/backend/internal/models"
)

var (
	ErrChallengeNotFound   = errors.New("confirmation challenge not found")
	ErrChallengeExpired    = errors.New("confirmation challenge has expired")
	ErrChallengeNotPending = errors.New("confirmation challenge is no longer pending")
	ErrTokenInvalid        = errors.New("invalid confirmation token")
	ErrTokenExpired        = errors.New("confirmation token has expired")
	ErrTokenAlreadyUsed    = errors.New("confirmation token has already been used (replay attempt rejected)")
	ErrTokenScopeMismatch  = errors.New("confirmation token is not valid for this service, action, or parameters")
)

// Guardrail manages confirmation challenges, single-use tokens, and action serialization.
type Guardrail struct {
	db           *database.DB
	tokenTTL     time.Duration
	serviceLocks sync.Map // Map[string]*sync.Mutex for per-service concurrency control
}

// NewGuardrail creates a guardrail manager.
func NewGuardrail(db *database.DB, tokenTTL time.Duration) *Guardrail {
	if tokenTTL <= 0 {
		tokenTTL = 60 * time.Second
	}
	return &Guardrail{
		db:       db,
		tokenTTL: tokenTTL,
	}
}

// AcquireServiceLock acquires an exclusive lock for a specific service ID to serialize actions.
func (g *Guardrail) AcquireServiceLock(serviceID string) func() {
	rawLock, _ := g.serviceLocks.LoadOrStore(serviceID, &sync.Mutex{})
	lock := rawLock.(*sync.Mutex)
	lock.Lock()
	return func() {
		lock.Unlock()
	}
}

// CreateChallenge creates a pending confirmation challenge when an agent requests a high-risk action.
func (g *Guardrail) CreateChallenge(ctx context.Context, serviceID, serviceName, actionType string, params map[string]interface{}, reason, initiator string) (*models.ConfirmationChallenge, error) {
	if initiator == "" {
		initiator = "agent"
	}

	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize action parameters: %w", err)
	}

	challengeID := "chg-" + uuid.New().String()[:8]
	now := time.Now().UTC()
	expiresAt := now.Add(g.tokenTTL)

	challenge := models.ConfirmationChallenge{
		ChallengeID: challengeID,
		ServiceID:   serviceID,
		ServiceName: serviceName,
		ActionType:  actionType,
		Parameters:  string(paramsJSON),
		Reason:      reason,
		Initiator:   initiator,
		Status:      "pending",
		CreatedAt:   now,
		ExpiresAt:   expiresAt,
	}

	query := `
		INSERT INTO confirmation_challenges (challenge_id, service_id, service_name, action_type, parameters, reason, initiator, status, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err = g.db.ExecContext(
		ctx, query,
		challenge.ChallengeID, challenge.ServiceID, challenge.ServiceName,
		challenge.ActionType, challenge.Parameters, challenge.Reason,
		challenge.Initiator, challenge.Status, challenge.CreatedAt, challenge.ExpiresAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to store confirmation challenge: %w", err)
	}

	return &challenge, nil
}

// GetChallenge retrieves a challenge by ID.
func (g *Guardrail) GetChallenge(ctx context.Context, challengeID string) (*models.ConfirmationChallenge, error) {
	query := `
		SELECT challenge_id, service_id, service_name, action_type, parameters, reason, initiator, status, created_at, expires_at
		FROM confirmation_challenges
		WHERE challenge_id = ?
	`
	var c models.ConfirmationChallenge
	err := g.db.QueryRowContext(ctx, query, challengeID).Scan(
		&c.ChallengeID, &c.ServiceID, &c.ServiceName, &c.ActionType, &c.Parameters,
		&c.Reason, &c.Initiator, &c.Status, &c.CreatedAt, &c.ExpiresAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrChallengeNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query challenge: %w", err)
	}

	return &c, nil
}

// ReviewChallenge records human approval or rejection of a challenge. If approved, issues a single-use token.
func (g *Guardrail) ReviewChallenge(ctx context.Context, challengeID string, approved bool) (string, time.Time, error) {
	now := time.Now().UTC()

	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return "", time.Time{}, err
	}
	defer tx.Rollback()

	var c models.ConfirmationChallenge
	query := `
		SELECT challenge_id, service_id, action_type, parameters, status, expires_at
		FROM confirmation_challenges
		WHERE challenge_id = ?
	`
	err = tx.QueryRowContext(ctx, query, challengeID).Scan(
		&c.ChallengeID, &c.ServiceID, &c.ActionType, &c.Parameters, &c.Status, &c.ExpiresAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return "", time.Time{}, ErrChallengeNotFound
	}
	if err != nil {
		return "", time.Time{}, err
	}

	if c.Status != "pending" {
		return "", time.Time{}, ErrChallengeNotPending
	}
	if now.After(c.ExpiresAt) {
		_, _ = tx.ExecContext(ctx, "UPDATE confirmation_challenges SET status = 'expired' WHERE challenge_id = ?", challengeID)
		_ = tx.Commit()
		return "", time.Time{}, ErrChallengeExpired
	}

	if !approved {
		_, err := tx.ExecContext(ctx, "UPDATE confirmation_challenges SET status = 'rejected' WHERE challenge_id = ?", challengeID)
		if err != nil {
			return "", time.Time{}, err
		}
		if err := tx.Commit(); err != nil {
			return "", time.Time{}, err
		}
		return "", time.Time{}, nil
	}

	// Approved: generate cryptographically secure random token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", time.Time{}, fmt.Errorf("failed to generate random token: %w", err)
	}
	plaintextToken := hex.EncodeToString(tokenBytes)
	tokenHash := HashString(plaintextToken)
	paramsHash := HashString(c.Parameters)
	tokenExpiresAt := now.Add(g.tokenTTL)

	// Update challenge to approved
	_, err = tx.ExecContext(ctx, "UPDATE confirmation_challenges SET status = 'approved' WHERE challenge_id = ?", challengeID)
	if err != nil {
		return "", time.Time{}, err
	}

	// Insert single-use token record
	insertTokenQuery := `
		INSERT INTO confirmation_tokens (token_hash, challenge_id, service_id, action_type, params_hash, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`
	_, err = tx.ExecContext(
		ctx, insertTokenQuery,
		tokenHash, challengeID, c.ServiceID, c.ActionType, paramsHash, tokenExpiresAt, now,
	)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to store confirmation token: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return "", time.Time{}, err
	}

	return plaintextToken, tokenExpiresAt, nil
}

// ValidateAndConsumeToken verifies a token and atomically marks it as consumed.
func (g *Guardrail) ValidateAndConsumeToken(ctx context.Context, plaintextToken, serviceID, actionType string, params map[string]interface{}) error {
	if plaintextToken == "" {
		return ErrTokenInvalid
	}

	tokenHash := HashString(plaintextToken)
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("failed to serialize parameters for token validation: %w", err)
	}
	expectedParamsHash := HashString(string(paramsJSON))

	now := time.Now().UTC()

	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var token models.ConfirmationToken
	query := `
		SELECT token_hash, challenge_id, service_id, action_type, params_hash, expires_at, used_at, created_at
		FROM confirmation_tokens
		WHERE token_hash = ?
	`
	err = tx.QueryRowContext(ctx, query, tokenHash).Scan(
		&token.TokenHash, &token.ChallengeID, &token.ServiceID, &token.ActionType,
		&token.ParamsHash, &token.ExpiresAt, &token.UsedAt, &token.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrTokenInvalid
	}
	if err != nil {
		return err
	}

	if token.UsedAt != nil {
		return ErrTokenAlreadyUsed
	}

	if now.After(token.ExpiresAt) {
		return ErrTokenExpired
	}

	// Verify exact service, action type, and parameter hash binding
	if token.ServiceID != serviceID || token.ActionType != actionType || token.ParamsHash != expectedParamsHash {
		return ErrTokenScopeMismatch
	}

	// Atomically mark token as used
	updateTokenQuery := `UPDATE confirmation_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`
	res, err := tx.ExecContext(ctx, updateTokenQuery, now, tokenHash)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrTokenAlreadyUsed
	}

	// Update challenge status to executed
	_, _ = tx.ExecContext(ctx, "UPDATE confirmation_challenges SET status = 'executed' WHERE challenge_id = ?", token.ChallengeID)

	return tx.Commit()
}

// HashString computes a SHA-256 hex digest of the input string.
func HashString(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
