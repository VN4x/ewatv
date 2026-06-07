package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog/log"

	"github.com/vn4x/ewatv-playout-backend/internal/analytics"
	"github.com/vn4x/ewatv-playout-backend/internal/channels"
	"github.com/vn4x/ewatv-playout-backend/internal/collections"
	"github.com/vn4x/ewatv-playout-backend/internal/config"
	"github.com/vn4x/ewatv-playout-backend/internal/database"
	"github.com/vn4x/ewatv-playout-backend/internal/ingest"
	"github.com/vn4x/ewatv-playout-backend/internal/library"
	"github.com/vn4x/ewatv-playout-backend/internal/platform"
	"github.com/vn4x/ewatv-playout-backend/internal/playout"
	"github.com/vn4x/ewatv-playout-backend/internal/schedule"
	"github.com/vn4x/ewatv-playout-backend/internal/server"
)

func main() {
	cfgPath := flag.String("config", "configs/config.example.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatal().Err(err).Msg("load config")
	}

	logger := platform.NewLogger(cfg.Logging)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	db, err := database.Connect(ctx, cfg.Database, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("database connect")
	}
	defer db.Close()

	rdb, err := database.ConnectRedis(ctx, cfg.Redis, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("redis connect")
	}
	defer func() { _ = rdb.Close() }()

	libRepo := library.NewRepository(db.Pool)
	libSvc := library.NewService(libRepo)

	colRepo := collections.NewRepository(db.Pool)
	colSvc := collections.NewService(colRepo)

	chRepo := channels.NewRepository(db.Pool)
	chSvc := channels.NewService(chRepo)

	schedRepo := schedule.NewRepository(db.Pool)
	schedSvc := schedule.NewService(schedRepo)

	playoutRepo := playout.NewRepository(db.Pool)
	engine := playout.NewEngine(playoutRepo, cfg, logger)

	analyticsRepo := analytics.NewRepository(db.Pool)
	analyticsSvc := analytics.NewService(analyticsRepo)
	engine.SetAsRunRecorder(analytics.NewAsRunRecorder(analyticsRepo, logger))

	go engine.Run(ctx)

	if cfg.Ingest.Enabled {
		worker := ingest.NewWorker(libRepo, logger, cfg)
		go worker.Run(ctx)
	}

	app := server.NewApp(server.Deps{
		Config:      cfg,
		Log:         logger,
		DB:          db,
		Redis:       rdb,
		Library:     libSvc,
		Collections: colSvc,
		Channels:    chSvc,
		Schedule:    schedSvc,
		Playout:     engine,
		Analytics:   analyticsSvc,
	})

	go func() {
		logger.Info().Str("addr", cfg.Server.Addr()).Msg("starting http server")
		if err := app.Listen(cfg.Server.Addr()); err != nil {
			logger.Fatal().Err(err).Msg("server listen")
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info().Msg("shutting down")
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
	defer shutdownCancel()
	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("shutdown error")
	}
	logger.Info().Msg("stopped")
}
