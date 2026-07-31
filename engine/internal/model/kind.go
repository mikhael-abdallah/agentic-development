// Package model describes the systems a simulation runs on: the components a
// design is built from, how they connect, and the load offered to them.
//
// It is the bottom of the engine's stack and imports nothing else from this
// repository, so the wire format and the rules for what counts as a valid
// design have exactly one definition. The JSON tags here are the contract the
// HTTP API and the web client both read.
package model

import "slices"

// NodeKind is the type of a component in a design.
type NodeKind string

// The components a design can be built from. The set is closed on purpose: a
// component the simulator does not model is one whose numbers would have to be
// invented, so adding a kind here means teaching sim how it behaves in the
// same change.
const (
	KindClient       NodeKind = "client"
	KindLoadBalancer NodeKind = "loadBalancer"
	KindService      NodeKind = "service"
	KindCache        NodeKind = "cache"
	KindDatabase     NodeKind = "database"
)

// Kinds returns every component kind, in the order a palette should offer
// them: roughly the order a request meets them.
func Kinds() []NodeKind {
	return []NodeKind{
		KindClient,
		KindLoadBalancer,
		KindService,
		KindCache,
		KindDatabase,
	}
}

// Calls returns the kinds a component of this kind may send requests to.
//
// Not every pair of components is a system. A client that opens its own
// connection to a database is not something anyone deploys — what owns the
// data is what talks to it — and a database that calls out is not a database.
// Without this, a design could be drawn that the simulator would happily put
// numbers to, and numbers about a system that cannot exist are worse than a
// refusal: they look like an answer.
//
// The permissive entries are as deliberate as the strict ones. A service may
// call another service, and a load balancer may sit in front of another,
// because tiers behind tiers are ordinary. A cache may fall through to another
// cache for the same reason a near cache sits in front of a remote one.
//
// Mirrored by callsOf/whyNotCall in web/src/lib/topology.ts. The two tables
// have to move together; a rule the canvas does not know refuses an edge only
// after the design has been drawn and run.
func (k NodeKind) Calls() []NodeKind {
	switch k {
	case KindClient:
		return []NodeKind{KindLoadBalancer, KindService}
	case KindLoadBalancer:
		return []NodeKind{KindLoadBalancer, KindService}
	case KindService:
		return []NodeKind{KindLoadBalancer, KindService, KindCache, KindDatabase}
	case KindCache:
		return []NodeKind{KindCache, KindDatabase}
	case KindDatabase:
		return nil
	default:
		return nil
	}
}

// MayCall reports whether a component of kind k may send requests to one of
// kind other.
func (k NodeKind) MayCall(other NodeKind) bool {
	return slices.Contains(k.Calls(), other)
}

// Valid reports whether k is a kind this package knows.
func (k NodeKind) Valid() bool {
	switch k {
	case KindClient, KindLoadBalancer, KindService, KindCache, KindDatabase:
		return true
	default:
		return false
	}
}

// Algorithm is how a load balancer picks among its downstream nodes.
type Algorithm string

// The balancing strategies. They differ only under uneven service times,
// which is exactly when a design's choice of one matters.
const (
	RoundRobin       Algorithm = "roundRobin"
	LeastConnections Algorithm = "leastConnections"
	RandomChoice     Algorithm = "random"
)

// Valid reports whether a is an algorithm this package knows.
func (a Algorithm) Valid() bool {
	switch a {
	case RoundRobin, LeastConnections, RandomChoice:
		return true
	default:
		return false
	}
}
