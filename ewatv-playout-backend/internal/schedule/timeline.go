package schedule

import "time"

// DefaultScheduleGapMs is the default gap between videos when auto-inserting black screens.
const DefaultScheduleGapMs = 1500

// TimelineItem is a lightweight slot used for start_at recomputation.
type TimelineItem struct {
	ID            *string
	Position      int
	DurationMs    int
	TransitionMs  int
	StartAt       *time.Time
}

// RecomputeStartTimes assigns start_at sequentially from dayStart using duration_ms + transition_ms.
func RecomputeStartTimes(items []TimelineItem, dayStart time.Time) []TimelineItem {
	if len(items) == 0 {
		return nil
	}

	sorted := make([]TimelineItem, len(items))
	copy(sorted, items)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].Position < sorted[i].Position {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	cursor := dayStart
	out := make([]TimelineItem, len(sorted))
	for i, item := range sorted {
		start := cursor
		item.StartAt = &start
		out[i] = item
		cursor = cursor.Add(time.Duration(item.DurationMs+item.TransitionMs) * time.Millisecond)
	}
	return out
}

// DayStartInTimezone returns midnight on scheduleDate in the given IANA timezone.
func DayStartInTimezone(scheduleDate, timezone string) (time.Time, error) {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return time.Time{}, err
	}
	return time.ParseInLocation("2006-01-02", scheduleDate, loc)
}
