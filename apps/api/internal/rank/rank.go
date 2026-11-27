// Package rank computes front-page scores. The functions are pure; the worker
// feeds them rows and writes the results back every minute.
package rank

import (
	"math"
	"time"
)

// Item is everything the score depends on.
type Item struct {
	Points       int
	Comments     int
	Flags        int
	TrustedFlags int
	Created      time.Time

	DomainMultiplier  float64 // from domain_rules; 1 when there is no rule
	AuthorDomainPosts int     // same author + domain within 14 days, this one included
	NewAuthorArticle  bool    // an article by an account younger than a week
}

const (
	gravity          = 1.8
	pointsExponent   = 0.8
	ageOffsetHours   = 2
	flagFreeAllowed  = 2   // the first two flags cost nothing
	flagPenalty      = 0.8 // each further flag multiplies by this
	HideAtTrusted    = 6   // trusted flags at which an item drops off entirely
	flamewarComments = 40
	flamewarRatio    = 1.5
	flamewarPenalty  = 0.5
	selfPromoPosts   = 3
	selfPromoPenalty = 0.7
	newAuthorPenalty = 0.8
)

// Score implements
//
//	score = (points − 1)^0.8 / (age_h + 2)^1.8 × penalties
//
// with the penalties described in the moderation guidelines.
func Score(it Item, now time.Time) float64 {
	if it.TrustedFlags >= HideAtTrusted {
		return 0
	}
	ageH := max(0, now.Sub(it.Created).Hours())
	base := math.Pow(float64(max(0, it.Points-1)), pointsExponent) / math.Pow(ageH+ageOffsetHours, gravity)
	return base * Penalty(it)
}

// Penalty is the product of every multiplier applied to an item.
func Penalty(it Item) float64 {
	p := 1.0
	if extra := it.Flags - flagFreeAllowed; extra > 0 {
		p *= math.Pow(flagPenalty, float64(extra))
	}
	if it.Comments > flamewarComments && float64(it.Comments) > flamewarRatio*float64(it.Points) {
		p *= flamewarPenalty
	}
	if it.DomainMultiplier > 0 {
		p *= it.DomainMultiplier
	} else if it.DomainMultiplier < 0 {
		p = 0
	}
	if it.AuthorDomainPosts >= selfPromoPosts {
		p *= selfPromoPenalty
	}
	if it.NewAuthorArticle {
		p *= newAuthorPenalty
	}
	return p
}

// Karma thresholds for privileges.
const (
	KarmaToFlag         = 30
	KarmaToDownvote     = 100
	KarmaToProposeTags  = 300
	KarmaForFollowLinks = 50 // below this, links in your posts get rel="nofollow ugc"
	TrustedFlagKarma    = 100
	PopularNoteTraction = 25 // likes + reposts in 24 h to reach the "Popular notes" box
)
