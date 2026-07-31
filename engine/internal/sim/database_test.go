package sim_test

import (
	"errors"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

// stored is a client in front of a database, with nothing in between: what a
// database does under load is the subject, and a service or cache ahead of it
// would only be deciding how much of that load arrives.
func stored(replicas, pool int, meanRead, meanWrite model.Millis) model.Topology {
	return model.Topology{
		Nodes: []model.Node{
			{ID: "client", Kind: model.KindClient},
			{ID: "db", Kind: model.KindDatabase, Database: &model.DatabaseParams{
				Replicas:  replicas,
				MeanRead:  meanRead,
				MeanWrite: meanWrite,
				PoolSize:  pool,
			}},
		},
		Edges: []model.Edge{{From: "client", To: "db"}},
	}
}

// What replicas are for. The same read load against a primary alone and
// against a primary with three replicas: four times the connections to serve
// reads with.
func TestReplicasCarryReads(t *testing.T) {
	t.Parallel()
	alone, err := sim.Run(stored(0, 2, 20, 20), reads(150, 31))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	spread, err := sim.Run(stored(3, 2, 20, 20), reads(150, 31))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if spread.MeanLatency >= alone.MeanLatency {
		t.Errorf("three replicas gave mean latency %v against %v for the primary alone",
			spread.MeanLatency, alone.MeanLatency)
	}
}

// And what they are not for. A write only ever reaches the primary, so adding
// replicas to a write-only design changes nothing whatsoever — not the
// latency, not the drops, not one request's ordering. An identical Result
// rather than a similar one, because there is no mechanism by which a replica
// could touch this run.
//
// This is the failure a design review is supposed to catch and a simulator
// should not hide: replicas bought to fix a write bottleneck.
func TestReplicasDoNothingForWrites(t *testing.T) {
	t.Parallel()
	alone, err := sim.Run(stored(0, 2, 5, 40), writes(40, 32))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	spread, err := sim.Run(stored(6, 2, 5, 40), writes(40, 32))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if spread != alone {
		t.Errorf("six replicas changed a write-only run:\n got %+v\nwant %+v", spread, alone)
	}
}

// Reads and writes are drawn from their own means. A store where a write
// costs forty times a read has to show it, or the two parameters are one
// parameter with two names.
func TestReadsAndWritesCostTheirOwnTime(t *testing.T) {
	t.Parallel()
	design := stored(0, 8, 1, 40)
	quick, err := sim.Run(design, reads(20, 33))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	slow, err := sim.Run(design, writes(20, 33))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	// Well under the forty-fold ratio of the means, so this is testing that
	// the two draws are separate rather than that a light load is unqueued.
	if slow.MeanLatency < 10*quick.MeanLatency {
		t.Errorf("writes averaged %v against reads at %v: the means are not being told apart",
			slow.MeanLatency, quick.MeanLatency)
	}
}

// The connection pool is the cap that turns a fast database into a queue —
// the same store, the same work, and the only difference how much of it may
// happen at once.
func TestThePoolIsTheCap(t *testing.T) {
	t.Parallel()
	narrow, err := sim.Run(stored(0, 1, 10, 10), reads(80, 34))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	wide, err := sim.Run(stored(0, 16, 10, 10), reads(80, 34))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if wide.MeanLatency >= narrow.MeanLatency {
		t.Errorf("sixteen connections gave mean latency %v against one connection's %v",
			wide.MeanLatency, narrow.MeanLatency)
	}
}

// A mixed workload is where the two lanes interact: writes queue for the
// primary while reads keep flowing past them to the replicas. The run has to
// stay reproducible through that.
func TestAStoredDesignStillRepeats(t *testing.T) {
	t.Parallel()
	design := stored(2, 3, 4, 30)
	w := load(120, 35)
	w.ReadFraction = 0.7
	first, err := sim.Run(design, w)
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	for i := range 3 {
		again, err := sim.Run(design, w)
		if err != nil {
			t.Fatalf("Run() unexpected error on repeat %d: %v", i, err)
		}
		if again != first {
			t.Fatalf("repeat %d differed:\n got %+v\nwant %+v", i, again, first)
		}
	}
}

func TestADatabaseSendingToTwoComponentsIsRefused(t *testing.T) {
	t.Parallel()
	design := stored(1, 2, 5, 10)
	for _, id := range []string{"a", "b"} {
		design.Nodes = append(design.Nodes, model.Node{
			ID: id, Kind: model.KindService,
			Service: &model.ServiceParams{Instances: 1, MeanService: 1},
		})
		design.Edges = append(design.Edges, model.Edge{From: "db", To: id})
	}
	if _, err := sim.Run(design, load(50, 1)); !errors.Is(err, sim.ErrFanOut) {
		t.Errorf("Run() on a database sending to two components = %v, want ErrFanOut", err)
	}
}
