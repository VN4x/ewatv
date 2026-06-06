package auth

import (
	"fmt"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Claims from Supabase-issued JWT (HS256).
type Claims struct {
	jwt.RegisteredClaims
	Email        string                 `json:"email"`
	Role         string                 `json:"role"`
	AppMetadata  map[string]interface{} `json:"app_metadata"`
	UserMetadata map[string]interface{} `json:"user_metadata"`
}

type User struct {
	ID    uuid.UUID
	Email string
	Role  string
}

func ParseSupabaseToken(tokenString, secret string) (*User, error) {
	tokenString = strings.TrimPrefix(tokenString, "Bearer ")
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return nil, fmt.Errorf("missing token")
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, fmt.Errorf("unexpected signing method: %s", t.Method.Alg())
		}
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
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
		role = "authenticated"
	}

	return &User{ID: uid, Email: claims.Email, Role: role}, nil
}
