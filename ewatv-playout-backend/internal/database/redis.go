package database

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/vn4x/ewatv-playout-backend/internal/config"
)

type Redis struct {
	Client *redis.Client
	log    zerolog.Logger
}

func ConnectRedis(ctx context.Context, cfg config.RedisConfig, log zerolog.Logger) (*Redis, error) {
	opt, err := redis.ParseURL(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	if cfg.PoolSize > 0 {
		opt.PoolSize = cfg.PoolSize
	}

	client := redis.NewClient(opt)
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}

	log.Info().Msg("redis connected")
	return &Redis{Client: client, log: log}, nil
}

func (r *Redis) Close() error {
	if r.Client != nil {
		return r.Client.Close()
	}
	return nil
}

func (r *Redis) Ping(ctx context.Context) error {
	return r.Client.Ping(ctx).Err()
}
