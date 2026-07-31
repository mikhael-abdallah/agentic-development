package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/api"
)

// design is the smallest thing worth simulating: one client, one service.
const design = `{
  "topology": {
    "nodes": [
      {"id": "client", "kind": "client"},
      {"id": "api", "kind": "service",
       "service": {"instances": 2, "meanServiceMs": 5, "queueCapacity": 0}}
    ],
    "edges": [{"from": "client", "to": "api"}]
  },
  "workload": {
    "rateRps": 100, "readFraction": 1, "durationMs": 5000,
    "seed": 7, "warmupFraction": 0.2
  }
}`

// post sends a body to /simulate and returns the recorded response.
func post(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/simulate", strings.NewReader(body))
	rec := httptest.NewRecorder()
	api.Handler(nil).ServeHTTP(rec, req)
	return rec
}

// decodeInto unmarshals a response body, failing the test if it is not JSON.
func decodeInto(t *testing.T, rec *httptest.ResponseRecorder, into any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), into); err != nil {
		t.Fatalf("response is not JSON (%v): %s", err, rec.Body.String())
	}
}

func TestHealthzAnswers(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	api.Handler(nil).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("GET /healthz = %d, want %d", rec.Code, http.StatusOK)
	}
	var body map[string]string
	decodeInto(t, rec, &body)
	if body["status"] != "ok" {
		t.Errorf("GET /healthz reported %q", body["status"])
	}
}

func TestSimulateReturnsAResult(t *testing.T) {
	t.Parallel()
	rec := post(t, design)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /simulate = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q", got)
	}
	var body struct {
		Arrived    int     `json:"arrived"`
		Completed  int     `json:"completed"`
		Throughput float64 `json:"throughputRps"`
		Latency    struct {
			Mean float64 `json:"meanMs"`
			P99  float64 `json:"p99Ms"`
		} `json:"latency"`
		Nodes map[string]struct {
			Served      int     `json:"served"`
			Utilization float64 `json:"utilization"`
		} `json:"nodes"`
		Bottleneck string `json:"bottleneck"`
	}
	decodeInto(t, rec, &body)
	if body.Arrived == 0 || body.Completed == 0 {
		t.Errorf("simulated nothing: arrived %d, completed %d", body.Arrived, body.Completed)
	}
	if body.Nodes["api"].Served == 0 {
		t.Error("the one component in the design reported serving nothing")
	}
	if body.Bottleneck != "api" {
		t.Errorf("bottleneck = %q, want the only component with a capacity", body.Bottleneck)
	}
	if body.Latency.P99 < body.Latency.Mean {
		t.Errorf("p99 %v is below the mean %v", body.Latency.P99, body.Latency.Mean)
	}
}

// Durations leave as milliseconds. This is worth its own test because the
// failure is silent: Go marshals a Duration as a nanosecond count, and 5000000
// in a field called meanMs reads as a working system that is very slow rather
// than as a unit mistake.
func TestDurationsLeaveInMilliseconds(t *testing.T) {
	t.Parallel()
	rec := post(t, design)
	var body struct {
		Latency struct {
			Mean float64 `json:"meanMs"`
		} `json:"latency"`
	}
	decodeInto(t, rec, &body)
	// Two instances at 5ms under a load they can carry: single-figure
	// milliseconds. Nanoseconds would land near five million.
	if body.Latency.Mean < 1 || body.Latency.Mean > 100 {
		t.Errorf("meanMs = %v, which is not a millisecond figure for a 5ms service",
			body.Latency.Mean)
	}
}

func TestNewServerSetsAReadHeaderTimeout(t *testing.T) {
	t.Parallel()
	// Without it a peer can hold a connection open by sending headers one
	// byte at a time, for free, forever. gosec fails the build over this, so
	// the test is here to keep the fix from being reverted quietly.
	if got := api.NewServer(":0", nil).ReadHeaderTimeout; got == 0 {
		t.Error("NewServer left ReadHeaderTimeout unset")
	}
}

func TestTheWrongMethodIsRefused(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/simulate", nil)
	rec := httptest.NewRecorder()
	api.Handler(nil).ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET /simulate = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestAnUnknownPathIsNotFound(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/simulations", nil)
	rec := httptest.NewRecorder()
	api.Handler(nil).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /simulations = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestBadRequestsAreRefusedWithAReason(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		body string
		want int
	}{
		{"not JSON at all", `{"topology":`, http.StatusBadRequest},
		{"an empty design", `{"topology": {}, "workload":
			{"rateRps": 10, "readFraction": 1, "durationMs": 1000,
			 "seed": 1, "warmupFraction": 0}}`, http.StatusBadRequest},
		{"a workload with no arrivals", strings.Replace(design,
			`"rateRps": 100`, `"rateRps": 0`, 1), http.StatusBadRequest},
		// A field name a client got slightly wrong. Ignoring it would build a
		// service with one instance instead of eight and answer confidently.
		{"a misspelled parameter", strings.Replace(design,
			`"instances"`, `"instance"`, 1), http.StatusBadRequest},
		// Longer than a simulation clock can express. It used to overflow to a
		// negative run, which the engine finished instantly and reported as a
		// successful simulation of nothing, under a 200.
		{"a run longer than the clock", strings.Replace(design,
			`"durationMs": 5000`, `"durationMs": 1e13`, 1), http.StatusBadRequest},
		// Fast enough that the gap between arrivals rounds to zero. The run
		// would never reach its horizon, and sim.Run cannot be interrupted, so
		// this request has to be refused rather than accepted and abandoned.
		{"a rate the clock cannot space", strings.Replace(design,
			`"rateRps": 100`, `"rateRps": 1.5e9`, 1), http.StatusBadRequest},
		// More simulated work than this server will do in one request.
		{
			"a run of a hundred million requests", strings.Replace(design,
				`"durationMs": 5000`, `"durationMs": 1000000000`, 1),
			http.StatusRequestEntityTooLarge,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			rec := post(t, tt.body)
			if rec.Code != tt.want {
				t.Fatalf("POST /simulate with %s = %d, want %d: %s",
					tt.name, rec.Code, tt.want, rec.Body)
			}
			var body struct {
				Error string `json:"error"`
			}
			decodeInto(t, rec, &body)
			if body.Error == "" {
				t.Error("the refusal carried no reason")
			}
		})
	}
}

// A body larger than the cap is refused rather than read into memory. The cap
// is what stops one request from deciding how much this server allocates.
func TestAnOversizedBodyIsRefused(t *testing.T) {
	t.Parallel()
	var big bytes.Buffer
	big.WriteString(`{"topology": {"nodes": [`)
	for range 40_000 {
		big.WriteString(`{"id": "padpadpadpadpadpad", "kind": "service"},`)
	}
	big.WriteString(`]}}`)
	rec := post(t, big.String())
	if rec.Code != http.StatusBadRequest {
		t.Errorf("POST /simulate with a %d-byte body = %d, want %d",
			big.Len(), rec.Code, http.StatusBadRequest)
	}
}

// The same request twice is the same answer. Determinism is the engine's
// invariant; serving it over HTTP must not quietly introduce a way to lose it.
func TestTheSameRequestGivesTheSameAnswer(t *testing.T) {
	t.Parallel()
	first, second := post(t, design), post(t, design)
	if first.Body.String() != second.Body.String() {
		t.Errorf("two identical requests differed:\n%s\n%s", first.Body, second.Body)
	}
}

// Serve has to come back when it is told to stop. A server that ignores a
// cancelled context is one a container runtime eventually kills, which turns
// every deploy into a dropped request.
func TestServeReturnsWhenTheContextIsCancelled(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() { done <- api.Serve(ctx, api.NewServer("127.0.0.1:0", nil)) }()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("Serve() on a cancelled context = %v, want nil", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Serve() did not return after its context was cancelled")
	}
}

// And it has to come back when it cannot start at all, rather than blocking
// on a shutdown signal for a server that never listened.
func TestServeReportsAnAddressItCannotUse(t *testing.T) {
	t.Parallel()
	done := make(chan error, 1)
	go func() { done <- api.Serve(t.Context(), api.NewServer("127.0.0.1:not-a-port", nil)) }()
	select {
	case err := <-done:
		if err == nil {
			t.Error("Serve() on an unusable address returned nil")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Serve() hung on an address it could never bind")
	}
}
