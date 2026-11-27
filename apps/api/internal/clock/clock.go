// Package clock gives logic an injectable source of time, so tests can be exact
// instead of approximate.
package clock

import "time"

// Clock reports the current time. Production uses System; tests use Fixed.
type Clock interface {
	Now() time.Time
}

// Func adapts a plain function to a Clock.
type Func func() time.Time

func (f Func) Now() time.Time { return f() }

// System reads the real clock, in UTC.
func System() Clock { return Func(func() time.Time { return time.Now().UTC() }) }

// Fixed always reports t.
func Fixed(t time.Time) Clock { return Func(func() time.Time { return t.UTC() }) }

// Tashkent is the display time zone. Everything is stored in UTC.
var Tashkent = time.FixedZone("Asia/Tashkent", 5*60*60)
