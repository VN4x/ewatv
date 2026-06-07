package handlers

import (
	"errors"

	"github.com/gofiber/fiber/v2"

	"github.com/vn4x/ewatv-playout-backend/internal/auth"
	"github.com/vn4x/ewatv-playout-backend/internal/middleware"
)

type Auth struct {
	svc *auth.Service
}

func NewAuth(svc *auth.Service) *Auth {
	return &Auth{svc: svc}
}

type registerBody struct {
	Email       string  `json:"email"`
	Password    string  `json:"password"`
	DisplayName *string `json:"display_name"`
}

type loginBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Auth) Register(r fiber.Router) {
	r.Post("/auth/register", h.RegisterUser)
	r.Post("/auth/login", h.Login)
}

func (h *Auth) RegisterProtected(r fiber.Router) {
	r.Get("/auth/me", h.Me)
}

func (h *Auth) RegisterUser(c *fiber.Ctx) error {
	var body registerBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}

	result, err := h.svc.Register(c.Context(), auth.RegisterInput{
		Email:       body.Email,
		Password:    body.Password,
		DisplayName: body.DisplayName,
	})
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrEmailTaken):
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "email already registered"})
		case errors.Is(err, auth.ErrPasswordTooShort):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		case err.Error() == "email required":
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
	}

	return c.Status(fiber.StatusCreated).JSON(result)
}

func (h *Auth) Login(c *fiber.Ctx) error {
	var body loginBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}

	result, err := h.svc.Login(c.Context(), body.Email, body.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidLogin) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid email or password"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(result)
}

func (h *Auth) Me(c *fiber.Ctx) error {
	user, ok := middleware.UserFromCtx(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}

	profile, err := h.svc.GetProfile(c.Context(), user.ID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(profile)
}
