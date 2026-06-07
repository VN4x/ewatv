package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vn4x/ewatv-playout-backend/internal/library"
	"github.com/vn4x/ewatv-playout-backend/internal/middleware"
	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

type Videos struct {
	svc *library.Service
}

func NewVideos(svc *library.Service) *Videos {
	return &Videos{svc: svc}
}

type createVideoBody struct {
	Title        string             `json:"title"`
	Description  *string            `json:"description"`
	CollectionID *uuid.UUID         `json:"collection_id"`
	SourceType   models.VideoSource `json:"source_type"`
	SourceRef    string             `json:"source_ref"`
	Tags         []string           `json:"tags"`
	Category     *string            `json:"category"`
	Daypart      models.Daypart     `json:"daypart"`
	HideOverlay  bool               `json:"hide_overlay"`
	AutoSubs     bool               `json:"auto_subs"`
}

func (h *Videos) Register(r fiber.Router) {
	r.Get("/videos", h.List)
	r.Post("/videos", h.Create)
	r.Get("/videos/:id", h.Get)
	r.Patch("/videos/:id", h.Update)
	r.Delete("/videos/:id", h.Delete)
	r.Post("/videos/:id/reingest", h.Reingest)
}

func (h *Videos) List(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)
	search := c.Query("search", "")

	var collectionID *uuid.UUID
	if raw := c.Query("collection_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid collection_id"})
		}
		collectionID = &id
	}

	items, err := h.svc.List(c.Context(), library.ListFilter{
		OwnerID:      user.ID,
		CollectionID: collectionID,
		Search:       search,
		Limit:        limit,
		Offset:       offset,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"items": items, "count": len(items)})
}

func (h *Videos) Create(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	var body createVideoBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	if body.Title == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "title required"})
	}
	if body.SourceRef == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "source_ref required"})
	}
	if body.SourceType == "" {
		body.SourceType = models.VideoSourceDirectURL
	}

	v, err := h.svc.Create(c.Context(), user.ID, library.CreateVideoInput{
		Title:        body.Title,
		Description:  body.Description,
		CollectionID: body.CollectionID,
		SourceType:   body.SourceType,
		SourceRef:    body.SourceRef,
		Tags:         body.Tags,
		Category:     body.Category,
		Daypart:      body.Daypart,
		HideOverlay:  body.HideOverlay,
		AutoSubs:     body.AutoSubs,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(v)
}

func (h *Videos) Get(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	v, err := h.svc.Get(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(v)
}

func (h *Videos) Update(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	var body library.UpdateVideoInput
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	v, err := h.svc.Update(c.Context(), id, user.ID, body)
	if err != nil {
		if err.Error() == "forbidden" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(v)
}

func (h *Videos) Delete(c *fiber.Ctx) error {
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

func (h *Videos) Reingest(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	v, err := h.svc.Reingest(c.Context(), id, user.ID)
	if err != nil {
		if err.Error() == "forbidden" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(v)
}
