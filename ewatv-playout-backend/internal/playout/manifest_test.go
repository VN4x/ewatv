package playout

import (
	"strings"
	"testing"
	"time"

	"github.com/vn4x/ewatv-playout-backend/internal/ingest"
)

func TestRenderManifestIncludesDiscontinuityAndMap(t *testing.T) {
	at := time.Date(2026, 6, 2, 12, 0, 0, 0, time.UTC)
	segments := []manifestSegment{
		{
			URI:         "w00000.m4s",
			DurationSec: 2,
			MapURI:      "init.mp4",
			ProgramDate: at,
		},
		{
			URI:           "w00001.m4s",
			DurationSec:   2,
			Discontinuity: true,
			MapURI:        "init.mp4",
			ProgramDate:   at.Add(2 * time.Second),
		},
	}

	body := renderManifest(segments)
	text := string(body)
	for _, want := range []string{
		"#EXTM3U",
		"#EXT-X-MAP:URI=\"init.mp4\"",
		"#EXT-X-DISCONTINUITY",
		"#EXT-X-PROGRAM-DATE-TIME:",
		"w00000.m4s",
		"w00001.m4s",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("manifest missing %q:\n%s", want, text)
		}
	}
}

func TestBuildMasterManifestListsRenditions(t *testing.T) {
	body := BuildMasterManifest("main", ingest.DefaultRenditions)
	text := string(body)
	if !strings.Contains(text, "720p/index.m3u8") {
		t.Fatalf("missing 720p variant: %s", text)
	}
	if !strings.Contains(text, "BANDWIDTH=") {
		t.Fatal("missing bandwidth attributes")
	}
}
