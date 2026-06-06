package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/vn4x/ewatv-playout-backend/internal/auth"
	"github.com/vn4x/ewatv-playout-backend/internal/config"
)

const UserLocalKey = "user"

func SupabaseAuth(cfg config.AuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if !cfg.RequireAuth {
			return c.Next()
		}
		if cfg.SupabaseJWTSecret == "" {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "supabase JWT secret not configured",
			})
		}

		header := c.Get(fiber.HeaderAuthorization)
		if header == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "authorization required"})
		}

		user, err := auth.ParseSupabaseToken(header, cfg.SupabaseJWTSecret)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid token"})
		}

		c.Locals(UserLocalKey, user)
		return c.Next()
	}
}

// OptionalAuth attaches user when Bearer present; never blocks.
func OptionalAuth(cfg config.AuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if cfg.SupabaseJWTSecret == "" {
			return c.Next()
		}
		header := c.Get(fiber.HeaderAuthorization)
		if header == "" || !strings.HasPrefix(header, "Bearer ") {
			return c.Next()
		}
		if user, err := auth.ParseSupabaseToken(header, cfg.SupabaseJWTSecret); err == nil {
			c.Locals(UserLocalKey, user)
		}
		return c.Next()
	}
}

func UserFromCtx(c *fiber.Ctx) (*auth.User, bool) {
	u, ok := c.Locals(UserLocalKey).(*auth.User)
	return u, ok
}
