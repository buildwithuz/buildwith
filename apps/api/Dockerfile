# syntax=docker/dockerfile:1
# API, worker, bot and migrate binaries in one small image.
# Build from the repo root: docker build -f apps/api/Dockerfile --build-arg VERSION=v0.1.0 .

ARG GO_VERSION=1.26
ARG ALPINE_VERSION=3.24

FROM golang:${GO_VERSION} AS build
WORKDIR /src/apps/api
ENV CGO_ENABLED=0 GOFLAGS=-trimpath
COPY apps/api/ ./
ARG VERSION=dev
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -ldflags "-s -w -X main.version=${VERSION}" -o /out/server ./cmd/server \
 && go build -ldflags "-s -w" -o /out/ ./cmd/worker ./cmd/bot ./cmd/migrate

FROM alpine:${ALPINE_VERSION}
# ca-certificates for OAuth/Telegram/SMTP, tzdata for Asia/Tashkent, wget (busybox) for the healthcheck.
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app \
 && install -d -o app -g app /data/media
COPY --from=build /out/ /usr/local/bin/
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/buildwithuz/buildwith" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
ENV BUILDWITH_ENV=production BUILDWITH_API_ADDR=:8080 BUILDWITH_MEDIA_DIR=/data/media
USER app:app
WORKDIR /data
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/v1/health >/dev/null || exit 1
CMD ["server"]
