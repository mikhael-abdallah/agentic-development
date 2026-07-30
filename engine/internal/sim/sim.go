// Package sim models request latency through a system design. Components
// compose serially (latencies add up) or as parallel fan-out (the slowest
// branch dominates), which is enough to sketch a request path end to end.
package sim

import "time"

// Component is anything that contributes latency to a request path.
type Component interface {
	// Latency returns the time the component adds to a single request.
	Latency() time.Duration
}

// Fixed is a component with constant latency, such as a network hop or a
// cache hit with a known cost.
type Fixed time.Duration

// Latency implements Component.
func (f Fixed) Latency() time.Duration { return time.Duration(f) }

// Serial composes components a request traverses one after another; its
// latency is the sum of the parts. An empty Serial costs nothing.
type Serial []Component

// Latency implements Component.
func (s Serial) Latency() time.Duration {
	var total time.Duration
	for _, c := range s {
		total += c.Latency()
	}
	return total
}

// Parallel composes a fan-out where the caller waits for every branch to
// answer; its latency is the slowest branch. An empty Parallel costs nothing.
type Parallel []Component

// Latency implements Component.
func (p Parallel) Latency() time.Duration {
	var slowest time.Duration
	for _, c := range p {
		if l := c.Latency(); l > slowest {
			slowest = l
		}
	}
	return slowest
}
