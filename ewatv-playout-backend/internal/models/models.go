package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// VideoSource matches ewatv Supabase enum video_source.
type VideoSource string

const (
	VideoSourceLocal    VideoSource = "local"
	VideoSourceDirectURL VideoSource = "direct_url"
	VideoSourceMegaS3   VideoSource = "mega_s3"
	VideoSourceYouTube  VideoSource = "youtube"
	VideoSourceVimeo    VideoSource = "vimeo"
	VideoSourceDailymotion VideoSource = "dailymotion"
)

type Daypart string

const (
	DaypartAny       Daypart = "any"
	DaypartPrimetime Daypart = "primetime"
	DaypartNight     Daypart = "night"
)

// Video is a library asset. Local playout uses StoragePath + packaged segments.
type Video struct {
	ID           uuid.UUID   `json:"id" db:"id"`
	OwnerID      uuid.UUID   `json:"owner_id" db:"owner_id"`
	CollectionID *uuid.UUID  `json:"collection_id,omitempty" db:"collection_id"`
	Title        string      `json:"title" db:"title"`
	Description  *string     `json:"description,omitempty" db:"description"`
	LengthSec    int         `json:"length_sec" db:"length_sec"`
	SourceType   VideoSource `json:"source_type" db:"source_type"`
	SourceRef    string      `json:"source_ref" db:"source_ref"`
	StoragePath  *string     `json:"storage_path,omitempty" db:"storage_path"`
	Width        *int        `json:"width,omitempty" db:"width"`
	Height       *int        `json:"height,omitempty" db:"height"`
	CodecVideo   *string     `json:"codec_video,omitempty" db:"codec_video"`
	CodecAudio   *string     `json:"codec_audio,omitempty" db:"codec_audio"`
	ThumbnailPath *string    `json:"thumbnail_path,omitempty" db:"thumbnail_path"`
	PackStatus   string      `json:"pack_status" db:"pack_status"` // pending|processing|ready|failed
	Tags         []string    `json:"tags" db:"tags"`
	Category     *string     `json:"category,omitempty" db:"category"`
	Daypart      Daypart     `json:"daypart" db:"daypart"`
	HideOverlay  bool        `json:"hide_overlay" db:"hide_overlay"`
	AutoSubs     bool        `json:"auto_subs" db:"auto_subs"`
	CreatedAt    time.Time   `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time   `json:"updated_at" db:"updated_at"`
}

// Channel represents a linear output (one HLS/DASH stream).
type Channel struct {
	ID                 uuid.UUID       `json:"id" db:"id"`
	OwnerID            uuid.UUID       `json:"owner_id" db:"owner_id"`
	Name               string          `json:"name" db:"name"`
	Slug               string          `json:"slug" db:"slug"`
	StreamName         string          `json:"stream_name" db:"stream_name"`
	Timezone           string          `json:"timezone" db:"timezone"`
	OverlayLogoURL     *string         `json:"overlay_logo_url,omitempty" db:"overlay_logo_url"`
	FallbackURL        *string         `json:"fallback_url,omitempty" db:"fallback_youtube_url"`
	Settings           json.RawMessage `json:"settings" db:"settings"`
	PlayoutActive      bool            `json:"playout_active" db:"playout_active"`
	CreatedAt          time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at" db:"updated_at"`
}

// Schedule is one calendar day timeline for a channel.
type Schedule struct {
	ID           uuid.UUID `json:"id" db:"id"`
	ChannelID    uuid.UUID `json:"channel_id" db:"channel_id"`
	OwnerID      uuid.UUID `json:"owner_id" db:"owner_id"`
	ScheduleDate string    `json:"schedule_date" db:"schedule_date"` // YYYY-MM-DD
	Autopilot    bool      `json:"autopilot" db:"autopilot"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// SourceSnapshot mirrors ewatv schedule_items.source_snapshot JSONB.
type SourceSnapshot struct {
	Kind       string      `json:"kind,omitempty"`
	Title      string      `json:"title,omitempty"`
	SourceType VideoSource `json:"source_type,omitempty"`
	SourceRef  string      `json:"source_ref,omitempty"`
}

// ScheduleItem is an ordered slot on a day timeline.
type ScheduleItem struct {
	ID           uuid.UUID       `json:"id" db:"id"`
	ScheduleID   uuid.UUID       `json:"schedule_id" db:"schedule_id"`
	OwnerID      uuid.UUID       `json:"owner_id" db:"owner_id"`
	VideoID      *uuid.UUID      `json:"video_id,omitempty" db:"video_id"`
	Position     int             `json:"position" db:"position"`
	StartAt      time.Time       `json:"start_at" db:"start_at"`
	DurationMs   int             `json:"duration_ms" db:"duration_ms"`
	TransitionMs int             `json:"transition_ms" db:"transition_ms"`
	SourceSnap   SourceSnapshot  `json:"source_snapshot" db:"source_snapshot"`
	CreatedAt    time.Time       `json:"created_at" db:"created_at"`
}

// Collection folder (optional grouping for videos).
type Collection struct {
	ID          uuid.UUID  `json:"id" db:"id"`
	OwnerID     uuid.UUID  `json:"owner_id" db:"owner_id"`
	ParentID    *uuid.UUID `json:"parent_id,omitempty" db:"parent_id"`
	Name        string     `json:"name" db:"name"`
	Description *string    `json:"description,omitempty" db:"description"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
}

// HealthResponse is returned by GET /health and /ready.
type HealthResponse struct {
	Status    string            `json:"status"`
	Version   string            `json:"version"`
	UptimeSec float64           `json:"uptime_sec"`
	Checks    map[string]string `json:"checks,omitempty"`
}
