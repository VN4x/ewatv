package playout

import (
	"context"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/vn4x/ewatv-playout-backend/internal/config"
	"github.com/vn4x/ewatv-playout-backend/internal/ingest"
	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

type channelRuntime struct {
	channel          models.Channel
	items            []ItemWithVideo
	scheduleDate     string
	nowPlaying       NowPlayingResult
	masterManifest   []byte
	masterETag       string
	variantManifest  map[string][]byte
	variantETag      map[string]string
	liveBaseDir      string
	currentItem      *uuid.UUID
	offsetMs         int
}

type Engine struct {
	repo *Repository
	cfg  *config.Config
	log  zerolog.Logger

	mu       sync.RWMutex
	channels map[uuid.UUID]*channelRuntime
}

func NewEngine(repo *Repository, cfg *config.Config, log zerolog.Logger) *Engine {
	return &Engine{
		repo:     repo,
		cfg:      cfg,
		log:      log.With().Str("component", "playout-engine").Logger(),
		channels: make(map[uuid.UUID]*channelRuntime),
	}
}

func (e *Engine) Run(ctx context.Context) {
	refresh := time.NewTicker(30 * time.Second)
	defer refresh.Stop()

	e.refreshChannels(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-refresh.C:
			e.refreshChannels(ctx)
		}
	}
}

func (e *Engine) refreshChannels(ctx context.Context) {
	active, err := e.repo.ListActiveChannels(ctx)
	if err != nil {
		e.log.Error().Err(err).Msg("list active channels")
		return
	}

	activeSet := make(map[uuid.UUID]bool, len(active))
	for _, ch := range active {
		activeSet[ch.ID] = true
		e.ensureChannelLoop(ctx, ch)
	}

	e.mu.Lock()
	for id := range e.channels {
		if !activeSet[id] {
			delete(e.channels, id)
		}
	}
	e.mu.Unlock()
}

func (e *Engine) ensureChannelLoop(ctx context.Context, ch models.Channel) {
	e.mu.RLock()
	_, exists := e.channels[ch.ID]
	e.mu.RUnlock()
	if exists {
		return
	}

	rt := &channelRuntime{
		channel:         ch,
		liveBaseDir:     filepath.Join(e.cfg.Storage.ChannelsPath(), ch.Slug, "live"),
		variantManifest: make(map[string][]byte),
		variantETag:     make(map[string]string),
	}
	e.mu.Lock()
	e.channels[ch.ID] = rt
	e.mu.Unlock()

	interval := e.cfg.Playout.TickInterval
	if interval <= 0 {
		interval = 500 * time.Millisecond
	}

	go e.channelLoop(ctx, ch.ID, interval)
}

func (e *Engine) channelLoop(ctx context.Context, channelID uuid.UUID, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := e.tick(ctx, channelID); err != nil {
				e.log.Warn().Err(err).Str("channel_id", channelID.String()).Msg("playout tick")
			}
		}
	}
}

func (e *Engine) tick(ctx context.Context, channelID uuid.UUID) error {
	e.mu.RLock()
	rt, ok := e.channels[channelID]
	e.mu.RUnlock()
	if !ok {
		return nil
	}

	ch := rt.channel
	loc, err := ChannelLocation(ch, e.cfg.Playout.Timezone)
	if err != nil {
		return err
	}

	at := time.Now().In(loc)
	today := TodayInTimezone(loc, at)

	items := rt.items
	if rt.scheduleDate != today {
		items, err = e.loadTodaySchedule(ctx, ch, today)
		if err != nil {
			return err
		}
	}

	hlsURL := e.cfg.Playout.HLSURL(ch.Slug)
	now := ComputeNowPlaying(ch, items, at, hlsURL)

	var itemID *uuid.UUID
	offsetMs := 0
	startIdx := -1
	itemOffset := 0

	if pos, found := FindPosition(items, at); found {
		id := items[pos.ItemIndex].Item.ID
		itemID = &id
		if pos.InGap || pos.InTransition {
			offsetMs = pos.OffsetMs
		} else {
			offsetMs = min(pos.OffsetMs, items[pos.ItemIndex].Item.DurationMs-1)
		}
		startIdx = pos.ItemIndex
		itemOffset = offsetMs
	}

	masterManifest := rt.masterManifest
	masterETag := rt.masterETag
	variantManifest := make(map[string][]byte)
	variantETag := make(map[string]string)

	if startIdx >= 0 {
		for _, rend := range ingest.DefaultRenditions {
			liveDir := filepath.Join(rt.liveBaseDir, rend.Name)
			res, err := BuildLiveManifest(ManifestInput{
				Items:          items,
				StartItemIdx:   startIdx,
				OffsetMs:       itemOffset,
				WindowSegments: e.cfg.Playout.ManifestWindowSegments,
				LiveDir:        liveDir,
				Storage:        e.cfg.Storage,
				At:             at,
				Rendition:      rend.Name,
			})
			if err != nil {
				e.log.Warn().Err(err).Str("slug", ch.Slug).Str("rendition", rend.Name).Msg("build manifest")
				continue
			}
			if res != nil {
				variantManifest[rend.Name] = res.Body
				variantETag[rend.Name] = res.ETag
			}
		}
		masterManifest = BuildMasterManifest(ch.Slug, ingest.DefaultRenditions)
		masterETag = hashBytes(masterManifest)
	}

	var schedDatePtr *string
	if today != "" {
		schedDatePtr = &today
	}
	if err := e.repo.UpsertPlayoutState(ctx, ch.ID, schedDatePtr, itemID, offsetMs, masterETag); err != nil {
		e.log.Warn().Err(err).Str("slug", ch.Slug).Msg("update playout_state")
	}

	e.mu.Lock()
	if rt, ok := e.channels[channelID]; ok {
		rt.items = items
		rt.scheduleDate = today
		rt.nowPlaying = now
		rt.masterManifest = masterManifest
		rt.masterETag = masterETag
		rt.variantManifest = variantManifest
		rt.variantETag = variantETag
		rt.currentItem = itemID
		rt.offsetMs = offsetMs
	}
	e.mu.Unlock()

	return nil
}

func (e *Engine) loadTodaySchedule(ctx context.Context, ch models.Channel, today string) ([]ItemWithVideo, error) {
	sched, err := e.repo.GetScheduleByDate(ctx, ch.ID, today)
	if err != nil {
		return nil, err
	}
	if sched == nil {
		return nil, nil
	}
	return e.repo.ListScheduleItems(ctx, sched.ID)
}

func (e *Engine) GetNowPlaying(slug string) (NowPlayingResult, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, rt := range e.channels {
		if rt.channel.Slug == slug {
			return rt.nowPlaying, true
		}
	}
	return NowPlayingResult{}, false
}

func (e *Engine) NowPlayingForChannel(ctx context.Context, slug string) (NowPlayingResult, error) {
	if cached, ok := e.GetNowPlaying(slug); ok {
		return cached, nil
	}

	ch, err := e.repo.GetChannelBySlug(ctx, slug)
	if err != nil {
		return NowPlayingResult{}, err
	}

	loc, err := ChannelLocation(*ch, e.cfg.Playout.Timezone)
	if err != nil {
		return NowPlayingResult{}, err
	}
	at := time.Now().In(loc)
	today := TodayInTimezone(loc, at)

	items, err := e.loadTodaySchedule(ctx, *ch, today)
	if err != nil {
		return NowPlayingResult{}, err
	}

	return ComputeNowPlaying(*ch, items, at, e.cfg.Playout.HLSURL(ch.Slug)), nil
}

type ManifestView struct {
	Body []byte
	ETag string
	Dir  string
}

func (e *Engine) GetManifest(slug string) (ManifestView, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, rt := range e.channels {
		if rt.channel.Slug == slug && len(rt.masterManifest) > 0 {
			return ManifestView{Body: rt.masterManifest, ETag: rt.masterETag, Dir: rt.liveBaseDir}, true
		}
	}
	return ManifestView{}, false
}

func (e *Engine) GetVariantManifest(slug, variant string) (ManifestView, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, rt := range e.channels {
		if rt.channel.Slug != slug {
			continue
		}
		body, ok := rt.variantManifest[variant]
		if !ok || len(body) == 0 {
			return ManifestView{}, false
		}
		return ManifestView{
			Body: body,
			ETag: rt.variantETag[variant],
			Dir:  filepath.Join(rt.liveBaseDir, variant),
		}, true
	}
	return ManifestView{}, false
}

func (e *Engine) LiveDir(slug, variant string) (string, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, rt := range e.channels {
		if rt.channel.Slug == slug {
			if variant != "" {
				return filepath.Join(rt.liveBaseDir, variant), true
			}
			return rt.liveBaseDir, true
		}
	}
	return "", false
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
