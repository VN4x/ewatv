package channels

import (
	"encoding/json"
	"testing"
)

func TestParsePlayoutSettingsDefaults(t *testing.T) {
	s := ParsePlayoutSettings(nil)
	if s.TransitionMs != 7000 {
		t.Fatalf("transition_ms = %d, want 7000", s.TransitionMs)
	}
	if s.AutopilotWeekDays != 7 {
		t.Fatalf("autopilot_week_days = %d, want 7", s.AutopilotWeekDays)
	}
}

func TestMergePlayoutPatchPreservesCustomKeys(t *testing.T) {
	raw := json.RawMessage(`{"custom_flag":true,"transition_ms":3000}`)
	enabled := true
	merged := MergePlayoutPatch(raw, PlayoutPatch{AutopilotEnabled: &enabled})

	var m map[string]any
	if err := json.Unmarshal(merged, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if m["custom_flag"] != true {
		t.Fatal("expected custom_flag preserved")
	}
	if m["autopilot_enabled"] != true {
		t.Fatal("expected autopilot_enabled merged")
	}
}
