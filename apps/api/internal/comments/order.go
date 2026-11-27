package comments

import (
	"sort"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
)

// Best reorders a thread (given in path order) so that siblings are sorted by
// points, highest first, keeping every reply under its parent. Ties go to the
// earlier comment. This is what makes the best answer to a Savol rise.
func Best(items []api.Comment) []api.Comment {
	children := map[int64][]api.Comment{}
	var roots []api.Comment
	byID := map[int64]bool{}
	for _, c := range items {
		byID[c.Id] = true
	}
	for _, c := range items {
		if c.ParentId == nil || !byID[*c.ParentId] {
			roots = append(roots, c)
		} else {
			children[*c.ParentId] = append(children[*c.ParentId], c)
		}
	}
	less := func(s []api.Comment) func(i, j int) bool {
		return func(i, j int) bool {
			if s[i].Points != s[j].Points {
				return s[i].Points > s[j].Points
			}
			return s[i].CreatedAt.Before(s[j].CreatedAt)
		}
	}
	out := make([]api.Comment, 0, len(items))
	var walk func([]api.Comment)
	walk = func(level []api.Comment) {
		sort.SliceStable(level, less(level))
		for _, c := range level {
			out = append(out, c)
			walk(children[c.Id])
		}
	}
	walk(roots)
	return out
}
