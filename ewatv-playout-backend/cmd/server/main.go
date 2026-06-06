package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog/log"

	"github.com/vn4x/ewatv-playout-backend/internal/config"
	"github.com/vn4x/ewatv-playout-backend/internal/database"
	"github.com/vn4x/ewatv-playout-backend/internal/platform"
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
	ctx := context.Background()

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

	app := server.NewApp(cfg, logger, db, rdb)

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
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
	defer cancel()
	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("shutdown error")
	}
	logger.Info().Msg("stopped")
}
