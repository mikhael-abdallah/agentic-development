package sim

import (
	"container/heap"
	"time"
)

// eventKind is what the loop should do when an event fires.
type eventKind int

const (
	// arrival: a request enters the system at its first component.
	arrival eventKind = iota
	// serviceDone: a component has finished with a request and hands it on.
	serviceDone
	// inTransit: a request is crossing a connection that costs something, and
	// arrives at the far end when this fires. It holds no server at either
	// end — which is the whole reason it is an event rather than time added to
	// a hold.
	inTransit
)

// event is something that happens at a point in simulated time.
type event struct {
	at   time.Duration
	seq  uint64
	kind eventKind
	// station is where the event happens; empty for an arrival, which has not
	// reached a component yet. server is which of that component's servers is
	// holding the request, so that finishing gives the connection back to the
	// one that lent it — a read served by a replica must not free a slot on
	// the primary.
	station string
	server  int
	req     *request
}

// eventQueue orders pending events by when they happen.
//
// The seq tie-break is load-bearing rather than tidy. Two events can land on
// the same simulated instant — an arrival and a completion at the same
// microsecond is ordinary once the clock is discrete — and a heap left to
// order those by whatever the sift happened to do would fire them in an order
// that depends on the shape of the heap, not on the run. That produces a
// simulator which is deterministic most of the time, which is worse than one
// that is never deterministic: the tests pass, and the results move.
//
// seq is assigned in the order events are scheduled, so ties resolve to
// "whichever was created first" — stable across runs with the same seed, and
// independent of how the heap is laid out.
type eventQueue []event

func (q eventQueue) Len() int { return len(q) }

func (q eventQueue) Less(i, j int) bool {
	if q[i].at != q[j].at {
		return q[i].at < q[j].at
	}
	return q[i].seq < q[j].seq
}

func (q eventQueue) Swap(i, j int) { q[i], q[j] = q[j], q[i] }

func (q *eventQueue) Push(x any) { *q = append(*q, x.(event)) }

func (q *eventQueue) Pop() any {
	old := *q
	last := old[len(old)-1]
	*q = old[:len(old)-1]
	return last
}

// schedule adds an event, stamping it with the next sequence number.
func (e *engine) schedule(ev event) {
	ev.seq = e.seq
	e.seq++
	heap.Push(&e.pending, ev)
}

// next removes and returns the earliest pending event.
func (e *engine) next() event {
	return heap.Pop(&e.pending).(event)
}
