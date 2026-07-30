package sim

import (
	"hash/fnv"
	"math/rand/v2"
	"time"
)

// streams hands each component its own random source, all derived from the
// run's single seed.
//
// One shared stream would be simpler and would couple every component to every
// other. Draws come out of a shared stream in whatever order the event loop
// happens to need them, so adding a component — or changing how many draws an
// existing one makes — shifts every later draw everywhere else. Two runs meant
// to differ in one parameter would then differ in all their randomness too,
// and the comparison the whole tool exists for would be measuring noise.
//
// Deriving per component from the id keeps a component's draws the same
// whatever else is on the canvas, which is what makes "raise the cache hit
// ratio and watch the database" a controlled experiment rather than a reroll.
type streams struct {
	seed uint64
	byID map[string]*rand.Rand
}

func newStreams(seed uint64) *streams {
	return &streams{seed: seed, byID: make(map[string]*rand.Rand)}
}

// stream returns the source for a component, creating it on first use.
func (s *streams) stream(id string) *rand.Rand {
	if r, ok := s.byID[id]; ok {
		return r
	}
	// FNV mixes the id into the second PCG seed word, so two components in the
	// same run start from different states while the run as a whole is still
	// decided by one number the caller chose.
	h := fnv.New64a()
	_, _ = h.Write([]byte(id)) // hash writes never fail
	// gosec reads any math/rand use as a weakness. Here the weakness is the
	// requirement: a run has to be reproducible from its seed, and crypto/rand
	// is unseedable by design, so switching would trade the one invariant this
	// engine promises for unpredictability nothing here wants. No value drawn
	// from this stream is a secret, a token, or visible outside the result.
	r := rand.New(rand.NewPCG(s.seed, h.Sum64())) //nolint:gosec // G404: determinism is the point; see above
	s.byID[id] = r
	return r
}

// exponential draws a duration with the given mean.
//
// Exponential rather than fixed, because a queue fed by constant work is a
// different system: with no variability a server that is fast enough on
// average never builds a backlog at all, and the whole point of simulating
// this is that real ones do.
func exponential(r *rand.Rand, mean time.Duration) time.Duration {
	return time.Duration(r.ExpFloat64() * float64(mean))
}
