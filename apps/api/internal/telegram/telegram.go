// Package telegram is a minimal Bot API client: just what the bot and the
// worker use. Requests go through internal/fetch like every outbound call.
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/buildwithuz/buildwith/apps/api/internal/fetch"
)

type Client struct {
	token string
	fetch *fetch.Client
}

func New(token string, f *fetch.Client) *Client { return &Client{token: token, fetch: f} }

func (c *Client) call(ctx context.Context, method string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.telegram.org/bot"+c.token+"/"+method, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	_, raw, err := c.fetch.Do(req)
	if err != nil {
		return fmt.Errorf("telegram %s: %w", method, err)
	}
	var env struct {
		OK          bool            `json:"ok"`
		Description string          `json:"description"`
		Result      json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("telegram %s: %w", method, err)
	}
	if !env.OK {
		return fmt.Errorf("telegram %s: %s", method, env.Description)
	}
	if out != nil {
		return json.Unmarshal(env.Result, out)
	}
	return nil
}

// Send posts a plain-text message with an optional link button.
func (c *Client) Send(ctx context.Context, chatID any, text, buttonText, buttonURL string) error {
	msg := map[string]any{"chat_id": chatID, "text": text, "link_preview_options": map[string]bool{"is_disabled": true}}
	if buttonURL != "" {
		msg["reply_markup"] = map[string]any{"inline_keyboard": [][]map[string]string{{{"text": buttonText, "url": buttonURL}}}}
	}
	return c.call(ctx, "sendMessage", msg, nil)
}

type Update struct {
	ID      int64 `json:"update_id"`
	Message *struct {
		Text string `json:"text"`
		Chat struct {
			ID   int64  `json:"id"`
			Type string `json:"type"`
		} `json:"chat"`
		From struct {
			ID           int64  `json:"id"`
			Username     string `json:"username"`
			LanguageCode string `json:"language_code"`
		} `json:"from"`
	} `json:"message"`
}

// Updates long-polls for new messages after offset.
func (c *Client) Updates(ctx context.Context, offset int64) ([]Update, error) {
	var out []Update
	err := c.call(ctx, "getUpdates", map[string]any{"offset": offset, "timeout": 25, "allowed_updates": []string{"message"}}, &out)
	return out, err
}
