package sim

import (
	"errors"
	"fmt"
	"time"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

// What this core cannot simulate yet. Each is an explicit refusal rather than
// a component quietly doing nothing, because a design that reports numbers
// while ignoring half of itself is the failure this whole repository is built
// to avoid.
var (
	// ErrUnsupportedKind names a component whose behaviour has not landed.
	// Caches and databases follow in a later change.
	ErrUnsupportedKind = errors.New("the simulator does not model this component yet")
	// ErrFanOut refuses a component that sends to several others without being
	// able to choose between them. Choosing is a load balancer's job; anything
	// else with two downstream components has no defined answer for where a
	// request goes, and picking one silently would be an invention.
	ErrFanOut = errors.New("a component sends to more than one other")
	// ErrNoTargets is the opposite mistake: a load balancer with nothing
	// behind it. It would answer every request itself, reporting a design that
	// balances nothing as though it worked.
	ErrNoTargets = errors.New("a load balancer has nothing to balance")
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

// station is a component's runtime state: how long it holds a request, how
// many it can hold at once, who is waiting, and where the finished ones go.
//
// There is one station type rather than one per kind, because the differences
// between the components are differences in these numbers. A load balancer is
// a station that holds every request for a fixed moment and never makes one
// wait; a service is a station with a limited number of servers and work it
// draws fresh each time. Encoding that as data keeps newStation the only
// place in the engine that has to know what a NodeKind is.
type station struct {
	id string
	// next is where a served request goes. Empty means it completes here.
	// More than one entry means something has to choose — see route.
	next []string

	// hold is how long the component keeps a request, and sampled says
	// whether that is drawn fresh per request or added as it stands. It is
	// the distinction params.go makes when it requires a service time to be
	// positive and lets an overhead be zero: you cannot draw from a
	// distribution whose mean is nothing, but you can add nothing.
	hold    time.Duration
	sampled bool

	// servers is how many requests the component can hold at once, and
	// capacity how many may wait for a free one. Zero means no limit, in
	// both cases: a load balancer is a hop rather than a queue, so it never
	// turns anything away, and an unbounded queue makes a design slow rather
	// than lossy.
	servers  int
	capacity int

	// algorithm decides which of next receives a request, and rotation is the
	// state round robin keeps between decisions.
	algorithm model.Algorithm
	rotation  int

	busy    int
	waiting []*request
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

func newStation(n model.Node, downstream []string) (*station, error) {
	switch n.Kind {
	case model.KindLoadBalancer:
		if len(downstream) == 0 {
			return nil, fmt.Errorf("%w: %q sends to nothing", ErrNoTargets, n.ID)
		}
		return &station{
			id:        n.ID,
			next:      downstream,
			hold:      n.LoadBalancer.Overhead.Duration(),
			algorithm: n.LoadBalancer.Algorithm,
		}, nil
	case model.KindService:
		if len(downstream) > 1 {
			return nil, fmt.Errorf("%w: %q sends to %d", ErrFanOut, n.ID, len(downstream))
		}
		return &station{
			id:       n.ID,
			next:     downstream,
			hold:     n.Service.MeanService.Duration(),
			sampled:  true,
			servers:  n.Service.Instances,
			capacity: n.Service.QueueCapacity,
		}, nil
	case model.KindClient, model.KindCache, model.KindDatabase:
		return nil, fmt.Errorf("%w: %s (%q)", ErrUnsupportedKind, n.Kind, n.ID)
	}
	// Unreachable: Validate rejects any kind outside the cases above. The
	// switch carries no default so that `exhaustive` fails the build when a
	// kind is added to model without a behaviour being written for it here —
	// a component that silently does nothing is the one outcome this package
	// refuses to produce.
	return nil, fmt.Errorf("%w: %s (%q)", ErrUnsupportedKind, n.Kind, n.ID)
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

// inFlight is how many requests a component is holding — being served and
// waiting to be. It is what "least connections" counts.
func (e *engine) inFlight(id string) int {
	st := e.stations[id]
	return st.busy + len(st.waiting)
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
			e.finish(ev.station, ev.req)
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

// admit puts a request into a component: straight onto a free server, into
// the queue, or nowhere at all if the queue is full.
func (e *engine) admit(id string, req *request) {
	st := e.stations[id]
	if st.servers == 0 || st.busy < st.servers {
		st.busy++
		e.startService(st, req)
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

func (e *engine) startService(st *station, req *request) {
	hold := st.hold
	if st.sampled {
		hold = exponential(e.rng.stream(st.id), st.hold)
	}
	e.schedule(event{
		at:      e.clock + hold,
		kind:    serviceDone,
		station: st.id,
		req:     req,
	})
}

// finish hands a served request onward and gives the freed server to whoever
// has been waiting longest.
func (e *engine) finish(id string, req *request) {
	st := e.stations[id]
	if len(st.next) == 0 {
		e.complete(req)
	} else {
		e.admit(e.route(st), req)
	}
	if len(st.waiting) == 0 {
		st.busy--
		return
	}
	waiting := st.waiting[0]
	st.waiting = st.waiting[1:]
	e.startService(st, waiting)
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
