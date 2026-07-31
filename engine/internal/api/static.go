package api

import (
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"strings"
)

// AssetsAt opens the built web app for [Handler] to serve, or reports that
// there is nothing there. An empty dir means the JSON API alone, which is what
// engined does when it is run without a web build beside it.
//
// index.html is checked rather than the directory, because the failure this
// prevents is a quiet one: a server started with the wrong path answers every
// API request correctly and every page request with 404, which reads as a
// broken web build rather than a mistyped flag. Refusing to start says which.
func AssetsAt(dir string) (fs.FS, error) {
	if dir == "" {
		return nil, nil
	}
	assets := os.DirFS(dir)
	if _, err := fs.Stat(assets, "index.html"); err != nil {
		return nil, fmt.Errorf("no web app at %s: %w", dir, err)
	}
	return assets, nil
}

// hashedPrefix is where Next puts the files whose names contain a hash of
// their contents.
const hashedPrefix = "/_next/static/"

// forever is the longest max-age HTTP defines a meaning for. Safe only for the
// hashed files: their name changes when their bytes do, so a stale copy is
// never asked for again.
const forever = "public, max-age=31536000, immutable"

// staticFiles serves the exported app, telling the browser which parts of it
// are safe to keep.
//
// Everything outside the hashed directory is revalidated on every request.
// index.html keeps its name across every build, and a browser holding the
// previous one would run last week's app against this week's engine — the
// failure being that it mostly works.
func staticFiles(assets fs.FS) http.Handler {
	files := http.FileServerFS(assets)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, hashedPrefix) {
			w.Header().Set("Cache-Control", forever)
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

// simulateNeedsPost answers the one API request the web app's catch-all route
// would otherwise swallow.
//
// /healthz and /scenarios answer GET, so a wrong method on them still matches
// no pattern and the router still says 405. /simulate answers POST, so a GET
// to it would fall through to "GET /" and come back as a missing page: the
// router's own answer about the method, silently replaced by a worse one the
// moment there is a web app to fall through to.
func simulateNeedsPost(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Allow", http.MethodPost)
	writeError(w, http.StatusMethodNotAllowed, "simulations are started with POST")
}
