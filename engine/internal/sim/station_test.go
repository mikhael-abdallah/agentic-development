package sim

import (
	"errors"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

// Which server takes a request is not visible in a Result, and inferring it
// from a whole run's arithmetic would test everything except the decision.
// What the decision produces is checked from outside in database_test.go.

// database builds a station for a primary plus len(loads)-1 replicas, each
// already holding that many requests out of a pool of pool.
func database(pool int, loads ...int) *station {
	return &station{id: "db", slots: append([]int(nil), loads...), pool: pool}
}

func read() *request  { return &request{op: model.Operation{Kind: model.Read}} }
func write() *request { return &request{op: model.Operation{Kind: model.Write}} }

// A write is the primary's alone. A replica that accepted one would be
// acknowledging a write on a machine that cannot take it.
func TestAWriteOnlyEverTakesThePrimary(t *testing.T) {
	t.Parallel()
	// Replicas wide open, primary full.
	full := database(2, 2, 0, 0)
	if got := full.seat(write()); got != -1 {
		t.Errorf("seat() for a write with the primary full = %d, want -1 (idle replicas are no help)", got)
	}
	if got := full.seat(read()); got < 1 {
		t.Errorf("seat() for a read = %d, want a replica", got)
	}
	room := database(2, 1, 0, 0)
	if got := room.seat(write()); got != 0 {
		t.Errorf("seat() for a write with room on the primary = %d, want 0", got)
	}
}

// Reads prefer a replica so that the primary keeps its connections for the
// writes that have nowhere else to go. Under an even load every server is
// equally loaded, so the tie is the normal case rather than the edge one.
func TestAReadPrefersAReplicaOnATie(t *testing.T) {
	t.Parallel()
	if got := database(4, 0, 0, 0).seat(read()); got != 2 {
		t.Errorf("seat() for a read across three idle servers = %d, want the last replica", got)
	}
}

func TestAReadTakesTheIdlestServer(t *testing.T) {
	t.Parallel()
	if got := database(9, 5, 2, 7).seat(read()); got != 1 {
		t.Errorf("seat() for a read = %d, want the idlest server 1", got)
	}
}

// The primary serves reads alongside its replicas. Refusing to fall back to it
// would make a database with replicas able to serve fewer reads at once than
// its connections allow.
func TestAReadFallsBackToThePrimary(t *testing.T) {
	t.Parallel()
	if got := database(2, 1, 2, 2).seat(read()); got != 0 {
		t.Errorf("seat() for a read with both replicas full = %d, want the primary", got)
	}
	if got := database(2, 2, 2, 2).seat(read()); got != -1 {
		t.Errorf("seat() with every connection taken = %d, want -1", got)
	}
}

// A component with no pool limit — a balancer, a cache — never turns anything
// away and never distinguishes reads from writes.
func TestAnUnlimitedComponentAlwaysHasRoom(t *testing.T) {
	t.Parallel()
	hop := &station{id: "lb", slots: []int{9999}}
	if got := hop.seat(read()); got != 0 {
		t.Errorf("seat() on an unlimited component = %d, want 0", got)
	}
	if got := hop.seat(write()); got != 0 {
		t.Errorf("seat() for a write on an unlimited component = %d, want 0", got)
	}
}

// The client is where load comes from, not a component it passes through.
// newEngine skips it, so this is an invariant rather than a reachable path —
// and an invariant with no test is a comment.
func TestAClientIsNotAStation(t *testing.T) {
	t.Parallel()
	_, err := newStation(model.Node{ID: "client", Kind: model.KindClient}, nil)
	if !errors.Is(err, ErrNotAStation) {
		t.Errorf("newStation() for a client = %v, want ErrNotAStation", err)
	}
}
