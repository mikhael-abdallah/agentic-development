package model_test

import (
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

func validWorkload() model.Workload {
	return model.Workload{
		RateRPS:        5000,
		ReadFraction:   0.99,
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
		{"a read share above one", func(w *model.Workload) { w.ReadFraction = 1.01 }},
		{"a negative read share", func(w *model.Workload) { w.ReadFraction = -0.01 }},
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
	w.ReadFraction = 2
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
