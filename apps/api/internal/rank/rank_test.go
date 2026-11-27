package rank

import (
	"math"
	"testing"
	"time"
)

var now = time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)

func item(points int, ageH float64) Item {
	return Item{Points: points, Created: now.Add(-time.Duration(ageH * float64(time.Hour))), DomainMultiplier: 1}
}

func TestScoreFormula(t *testing.T) {
	got := Score(item(11, 1), now)
	want := math.Pow(10, 0.8) / math.Pow(3, 1.8)
	if math.Abs(got-want) > 1e-12 {
		t.Fatalf("got %v want %v", got, want)
	}
	if Score(item(1, 0), now) != 0 {
		t.Fatal("a post with only its author's point scores zero")
	}
}

func TestOrdering(t *testing.T) {
	cases := []struct {
		name          string
		higher, lower Item
	}{
		{"more points ranks higher", item(50, 3), item(10, 3)},
		{"newer ranks higher at equal points", item(20, 1), item(20, 10)},
		{"a strong old post can beat a weak new one", item(300, 12), item(3, 1)},
	}
	for _, c := range cases {
		if Score(c.higher, now) <= Score(c.lower, now) {
			t.Errorf("%s: %v <= %v", c.name, Score(c.higher, now), Score(c.lower, now))
		}
	}
}

func TestPenalties(t *testing.T) {
	base := item(30, 2)
	cases := []struct {
		name   string
		mutate func(*Item)
		want   float64
	}{
		{"two flags are free", func(i *Item) { i.Flags = 2 }, 1},
		{"each flag after two costs 20%", func(i *Item) { i.Flags = 4 }, 0.64},
		{"flamewar halves", func(i *Item) { i.Comments = 60 }, 0.5},
		{"many comments with many points is not a flamewar", func(i *Item) { i.Points = 100; i.Comments = 60 }, 1},
		{"domain multiplier", func(i *Item) { i.DomainMultiplier = 0.5 }, 0.5},
		{"self promotion", func(i *Item) { i.AuthorDomainPosts = 3 }, 0.7},
		{"new author article", func(i *Item) { i.NewAuthorArticle = true }, 0.8},
		{"penalties multiply", func(i *Item) { i.AuthorDomainPosts = 5; i.NewAuthorArticle = true }, 0.56},
	}
	for _, c := range cases {
		it := base
		c.mutate(&it)
		if got := Penalty(it); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("%s: penalty %v, want %v", c.name, got, c.want)
		}
	}
}

func TestTrustedFlagsHide(t *testing.T) {
	it := item(500, 1)
	it.TrustedFlags = HideAtTrusted
	if Score(it, now) != 0 {
		t.Fatal("six trusted flags must drop the item")
	}
}
