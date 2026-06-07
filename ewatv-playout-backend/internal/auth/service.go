package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/vn4x/ewatv-playout-backend/internal/config"
)

var (
	ErrEmailTaken       = errors.New("email already registered")
	ErrInvalidLogin     = errors.New("invalid email or password")
	ErrPasswordTooShort = errors.New("password must be at least 8 characters")
)

type Service struct {
	repo *Repository
	cfg  config.AuthConfig
}

func NewService(repo *Repository, cfg config.AuthConfig) *Service {
	return &Service{repo: repo, cfg: cfg}
}

type RegisterInput struct {
	Email       string
	Password    string
	DisplayName *string
}

type AuthResult struct {
	Token string       `json:"token"`
	User  Profile      `json:"user"`
}

type Profile struct {
	ID          uuid.UUID `json:"id"`
	Email       string    `json:"email"`
	DisplayName *string   `json:"display_name,omitempty"`
	Role        string    `json:"role"`
	CreatedAt   string    `json:"created_at,omitempty"`
}

func (s *Service) Register(ctx context.Context, in RegisterInput) (*AuthResult, error) {
	email := strings.TrimSpace(strings.ToLower(in.Email))
	if email == "" {
		return nil, fmt.Errorf("email required")
	}
	if len(in.Password) < 8 {
		return nil, ErrPasswordTooShort
	}

	hash, err := HashPassword(in.Password, s.cfg.BcryptCost)
	if err != nil {
		return nil, err
	}

	rec, err := s.repo.CreateUser(ctx, email, hash, in.DisplayName, "user")
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrEmailTaken
		}
		return nil, err
	}

	user := &User{ID: rec.ID, Email: rec.Email, Role: rec.Role}
	token, err := IssueJWT(s.cfg, user)
	if err != nil {
		return nil, err
	}

	return &AuthResult{
		Token: token,
		User:  toProfile(rec, false),
	}, nil
}

func (s *Service) Login(ctx context.Context, email, password string) (*AuthResult, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" || password == "" {
		return nil, ErrInvalidLogin
	}

	rec, err := s.repo.GetByEmail(ctx, email)
	if err != nil {
		return nil, ErrInvalidLogin
	}
	if err := VerifyPassword(rec.PasswordHash, password); err != nil {
		return nil, ErrInvalidLogin
	}

	user := &User{ID: rec.ID, Email: rec.Email, Role: rec.Role}
	token, err := IssueJWT(s.cfg, user)
	if err != nil {
		return nil, err
	}

	return &AuthResult{
		Token: token,
		User:  toProfile(rec, false),
	}, nil
}

func (s *Service) GetProfile(ctx context.Context, userID uuid.UUID) (*Profile, error) {
	rec, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	p := toProfile(rec, true)
	return &p, nil
}

func toProfile(rec *UserRecord, includeCreatedAt bool) Profile {
	p := Profile{
		ID:          rec.ID,
		Email:       rec.Email,
		DisplayName: rec.DisplayName,
		Role:        rec.Role,
	}
	if includeCreatedAt {
		p.CreatedAt = rec.CreatedAt.UTC().Format("2006-01-02T15:04:05Z")
	}
	return p
}
