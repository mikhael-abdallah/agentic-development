package sim

import (
	"errors"
	"fmt"
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
		}
		return
	}
	st.waiting = append(st.waiting, req)
}

func (e *engine) startService(st *station, server int, req *request) {
	st.slots[server]++
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
	st.slots[server]--
	e.startWaiting(st)
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
	if res.Completed == 0 {
		return res
	}
	var total time.Duration
	for _, l := range e.latencies {
		total += l
	}
	res.MeanLatency = total / time.Duration(res.Completed)
	return res
}
