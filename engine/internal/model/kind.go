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

// WritePolicy is which way a write goes past a cache.
//
// A read is the case a cache exists for and the hit ratio settles it. A write
// cannot be answered from a cache — the store has to record it — so the only
// question left is what the cache does on the way, and that is a design
// decision with three ordinary answers. They are not shades of the same thing:
// they put different load on the store and give the caller different answers
// about when a write is done.
type WritePolicy string

const (
	// WriteThrough sends the write to the store and keeps the cache current
	// on the way. The caller waits for both. The cache stays warm, and this
	// is what a cache does unless someone decided otherwise.
	WriteThrough WritePolicy = "writeThrough"
	// WriteAround sends the write straight to the store, leaving the cache
	// alone. Writes are cheaper by whatever the cache would have cost, and
	// the entry that was there is now wrong.
	//
	// What this model cannot show is the consequence: a hit ratio is not a
	// key space, so there is no entry to go stale and no read that could
	// return the old value. The saving is simulated; the risk is not.
	WriteAround WritePolicy = "writeAround"
	// WriteBack acknowledges the write at the cache and lets the store catch
	// up afterwards. The caller waits for the cache alone, and the store
	// never sees the write inside the measured window — which is why a design
	// that switches to it appears to make its database write load vanish.
	//
	// It is the one policy whose cost this simulator does not measure. A cache
	// holding writes the store has not taken is a window in which a crash
	// loses acknowledged data, and nothing here models a crash.
	WriteBack WritePolicy = "writeBack"
)

// WritePolicies returns every policy, in the order a form should offer them:
// the safe default first, then the two that trade something for speed.
func WritePolicies() []WritePolicy {
	return []WritePolicy{WriteThrough, WriteAround, WriteBack}
}

// Valid reports whether p is a policy this package knows, counting the empty
// value — see [WritePolicy.OrDefault] for why that is not a hole.
func (p WritePolicy) Valid() bool {
	switch p {
	case "", WriteThrough, WriteAround, WriteBack:
		return true
	default:
		return false
	}
}

// OrDefault reads an absent policy as write-through.
//
// Every design drawn or saved before this field existed carries none, and
// write-through is what all of them did: the write went to the store and the
// cache was consulted on the way. Reading the zero value as the behaviour it
// already had is what lets a design saved yesterday still open today, and
// what keeps this from being a change to what an old scenario means.
func (p WritePolicy) OrDefault() WritePolicy {
	if p == "" {
		return WriteThrough
	}
	return p
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
