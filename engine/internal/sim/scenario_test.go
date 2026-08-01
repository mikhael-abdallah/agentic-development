package sim_test

import (
	"testing"
	"time"

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

// The figures below are what the shipped preset produces today, and the three
// tests that follow exist to notice when it stops.
//
// The tests above make the claims worth making about behaviour: that the cache
// unloads the database, that the bottleneck moves. These make no claim at all
// about whether these are good numbers. They are here for the changes that are
// meant to move nothing — a workload that names what its requests do instead of
// splitting them with one fraction, a draw taken from a list rather than a
// coin — where the entire question is whether the simulation still does what it
// did, and "close enough" is not a judgement to make on a reader's behalf.
//
// A run is deterministic on its seed, so the counts carry no tolerance: they
// are integers, and an operation drawn one step out of alignment with the
// read/write flip it replaces moves the database's share by hundreds. The times
// and the utilizations carry a hair of slack, four orders of magnitude below
// anything a modelling change would do, so that a last-bit difference in
// floating-point arithmetic on another architecture is not a failure.
//
// When one of these fails: either the simulation changed on purpose, in which
// case these numbers move in the same commit and its message says why, or
// something moved that was not meant to.
//
// They have moved once, and the reason is worth keeping. The preset used to
// serve every request in a flat 8 ms; it now describes its API, and a resolve
// costs 7 ms against a shorten's 25. The weighted mean is 7.9 ms, so the pool
// is loaded almost exactly as it was — and the tail is not. p99 went from 69 ms
// to 93 while the mean moved by a third of a millisecond, because one request
// in twenty now holds an instance for three times as long and everything behind
// it waits. That gap between the mean and the tail is the whole reason this
// simulator draws percentiles, and the preset now demonstrates it.
const (
	slackTime  = time.Microsecond
	slackRatio = 1e-9
)

func shortenerResult(t *testing.T) sim.Result {
	t.Helper()
	preset := shortener(t)
	res, err := sim.Run(preset.Topology, preset.Workload)
	if err != nil {
		t.Fatalf("the shipped preset does not run: %v", err)
	}
	return res
}

func TestTheShortenerMovesTheSameRequests(t *testing.T) {
	t.Parallel()
	res := shortenerResult(t)
	for _, c := range []struct {
		what      string
		got, want int
	}{
		{"arrived", res.Arrived, 14473},
		{"completed", res.Completed, 14473},
		{"dropped", res.Dropped, 0},
		{"the balancer served", res.Nodes["lb"].Served, 14473},
		{"the service served", res.Nodes["api"].Served, 14473},
		{"the cache served", res.Nodes["cache"].Served, 14473},
		// The one that says the read/write split still lands where it did:
		// everything the cache could not answer, plus every write.
		{"the database served", res.Nodes["db"].Served, 2744},
	} {
		if c.got != c.want {
			t.Errorf("%s %d, was %d", c.what, c.got, c.want)
		}
	}
}

func TestTheShortenerReportsTheSameLatencies(t *testing.T) {
	t.Parallel()
	res := shortenerResult(t)
	for _, c := range []struct {
		what      string
		got, want time.Duration
	}{
		{"mean", res.Latency.Mean, 14022315 * time.Nanosecond},
		{"p50", res.Latency.P50, 8874412 * time.Nanosecond},
		{"p95", res.Latency.P95, 42671329 * time.Nanosecond},
		{"p99", res.Latency.P99, 92978110 * time.Nanosecond},
		{"max", res.Latency.Max, 313287597 * time.Nanosecond},
	} {
		if d := c.got - c.want; d > slackTime || d < -slackTime {
			t.Errorf("%s latency is %v, was %v", c.what, c.got, c.want)
		}
	}
}

func TestTheShortenerLoadsItsComponentsTheSame(t *testing.T) {
	t.Parallel()
	res := shortenerResult(t)
	for _, c := range []struct {
		what      string
		got, want float64
	}{
		{"throughput", res.Throughput, 301.5208333333333},
		{"the service's utilization", res.Nodes["api"].Utilization, 0.594603574125},
		{"the database's utilization", res.Nodes["db"].Utilization, 0.27459807838541667},
		// A balancer and a cache are hops rather than queues, so they have no
		// capacity to be full of. Pinned so that giving one a queue is a
		// decision this test makes someone take on purpose.
		{"the balancer's utilization", res.Nodes["lb"].Utilization, 0},
		{"the cache's utilization", res.Nodes["cache"].Utilization, 0},
	} {
		if d := c.got - c.want; d > slackRatio || d < -slackRatio {
			t.Errorf("%s is %g, was %g", c.what, c.got, c.want)
		}
	}
	if res.Bottleneck != "api" {
		t.Errorf("the bottleneck is %q, was the service pool", res.Bottleneck)
	}
}
