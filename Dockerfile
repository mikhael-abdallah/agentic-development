# The simulator as one process: a Go binary that answers /simulate and serves
# the exported web app from the same origin.
#
# Every base image is pinned by digest as well as by tag. A tag is a name its
# publisher can move; a digest is the bytes. That is the same rule the
# workflows follow for actions, and it is what makes a rebuild of this file
# next month produce the image it produced today.
#
# The toolchain versions match scripts/guards/go-env.sh and web-env.sh on
# purpose: an image built from a different Go or Node than the one the gates
# ran is an artifact nothing has checked.

# --- the engine --------------------------------------------------------------
FROM golang:1.26.5-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS engine

WORKDIR /src/engine
# The manifests alone first, so the module download is a cached layer that
# survives every change to the source below it.
COPY engine/go.mod engine/go.sum ./
RUN go mod download

COPY engine/ ./
# CGO off and a static link, because the runtime image has no libc to link
# against. -trimpath keeps the build directory out of the binary; -s -w drop
# the symbol and DWARF tables, which nothing in a distroless image can read.
RUN CGO_ENABLED=0 GOFLAGS=-mod=readonly \
  go build -trimpath -ldflags="-s -w" -o /out/engined ./cmd/engined

# --- the web app -------------------------------------------------------------
FROM node:24.18.1-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3 AS web

WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
# npm ci, not npm install: it installs the lockfile exactly and fails if
# package.json and the lockfile disagree, which is the property that makes this
# build reproducible rather than merely repeatable.
RUN npm ci --no-audit --no-fund

COPY web/ ./
RUN npm run build

# --- what actually ships -----------------------------------------------------
# distroless/static: no shell, no package manager, no libc — nothing to run
# but the binary. There is no `docker exec` into this image, which is the
# point: the smallest thing that can serve the product is also the smallest
# thing an attacker who reaches it can use.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:f5b485ea962d9bd1186b2f6b3a061191539b905b82ec395de78cbfae51f20e35

COPY --from=engine /out/engined /engined
COPY --from=web /src/web/out /srv/web

# nonroot (uid 65532) comes from the base image tag. Named again here so that
# changing the tag cannot quietly hand this process root.
USER nonroot
EXPOSE 8080

# Exec form, so engined is pid 1 and receives the SIGTERM `docker stop` sends
# — the signal it already shuts down gracefully on. Wrapped in a shell it
# would be pid 1's child and get nothing.
ENTRYPOINT ["/engined"]
CMD ["-addr", ":8080", "-assets", "/srv/web"]
