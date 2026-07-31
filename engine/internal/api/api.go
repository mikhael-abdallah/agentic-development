// Package api is the HTTP transport for the simulation engine.
//
// It converts between the wire format and the core's types and does nothing
// else. No simulation logic lives here, nothing here is imported by the core,
// and the one piece of knowledge it owns is what this server will agree to do
// for a single unauthenticated request.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

// Handler is the engine's HTTP surface.
//
// The patterns name their methods, so a GET to /simulate is answered with 405
// by the router rather than by a check every handler would have to remember.
func Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health)
	mux.HandleFunc("GET /scenarios", scenarios)
	mux.HandleFunc("POST /simulate", simulate)
	return mux
}

// NewServer wires the handler into a server with a timeout on every stage of
// a request.
//
// A server without them holds a connection open for as long as the peer likes,
// which is a resource an unauthenticated client controls. ReadHeaderTimeout is
// the one that closes the slow-headers hole, and gosec requires it for exactly
// that reason. WriteTimeout has to outlast the longest simulation this server
// will accept, or the answer is cut off after the work is done — the least
// useful possible failure.
func NewServer(addr string) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}
}

// shutdownGrace is how long a simulation already running gets to finish and
// answer. Cutting one off mid-run wastes the work and tells the client
// nothing, and a container stop is not an emergency.
const shutdownGrace = 15 * time.Second

// Serve runs srv until ctx is cancelled, then lets the requests already in
// flight finish before returning.
//
// This lives here rather than in main because it is the part with a decision
// in it, and a decision made in main is one nothing can test.
func Serve(ctx context.Context, srv *http.Server) error {
	// Derived, so that a listener which never starts releases the shutdown
	// watcher as well rather than parking it on a signal that will not come.
	ctx, release := context.WithCancel(ctx)
	defer release()

	stopped := make(chan error, 1)
	go func() {
		<-ctx.Done()
		// WithoutCancel, because the deadline for finishing gracefully cannot
		// be derived from the context that just said to stop: it would arrive
		// already cancelled and turn the shutdown into the abrupt one it
		// exists to avoid. What carries over is everything else about ctx.
		grace, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownGrace)
		defer cancel()
		stopped <- srv.Shutdown(grace)
	}()

	// A closed server is the successful outcome here, not an error: it is
	// what Shutdown above makes ListenAndServe return.
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return <-stopped
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// errorBody is what a failed request gets back. One shape for every failure,
// so a client has one thing to parse rather than a status code and a guess.
type errorBody struct {
	Error string `json:"error"`
}

func writeError(w http.ResponseWriter, status int, reason string) {
	writeJSON(w, status, errorBody{Error: reason})
}

// writeJSON encodes before it commits to a status code.
//
// Streaming straight to the ResponseWriter would send 200 and then discover
// the body cannot be encoded, leaving the client a truncated document under a
// header promising success. Marshalling first costs one buffer and makes the
// failure reportable.
func writeJSON(w http.ResponseWriter, status int, body any) {
	payload, err := json.Marshal(body)
	if err != nil {
		http.Error(w, "the response could not be encoded", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(payload) // The client hung up; there is nobody left to tell.
}
