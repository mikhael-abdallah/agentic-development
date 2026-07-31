package sim_test

import (
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

// shortener returns the shipped preset. It is fetched rather than written out
// here on purpose: a copy in the test would keep passing after the preset it
// claims to describe had drifted away from it.
func shortener(t *testing.T) model.Scenario {
	t.Helper()
	for _, s := range model.Scenarios() {
		if s.ID == "url-shortener" {
			return s
		}
	}
	t.Fatal("the url-shortener preset is not embedded")
	return model.Scenario{}
}

// withHitRatio returns the shortener with its cache turned up or down.
func withHitRatio(t *testing.T, ratio float64) model.Scenario {
	t.Helper()
	s := shortener(t)
	for i := range s.Topology.Nodes {
		if params := s.Topology.Nodes[i].Cache; params != nil {
			params.HitRatio = ratio
		}
	}
	return s
}

// model validates the presets; this checks the other half — that they are
// designs the simulator can actually run, and that running one says something.
// A preset that validates and then fails at run time is still a broken preset,
// and the model package cannot see that from where it sits.
func TestEveryEmbeddedScenarioSimulates(t *testing.T) {
	t.Parallel()
	presets := model.Scenarios()
	if len(presets) == 0 {
		t.Fatal("no presets are embedded")
	}
	for _, preset := range presets {
		t.Run(preset.ID, func(t *testing.T) {
			t.Parallel()
			res, err := sim.Run(preset.Topology, preset.Workload)
			if err != nil {
				t.Fatalf("the %s preset does not run: %v", preset.ID, err)
			}
			if res.Completed == 0 {
				t.Error("the run finished having completed nothing")
			}
			if res.Bottleneck == "" {
				t.Error("no component reported a utilization, so there is nothing to look at")
			}
			// A preset is where someone starts. Starting them on a design that
			// is already losing requests teaches them that dropping is normal.
			if res.Dropped != 0 {
				t.Errorf("the preset opens on a design that drops %d of %d requests",
					res.Dropped, res.Arrived)
			}
		})
	}
}

// The cache is the whole point of the design, so raising its hit ratio has to
// take load off the database — monotonically, not on average. This is the
// sensitivity that makes the preset worth shipping: nothing about the database
// changes, and the database stops being the problem.
func TestRaisingTheHitRatioUnloadsTheDatabase(t *testing.T) {
	t.Parallel()
	previous := 1.1 // Above any utilization, so the first reading has to beat it.
	for _, ratio := range []float64{0, 0.25, 0.5, 0.75, 0.95} {
		res, err := sim.Run(withHitRatio(t, ratio).Topology, shortener(t).Workload)
		if err != nil {
			t.Fatalf("hit ratio %g: %v", ratio, err)
		}
		got := res.Nodes["db"].Utilization
		if got >= previous {
			t.Errorf("database utilization is %g at a hit ratio of %g, "+
				"no better than the %g it was at the ratio below", got, ratio, previous)
		}
		previous = got
	}
}

// What the preset's goal text promises, kept honest by a test. Prose in a
// shipped file is documentation nobody runs, and this design's one interesting
// claim — that the bottleneck moves without the database being touched — is
// exactly the sort of claim that quietly stops being true.
func TestTheBottleneckMovesToTheDatabaseWhenTheCacheStopsHelping(t *testing.T) {
	t.Parallel()
	asShipped, err := sim.Run(shortener(t).Topology, shortener(t).Workload)
	if err != nil {
		t.Fatalf("as shipped: %v", err)
	}
	if asShipped.Bottleneck != "api" {
		t.Errorf("as shipped the bottleneck is %q, want the service pool",
			asShipped.Bottleneck)
	}
	cold := withHitRatio(t, 0.2)
	starved, err := sim.Run(cold.Topology, cold.Workload)
	if err != nil {
		t.Fatalf("with a cold cache: %v", err)
	}
	if starved.Bottleneck != "db" {
		t.Errorf("with the cache at 0.2 the bottleneck is %q, want the database",
			starved.Bottleneck)
	}
	// The database was not touched: only the cache in front of it was.
	if starved.Nodes["db"].Utilization <= asShipped.Nodes["db"].Utilization {
		t.Error("the database took no more load with a colder cache")
	}
}
