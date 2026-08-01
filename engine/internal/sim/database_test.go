package sim_test

import (
	"errors"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

// stored is a database behind the cheapest service that can stand in front of
// one: what a database does under load is the subject, and `frontend` is sized
// so that it decides nothing about the answer.
func stored(replicas, pool int, meanRead, meanWrite model.Millis) model.Topology {
	return model.Topology{
		Nodes: []model.Node{
			{ID: "client", Kind: model.KindClient},
			entry(),
			frontend(),
			{ID: "db", Kind: model.KindDatabase, Database: &model.DatabaseParams{
				Replicas:  replicas,
				MeanRead:  meanRead,
				MeanWrite: meanWrite,
				PoolSize:  pool,
			}},
		},
		Edges: []model.Edge{
			{From: "client", To: "in"}, {From: "in", To: "front"}, {From: "front", To: "db"},
		},
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
	if spread.Latency.Mean >= alone.Latency.Mean {
		t.Errorf("three replicas gave mean latency %v against %v for the primary alone",
			spread.Latency.Mean, alone.Latency.Mean)
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
	if !same(spread, alone) {
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
	if slow.Latency.Mean < 10*quick.Latency.Mean {
		t.Errorf("writes averaged %v against reads at %v: the means are not being told apart",
			slow.Latency.Mean, quick.Latency.Mean)
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
	if wide.Latency.Mean >= narrow.Latency.Mean {
		t.Errorf("sixteen connections gave mean latency %v against one connection's %v",
			wide.Latency.Mean, narrow.Latency.Mean)
	}
}

// A mixed workload is where the two lanes interact: writes queue for the
// primary while reads keep flowing past them to the replicas. The run has to
// stay reproducible through that.
func TestAStoredDesignStillRepeats(t *testing.T) {
	t.Parallel()
	design := stored(2, 3, 4, 30)
	w := load(120, 35)
	w.Operations = asking(0.7)
	first, err := sim.Run(design, w)
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	for i := range 3 {
		again, err := sim.Run(design, w)
		if err != nil {
			t.Fatalf("Run() unexpected error on repeat %d: %v", i, err)
		}
		if !same(again, first) {
			t.Fatalf("repeat %d differed:\n got %+v\nwant %+v", i, again, first)
		}
	}
}

// Spreading requests over several components is what a load balancer is for.
// Anything else that does it has no rule for choosing, and the engine refuses
// rather than picking one.
//
// The source is a service sending to two databases. It used to be a database
// sending to two services, which the model now refuses earlier and for a
// different reason — a database calls nothing — so the case had to be rebuilt
// out of a pair of kinds that may legally connect.
func TestAComponentSendingToTwoOthersIsRefused(t *testing.T) {
	t.Parallel()
	design := stored(1, 2, 5, 10)
	design.Nodes = append(design.Nodes, model.Node{
		ID: "other", Kind: model.KindDatabase,
		Database: &model.DatabaseParams{Replicas: 0, MeanRead: 5, MeanWrite: 10, PoolSize: 2},
	})
	design.Edges = append(design.Edges, model.Edge{From: "front", To: "other"})
	if _, err := sim.Run(design, load(50, 1)); !errors.Is(err, sim.ErrFanOut) {
		t.Errorf("Run() on a service sending to two components = %v, want ErrFanOut", err)
	}
}
