package sim

import (
	"fmt"
	"time"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

// station is a component's runtime state: how long it holds a request, how
// many it can hold at once, who is waiting, and where the finished ones go.
//
// There is one station type rather than one per kind, because the differences
// between the components are differences in these numbers. A load balancer is
// a station that holds every request for a fixed moment and never makes one
// wait; a service is a station whose work is drawn fresh each time; a database
// is one whose servers are not interchangeable. Encoding that as data keeps
// the constructors below the only place in the engine that has to know what a
// NodeKind is.
type station struct {
	id string
	// next is where a served request goes. Empty means it completes here.
	// More than one entry means something has to choose — see route.
	next []string

	// hold is how long the component keeps a request and holdWrite what it
	// costs when the request is a write; sampled says whether that time is
	// drawn fresh per request or added as it stands.
	//
	// The two hold times are equal for everything but a database, where a
	// write that fsyncs and replicates is not a read that hits a warm page.
	// Drawn against added is the distinction params.go makes when it requires
	// a service time to be positive and lets an overhead be zero: you cannot
	// draw from a distribution whose mean is nothing, but you can add nothing.
	hold      time.Duration
	holdWrite time.Duration
	sampled   bool

	// slots[i] is how many requests server i is holding, and pool how many it
	// can hold. Index 0 is the primary — for a database the only server a
	// write can use, and for everything else the only server there is.
	//
	// A pool of zero means no limit. A load balancer and a cache are hops
	// rather than queues, so they never make anything wait.
	slots []int
	pool  int

	// capacity is how many requests may wait for a free slot. Zero means
	// unbounded, which makes a design slow rather than lossy.
	capacity int
	waiting  []*request

	// What this component did, for the report at the end.
	//
	// busy[i] is connection-time: how long server i spent holding requests,
	// counting a server holding three of its connections as three times as
	// busy as one holding a single connection. Divided by what it could have
	// held for the whole window, that is its utilization. changed is when
	// slots was last touched, which is what makes the integral possible
	// without visiting every station on every event.
	busy    []time.Duration
	changed time.Duration
	served  int
	dropped int

	// algorithm decides which of next receives a request, and rotation is the
	// state round robin keeps between decisions.
	algorithm model.Algorithm
	rotation  int

	// answers is whether the component can satisfy a request itself instead
	// of passing it on, and hitRatio how often it manages to. A cache is the
	// only component that can; everything else forwards, or is the end of the
	// line because nothing is behind it.
	answers  bool
	hitRatio float64
	// absorbsWrit is write-back: the cache acknowledges a write and the store
	// catches up outside the request. The request stops here, so the store
	// never sees it inside the measured window — which is the whole effect
	// the policy is chosen for, and the whole risk it takes.
	absorbsWrit bool
}

func newStation(n model.Node, downstream []string) (*station, error) {
	switch n.Kind {
	case model.KindLoadBalancer:
		return newBalancer(n, downstream)
	case model.KindService:
		return newService(n, downstream)
	case model.KindCache:
		return newCache(n, downstream)
	case model.KindDatabase:
		return newDatabase(n, downstream)
	case model.KindClient:
		return nil, fmt.Errorf("%w: %s (%q)", ErrNotAStation, n.Kind, n.ID)
	}
	// Unreachable: Validate rejects any kind outside the cases above. The
	// switch carries no default so that `exhaustive` fails the build when a
	// kind is added to model without a behaviour being written for it here —
	// a component that silently does nothing is the one outcome this package
	// refuses to produce.
	return nil, fmt.Errorf("%w: %s (%q)", ErrNotAStation, n.Kind, n.ID)
}

func newBalancer(n model.Node, downstream []string) (*station, error) {
	if len(downstream) == 0 {
		return nil, fmt.Errorf("%w: %q sends to nothing", ErrNoTargets, n.ID)
	}
	overhead := n.LoadBalancer.Overhead.Duration()
	return &station{
		id:        n.ID,
		next:      downstream,
		hold:      overhead,
		holdWrite: overhead,
		slots:     make([]int, 1),
		busy:      make([]time.Duration, 1),
		algorithm: n.LoadBalancer.Algorithm,
	}, nil
}

func newService(n model.Node, downstream []string) (*station, error) {
	if len(downstream) > 1 {
		return nil, fmt.Errorf("%w: %q sends to %d", ErrFanOut, n.ID, len(downstream))
	}
	// One server holding Instances requests at a time, rather than Instances
	// servers holding one each. The two are the same queue — a pool of
	// identical instances has nothing to choose between them — and saying it
	// this way lets a database, whose servers are not identical, use the same
	// admission rule.
	mean := n.Service.MeanService.Duration()
	return &station{
		id:        n.ID,
		next:      downstream,
		hold:      mean,
		holdWrite: mean,
		sampled:   true,
		slots:     make([]int, 1),
		busy:      make([]time.Duration, 1),
		pool:      n.Service.Instances,
		capacity:  n.Service.QueueCapacity,
	}, nil
}

func newCache(n model.Node, downstream []string) (*station, error) {
	// A cache is a lookup, not a queue: it holds every request for the same
	// moment and holds none of them back. What it decides is not how long a
	// request waits but whether the request goes any further.
	if len(downstream) == 0 {
		return nil, fmt.Errorf("%w: %q sends to nothing", ErrNoTargets, n.ID)
	}
	if len(downstream) > 1 {
		return nil, fmt.Errorf("%w: %q sends to %d", ErrFanOut, n.ID, len(downstream))
	}
	lookup := n.Cache.HitLatency.Duration()
	// What a write costs here, and whether it goes on. Write-around does not
	// consult the cache at all, so it costs nothing on the way past;
	// write-through and write-back both touch it and pay the lookup.
	policy := n.Cache.WritePolicy.OrDefault()
	write := lookup
	if policy == model.WriteAround {
		write = 0
	}
	return &station{
		id:          n.ID,
		next:        downstream,
		hold:        lookup,
		holdWrite:   write,
		slots:       make([]int, 1),
		busy:        make([]time.Duration, 1),
		answers:     true,
		hitRatio:    n.Cache.HitRatio,
		absorbsWrit: policy == model.WriteBack,
	}, nil
}

func newDatabase(n model.Node, downstream []string) (*station, error) {
	if len(downstream) > 1 {
		return nil, fmt.Errorf("%w: %q sends to %d", ErrFanOut, n.ID, len(downstream))
	}
	// A primary and its read replicas, each with its own pool of connections.
	// Replicas is how many servers there are besides the primary, so a
	// database with none is a single server — which is what params.go means by
	// "zero means the primary serves everything".
	return &station{
		id:        n.ID,
		next:      downstream,
		hold:      n.Database.MeanRead.Duration(),
		holdWrite: n.Database.MeanWrite.Duration(),
		sampled:   true,
		slots:     make([]int, 1+n.Database.Replicas),
		busy:      make([]time.Duration, 1+n.Database.Replicas),
		pool:      n.Database.PoolSize,
	}, nil
}

// seat picks which of the component's servers takes the request, or -1 when
// every one of them is full.
//
// A write can only go to the primary. Replicas serve reads; a design that let
// a write land on one would be reporting a system where a write is
// acknowledged by a machine that cannot accept it. For every component that is
// not a database there is only the primary, so the rule costs nothing there:
// a service's instances all live in slot 0.
//
// A read prefers a replica and falls back to the primary, which is what
// "replicas serve reads alongside the primary" has to mean if the primary is
// not to become the bottleneck the replicas were added to remove. The scan
// runs backwards so that a tie — every server equally loaded, which is the
// normal state under even load — goes to a replica rather than to the primary,
// leaving the primary's connections for the writes that have nowhere else to
// go.
func (st *station) seat(req *request) int {
	if st.pool == 0 {
		return 0
	}
	if !req.read() {
		if st.slots[0] < st.pool {
			return 0
		}
		return -1
	}
	server, fewest := -1, st.pool
	for i := len(st.slots) - 1; i >= 0; i-- {
		if st.slots[i] < fewest {
			server, fewest = i, st.slots[i]
		}
	}
	return server
}

// inFlight is how many requests the component is holding — being served and
// waiting to be. It is what "least connections" counts.
func (st *station) inFlight() int {
	held := len(st.waiting)
	for _, n := range st.slots {
		held += n
	}
	return held
}
