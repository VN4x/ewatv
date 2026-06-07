package analytics

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// CountryFromHeaders reads CF-IPCountry or X-Country-Code when present.
func CountryFromHeaders(headers map[string]string) string {
	for _, key := range []string{"CF-IPCountry", "X-Country-Code", "CloudFront-Viewer-Country"} {
		if v := strings.TrimSpace(headers[key]); len(v) == 2 {
			return strings.ToUpper(v)
		}
	}
	return ""
}

// HashUserAgent returns a short stable hash for grouping clients (not reversible).
func HashUserAgent(ua string) string {
	ua = strings.TrimSpace(ua)
	if ua == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(ua))
	return hex.EncodeToString(sum[:8])
}
