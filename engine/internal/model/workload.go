package model

import (
	"fmt"
	"time"
)

// Workload is the load offered to a design over one simulation run.
type Workload struct {
	// RateRPS is the mean arrival rate in requests per second.
	RateRPS float64 `json:"rateRps"`
	// ReadFraction splits arrivals between reads and writes. It is what makes
	// a cache and a read replica worth anything, so it belongs to the load
	// rather than to any one component.
	ReadFraction float64 `json:"readFraction"`
	// Duration is how much simulated time to run for. It is not wall-clock
	// time: a busy hour costs the same seconds to simulate as a quiet one.
	Duration Millis `json:"durationMs"`
	// Seed makes a run reproducible. The same topology, workload and seed
	// must produce the same result, which is a test invariant rather than a
	// hope.
	Seed uint64 `json:"seed"`
	// WarmupFraction is the share of the run to discard before measuring.
	//
	// A simulation starts with every queue empty, which no running system is.
	// Measuring from zero reports the latencies of a system that has not yet
	// filled up, and reports them as though they were steady state —
	// flattering, and wrong in the direction nobody checks.
	WarmupFraction float64 `json:"warmupFraction"`
}

// maxRateRPS is the fastest arrival stream a simulation clock can express:
// one request per nanosecond.
//
// Past it the mean gap between arrivals rounds down to zero, and an arrival
// process with no gap does not advance the clock at all — every arrival is
// scheduled at the instant the last one was, the horizon is never reached, and
// the run does not finish. Not a wrong answer: no answer, and a caller left
// holding a goroutine that cannot be interrupted.
//
// It is the same clock-resolution mistake representable() catches at the other
// end. A duration too long overflows into a run that ends before it starts; a
// rate too high underflows into a run that never moves.
const maxRateRPS = float64(time.Second / time.Nanosecond)

// arrivalsAreSpaced rejects a rate the clock cannot put a gap into.
func (w Workload) arrivalsAreSpaced() error {
	if w.RateRPS > maxRateRPS {
		return fmt.Errorf(
			"%w: rateRps is %g, above the one arrival per nanosecond a simulation clock can space (%g)",
			ErrParamRange, w.RateRPS, maxRateRPS)
	}
	return nil
}

// Validate reports whether this workload can be run. Failures wrap both
// ErrWorkload and the specific range error, so a caller can ask either "was
// the workload at fault" or "was a number out of range".
func (w Workload) Validate() error {
	for _, err := range []error{
		aboveZero("rateRps", w.RateRPS),
		w.arrivalsAreSpaced(),
		fraction("readFraction", w.ReadFraction),
		aboveZero("durationMs", float64(w.Duration)),
		representable("durationMs", float64(w.Duration)),
		fraction("warmupFraction", w.WarmupFraction),
	} {
		if err != nil {
			return fmt.Errorf("%w: %w", ErrWorkload, err)
		}
	}
	// A whole run of warmup leaves nothing to measure, and an empty sample
	// would otherwise be reported as a successful simulation.
	if w.WarmupFraction == 1 {
		return fmt.Errorf("%w: warmupFraction is 1, which leaves no run to measure",
			ErrWorkload)
	}
	return nil
}
