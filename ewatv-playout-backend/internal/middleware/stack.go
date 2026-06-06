package middleware

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/requestid"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/vn4x/ewatv-playout-backend/internal/config"
)

func Stack(app *fiber.App, cfg *config.Config, log zerolog.Logger) {
	app.Use(recover.New(recover.Config{
		EnableStackTrace: true,
	}))

	app.Use(requestid.New(requestid.Config{
		Header: fiber.HeaderXRequestID,
		Generator: func() string {
			return uuid.NewString()
		},
	}))

	app.Use(RequestLogger(log))

	app.Use(cors.New(cors.Config{
		AllowOrigins: strings.Join(cfg.CORS.AllowedOrigins, ","),
		AllowMethods: strings.Join(cfg.CORS.AllowedMethods, ","),
		AllowHeaders: strings.Join(cfg.CORS.AllowedHeaders, ","),
	}))

	if cfg.RateLimit.Enabled {
		app.Use(limiter.New(limiter.Config{
			Max:        cfg.RateLimit.Max,
			Expiration: cfg.RateLimit.Expiration,
			KeyGenerator: func(c *fiber.Ctx) string {
				return c.IP()
			},
			LimitReached: func(c *fiber.Ctx) error {
				return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
					"error": "rate limit exceeded",
				})
			},
		}))
	}
}

func RequestLogger(log zerolog.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()
		err := c.Next()
		status := c.Response().StatusCode()
		evt := log.Info()
		if status >= 500 {
			evt = log.Error()
		} else if status >= 400 {
			evt = log.Warn()
		}
		evt.
			Str("request_id", c.Get(fiber.HeaderXRequestID)).
			Str("method", c.Method()).
			Str("path", c.Path()).
			Int("status", status).
			Dur("latency", time.Since(start)).
			Str("ip", c.IP()).
			Msg("request")
		return err
	}
}
