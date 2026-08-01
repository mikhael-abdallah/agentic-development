package sim_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

// chain is a client feeding one pool of servers: the smallest design the
// engine can run, and the one whose behaviour queueing theory can be checked
// against directly.
func chain(instances int, meanMs model.Millis, queue int) model.Topology {
	return model.Topology{
		Nodes: []model.Node{
			{ID: "client", Kind: model.KindClient},
			entry(),
			{ID: "api", Kind: model.KindService, Service: &model.ServiceParams{
				Instances:     instances,
				MeanService:   meanMs,
				QueueCapacity: queue,
			}},
		},
		Edges: []model.Edge{{From: "client", To: "in"}, {From: "in", To: "api"}},
	}
}

// entry is a load balancer that decides nothing: one component behind it, no
// overhead, no pool.
//
// It is here because a client may not call a service that runs more than one
// instance — something has to be spreading requests across them, and a client
// is outside the system, so nothing there can be. A balancer with one target is
// the smallest honest way to say "something chooses".
//
// It costs the measurements below nothing, and that is by construction rather
// than by luck: a zero overhead is added rather than drawn, so it consumes no
// randomness and cannot shift a single downstream draw; it has no pool, so it
// never makes a request wait; and route() returns immediately when there is one
// target, without a draw of its own.
func entry() model.Node {
	return model.Node{ID: "in", Kind: model.KindLoadBalancer, LoadBalancer: &model.LoadBalancerParams{
		Algorithm: model.RoundRobin,
		Overhead:  0,
	}}
}

// frontend is the service every design needs between its client and its
// storage, sized so that it is not the subject of any measurement it appears
// in: enough instances that nothing ever queues at it, and a service time
// three orders of magnitude below the components under test.
//
// A client wired straight to a database or a cache is not a system anyone
// deploys, and the model refuses it. These tests used to draw one because the
// hop was noise they did not want; the hop is now the price of the design
// being a design, and making it cheap is the honest way to pay it.
func frontend() model.Node {
	return model.Node{ID: "front", Kind: model.KindService, Service: &model.ServiceParams{
		Instances:   512,
		MeanService: 0.001,
	}}
}

// same reports whether two runs produced the same Result.
//
// Result carries a map of per-component statistics, so == no longer compiles
// on it. What these tests assert is unchanged: every field, including every
// component's own numbers, has to match.
func same(a, b sim.Result) bool { return reflect.DeepEqual(a, b) }

// asking splits traffic between one read and one write in the given
// proportion — what a workload used to say with a single ReadFraction, now
// that it says it by naming what the requests are asking for.
//
// The all-or-nothing cases are separate because an operation with no share is
// refused: one that never happens would sit in the workload and in the results
// looking like part of the load while contributing nothing.
func asking(readShare float64) []model.Operation {
	switch readShare {
	case 0:
		return []model.Operation{{Name: "write", Kind: model.Write, Share: 1}}
	case 1:
		return []model.Operation{{Name: "read", Kind: model.Read, Share: 1}}
	}
	return []model.Operation{
		{Name: "read", Kind: model.Read, Share: readShare},
		{Name: "write", Kind: model.Write, Share: 1 - readShare},
	}
}

func load(rate float64, seed uint64) model.Workload {
	return model.Workload{
		RateRPS:        rate,
		Operations:     asking(1),
		Duration:       30_000,
		Seed:           seed,
		WarmupFraction: 0.1,
	}
}

func TestRunSimulatesASingleServicePool(t *testing.T) {
	t.Parallel()
	res, err := sim.Run(chain(1, 5, 0), load(100, 1))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if res.Arrived == 0 {
		t.Fatal("Run() reported no arrivals over 30 simulated seconds at 100 rps")
	}
	if res.Completed == 0 {
		t.Fatal("Run() completed nothing")
	}
	if res.Latency.Mean <= 0 {
		t.Errorf("MeanLatency = %v, want a positive duration", res.Latency.Mean)
	}
	// Nothing can leave before it has been served, so end-to-end latency can
	// never be below the mean service time by much. This catches a clock that
	// is not advancing at all, which otherwise looks like a very fast design.
	if res.Latency.Mean < 4*model.Millis(1).Duration() {
		t.Errorf("MeanLatency = %v, want at least roughly the 5ms service time",
			res.Latency.Mean)
	}
}

// The invariant the whole engine rests on. A simulator that is deterministic
// most of the time is worse than one that never is: the tests pass and the
// numbers move underneath them.
func TestSameSeedGivesTheSameRun(t *testing.T) {
	t.Parallel()
	first, err := sim.Run(chain(2, 5, 0), load(300, 7))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	for i := range 5 {
		again, err := sim.Run(chain(2, 5, 0), load(300, 7))
		if err != nil {
			t.Fatalf("Run() unexpected error on repeat %d: %v", i, err)
		}
		if !same(again, first) {
			t.Fatalf("repeat %d differed from the first run:\n got %+v\nwant %+v",
				i, again, first)
		}
	}
}

func TestDifferentSeedsGiveDifferentRuns(t *testing.T) {
	t.Parallel()
	a, err := sim.Run(chain(2, 5, 0), load(300, 1))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	b, err := sim.Run(chain(2, 5, 0), load(300, 2))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if same(a, b) {
		t.Error("two seeds produced an identical run — the seed is not reaching the draws")
	}
}

// Raising the load on a fixed pool must raise the time requests spend in it.
// This is the direction the simulation exists to show, and a queue that never
// forms would still pass every test above.
func TestLatencyRisesWithLoad(t *testing.T) {
	t.Parallel()
	quiet, err := sim.Run(chain(1, 5, 0), load(50, 3))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	busy, err := sim.Run(chain(1, 5, 0), load(180, 3))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if busy.Latency.Mean <= quiet.Latency.Mean {
		t.Errorf("mean latency at 180 rps (%v) did not exceed 50 rps (%v) on one server",
			busy.Latency.Mean, quiet.Latency.Mean)
	}
}

// A full queue turns requests away rather than making everyone wait longer.
// Without a capacity the same overload only grows the backlog, so the two
// cases have to be told apart.
func TestFullQueuesDropRequests(t *testing.T) {
	t.Parallel()
	res, err := sim.Run(chain(1, 20, 5), load(400, 4))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if res.Dropped == 0 {
		t.Error("a five-deep queue at twenty times its capacity dropped nothing")
	}
	unbounded, err := sim.Run(chain(1, 20, 0), load(400, 4))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if unbounded.Dropped != 0 {
		t.Errorf("an unbounded queue dropped %d requests", unbounded.Dropped)
	}
}

// Warmup requests are simulated but not counted. They are what fills the
// queues the measured requests wait behind, so removing them entirely would
// change the answer rather than just the sample size.
func TestWarmupIsExcludedFromTheCounts(t *testing.T) {
	t.Parallel()
	w := load(200, 5)
	w.WarmupFraction = 0
	all, err := sim.Run(chain(2, 5, 0), w)
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	w.WarmupFraction = 0.5
	half, err := sim.Run(chain(2, 5, 0), w)
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if half.Arrived >= all.Arrived {
		t.Errorf("discarding half the run counted %d arrivals against %d for all of it",
			half.Arrived, all.Arrived)
	}
	if half.Arrived == 0 {
		t.Error("discarding half the run left nothing measured")
	}
}

func TestRunRejectsWhatItCannotSimulate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		build func() model.Topology
		want  error
	}{
		{"a component that sends to two others", func() model.Topology {
			tp := chain(1, 5, 0)
			tp.Nodes = append(tp.Nodes,
				model.Node{ID: "a", Kind: model.KindService, Service: &model.ServiceParams{
					Instances: 1, MeanService: 1,
				}},
				model.Node{ID: "b", Kind: model.KindService, Service: &model.ServiceParams{
					Instances: 1, MeanService: 1,
				}},
			)
			tp.Edges = append(tp.Edges,
				model.Edge{From: "api", To: "a"},
				model.Edge{From: "api", To: "b"},
			)
			return tp
		}, sim.ErrFanOut},

		{"a client sending to two components", func() model.Topology {
			tp := chain(1, 5, 0)
			tp.Nodes = append(tp.Nodes, model.Node{
				ID: "other", Kind: model.KindService,
				Service: &model.ServiceParams{Instances: 1, MeanService: 1},
			})
			tp.Edges = append(tp.Edges, model.Edge{From: "client", To: "other"})
			return tp
		}, sim.ErrFanOut},

		{"a design whose load goes nowhere", func() model.Topology {
			return model.Topology{
				Nodes: []model.Node{{ID: "client", Kind: model.KindClient}},
			}
		}, sim.ErrNoEntry},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if _, err := sim.Run(tt.build(), load(100, 1)); !errors.Is(err, tt.want) {
				t.Errorf("Run() with %s = %v, want %v", tt.name, err, tt.want)
			}
		})
	}
}

// An invalid design or workload must be refused here rather than simulated
// into a plausible-looking number.
func TestRunValidatesItsInputs(t *testing.T) {
	t.Parallel()
	if _, err := sim.Run(model.Topology{}, load(100, 1)); !errors.Is(err, model.ErrNoNodes) {
		t.Errorf("Run() on an empty design = %v, want ErrNoNodes", err)
	}
	bad := load(100, 1)
	bad.RateRPS = 0
	if _, err := sim.Run(chain(1, 5, 0), bad); !errors.Is(err, model.ErrWorkload) {
		t.Errorf("Run() with no arrivals = %v, want ErrWorkload", err)
	}
}

// Naming what the traffic asks for changed how a request is decided and must
// not have changed what a run reports.
//
// The old model drew `r.Float64() < readFraction` — one draw, a read below the
// fraction. Choosing an operation walks the shares in order and stops at the
// first one the same draw falls inside, which for a read followed by a write is
// the same comparison spelled differently. Anything that took a second draw
// would shift every later draw in the stream, and a design nobody touched would
// start answering differently.
//
// The shortener's own figures are pinned in scenario_test.go against the
// numbers the previous model produced. This says the same thing about a design
// small enough to see: that the split is not merely close, it is the same
// requests being the same operations.
func TestNamingTheOperationsDoesNotMoveTheSplit(t *testing.T) {
	t.Parallel()
	design := stored(1, 1, 2, 20)
	for _, share := range []float64{0.1, 0.5, 0.7, 0.9} {
		w := load(90, 4)
		w.Operations = asking(share)
		res, err := sim.Run(design, w)
		if err != nil {
			t.Fatalf("read share %g: %v", share, err)
		}
		// Two operations named in the other order pick the other one for every
		// draw, so the reads and the writes swap places exactly.
		flipped := load(90, 4)
		flipped.Operations = []model.Operation{
			{Name: "write", Kind: model.Write, Share: 1 - share},
			{Name: "read", Kind: model.Read, Share: share},
		}
		other, err := sim.Run(design, flipped)
		if err != nil {
			t.Fatalf("read share %g flipped: %v", share, err)
		}
		if res.Arrived != other.Arrived {
			t.Errorf("read share %g: %d arrivals one way and %d the other — "+
				"choosing an operation is taking a draw the arrival process needed",
				share, res.Arrived, other.Arrived)
		}
	}
}

// An operation's name is for the reader. Two workloads that differ only in what
// their operations are called have to produce identical results, or the name is
// quietly a parameter.
func TestRenamingAnOperationChangesNothing(t *testing.T) {
	t.Parallel()
	design := stored(1, 1, 2, 20)
	plain := load(90, 7)
	plain.Operations = asking(0.8)
	named := load(90, 7)
	named.Operations = []model.Operation{
		{Name: "resolve", Kind: model.Read, Share: 0.8},
		{Name: "shorten", Kind: model.Write, Share: 0.2},
	}
	first, err := sim.Run(design, plain)
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	second, err := sim.Run(design, named)
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if !same(first, second) {
		t.Error("renaming the operations changed the result, so the name is not just a name")
	}
}

// More than two, because nothing about the model says two. The shares are
// walked in order and each has to claim its own slice of the draw — and the two
// reads have to both count as reads rather than the second one falling through
// to whatever comes after it.
//
// Behind a cache that answers every read, the store sees writes and nothing
// else. So the share of traffic reaching it is the share of the one write
// operation, which is the whole measurement: get the walk wrong by one entry
// and this reads 0.4 or 0, not 0.1.
func TestEveryOperationGetsItsShareOfTheTraffic(t *testing.T) {
	t.Parallel()
	w := load(400, 11)
	w.Duration = 60_000
	w.WarmupFraction = 0
	w.Operations = []model.Operation{
		{Name: "resolve", Kind: model.Read, Share: 0.6},
		{Name: "preview", Kind: model.Read, Share: 0.3},
		{Name: "shorten", Kind: model.Write, Share: 0.1},
	}
	res, err := sim.Run(cached(1, 0.1, 1), w)
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if res.Arrived == 0 {
		t.Fatal("nothing arrived")
	}
	reaching := float64(res.Nodes["store"].Served) / float64(res.Nodes["cache"].Served)
	if reaching < 0.085 || reaching > 0.115 {
		t.Errorf("%.3f of the traffic reached the store behind a cache that answers "+
			"every read, want about the 0.1 share the one write operation has", reaching)
	}
}
