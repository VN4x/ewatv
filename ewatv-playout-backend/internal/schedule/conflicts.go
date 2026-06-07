package schedule

import (
	"time"

	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

type ConflictKind string

const (
	ConflictOverlap ConflictKind = "overlap"
	ConflictGap     ConflictKind = "gap"
)

// ScheduleConflict describes an overlap or unexpected gap between consecutive items.
type ScheduleConflict struct {
	Kind           ConflictKind `json:"kind"`
	Position       int          `json:"position"`
	NextPosition   int          `json:"next_position,omitempty"`
	GapMs          int          `json:"gap_ms,omitempty"`
	OverlapMs      int          `json:"overlap_ms,omitempty"`
	ExpectedStart  *time.Time   `json:"expected_start,omitempty"`
	ActualStart    *time.Time   `json:"actual_start,omitempty"`
}

// DetectConflicts finds overlaps and unexpected gaps in ordered schedule items.
// Items are compared by position; each item's end is start_at + duration_ms + transition_ms.
func DetectConflicts(items []models.ScheduleItem) []ScheduleConflict {
	if len(items) < 2 {
		return nil
	}

	sorted := append([]models.ScheduleItem(nil), items...)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].Position < sorted[i].Position {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	var conflicts []ScheduleConflict
	for i := 0; i < len(sorted)-1; i++ {
		cur := sorted[i]
		next := sorted[i+1]

		curEnd := cur.StartAt.Add(time.Duration(cur.DurationMs+cur.TransitionMs) * time.Millisecond)
		expectedNext := curEnd

		if next.StartAt.Before(expectedNext) {
			overlap := expectedNext.Sub(next.StartAt).Milliseconds()
			if overlap > 0 {
				conflicts = append(conflicts, ScheduleConflict{
					Kind:          ConflictOverlap,
					Position:      cur.Position,
					NextPosition:  next.Position,
					OverlapMs:     int(overlap),
					ExpectedStart: &expectedNext,
					ActualStart:   &next.StartAt,
				})
			}
			continue
		}

		gap := next.StartAt.Sub(expectedNext).Milliseconds()
		if gap > 0 {
			conflicts = append(conflicts, ScheduleConflict{
				Kind:          ConflictGap,
				Position:      cur.Position,
				NextPosition:  next.Position,
				GapMs:         int(gap),
				ExpectedStart: &expectedNext,
				ActualStart:   &next.StartAt,
			})
		}
	}
	return conflicts
}

// HasOverlaps returns true when any overlap conflict exists.
func HasOverlaps(conflicts []ScheduleConflict) bool {
	for _, c := range conflicts {
		if c.Kind == ConflictOverlap {
			return true
		}
	}
	return false
}
