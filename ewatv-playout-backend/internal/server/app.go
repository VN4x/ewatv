package server

import (
	"github.com/gofiber/fiber/v2"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"
	"github.com/valyala/fasthttp/fasthttpadaptor"

	"github.com/vn4x/ewatv-playout-backend/internal/auth"
	"github.com/vn4x/ewatv-playout-backend/internal/channels"
	"github.com/vn4x/ewatv-playout-backend/internal/collections"
	"github.com/vn4x/ewatv-playout-backend/internal/config"
	"github.com/vn4x/ewatv-playout-backend/internal/database"
	"github.com/vn4x/ewatv-playout-backend/internal/handlers"
	"github.com/vn4x/ewatv-playout-backend/internal/library"
	"github.com/vn4x/ewatv-playout-backend/internal/middleware"
	"github.com/vn4x/ewatv-playout-backend/internal/playout"
	"github.com/vn4x/ewatv-playout-backend/internal/schedule"
	"github.com/vn4x/ewatv-playout-backend/internal/stream"
)

type Deps struct {
	Config      *config.Config
	Log         zerolog.Logger
	DB          *database.DB
	Redis       *database.Redis
	Library     *library.Service
	Collections *collections.Service
	Channels    *channels.Service
	Schedule    *schedule.Service
	Playout     *playout.Engine
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

	authRepo := auth.NewRepository(deps.DB.Pool)
	authSvc := auth.NewService(authRepo, cfg.Auth)
	authH := handlers.NewAuth(authSvc)
	authH.Register(api)

	jwtAuth := middleware.LocalJWT(cfg.Auth)
	authH.RegisterProtected(api.Group("", jwtAuth))

	if deps.Library != nil || deps.Collections != nil || deps.Channels != nil || deps.Schedule != nil {
		admin := api.Group("", jwtAuth)
		if deps.Library != nil {
			handlers.NewVideos(deps.Library).Register(admin)
		}
		if deps.Collections != nil {
			handlers.NewCollections(deps.Collections).Register(admin)
		}
		if deps.Channels != nil {
			handlers.NewChannels(deps.Channels).Register(admin)
		}
		if deps.Schedule != nil {
			handlers.NewSchedules(deps.Schedule).Register(admin)
			handlers.NewAutopilot(deps.Schedule).Register(admin)
		}
	}

	if deps.Playout != nil {
		handlers.NewPlayout(deps.Playout).Register(api)
		stream.NewHLS(deps.Playout).Register(app)
	}

	return app
}
