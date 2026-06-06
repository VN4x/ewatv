package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/vn4x/ewatv-playout-backend/internal/database"
	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

const Version = "0.2.0-library-ingest"

type Health struct {
	started time.Time
	db      *database.DB
	redis   *database.Redis
}

func NewHealth(db *database.DB, redis *database.Redis) *Health {
	return &Health{started: time.Now(), db: db, redis: redis}
}

func (h *Health) Liveness(c *fiber.Ctx) error {
	return c.JSON(models.HealthResponse{
		Status:    "ok",
		Version:   Version,
		UptimeSec: time.Since(h.started).Seconds(),
	})
}

func (h *Health) Readiness(c *fiber.Ctx) error {
	checks := map[string]string{}
	allOK := true

	if err := h.db.Ping(c.Context()); err != nil {
		checks["postgres"] = err.Error()
		allOK = false
	} else {
		checks["postgres"] = "ok"
	}

	if err := h.redis.Ping(c.Context()); err != nil {
		checks["redis"] = err.Error()
		allOK = false
	} else {
		checks["redis"] = "ok"
	}

	status := "ok"
	code := fiber.StatusOK
	if !allOK {
		status = "degraded"
		code = fiber.StatusServiceUnavailable
	}

	return c.Status(code).JSON(models.HealthResponse{
		Status:    status,
		Version:   Version,
		UptimeSec: time.Since(h.started).Seconds(),
		Checks:    checks,
	})
}

func (h *Health) Register(app fiber.Router) {
	app.Get("/health", h.Liveness)
	app.Get("/ready", h.Readiness)
}
