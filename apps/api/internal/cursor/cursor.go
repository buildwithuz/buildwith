// Package cursor encodes keyset pagination positions as opaque strings, so
// clients cannot depend on their shape.
package cursor

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"
)

var ErrInvalid = errors.New("invalid cursor")

// Pos is the last row of a page: its sort value and its id.
type Pos struct {
	T  *time.Time `json:"t,omitempty"`
	F  *float64   `json:"f,omitempty"`
	N  *int64     `json:"n,omitempty"`
	ID int64      `json:"i"`
}

func Encode(p Pos) *string {
	b, _ := json.Marshal(p)
	s := base64.RawURLEncoding.EncodeToString(b)
	return &s
}

func Decode(s *string) (*Pos, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(*s)
	if err != nil {
		return nil, ErrInvalid
	}
	var p Pos
	if err := json.Unmarshal(b, &p); err != nil || p.ID <= 0 {
		return nil, ErrInvalid
	}
	return &p, nil
}

func ByTime(t time.Time, id int64) *string { return Encode(Pos{T: &t, ID: id}) }
func ByFloat(f float64, id int64) *string  { return Encode(Pos{F: &f, ID: id}) }
func ByInt(n int64, id int64) *string      { return Encode(Pos{N: &n, ID: id}) }

// Limit clamps a requested page size.
func Limit(l *int, def int) int32 {
	if l == nil || *l < 1 {
		return int32(def)
	}
	return int32(min(*l, 100))
}

// Next returns the cursor for the page after rows, or nil when the page was short.
func Next[T any](rows []T, limit int32, pos func(T) *string) *string {
	if len(rows) < int(limit) || len(rows) == 0 {
		return nil
	}
	return pos(rows[len(rows)-1])
}
