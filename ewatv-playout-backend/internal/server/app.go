package server

import (
	"github.com/gofiber/fiber/v2"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"
	"github.com/valyala/fasthttp/fasthttpadaptor"

	"github.com/vn4x/ewatv-playout-backend/internal/config"
	"github.com/vn4x/ewatv-playout-backend/internal/database"
	"github.com/vn4x/ewatv-playout-backend/internal/handlers"
	"github.com/vn4x/ewatv-playout-backend/internal/library"
	"github.com/vn4x/ewatv-playout-backend/internal/middleware"
)

type Deps struct {
	Config  *config.Config
	Log     zerolog.Logger
	DB      *database.DB
	Redis   *database.Redis
	Library *library.Service
}

func NewApp(deps Deps) *fiber.App {
	cfg := deps.Config
	log := deps.Log

	app := fiber.New(fiber.Config{
		AppName:      "ewatv-playout-backend",
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  cfg.Server.IdleTimeout,
		BodyLimit:    cfg.Server.BodyLimit,
		ServerHeader: "ewatv-playout",
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			log.Error().Err(err).Str("path", c.Path()).Int("status", code).Msg("handler error")
			return c.Status(code).JSON(fiber.Map{"error": err.Error()})
		},
	})

	middleware.Stack(app, cfg, log)

	health := handlers.NewHealth(deps.DB, deps.Redis)
	health.Register(app)

	if cfg.Metrics.Enabled {
		metricsHandler := fasthttpadaptor.NewFastHTTPHandler(promhttp.Handler())
		app.Get(cfg.Metrics.Path, func(c *fiber.Ctx) error {
			metricsHandler(c.Context())
			return nil
		})
	}

	api := app.Group("/v1")
	api.Get("/", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"service": "ewatv-playout-backend",
			"version": handlers.Version,
			"docs":    "/v1/openapi.yaml",
		})
	})

	if deps.Library != nil {
		auth := middleware.SupabaseAuth(cfg.Auth)
		videos := handlers.NewVideos(deps.Library)
		admin := api.Group("", auth)
		videos.Register(admin)
	}

	return app
}
