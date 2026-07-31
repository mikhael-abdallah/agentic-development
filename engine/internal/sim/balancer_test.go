package sim_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

// fanout is a client feeding a load balancer that spreads across one
// single-instance service per entry in means.
func fanout(algorithm model.Algorithm, overhead model.Millis, queue int, means ...model.Millis) model.Topology {
	tp := model.Topology{
		Nodes: []model.Node{
			{ID: "client", Kind: model.KindClient},
			{ID: "lb", Kind: model.KindLoadBalancer, LoadBalancer: &model.LoadBalancerParams{
				Algorithm: algorithm,
				Overhead:  overhead,
			}},
		},
		Edges: []model.Edge{{From: "client", To: "lb"}},
	}
	for i, mean := range means {
		id := fmt.Sprintf("api%d", i)
		tp.Nodes = append(tp.Nodes, model.Node{
			ID: id, Kind: model.KindService,
			Service: &model.ServiceParams{
				Instances:     1,
				MeanService:   mean,
				QueueCapacity: queue,
			},
		})
		tp.Edges = append(tp.Edges, model.Edge{From: "lb", To: id})
	}
	return tp
}

// A balancer's overhead lands on every request and on nothing else. Because
// it is added rather than drawn, and because a balancer holds no request back,
// shifting it moves every latency by exactly that much and leaves the queueing
// behind it untouched — same arrivals, same draws, same order, same drops. An
// equality rather than a range: anything approximate here would be the
// balancer having some other effect.
func TestBalancerOverheadLandsOnEveryRequest(t *testing.T) {
	t.Parallel()
	const overhead model.Millis = 20
	direct, err := sim.Run(fanout(model.RoundRobin, 0, 0, 5), load(120, 9))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	delayed, err := sim.Run(fanout(model.RoundRobin, overhead, 0, 5), load(120, 9))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if got := delayed.Latency.Mean - direct.Latency.Mean; got != overhead.Duration() {
		t.Errorf("a %v balancer overhead moved mean latency by %v", overhead.Duration(), got)
	}
	if delayed.Arrived != direct.Arrived || delayed.Dropped != direct.Dropped ||
		delayed.Completed != direct.Completed {
		t.Errorf("the overhead changed what happened, not just when: %+v against %+v",
			delayed, direct)
	}
}

// The reason to choose an algorithm at all. Behind a balancer sit one fast
// server and one fifty times slower, each able to hold two requests beyond the
// one it is serving. Round robin keeps feeding the slow one its half of the
// traffic and it sheds what it cannot hold; least connections notices the
// backlog and stops sending there.
//
// A design can be lossy for reasons that never show up in mean latency, which
// is why this is measured in drops.
func TestLeastConnectionsSpillsLessThanRoundRobin(t *testing.T) {
	t.Parallel()
	blind, err := sim.Run(fanout(model.RoundRobin, 0, 2, 1, 50), load(40, 11))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	aware, err := sim.Run(fanout(model.LeastConnections, 0, 2, 1, 50), load(40, 11))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if blind.Dropped == 0 {
		t.Fatal("round robin fed a saturated server half the traffic and dropped nothing")
	}
	if aware.Dropped >= blind.Dropped {
		t.Errorf("least connections dropped %d against round robin's %d: it is not avoiding the slow server",
			aware.Dropped, blind.Dropped)
	}
}

// Determinism has to survive the balancer. Round robin keeps state between
// decisions and random choice draws from the balancer's own stream, so both
// are new ways for one run to stop reproducing another.
func TestABalancedDesignStillRepeats(t *testing.T) {
	t.Parallel()
	for _, algorithm := range []model.Algorithm{
		model.RoundRobin, model.LeastConnections, model.RandomChoice,
	} {
		t.Run(string(algorithm), func(t *testing.T) {
			t.Parallel()
			design := fanout(algorithm, 2, 4, 5, 8, 12)
			first, err := sim.Run(design, load(200, 13))
			if err != nil {
				t.Fatalf("Run() unexpected error: %v", err)
			}
			for i := range 3 {
				again, err := sim.Run(design, load(200, 13))
				if err != nil {
					t.Fatalf("Run() unexpected error on repeat %d: %v", i, err)
				}
				if !same(again, first) {
					t.Fatalf("repeat %d differed:\n got %+v\nwant %+v", i, again, first)
				}
			}
		})
	}
}

// A balancer with nothing behind it would answer every request itself and
// report a design that balances nothing as a working one.
func TestABalancerWithNothingBehindItIsRefused(t *testing.T) {
	t.Parallel()
	design := fanout(model.RoundRobin, 1, 0)
	if _, err := sim.Run(design, load(100, 1)); !errors.Is(err, sim.ErrNoTargets) {
		t.Errorf("Run() on a balancer with no downstream = %v, want ErrNoTargets", err)
	}
}
