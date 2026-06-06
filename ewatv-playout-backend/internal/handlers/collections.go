package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vn4x/ewatv-playout-backend/internal/collections"
	"github.com/vn4x/ewatv-playout-backend/internal/middleware"
)

type Collections struct {
	svc *collections.Service
}

func NewCollections(svc *collections.Service) *Collections {
	return &Collections{svc: svc}
}

type createCollectionBody struct {
	Name        string     `json:"name"`
	Description *string    `json:"description"`
	ParentID    *uuid.UUID `json:"parent_id"`
}

type updateCollectionBody struct {
	Name        *string    `json:"name"`
	Description *string    `json:"description"`
	ParentID    *uuid.UUID `json:"parent_id"`
}

func (h *Collections) Register(r fiber.Router) {
	r.Get("/collections", h.List)
	r.Post("/collections", h.Create)
	r.Get("/collections/:id", h.Get)
	r.Patch("/collections/:id", h.Update)
	r.Delete("/collections/:id", h.Delete)
}

func (h *Collections) List(c *fiber.Ctx) error {
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

func (h *Collections) Create(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	var body createCollectionBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	if body.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name required"})
	}
	col, err := h.svc.Create(c.Context(), user.ID, collections.CreateInput{
		Name:        body.Name,
		Description: body.Description,
		ParentID:    body.ParentID,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(col)
}

func (h *Collections) Get(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	col, err := h.svc.Get(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	if col.OwnerID != user.ID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
	}
	return c.JSON(col)
}

func (h *Collections) Update(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	var body updateCollectionBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	col, err := h.svc.Update(c.Context(), id, user.ID, collections.UpdateInput{
		Name:        body.Name,
		Description: body.Description,
		ParentID:    body.ParentID,
	})
	if err != nil {
		if err.Error() == "forbidden" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(col)
}

func (h *Collections) Delete(c *fiber.Ctx) error {
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
