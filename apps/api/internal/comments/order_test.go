package comments

import (
	"testing"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
)

func c(id int64, parent int64, points int, minute int) api.Comment {
	cm := api.Comment{Id: id, Points: points, CreatedAt: time.Date(2026, 1, 1, 0, minute, 0, 0, time.UTC)}
	if parent != 0 {
		cm.ParentId = &parent
	}
	return cm
}

func TestBestOrdersSiblingsByPointsAndKeepsNesting(t *testing.T) {
	// Path order: 1 (2 pts), 1>3 (1), 1>4 (9), 2 (10), 2>5 (1)
	in := []api.Comment{c(1, 0, 2, 0), c(3, 1, 1, 2), c(4, 1, 9, 3), c(2, 0, 10, 1), c(5, 2, 1, 4)}
	var got []int64
	for _, x := range Best(in) {
		got = append(got, x.Id)
	}
	want := []int64{2, 5, 1, 4, 3}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestBestTiesGoToEarlier(t *testing.T) {
	out := Best([]api.Comment{c(2, 0, 3, 5), c(1, 0, 3, 1)})
	if out[0].Id != 1 {
		t.Fatalf("earlier comment should win a tie, got %d first", out[0].Id)
	}
}
