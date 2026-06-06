package playout

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/vn4x/ewatv-playout-backend/internal/config"
	"github.com/vn4x/ewatv-playout-backend/internal/ingest"
)

const defaultSegmentDurSec = 2.0

type manifestSegment struct {
	URI           string
	DurationSec   float64
	Discontinuity bool
	MapURI        string
	ProgramDate   time.Time
}

type ManifestInput struct {
	Items          []ItemWithVideo
	StartItemIdx   int
	OffsetMs       int
	WindowSegments int
	LiveDir        string
	Storage        config.StorageConfig
	At             time.Time
}

type ManifestResult struct {
	Body []byte
	ETag string
}

// BuildLiveManifest generates a sliding-window LL-HLS media playlist and syncs segment files into liveDir.
func BuildLiveManifest(in ManifestInput) (*ManifestResult, error) {
	if in.WindowSegments <= 0 {
		in.WindowSegments = 12
	}
	if err := os.MkdirAll(in.LiveDir, 0o755); err != nil {
		return nil, err
	}

	segments, err := collectWindowSegments(in)
	if err != nil {
		return nil, err
	}
	if len(segments) == 0 {
		body := []byte("#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n")
		return &ManifestResult{Body: body, ETag: hashBytes(body)}, nil
	}

	if err := syncLiveFiles(in.LiveDir, segments); err != nil {
		return nil, err
	}

	body := renderManifest(segments)
	return &ManifestResult{Body: body, ETag: hashBytes(body)}, nil
}

func collectWindowSegments(in ManifestInput) ([]manifestSegment, error) {
	if in.StartItemIdx < 0 || in.StartItemIdx >= len(in.Items) {
		return nil, nil
	}

	var out []manifestSegment
	itemIdx := in.StartItemIdx
	offsetMs := in.OffsetMs
	segIdx := SegmentIndex(offsetMs)
	remaining := in.WindowSegments
	seqBase := 0

	for remaining > 0 && itemIdx < len(in.Items) {
		iv := in.Items[itemIdx]
		if isGapItem(iv) || offsetMs >= iv.Item.DurationMs {
			slateDir := slateCMAFDir(in.Storage)
			segs, err := listCMAFSegments(slateDir)
			if err != nil || len(segs) == 0 {
				itemIdx++
				offsetMs = 0
				segIdx = 0
				continue
			}
			slateSeg := segIdx % len(segs)
			for remaining > 0 && offsetMs < iv.Item.DurationMs+iv.Item.TransitionMs {
				name := fmt.Sprintf("w%05d.m4s", seqBase)
				out = append(out, manifestSegment{
					URI:           name,
					DurationSec:   defaultSegmentDurSec,
					Discontinuity: len(out) > 0 && segIdx == slateSeg,
					MapURI:        "init.mp4",
					ProgramDate:   in.At.Add(time.Duration(len(out)*segmentDurationMs) * time.Millisecond),
				})
				if err := linkSegment(in.LiveDir, name, filepath.Join(slateDir, segs[slateSeg])); err != nil {
					return nil, err
				}
				if err := ensureInit(in.LiveDir, slateDir); err != nil {
					return nil, err
				}
				slateSeg = (slateSeg + 1) % len(segs)
				offsetMs += segmentDurationMs
				seqBase++
				remaining--
			}
			itemIdx++
			offsetMs = 0
			segIdx = 0
			continue
		}

		videoID := ""
		if iv.Video != nil {
			videoID = iv.Video.ID.String()
		} else if iv.Item.VideoID != nil {
			videoID = iv.Item.VideoID.String()
		}
		if videoID == "" {
			itemIdx++
			offsetMs = 0
			segIdx = 0
			continue
		}

		cmafDir := ingest.SegmentDir(in.Storage.SegmentsPath(), videoID)
		sourceSegs, err := listCMAFSegments(cmafDir)
		if err != nil {
			return nil, err
		}
		if len(sourceSegs) == 0 {
			itemIdx++
			offsetMs = 0
			segIdx = 0
			continue
		}

		if err := ensureInit(in.LiveDir, cmafDir); err != nil {
			return nil, err
		}

		maxSeg := SegmentCount(iv.Item.DurationMs)
		if maxSeg > len(sourceSegs) {
			maxSeg = len(sourceSegs)
		}

		for remaining > 0 && segIdx < maxSeg {
			name := fmt.Sprintf("w%05d.m4s", seqBase)
			srcName := sourceSegs[segIdx]
			discont := len(out) > 0 && segIdx == 0 && itemIdx > in.StartItemIdx
			out = append(out, manifestSegment{
				URI:           name,
				DurationSec:   defaultSegmentDurSec,
				Discontinuity: discont,
				MapURI:        "init.mp4",
				ProgramDate:   in.At.Add(time.Duration(len(out)*segmentDurationMs) * time.Millisecond),
			})
			if err := linkSegment(in.LiveDir, name, filepath.Join(cmafDir, srcName)); err != nil {
				return nil, err
			}
			segIdx++
			seqBase++
			remaining--
		}

		itemIdx++
		offsetMs = 0
		segIdx = 0
	}

	return out, nil
}

func syncLiveFiles(liveDir string, segments []manifestSegment) error {
	entries, err := os.ReadDir(liveDir)
	if err != nil {
		return err
	}
	want := map[string]bool{"init.mp4": true}
	for _, s := range segments {
		want[s.URI] = true
	}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, "w") && strings.HasSuffix(name, ".m4s") && !want[name] {
			_ = os.Remove(filepath.Join(liveDir, name))
		}
	}
	return nil
}

func renderManifest(segments []manifestSegment) []byte {
	var b strings.Builder
	b.WriteString("#EXTM3U\n")
	b.WriteString("#EXT-X-VERSION:7\n")
	b.WriteString("#EXT-X-TARGETDURATION:2\n")
	b.WriteString("#EXT-X-MEDIA-SEQUENCE:0\n")
	b.WriteString("#EXT-X-PLAYLIST-TYPE:EVENT\n")

	mapWritten := false
	for _, seg := range segments {
		if seg.Discontinuity {
			b.WriteString("#EXT-X-DISCONTINUITY\n")
			mapWritten = false
		}
		if !mapWritten && seg.MapURI != "" {
			b.WriteString(fmt.Sprintf("#EXT-X-MAP:URI=\"%s\"\n", seg.MapURI))
			mapWritten = true
		}
		if !seg.ProgramDate.IsZero() {
			b.WriteString("#EXT-X-PROGRAM-DATE-TIME:")
			b.WriteString(seg.ProgramDate.UTC().Format("2006-01-02T15:04:05.000Z"))
			b.WriteByte('\n')
		}
		b.WriteString(fmt.Sprintf("#EXTINF:%.3f,\n", seg.DurationSec))
		b.WriteString(seg.URI)
		b.WriteByte('\n')
	}
	return []byte(b.String())
}

func listCMAFSegments(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var segs []string
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, "seg_") && strings.HasSuffix(name, ".m4s") {
			segs = append(segs, name)
		}
	}
	sort.Strings(segs)
	return segs, nil
}

func linkSegment(liveDir, destName, srcPath string) error {
	dest := filepath.Join(liveDir, destName)
	_ = os.Remove(dest)
	return os.Symlink(srcPath, dest)
}

func ensureInit(liveDir, cmafDir string) error {
	src := filepath.Join(cmafDir, "init.mp4")
	dest := filepath.Join(liveDir, "init.mp4")
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if st, err := os.Lstat(dest); err == nil {
		if st.Mode()&os.ModeSymlink != 0 {
			target, _ := os.Readlink(dest)
			if target == src {
				return nil
			}
		}
		if st.ModTime().Equal(info.ModTime()) {
			return nil
		}
	}
	_ = os.Remove(dest)
	return os.Symlink(src, dest)
}

func slateCMAFDir(storage config.StorageConfig) string {
	return filepath.Join(storage.Root, "slate", "cmaf")
}

func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:8])
}

// ParseSegmentSeq extracts the numeric sequence from seg_NNNNN.m4s filenames.
func ParseSegmentSeq(name string) (int, error) {
	name = strings.TrimSuffix(filepath.Base(name), ".m4s")
	name = strings.TrimPrefix(name, "seg_")
	return strconv.Atoi(name)
}
