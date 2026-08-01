package model_test

import (
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

// asking splits traffic between one read and one write in the given
// proportion. The all-or-nothing cases are separate because an operation with
// no share is refused outright: one that never happens would sit in the
// workload looking like part of the load while contributing nothing.
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

func validWorkload() model.Workload {
	return model.Workload{
		RateRPS:        5000,
		Operations:     asking(0.99),
		Duration:       60_000,
		Seed:           42,
		WarmupFraction: 0.1,
	}
}

func TestWorkloadAcceptsAReasonableLoad(t *testing.T) {
	t.Parallel()
	if err := validWorkload().Validate(); err != nil {
		t.Fatalf("Validate() on a reasonable workload = %v, want nil", err)
	}
}

// Seed zero is a seed, not a missing value. Rejecting it would make the one
// run everybody reaches for first the one run that cannot be reproduced.
func TestSeedZeroIsAllowed(t *testing.T) {
	t.Parallel()
	w := validWorkload()
	w.Seed = 0
	if err := w.Validate(); err != nil {
		t.Errorf("Validate() with seed 0 = %v, want nil", err)
	}
}

// No warmup is a choice, not an error: a design with no queues has nothing to
// fill, and discarding a tenth of it would only cost samples.
func TestZeroWarmupIsAllowed(t *testing.T) {
	t.Parallel()
	w := validWorkload()
	w.WarmupFraction = 0
	if err := w.Validate(); err != nil {
		t.Errorf("Validate() with no warmup = %v, want nil", err)
	}
}

func TestWorkloadRejects(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		mutate func(*model.Workload)
	}{
		{"no arrivals at all", func(w *model.Workload) { w.RateRPS = 0 }},
		{"a negative arrival rate", func(w *model.Workload) { w.RateRPS = -1 }},
		{"a NaN arrival rate", func(w *model.Workload) { w.RateRPS = math.NaN() }},
		{"an infinite arrival rate", func(w *model.Workload) { w.RateRPS = math.Inf(1) }},
		{"no operations at all", func(w *model.Workload) { w.Operations = nil }},
		{"an operation with no name", func(w *model.Workload) {
			w.Operations = []model.Operation{{Kind: model.Read, Share: 1}}
		}},
		{"two operations of the same name", func(w *model.Workload) {
			w.Operations = []model.Operation{
				{Name: "resolve", Kind: model.Read, Share: 0.5},
				{Name: "resolve", Kind: model.Write, Share: 0.5},
			}
		}},
		{"an operation that is neither a read nor a write", func(w *model.Workload) {
			w.Operations = []model.Operation{{Name: "resolve", Kind: "lookup", Share: 1}}
		}},
		{"an operation that never happens", func(w *model.Workload) {
			w.Operations = []model.Operation{
				{Name: "resolve", Kind: model.Read, Share: 1},
				{Name: "shorten", Kind: model.Write, Share: 0},
			}
		}},
		{"an operation with a negative share", func(w *model.Workload) {
			w.Operations = []model.Operation{
				{Name: "resolve", Kind: model.Read, Share: 1.5},
				{Name: "shorten", Kind: model.Write, Share: -0.5},
			}
		}},
		{"shares that do not account for all the traffic", func(w *model.Workload) {
			w.Operations = []model.Operation{
				{Name: "resolve", Kind: model.Read, Share: 0.5},
				{Name: "shorten", Kind: model.Write, Share: 0.2},
			}
		}},
		{"shares that account for more traffic than arrives", func(w *model.Workload) {
			w.Operations = []model.Operation{
				{Name: "resolve", Kind: model.Read, Share: 0.9},
				{Name: "shorten", Kind: model.Write, Share: 0.9},
			}
		}},
		{"a run of no length", func(w *model.Workload) { w.Duration = 0 }},
		{"a run of negative length", func(w *model.Workload) { w.Duration = -1 }},
		{"a warmup share above one", func(w *model.Workload) { w.WarmupFraction = 1.5 }},
		{"a warmup that consumes the whole run", func(w *model.Workload) {
			w.WarmupFraction = 1
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w := validWorkload()
			tt.mutate(&w)
			if err := w.Validate(); !errors.Is(err, model.ErrWorkload) {
				t.Errorf("Validate() with %s = %v, want ErrWorkload", tt.name, err)
			}
		})
	}
}

// A range failure inside a workload is both things at once: the workload is at
// fault, and a number is out of range. Callers ask different questions — the
// HTTP layer wants the first, a parameter form wants the second — so both have
// to match.
func TestWorkloadRangeErrorsMatchBothSentinels(t *testing.T) {
	t.Parallel()
	w := validWorkload()
	w.RateRPS = -1
	err := w.Validate()
	for _, want := range []error{model.ErrWorkload, model.ErrParamRange} {
		if !errors.Is(err, want) {
			t.Errorf("Validate() = %v, want it to match %v", err, want)
		}
	}
}

func TestWorkloadJSONRoundTrip(t *testing.T) {
	t.Parallel()
	want := validWorkload()

	encoded, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("Marshal() unexpected error: %v", err)
	}
	var got model.Workload
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatalf("Unmarshal() unexpected error: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("round trip changed the workload:\n got %+v\nwant %+v", got, want)
	}
}

// A rate too high for the clock to put a gap between arrivals does not produce
// a wrong answer, it produces no answer: every arrival lands on the instant the
// last one did, the horizon is never reached, and the run never returns. A
// caller that cannot interrupt it — which is every caller — is simply stuck.
//
// It is the mirror of a duration too long to represent, and the reason both
// belong here rather than in whichever transport happened to notice first.
func TestARateTooFastForTheClockIsRejected(t *testing.T) {
	t.Parallel()
	w := model.Workload{
		RateRPS: 1, Operations: asking(1), Duration: 1000, Seed: 1, WarmupFraction: 0,
	}
	// One arrival per nanosecond is the finest the clock can space.
	w.RateRPS = 1e9
	if err := w.Validate(); err != nil {
		t.Errorf("Validate() at one arrival per nanosecond = %v, want nil", err)
	}
	w.RateRPS = 1e9 + 1
	if err := w.Validate(); !errors.Is(err, model.ErrWorkload) {
		t.Errorf("Validate() above one arrival per nanosecond = %v, want ErrWorkload", err)
	}
	// The rate that hangs: fast enough that the mean gap truncates to zero.
	w.RateRPS = 1.5e9
	if err := w.Validate(); !errors.Is(err, model.ErrParamRange) {
		t.Errorf("Validate() at 1.5e9 rps = %v, want ErrParamRange", err)
	}
}
