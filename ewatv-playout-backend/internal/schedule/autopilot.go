package schedule

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"time"

	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

const (
	ms24h                        = 86_400_000
	defaultAutopilotTransitionMs = 2000
	categoryMemory               = 3
	maxAutopilotItems            = 500
)

// AutopilotVideo is the subset of video fields used for schedule generation.
type AutopilotVideo struct {
	ID         string
	Title      string
	LengthSec  int
	Category   *string
	Daypart    models.Daypart
	SourceType models.VideoSource
	SourceRef  string
}

// GeneratedScheduleItem is a generated timeline row ready for persistence.
type GeneratedScheduleItem struct {
	VideoID        string
	DurationMs     int
	TransitionMs   int
	StartAt        time.Time
	SourceSnapshot json.RawMessage
}

func videoMatchesSlot(video AutopilotVideo, slot SlotDaypart) bool {
	if video.Daypart == models.DaypartAny {
		return true
	}
	switch slot {
	case SlotPrimetime:
		return video.Daypart == models.DaypartPrimetime
	case SlotNight:
		return video.Daypart == models.DaypartNight
	default:
		return false
	}
}

func pickVideo(pool []AutopilotVideo, slot SlotDaypart, recentCategories []string) *AutopilotVideo {
	var candidates []AutopilotVideo
	for _, v := range pool {
		if !videoMatchesSlot(v, slot) {
			continue
		}
		if v.Category != nil && containsString(recentCategories, *v.Category) {
			continue
		}
		candidates = append(candidates, v)
	}

	var fallback []AutopilotVideo
	for _, v := range pool {
		if videoMatchesSlot(v, slot) {
			fallback = append(fallback, v)
		}
	}

	bag := candidates
	if len(bag) == 0 {
		bag = fallback
	}
	if len(bag) == 0 {
		bag = pool
	}
	if len(bag) == 0 {
		return nil
	}
	idx := rand.Intn(len(bag))
	v := bag[idx]
	return &v
}

func rememberCategory(recent []string, category *string) []string {
	if category == nil || *category == "" {
		return recent
	}
	recent = append(recent, *category)
	for len(recent) > categoryMemory {
		recent = recent[1:]
	}
	return recent
}

func containsString(list []string, target string) bool {
	for _, s := range list {
		if s == target {
			return true
		}
	}
	return false
}

type draftItem struct {
	videoID        string
	durationMs     int
	transitionMs   int
	sourceSnapshot json.RawMessage
}

// GenerateAutopilotScheduleItems builds a rule-based 24h fill with daypart-aware picks.
func GenerateAutopilotScheduleItems(
	pool []AutopilotVideo,
	scheduleDate string,
	transitionMs int,
) ([]GeneratedScheduleItem, error) {
	if len(pool) == 0 {
		return nil, fmt.Errorf("no videos in library — add videos in Collections first")
	}
	if transitionMs < 0 {
		transitionMs = 0
	}
	if transitionMs > 60000 {
		transitionMs = 60000
	}

	tz := GetAutopilotTimezone()
	dayStartMs, err := StartOfCalendarDayMs(scheduleDate, tz)
	if err != nil {
		return nil, err
	}
	dayEndMs := dayStartMs + ms24h
	dayStart := time.UnixMilli(dayStartMs).UTC()

	var recentCategories []string
	var drafts []draftItem

	cursorMs := dayStartMs
	for cursorMs < dayEndMs && len(drafts) < maxAutopilotItems {
		hour, err := HourInTz(time.UnixMilli(cursorMs).UTC(), tz)
		if err != nil {
			return nil, err
		}
		slot := SlotForLocalHour(hour)
		video := pickVideo(pool, slot, recentCategories)
		if video == nil {
			break
		}

		lengthSec := video.LengthSec
		if lengthSec < 1 {
			lengthSec = 1
		}
		durationMs := lengthSec * 1000
		remaining := dayEndMs - cursorMs
		if int64(durationMs+transitionMs) > remaining {
			break
		}

		snap, err := json.Marshal(map[string]any{
			"title":        video.Title,
			"source_type":  video.SourceType,
			"source_ref":   video.SourceRef,
			"category":     video.Category,
			"daypart":      video.Daypart,
			"generated_by": "autopilot",
		})
		if err != nil {
			return nil, err
		}

		drafts = append(drafts, draftItem{
			videoID:        video.ID,
			durationMs:     durationMs,
			transitionMs:   transitionMs,
			sourceSnapshot: snap,
		})
		recentCategories = rememberCategory(recentCategories, video.Category)
		cursorMs += int64(durationMs + transitionMs)
	}

	timeline := make([]TimelineItem, len(drafts))
	for i, d := range drafts {
		timeline[i] = TimelineItem{
			Position:     i,
			DurationMs:   d.durationMs,
			TransitionMs: d.transitionMs,
		}
	}

	withTimes := RecomputeStartTimes(timeline, dayStart)
	out := make([]GeneratedScheduleItem, len(drafts))
	for i, d := range drafts {
		startAt := dayStart
		if withTimes[i].StartAt != nil {
			startAt = *withTimes[i].StartAt
		}
		out[i] = GeneratedScheduleItem{
			VideoID:        d.videoID,
			DurationMs:     d.durationMs,
			TransitionMs:   d.transitionMs,
			StartAt:        startAt,
			SourceSnapshot: d.sourceSnapshot,
		}
	}
	return out, nil
}

// TransitionMsFromChannelSettings reads transition_ms from channel settings JSONB (default 2000).
func TransitionMsFromChannelSettings(raw json.RawMessage) int {
	if len(raw) == 0 {
		return defaultAutopilotTransitionMs
	}
	var s struct {
		TransitionMs *int `json:"transition_ms"`
	}
	if err := json.Unmarshal(raw, &s); err != nil || s.TransitionMs == nil {
		return defaultAutopilotTransitionMs
	}
	ms := *s.TransitionMs
	if ms < 0 {
		return 0
	}
	if ms > 60000 {
		return 60000
	}
	return ms
}
