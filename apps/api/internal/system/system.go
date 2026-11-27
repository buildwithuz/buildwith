// Package system holds operational endpoints.
package system

import (
	"context"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
)

type System struct{ A *app.App }

func (h *System) GetHealth(ctx context.Context, _ api.GetHealthRequestObject) (api.GetHealthResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := h.A.Pool.Ping(ctx); err != nil {
		return nil, httpx.Coded(503, api.ErrorCodeInternal, "database unreachable")
	}
	return api.GetHealth200JSONResponse{Status: api.Ok, Version: h.A.Version}, nil
}
