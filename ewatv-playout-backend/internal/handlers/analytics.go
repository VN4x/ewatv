package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vn4x/ewatv-playout-backend/internal/analytics"
)

type Analytics struct {
	svc *analytics.Service
}

func NewAnalytics(svc *analytics.Service) *Analytics {
	return &Analytics{svc: svc}
}

func (h *Analytics) Register(r fiber.Router) {
	r.Get("/analytics/live", h.Live)
	r.Get("/analytics/summary", h.Summary)
	r.Get("/analytics/by-hour", h.ByHour)
	r.Get("/analytics/by-dow", h.ByDow)
	r.Get("/analytics/by-country", h.ByCountry)
	r.Get("/analytics/as-run/:slug", h.AsRun)
}

func (h *Analytics) Live(c *fiber.Ctx) error {
	items, err := h.svc.Live(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	total := 0
	for _, it := range items {
		total += it.Viewers
	}
	return c.JSON(fiber.Map{"channels": items, "total_viewers": total})
}

func (h *Analytics) Summary(c *fiber.Ctx) error {
	stats, err := h.svc.Summary(c.Context(), c.Query("channel"), c.Query("from"), c.Query("to"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(stats)
}

func (h *Analytics) ByHour(c *fiber.Ctx) error {
	points, err := h.svc.ByHour(c.Context(), c.Query("channel"), c.Query("from"), c.Query("to"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"points": points})
}

func (h *Analytics) ByDow(c *fiber.Ctx) error {
	points, err := h.svc.ByDayOfWeek(c.Context(), c.Query("channel"), c.Query("from"), c.Query("to"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"points": points})
}

func (h *Analytics) ByCountry(c *fiber.Ctx) error {
	points, err := h.svc.ByCountry(c.Context(), c.Query("channel"), c.Query("from"), c.Query("to"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"points": points})
}

func (h *Analytics) AsRun(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 100)
	events, err := h.svc.AsRun(c.Context(), c.Params("slug"), c.Query("from"), c.Query("to"), limit)
	if err != nil {
		if err.Error() == "channel not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"events": events})
}

type Events struct {
	svc *analytics.Service
}

func NewEvents(svc *analytics.Service) *Events {
	return &Events{svc: svc}
}

func (h *Events) Register(r fiber.Router) {
	r.Post("/events/session-start", h.SessionStart)
	r.Post("/events/heartbeat", h.Heartbeat)
	r.Post("/events/session-end", h.SessionEnd)
}

type sessionStartBody struct {
	SessionID   string `json:"session_id"`
	ChannelSlug string `json:"channel_slug"`
}

type sessionTickBody struct {
	SessionID string `json:"session_id"`
	WatchMs   int64  `json:"watch_ms"`
}

func requestCountry(c *fiber.Ctx) string {
	return analytics.CountryFromHeaders(map[string]string{
		"CF-IPCountry":              c.Get("CF-IPCountry"),
		"X-Country-Code":            c.Get("X-Country-Code"),
		"CloudFront-Viewer-Country": c.Get("CloudFront-Viewer-Country"),
	})
}

func (h *Events) SessionStart(c *fiber.Ctx) error {
	var body sessionStartBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	if body.SessionID == "" || body.ChannelSlug == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "session_id and channel_slug required"})
	}
	id, err := uuid.Parse(body.SessionID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid session_id"})
	}
	if err := h.svc.StartSession(c.Context(), id, body.ChannelSlug, requestCountry(c), c.Get("User-Agent")); err != nil {
		if err.Error() == "channel not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"ok": true})
}

func (h *Events) Heartbeat(c *fiber.Ctx) error {
	var body sessionTickBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	id, err := uuid.Parse(body.SessionID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid session_id"})
	}
	if err := h.svc.Heartbeat(c.Context(), id, body.WatchMs); err != nil {
		if err.Error() == "session not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Events) SessionEnd(c *fiber.Ctx) error {
	var body sessionTickBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	id, err := uuid.Parse(body.SessionID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid session_id"})
	}
	if err := h.svc.EndSession(c.Context(), id, body.WatchMs); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}
