package model_test

import (
	"errors"
	"math"
	"testing"
	"time"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

func TestMillisConvertsToDuration(t *testing.T) {
	t.Parallel()
	for m, want := range map[model.Millis]time.Duration{
		0:     0,
		1:     time.Millisecond,
		0.5:   500 * time.Microsecond,
		1500:  1500 * time.Millisecond,
		0.001: time.Microsecond,
	} {
		if got := m.Duration(); got != want {
			t.Errorf("Millis(%v).Duration() = %v, want %v", float64(m), got, want)
		}
	}
}

func TestKindsAreValid(t *testing.T) {
	t.Parallel()
	kinds := model.Kinds()
	if len(kinds) != 5 {
		t.Errorf("Kinds() returned %d kinds, want 5 — teach sim the new one too", len(kinds))
	}
	for _, k := range kinds {
		if !k.Valid() {
			t.Errorf("Kinds() offers %q but Valid() rejects it", k)
		}
	}
	if model.NodeKind("quantumMesh").Valid() {
		t.Error("Valid() accepted a kind the simulator does not model")
	}
}

func TestAlgorithmValidity(t *testing.T) {
	t.Parallel()
	for _, a := range []model.Algorithm{
		model.RoundRobin, model.LeastConnections, model.RandomChoice,
	} {
		if !a.Valid() {
			t.Errorf("Valid() rejected the known strategy %q", a)
		}
	}
	if model.Algorithm("coinFlip").Valid() {
		t.Error("Valid() accepted a balancing strategy that does not exist")
	}
}

// NaN and the infinities pass every ordinary range check: NaN compares false
// against everything, so `v < 0` waves it through. A NaN service time would
// then produce a NaN result rather than an error, which is the failure this
// package most wants to avoid — a number that looks like an answer.
func TestNonFiniteParametersAreRejected(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		build func() model.Topology
	}{
		{"a NaN service time", func() model.Topology {
			tp := reference()
			tp.Nodes[2].Service.MeanService = model.Millis(math.NaN())
			return tp
		}},
		{"an infinite service time", func() model.Topology {
			tp := reference()
			tp.Nodes[2].Service.MeanService = model.Millis(math.Inf(1))
			return tp
		}},
		{"a NaN hit ratio", func() model.Topology {
			tp := reference()
			tp.Nodes[3].Cache.HitRatio = math.NaN()
			return tp
		}},
		{"a negative-infinity balancer overhead", func() model.Topology {
			tp := reference()
			tp.Nodes[1].LoadBalancer.Overhead = model.Millis(math.Inf(-1))
			return tp
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if err := tt.build().Validate(); !errors.Is(err, model.ErrParamRange) {
				t.Errorf("Validate() with %s = %v, want ErrParamRange", tt.name, err)
			}
		})
	}
}

func TestDatabaseReadAndWriteCostsAreCheckedSeparately(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name   string
		mutate func(*model.DatabaseParams)
	}{
		{"a negative read time", func(p *model.DatabaseParams) { p.MeanRead = -1 }},
		{"a negative write time", func(p *model.DatabaseParams) { p.MeanWrite = -1 }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			tp := reference()
			tt.mutate(tp.Nodes[4].Database)
			if err := tp.Validate(); !errors.Is(err, model.ErrParamRange) {
				t.Errorf("Validate() with %s = %v, want ErrParamRange", tt.name, err)
			}
		})
	}
}

// Zero is meaningful for a queue: it means unbounded, not "rejects
// everything". A design that leaves it unset must still validate.
func TestZeroQueueCapacityMeansUnbounded(t *testing.T) {
	t.Parallel()
	tp := reference()
	tp.Nodes[2].Service.QueueCapacity = 0
	if err := tp.Validate(); err != nil {
		t.Errorf("Validate() with an unbounded queue = %v, want nil", err)
	}
}

// Likewise zero replicas: the primary serves every read on its own.
func TestZeroReplicasIsAValidDatabase(t *testing.T) {
	t.Parallel()
	tp := reference()
	tp.Nodes[4].Database.Replicas = 0
	if err := tp.Validate(); err != nil {
		t.Errorf("Validate() with no read replicas = %v, want nil", err)
	}
}

// A duration that is merely added to a request may be zero — a balancer that
// costs nothing measurable, a cache hit served from memory are both real
// answers. The counterpart, that a duration the simulation samples from may
// not be zero, is covered by the rejection table in topology_test.go.
func TestAddedDurationsMayBeZero(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name   string
		mutate func(*model.Topology)
	}{
		{"a balancer with no measurable overhead", func(tp *model.Topology) {
			tp.Nodes[1].LoadBalancer.Overhead = 0
		}},
		{"a cache hit served instantly", func(tp *model.Topology) {
			tp.Nodes[3].Cache.HitLatency = 0
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			tp := reference()
			tt.mutate(&tp)
			if err := tp.Validate(); err != nil {
				t.Errorf("Validate() with %s = %v, want nil", tt.name, err)
			}
		})
	}
}
