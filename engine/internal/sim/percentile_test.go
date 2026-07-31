package sim

import (
	"testing"
	"time"
)

func ms(n int) time.Duration { return time.Duration(n) * time.Millisecond }

// Nearest-rank returns a value the sample actually contains. Interpolating
// would report a tail latency no request had, which for a p99 is the one
// thing it must not do.
func TestPercentileReturnsAnObservedValue(t *testing.T) {
	t.Parallel()
	sample := []time.Duration{ms(1), ms(2), ms(3), ms(4), ms(100)}
	tests := []struct {
		q    float64
		want time.Duration
	}{
		{0.0, ms(1)},
		{0.5, ms(3)},
		{0.8, ms(4)},
		{0.81, ms(100)},
		{0.99, ms(100)},
		{1.0, ms(100)},
	}
	for _, tt := range tests {
		if got := percentile(sample, tt.q); got != tt.want {
			t.Errorf("percentile(%.2f) = %v, want %v", tt.q, got, tt.want)
		}
	}
}

// A run that measured nothing has no percentiles to report. Zero is the
// answer here rather than a made-up measurement: the caller tells this apart
// from a genuinely instant run by looking at Completed, which is also zero.
func TestAnEmptySampleHasNoLatency(t *testing.T) {
	t.Parallel()
	if got := percentile(nil, 0.99); got != 0 {
		t.Errorf("percentile of an empty sample = %v, want 0", got)
	}
	if got := latencyOf(nil); got != (Latency{}) {
		t.Errorf("latencyOf(nil) = %+v, want the zero Latency", got)
	}
}

// A single request is its own median and its own worst case.
func TestOneRequestIsEveryPercentile(t *testing.T) {
	t.Parallel()
	got := latencyOf([]time.Duration{ms(7)})
	want := Latency{Mean: ms(7), P50: ms(7), P95: ms(7), P99: ms(7), Max: ms(7)}
	if got != want {
		t.Errorf("latencyOf(one request) = %+v, want %+v", got, want)
	}
}

// Nothing in a design with no capacity limits can be named as the thing to
// change first, because there is nothing there to raise.
func TestNothingToSaturateNamesNoBottleneck(t *testing.T) {
	t.Parallel()
	nodes := map[string]NodeStats{"lb": {Served: 100}, "cache": {Served: 100}}
	if got := bottleneck(nodes); got != "" {
		t.Errorf("bottleneck() with no limited component = %q, want empty", got)
	}
}

// Two components pinned at the same utilization is the ordinary state of an
// overloaded design. Whichever the map yielded would make the answer change
// between identical runs, so the tie resolves by id.
func TestATiedBottleneckResolvesTheSameWayEveryTime(t *testing.T) {
	t.Parallel()
	nodes := map[string]NodeStats{
		"zebra": {Utilization: 1}, "api": {Utilization: 1}, "middle": {Utilization: 0.4},
	}
	for range 50 {
		if got := bottleneck(nodes); got != "api" {
			t.Fatalf("bottleneck() = %q on a tie, want the first by id", got)
		}
	}
}
