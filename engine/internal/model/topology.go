package model

import "fmt"

// Node is one component in a design.
//
// The parameter fields are a union: exactly the one naming Kind is set, and
// the rest are nil. A single flat parameter struct would be shorter, but it
// would also accept a cache with a connection pool or a database with a hit
// ratio — values the simulator would ignore in silence, which is how a design
// comes to mean something other than what it looks like. A client carries no
// parameters at all: the load it offers is the Workload, not a property of
// the component.
type Node struct {
	ID   string   `json:"id"`
	Kind NodeKind `json:"kind"`
	// Label is what the canvas shows. It has no effect on the simulation.
	Label string `json:"label,omitempty"`

	LoadBalancer *LoadBalancerParams `json:"loadBalancer,omitempty"`
	Service      *ServiceParams      `json:"service,omitempty"`
	Cache        *CacheParams        `json:"cache,omitempty"`
	Database     *DatabaseParams     `json:"database,omitempty"`
}

// Edge is a directed dependency: From sends requests to To.
type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
	// Transport names what carries requests along this connection — "HTTP/1.1",
	// "gRPC", "a queue".
	//
	// It has no effect on the simulation, and that is stated rather than
	// hidden. The alternative was a list of protocols with a latency for each,
	// and this engine has no honest source for those numbers: what gRPC costs
	// against HTTP depends on the payload, the language, the proxy in between
	// and the machine, and a built-in table of plausible figures would be an
	// invention every result then rested on. PerCall below is where a number
	// that moves the answer goes, and it is the user's number.
	//
	// A design is also a thing you show people, and "this hop is gRPC" is worth
	// writing down. Node.Label has exactly this status and says so in its own
	// documentation.
	Transport string `json:"transport,omitempty"`
	// PerCall is what this connection adds to every request that crosses it.
	//
	// Added rather than drawn, so zero is a real answer: a connection inside
	// one datacentre may well cost nothing this simulation can measure. It is
	// time in flight and occupies neither component — a request crossing a slow
	// link is not holding a server at either end, and charging it to one would
	// report a component as busy for work it was not doing.
	PerCall Millis `json:"perCallMs,omitempty"`
}

// link is an edge's two endpoints, without what is written on it.
//
// The duplicate check below is about the connection rather than its properties:
// `a → b` twice is one connection written twice, whatever transport each copy
// names. Comparing whole Edge values got that right only while an edge had
// exactly two fields, and would have started quietly accepting a duplicate the
// moment a third arrived.
type link struct{ from, to string }

func (e Edge) link() link { return link{from: e.From, to: e.To} }

func (e Edge) validate() error {
	if err := nonNegative("perCallMs of "+e.From+" to "+e.To, float64(e.PerCall)); err != nil {
		return err
	}
	return representable("perCallMs of "+e.From+" to "+e.To, float64(e.PerCall))
}

// Topology is a design: the components and how requests flow between them.
type Topology struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

// Node returns the component with the given id.
func (t Topology) Node(id string) (Node, bool) {
	for _, n := range t.Nodes {
		if n.ID == id {
			return n, true
		}
	}
	return Node{}, false
}

// Client returns the single entry point of the design. Validate guarantees
// there is exactly one; on an unvalidated topology the second return reports
// whether one was found.
func (t Topology) Client() (Node, bool) {
	for _, n := range t.Nodes {
		if n.Kind == KindClient {
			return n, true
		}
	}
	return Node{}, false
}

// Downstream returns the ids a component sends requests to, in edge order.
func (t Topology) Downstream(id string) []string {
	out := make([]string, 0, len(t.Edges))
	for _, e := range t.Edges {
		if e.From == id {
			out = append(out, e.To)
		}
	}
	return out
}

// HopsFrom is what each connection out of this component adds to a request
// crossing it, keyed by where it goes.
//
// Beside Downstream rather than folded into it, because they answer different
// questions and only one of them is needed to decide where a request goes. The
// map is nil when nothing leaves this component, and a nil map reads as zero —
// so a design where no connection costs anything asks for nothing extra.
func (t Topology) HopsFrom(id string) map[string]Millis {
	var hops map[string]Millis
	for _, e := range t.Edges {
		if e.From != id || e.PerCall == 0 {
			continue
		}
		if hops == nil {
			hops = make(map[string]Millis, len(t.Edges))
		}
		hops[e.To] = e.PerCall
	}
	return hops
}

// paramBlock pairs a kind with whether this node carries its parameters.
type paramBlock struct {
	kind NodeKind
	set  bool
}

// paramBlocks lists the union's members in a fixed order. A map would read
// more naturally and iterate at random, which would make the error a node with
// two problems reports depend on the run — the one thing this engine promises
// not to do.
func (n Node) paramBlocks() []paramBlock {
	return []paramBlock{
		{KindLoadBalancer, n.LoadBalancer != nil},
		{KindService, n.Service != nil},
		{KindCache, n.Cache != nil},
		{KindDatabase, n.Database != nil},
	}
}

// checkParamsMatchKind reports a parameter block that is missing for this
// node's kind, or present for another.
func (n Node) checkParamsMatchKind() error {
	for _, b := range n.paramBlocks() {
		switch {
		case b.kind == n.Kind && !b.set:
			return fmt.Errorf("%w: %s node %q carries no %s parameters",
				ErrParamsMismatch, n.Kind, n.ID, b.kind)
		case b.kind != n.Kind && b.set:
			return fmt.Errorf("%w: %s node %q also carries %s parameters",
				ErrParamsMismatch, n.Kind, n.ID, b.kind)
		}
	}
	return nil
}

// validate checks one component in isolation: its kind is known, its
// parameters are the ones that kind takes, and their values are usable.
func (n Node) validate() error {
	if !n.Kind.Valid() {
		return fmt.Errorf("%w: node %q has kind %q", ErrUnknownKind, n.ID, n.Kind)
	}
	if err := n.checkParamsMatchKind(); err != nil {
		return err
	}
	switch n.Kind {
	case KindClient:
		return nil
	case KindLoadBalancer:
		return n.LoadBalancer.validate()
	case KindService:
		return n.Service.validate()
	case KindCache:
		return n.Cache.validate()
	case KindDatabase:
		return n.Database.validate()
	}
	// Unreachable: Kind.Valid() above accepts exactly the cases listed here.
	// The switch carries no default so that `exhaustive` fails the build if a
	// new kind is added to one list and not the other, rather than letting the
	// new component validate itself by doing nothing.
	return nil
}
