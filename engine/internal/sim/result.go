package sim

import "time"

// Result is what one simulation run reports.
//
// Every number is over the measurement window only. Requests that arrived
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
	// Throughput is completed requests per second across the window.
	//
	// It is not the rate the workload offered. Once a design is past what it
	// can serve, throughput stops tracking arrivals and flattens — and the
	// gap between the two is the whole difference between a system that is
	// keeping up and one that is merely accepting work.
	Throughput float64
	// Latency is the spread of end-to-end times over completed requests.
	Latency Latency
	// Nodes is what each component did, keyed by its id.
	Nodes map[string]NodeStats
	// Bottleneck is the id of the component closest to saturated — the one
	// worth changing first. Empty when nothing in the design has a capacity
	// to be measured against.
	Bottleneck string
}

// Latency is the distribution of end-to-end request times, not a single
// number describing it.
//
// A mean is the one statistic a queue makes least useful: it is dragged
// around by a tail it does not describe, and a design whose mean looks fine
// can still be failing one request in a hundred slowly enough to time out.
// That request is what P99 is for.
type Latency struct {
	Mean time.Duration
	P50  time.Duration
	P95  time.Duration
	P99  time.Duration
	Max  time.Duration
}

// NodeStats is what one component did over the measurement window.
type NodeStats struct {
	// Served is how many requests this component handled, and Dropped how
	// many it turned away for want of room to queue them.
	Served  int
	Dropped int
	// Utilization is how full the busiest of the component's servers was,
	// averaged over the window: 1 means it never had a free connection.
	//
	// The busiest rather than the average of them, because the average hides
	// exactly the case worth seeing. A database with six replicas serving a
	// write-heavy load has an idle fleet and a saturated primary, and its
	// mean utilization would read as comfortable while every write queued.
	//
	// Zero for a component with no capacity limit. A load balancer and a
	// cache are hops rather than queues — they cannot saturate, so there is
	// nothing here to report and they are never named as a bottleneck.
	Utilization float64
}
