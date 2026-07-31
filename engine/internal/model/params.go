package model

import (
	"fmt"
	"math"
	"time"
)

// Millis is a duration in milliseconds.
//
// Durations cross the wire as milliseconds rather than Go's nanosecond
// integers, so a scenario file stays readable and a browser can produce one
// without a conversion table. The conversion happens once, at the edge of the
// simulation.
type Millis float64

// Duration converts to the unit the simulation runs in.
func (m Millis) Duration() time.Duration {
	return time.Duration(float64(m) * float64(time.Millisecond))
}

// MillisOf converts back, for results leaving the simulation.
//
// The pair belongs together and belongs here. A transport that did this
// arithmetic itself would be a second place for the unit to be decided, and
// the failure that follows is silent: a latency reported in nanoseconds looks
// exactly like a latency reported in milliseconds by a system a million times
// slower.
func MillisOf(d time.Duration) Millis {
	return Millis(float64(d) / float64(time.Millisecond))
}

// LoadBalancerParams configures a load balancer.
type LoadBalancerParams struct {
	Algorithm Algorithm `json:"algorithm"`
	// Overhead is the latency the balancer itself adds to every request.
	Overhead Millis `json:"overheadMs"`
}

func (p LoadBalancerParams) validate() error {
	if !p.Algorithm.Valid() {
		return fmt.Errorf("%w: algorithm %q is not one of the known strategies",
			ErrParamRange, p.Algorithm)
	}
	if err := nonNegative("overheadMs", float64(p.Overhead)); err != nil {
		return err
	}
	return representable("overheadMs", float64(p.Overhead))
}

// ServiceParams configures a pool of identical application servers.
type ServiceParams struct {
	// Instances is how many requests the pool can serve at once.
	Instances int `json:"instances"`
	// MeanService is the average time one instance spends on a request.
	MeanService Millis `json:"meanServiceMs"`
	// QueueCapacity is how many requests may wait for a free instance.
	// Zero means unbounded: requests queue rather than being rejected, which
	// is the difference between a slow design and a lossy one.
	QueueCapacity int `json:"queueCapacity"`
}

func (p ServiceParams) validate() error {
	if err := atLeastInt("instances", p.Instances, 1); err != nil {
		return err
	}
	if err := aboveZero("meanServiceMs", float64(p.MeanService)); err != nil {
		return err
	}
	if err := representable("meanServiceMs", float64(p.MeanService)); err != nil {
		return err
	}
	return atLeastInt("queueCapacity", p.QueueCapacity, 0)
}

// CacheParams configures a cache in front of a slower store.
type CacheParams struct {
	// HitRatio is the share of reads answered without going downstream. It is
	// the single number that decides how much load a cache actually removes.
	//
	// Reads only. A write is never a hit: it has to reach the store, and a
	// cache that absorbed one would be reporting an acknowledged write that
	// nothing recorded. What a write does instead is WritePolicy's business.
	HitRatio float64 `json:"hitRatio"`
	// HitLatency is what a hit costs. A miss costs this plus whatever the
	// downstream component charges.
	HitLatency Millis `json:"hitLatencyMs"`
	// WritePolicy is which way writes go past this cache.
	WritePolicy WritePolicy `json:"writePolicy"`
}

func (p CacheParams) validate() error {
	if err := fraction("hitRatio", p.HitRatio); err != nil {
		return err
	}
	if err := nonNegative("hitLatencyMs", float64(p.HitLatency)); err != nil {
		return err
	}
	if !p.WritePolicy.Valid() {
		return fmt.Errorf("%w: writePolicy %q", ErrParamRange, p.WritePolicy)
	}
	return representable("hitLatencyMs", float64(p.HitLatency))
}

// DatabaseParams configures a primary with optional read replicas.
type DatabaseParams struct {
	// Replicas serve reads alongside the primary. Zero means the primary
	// serves everything.
	Replicas int `json:"replicas"`
	// MeanRead and MeanWrite are separate because they usually are: a write
	// that fsyncs and replicates is not a read that hits a warm page.
	MeanRead  Millis `json:"meanReadMs"`
	MeanWrite Millis `json:"meanWriteMs"`
	// PoolSize is the concurrent requests one server will handle. It is the
	// cap that turns a fast database into a queue.
	PoolSize int `json:"poolSize"`
}

func (p DatabaseParams) validate() error {
	if err := atLeastInt("replicas", p.Replicas, 0); err != nil {
		return err
	}
	if err := aboveZero("meanReadMs", float64(p.MeanRead)); err != nil {
		return err
	}
	if err := representable("meanReadMs", float64(p.MeanRead)); err != nil {
		return err
	}
	if err := aboveZero("meanWriteMs", float64(p.MeanWrite)); err != nil {
		return err
	}
	if err := representable("meanWriteMs", float64(p.MeanWrite)); err != nil {
		return err
	}
	return atLeastInt("poolSize", p.PoolSize, 1)
}

// Two rules, and the difference between them matters.
//
// A duration the simulation *samples* from must be positive: an exponential
// draw uses 1/mean as its rate, so a mean of zero is a division by zero, and
// an instantaneous server is not a system anyone is designing. Service, read
// and write times are those.
//
// A duration merely *added* to a request may be zero, because zero is a real
// answer there — a balancer that costs nothing measurable, a cache hit served
// from memory. Overhead and hit latency are those.
//
// Getting this backwards would not fail loudly. A zero mean would reach the
// sampler and return NaN or +Inf for every request that touched it.

// maxRepresentableMillis is the longest span a time.Duration can hold.
//
// Beyond it Millis.Duration overflows, and Go leaves an out-of-range
// float-to-integer conversion up to the platform: in practice a large negative
// number. A negative duration is not loudly wrong anywhere downstream. As a
// run length it makes the simulation end before it starts, and the engine
// reports a successful run of nothing; as a service time it schedules
// completions into the past, and the clock walks backwards. Both are answers
// nobody would question, which is what makes the check worth having.
const maxRepresentableMillis = float64(math.MaxInt64) / float64(time.Millisecond)

// representable rejects a duration too long for the clock to express.
//
// The boundary is rejected along with everything past it, because the boundary
// is itself unrepresentable: float64 cannot hold MaxInt64 exactly and rounds it
// up to 2^63, one nanosecond more than a Duration can carry. Verified rather
// than reasoned about — at maxRepresentableMillis the conversion lands on
// -9223372036854775808, and one float step below it lands on a positive
// 9223372036854773760.
func representable(name string, v float64) error {
	if v >= maxRepresentableMillis {
		return fmt.Errorf("%w: %s is %g ms, longer than a simulation clock can express (%g ms)",
			ErrParamRange, name, v, maxRepresentableMillis)
	}
	return nil
}

// finite rejects NaN and the infinities, which the comparisons below let
// through in silence: NaN is neither less than nor greater than anything, so
// every range check treats it as acceptable. JSON cannot carry either, but a
// Go caller can, and a NaN service time turns into a NaN result rather than
// an error anyone can act on.
func finite(name string, v float64) error {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return fmt.Errorf("%w: %s is %v, want a finite number", ErrParamRange, name, v)
	}
	return nil
}

func nonNegative(name string, v float64) error {
	if err := finite(name, v); err != nil {
		return err
	}
	if v < 0 {
		return fmt.Errorf("%w: %s is %g, want at least 0", ErrParamRange, name, v)
	}
	return nil
}

func aboveZero(name string, v float64) error {
	if err := finite(name, v); err != nil {
		return err
	}
	if v <= 0 {
		return fmt.Errorf("%w: %s is %g, want greater than 0", ErrParamRange, name, v)
	}
	return nil
}

func atLeastInt(name string, v, min int) error {
	if v < min {
		return fmt.Errorf("%w: %s is %d, want at least %d", ErrParamRange, name, v, min)
	}
	return nil
}

func fraction(name string, v float64) error {
	if err := finite(name, v); err != nil {
		return err
	}
	if v < 0 || v > 1 {
		return fmt.Errorf("%w: %s is %g, want a fraction in [0, 1]", ErrParamRange, name, v)
	}
	return nil
}
