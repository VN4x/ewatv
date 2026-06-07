package analytics

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const activeSessionWindow = 45 * time.Second

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

type AsRunEvent struct {
	ID             uuid.UUID  `json:"id"`
	ChannelID      uuid.UUID  `json:"channel_id"`
	ScheduleItemID *uuid.UUID `json:"schedule_item_id,omitempty"`
	VideoID        *uuid.UUID `json:"video_id,omitempty"`
	Title          string     `json:"title"`
	IsGap          bool       `json:"is_gap"`
	StartedAt      time.Time  `json:"started_at"`
	EndedAt        *time.Time `json:"ended_at,omitempty"`
}

func (r *Repository) CloseOpenAsRun(ctx context.Context, channelID uuid.UUID, endedAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE as_run_events SET ended_at = $2
		WHERE channel_id = $1 AND ended_at IS NULL`,
		channelID, endedAt,
	)
	return err
}

func (r *Repository) InsertAsRun(ctx context.Context, ev AsRunEvent) (uuid.UUID, error) {
	const q = `
		INSERT INTO as_run_events (channel_id, schedule_item_id, video_id, title, is_gap, started_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id`
	var id uuid.UUID
	err := r.pool.QueryRow(ctx, q,
		ev.ChannelID, ev.ScheduleItemID, ev.VideoID, ev.Title, ev.IsGap, ev.StartedAt,
	).Scan(&id)
	return id, err
}

func (r *Repository) ListAsRun(ctx context.Context, channelID uuid.UUID, from, to time.Time, limit int) ([]AsRunEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
		SELECT id, channel_id, schedule_item_id, video_id, title, is_gap, started_at, ended_at
		FROM as_run_events
		WHERE channel_id = $1 AND started_at >= $2 AND started_at < $3
		ORDER BY started_at DESC
		LIMIT $4`
	rows, err := r.pool.Query(ctx, q, channelID, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AsRunEvent
	for rows.Next() {
		var ev AsRunEvent
		if err := rows.Scan(
			&ev.ID, &ev.ChannelID, &ev.ScheduleItemID, &ev.VideoID,
			&ev.Title, &ev.IsGap, &ev.StartedAt, &ev.EndedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

type WatchSession struct {
	ID              uuid.UUID  `json:"id"`
	ChannelID       uuid.UUID  `json:"channel_id"`
	StartedAt       time.Time  `json:"started_at"`
	EndedAt         *time.Time `json:"ended_at,omitempty"`
	LastHeartbeatAt time.Time  `json:"last_heartbeat_at"`
	CountryCode     *string    `json:"country_code,omitempty"`
	TotalWatchMs    int64      `json:"total_watch_ms"`
}

func (r *Repository) StartSession(ctx context.Context, id, channelID uuid.UUID, country, uaHash string) error {
	var cc *string
	if country != "" {
		cc = &country
	}
	var uah *string
	if uaHash != "" {
		uah = &uaHash
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO watch_sessions (id, channel_id, country_code, user_agent_hash)
		VALUES ($1, $2, $3, $4)`,
		id, channelID, cc, uah,
	)
	return err
}

func (r *Repository) HeartbeatSession(ctx context.Context, id uuid.UUID, addMs int64) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE watch_sessions
		SET last_heartbeat_at = now(),
		    total_watch_ms = total_watch_ms + $2
		WHERE id = $1 AND ended_at IS NULL`,
		id, addMs,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("session not found")
	}
	return nil
}

func (r *Repository) EndSession(ctx context.Context, id uuid.UUID, addMs int64) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE watch_sessions
		SET ended_at = now(),
		    last_heartbeat_at = now(),
		    total_watch_ms = total_watch_ms + $2
		WHERE id = $1 AND ended_at IS NULL`,
		id, addMs,
	)
	return err
}

func (r *Repository) GetChannelIDBySlug(ctx context.Context, slug string) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.pool.QueryRow(ctx, `SELECT id FROM channels WHERE slug = $1`, slug).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return uuid.Nil, fmt.Errorf("channel not found")
		}
		return uuid.Nil, err
	}
	return id, nil
}

type LiveChannelCount struct {
	ChannelID uuid.UUID `json:"channel_id"`
	Slug      string    `json:"slug"`
	Name      string    `json:"name"`
	Viewers   int       `json:"viewers"`
}

func (r *Repository) LiveViewers(ctx context.Context) ([]LiveChannelCount, error) {
	cutoff := time.Now().Add(-activeSessionWindow)
	const q = `
		SELECT c.id, c.slug, c.name, COUNT(w.id)::int
		FROM channels c
		LEFT JOIN watch_sessions w ON w.channel_id = c.id
		  AND w.ended_at IS NULL
		  AND w.last_heartbeat_at >= $1
		GROUP BY c.id, c.slug, c.name
		ORDER BY c.name`
	rows, err := r.pool.Query(ctx, q, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveChannelCount
	for rows.Next() {
		var row LiveChannelCount
		if err := rows.Scan(&row.ChannelID, &row.Slug, &row.Name, &row.Viewers); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

type SummaryStats struct {
	UniqueSessions int   `json:"unique_sessions"`
	TotalWatchMs   int64 `json:"total_watch_ms"`
	PeakConcurrent int   `json:"peak_concurrent"`
}

func (r *Repository) Summary(ctx context.Context, channelID *uuid.UUID, from, to time.Time) (SummaryStats, error) {
	var s SummaryStats
	args := []any{from, to}
	chFilter := ""
	if channelID != nil {
		chFilter = " AND channel_id = $3"
		args = append(args, *channelID)
	}
	q := fmt.Sprintf(`
		SELECT COUNT(*)::int, COALESCE(SUM(total_watch_ms), 0)::bigint
		FROM watch_sessions
		WHERE started_at >= $1 AND started_at < $2%s`, chFilter)
	if err := r.pool.QueryRow(ctx, q, args...).Scan(&s.UniqueSessions, &s.TotalWatchMs); err != nil {
		return s, err
	}
	// Peak CCV approximation: max hourly distinct active sessions
	pq := fmt.Sprintf(`
		SELECT COALESCE(MAX(cnt), 0)::int FROM (
		  SELECT date_trunc('hour', last_heartbeat_at) AS h, COUNT(*)::int AS cnt
		  FROM watch_sessions
		  WHERE started_at >= $1 AND started_at < $2%s
		  GROUP BY 1
		) t`, chFilter)
	if err := r.pool.QueryRow(ctx, pq, args...).Scan(&s.PeakConcurrent); err != nil {
		return s, err
	}
	return s, nil
}

type HourlyPoint struct {
	Hour           time.Time `json:"hour"`
	Sessions       int       `json:"sessions"`
	TotalWatchMs   int64     `json:"total_watch_ms"`
}

func (r *Repository) ByHour(ctx context.Context, channelID *uuid.UUID, from, to time.Time) ([]HourlyPoint, error) {
	args := []any{from, to}
	chFilter := ""
	if channelID != nil {
		chFilter = " AND channel_id = $3"
		args = append(args, *channelID)
	}
	q := fmt.Sprintf(`
		SELECT date_trunc('hour', started_at) AS h,
		       COUNT(*)::int,
		       COALESCE(SUM(total_watch_ms), 0)::bigint
		FROM watch_sessions
		WHERE started_at >= $1 AND started_at < $2%s
		GROUP BY 1
		ORDER BY 1`, chFilter)
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []HourlyPoint
	for rows.Next() {
		var p HourlyPoint
		if err := rows.Scan(&p.Hour, &p.Sessions, &p.TotalWatchMs); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type DowPoint struct {
	DayOfWeek    int   `json:"day_of_week"`
	TotalWatchMs int64 `json:"total_watch_ms"`
	Sessions     int   `json:"sessions"`
}

func (r *Repository) ByDayOfWeek(ctx context.Context, channelID *uuid.UUID, from, to time.Time) ([]DowPoint, error) {
	args := []any{from, to}
	chFilter := ""
	if channelID != nil {
		chFilter = " AND channel_id = $3"
		args = append(args, *channelID)
	}
	q := fmt.Sprintf(`
		SELECT EXTRACT(DOW FROM started_at)::int,
		       COALESCE(SUM(total_watch_ms), 0)::bigint,
		       COUNT(*)::int
		FROM watch_sessions
		WHERE started_at >= $1 AND started_at < $2%s
		GROUP BY 1
		ORDER BY 1`, chFilter)
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []DowPoint
	for rows.Next() {
		var p DowPoint
		if err := rows.Scan(&p.DayOfWeek, &p.TotalWatchMs, &p.Sessions); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type GeoPoint struct {
	CountryCode  string `json:"country_code"`
	Sessions     int    `json:"sessions"`
	TotalWatchMs int64  `json:"total_watch_ms"`
}

func (r *Repository) ByCountry(ctx context.Context, channelID *uuid.UUID, from, to time.Time) ([]GeoPoint, error) {
	args := []any{from, to}
	chFilter := ""
	if channelID != nil {
		chFilter = " AND channel_id = $3"
		args = append(args, *channelID)
	}
	q := fmt.Sprintf(`
		SELECT COALESCE(country_code, 'XX'),
		       COUNT(*)::int,
		       COALESCE(SUM(total_watch_ms), 0)::bigint
		FROM watch_sessions
		WHERE started_at >= $1 AND started_at < $2%s
		GROUP BY 1
		ORDER BY 3 DESC
		LIMIT 20`, chFilter)
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []GeoPoint
	for rows.Next() {
		var p GeoPoint
		if err := rows.Scan(&p.CountryCode, &p.Sessions, &p.TotalWatchMs); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
