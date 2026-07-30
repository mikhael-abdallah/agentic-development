package model_test

import (
	"errors"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

// service builds a component the shape of the cases below need: valid, cheap
// to place, and uninteresting except for how it is wired.
func service(id string) model.Node {
	return model.Node{
		ID:      id,
		Kind:    model.KindService,
		Service: &model.ServiceParams{Instances: 1, MeanService: 1},
	}
}

// A diamond is not a cycle. Two paths that split and rejoin visit a component
// from more than one direction without ever leading back to one already on
// the path, and rejecting them would rule out every design with a shared
// downstream dependency — which is most designs, and certainly every one this
// simulator exists to draw.
func TestDiamondsAreAccepted(t *testing.T) {
	t.Parallel()
	tp := reference()
	tp.Nodes = append(tp.Nodes, service("search"))
	// The balancer fans out to two services, and both read the same cache.
	tp.Edges = append(tp.Edges,
		model.Edge{From: "lb", To: "search"},
		model.Edge{From: "search", To: "cache"},
	)
	if err := tp.Validate(); err != nil {
		t.Errorf("Validate() on a design with a shared dependency = %v, want nil", err)
	}
}

// A component reached twice down the same path is the case a naive "have I
// seen this before" check gets wrong in the other direction: it is a cycle
// only if the second visit happens while the first is still unfinished.
func TestLongCyclesAreFound(t *testing.T) {
	t.Parallel()
	tp := reference()
	tp.Nodes = append(tp.Nodes, service("a"), service("b"), service("c"))
	tp.Edges = append(tp.Edges,
		model.Edge{From: "api", To: "a"},
		model.Edge{From: "a", To: "b"},
		model.Edge{From: "b", To: "c"},
		model.Edge{From: "c", To: "a"},
	)
	if err := tp.Validate(); !errors.Is(err, model.ErrCycle) {
		t.Errorf("Validate() on a three-component loop = %v, want ErrCycle", err)
	}
}

// A cycle the client cannot reach is still a cycle. Checking only the
// reachable part of the graph would report this as an unreachable component,
// which is true but points at the wrong fix — deleting the components rather
// than unpicking the loop.
func TestUnreachableCyclesAreReportedAsCycles(t *testing.T) {
	t.Parallel()
	tp := reference()
	tp.Nodes = append(tp.Nodes, service("a"), service("b"))
	tp.Edges = append(tp.Edges,
		model.Edge{From: "a", To: "b"},
		model.Edge{From: "b", To: "a"},
	)
	if err := tp.Validate(); !errors.Is(err, model.ErrCycle) {
		t.Errorf("Validate() on an unreachable cycle = %v, want ErrCycle", err)
	}
}

// The engine walks this graph once per request, so the guarantee it needs is
// not "usually a DAG" but "a validated topology is a DAG". This is the case
// that would hang a traversal with no cycle guard of its own.
func TestTwoComponentLoopIsRejected(t *testing.T) {
	t.Parallel()
	tp := reference()
	tp.Edges = append(tp.Edges, model.Edge{From: "cache", To: "api"})
	if err := tp.Validate(); !errors.Is(err, model.ErrCycle) {
		t.Errorf("Validate() on a two-component loop = %v, want ErrCycle", err)
	}
}
