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
