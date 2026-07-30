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
	// Load balancers, caches and databases follow in later changes.
	ErrUnsupportedKind = errors.New("the simulator does not model this component yet")
	// ErrFanOut is the same kind of refusal: choosing between two downstream
	// components is a load balancer's job, and that is what will lift it.
	ErrFanOut = errors.New("a component sends to more than one other")
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

// station is a component's runtime state: how many requests it can serve at
// once, who is waiting, and where the finished ones go next.
type station struct {
	id       string
	servers  int
	mean     time.Duration
	capacity int    // 0 means an unbounded queue
	next     string // empty means a request completes here
	busy     int
	waiting  []*request
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
	if len(downstream) > 1 {
		return nil, fmt.Errorf("%w: %q sends to %d", ErrFanOut, n.ID, len(downstream))
	}
	next := ""
	if len(downstream) == 1 {
		next = downstream[0]
	}
	switch n.Kind {
	case model.KindService:
		return &station{
			id:       n.ID,
			servers:  n.Service.Instances,
			mean:     n.Service.MeanService.Duration(),
			capacity: n.Service.QueueCapacity,
			next:     next,
		}, nil
	case model.KindClient, model.KindLoadBalancer, model.KindCache, model.KindDatabase:
		return nil, fmt.Errorf("%w: %s (%q)", ErrUnsupportedKind, n.Kind, n.ID)
	}
	return nil, fmt.Errorf("%w: %s (%q)", ErrUnsupportedKind, n.Kind, n.ID)
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
	if st.busy < st.servers {
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
	e.schedule(event{
		at:      e.clock + exponential(e.rng.stream(st.id), st.mean),
		kind:    serviceDone,
		station: st.id,
		req:     req,
	})
}

// finish hands a served request onward and gives the freed server to whoever
// has been waiting longest.
func (e *engine) finish(id string, req *request) {
	st := e.stations[id]
	if st.next == "" {
		e.complete(req)
	} else {
		e.admit(st.next, req)
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
