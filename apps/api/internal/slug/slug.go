// Package slug makes URL-safe, readable slugs from titles in either script.
package slug

import (
	"strings"
	"unicode"

	"github.com/buildwithuz/buildwith/apps/api/internal/translit"
)

// Make returns a lowercase ASCII slug of at most maxLen bytes, or "" if the
// title has no usable characters.
func Make(title string, maxLen int) string {
	s := translit.ForSearch(title)
	var b strings.Builder
	dash := false
	for _, r := range s {
		switch {
		case r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)):
			b.WriteRune(r)
			dash = false
		case !dash && b.Len() > 0:
			b.WriteByte('-')
			dash = true
		}
		if b.Len() >= maxLen {
			break
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > maxLen {
		out = strings.Trim(out[:maxLen], "-")
	}
	return out
}
