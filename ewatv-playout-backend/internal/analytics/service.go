package analytics

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const defaultHeartbeatMs = 30_000

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) StartSession(ctx context.Context, sessionID uuid.UUID, channelSlug, country, ua string) error {
	chID, err := s.repo.GetChannelIDBySlug(ctx, channelSlug)
	if err != nil {
		return err
	}
	return s.repo.StartSession(ctx, sessionID, chID, country, HashUserAgent(ua))
}

func (s *Service) Heartbeat(ctx context.Context, sessionID uuid.UUID, watchMs int64) error {
	if watchMs <= 0 {
		watchMs = defaultHeartbeatMs
	}
	if watchMs > 120_000 {
		watchMs = 120_000
	}
	return s.repo.HeartbeatSession(ctx, sessionID, watchMs)
}

func (s *Service) EndSession(ctx context.Context, sessionID uuid.UUID, watchMs int64) error {
	if watchMs < 0 {
		watchMs = 0
	}
	if watchMs > 120_000 {
		watchMs = 120_000
	}
	return s.repo.EndSession(ctx, sessionID, watchMs)
}

func parseRange(fromStr, toStr string) (time.Time, time.Time, error) {
	to := time.Now().UTC()
	from := to.Add(-24 * time.Hour)
	if toStr != "" {
		t, err := time.Parse(time.RFC3339, toStr)
		if err != nil {
			return from, to, fmt.Errorf("invalid to: %w", err)
		}
		to = t
	}
	if fromStr != "" {
		t, err := time.Parse(time.RFC3339, fromStr)
		if err != nil {
			return from, to, fmt.Errorf("invalid from: %w", err)
		}
		from = t
	}
	if !from.Before(to) {
		return from, to, fmt.Errorf("from must be before to")
	}
	return from, to, nil
}

func (s *Service) Live(ctx context.Context) ([]LiveChannelCount, error) {
	return s.repo.LiveViewers(ctx)
}

func (s *Service) Summary(ctx context.Context, channelSlug, fromStr, toStr string) (SummaryStats, error) {
	from, to, err := parseRange(fromStr, toStr)
	if err != nil {
		return SummaryStats{}, err
	}
	var chID *uuid.UUID
	if channelSlug != "" {
		id, err := s.repo.GetChannelIDBySlug(ctx, channelSlug)
		if err != nil {
			return SummaryStats{}, err
		}
		chID = &id
	}
	return s.repo.Summary(ctx, chID, from, to)
}

func (s *Service) ByHour(ctx context.Context, channelSlug, fromStr, toStr string) ([]HourlyPoint, error) {
	from, to, err := parseRange(fromStr, toStr)
	if err != nil {
		return nil, err
	}
	var chID *uuid.UUID
	if channelSlug != "" {
		id, err := s.repo.GetChannelIDBySlug(ctx, channelSlug)
		if err != nil {
			return nil, err
		}
		chID = &id
	}
	return s.repo.ByHour(ctx, chID, from, to)
}

func (s *Service) ByDayOfWeek(ctx context.Context, channelSlug, fromStr, toStr string) ([]DowPoint, error) {
	from, to, err := parseRange(fromStr, toStr)
	if err != nil {
		return nil, err
	}
	var chID *uuid.UUID
	if channelSlug != "" {
		id, err := s.repo.GetChannelIDBySlug(ctx, channelSlug)
		if err != nil {
			return nil, err
		}
		chID = &id
	}
	return s.repo.ByDayOfWeek(ctx, chID, from, to)
}

func (s *Service) ByCountry(ctx context.Context, channelSlug, fromStr, toStr string) ([]GeoPoint, error) {
	from, to, err := parseRange(fromStr, toStr)
	if err != nil {
		return nil, err
	}
	var chID *uuid.UUID
	if channelSlug != "" {
		id, err := s.repo.GetChannelIDBySlug(ctx, channelSlug)
		if err != nil {
			return nil, err
		}
		chID = &id
	}
	return s.repo.ByCountry(ctx, chID, from, to)
}

func (s *Service) AsRun(ctx context.Context, channelSlug, fromStr, toStr string, limit int) ([]AsRunEvent, error) {
	from, to, err := parseRange(fromStr, toStr)
	if err != nil {
		return nil, err
	}
	chID, err := s.repo.GetChannelIDBySlug(ctx, channelSlug)
	if err != nil {
		return nil, err
	}
	return s.repo.ListAsRun(ctx, chID, from, to, limit)
}
