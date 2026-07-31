package sim_test

import (
	"testing"
	"time"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

// tiers is a client feeding a service that reads from a database: the shape
// where the bottleneck can be either of two components depending on the
// numbers, which is what makes it worth asking which one it is.
func tiers(instances int, serviceMean model.Millis, pool int, dbMean model.Millis) model.Topology {
	return model.Topology{
		Nodes: []model.Node{
			{ID: "client", Kind: model.KindClient},
			entry(),
			{ID: "api", Kind: model.KindService, Service: &model.ServiceParams{
				Instances: instances, MeanService: serviceMean,
			}},
			{ID: "db", Kind: model.KindDatabase, Database: &model.DatabaseParams{
				MeanRead: dbMean, MeanWrite: dbMean, PoolSize: pool,
			}},
		},
		Edges: []model.Edge{
			{From: "client", To: "in"}, {From: "in", To: "api"}, {From: "api", To: "db"},
		},
	}
}

// The percentiles have to be ordered and drawn from the sample, because that
// is the whole claim: a p99 of 412ms means a request took 412ms, not that a
// formula produced 412 from two neighbours.
func TestThePercentilesOrderAndComeFromTheSample(t *testing.T) {
	t.Parallel()
	res, err := sim.Run(tiers(2, 5, 2, 10), reads(150, 41))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	l := res.Latency
	for _, step := range []struct {
		name     string
		lo, hi   time.Duration
		loN, hiN string
	}{
		{"p50 under p95", l.P50, l.P95, "P50", "P95"},
		{"p95 under p99", l.P95, l.P99, "P95", "P99"},
		{"p99 under max", l.P99, l.Max, "P99", "Max"},
	} {
		if step.lo > step.hi {
			t.Errorf("%s: %s = %v exceeds %s = %v", step.name, step.loN, step.lo, step.hiN, step.hi)
		}
	}
	if l.Mean < l.P50 || l.Mean > l.Max {
		t.Errorf("mean %v falls outside the sample it came from (%v..%v)", l.Mean, l.P50, l.Max)
	}
	// A queue has a tail. If the worst request matches the median the sample
	// is not a distribution and the percentiles are decorating one number.
	if l.Max <= l.P50 {
		t.Errorf("max %v is no worse than the median %v", l.Max, l.P50)
	}
}

// Throughput is what got through, not what was offered. Past the point where
// a design can keep up the two part company, and the gap is the finding.
func TestThroughputFlattensWhenTheDesignCannotKeepUp(t *testing.T) {
	t.Parallel()
	// One instance at 10ms serves 100 rps at the very most.
	const ceiling = 100.0
	within, err := sim.Run(chain(1, 10, 50), reads(60, 43))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	beyond, err := sim.Run(chain(1, 10, 50), reads(400, 43))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if within.Throughput < 50 || within.Throughput > 70 {
		t.Errorf("throughput %.1f/s under an offered 60/s the design can serve", within.Throughput)
	}
	if beyond.Throughput > ceiling*1.1 {
		t.Errorf("throughput %.1f/s exceeds the %.0f/s one instance can serve", beyond.Throughput, ceiling)
	}
	if beyond.Dropped == 0 {
		t.Error("four times the serviceable rate was accepted without a single drop")
	}
}

// The question the report exists to answer. The same two-tier design twice:
// once with a database far too small for the load, once with a service pool
// far too small — and the bottleneck has to follow the change.
func TestTheBottleneckFollowsTheConstraint(t *testing.T) {
	t.Parallel()
	slowStore, err := sim.Run(tiers(8, 2, 1, 40), reads(120, 44))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if slowStore.Bottleneck != "db" {
		t.Errorf("bottleneck = %q with a one-connection store behind eight instances, want %q",
			slowStore.Bottleneck, "db")
	}
	slowService, err := sim.Run(tiers(1, 40, 8, 2), reads(120, 44))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if slowService.Bottleneck != "api" {
		t.Errorf("bottleneck = %q with one instance in front of an idle store, want %q",
			slowService.Bottleneck, "api")
	}
}

// A component with no ceiling cannot be the answer to "what should I change
// first" — there is nothing to raise. A balancer that reported a utilization
// would be a permanent false positive in front of every design.
func TestAHopIsNeverTheBottleneck(t *testing.T) {
	t.Parallel()
	res, err := sim.Run(fanout(model.RoundRobin, 5, 0, 30), reads(30, 45))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if got := res.Nodes["lb"].Utilization; got != 0 {
		t.Errorf("the balancer reported a utilization of %g", got)
	}
	if res.Nodes["lb"].Served == 0 {
		t.Error("the balancer reported serving nothing, having served everything")
	}
	if res.Bottleneck != "api0" {
		t.Errorf("bottleneck = %q, want the one component with a capacity", res.Bottleneck)
	}
}

// Every request that arrives in the window reaches the first component, so
// what the design as a whole took in and what its entry point served are the
// same number. A per-node counter that drifted from the totals would make
// every reading downstream of it suspect.
func TestPerNodeCountsAgreeWithTheTotals(t *testing.T) {
	t.Parallel()
	res, err := sim.Run(tiers(2, 5, 2, 8), reads(120, 46))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if res.Nodes["api"].Served != res.Arrived {
		t.Errorf("the entry component served %d of %d arrivals",
			res.Nodes["api"].Served, res.Arrived)
	}
	var dropped int
	for _, stats := range res.Nodes {
		dropped += stats.Dropped
	}
	if dropped != res.Dropped {
		t.Errorf("components dropped %d between them, the run reports %d", dropped, res.Dropped)
	}
	// Every component but the client: the balancer, the service and the store.
	// The client is where load comes from rather than something load passes
	// through, so it has nothing to report.
	if len(res.Nodes) != 3 {
		t.Errorf("reported on %d components, want the three that are not the client", len(res.Nodes))
	}
}

// Utilization has to mean what it says: a component asked for half of what it
// can do should read as about half busy, not as an arbitrary number that
// happens to rise with load.
func TestUtilizationTracksTheLoadOffered(t *testing.T) {
	t.Parallel()
	// Four connections at 10ms each serve 400 rps; ask for 200.
	res, err := sim.Run(tiers(16, 1, 4, 10), reads(200, 47))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if got := res.Nodes["db"].Utilization; got < 0.4 || got > 0.6 {
		t.Errorf("a store asked for half its capacity reported utilization %.3f", got)
	}
}
