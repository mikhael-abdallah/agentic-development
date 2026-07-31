package sim

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

// What this core refuses to run. Each is an explicit refusal rather than a
// component quietly doing nothing, because a design that reports numbers while
// ignoring half of itself is the failure this whole repository is built to
// avoid.
//
// Every kind in the model now has behaviour here, so none of these is "not
// implemented yet" any more. They are designs that have no defined answer.
var (
	// ErrNotAStation names a kind that cannot hold a request at all. The
	// client is where load comes from rather than a component load passes
	// through, and newEngine never asks for one — reaching this means the
	// engine and the model disagree about what a component is.
	ErrNotAStation = errors.New("this component cannot hold a request")
	// ErrFanOut refuses a component that sends to several others without being
	// able to choose between them. Choosing is a load balancer's job; anything
	// else with two downstream components has no defined answer for where a
	// request goes, and picking one silently would be an invention.
	ErrFanOut = errors.New("a component sends to more than one other")
	// ErrNoTargets is the opposite mistake: a component that exists to pass
	// requests on, with nothing behind it to pass them to. A balancer would
	// balance nothing and a cache would answer its own misses from a store
	// that is not there — both reporting a broken design as a working one.
	ErrNoTargets = errors.New("a component has nothing behind it")
	// ErrNoEntry catches a design whose load goes nowhere.
	ErrNoEntry = errors.New("the client sends requests nowhere")
)

// arrivalStream names the random source the arrival process draws from. It is
// not a component id, and the two namespaces share a map, so it is spelled to
// be one no design can collide with.
const arrivalStream = "\x00arrivals"

// request is one unit of work moving through the design.
type request struct {
	arrived time.Duration
	// read is drawn here and not yet read by anything: a pool of servers
	// treats both alike. Caches and read replicas are the components that
	// will ask, and drawing it at arrival rather than at the component that
	// needs it keeps a request's identity fixed for its whole journey — it
	// cannot be a read at the cache and a write at the database behind it.
	read bool
}

type engine struct {
	pending  eventQueue
	seq      uint64
	clock    time.Duration
	rng      *streams
	stations map[string]*station
	entry    string

	horizon      time.Duration
	measureFrom  time.Duration
	arrivalMean  time.Duration
	readFraction float64

	result    Result
	latencies []time.Duration
}

// Run simulates the design under the workload.
//
// Both are validated first and the whole run is decided by the workload's
// seed: the same design, the same workload and the same seed produce the same
// Result, which is a test invariant rather than an aspiration.
func Run(t model.Topology, w model.Workload) (Result, error) {
	if err := t.Validate(); err != nil {
		return Result{}, err
	}
	if err := w.Validate(); err != nil {
		return Result{}, err
	}
	e, err := newEngine(t, w)
	if err != nil {
		return Result{}, err
	}
	return e.run(), nil
}

func newEngine(t model.Topology, w model.Workload) (*engine, error) {
	stations := make(map[string]*station, len(t.Nodes))
	for _, n := range t.Nodes {
		if n.Kind == model.KindClient {
			continue
		}
		st, err := newStation(n, t.Downstream(n.ID))
		if err != nil {
			return nil, err
		}
		stations[n.ID] = st
	}

	client, _ := t.Client() // Validate guarantees exactly one
	out := t.Downstream(client.ID)
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: %q has no downstream component", ErrNoEntry, client.ID)
	}
	if len(out) > 1 {
		return nil, fmt.Errorf("%w: %q sends to %d", ErrFanOut, client.ID, len(out))
	}

	horizon := w.Duration.Duration()
	return &engine{
		rng:          newStreams(w.Seed),
		stations:     stations,
		entry:        out[0],
		horizon:      horizon,
		measureFrom:  time.Duration(float64(horizon) * w.WarmupFraction),
		arrivalMean:  time.Duration(float64(time.Second) / w.RateRPS),
		readFraction: w.ReadFraction,
	}, nil
}

// route picks which of a station's downstream components receives a request.
//
// The algorithms differ only when the choices differ — under identical
// service times and an even arrival stream they all spread load the same way.
// The reason a design picks one is what happens when that stops being true,
// so what matters here is that each is faithful about which node it prefers.
func (e *engine) route(st *station) string {
	if len(st.next) == 1 {
		return st.next[0]
	}
	switch st.algorithm {
	case model.RoundRobin:
		next := st.next[st.rotation%len(st.next)]
		st.rotation++
		return next
	case model.LeastConnections:
		// Ties go to the earliest entry rather than to whichever the map
		// happened to yield: with an even load and identical components every
		// choice is a tie, and "the first one" is at least reproducible.
		best, fewest := st.next[0], e.inFlight(st.next[0])
		for _, id := range st.next[1:] {
			if n := e.inFlight(id); n < fewest {
				best, fewest = id, n
			}
		}
		return best
	case model.RandomChoice:
		return st.next[e.rng.stream(st.id).IntN(len(st.next))]
	}
	// Unreachable for the same reason as newStation: Validate accepts only the
	// algorithms above, and the missing default is what makes adding a fourth
	// a build failure rather than a silent fallback to the first node.
	return st.next[0]
}

// inFlight is how many requests a named component is holding.
func (e *engine) inFlight(id string) int {
	return e.stations[id].inFlight()
}

// run drives the clock from event to event until nothing is left to happen.
//
// It keeps going past the arrival horizon on purpose. Stopping at the horizon
// would discard exactly the requests that were still queued — the slow ones —
// and report the survivors as the whole picture.
func (e *engine) run() Result {
	e.scheduleArrival(0)
	for e.pending.Len() > 0 {
		ev := e.next()
		e.clock = ev.at
		switch ev.kind {
		case arrival:
			e.scheduleArrival(ev.at)
			if ev.at >= e.measureFrom {
				e.result.Arrived++
			}
			e.admit(e.entry, ev.req)
		case serviceDone:
			e.finish(ev.station, ev.server, ev.req)
		}
	}
	return e.summarise()
}

// scheduleArrival places the next arrival after the given time, if it still
// falls inside the run. Scheduling one at a time rather than all of them up
// front keeps the heap the size of the work in flight instead of the size of
// the whole run.
func (e *engine) scheduleArrival(after time.Duration) {
	r := e.rng.stream(arrivalStream)
	at := after + exponential(r, e.arrivalMean)
	if at >= e.horizon {
		return
	}
	e.schedule(event{
		at:   at,
		kind: arrival,
		req:  &request{arrived: at, read: r.Float64() < e.readFraction},
	})
}

// admit puts a request into a component: straight onto a server with room for
// it, into the queue, or nowhere at all if the queue is full.
func (e *engine) admit(id string, req *request) {
	st := e.stations[id]
	if server := st.seat(req); server >= 0 {
		e.startService(st, server, req)
		return
	}
	if st.capacity > 0 && len(st.waiting) >= st.capacity {
		if req.arrived >= e.measureFrom {
			e.result.Dropped++
			st.dropped++
		}
		return
	}
	st.waiting = append(st.waiting, req)
}

func (e *engine) startService(st *station, server int, req *request) {
	e.accrue(st)
	st.slots[server]++
	if req.arrived >= e.measureFrom {
		st.served++
	}
	hold := st.hold
	if !req.read {
		hold = st.holdWrite
	}
	if st.sampled {
		hold = exponential(e.rng.stream(st.id), hold)
	}
	e.schedule(event{
		at:      e.clock + hold,
		kind:    serviceDone,
		station: st.id,
		server:  server,
		req:     req,
	})
}

// finish hands a served request onward and gives the freed connection to
// whoever has been waiting for one.
func (e *engine) finish(id string, server int, req *request) {
	st := e.stations[id]
	if len(st.next) == 0 || e.answered(st, req) {
		e.complete(req)
	} else {
		e.admit(e.route(st), req)
	}
	e.accrue(st)
	st.slots[server]--
	e.startWaiting(st)
}

// accrue books the connection-time each of a component's servers has spent
// holding requests since slots last changed.
//
// Integrating on change rather than sampling on a timer costs nothing when
// nothing is happening and is exact when something is: between two changes the
// occupancy is by definition constant.
//
// The interval is clipped to the measurement window at the front — warmup is
// simulated but not reported — and to the arrival horizon at the back. Past
// the horizon the run is only draining what it already accepted, and counting
// that emptying tail would report every component as quieter than it was under
// the load it was actually asked to carry.
func (e *engine) accrue(st *station) {
	from, to := max(st.changed, e.measureFrom), min(e.clock, e.horizon)
	st.changed = e.clock
	if to <= from {
		return
	}
	for i, held := range st.slots {
		st.busy[i] += time.Duration(held) * (to - from)
	}
}

// startWaiting hands the connection just freed to the first request in the
// queue that can use it.
//
// The first that *can*, rather than simply the first. A write waits for the
// primary, and letting one at the head of the queue hold up the reads behind
// it while a replica sits idle would be a queueing policy nobody chose. Where
// every server is interchangeable — which is everything but a database — the
// first that can use it is always the head, and this is plain FIFO.
func (e *engine) startWaiting(st *station) {
	for i, req := range st.waiting {
		if server := st.seat(req); server >= 0 {
			st.waiting = append(st.waiting[:i], st.waiting[i+1:]...)
			e.startService(st, server, req)
			return
		}
	}
}

// answered reports whether the component satisfied the request itself, so
// that nothing behind it ever sees the request.
//
// This is the whole point of putting a cache in a design: not that a hit is
// fast, but that a hit is work the store behind it never does. A cache that
// forwarded everything and merely answered sooner would leave the database
// under exactly the load it started with.
func (e *engine) answered(st *station, req *request) bool {
	if !st.answers {
		return false
	}
	// A write is never a hit. It has to reach the store behind this, and a
	// cache that absorbed one would be reporting an acknowledged write that
	// nothing recorded — which is what the read flag has been carried from
	// arrival for.
	//
	// The draw happens either way, before that is known. It costs one number
	// and it means two runs that differ only in hit ratio, or only in read
	// mix, still line up draw for draw: the same requests meet the same luck,
	// and raising the ratio converts misses to hits rather than rerolling
	// everything. That is the difference between a comparison and a reroll.
	hit := e.rng.stream(st.id).Float64() < st.hitRatio
	return hit && req.read
}

func (e *engine) complete(req *request) {
	if req.arrived < e.measureFrom {
		return
	}
	e.latencies = append(e.latencies, e.clock-req.arrived)
}

func (e *engine) summarise() Result {
	res := e.result
	res.Completed = len(e.latencies)
	// One last booking per component. The loop stopped on the last event,
	// which is somewhere in the drain past the horizon, so without this a
	// component's final stretch of work would never be counted.
	for _, st := range e.stations {
		e.accrue(st)
	}
	window := e.horizon - e.measureFrom
	if window > 0 {
		res.Throughput = float64(res.Completed) / window.Seconds()
	}
	res.Nodes = e.nodeStats(window)
	res.Bottleneck = bottleneck(res.Nodes)
	res.Latency = latencyOf(e.latencies)
	return res
}

// nodeStats reports what each component did, and how close its busiest server
// came to having no room left.
func (e *engine) nodeStats(window time.Duration) map[string]NodeStats {
	nodes := make(map[string]NodeStats, len(e.stations))
	for id, st := range e.stations {
		stats := NodeStats{Served: st.served, Dropped: st.dropped}
		// A component with no pool has no ceiling to be measured against, so
		// there is no utilization to report rather than a utilization of zero.
		if st.pool > 0 && window > 0 {
			capacity := time.Duration(st.pool) * window
			for _, busy := range st.busy {
				if used := float64(busy) / float64(capacity); used > stats.Utilization {
					stats.Utilization = used
				}
			}
		}
		nodes[id] = stats
	}
	return nodes
}

// bottleneck names the component closest to saturated.
//
// Ties are broken by id, which matters more than it looks: two components can
// both sit at a utilization of 1 in an overloaded design, and picking whichever
// the map happened to yield would make the answer change between identical
// runs. A simulator that reports a different bottleneck each time it is asked
// the same question is worse than one that reports none.
func bottleneck(nodes map[string]NodeStats) string {
	worst, highest := "", 0.0
	for id, stats := range nodes {
		if stats.Utilization <= 0 {
			continue
		}
		if stats.Utilization > highest || (stats.Utilization == highest && id < worst) {
			worst, highest = id, stats.Utilization
		}
	}
	return worst
}

// latencyOf summarises a sample of end-to-end times. It sorts in place: the
// caller is the engine, finished with the slice.
func latencyOf(sample []time.Duration) Latency {
	if len(sample) == 0 {
		return Latency{}
	}
	var total time.Duration
	for _, l := range sample {
		total += l
	}
	slices.Sort(sample)
	return Latency{
		Mean: total / time.Duration(len(sample)),
		P50:  percentile(sample, 0.50),
		P95:  percentile(sample, 0.95),
		P99:  percentile(sample, 0.99),
		Max:  sample[len(sample)-1],
	}
}
