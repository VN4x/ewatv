package schedule

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

type CreateScheduleInput struct {
	ChannelID    uuid.UUID
	OwnerID      uuid.UUID
	ScheduleDate string
	Autopilot    bool
}

type ReplaceItemInput struct {
	VideoID      *uuid.UUID
	Position     int
	StartAt      time.Time
	DurationMs   int
	TransitionMs int
	SourceSnap   models.SourceSnapshot
}

func (r *Repository) CreateSchedule(ctx context.Context, in CreateScheduleInput) (*models.Schedule, error) {
	const q = `
		INSERT INTO schedules (channel_id, owner_id, schedule_date, autopilot)
		VALUES ($1, $2, $3::date, $4)
		RETURNING id, channel_id, owner_id, schedule_date::text, autopilot, created_at, updated_at`
	row := r.pool.QueryRow(ctx, q, in.ChannelID, in.OwnerID, in.ScheduleDate, in.Autopilot)
	return scanSchedule(row)
}

func (r *Repository) GetScheduleByID(ctx context.Context, id uuid.UUID) (*models.Schedule, error) {
	const q = `
		SELECT id, channel_id, owner_id, schedule_date::text, autopilot, created_at, updated_at
		FROM schedules WHERE id = $1`
	row := r.pool.QueryRow(ctx, q, id)
	s, err := scanSchedule(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("schedule not found")
		}
		return nil, err
	}
	return s, nil
}

func (r *Repository) GetByChannelDate(ctx context.Context, channelID uuid.UUID, date string) (*models.Schedule, []models.ScheduleItem, error) {
	const q = `
		SELECT id, channel_id, owner_id, schedule_date::text, autopilot, created_at, updated_at
		FROM schedules WHERE channel_id = $1 AND schedule_date = $2::date`
	row := r.pool.QueryRow(ctx, q, channelID, date)
	s, err := scanSchedule(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, nil
		}
		return nil, nil, err
	}

	items, err := r.ListItems(ctx, s.ID)
	if err != nil {
		return nil, nil, err
	}
	return s, items, nil
}

func (r *Repository) ListForChannel(ctx context.Context, channelID, ownerID uuid.UUID) ([]models.Schedule, error) {
	const q = `
		SELECT id, channel_id, owner_id, schedule_date::text, autopilot, created_at, updated_at
		FROM schedules
		WHERE channel_id = $1 AND owner_id = $2
		ORDER BY schedule_date ASC`
	rows, err := r.pool.Query(ctx, q, channelID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Schedule
	for rows.Next() {
		s, err := scanSchedule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

func (r *Repository) UpdateScheduleAutopilot(ctx context.Context, id, ownerID uuid.UUID, autopilot bool) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE schedules SET autopilot=$3, updated_at=now()
		WHERE id=$1 AND owner_id=$2`, id, ownerID, autopilot)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("schedule not found")
	}
	return nil
}

func (r *Repository) ListItems(ctx context.Context, scheduleID uuid.UUID) ([]models.ScheduleItem, error) {
	const q = `
		SELECT id, schedule_id, owner_id, video_id, position, start_at,
			duration_ms, transition_ms, source_snapshot, created_at
		FROM schedule_items
		WHERE schedule_id = $1
		ORDER BY position ASC`
	rows, err := r.pool.Query(ctx, q, scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.ScheduleItem
	for rows.Next() {
		it, err := scanScheduleItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *it)
	}
	return out, rows.Err()
}

func (r *Repository) ReplaceItems(ctx context.Context, scheduleID, ownerID uuid.UUID, items []ReplaceItemInput) ([]models.ScheduleItem, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM schedule_items WHERE schedule_id = $1`, scheduleID); err != nil {
		return nil, err
	}

	if len(items) == 0 {
		if _, err := tx.Exec(ctx, `UPDATE schedules SET updated_at=now() WHERE id=$1`, scheduleID); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return nil, nil
	}

	const ins = `
		INSERT INTO schedule_items (
			schedule_id, owner_id, video_id, position, start_at,
			duration_ms, transition_ms, source_snapshot
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, schedule_id, owner_id, video_id, position, start_at,
			duration_ms, transition_ms, source_snapshot, created_at`

	var out []models.ScheduleItem
	for _, it := range items {
		snap, err := json.Marshal(it.SourceSnap)
		if err != nil {
			return nil, err
		}
		row := tx.QueryRow(ctx, ins,
			scheduleID, ownerID, it.VideoID, it.Position, it.StartAt,
			it.DurationMs, it.TransitionMs, snap,
		)
		si, err := scanScheduleItem(row)
		if err != nil {
			return nil, err
		}
		out = append(out, *si)
	}

	if _, err := tx.Exec(ctx, `UPDATE schedules SET updated_at=now() WHERE id=$1`, scheduleID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repository) GetChannelByID(ctx context.Context, id uuid.UUID) (*models.Channel, error) {
	const q = `
		SELECT id, owner_id, name, slug, stream_name, timezone,
			overlay_logo_url, fallback_youtube_url, settings, playout_active,
			created_at, updated_at
		FROM channels WHERE id = $1`
	row := r.pool.QueryRow(ctx, q, id)
	var ch models.Channel
	err := row.Scan(
		&ch.ID, &ch.OwnerID, &ch.Name, &ch.Slug, &ch.StreamName, &ch.Timezone,
		&ch.OverlayLogoURL, &ch.FallbackURL, &ch.Settings, &ch.PlayoutActive,
		&ch.CreatedAt, &ch.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("channel not found")
		}
		return nil, err
	}
	return &ch, nil
}

func (r *Repository) ListAutopilotVideos(ctx context.Context, ownerID uuid.UUID) ([]AutopilotVideo, error) {
	const q = `SELECT id, title, length_sec, category, daypart, source_type, source_ref
		FROM videos WHERE owner_id = $1 ORDER BY title`
	rows, err := r.pool.Query(ctx, q, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AutopilotVideo
	for rows.Next() {
		var v AutopilotVideo
		var id uuid.UUID
		var dp, st string
		if err := rows.Scan(&id, &v.Title, &v.LengthSec, &v.Category, &dp, &st, &v.SourceRef); err != nil {
			return nil, err
		}
		v.ID = id.String()
		v.Daypart = models.Daypart(dp)
		v.SourceType = models.VideoSource(st)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (r *Repository) EnsureScheduleRow(ctx context.Context, channelID, ownerID uuid.UUID, scheduleDate string) (uuid.UUID, error) {
	sched, _, err := r.GetByChannelDate(ctx, channelID, scheduleDate)
	if err != nil {
		return uuid.Nil, err
	}
	if sched != nil {
		if err := r.UpdateScheduleAutopilot(ctx, sched.ID, ownerID, true); err != nil {
			return uuid.Nil, err
		}
		return sched.ID, nil
	}
	created, err := r.CreateSchedule(ctx, CreateScheduleInput{
		ChannelID:    channelID,
		OwnerID:      ownerID,
		ScheduleDate: scheduleDate,
		Autopilot:    true,
	})
	if err != nil {
		return uuid.Nil, err
	}
	return created.ID, nil
}

func (r *Repository) CountScheduleItems(ctx context.Context, scheduleID uuid.UUID) (int, error) {
	var count int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM schedule_items WHERE schedule_id = $1`, scheduleID,
	).Scan(&count)
	return count, err
}

func (r *Repository) ReplaceAutopilotItems(ctx context.Context, scheduleID, ownerID uuid.UUID, items []GeneratedScheduleItem) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM schedule_items WHERE schedule_id = $1`, scheduleID); err != nil {
		return err
	}

	for i, it := range items {
		videoID, err := uuid.Parse(it.VideoID)
		if err != nil {
			return fmt.Errorf("invalid video_id: %w", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO schedule_items (
				schedule_id, owner_id, video_id, position, start_at,
				duration_ms, transition_ms, source_snapshot
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			scheduleID, ownerID, videoID, i, it.StartAt, it.DurationMs, it.TransitionMs, it.SourceSnapshot,
		)
		if err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `UPDATE schedules SET autopilot = true, updated_at = now() WHERE id = $1`, scheduleID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repository) DeleteSchedule(ctx context.Context, id, ownerID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM schedules WHERE id=$1 AND owner_id=$2`, id, ownerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("schedule not found")
	}
	return nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanSchedule(row scannable) (*models.Schedule, error) {
	var s models.Schedule
	err := row.Scan(&s.ID, &s.ChannelID, &s.OwnerID, &s.ScheduleDate, &s.Autopilot, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func scanScheduleItem(row scannable) (*models.ScheduleItem, error) {
	var it models.ScheduleItem
	var snap json.RawMessage
	err := row.Scan(
		&it.ID, &it.ScheduleID, &it.OwnerID, &it.VideoID, &it.Position, &it.StartAt,
		&it.DurationMs, &it.TransitionMs, &snap, &it.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	if len(snap) > 0 && string(snap) != "null" {
		_ = json.Unmarshal(snap, &it.SourceSnap)
	}
	return &it, nil
}
