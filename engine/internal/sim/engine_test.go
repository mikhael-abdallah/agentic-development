package sim_test

import (
	"errors"
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
			{ID: "api", Kind: model.KindService, Service: &model.ServiceParams{
				Instances:     instances,
				MeanService:   meanMs,
				QueueCapacity: queue,
			}},
		},
		Edges: []model.Edge{{From: "client", To: "api"}},
	}
}

func load(rate float64, seed uint64) model.Workload {
	return model.Workload{
		RateRPS:        rate,
		ReadFraction:   1,
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
	if res.MeanLatency <= 0 {
		t.Errorf("MeanLatency = %v, want a positive duration", res.MeanLatency)
	}
	// Nothing can leave before it has been served, so end-to-end latency can
	// never be below the mean service time by much. This catches a clock that
	// is not advancing at all, which otherwise looks like a very fast design.
	if res.MeanLatency < 4*model.Millis(1).Duration() {
		t.Errorf("MeanLatency = %v, want at least roughly the 5ms service time",
			res.MeanLatency)
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
		if again != first {
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
	if a == b {
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
	if busy.MeanLatency <= quiet.MeanLatency {
		t.Errorf("mean latency at 180 rps (%v) did not exceed 50 rps (%v) on one server",
			busy.MeanLatency, quiet.MeanLatency)
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
		{"a component whose behaviour has not landed", func() model.Topology {
			tp := chain(1, 5, 0)
			tp.Nodes = append(tp.Nodes, model.Node{
				ID:   "db",
				Kind: model.KindDatabase,
				Database: &model.DatabaseParams{
					Replicas: 1, MeanRead: 2, MeanWrite: 8, PoolSize: 4,
				},
			})
			tp.Edges = append(tp.Edges, model.Edge{From: "api", To: "db"})
			return tp
		}, sim.ErrUnsupportedKind},

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
