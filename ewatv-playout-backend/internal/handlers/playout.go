package handlers

import (
	"github.com/gofiber/fiber/v2"

	"github.com/vn4x/ewatv-playout-backend/internal/playout"
)

type Playout struct {
	engine *playout.Engine
}

func NewPlayout(engine *playout.Engine) *Playout {
	return &Playout{engine: engine}
}

func (h *Playout) Register(r fiber.Router) {
	r.Get("/channels/:slug/now-playing", h.NowPlaying)
}

func (h *Playout) NowPlaying(c *fiber.Ctx) error {
	slug := c.Params("slug")
	if slug == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slug required"})
	}

	result, err := h.engine.NowPlayingForChannel(c.Context(), slug)
	if err != nil {
		if err.Error() == "channel not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "channel not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(result)
}
