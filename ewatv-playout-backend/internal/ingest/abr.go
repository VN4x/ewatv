package ingest

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

// Rendition is one ABR rung for mobile/tablet adaptive streaming.
type Rendition struct {
	Name         string
	Height       int
	VideoBitrate string
	AudioBitrate string
	Bandwidth    int // bits/sec for master playlist
}

// DefaultRenditions — 3-rung ladder (720p / 480p / 360p).
var DefaultRenditions = []Rendition{
	{Name: "720p", Height: 720, VideoBitrate: "2500k", AudioBitrate: "128k", Bandwidth: 2800000},
	{Name: "480p", Height: 480, VideoBitrate: "1200k", AudioBitrate: "96k", Bandwidth: 1400000},
	{Name: "360p", Height: 360, VideoBitrate: "600k", AudioBitrate: "64k", Bandwidth: 700000},
}

func RenditionDir(storageRoot, videoID, rendition string) string {
	return filepath.Join(storageRoot, "segments", videoID, rendition)
}

// PackABR encodes 2–3 CMAF HLS renditions from source (scale + H.264, no live transcode at air time).
func (p *Packer) PackABR(ctx context.Context, sourcePath, videoRoot string, renditions []Rendition) error {
	if len(renditions) == 0 {
		renditions = DefaultRenditions
	}
	for _, r := range renditions {
		outDir := filepath.Join(videoRoot, r.Name)
		if err := os.MkdirAll(outDir, 0o755); err != nil {
			return err
		}
		if err := p.packOneRendition(ctx, sourcePath, outDir, r); err != nil {
			return fmt.Errorf("pack %s: %w", r.Name, err)
		}
	}
	if err := writeVODMaster(videoRoot, renditions); err != nil {
		return err
	}
	return nil
}

func (p *Packer) packOneRendition(ctx context.Context, sourcePath, outDir string, r Rendition) error {
	segPattern := filepath.Join(outDir, "seg_%05d.m4s")
	playlist := filepath.Join(outDir, "index.m3u8")
	initFile := filepath.Join(outDir, "init.mp4")

	scale := fmt.Sprintf("scale=-2:%d", r.Height)

	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	if p.Threads >= 0 {
		args = append(args, "-threads", strconv.Itoa(p.Threads))
	}
	args = append(args,
		"-i", sourcePath,
		"-vf", scale,
		"-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main",
		"-b:v", r.VideoBitrate, "-maxrate", r.VideoBitrate, "-bufsize", doubleBitrate(r.VideoBitrate),
		"-c:a", "aac", "-b:a", r.AudioBitrate, "-ac", "2",
		"-f", "hls",
		"-hls_time", "2",
		"-hls_segment_type", "fmp4",
		"-hls_playlist_type", "vod",
		"-hls_fmp4_init_filename", filepath.Base(initFile),
		"-hls_segment_filename", segPattern,
		playlist,
	)

	cmd := exec.CommandContext(ctx, p.FFmpeg, args...)
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return err
	}
	return nil
}

func doubleBitrate(vbr string) string {
	// crude: "2500k" -> "5000k"
	if len(vbr) > 0 && vbr[len(vbr)-1] == 'k' {
		n, err := strconv.Atoi(vbr[:len(vbr)-1])
		if err == nil {
			return fmt.Sprintf("%dk", n*2)
		}
	}
	return vbr
}

func writeVODMaster(videoRoot string, renditions []Rendition) error {
	var b []byte
	b = append(b, "#EXTM3U\n"...)
	b = append(b, "#EXT-X-VERSION:7\n"...)
	for _, r := range renditions {
		w := r.Bandwidth
		line := fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d,CODECS=\"avc1.4d401f,mp4a.40.2\"\n%s/index.m3u8\n",
			w, heightToWidth(r.Height), r.Height, r.Name)
		b = append(b, line...)
	}
	return os.WriteFile(filepath.Join(videoRoot, "master.m3u8"), b, 0o644)
}

func heightToWidth(h int) int {
	return h * 16 / 9
}
