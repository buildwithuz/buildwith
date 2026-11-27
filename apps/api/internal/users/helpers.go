package users

import (
	"net/http"
	"strconv"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"
)

func dateOf(t time.Time) openapi_types.Date { return openapi_types.Date{Time: t} }

// exportResponse sets a download filename, which the generated zip response
// type has no header for.
type exportResponse struct {
	data     []byte
	username string
}

func (e exportResponse) VisitExportMeResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="buildwith-`+e.username+`.zip"`)
	w.Header().Set("Content-Length", strconv.Itoa(len(e.data)))
	w.WriteHeader(http.StatusOK)
	_, err := w.Write(e.data)
	return err
}
