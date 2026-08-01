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

// Endpoint is one thing a service can be asked to do, and what that costs it.
//
// A service is not equally fast at everything it serves. Looking a short code
// up in a cache and writing a new one are the same pool of servers doing two
// jobs whose costs are nothing like each other, and a design that averaged
// them into one number would put the same load on the pool whichever way the
// traffic went — which is the question anyone drawing this wants to ask.
//
// Two fields where one might do, and the separation is the point. Name is what
// a person calls it, "GET /{code}", and is the API being designed. Operation
// is which of the workload's traffic arrives here. They are different facts:
// an API's shape does not change when the traffic mix does.
type Endpoint struct {
	Name string `json:"name"`
	// Operation names an operation in the workload. An endpoint for traffic
	// this run does not offer is not an error — an API has more endpoints than
	// any one load exercises — it simply never fires.
	Operation string `json:"operation"`
	// MeanService replaces the service's own mean for this operation.
	MeanService Millis `json:"meanServiceMs"`
}

func (e Endpoint) validate() error {
	if e.Name == "" {
		return fmt.Errorf("%w: an endpoint has no name", ErrParamRange)
	}
	if e.Operation == "" {
		return fmt.Errorf("%w: endpoint %q does not say which operation it serves",
			ErrParamRange, e.Name)
	}
	if err := aboveZero("meanServiceMs of "+e.Name, float64(e.MeanService)); err != nil {
		return err
	}
	return representable("meanServiceMs of "+e.Name, float64(e.MeanService))
}

// ServiceParams configures a pool of identical application servers.
type ServiceParams struct {
	// Instances is how many requests the pool can serve at once.
	Instances int `json:"instances"`
	// MeanService is the average time one instance spends on a request.
	//
	// What every operation costs unless an endpoint below says otherwise. It
	// stays required with endpoints present, so that traffic the API does not
	// describe still has a cost rather than being free.
	MeanService Millis `json:"meanServiceMs"`
	// QueueCapacity is how many requests may wait for a free instance.
	// Zero means unbounded: requests queue rather than being rejected, which
	// is the difference between a slow design and a lossy one.
	QueueCapacity int `json:"queueCapacity"`
	// Endpoints is the API this service exposes, and what each call costs.
	//
	// Sparse, and deliberately so. A service with none behaves exactly as one
	// did before they existed, and adding one can never make a component
	// invalid — there is always a mean to fall back to. Omitted from the wire
	// when empty, so a design that does not describe its API does not carry an
	// empty list saying it has none.
	Endpoints []Endpoint `json:"endpoints,omitempty"`
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
	if err := atLeastInt("queueCapacity", p.QueueCapacity, 0); err != nil {
		return err
	}
	return p.validateEndpoints()
}

// validateEndpoints checks that the API says each thing once.
//
// Names unique because two endpoints with one name are one endpoint as far as
// anything reading the design is concerned. Operations unique because two
// endpoints claiming the same traffic have no answer for what that traffic
// costs, and picking the first would be an invention.
func (p ServiceParams) validateEndpoints() error {
	named := make(map[string]bool, len(p.Endpoints))
	serving := make(map[string]string, len(p.Endpoints))
	for _, e := range p.Endpoints {
		if err := e.validate(); err != nil {
			return err
		}
		if named[e.Name] {
			return fmt.Errorf("%w: two endpoints are called %q", ErrParamRange, e.Name)
		}
		named[e.Name] = true
		if other, taken := serving[e.Operation]; taken {
			return fmt.Errorf("%w: %q and %q both serve %q, so what it costs has no answer",
				ErrParamRange, other, e.Name, e.Operation)
		}
		serving[e.Operation] = e.Name
	}
	return nil
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
