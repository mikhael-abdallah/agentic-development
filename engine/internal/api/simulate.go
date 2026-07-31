package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

const (
	// maxBody caps the design a request may carry. A topology is a few
	// hundred bytes of components and edges; a megabyte is far more than any
	// design a person assembled, and small enough that refusing it costs a
	// caller nothing real.
	maxBody = 1 << 20
	// maxArrivals caps how much work one request may ask for. See affordable.
	maxArrivals = 2_000_000
)

// simulateRequest is a design and the load to put it under.
type simulateRequest struct {
	Topology model.Topology `json:"topology"`
	Workload model.Workload `json:"workload"`
}

// simulateResponse is a Result on the wire.
//
// Durations are milliseconds, converted through model.MillisOf. Go marshals a
// time.Duration as a bare nanosecond count, which is both unreadable and
// indistinguishable from a millisecond figure for a system a million times
// slower — the kind of mistake that is only ever found by someone acting on
// the wrong number.
type simulateResponse struct {
	Arrived    int                 `json:"arrived"`
	Completed  int                 `json:"completed"`
	Dropped    int                 `json:"dropped"`
	Throughput float64             `json:"throughputRps"`
	Latency    latencyBody         `json:"latency"`
	Nodes      map[string]nodeBody `json:"nodes"`
	Bottleneck string              `json:"bottleneck,omitempty"`
}

type latencyBody struct {
	Mean model.Millis `json:"meanMs"`
	P50  model.Millis `json:"p50Ms"`
	P95  model.Millis `json:"p95Ms"`
	P99  model.Millis `json:"p99Ms"`
	Max  model.Millis `json:"maxMs"`
}

type nodeBody struct {
	Served      int     `json:"served"`
	Dropped     int     `json:"dropped"`
	Utilization float64 `json:"utilization"`
}

func simulate(w http.ResponseWriter, r *http.Request) {
	req, err := decode(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// The workload is validated here as well as inside Run, so that asking
	// for too much and asking for something impossible are told apart: one is
	// this server declining, the other is the request being wrong.
	if err := req.Workload.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := affordable(req.Workload); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, err.Error())
		return
	}
	res, err := sim.Run(req.Topology, req.Workload)
	if err != nil {
		// Every error Run returns is a statement about the design it was
		// given — an unreachable component, a fan-out with no balancer, a
		// parameter out of range. None of them is this server failing.
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, responseOf(res))
}

// decode reads the request body, refusing anything it does not recognise.
//
// Unknown fields are rejected rather than ignored. A client that sends
// "hitratio" for "hitRatio" would otherwise get a cache with a hit ratio of
// zero and a plausible-looking answer to a question it did not ask, and
// nothing downstream could tell that had happened.
func decode(w http.ResponseWriter, r *http.Request) (simulateRequest, error) {
	var req simulateRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return simulateRequest{}, fmt.Errorf("the request body is not a simulation request: %w", err)
	}
	return req, nil
}

// affordable rejects a request that would occupy this server indefinitely.
//
// Nothing in the model bounds a workload, and nothing should: a simulation
// covering a year of traffic is a reasonable thing to want from a library. It
// is not a reasonable thing to accept from an unauthenticated request, because
// sim.Run cannot be interrupted — the event loop runs to completion or not at
// all, and a partially simulated system has no meaning to return.
//
// So the bound is checked before the run begins, which means estimating the
// work rather than measuring it. Rate times duration is exactly what the
// arrival process will produce, so the estimate is the answer.
func affordable(w model.Workload) error {
	if arrivals := w.RateRPS * w.Duration.Duration().Seconds(); arrivals > maxArrivals {
		return fmt.Errorf(
			"a run of about %.0f requests is more than this server simulates in one request (limit %d)",
			arrivals, maxArrivals)
	}
	return nil
}

func responseOf(res sim.Result) simulateResponse {
	nodes := make(map[string]nodeBody, len(res.Nodes))
	for id, n := range res.Nodes {
		nodes[id] = nodeBody{Served: n.Served, Dropped: n.Dropped, Utilization: n.Utilization}
	}
	return simulateResponse{
		Arrived:    res.Arrived,
		Completed:  res.Completed,
		Dropped:    res.Dropped,
		Throughput: res.Throughput,
		Latency: latencyBody{
			Mean: model.MillisOf(res.Latency.Mean),
			P50:  model.MillisOf(res.Latency.P50),
			P95:  model.MillisOf(res.Latency.P95),
			P99:  model.MillisOf(res.Latency.P99),
			Max:  model.MillisOf(res.Latency.Max),
		},
		Nodes:      nodes,
		Bottleneck: res.Bottleneck,
	}
}
