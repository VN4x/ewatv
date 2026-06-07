package schedule

import (
	"fmt"
	"os"
	"time"
)

const (
	defaultAutopilotTZ   = "Europe/Helsinki"
	defaultAutopilotDays = 7
	msPerDay             = 86_400_000
)

// SlotDaypart is the scheduling slot derived from local hour.
type SlotDaypart string

const (
	SlotPrimetime SlotDaypart = "primetime"
	SlotNight     SlotDaypart = "night"
	SlotDay       SlotDaypart = "day"
)

// GetAutopilotTimezone returns AUTOPILOT_TIMEZONE or Europe/Helsinki.
func GetAutopilotTimezone() string {
	if tz := os.Getenv("AUTOPILOT_TIMEZONE"); tz != "" {
		return tz
	}
	return defaultAutopilotTZ
}

// GetAutopilotWeekDays returns AUTOPILOT_WEEK_DAYS clamped to 1..14 (default 7).
func GetAutopilotWeekDays() int {
	const fallback = defaultAutopilotDays
	raw := os.Getenv("AUTOPILOT_WEEK_DAYS")
	if raw == "" {
		return fallback
	}
	var n int
	if _, err := fmt.Sscanf(raw, "%d", &n); err != nil {
		return fallback
	}
	if n < 1 {
		return 1
	}
	if n > 14 {
		return 14
	}
	return n
}

// CalendarDateInTz formats instant as yyyy-MM-dd in the given IANA timezone.
func CalendarDateInTz(instant time.Time, timeZone string) (string, error) {
	loc, err := time.LoadLocation(timeZone)
	if err != nil {
		return "", fmt.Errorf("load timezone %q: %w", timeZone, err)
	}
	return instant.In(loc).Format("2006-01-02"), nil
}

// GetTodayInAutopilotTz returns today's calendar date in the autopilot timezone.
func GetTodayInAutopilotTz(now time.Time) (string, error) {
	return CalendarDateInTz(now, GetAutopilotTimezone())
}

// AddCalendarDays adds whole calendar days (v1: fixed 24h steps from local midnight).
func AddCalendarDays(dateStr string, deltaDays int, timeZone string) (string, error) {
	tz := timeZone
	if tz == "" {
		tz = GetAutopilotTimezone()
	}
	startMs, err := StartOfCalendarDayMs(dateStr, tz)
	if err != nil {
		return "", err
	}
	next := time.UnixMilli(startMs + int64(deltaDays)*msPerDay)
	return CalendarDateInTz(next, tz)
}

// HourInTz returns the local hour (0–23) for instant in timeZone.
func HourInTz(instant time.Time, timeZone string) (int, error) {
	loc, err := time.LoadLocation(timeZone)
	if err != nil {
		return 0, fmt.Errorf("load timezone %q: %w", timeZone, err)
	}
	return instant.In(loc).Hour(), nil
}

// StartOfCalendarDayMs returns UTC epoch ms for local midnight at the start of calendar date in timeZone.
func StartOfCalendarDayMs(dateStr, timeZone string) (int64, error) {
	var y, m, d int
	if _, err := fmt.Sscanf(dateStr, "%d-%d-%d", &y, &m, &d); err != nil {
		return 0, fmt.Errorf("invalid date %q: %w", dateStr, err)
	}
	loc, err := time.LoadLocation(timeZone)
	if err != nil {
		return 0, fmt.Errorf("load timezone %q: %w", timeZone, err)
	}

	probe := time.Date(y, time.Month(m), d, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 48; i++ {
		local := probe.In(loc)
		if local.Hour() == 0 && local.Minute() == 0 {
			return probe.UnixMilli(), nil
		}
		probe = probe.Add(-time.Hour)
	}
	return time.Date(y, time.Month(m), d, 0, 0, 0, 0, loc).UnixMilli(), nil
}

// SlotForLocalHour maps local hour → scheduling slot (primetime 18–23, night 23–06, day 06–18).
func SlotForLocalHour(hour int) SlotDaypart {
	if hour >= 18 && hour < 23 {
		return SlotPrimetime
	}
	if hour >= 23 || hour < 6 {
		return SlotNight
	}
	return SlotDay
}
