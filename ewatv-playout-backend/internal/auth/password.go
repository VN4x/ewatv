package auth

import (
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

const defaultBcryptCost = 12

func HashPassword(plain string, cost int) (string, error) {
	if cost <= 0 {
		cost = defaultBcryptCost
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), cost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(hash), nil
}

func VerifyPassword(hash, plain string) error {
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)); err != nil {
		return fmt.Errorf("invalid password")
	}
	return nil
}
