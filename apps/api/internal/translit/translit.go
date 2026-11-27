// Package translit converts Uzbek between Latin and Cyrillic script and builds
// search keys that match across both scripts and every apostrophe spelling.
//
// It mirrors packages/translit (TypeScript) exactly; both are tested against
// packages/translit/testdata/vectors.json. Change the vectors first, then both.
package translit

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"strings"
	"unicode"
)

const (
	// OKina is the modifier letter turned comma, the mark in oʻ and gʻ.
	OKina = 'ʻ' // U+02BB
	// Tutuq is the modifier letter apostrophe, the separator in maʼno.
	Tutuq = 'ʼ' // U+02BC
)

// loanwords.json is a copy of packages/translit/testdata/loanwords.json; a test
// fails if the two drift.
//
//go:embed loanwords.json
var loanwordsJSON []byte

var loanStems = func() []string {
	var f struct {
		Stems []string `json:"stems"`
	}
	if err := json.Unmarshal(loanwordsJSON, &f); err != nil {
		panic("translit: bad loanwords.json: " + err.Error())
	}
	return f.Stems
}()

// protected matches spans that are never transliterated: URLs, emails,
// @usernames and #tags.
var protected = regexp.MustCompile(`https?://\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|[@#][\w-]+`)

func isApostrophe(r rune) bool {
	switch r {
	case '\'', '’', '‘', '`', Tutuq, OKina:
		return true
	}
	return false
}

func isMark(r rune) bool { return r == OKina || r == Tutuq }

// Normalize fixes apostrophes: after o or g, before a letter, any apostrophe-like
// character is the oʻ/gʻ mark; between two other letters it is the separator.
// Anything else (quotes around words, say) is left alone.
func Normalize(s string) string {
	rs := []rune(s)
	for i, r := range rs {
		if !isApostrophe(r) || i == 0 || i == len(rs)-1 {
			continue
		}
		prev, next := rs[i-1], rs[i+1]
		if !unicode.IsLetter(prev) || !unicode.IsLetter(next) {
			continue
		}
		switch unicode.ToLower(prev) {
		case 'o', 'g':
			rs[i] = OKina
		default:
			rs[i] = Tutuq
		}
	}
	return string(rs)
}

// ToCyrillic converts Latin Uzbek to Cyrillic, leaving protected spans as they are.
func ToCyrillic(s string) string { return mapUnprotected(Normalize(s), wordsToCyrillic) }

// ToLatin converts Cyrillic Uzbek to Latin, leaving protected spans as they are.
func ToLatin(s string) string { return mapUnprotected(s, wordsToLatin) }

// ForSearch builds the key stored in search columns and used for queries:
// Latin, lowercase, no apostrophes, single spaces.
func ForSearch(s string) string {
	s = strings.ToLower(ToLatin(Normalize(s)))
	s = strings.Map(func(r rune) rune {
		if isApostrophe(r) {
			return -1
		}
		return r
	}, s)
	return strings.Join(strings.Fields(s), " ")
}

func mapUnprotected(s string, f func(string) string) string {
	var b strings.Builder
	last := 0
	for _, m := range protected.FindAllStringIndex(s, -1) {
		b.WriteString(f(s[last:m[0]]))
		b.WriteString(s[m[0]:m[1]])
		last = m[1]
	}
	b.WriteString(f(s[last:]))
	return b.String()
}

// splitWords cuts s into alternating runs of word and non-word characters.
// The oʻ mark and the separator belong to words.
func splitWords(s string, each func(chunk []rune, word bool)) {
	rs := []rune(s)
	start := 0
	for i := 1; i <= len(rs); i++ {
		if i == len(rs) || isWordRune(rs[i]) != isWordRune(rs[start]) {
			each(rs[start:i], isWordRune(rs[start]))
			start = i
		}
	}
}

func isWordRune(r rune) bool { return unicode.IsLetter(r) || isMark(r) }

func wordsToCyrillic(s string) string {
	var b strings.Builder
	splitWords(s, func(w []rune, word bool) {
		if word {
			b.WriteString(wordToCyrillic(w))
		} else {
			b.WriteString(string(w))
		}
	})
	return b.String()
}

var latinSingle = map[rune]string{
	'a': "а", 'b': "б", 'd': "д", 'e': "е", 'f': "ф", 'g': "г", 'h': "ҳ", 'i': "и",
	'j': "ж", 'k': "к", 'l': "л", 'm': "м", 'n': "н", 'o': "о", 'p': "п", 'q': "қ",
	'r': "р", 's': "с", 't': "т", 'u': "у", 'v': "в", 'x': "х", 'y': "й", 'z': "з",
	'c': "к", 'w': "в",
}

var latinY = map[rune]string{'e': "е", 'o': "ё", 'u': "ю", 'a': "я"}

func casedAs(model rune, cyr string) string {
	if unicode.IsUpper(model) {
		return strings.ToUpper(cyr)
	}
	return cyr
}

func wordToCyrillic(w []rune) string {
	lower := strings.ToLower(string(w))
	// The span of the word covered by a loanword stem, where ts means ц.
	loanEnd := 0
	for _, stem := range loanStems {
		if strings.HasPrefix(lower, stem) {
			loanEnd = max(loanEnd, len([]rune(stem)))
		}
	}

	var b strings.Builder
	at := func(i int) rune {
		if i < len(w) {
			return unicode.ToLower(w[i])
		}
		return 0
	}
	for i := 0; i < len(w); {
		r, c, n := w[i], at(i), at(i+1)
		switch {
		case (c == 'o' || c == 'g') && n == OKina:
			b.WriteString(casedAs(r, map[rune]string{'o': "ў", 'g': "ғ"}[c]))
			i += 2
		case c == 's' && n == 'h', c == 'c' && n == 'h':
			b.WriteString(casedAs(r, map[rune]string{'s': "ш", 'c': "ч"}[c]))
			i += 2
		case c == 'y' && latinY[n] != "" && !(n == 'o' && at(i+2) == OKina):
			b.WriteString(casedAs(r, latinY[n]))
			i += 2
		case c == 't' && n == 's' && i+1 < loanEnd:
			b.WriteString(casedAs(r, "ц"))
			i += 2
		case c == 'e' && i == 0:
			b.WriteString(casedAs(r, "э"))
			i++
		case r == Tutuq:
			// Between s or c and h the separator only exists to block a digraph.
			if !((at(i-1) == 's' || at(i-1) == 'c') && n == 'h') {
				b.WriteString("ъ")
			}
			i++
		case latinSingle[c] != "":
			b.WriteString(casedAs(r, latinSingle[c]))
			i++
		default:
			b.WriteRune(r)
			i++
		}
	}
	return b.String()
}

var cyrSingle = map[rune]string{
	'а': "a", 'б': "b", 'в': "v", 'г': "g", 'ғ': "gʻ", 'д': "d", 'ё': "yo", 'ж': "j",
	'з': "z", 'и': "i", 'й': "y", 'к': "k", 'қ': "q", 'л': "l", 'м': "m", 'н': "n",
	'о': "o", 'ў': "oʻ", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u", 'ф': "f",
	'х': "x", 'ҳ': "h", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'ъ': "ʼ", 'ь': "", 'э': "e",
	'ю': "yu", 'я': "ya", 'ы': "i", 'щ': "sh",
}

func isCyrVowel(r rune) bool { return strings.ContainsRune("аеёиоуўэюя", unicode.ToLower(r)) }

func wordsToLatin(s string) string {
	var b strings.Builder
	splitWords(s, func(w []rune, word bool) {
		if !word {
			b.WriteString(string(w))
			return
		}
		allCaps := len(w) > 1
		for _, r := range w {
			if unicode.IsLetter(r) && !unicode.IsUpper(r) {
				allCaps = false
				break
			}
		}
		for i, r := range w {
			c := unicode.ToLower(r)
			lat, ok := cyrSingle[c]
			if c == 'е' {
				ok = true
				if i == 0 || isCyrVowel(w[i-1]) {
					lat = "ye"
				} else {
					lat = "e"
				}
			}
			if !ok {
				b.WriteRune(r)
				continue
			}
			switch {
			case !unicode.IsUpper(r) || lat == "":
				b.WriteString(lat)
			case allCaps:
				b.WriteString(strings.ToUpper(lat))
			default:
				rs := []rune(lat)
				b.WriteString(strings.ToUpper(string(rs[0])) + string(rs[1:]))
			}
		}
	})
	return b.String()
}
