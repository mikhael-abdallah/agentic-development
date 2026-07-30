package sim_test

import (
	"errors"
	"testing"
	"time"

	"github.com/mikhael-abdallah/agentic-development/engine/sim"
)

func TestNewQueueRejectsInvalidInput(t *testing.T) {
	t.Parallel()
	for _, util := range []float64{-0.1, 1, 1.5} {
		if _, err := sim.NewQueue(time.Millisecond, util); !errors.Is(err, sim.ErrUtilization) {
			t.Errorf("NewQueue(1ms, %g) error = %v, want ErrUtilization", util, err)
		}
	}
	if _, err := sim.NewQueue(-time.Millisecond, 0.5); err == nil {
		t.Error("NewQueue(-1ms, 0.5) accepted a negative service time")
	}
}

func TestQueueLatencyGrowsWithUtilization(t *testing.T) {
	t.Parallel()
	service := 10 * time.Millisecond
	for util, want := range map[float64]time.Duration{
		0:     10 * time.Millisecond, // idle queue: pure service time
		0.5:   20 * time.Millisecond, // half loaded: doubled
		0.75:  40 * time.Millisecond,
		0.875: 80 * time.Millisecond, // toward saturation the growth is non-linear
	} {
		q, err := sim.NewQueue(service, util)
		if err != nil {
			t.Fatalf("NewQueue(%v, %g) unexpected error: %v", service, util, err)
		}
		if got := q.Latency(); got != want {
			t.Errorf("Latency() at %g utilization = %v, want %v", util, got, want)
		}
	}
}
