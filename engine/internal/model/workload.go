package model

import (
	"fmt"
	"time"
)

// OperationKind is what an operation does to the data behind a design.
//
// Two, and not because systems only do two things. This is the distinction the
// simulation can act on: a read may be answered by a cache or by a replica, and
// a write may not. Anything finer — idempotent or not, cheap or expensive — is
// either invisible to the model or is already the operation's own service time.
type OperationKind string

const (
	Read  OperationKind = "read"
	Write OperationKind = "write"
)

// Operation is one thing a design is asked to do, and how much of the traffic
// asks for it.
//
// A URL shortener resolves short codes and shortens long ones, and those are
// not the same request: one is answered from a cache almost every time and the
// other has to reach the store. Saying so is the difference between a design
// that reads as "browser, balancer, service, cache, database" and one that says
// what is actually flowing through it.
//
// The Name has no effect on the simulation — it is what the results are broken
// down by and what the canvas shows. The Kind and the Share are what the run
// uses.
type Operation struct {
	Name string        `json:"name"`
	Kind OperationKind `json:"kind"`
	// Share of arrivals that are this operation. The shares across a workload
	// add up to one.
	Share float64 `json:"share"`
}

// Workload is the load offered to a design over one simulation run.
type Workload struct {
	// RateRPS is the mean arrival rate in requests per second.
	RateRPS float64 `json:"rateRps"`
	// Operations is what the arrivals are asking for, and in what proportion.
	//
	// It replaced a single ReadFraction, which said how much of the traffic
	// only read and nothing about what any of it was for. That number is still
	// in here — it is the sum of the shares of the read operations — but a
	// design can now state that it resolves and shortens rather than leaving a
	// reader to infer two operations from the fact that 0.95 is not 1.
	Operations []Operation `json:"operations"`
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

// shareSlack is how far the operation shares may be from adding to one.
//
// Not zero, because 0.7 + 0.2 + 0.1 is not 1 in binary floating point and
// refusing that would be refusing arithmetic the user did correctly. Small
// enough that a genuine mistake — shares that come to 0.9, or to 1.1 — is
// still caught, since those are wrong by a tenth and this allows a billionth.
const shareSlack = 1e-9

// validateOperations checks that the workload says what its requests are, once
// each, in proportions that add up.
func (w Workload) validateOperations() error {
	if len(w.Operations) == 0 {
		return fmt.Errorf("%w: a workload needs at least one operation", ErrWorkload)
	}
	seen := make(map[string]bool, len(w.Operations))
	total := 0.0
	for _, op := range w.Operations {
		if op.Name == "" {
			return fmt.Errorf("%w: an operation has no name", ErrWorkload)
		}
		if seen[op.Name] {
			return fmt.Errorf("%w: two operations are called %q", ErrWorkload, op.Name)
		}
		seen[op.Name] = true
		if op.Kind != Read && op.Kind != Write {
			return fmt.Errorf("%w: operation %q is a %q, which is neither a read nor a write",
				ErrWorkload, op.Name, op.Kind)
		}
		// Above zero rather than at or above. An operation with no share never
		// happens, so it would sit in the design and in the results looking
		// like part of the load while contributing nothing — the same defect
		// as an unreachable component, and refused for the same reason.
		if err := aboveZero("share of "+op.Name, op.Share); err != nil {
			return fmt.Errorf("%w: %w", ErrWorkload, err)
		}
		total += op.Share
	}
	if diff := total - 1; diff > shareSlack || diff < -shareSlack {
		return fmt.Errorf(
			"%w: the operation shares come to %g, and a run divides all of its traffic between them",
			ErrWorkload, total)
	}
	return nil
}

// Validate reports whether this workload can be run. Failures wrap both
// ErrWorkload and the specific range error, so a caller can ask either "was
// the workload at fault" or "was a number out of range".
func (w Workload) Validate() error {
	if err := w.validateOperations(); err != nil {
		return err
	}
	for _, err := range []error{
		aboveZero("rateRps", w.RateRPS),
		w.arrivalsAreSpaced(),
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
