package ingest

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/vn4x/ewatv-playout-backend/internal/config"
	"github.com/vn4x/ewatv-playout-backend/internal/library"
)

type Worker struct {
	repo       *library.Repository
	log        zerolog.Logger
	storage    config.StorageConfig
	ffmpeg     config.FFmpegConfig
	downloader *Downloader
	probe      *FFProbe
	packer     *Packer
	interval   time.Duration
}

func NewWorker(
	repo *library.Repository,
	log zerolog.Logger,
	cfg *config.Config,
) *Worker {
	return &Worker{
		repo:       repo,
		log:        log.With().Str("component", "ingest-worker").Logger(),
		storage:    cfg.Storage,
		ffmpeg:     cfg.FFmpeg,
		downloader: NewDownloader(cfg.Ingest.DownloadTimeout, cfg.Ingest.MaxDownloadBytes),
		probe:      NewFFProbe(cfg.FFmpeg.FFprobe),
		packer:     NewPacker(cfg.FFmpeg.Binary, cfg.FFmpeg.Threads),
		interval:   cfg.Ingest.PollInterval,
	}
}

func (w *Worker) Run(ctx context.Context) {
	if w.interval <= 0 {
		w.interval = 5 * time.Second
	}
	w.log.Info().Dur("interval", w.interval).Msg("ingest worker started")
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			w.log.Info().Msg("ingest worker stopped")
			return
		case <-ticker.C:
			w.processOne(ctx)
		}
	}
}

func (w *Worker) RunOnce(ctx context.Context) {
	w.processOne(ctx)
}

func (w *Worker) processOne(ctx context.Context) {
	jobID, videoID, err := w.repo.ClaimNextIngestJob(ctx)
	if err != nil {
		w.log.Error().Err(err).Msg("claim ingest job")
		return
	}
	if jobID == uuid.Nil {
		return
	}

	log := w.log.With().Str("job_id", jobID.String()).Str("video_id", videoID.String()).Logger()
	log.Info().Msg("processing ingest job")

	jobErr := w.processVideo(ctx, videoID)
	var errMsg *string
	ok := jobErr == nil
	if jobErr != nil {
		s := jobErr.Error()
		errMsg = &s
		log.Error().Err(jobErr).Msg("ingest failed")
		_ = w.repo.UpdatePackStatus(ctx, videoID, "failed", nil)
	} else {
		log.Info().Msg("ingest completed")
	}

	if err := w.repo.FinishIngestJob(ctx, jobID, ok, errMsg); err != nil {
		log.Error().Err(err).Msg("finish ingest job")
	}
}

func (w *Worker) processVideo(ctx context.Context, videoID uuid.UUID) error {
	v, err := w.repo.GetByID(ctx, videoID)
	if err != nil {
		return err
	}

	dest := SourcePath(w.storage.Root, videoID.String())
	videoSegRoot := filepath.Join(w.storage.Root, "segments", videoID.String())

	if _, statErr := os.Stat(dest); statErr != nil {
		if !errors.Is(statErr, os.ErrNotExist) {
			return statErr
		}
		url, err := ResolveRemoteURL(string(v.SourceType), v.SourceRef)
		if err != nil {
			return err
		}
		if err := w.downloader.DownloadToFile(ctx, url, dest); err != nil {
			return err
		}
	}

	probe, err := w.probe.Probe(ctx, dest)
	if err != nil {
		return err
	}

	lengthSec := int(probe.DurationSec)
	wv, hv := probe.Width, probe.Height
	cv, ca := probe.CodecVideo, probe.CodecAudio
	if err := w.repo.UpdateProbe(ctx, videoID, lengthSec, &wv, &hv, &cv, &ca); err != nil {
		return err
	}

	if err := w.packer.PackABR(ctx, dest, videoSegRoot, nil); err != nil {
		return err
	}

	storagePath := dest
	return w.repo.UpdatePackStatus(ctx, videoID, "ready", &storagePath)
}
