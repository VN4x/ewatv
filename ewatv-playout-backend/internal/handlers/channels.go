package handlers

import (
	"encoding/json"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vn4x/ewatv-playout-backend/internal/channels"
	"github.com/vn4x/ewatv-playout-backend/internal/middleware"
)

type Channels struct {
	svc *channels.Service
}

func NewChannels(svc *channels.Service) *Channels {
	return &Channels{svc: svc}
}

type createChannelBody struct {
	Name           string          `json:"name"`
	Slug           string          `json:"slug"`
	StreamName     string          `json:"stream_name"`
	Timezone       string          `json:"timezone"`
	OverlayLogoURL *string         `json:"overlay_logo_url"`
	FallbackURL    *string         `json:"fallback_youtube_url"`
	Settings       json.RawMessage `json:"settings"`
	PlayoutActive  bool            `json:"playout_active"`
}

type updateChannelBody struct {
	Name           *string          `json:"name"`
	Slug           *string          `json:"slug"`
	StreamName     *string          `json:"stream_name"`
	Timezone       *string          `json:"timezone"`
	OverlayLogoURL *string          `json:"overlay_logo_url"`
	FallbackURL    *string          `json:"fallback_youtube_url"`
	Settings       json.RawMessage  `json:"settings"`
	PlayoutActive  *bool            `json:"playout_active"`
}

func (h *Channels) Register(r fiber.Router) {
	r.Get("/channels", h.List)
	r.Post("/channels", h.Create)
	r.Get("/channels/:id", h.Get)
	r.Patch("/channels/:id", h.Update)
	r.Delete("/channels/:id", h.Delete)
}

func (h *Channels) List(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	items, err := h.svc.List(c.Context(), user.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"items": items, "count": len(items)})
}

func (h *Channels) Create(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	var body createChannelBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	if body.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name required"})
	}
	if body.Slug == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slug required"})
	}
	ch, err := h.svc.Create(c.Context(), user.ID, channels.CreateInput{
		Name:           body.Name,
		Slug:           body.Slug,
		StreamName:     body.StreamName,
		Timezone:       body.Timezone,
		OverlayLogoURL: body.OverlayLogoURL,
		FallbackURL:    body.FallbackURL,
		Settings:       body.Settings,
		PlayoutActive:  body.PlayoutActive,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(ch)
}

func (h *Channels) Get(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	ch, err := h.svc.Get(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	if ch.OwnerID != user.ID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
	}
	return c.JSON(ch)
}

func (h *Channels) Update(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	var body updateChannelBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	ch, err := h.svc.Update(c.Context(), id, user.ID, channels.UpdateInput{
		Name:           body.Name,
		Slug:           body.Slug,
		StreamName:     body.StreamName,
		Timezone:       body.Timezone,
		OverlayLogoURL: body.OverlayLogoURL,
		FallbackURL:    body.FallbackURL,
		Settings:       body.Settings,
		PlayoutActive:  body.PlayoutActive,
	})
	if err != nil {
		if err.Error() == "forbidden" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(ch)
}

func (h *Channels) Delete(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	if err := h.svc.Delete(c.Context(), id, user.ID); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.SendStatus(fiber.StatusNoContent)
}
