package stream

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/vn4x/ewatv-playout-backend/internal/playout"
)

type HLS struct {
	engine *playout.Engine
}

func NewHLS(engine *playout.Engine) *HLS {
	return &HLS{engine: engine}
}

func (h *HLS) Register(app fiber.Router) {
	app.Get("/hls/:slug/index.m3u8", h.ServeManifest)
	app.Get("/hls/:slug/:file", h.ServeSegment)
}

func (h *HLS) ServeManifest(c *fiber.Ctx) error {
	slug := c.Params("slug")
	view, ok := h.engine.GetManifest(slug)
	if !ok || len(view.Body) == 0 {
		return c.Status(fiber.StatusNotFound).SendString("stream not available")
	}

	if inm := c.Get("If-None-Match"); inm != "" && inm == view.ETag {
		return c.SendStatus(fiber.StatusNotModified)
	}

	c.Set("Content-Type", "application/vnd.apple.mpegurl")
	c.Set("Cache-Control", "no-cache, no-store, must-revalidate")
	if view.ETag != "" {
		c.Set("ETag", view.ETag)
	}
	return c.Send(view.Body)
}

func (h *HLS) ServeSegment(c *fiber.Ctx) error {
	slug := c.Params("slug")
	file := filepath.Base(c.Params("file"))
	if file == "" || file == "." || strings.Contains(file, "..") {
		return c.Status(fiber.StatusBadRequest).SendString("invalid file")
	}

	dir, ok := h.engine.LiveDir(slug)
	if !ok {
		return c.Status(fiber.StatusNotFound).SendString("stream not available")
	}

	path := filepath.Join(dir, file)
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).SendString("not found")
		}
		return c.Status(fiber.StatusInternalServerError).SendString("stat error")
	}
	if info.IsDir() {
		return c.Status(fiber.StatusNotFound).SendString("not found")
	}

	c.Set("Content-Type", segmentContentType(file))
	if strings.HasSuffix(file, ".m3u8") {
		c.Set("Cache-Control", "no-cache, no-store, must-revalidate")
	} else {
		c.Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	return c.SendFile(path)
}

func segmentContentType(name string) string {
	switch {
	case strings.HasSuffix(name, ".m3u8"):
		return "application/vnd.apple.mpegurl"
	case strings.HasSuffix(name, ".mp4"):
		return "video/mp4"
	case strings.HasSuffix(name, ".m4s"):
		return "video/iso.segment"
	default:
		return "application/octet-stream"
	}
}
