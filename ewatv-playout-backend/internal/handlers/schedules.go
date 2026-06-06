package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vn4x/ewatv-playout-backend/internal/middleware"
	"github.com/vn4x/ewatv-playout-backend/internal/models"
	"github.com/vn4x/ewatv-playout-backend/internal/schedule"
)

type Schedules struct {
	svc *schedule.Service
}

func NewSchedules(svc *schedule.Service) *Schedules {
	return &Schedules{svc: svc}
}

type scheduleItemBody struct {
	VideoID      *uuid.UUID             `json:"video_id"`
	DurationMs   int                    `json:"duration_ms"`
	TransitionMs int                    `json:"transition_ms"`
	StartAt      string                 `json:"start_at"`
	SourceSnap   models.SourceSnapshot  `json:"source_snapshot"`
}

type saveScheduleBody struct {
	Autopilot          bool               `json:"autopilot"`
	ExistingScheduleID *uuid.UUID         `json:"existing_schedule_id"`
	Items              []scheduleItemBody `json:"items"`
	RecomputeStartAt   bool               `json:"recompute_start_at"`
}

func (h *Schedules) Register(r fiber.Router) {
	r.Get("/channels/:channelId/schedules", h.List)
	r.Get("/channels/:channelId/schedules/:date", h.Get)
	r.Put("/channels/:channelId/schedules/:date", h.Save)
}

func (h *Schedules) List(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid channelId"})
	}
	items, err := h.svc.ListSchedulesForChannel(c.Context(), channelID, user.ID)
	if err != nil {
		if err.Error() == "forbidden" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"items": items, "count": len(items)})
}

func (h *Schedules) Get(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid channelId"})
	}
	date := c.Params("date")
	if err := schedule.ValidateScheduleDate(date); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	view, err := h.svc.GetSchedule(c.Context(), channelID, date, user.ID)
	if err != nil {
		if err.Error() == "forbidden" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if view == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "schedule not found"})
	}
	return c.JSON(view)
}

func (h *Schedules) Save(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid channelId"})
	}
	date := c.Params("date")
	if err := schedule.ValidateScheduleDate(date); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	var body saveScheduleBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}

	items := make([]schedule.ItemInput, len(body.Items))
	for i, it := range body.Items {
		if it.DurationMs <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "duration_ms must be positive"})
		}
		items[i] = schedule.ItemInput{
			VideoID:      it.VideoID,
			DurationMs:   it.DurationMs,
			TransitionMs: it.TransitionMs,
			SourceSnap:   it.SourceSnap,
		}
	}

	recompute := body.RecomputeStartAt
	if !recompute && len(body.Items) > 0 {
		recompute = true
	}

	view, err := h.svc.SaveSchedule(c.Context(), schedule.SaveScheduleInput{
		ChannelID:          channelID,
		OwnerID:            user.ID,
		ScheduleDate:       date,
		Autopilot:          body.Autopilot,
		ExistingScheduleID: body.ExistingScheduleID,
		Items:              items,
		RecomputeStartAt:   recompute,
	})
	if err != nil {
		if err.Error() == "forbidden" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(view)
}
