package sim

import (
	"fmt"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

// These tests reach inside the package on purpose. Which node a balancer picks
// is not visible in a Result — that arrives with per-component statistics in a
// later change — and the alternative is inferring the choice from latency,
// which would test the arithmetic of a whole run to assert one decision.
//
// The behavioural consequences are checked from outside in balancer_test.go.

// balancer builds a load balancer over one downstream station per entry in
// loads, each already holding that many requests.
func balancer(algorithm model.Algorithm, loads ...int) (*engine, *station) {
	e := &engine{stations: make(map[string]*station), rng: newStreams(1)}
	lb := &station{id: "lb", algorithm: algorithm}
	for i, load := range loads {
		id := fmt.Sprintf("s%d", i)
		e.stations[id] = &station{id: id, slots: []int{load}}
		lb.next = append(lb.next, id)
	}
	e.stations[lb.id] = lb
	return e, lb
}

// routes collects the next n decisions.
func routes(e *engine, lb *station, n int) []string {
	picked := make([]string, 0, n)
	for range n {
		picked = append(picked, e.route(lb))
	}
	return picked
}

func TestRoundRobinTakesEachInTurn(t *testing.T) {
	t.Parallel()
	e, lb := balancer(model.RoundRobin, 0, 0, 0)
	got := routes(e, lb, 4)
	want := []string{"s0", "s1", "s2", "s0"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("round robin picked %v, want %v", got, want)
		}
	}
}

// Round robin is deliberately blind to load: it is the algorithm a design
// picks when it believes its servers are interchangeable, and a version that
// quietly skipped a busy one would be least-connections wearing its name.
func TestRoundRobinIgnoresHowBusyANodeIs(t *testing.T) {
	t.Parallel()
	e, lb := balancer(model.RoundRobin, 99, 0)
	if got := routes(e, lb, 2); got[0] != "s0" || got[1] != "s1" {
		t.Errorf("round robin picked %v, want the overloaded s0 first anyway", got)
	}
}

func TestLeastConnectionsPicksTheIdlestNode(t *testing.T) {
	t.Parallel()
	e, lb := balancer(model.LeastConnections, 3, 1, 2)
	if got := e.route(lb); got != "s1" {
		t.Errorf("least connections picked %q, want the idlest node s1", got)
	}
}

// Requests waiting for a free server are still requests the node owes an
// answer to. Counting only the ones in service would call a node with a
// hundred queued and one running idler than a node running two.
func TestLeastConnectionsCountsTheQueueToo(t *testing.T) {
	t.Parallel()
	e, lb := balancer(model.LeastConnections, 0, 2)
	e.stations["s0"].waiting = make([]*request, 5)
	if got := e.route(lb); got != "s1" {
		t.Errorf("least connections picked %q, want s1: s0 has five requests queued", got)
	}
}

// With identical nodes under an even load every choice is a tie, so the
// tie-break is the common case rather than an edge case. First entry wins,
// because the alternative is whichever answer the run happens to produce.
func TestLeastConnectionsBreaksTiesByOrder(t *testing.T) {
	t.Parallel()
	e, lb := balancer(model.LeastConnections, 2, 2, 2)
	if got := e.route(lb); got != "s0" {
		t.Errorf("least connections picked %q on an all-square tie, want s0", got)
	}
}

func TestRandomChoiceUsesEveryNode(t *testing.T) {
	t.Parallel()
	e, lb := balancer(model.RandomChoice, 0, 0, 0)
	seen := make(map[string]bool)
	for _, id := range routes(e, lb, 200) {
		seen[id] = true
	}
	if len(seen) != 3 {
		t.Errorf("200 random draws across three nodes reached %d of them", len(seen))
	}
}

func TestRandomChoiceRepeatsForASeed(t *testing.T) {
	t.Parallel()
	first, lb := balancer(model.RandomChoice, 0, 0, 0)
	again, lbAgain := balancer(model.RandomChoice, 0, 0, 0)
	a, b := routes(first, lb, 50), routes(again, lbAgain, 50)
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("draw %d differed between two runs of one seed: %q then %q", i, a[i], b[i])
		}
	}
}

// A component with one downstream has nothing to decide, and must not consult
// an algorithm it was never given — every service in a design is in exactly
// that position.
func TestOneDownstreamNeedsNoAlgorithm(t *testing.T) {
	t.Parallel()
	e := &engine{stations: make(map[string]*station)}
	if got := e.route(&station{id: "api", next: []string{"db"}}); got != "db" {
		t.Errorf("route() with a single downstream = %q, want %q", got, "db")
	}
}
