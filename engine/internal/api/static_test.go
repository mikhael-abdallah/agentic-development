package api_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/api"
)

// app stands in for what `next build` exports: a page, a hashed chunk, and the
// directory names both live under.
func app() fstest.MapFS {
	return fstest.MapFS{
		"index.html":                  {Data: []byte("<!doctype html><title>simulator</title>")},
		"_next/static/chunks/main.js": {Data: []byte("console.log(1)")},
		"_next/static/css/app.css":    {Data: []byte("body{}")},
		"_next/data/build/index.json": {Data: []byte("{}")},
		"favicon.ico":                 {Data: []byte("\x00\x00\x01\x00")},
		"404.html":                    {Data: []byte("<!doctype html>not found")},
		// A file the file server would happily answer /scenarios with, so that
		// the shadowing test below asks a real question.
		"scenarios": {Data: []byte("<!doctype html>not the api")},
	}
}

func get(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestTheAppIsServedAtTheRoot(t *testing.T) {
	t.Parallel()
	rec := get(t, api.Handler(app()), "/")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET / = %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), "<title>simulator</title>") {
		t.Errorf("GET / served %q, want index.html", rec.Body.String())
	}
}

func TestAssetsAreServedFromTheirOwnPaths(t *testing.T) {
	t.Parallel()
	rec := get(t, api.Handler(app()), "/_next/static/chunks/main.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET a chunk = %d, want %d", rec.Code, http.StatusOK)
	}
	if rec.Body.String() != "console.log(1)" {
		t.Errorf("chunk body = %q, want the file's contents", rec.Body.String())
	}
}

// A hashed name changes when its contents do, so keeping the old copy forever
// is safe. index.html keeps its name across every build, so keeping it is how
// a browser ends up running last week's app against this week's engine.
func TestOnlyTheHashedFilesAreCachedForever(t *testing.T) {
	t.Parallel()
	handler := api.Handler(app())
	tests := []struct {
		name string
		path string
		want string
	}{
		{"a hashed chunk", "/_next/static/chunks/main.js", "public, max-age=31536000, immutable"},
		{"a hashed stylesheet", "/_next/static/css/app.css", "public, max-age=31536000, immutable"},
		{"the page itself", "/", "no-cache"},
		{"an unhashed asset", "/favicon.ico", "no-cache"},
		{
			"under _next but outside static/, where the hashing stops",
			"/_next/data/build/index.json", "no-cache",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := get(t, handler, tt.path).Header().Get("Cache-Control"); got != tt.want {
				t.Errorf("Cache-Control for %s = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

func TestAPathTheAppDoesNotHaveIsNotFound(t *testing.T) {
	t.Parallel()
	if code := get(t, api.Handler(app()), "/nothing-here").Code; code != http.StatusNotFound {
		t.Errorf("GET a missing page = %d, want %d", code, http.StatusNotFound)
	}
}

// The catch-all route is registered for the whole path space, so every API
// route is now something it could swallow. These are the answers the router
// gave before there was a web app to fall through to.
func TestServingTheAppDoesNotSwallowTheAPI(t *testing.T) {
	t.Parallel()
	handler := api.Handler(app())
	tests := []struct {
		name   string
		method string
		path   string
		want   int
	}{
		{"health still answers", http.MethodGet, "/healthz", http.StatusOK},
		{"scenarios still answer", http.MethodGet, "/scenarios", http.StatusOK},
		{
			"a GET to /simulate is the wrong method, not a missing page",
			http.MethodGet, "/simulate", http.StatusMethodNotAllowed,
		},
		{
			"a POST to /scenarios is still the wrong method",
			http.MethodPost, "/scenarios", http.StatusMethodNotAllowed,
		},
		{
			"a POST to /healthz is still the wrong method",
			http.MethodPost, "/healthz", http.StatusMethodNotAllowed,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))
			if rec.Code != tt.want {
				t.Errorf("%s %s = %d, want %d", tt.method, tt.path, rec.Code, tt.want)
			}
		})
	}
}

// A refused method is worth a header saying which one would work: it is the
// difference between a client that can correct itself and one that guesses.
func TestARefusedSimulateSaysWhichMethodToUse(t *testing.T) {
	t.Parallel()
	rec := get(t, api.Handler(app()), "/simulate")
	if got := rec.Header().Get("Allow"); got != http.MethodPost {
		t.Errorf("Allow = %q, want %q", got, http.MethodPost)
	}
	if !strings.Contains(rec.Body.String(), "POST") {
		t.Errorf("body = %q, want it to name the method", rec.Body.String())
	}
}

// A page named like an API route must not shadow it. The file exists in the
// stand-in app precisely so that this is a real question rather than a
// hypothetical one.
func TestAPageCannotTakeOverAnAPIPath(t *testing.T) {
	t.Parallel()
	rec := get(t, api.Handler(app()), "/scenarios")
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("GET /scenarios served %q, want the API's JSON", ct)
	}
}

func TestWithoutAnAppTheRootIsStillNotFound(t *testing.T) {
	t.Parallel()
	if code := get(t, api.Handler(nil), "/").Code; code != http.StatusNotFound {
		t.Errorf("GET / with no app = %d, want %d", code, http.StatusNotFound)
	}
}

func TestNoAssetsAskedForIsNotAFailure(t *testing.T) {
	t.Parallel()
	assets, err := api.AssetsAt("")
	if err != nil {
		t.Fatalf("AssetsAt(\"\") = %v, want no error", err)
	}
	if assets != nil {
		t.Errorf("AssetsAt(\"\") = %v, want nothing to serve", assets)
	}
}

// The flag is a path someone typed. A wrong one that is discovered on the
// first page request looks like a broken build; discovered at startup it looks
// like what it is.
func TestADirectoryWithNoAppIsRefused(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		dir  func(t *testing.T) string
	}{
		{"a directory that is not there", func(t *testing.T) string {
			t.Helper()
			return filepath.Join(t.TempDir(), "absent")
		}},
		{"a directory with no index.html", func(t *testing.T) string {
			t.Helper()
			return t.TempDir()
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			dir := tt.dir(t)
			if _, err := api.AssetsAt(dir); err == nil {
				t.Errorf("AssetsAt(%q) accepted a directory with no web app in it", dir)
			}
		})
	}
}

func TestADirectoryWithAnAppInItIsServed(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	page := []byte("<!doctype html><title>from disk</title>")
	if err := os.WriteFile(filepath.Join(dir, "index.html"), page, 0o600); err != nil {
		t.Fatalf("writing the stand-in app: %v", err)
	}
	assets, err := api.AssetsAt(dir)
	if err != nil {
		t.Fatalf("AssetsAt(%q) = %v, want the app", dir, err)
	}
	if body := get(t, api.Handler(assets), "/").Body.String(); !strings.Contains(body, "from disk") {
		t.Errorf("GET / served %q, want the file on disk", body)
	}
}
