package playout

import (
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

const segmentDurationMs = 2000

var streamNameSanitizer = regexp.MustCompile(`[^a-z0-9._-]+`)

// OverlayConfig mirrors ewatv src/lib/channels/settings.ts OverlayConfig.
type OverlayConfig struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	URL        string  `json:"url"`
	Anchor     string  `json:"anchor"`
	OffsetXPct float64 `json:"offsetXPct"`
	OffsetYPct float64 `json:"offsetYPct"`
	WidthPct   float64 `json:"widthPct"`
	Opacity    float64 `json:"opacity"`
	Enabled    bool    `json:"enabled"`
}

// NowPlayingCurrent matches ewatv playout.functions.ts current block.
type NowPlayingCurrent struct {
	Title       string  `json:"title"`
	Description *string `json:"description"`
	StartedAt   string  `json:"startedAt"`
	DurationMs  int     `json:"durationMs"`
	HideOverlay bool    `json:"hideOverlay"`
	VideoID     *string `json:"videoId"`
	IsGap       bool    `json:"isGap"`
}

// NowPlayingNext matches ewatv playout.functions.ts next block.
type NowPlayingNext struct {
	Title       string  `json:"title"`
	Description *string `json:"description"`
	StartsAt    string  `json:"startsAt"`
	DurationMs  int     `json:"durationMs"`
}

// NowPlayingResult matches ewatv src/lib/api/playout.functions.ts NowPlayingResult.
type NowPlayingResult struct {
	StreamName         string             `json:"streamName"`
	HLSURL             *string            `json:"hlsUrl"`
	FallbackYoutubeURL *string            `json:"fallbackYoutubeUrl"`
	ChannelName        string             `json:"channelName"`
	ChannelSlug        string             `json:"channelSlug"`
	OverlayLogoURL     *string            `json:"overlayLogoUrl"`
	Overlays           []OverlayConfig    `json:"overlays"`
	Current            *NowPlayingCurrent `json:"current"`
	Next               *NowPlayingNext    `json:"next"`
}

func SanitizeStreamName(s string) string {
	return streamNameSanitizer.ReplaceAllString(strings.ToLower(s), "-")
}

func ResolveOverlays(settings json.RawMessage, legacyLogoURL *string) []OverlayConfig {
	if len(settings) > 0 {
		var parsed struct {
			Overlays []OverlayConfig `json:"overlays"`
		}
		if err := json.Unmarshal(settings, &parsed); err == nil {
			var enabled []OverlayConfig
			for _, o := range parsed.Overlays {
				if o.Enabled && o.URL != "" {
					enabled = append(enabled, o)
				}
			}
			if len(enabled) > 0 {
				return enabled
			}
		}
	}
	if legacyLogoURL != nil && *legacyLogoURL != "" {
		return []OverlayConfig{{
			ID:       "default",
			Name:     "Logo",
			URL:      *legacyLogoURL,
			Anchor:   "br",
			WidthPct: 12,
			Opacity:  1,
			Enabled:  true,
		}}
	}
	return []OverlayConfig{}
}

func TodayInTimezone(loc *time.Location, at time.Time) string {
	return at.In(loc).Format("2006-01-02")
}

func ChannelLocation(ch models.Channel, fallback string) (*time.Location, error) {
	tz := ch.Timezone
	if tz == "" {
		tz = fallback
	}
	return time.LoadLocation(tz)
}

// Position describes the active schedule slot at wall time.
type Position struct {
	ItemIndex      int
	ItemID         string
	OffsetMs       int
	InGap          bool
	InTransition   bool
}

func FindPosition(items []ItemWithVideo, at time.Time) (Position, bool) {
	atMs := at.UnixMilli()
	for i, iv := range items {
		start := iv.Item.StartAt.UnixMilli()
		end := start + int64(iv.Item.DurationMs) + int64(iv.Item.TransitionMs)
		if atMs >= start && atMs < end {
			offset := int(atMs - start)
			inTransition := offset >= iv.Item.DurationMs
			return Position{
				ItemIndex:    i,
				ItemID:       iv.Item.ID.String(),
				OffsetMs:     offset,
				InGap:        isGapItem(iv) || inTransition,
				InTransition: inTransition,
			}, true
		}
	}
	return Position{}, false
}

func isGapItem(iv ItemWithVideo) bool {
	return iv.Item.SourceSnap.Kind == "gap"
}

func ComputeNowPlaying(ch models.Channel, items []ItemWithVideo, at time.Time, hlsURL string) NowPlayingResult {
	streamName := SanitizeStreamName(ch.StreamName)
	if streamName == "" {
		streamName = SanitizeStreamName(ch.Slug)
	}

	var hls *string
	if hlsURL != "" {
		hls = &hlsURL
	}

	base := NowPlayingResult{
		StreamName:         streamName,
		HLSURL:             hls,
		FallbackYoutubeURL: ch.FallbackURL,
		ChannelName:        ch.Name,
		ChannelSlug:        ch.Slug,
		OverlayLogoURL:     ch.OverlayLogoURL,
		Overlays:           ResolveOverlays(ch.Settings, ch.OverlayLogoURL),
	}

	if len(items) == 0 {
		return base
	}

	atMs := at.UnixMilli()
	pos, ok := FindPosition(items, at)
	if !ok {
		base.Next = findNextItem(items, atMs)
		return base
	}

	base.Current = itemToCurrent(items[pos.ItemIndex], atMs, pos.InGap || pos.InTransition)
	if pos.ItemIndex+1 < len(items) {
		base.Next = itemToNext(items[pos.ItemIndex+1])
	} else if n := findNextItem(items, atMs); n != nil {
		base.Next = n
	}
	return base
}

func findNextItem(items []ItemWithVideo, atMs int64) *NowPlayingNext {
	for _, iv := range items {
		if iv.Item.StartAt.UnixMilli() > atMs {
			return itemToNext(iv)
		}
	}
	return nil
}

func itemToCurrent(iv ItemWithVideo, atMs int64, treatAsGap bool) *NowPlayingCurrent {
	start := iv.Item.StartAt.UnixMilli()
	if !treatAsGap {
		treatAsGap = isGapItem(iv) || atMs >= start+int64(iv.Item.DurationMs)
	}

	cur := &NowPlayingCurrent{
		StartedAt:  iv.Item.StartAt.UTC().Format(time.RFC3339),
		DurationMs: iv.Item.DurationMs,
		IsGap:      treatAsGap,
	}

	if treatAsGap {
		cur.Title = "Intermission"
		cur.Description = nil
		cur.HideOverlay = false
		cur.VideoID = nil
		return cur
	}

	if iv.Video != nil {
		cur.Title = iv.Video.Title
		cur.Description = iv.Video.Description
		cur.HideOverlay = iv.Video.HideOverlay
		vid := iv.Video.ID.String()
		cur.VideoID = &vid
	} else if iv.Item.SourceSnap.Title != "" {
		cur.Title = iv.Item.SourceSnap.Title
	} else {
		cur.Title = "Untitled"
	}
	return cur
}

func itemToNext(iv ItemWithVideo) *NowPlayingNext {
	next := &NowPlayingNext{
		StartsAt:   iv.Item.StartAt.UTC().Format(time.RFC3339),
		DurationMs: iv.Item.DurationMs,
	}
	if isGapItem(iv) {
		next.Title = "Intermission"
		next.Description = nil
		return next
	}
	if iv.Video != nil {
		next.Title = iv.Video.Title
		next.Description = iv.Video.Description
	} else if iv.Item.SourceSnap.Title != "" {
		next.Title = iv.Item.SourceSnap.Title
	} else {
		next.Title = "Untitled"
	}
	return next
}

// SegmentIndex returns the zero-based CMAF segment index for offset within an item.
func SegmentIndex(offsetMs int) int {
	if offsetMs < 0 {
		return 0
	}
	return offsetMs / segmentDurationMs
}

// SegmentCount estimates how many 2s segments cover durationMs.
func SegmentCount(durationMs int) int {
	if durationMs <= 0 {
		return 0
	}
	return (durationMs + segmentDurationMs - 1) / segmentDurationMs
}
