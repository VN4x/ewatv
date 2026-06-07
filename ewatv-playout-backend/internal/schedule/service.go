package schedule

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/vn4x/ewatv-playout-backend/internal/models"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

type ItemInput struct {
	VideoID      *uuid.UUID
	DurationMs   int
	TransitionMs int
	SourceSnap   models.SourceSnapshot
}

type SaveScheduleInput struct {
	ChannelID          uuid.UUID
	OwnerID            uuid.UUID
	ScheduleDate       string
	Autopilot          bool
	ExistingScheduleID *uuid.UUID
	Items              []ItemInput
	RecomputeStartAt   bool
}

type ScheduleView struct {
	Schedule  models.Schedule       `json:"schedule"`
	Items     []models.ScheduleItem `json:"items"`
	Conflicts []ScheduleConflict    `json:"conflicts,omitempty"`
}

type AutopilotGeneratedDay struct {
	ScheduleID   uuid.UUID `json:"schedule_id"`
	ScheduleDate string    `json:"schedule_date"`
	ItemCount    int       `json:"item_count"`
}

type AutopilotSkippedDay struct {
	ScheduleDate string `json:"schedule_date,omitempty"`
	Reason       string `json:"reason"`
}

type AutopilotRunResult struct {
	Timezone  string                  `json:"timezone"`
	FromDate  string                  `json:"from_date"`
	Days      int                     `json:"days"`
	Generated []AutopilotGeneratedDay `json:"generated"`
	Skipped   []AutopilotSkippedDay   `json:"skipped"`
}

func (s *Service) GetSchedule(ctx context.Context, channelID uuid.UUID, date string, ownerID uuid.UUID) (*ScheduleView, error) {
	ch, err := s.repo.GetChannelByID(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if ch.OwnerID != ownerID {
		return nil, fmt.Errorf("forbidden")
	}

	sched, items, err := s.repo.GetByChannelDate(ctx, channelID, date)
	if err != nil {
		return nil, err
	}
	if sched == nil {
		return nil, nil
	}

	conflicts := DetectConflicts(items)
	return &ScheduleView{
		Schedule:  *sched,
		Items:     items,
		Conflicts: conflicts,
	}, nil
}

func (s *Service) ListSchedulesForChannel(ctx context.Context, channelID, ownerID uuid.UUID) ([]models.Schedule, error) {
	ch, err := s.repo.GetChannelByID(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if ch.OwnerID != ownerID {
		return nil, fmt.Errorf("forbidden")
	}
	return s.repo.ListForChannel(ctx, channelID, ownerID)
}

func (s *Service) SaveSchedule(ctx context.Context, in SaveScheduleInput) (*ScheduleView, error) {
	ch, err := s.repo.GetChannelByID(ctx, in.ChannelID)
	if err != nil {
		return nil, err
	}
	if ch.OwnerID != in.OwnerID {
		return nil, fmt.Errorf("forbidden")
	}

	var sched *models.Schedule
	if in.ExistingScheduleID != nil {
		sched, err = s.repo.GetScheduleByID(ctx, *in.ExistingScheduleID)
		if err != nil {
			return nil, err
		}
		if sched.OwnerID != in.OwnerID || sched.ChannelID != in.ChannelID {
			return nil, fmt.Errorf("forbidden")
		}
		if err := s.repo.UpdateScheduleAutopilot(ctx, sched.ID, in.OwnerID, in.Autopilot); err != nil {
			return nil, err
		}
		sched.Autopilot = in.Autopilot
	} else {
		existing, _, err := s.repo.GetByChannelDate(ctx, in.ChannelID, in.ScheduleDate)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			sched = existing
			if err := s.repo.UpdateScheduleAutopilot(ctx, sched.ID, in.OwnerID, in.Autopilot); err != nil {
				return nil, err
			}
			sched.Autopilot = in.Autopilot
		} else {
			sched, err = s.repo.CreateSchedule(ctx, CreateScheduleInput{
				ChannelID:    in.ChannelID,
				OwnerID:      in.OwnerID,
				ScheduleDate: in.ScheduleDate,
				Autopilot:    in.Autopilot,
			})
			if err != nil {
				return nil, err
			}
		}
	}

	dayStart, err := DayStartInTimezone(in.ScheduleDate, ch.Timezone)
	if err != nil {
		return nil, fmt.Errorf("invalid timezone: %w", err)
	}

	timeline := make([]TimelineItem, len(in.Items))
	for i, it := range in.Items {
		timeline[i] = TimelineItem{
			Position:     i,
			DurationMs:   it.DurationMs,
			TransitionMs: it.TransitionMs,
		}
	}

	replace := make([]ReplaceItemInput, len(in.Items))
	if in.RecomputeStartAt || len(in.Items) > 0 {
		recomputed := RecomputeStartTimes(timeline, dayStart)
		for i, it := range in.Items {
			startAt := dayStart
			if i < len(recomputed) && recomputed[i].StartAt != nil {
				startAt = *recomputed[i].StartAt
			}
			replace[i] = ReplaceItemInput{
				VideoID:      it.VideoID,
				Position:     i,
				StartAt:      startAt,
				DurationMs:   it.DurationMs,
				TransitionMs: it.TransitionMs,
				SourceSnap:   it.SourceSnap,
			}
		}
	} else {
		for i, it := range in.Items {
			replace[i] = ReplaceItemInput{
				VideoID:      it.VideoID,
				Position:     i,
				StartAt:      dayStart,
				DurationMs:   it.DurationMs,
				TransitionMs: it.TransitionMs,
				SourceSnap:   it.SourceSnap,
			}
		}
	}

	savedItems, err := s.repo.ReplaceItems(ctx, sched.ID, in.OwnerID, replace)
	if err != nil {
		return nil, err
	}

	conflicts := DetectConflicts(savedItems)
	return &ScheduleView{
		Schedule:  *sched,
		Items:     savedItems,
		Conflicts: conflicts,
	}, nil
}

func (s *Service) DeleteSchedule(ctx context.Context, channelID, scheduleID, ownerID uuid.UUID) error {
	ch, err := s.repo.GetChannelByID(ctx, channelID)
	if err != nil {
		return err
	}
	if ch.OwnerID != ownerID {
		return fmt.Errorf("forbidden")
	}
	sched, err := s.repo.GetScheduleByID(ctx, scheduleID)
	if err != nil {
		return err
	}
	if sched.ChannelID != channelID || sched.OwnerID != ownerID {
		return fmt.Errorf("forbidden")
	}
	return s.repo.DeleteSchedule(ctx, scheduleID, ownerID)
}

func (s *Service) RunAutopilotForChannel(
	ctx context.Context,
	ownerID, channelID uuid.UUID,
	fromDate string,
	days int,
) (*AutopilotRunResult, error) {
	if days < 1 {
		days = 1
	}
	if days > 14 {
		days = 14
	}

	ch, err := s.repo.GetChannelByID(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if ch.OwnerID != ownerID {
		return nil, fmt.Errorf("forbidden")
	}

	tz := GetAutopilotTimezone()
	transitionMs := TransitionMsFromChannelSettings(ch.Settings)

	videos, err := s.repo.ListAutopilotVideos(ctx, ownerID)
	if err != nil {
		return nil, err
	}

	result := &AutopilotRunResult{
		Timezone:  tz,
		FromDate:  fromDate,
		Days:      days,
		Generated: []AutopilotGeneratedDay{},
		Skipped:   []AutopilotSkippedDay{},
	}

	scheduleDate := fromDate
	for i := 0; i < days; i++ {
		if i > 0 {
			next, err := AddCalendarDays(fromDate, i, tz)
			if err != nil {
				return nil, err
			}
			scheduleDate = next
		}

		schedID, err := s.repo.EnsureScheduleRow(ctx, channelID, ownerID, scheduleDate)
		if err != nil {
			result.Skipped = append(result.Skipped, AutopilotSkippedDay{
				ScheduleDate: scheduleDate,
				Reason:       err.Error(),
			})
			continue
		}

		itemCount, err := s.repo.CountScheduleItems(ctx, schedID)
		if err != nil {
			result.Skipped = append(result.Skipped, AutopilotSkippedDay{
				ScheduleDate: scheduleDate,
				Reason:       err.Error(),
			})
			continue
		}
		if itemCount > 0 {
			result.Skipped = append(result.Skipped, AutopilotSkippedDay{
				ScheduleDate: scheduleDate,
				Reason:       fmt.Sprintf("Already has %d items (manual or prior autopilot)", itemCount),
			})
			continue
		}

		items, err := GenerateAutopilotScheduleItems(videos, scheduleDate, transitionMs)
		if err != nil {
			result.Skipped = append(result.Skipped, AutopilotSkippedDay{
				ScheduleDate: scheduleDate,
				Reason:       err.Error(),
			})
			continue
		}

		if err := s.repo.ReplaceAutopilotItems(ctx, schedID, ownerID, items); err != nil {
			result.Skipped = append(result.Skipped, AutopilotSkippedDay{
				ScheduleDate: scheduleDate,
				Reason:       err.Error(),
			})
			continue
		}

		result.Generated = append(result.Generated, AutopilotGeneratedDay{
			ScheduleID:   schedID,
			ScheduleDate: scheduleDate,
			ItemCount:    len(items),
		})
	}

	return result, nil
}

func ValidateScheduleDate(date string) error {
	if _, err := time.Parse("2006-01-02", date); err != nil {
		return fmt.Errorf("invalid schedule_date")
	}
	return nil
}
