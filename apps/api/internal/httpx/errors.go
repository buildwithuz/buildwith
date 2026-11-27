// Package httpx holds the HTTP plumbing shared by every domain: errors,
// sessions in the request context, CSRF, logging and recovery.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
)

// Error is the only error type handlers return. Anything else is logged and
// reported to the client as an opaque "internal" error.
type Error struct {
	Status     int
	Code       api.ErrorCode
	Message    string
	Field      string
	RetryAfter int // seconds; only for rate_limited
}

func (e *Error) Error() string { return fmt.Sprintf("%d %s: %s", e.Status, e.Code, e.Message) }

func newErr(status int, code api.ErrorCode, msg string) *Error {
	return &Error{Status: status, Code: code, Message: msg}
}

func BadRequest(msg string) *Error {
	return newErr(http.StatusBadRequest, api.ErrorCodeBadRequest, msg)
}
func Unauthorized() *Error {
	return newErr(http.StatusUnauthorized, api.ErrorCodeUnauthorized, "sign in required")
}
func Forbidden(msg string) *Error { return newErr(http.StatusForbidden, api.ErrorCodeForbidden, msg) }
func NotFound(what string) *Error {
	return newErr(http.StatusNotFound, api.ErrorCodeNotFound, what+" not found")
}
func Conflict(msg string) *Error { return newErr(http.StatusConflict, api.ErrorCodeConflict, msg) }
func NotConfigured(what string) *Error {
	return newErr(http.StatusNotImplemented, api.ErrorCodeNotConfigured, what+" is not configured on this server")
}

// Invalid reports a request field that is understood but not acceptable.
func Invalid(field, msg string) *Error {
	e := newErr(http.StatusUnprocessableEntity, api.ErrorCodeInvalid, msg)
	e.Field = field
	return e
}

// Coded is a 4xx with a specific code from the ErrorCode enum.
func Coded(status int, code api.ErrorCode, msg string) *Error { return newErr(status, code, msg) }

func RateLimited(retryAfter int) *Error {
	e := newErr(http.StatusTooManyRequests, api.ErrorCodeRateLimited, "slow down")
	e.RetryAfter = retryAfter
	return e
}

// IsNoRows reports whether err means a single-row query found nothing.
func IsNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// NotFoundIfNoRows maps pgx.ErrNoRows to a 404 and passes anything else through.
func NotFoundIfNoRows(err error, what string) error {
	if IsNoRows(err) {
		return NotFound(what)
	}
	return err
}

// WriteError renders any error as the API's Error schema.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var e *Error
	if !errors.As(err, &e) {
		e = fromDatabase(err)
	}
	if e == nil {
		slog.ErrorContext(r.Context(), "request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		e = newErr(http.StatusInternalServerError, api.ErrorCodeInternal, "something went wrong")
	}
	if e.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(e.RetryAfter))
	}
	body := api.Error{Code: e.Code, Message: e.Message}
	if e.Field != "" {
		body.Field = &e.Field
	}
	WriteJSON(w, e.Status, body)
}

// fromDatabase turns constraint violations into client errors. The schema's
// checks are a backstop: handlers validate first and give better messages.
func fromDatabase(err error) *Error {
	var pg *pgconn.PgError
	if !errors.As(err, &pg) {
		return nil
	}
	switch pg.Code {
	case "23514": // check_violation
		return Invalid(pg.ConstraintName, "a field is out of range")
	case "23505": // unique_violation
		return Conflict("that already exists")
	case "23503": // foreign_key_violation
		return Invalid(pg.ConstraintName, "refers to something that does not exist")
	}
	return nil
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
