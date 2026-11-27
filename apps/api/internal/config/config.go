// Package config reads every setting from the environment once, at startup, and
// refuses to run with a configuration that cannot work.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env          string // development | production
	DatabaseURL  string
	APIAddr      string
	PublicOrigin string // where browsers reach the site, used for cookies, OG tags and redirects
	MediaDir     string
	SessionTTL   time.Duration

	GitHub   OAuth
	Google   OAuth
	Telegram Telegram
	SMTP     SMTP
}

type OAuth struct {
	ClientID     string
	ClientSecret string
}

func (o OAuth) Configured() bool { return o.ClientID != "" && o.ClientSecret != "" }

type Telegram struct {
	BotToken    string
	BotUsername string
	Channel     string
}

func (t Telegram) Configured() bool { return t.BotToken != "" }

type SMTP struct {
	Addr     string
	User     string
	Password string
	From     string
}

func (s SMTP) Configured() bool { return s.Addr != "" && s.From != "" }

// Development reports whether convenience features meant only for local work —
// Dev login above all — are allowed.
func (c Config) Development() bool { return c.Env == "development" }

// Load reads the environment. It returns every problem at once rather than the
// first, so a misconfigured deployment is fixed in one pass.
func Load() (Config, error) {
	c := Config{
		Env:          env("BUILDWITH_ENV", "development"),
		DatabaseURL:  os.Getenv("BUILDWITH_DATABASE_URL"),
		APIAddr:      env("BUILDWITH_API_ADDR", ":8080"),
		PublicOrigin: strings.TrimRight(env("BUILDWITH_PUBLIC_ORIGIN", "http://localhost:5173"), "/"),
		MediaDir:     env("BUILDWITH_MEDIA_DIR", "./media"),
		SessionTTL:   30 * 24 * time.Hour,
		GitHub: OAuth{
			ClientID:     os.Getenv("BUILDWITH_GITHUB_CLIENT_ID"),
			ClientSecret: os.Getenv("BUILDWITH_GITHUB_CLIENT_SECRET"),
		},
		Google: OAuth{
			ClientID:     os.Getenv("BUILDWITH_GOOGLE_CLIENT_ID"),
			ClientSecret: os.Getenv("BUILDWITH_GOOGLE_CLIENT_SECRET"),
		},
		Telegram: Telegram{
			BotToken:    os.Getenv("BUILDWITH_TELEGRAM_BOT_TOKEN"),
			BotUsername: os.Getenv("BUILDWITH_TELEGRAM_BOT_USERNAME"),
			Channel:     os.Getenv("BUILDWITH_TELEGRAM_CHANNEL"),
		},
		SMTP: SMTP{
			Addr:     os.Getenv("BUILDWITH_SMTP_ADDR"),
			User:     os.Getenv("BUILDWITH_SMTP_USER"),
			Password: os.Getenv("BUILDWITH_SMTP_PASSWORD"),
			From:     os.Getenv("BUILDWITH_SMTP_FROM"),
		},
	}

	if days := os.Getenv("BUILDWITH_SESSION_DAYS"); days != "" {
		n, err := strconv.Atoi(days)
		if err != nil || n < 1 || n > 365 {
			return c, fmt.Errorf("BUILDWITH_SESSION_DAYS: want 1-365, got %q", days)
		}
		c.SessionTTL = time.Duration(n) * 24 * time.Hour
	}

	var problems []error
	if c.DatabaseURL == "" {
		problems = append(problems, errors.New("BUILDWITH_DATABASE_URL is required"))
	}
	switch c.Env {
	case "development", "production":
	default:
		problems = append(problems, fmt.Errorf("BUILDWITH_ENV: want development or production, got %q", c.Env))
	}
	if !strings.HasPrefix(c.PublicOrigin, "http://") && !strings.HasPrefix(c.PublicOrigin, "https://") {
		problems = append(problems, fmt.Errorf("BUILDWITH_PUBLIC_ORIGIN: want an absolute URL, got %q", c.PublicOrigin))
	}
	if c.Env == "production" {
		if !strings.HasPrefix(c.PublicOrigin, "https://") {
			problems = append(problems, errors.New("BUILDWITH_PUBLIC_ORIGIN must be https in production"))
		}
		if len(os.Getenv("BUILDWITH_SESSION_SECRET")) < 32 {
			problems = append(problems, errors.New("BUILDWITH_SESSION_SECRET must be at least 32 characters in production"))
		}
	}

	return c, errors.Join(problems...)
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
