package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type ProbeResult struct {
	DurationSec float64
	Width       int
	Height      int
	CodecVideo  string
	CodecAudio  string
}

type FFProbe struct {
	Binary string
}

func NewFFProbe(binary string) *FFProbe {
	if binary == "" {
		binary = "ffprobe"
	}
	return &FFProbe{Binary: binary}
}

func (p *FFProbe) Probe(ctx context.Context, path string) (*ProbeResult, error) {
	args := []string{
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		path,
	}
	out, err := exec.CommandContext(ctx, p.Binary, args...).Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe: %w", err)
	}

	var raw struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
		Streams []struct {
			CodecType string `json:"codec_type"`
			CodecName string `json:"codec_name"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("parse ffprobe json: %w", err)
	}

	dur, _ := strconv.ParseFloat(raw.Format.Duration, 64)
	res := &ProbeResult{DurationSec: dur}
	for _, s := range raw.Streams {
		switch s.CodecType {
		case "video":
			if res.CodecVideo == "" {
				res.CodecVideo = s.CodecName
				res.Width = s.Width
				res.Height = s.Height
			}
		case "audio":
			if res.CodecAudio == "" {
				res.CodecAudio = s.CodecName
			}
		}
	}
	return res, nil
}

type Packer struct {
	FFmpeg  string
	Threads int
}

func NewPacker(ffmpeg string, threads int) *Packer {
	if ffmpeg == "" {
		ffmpeg = "ffmpeg"
	}
	return &Packer{FFmpeg: ffmpeg, Threads: threads}
}

// PackCMAF produces LL-HLS-compatible fMP4 segments (2s) for linear playout.
func (p *Packer) PackCMAF(ctx context.Context, sourcePath, outDir string) error {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}

	segPattern := filepath.Join(outDir, "seg_%05d.m4s")
	playlist := filepath.Join(outDir, "index.m3u8")
	initFile := filepath.Join(outDir, "init.mp4")

	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	if p.Threads >= 0 {
		args = append(args, "-threads", strconv.Itoa(p.Threads))
	}
	args = append(args,
		"-i", sourcePath,
		"-map", "0:v:0", "-map", "0:a:0?",
		"-c:v", "copy",
		"-c:a", "aac", "-b:a", "128k", "-ac", "2",
		"-f", "hls",
		"-hls_time", "2",
		"-hls_segment_type", "fmp4",
		"-hls_playlist_type", "vod",
		"-hls_fmp4_init_filename", filepath.Base(initFile),
		"-hls_segment_filename", segPattern,
		playlist,
	)

	cmd := exec.CommandContext(ctx, p.FFmpeg, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg pack: %w", err)
	}
	return nil
}

func SegmentDir(storageRoot, videoID string) string {
	return filepath.Join(storageRoot, "segments", videoID, "cmaf")
}

func SourcePath(storageRoot, videoID string) string {
	return filepath.Join(storageRoot, "videos", videoID, "source.mp4")
}

func ResolveRemoteURL(sourceType, sourceRef string) (string, error) {
	switch sourceType {
	case "direct_url", "local":
		if !strings.HasPrefix(sourceRef, "http://") && !strings.HasPrefix(sourceRef, "https://") {
			if sourceType == "local" && sourceRef != "" {
				return sourceRef, nil
			}
			return "", fmt.Errorf("direct_url requires http(s) URL")
		}
		return sourceRef, nil
	case "mega_s3":
		return "", fmt.Errorf("mega_s3 requires presigned URL (use ingest presign endpoint in phase 2b)")
	default:
		return "", fmt.Errorf("source type %q cannot be ingested locally", sourceType)
	}
}
