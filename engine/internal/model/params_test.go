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

// Millis and Duration have to be inverses. They are the only two places the
// unit is decided, and a mismatch would be invisible: a latency reported a
// thousand times too large reads as a working system that is very slow.
func TestMillisRoundTripsThroughDuration(t *testing.T) {
	t.Parallel()
	for _, ms := range []model.Millis{0, 0.5, 1, 5, 250, 60_000} {
		if got := model.MillisOf(ms.Duration()); got != ms {
			t.Errorf("MillisOf(Millis(%v).Duration()) = %v", ms, got)
		}
	}
	if got := model.MillisOf(1500 * time.Microsecond); got != 1.5 {
		t.Errorf("MillisOf(1.5ms) = %v, want 1.5", got)
	}
}

// A duration longer than the clock can express overflows to a negative one,
// and nothing downstream treats that as an error: a negative run length ends
// before it starts and reports a successful simulation of nothing, and a
// negative service time schedules completions into the past. Every parameter
// the simulation turns into a Duration is checked, not just the one that was
// noticed.
func TestADurationTooLongForTheClockIsRejected(t *testing.T) {
	t.Parallel()
	// Past math.MaxInt64 nanoseconds, which is about 292 years.
	const tooLong model.Millis = 1e13
	tests := []struct {
		name string
		node model.Node
	}{
		{"a balancer overhead", model.Node{
			ID: "lb", Kind: model.KindLoadBalancer,
			LoadBalancer: &model.LoadBalancerParams{
				Algorithm: model.RoundRobin, Overhead: tooLong,
			},
		}},
		{"a service time", model.Node{
			ID: "api", Kind: model.KindService,
			Service: &model.ServiceParams{Instances: 1, MeanService: tooLong},
		}},
		{"a cache lookup", model.Node{
			ID: "cache", Kind: model.KindCache,
			Cache: &model.CacheParams{HitRatio: 0.5, HitLatency: tooLong},
		}},
		{"a read time", model.Node{
			ID: "db", Kind: model.KindDatabase,
			Database: &model.DatabaseParams{
				MeanRead: tooLong, MeanWrite: 1, PoolSize: 1,
			},
		}},
		{"a write time", model.Node{
			ID: "db", Kind: model.KindDatabase,
			Database: &model.DatabaseParams{
				MeanRead: 1, MeanWrite: tooLong, PoolSize: 1,
			},
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			design := model.Topology{
				Nodes: []model.Node{{ID: "client", Kind: model.KindClient}, tt.node},
				Edges: []model.Edge{{From: "client", To: tt.node.ID}},
			}
			if err := design.Validate(); !errors.Is(err, model.ErrParamRange) {
				t.Errorf("Validate() with %s of %g ms = %v, want ErrParamRange",
					tt.name, float64(tooLong), err)
			}
		})
	}
}

func TestARunLongerThanTheClockIsRejected(t *testing.T) {
	t.Parallel()
	w := model.Workload{
		RateRPS: 1, ReadFraction: 1, Duration: 1e13, Seed: 1, WarmupFraction: 0,
	}
	if err := w.Validate(); !errors.Is(err, model.ErrWorkload) {
		t.Errorf("Validate() with a 317-year run = %v, want ErrWorkload", err)
	}
	// A run of a length the clock can hold is still fine.
	w.Duration = 1e9
	if err := w.Validate(); err != nil {
		t.Errorf("Validate() with an eleven-day run = %v, want nil", err)
	}
}

// A policy the simulator has no behaviour for would be a design it answers
// about anyway, on whichever branch the zero value happens to fall through.
func TestWritePolicyRejectsWhatItDoesNotKnow(t *testing.T) {
	t.Parallel()
	tests := []struct {
		policy model.WritePolicy
		want   bool
	}{
		{model.WriteThrough, true},
		{model.WriteAround, true},
		{model.WriteBack, true},
		// Empty is the design saved before the field existed, not a typo.
		{"", true},
		{"writeSideways", false},
		{"WRITETHROUGH", false},
	}
	for _, tt := range tests {
		if got := tt.policy.Valid(); got != tt.want {
			t.Errorf("WritePolicy(%q).Valid() = %v, want %v", tt.policy, got, tt.want)
		}
	}
}

func TestAnAbsentWritePolicyReadsAsWriteThrough(t *testing.T) {
	t.Parallel()
	if got := model.WritePolicy("").OrDefault(); got != model.WriteThrough {
		t.Errorf("empty policy read as %q, want %q", got, model.WriteThrough)
	}
	for _, policy := range model.WritePolicies() {
		if got := policy.OrDefault(); got != policy {
			t.Errorf("%q.OrDefault() = %q, want it left alone", policy, got)
		}
	}
}

// The form offers these in this order, and a policy missing from the list is
// one nobody can choose however well the engine models it.
func TestEveryWritePolicyIsOffered(t *testing.T) {
	t.Parallel()
	offered := model.WritePolicies()
	if offered[0] != model.WriteThrough {
		t.Errorf("the list starts with %q, want the safe default first", offered[0])
	}
	seen := map[model.WritePolicy]bool{}
	for _, policy := range offered {
		if !policy.Valid() || policy == "" {
			t.Errorf("WritePolicies() offers %q, which is not a policy", policy)
		}
		if seen[policy] {
			t.Errorf("WritePolicies() offers %q twice", policy)
		}
		seen[policy] = true
	}
	if len(seen) != 3 {
		t.Errorf("WritePolicies() offers %d policies, want 3", len(seen))
	}
}
