package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vn4x/ewatv-playout-backend/internal/middleware"
	"github.com/vn4x/ewatv-playout-backend/internal/schedule"
)

type Autopilot struct {
	svc *schedule.Service
}

func NewAutopilot(svc *schedule.Service) *Autopilot {
	return &Autopilot{svc: svc}
}

type autopilotGenerateBody struct {
	Days     int    `json:"days"`
	FromDate string `json:"from_date"`
}

func (h *Autopilot) Register(r fiber.Router) {
	r.Post("/channels/:channelId/autopilot/generate", h.Generate)
}

func (h *Autopilot) Generate(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}

	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid channelId"})
	}

	var body autopilotGenerateBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}

	days := body.Days
	if days <= 0 {
		days = schedule.GetAutopilotWeekDays()
	}

	fromDate := body.FromDate
	if fromDate == "" {
		today, err := schedule.GetTodayInAutopilotTz(time.Now())
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		fromDate = today
	}

	result, err := h.svc.RunAutopilotForChannel(c.Context(), user.ID, channelID, fromDate, days)
	if err != nil {
		if err.Error() == "forbidden" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
		if err.Error() == "channel not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "channel not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(result)
}
