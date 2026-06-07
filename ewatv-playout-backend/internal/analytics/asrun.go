package analytics

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// AsRunRecorder writes immutable as-run rows when the playout engine changes items.
type AsRunRecorder struct {
	repo *Repository
	log  zerolog.Logger

	mu    sync.Mutex
	open  map[uuid.UUID]openAsRun
}

type openAsRun struct {
	itemID uuid.UUID
}

func NewAsRunRecorder(repo *Repository, log zerolog.Logger) *AsRunRecorder {
	return &AsRunRecorder{
		repo: repo,
		log:  log.With().Str("component", "as-run").Logger(),
		open: make(map[uuid.UUID]openAsRun),
	}
}

// OnAirItem reports the current schedule item on a channel (call each engine tick).
func (r *AsRunRecorder) OnAirItem(
	ctx context.Context,
	channelID uuid.UUID,
	itemID *uuid.UUID,
	videoID *uuid.UUID,
	title string,
	isGap bool,
	at time.Time,
) {
	if r == nil || r.repo == nil || itemID == nil {
		return
	}

	r.mu.Lock()
	prev, had := r.open[channelID]
	if had && prev.itemID == *itemID {
		r.mu.Unlock()
		return
	}
	r.open[channelID] = openAsRun{itemID: *itemID}
	r.mu.Unlock()

	if had {
		if err := r.repo.CloseOpenAsRun(ctx, channelID, at); err != nil {
			r.log.Warn().Err(err).Str("channel_id", channelID.String()).Msg("close as-run")
		}
	}

	if title == "" {
		if isGap {
			title = "Intermission"
		} else {
			title = "Untitled"
		}
	}

	_, err := r.repo.InsertAsRun(ctx, AsRunEvent{
		ChannelID:      channelID,
		ScheduleItemID: itemID,
		VideoID:        videoID,
		Title:          title,
		IsGap:          isGap,
		StartedAt:      at,
	})
	if err != nil {
		r.log.Warn().Err(err).Str("channel_id", channelID.String()).Msg("insert as-run")
	}
}
