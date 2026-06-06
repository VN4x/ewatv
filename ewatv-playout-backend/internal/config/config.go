package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server    ServerConfig    `mapstructure:"server"`
	CORS      CORSConfig      `mapstructure:"cors"`
	Auth      AuthConfig      `mapstructure:"auth"`
	Database  DatabaseConfig  `mapstructure:"database"`
	Redis     RedisConfig     `mapstructure:"redis"`
	Storage   StorageConfig   `mapstructure:"storage"`
	Playout   PlayoutConfig   `mapstructure:"playout"`
	FFmpeg    FFmpegConfig    `mapstructure:"ffmpeg"`
	Logging   LoggingConfig   `mapstructure:"logging"`
	Metrics   MetricsConfig   `mapstructure:"metrics"`
	RateLimit RateLimitConfig `mapstructure:"rate_limit"`
}

type ServerConfig struct {
	Host             string        `mapstructure:"host"`
	Port             int           `mapstructure:"port"`
	ReadTimeout      time.Duration `mapstructure:"read_timeout"`
	WriteTimeout     time.Duration `mapstructure:"write_timeout"`
	IdleTimeout      time.Duration `mapstructure:"idle_timeout"`
	ShutdownTimeout  time.Duration `mapstructure:"shutdown_timeout"`
	BodyLimit        int           `mapstructure:"body_limit"`
}

func (s ServerConfig) Addr() string {
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

type CORSConfig struct {
	AllowedOrigins []string `mapstructure:"allowed_origins"`
	AllowedMethods []string `mapstructure:"allowed_methods"`
	AllowedHeaders []string `mapstructure:"allowed_headers"`
}

type AuthConfig struct {
	JWTSecret string        `mapstructure:"jwt_secret"`
	JWTIssuer string        `mapstructure:"jwt_issuer"`
	TokenTTL  time.Duration `mapstructure:"token_ttl"`
}

type DatabaseConfig struct {
	URL             string        `mapstructure:"url"`
	MaxConns        int32         `mapstructure:"max_conns"`
	MinConns        int32         `mapstructure:"min_conns"`
	MaxConnLifetime time.Duration `mapstructure:"max_conn_lifetime"`
	MaxConnIdleTime time.Duration `mapstructure:"max_conn_idle_time"`
}

type RedisConfig struct {
	URL      string `mapstructure:"url"`
	PoolSize int    `mapstructure:"pool_size"`
}

type StorageConfig struct {
	Root         string `mapstructure:"root"`
	VideosDir    string `mapstructure:"videos_dir"`
	SegmentsDir  string `mapstructure:"segments_dir"`
	ChannelsDir  string `mapstructure:"channels_dir"`
	SlatePath    string `mapstructure:"slate_path"`
}

func (s StorageConfig) VideosPath() string  { return joinStorage(s.Root, s.VideosDir) }
func (s StorageConfig) SegmentsPath() string { return joinStorage(s.Root, s.SegmentsDir) }
func (s StorageConfig) ChannelsPath() string { return joinStorage(s.Root, s.ChannelsDir) }

func joinStorage(root, sub string) string {
	return strings.TrimRight(root, "/") + "/" + strings.Trim(sub, "/")
}

type PlayoutConfig struct {
	Timezone               string        `mapstructure:"timezone"`
	TickInterval           time.Duration `mapstructure:"tick_interval"`
	ManifestWindowSegments int           `mapstructure:"manifest_window_segments"`
	PrefetchNextItems      int           `mapstructure:"prefetch_next_items"`
	MaxConcurrentPackJobs  int           `mapstructure:"max_concurrent_pack_jobs"`
}

type FFmpegConfig struct {
	Binary   string `mapstructure:"binary"`
	FFprobe  string `mapstructure:"ffprobe"`
	Threads  int    `mapstructure:"threads"`
}

type LoggingConfig struct {
	Level  string `mapstructure:"level"`
	Format string `mapstructure:"format"`
}

type MetricsConfig struct {
	Enabled bool   `mapstructure:"enabled"`
	Path    string `mapstructure:"path"`
}

type RateLimitConfig struct {
	Enabled    bool          `mapstructure:"enabled"`
	Max        int           `mapstructure:"max"`
	Expiration time.Duration `mapstructure:"expiration"`
}

func Load(path string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(path)
	v.SetEnvPrefix("EWATV")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	setDefaults(v)

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.port", 8090)
	v.SetDefault("server.read_timeout", "30s")
	v.SetDefault("server.write_timeout", "30s")
	v.SetDefault("server.idle_timeout", "120s")
	v.SetDefault("server.shutdown_timeout", "15s")
	v.SetDefault("server.body_limit", 10*1024*1024)
	v.SetDefault("database.max_conns", 25)
	v.SetDefault("database.min_conns", 4)
	v.SetDefault("logging.level", "info")
	v.SetDefault("logging.format", "json")
	v.SetDefault("metrics.enabled", true)
	v.SetDefault("metrics.path", "/metrics")
	v.SetDefault("playout.timezone", "Europe/Helsinki")
	v.SetDefault("playout.tick_interval", "500ms")
	v.SetDefault("storage.root", "/data")
}

func (c *Config) Validate() error {
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("invalid server.port: %d", c.Server.Port)
	}
	if c.Database.URL == "" {
		return fmt.Errorf("database.url is required")
	}
	if c.Auth.JWTSecret == "" || c.Auth.JWTSecret == "change-me-in-production" {
		// Warn-level in prod; allow dev bootstrap
		if c.Logging.Level != "debug" && c.Logging.Level != "info" {
			return fmt.Errorf("auth.jwt_secret must be set in production")
		}
	}
	return nil
}
