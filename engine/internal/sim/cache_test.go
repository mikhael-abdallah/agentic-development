package sim_test

import (
	"errors"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

// cached is a client, a service, a cache, and one slow store behind it.
//
// The store was a service when this was written, on the grounds that what a
// cache does to the thing behind it does not depend on which it is. It is a
// database now because a cache does not call a service — the model says so
// since designs gained rules about which kinds may call which — and because a
// store behind a cache is a database in every design anyone draws. Reads and
// writes cost the same here so the substitution changes no measurement: a
// single connection serves them, as a single instance did.
func cached(ratio float64, hitLatency, storeMean model.Millis) model.Topology {
	return cachedWith(ratio, hitLatency, storeMean, "")
}

// cachedWith is cached with a write policy named. The empty policy is what
// every design written before the field existed carries, and it has to keep
// meaning write-through.
func cachedWith(
	ratio float64,
	hitLatency, storeMean model.Millis,
	policy model.WritePolicy,
) model.Topology {
	return model.Topology{
		Nodes: []model.Node{
			{ID: "client", Kind: model.KindClient},
			frontend(),
			{ID: "cache", Kind: model.KindCache, Cache: &model.CacheParams{
				HitRatio:    ratio,
				HitLatency:  hitLatency,
				WritePolicy: policy,
			}},
			{ID: "store", Kind: model.KindDatabase, Database: &model.DatabaseParams{
				Replicas:  0,
				MeanRead:  storeMean,
				MeanWrite: storeMean,
				PoolSize:  1,
			}},
		},
		Edges: []model.Edge{
			{From: "client", To: "front"},
			{From: "front", To: "cache"},
			{From: "cache", To: "store"},
		},
	}
}

// reads is a workload of nothing but reads; writes is the opposite.
func reads(rate float64, seed uint64) model.Workload {
	w := load(rate, seed)
	w.ReadFraction = 1
	return w
}

func writes(rate float64, seed uint64) model.Workload {
	w := load(rate, seed)
	w.ReadFraction = 0
	return w
}

// A cache that answers everything answers everything: nothing reaches the
// store, and no queue ever forms behind it.
//
// This used to assert that mean latency was exactly the hit latency, on the
// grounds that a hit is added rather than drawn, so any other number meant
// something had got through. That equality is gone — a design needs a service
// between its client and its cache, and a service time is drawn — so the claim
// is made directly instead, against the store's own counter. Directly is
// better: it says what the test is about rather than inferring it from a
// number that would also move if anything else changed.
func TestEverythingHitMeansNothingReachesTheStore(t *testing.T) {
	t.Parallel()
	const hitLatency model.Millis = 2
	// A store slow enough to collapse under this load if it ever saw it.
	res, err := sim.Run(cached(1, hitLatency, 100), reads(200, 21))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if served := res.Nodes["store"].Served; served != 0 {
		t.Errorf("the store served %d requests with every read a hit, want none", served)
	}
	// And still paced by the lookup rather than by the store: the front-end
	// hop averages a thousandth of a millisecond, the store a hundred.
	if res.Latency.Mean > (hitLatency + 1).Duration() {
		t.Errorf("mean latency = %v with every read a hit, want about the %v lookup",
			res.Latency.Mean, hitLatency.Duration())
	}
	if res.Completed != res.Arrived {
		t.Errorf("completed %d of %d arrivals: something queued behind the store",
			res.Completed, res.Arrived)
	}
}

// The same cache, the same ratio, and not one hit — because a write cannot be
// answered from a cache. A design that let one through would be acknowledging
// a write that nothing recorded.
func TestAWriteIsNeverAHit(t *testing.T) {
	t.Parallel()
	const hitLatency model.Millis = 2
	hits, err := sim.Run(cached(1, hitLatency, 5), writes(100, 22))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	misses, err := sim.Run(cached(0, hitLatency, 5), writes(100, 22))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if !same(hits, misses) {
		t.Errorf("a hit ratio of 1 changed a write-only run:\n got %+v\nwant %+v", hits, misses)
	}
	if hits.Latency.Mean <= hitLatency.Duration() {
		t.Errorf("mean latency %v never exceeded the lookup: the writes did not reach the store",
			hits.Latency.Mean)
	}
}

// A cache that never hits is a delay in front of the store and nothing else.
// Charging more for the lookup shifts every latency by exactly that much and
// changes nothing else — same arrivals, same draws, same order, same drops —
// because the lookup is added rather than drawn and the cache holds no request
// back. Anything approximate here would be the cache queueing or reordering.
//
// Both runs use the same design with the same component names on purpose. A
// component's random stream is derived from its id, so comparing a design
// against a differently-named one compares two different sets of draws and
// proves nothing.
func TestAMissCostsTheLookupAndNothingMore(t *testing.T) {
	t.Parallel()
	const lookup model.Millis = 3
	free, err := sim.Run(cached(0, 0, 5), reads(120, 23))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	charged, err := sim.Run(cached(0, lookup, 5), reads(120, 23))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if got := charged.Latency.Mean - free.Latency.Mean; got != lookup.Duration() {
		t.Errorf("a %v lookup moved mean latency by %v", lookup.Duration(), got)
	}
	if charged.Arrived != free.Arrived || charged.Dropped != free.Dropped ||
		charged.Completed != free.Completed {
		t.Errorf("the lookup changed what happened, not just when: %+v against %+v",
			charged, free)
	}
}

// The reason a cache is in the design. The store is loaded past what it can
// serve; every point of hit ratio is load it never sees. Latency has to fall
// the whole way, not merely end lower.
func TestRaisingTheHitRatioTakesLoadOffTheStore(t *testing.T) {
	t.Parallel()
	previous := -1
	for _, ratio := range []float64{0, 0.25, 0.5, 0.75, 0.9} {
		res, err := sim.Run(cached(ratio, 1, 20), reads(60, 24))
		if err != nil {
			t.Fatalf("Run() at hit ratio %g: %v", ratio, err)
		}
		latency := int(res.Latency.Mean)
		if previous >= 0 && latency >= previous {
			t.Errorf("hit ratio %g gave mean latency %v, no better than the ratio below it",
				ratio, res.Latency.Mean)
		}
		previous = latency
	}
}

// A cache with nothing behind it would answer its own misses out of a store
// that is not there.
func TestACacheInFrontOfNothingIsRefused(t *testing.T) {
	t.Parallel()
	design := model.Topology{
		Nodes: []model.Node{
			{ID: "client", Kind: model.KindClient},
			frontend(),
			{ID: "cache", Kind: model.KindCache, Cache: &model.CacheParams{
				HitRatio: 0.9, HitLatency: 1,
			}},
		},
		Edges: []model.Edge{{From: "client", To: "front"}, {From: "front", To: "cache"}},
	}
	if _, err := sim.Run(design, load(100, 1)); !errors.Is(err, sim.ErrNoTargets) {
		t.Errorf("Run() on a cache with nothing behind it = %v, want ErrNoTargets", err)
	}
}

// The hit draw is a new source of randomness, so it is a new way for a run to
// stop reproducing itself.
func TestACachedDesignStillRepeats(t *testing.T) {
	t.Parallel()
	design := cached(0.6, 1, 12)
	first, err := sim.Run(design, load(150, 25))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	for i := range 3 {
		again, err := sim.Run(design, load(150, 25))
		if err != nil {
			t.Fatalf("Run() unexpected error on repeat %d: %v", i, err)
		}
		if !same(again, first) {
			t.Fatalf("repeat %d differed:\n got %+v\nwant %+v", i, again, first)
		}
	}
}

// The three write policies, told apart by the two things a policy actually
// changes: what the store is asked to do, and what the caller waits for.
//
// Every case runs the same design under the same seed, so the only difference
// between them is the policy. That is also why the hit-ratio draw happens for
// writes as well as reads — without it, changing the policy would shift every
// later draw and these would not be comparable.
func TestWritePoliciesDifferInWhatTheStoreSees(t *testing.T) {
	t.Parallel()
	const lookup model.Millis = 2
	const store model.Millis = 40

	tests := []struct {
		name       string
		policy     model.WritePolicy
		storeSees  bool
		waitsOnCch bool
	}{
		{"write-through sends it on and pays the lookup", model.WriteThrough, true, true},
		{"write-around sends it on without touching the cache", model.WriteAround, true, false},
		{"write-back answers at the cache and the store never sees it", model.WriteBack, false, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			res, err := sim.Run(cachedWith(0.9, lookup, store, tt.policy), writes(20, 7))
			if err != nil {
				t.Fatalf("Run() unexpected error: %v", err)
			}
			served := res.Nodes["store"].Served
			if tt.storeSees != (served > 0) {
				t.Errorf("the store served %d writes, want storeSees=%v", served, tt.storeSees)
			}
			// A request that never reaches a 40ms store costs about the 2ms
			// lookup; one that does costs both. The threshold is between them
			// rather than at either, so it does not depend on the draw.
			cheap := res.Latency.Mean < (lookup + store/2).Duration()
			if cheap != !tt.storeSees {
				t.Errorf("mean latency %v with the store %s",
					res.Latency.Mean, map[bool]string{true: "in the path", false: "out of it"}[tt.storeSees])
			}
		})
	}
}

// The saving write-around is chosen for, stated as the comparison someone
// would actually make: the same writes, the same store, one policy consulting
// the cache on the way past and the other not.
func TestWriteAroundIsCheaperThanWriteThrough(t *testing.T) {
	t.Parallel()
	const lookup model.Millis = 5
	through, err := sim.Run(cachedWith(0.9, lookup, 10, model.WriteThrough), writes(20, 11))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	around, err := sim.Run(cachedWith(0.9, lookup, 10, model.WriteAround), writes(20, 11))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if around.Latency.Mean >= through.Latency.Mean {
		t.Errorf("write-around mean %v, write-through mean %v: expected the cheaper one to be cheaper",
			around.Latency.Mean, through.Latency.Mean)
	}
	// Both still reach the store: skipping the cache is not skipping the write.
	if around.Nodes["store"].Served == 0 {
		t.Error("write-around lost the writes: the store served none of them")
	}
}

// An absent policy is what every design saved before the field existed
// carries. It has to keep meaning what those designs already did, or opening
// one changes its answer without anyone touching it.
func TestAnAbsentWritePolicyIsWriteThrough(t *testing.T) {
	t.Parallel()
	absent, err := sim.Run(cachedWith(0.9, 3, 12, ""), writes(30, 5))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	named, err := sim.Run(cachedWith(0.9, 3, 12, model.WriteThrough), writes(30, 5))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if !same(absent, named) {
		t.Errorf("a design with no write policy ran differently from write-through:\n %+v\n %+v",
			absent, named)
	}
}

// Reads are the cache's own business and no policy touches them. A policy that
// moved the hit ratio would be answering a question it was not asked.
func TestWritePolicyLeavesReadsAlone(t *testing.T) {
	t.Parallel()
	policies := model.WritePolicies()
	results := make([]sim.Result, 0, len(policies))
	for _, policy := range policies {
		res, err := sim.Run(cachedWith(0.75, 2, 30, policy), reads(40, 3))
		if err != nil {
			t.Fatalf("Run() with %s: %v", policy, err)
		}
		results = append(results, res)
	}
	for i := 1; i < len(results); i++ {
		if !same(results[0], results[i]) {
			t.Errorf("%s changed a read-only run:\n %+v\n %+v",
				policies[i], results[0], results[i])
		}
	}
}
