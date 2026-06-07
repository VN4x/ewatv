package channels

import (
	"encoding/json"
	"math"
)

const (
	DefaultChannelTransitionMs = 7000
	DefaultAutopilotPushHour   = 4
)

// PlayoutSettings mirrors ewatv channels.settings playout fields.
type PlayoutSettings struct {
	PlayoutActive          bool    `json:"playout_active"`
	AutopilotEnabled       bool    `json:"autopilot_enabled"`
	AutopilotWeekDays      int     `json:"autopilot_week_days"`
	AutopilotPushHour      int     `json:"autopilot_push_hour"`
	TransitionMs           int     `json:"transition_ms"`
	LastMistPushAt         *string `json:"last_mist_push_at"`
	LastMistPushError      *string `json:"last_mist_push_error"`
	LastMistPushScheduleID  *string `json:"last_mist_push_schedule_id"`
	AutopilotLastRunAt     *string `json:"autopilot_last_run_at"`
}

func defaultPlayoutSettings() PlayoutSettings {
	return PlayoutSettings{
		AutopilotWeekDays: 7,
		AutopilotPushHour: DefaultAutopilotPushHour,
		TransitionMs:      DefaultChannelTransitionMs,
	}
}

func clampTransition(ms int) int {
	if ms < 0 {
		return 0
	}
	if ms > 60000 {
		return 60000
	}
	return ms
}

func clampHour(h int) int {
	if h < 0 {
		return 0
	}
	if h > 23 {
		return 23
	}
	return h
}

// ParsePlayoutSettings extracts playout fields from channels.settings JSONB.
func ParsePlayoutSettings(raw json.RawMessage) PlayoutSettings {
	out := defaultPlayoutSettings()
	if len(raw) == 0 || string(raw) == "null" {
		return out
	}

	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return out
	}

	if v, ok := m["playout_active"]; ok {
		_ = json.Unmarshal(v, &out.PlayoutActive)
	}
	if v, ok := m["autopilot_enabled"]; ok {
		_ = json.Unmarshal(v, &out.AutopilotEnabled)
	}
	if v, ok := m["autopilot_week_days"]; ok {
		var days float64
		if json.Unmarshal(v, &days) == nil {
			d := int(math.Floor(days))
			if d >= 1 && d <= 14 {
				out.AutopilotWeekDays = d
			}
		}
	}
	if v, ok := m["autopilot_push_hour"]; ok {
		var hour float64
		if json.Unmarshal(v, &hour) == nil {
			out.AutopilotPushHour = clampHour(int(math.Floor(hour)))
		}
	}
	if v, ok := m["transition_ms"]; ok {
		var ms float64
		if json.Unmarshal(v, &ms) == nil {
			out.TransitionMs = clampTransition(int(math.Floor(ms)))
		}
	}
	if v, ok := m["last_mist_push_at"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil && s != "" {
			out.LastMistPushAt = &s
		}
	}
	if v, ok := m["last_mist_push_error"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil && s != "" {
			out.LastMistPushError = &s
		}
	}
	if v, ok := m["last_mist_push_schedule_id"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil && s != "" {
			out.LastMistPushScheduleID = &s
		}
	}
	if v, ok := m["autopilot_last_run_at"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil && s != "" {
			out.AutopilotLastRunAt = &s
		}
	}
	return out
}

// PlayoutPatch holds optional playout settings updates.
type PlayoutPatch struct {
	PlayoutActive          *bool
	AutopilotEnabled       *bool
	AutopilotWeekDays      *int
	AutopilotPushHour      *int
	TransitionMs           *int
	LastMistPushAt         *string
	LastMistPushError      *string
	LastMistPushScheduleID *string
	AutopilotLastRunAt     *string
}

// MergePlayoutPatch merges optional playout fields into settings JSONB.
func MergePlayoutPatch(raw json.RawMessage, patch PlayoutPatch) json.RawMessage {
	base := map[string]any{}
	if len(raw) > 0 && string(raw) != "null" {
		_ = json.Unmarshal(raw, &base)
	}
	current := ParsePlayoutSettings(raw)

	setBool := func(key string, val *bool, fallback bool) {
		if val != nil {
			base[key] = *val
		} else {
			base[key] = fallback
		}
	}
	setInt := func(key string, val *int, fallback int) {
		if val != nil {
			base[key] = *val
		} else {
			base[key] = fallback
		}
	}
	setStr := func(key string, val *string, fallback *string) {
		if val != nil {
			base[key] = *val
		} else if fallback != nil {
			base[key] = *fallback
		}
	}

	setBool("playout_active", patch.PlayoutActive, current.PlayoutActive)
	setBool("autopilot_enabled", patch.AutopilotEnabled, current.AutopilotEnabled)
	setInt("autopilot_week_days", patch.AutopilotWeekDays, current.AutopilotWeekDays)
	setInt("autopilot_push_hour", patch.AutopilotPushHour, current.AutopilotPushHour)
	setInt("transition_ms", patch.TransitionMs, current.TransitionMs)
	setStr("last_mist_push_at", patch.LastMistPushAt, current.LastMistPushAt)
	setStr("last_mist_push_error", patch.LastMistPushError, current.LastMistPushError)
	setStr("last_mist_push_schedule_id", patch.LastMistPushScheduleID, current.LastMistPushScheduleID)
	setStr("autopilot_last_run_at", patch.AutopilotLastRunAt, current.AutopilotLastRunAt)

	b, err := json.Marshal(base)
	if err != nil {
		return raw
	}
	return b
}
