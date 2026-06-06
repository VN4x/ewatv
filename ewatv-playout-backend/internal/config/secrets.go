package config

import (
	"os"
	"strings"
)

// ReadSecret returns env value, or contents of env+"_FILE" path (Podman secrets pattern).
func ReadSecret(envKey string) string {
	if v := strings.TrimSpace(os.Getenv(envKey)); v != "" {
		return v
	}
	fileKey := envKey + "_FILE"
	path := strings.TrimSpace(os.Getenv(fileKey))
	if path == "" {
		return ""
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// ApplySecretFiles overlays config from EWATV_* env and *_FILE mounts.
func (c *Config) ApplySecretFiles() {
	if v := ReadSecret("EWATV_AUTH_JWT_SECRET"); v != "" {
		c.Auth.JWTSecret = v
	}
	if v := ReadSecret("EWATV_DATABASE_URL"); v != "" {
		c.Database.URL = v
	}
	if v := ReadSecret("EWATV_REDIS_URL"); v != "" {
		c.Redis.URL = v
	}
	if v := os.Getenv("EWATV_STORAGE_ROOT"); v != "" {
		c.Storage.Root = v
	}
	if c.Auth.JWTSecret == "" && c.Auth.JWTSecretFile != "" {
		if b, err := os.ReadFile(c.Auth.JWTSecretFile); err == nil {
			c.Auth.JWTSecret = strings.TrimSpace(string(b))
		}
	}
}
