package playout

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

func (r *Repository) ListActiveChannels(ctx context.Context) ([]models.Channel, error) {
	const q = `SELECT id, owner_id, name, slug, stream_name, timezone, overlay_logo_url,
		fallback_youtube_url, settings, playout_active, created_at, updated_at
		FROM channels WHERE playout_active = true ORDER BY slug`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Channel
	for rows.Next() {
		ch, err := scanChannel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *ch)
	}
	return out, rows.Err()
}

func (r *Repository) GetChannelBySlug(ctx context.Context, slug string) (*models.Channel, error) {
	const q = `SELECT id, owner_id, name, slug, stream_name, timezone, overlay_logo_url,
		fallback_youtube_url, settings, playout_active, created_at, updated_at
		FROM channels WHERE slug = $1`

	row := r.pool.QueryRow(ctx, q, slug)
	ch, err := scanChannel(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("channel not found")
		}
		return nil, err
	}
	return ch, nil
}

func (r *Repository) GetScheduleByDate(ctx context.Context, channelID uuid.UUID, scheduleDate string) (*models.Schedule, error) {
	const q = `SELECT id, channel_id, owner_id, schedule_date, autopilot, created_at, updated_at
		FROM schedules WHERE channel_id = $1 AND schedule_date = $2::date`

	row := r.pool.QueryRow(ctx, q, channelID, scheduleDate)
	var s models.Schedule
	var date time.Time
	if err := row.Scan(&s.ID, &s.ChannelID, &s.OwnerID, &date, &s.Autopilot, &s.CreatedAt, &s.UpdatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	s.ScheduleDate = date.Format("2006-01-02")
	return &s, nil
}

type ItemWithVideo struct {
	Item  models.ScheduleItem
	Video *models.Video
}

func (r *Repository) ListScheduleItems(ctx context.Context, scheduleID uuid.UUID) ([]ItemWithVideo, error) {
	const q = `SELECT
		si.id, si.schedule_id, si.owner_id, si.video_id, si.position, si.start_at,
		si.duration_ms, si.transition_ms, si.source_snapshot, si.created_at,
		v.id, v.owner_id, v.collection_id, v.title, v.description, v.length_sec,
		v.source_type, v.source_ref, v.storage_path, v.width, v.height, v.codec_video,
		v.codec_audio, v.thumbnail_path, v.pack_status, v.tags, v.category, v.daypart,
		v.hide_overlay, v.auto_subs, v.created_at, v.updated_at
		FROM schedule_items si
		LEFT JOIN videos v ON v.id = si.video_id
		WHERE si.schedule_id = $1
		ORDER BY si.position`

	rows, err := r.pool.Query(ctx, q, scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ItemWithVideo
	for rows.Next() {
		var iv ItemWithVideo
		var snapRaw []byte
		var vidID, vidOwnerID, vidCollID *uuid.UUID
		var vidTitle, vidSourceRef, vidStorage, vidCodecV, vidCodecA, vidThumb, vidCategory *string
		var vidDesc *string
		var vidLen *int
		var vidPack *string
		var vidTags []string
		var vidDaypart *string
		var vidHide, vidAuto *bool
		var vidCreated, vidUpdated *time.Time
		var vidSourceType *string
		var vidWidth, vidHeight *int

		err := rows.Scan(
			&iv.Item.ID, &iv.Item.ScheduleID, &iv.Item.OwnerID, &iv.Item.VideoID, &iv.Item.Position,
			&iv.Item.StartAt, &iv.Item.DurationMs, &iv.Item.TransitionMs, &snapRaw, &iv.Item.CreatedAt,
			&vidID, &vidOwnerID, &vidCollID, &vidTitle, &vidDesc, &vidLen,
			&vidSourceType, &vidSourceRef, &vidStorage, &vidWidth, &vidHeight, &vidCodecV, &vidCodecA,
			&vidThumb, &vidPack, &vidTags, &vidCategory, &vidDaypart, &vidHide, &vidAuto,
			&vidCreated, &vidUpdated,
		)
		if err != nil {
			return nil, err
		}
		_ = json.Unmarshal(snapRaw, &iv.Item.SourceSnap)

		if vidID != nil {
			v := models.Video{
				ID:           *vidID,
				OwnerID:      derefUUID(vidOwnerID),
				Title:        derefStr(vidTitle),
				Description:  vidDesc,
				LengthSec:    derefInt(vidLen),
				SourceRef:    derefStr(vidSourceRef),
				StoragePath:  vidStorage,
				Width:        vidWidth,
				Height:       vidHeight,
				CodecVideo:   vidCodecV,
				CodecAudio:   vidCodecA,
				ThumbnailPath: vidThumb,
				PackStatus:   derefStr(vidPack),
				Tags:         vidTags,
				Category:     vidCategory,
				HideOverlay:  derefBool(vidHide),
				AutoSubs:     derefBool(vidAuto),
			}
			if vidCollID != nil {
				v.CollectionID = vidCollID
			}
			if vidSourceType != nil {
				v.SourceType = models.VideoSource(*vidSourceType)
			}
			if vidDaypart != nil {
				v.Daypart = models.Daypart(*vidDaypart)
			}
			if vidCreated != nil {
				v.CreatedAt = *vidCreated
			}
			if vidUpdated != nil {
				v.UpdatedAt = *vidUpdated
			}
			iv.Video = &v
		}
		out = append(out, iv)
	}
	return out, rows.Err()
}

func (r *Repository) UpsertPlayoutState(ctx context.Context, channelID uuid.UUID, scheduleDate *string, itemID *uuid.UUID, offsetMs int, etag string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO playout_state (channel_id, schedule_date, current_item_id, offset_ms, manifest_etag, updated_at)
		VALUES ($1, $2::date, $3, $4, $5, now())
		ON CONFLICT (channel_id) DO UPDATE SET
			schedule_date = EXCLUDED.schedule_date,
			current_item_id = EXCLUDED.current_item_id,
			offset_ms = EXCLUDED.offset_ms,
			manifest_etag = EXCLUDED.manifest_etag,
			updated_at = now()`,
		channelID, scheduleDate, itemID, offsetMs, nullIfEmpty(etag),
	)
	return err
}

type scannable interface {
	Scan(dest ...any) error
}

func scanChannel(row scannable) (*models.Channel, error) {
	var ch models.Channel
	var settings []byte
	if err := row.Scan(
		&ch.ID, &ch.OwnerID, &ch.Name, &ch.Slug, &ch.StreamName, &ch.Timezone,
		&ch.OverlayLogoURL, &ch.FallbackURL, &settings, &ch.PlayoutActive,
		&ch.CreatedAt, &ch.UpdatedAt,
	); err != nil {
		return nil, err
	}
	ch.Settings = settings
	return &ch, nil
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func derefInt(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func derefBool(p *bool) bool {
	if p == nil {
		return false
	}
	return *p
}

func derefUUID(p *uuid.UUID) uuid.UUID {
	if p == nil {
		return uuid.Nil
	}
	return *p
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
