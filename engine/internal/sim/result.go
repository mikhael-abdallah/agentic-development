package sim

import "time"

// Result is what one simulation run reports.
//
// Every count is over the measurement window only. Requests that arrived
// during warmup are simulated — they are what fills the queues the measured
// requests then wait behind — but they are not counted, because including
// them would report the emptier system the run started with.
type Result struct {
	// Arrived is how many requests entered the system.
	Arrived int
	// Completed is how many made it out. It can lag Arrived at the end of a
	// run without anything being wrong: the loop drains every request it
	// admitted, but a request that arrived in the window and completed after
	// it is counted here and not there.
	Completed int
	// Dropped is how many were turned away by a full queue. A design that
	// shows drops is not slow, it is lossy, and the two are worth telling
	// apart before reading any latency number below.
	Dropped int
	// MeanLatency is the average end-to-end time of completed requests.
	MeanLatency time.Duration
}
