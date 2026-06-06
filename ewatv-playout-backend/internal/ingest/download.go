package ingest

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type Downloader struct {
	Client         *http.Client
	MaxBytes       int64
	Timeout        time.Duration
}

func NewDownloader(timeout time.Duration, maxBytes int64) *Downloader {
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}
	return &Downloader{
		Client:   &http.Client{Timeout: timeout},
		MaxBytes: maxBytes,
		Timeout:  timeout,
	}
}

func (d *Downloader) DownloadToFile(ctx context.Context, url, destPath string) error {
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}

	resp, err := d.Client.Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download status %d", resp.StatusCode)
	}

	tmp := destPath + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	defer f.Close()

	var reader io.Reader = resp.Body
	if d.MaxBytes > 0 {
		reader = io.LimitReader(resp.Body, d.MaxBytes)
	}

	n, err := io.Copy(f, reader)
	if err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("write file: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if d.MaxBytes > 0 && n >= d.MaxBytes {
		_ = os.Remove(tmp)
		return fmt.Errorf("download exceeded max size (%d bytes)", d.MaxBytes)
	}
	return os.Rename(tmp, destPath)
}
