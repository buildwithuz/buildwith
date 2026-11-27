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

type Chat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"` // private, group, supergroup, channel
}

type User struct {
	ID           int64  `json:"id"`
	IsBot        bool   `json:"is_bot"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	Username     string `json:"username"`
	LanguageCode string `json:"language_code"`
}

// Message carries only what the bot reads. Media is never inspected: support
// messages are relayed with copyMessage, which keeps photos, files and voice.
type Message struct {
	ID      int64    `json:"message_id"`
	Text    string   `json:"text"`
	Caption string   `json:"caption"`
	Chat    Chat     `json:"chat"`
	From    *User    `json:"from"`
	ReplyTo *Message `json:"reply_to_message"`
}

type Update struct {
	ID      int64    `json:"update_id"`
	Message *Message `json:"message"`
}

// SendText posts plain text, optionally as a reply, and returns the new message's id.
func (c *Client) SendText(ctx context.Context, chatID int64, text string, replyTo int64) (int64, error) {
	msg := map[string]any{"chat_id": chatID, "text": text, "link_preview_options": map[string]bool{"is_disabled": true}}
	if replyTo != 0 {
		msg["reply_parameters"] = map[string]any{"message_id": replyTo, "allow_sending_without_reply": true}
	}
	var out struct {
		ID int64 `json:"message_id"`
	}
	err := c.call(ctx, "sendMessage", msg, &out)
	return out.ID, err
}

// Copy re-sends a message (any kind) into another chat without a "forwarded
// from" header, and returns the copy's id.
func (c *Client) Copy(ctx context.Context, toChat, fromChat, messageID, replyTo int64) (int64, error) {
	msg := map[string]any{"chat_id": toChat, "from_chat_id": fromChat, "message_id": messageID}
	if replyTo != 0 {
		msg["reply_parameters"] = map[string]any{"message_id": replyTo, "allow_sending_without_reply": true}
	}
	var out struct {
		ID int64 `json:"message_id"`
	}
	err := c.call(ctx, "copyMessage", msg, &out)
	return out.ID, err
}

// React sets the bot's reaction on a message (one of Telegram's standard emoji).
func (c *Client) React(ctx context.Context, chatID, messageID int64, emoji string) error {
	return c.call(ctx, "setMessageReaction", map[string]any{
		"chat_id": chatID, "message_id": messageID,
		"reaction": []map[string]string{{"type": "emoji", "emoji": emoji}},
	}, nil)
}

// Updates long-polls for new messages after offset.
func (c *Client) Updates(ctx context.Context, offset int64) ([]Update, error) {
	var out []Update
	err := c.call(ctx, "getUpdates", map[string]any{"offset": offset, "timeout": 25, "allowed_updates": []string{"message"}}, &out)
	return out, err
}
