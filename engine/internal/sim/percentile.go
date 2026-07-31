package sim

import (
	"math"
	"time"
)

// percentile returns the qth percentile of an already-sorted sample.
//
// Nearest-rank: the smallest observed value at or below which at least q of
// the sample falls. It returns a latency some request actually had, rather
// than interpolating between two neighbours to produce a number nothing
// experienced — which for a tail statistic is the point. A p99 of 412ms
// should mean a request took 412ms, not that one took 380ms and another 450ms.
//
// An empty sample has no percentiles and reports zero. That is a real answer
// here: a run that completed nothing has no latencies, and the caller can
// tell the difference from Completed.
func percentile(sorted []time.Duration, q float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	rank := int(math.Ceil(q * float64(len(sorted))))
	if rank < 1 {
		rank = 1
	}
	if rank > len(sorted) {
		rank = len(sorted)
	}
	return sorted[rank-1]
}
