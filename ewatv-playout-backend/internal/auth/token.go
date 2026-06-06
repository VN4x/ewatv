package auth

import (
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/vn4x/ewatv-playout-backend/internal/config"
)

type User struct {
	ID    uuid.UUID
	Email string
	Role  string
}

type LocalClaims struct {
	jwt.RegisteredClaims
	Email string `json:"email"`
	Role  string `json:"role"`
}

func IssueJWT(cfg config.AuthConfig, user *User) (string, error) {
	if cfg.JWTSecret == "" {
		return "", fmt.Errorf("jwt secret not configured")
	}
	if user == nil {
		return "", fmt.Errorf("user required")
	}

	ttl := cfg.TokenTTL
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}

	now := time.Now()
	claims := LocalClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID.String(),
			Issuer:    cfg.JWTIssuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
		Email: user.Email,
		Role:  user.Role,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(cfg.JWTSecret))
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return signed, nil
}

func ParseLocalToken(tokenString string, cfg config.AuthConfig) (*User, error) {
	tokenString = strings.TrimPrefix(tokenString, "Bearer ")
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return nil, fmt.Errorf("missing token")
	}
	if cfg.JWTSecret == "" {
		return nil, fmt.Errorf("jwt secret not configured")
	}

	claims := &LocalClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, fmt.Errorf("unexpected signing method: %s", t.Method.Alg())
		}
		return []byte(cfg.JWTSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	if cfg.JWTIssuer != "" && claims.Issuer != cfg.JWTIssuer {
		return nil, fmt.Errorf("invalid issuer")
	}

	sub := claims.Subject
	if sub == "" {
		return nil, fmt.Errorf("missing sub claim")
	}
	uid, err := uuid.Parse(sub)
	if err != nil {
		return nil, fmt.Errorf("invalid sub: %w", err)
	}

	role := claims.Role
	if role == "" {
		role = "user"
	}

	return &User{ID: uid, Email: claims.Email, Role: role}, nil
}
