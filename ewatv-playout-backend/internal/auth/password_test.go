package auth

import "testing"

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("correct-horse-battery-staple", 10)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if err := VerifyPassword(hash, "correct-horse-battery-staple"); err != nil {
		t.Fatalf("verify valid: %v", err)
	}
	if err := VerifyPassword(hash, "wrong"); err == nil {
		t.Fatal("expected invalid password error")
	}
}

func TestHashPasswordRejectsEmptyCostFallback(t *testing.T) {
	hash, err := HashPassword("test-password-min-8", 0)
	if err != nil {
		t.Fatalf("hash with default cost: %v", err)
	}
	if hash == "" {
		t.Fatal("expected non-empty hash")
	}
}
