package sim_test

import (
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

// The closed-form Queue in queue.go is the one answer in this package that the
// event loop cannot have inherited a bug from. It is the M/M/1 result —
// Poisson arrivals, exponentially distributed service, one server, no limit on
// the queue — derived on paper rather than simulated, and it says a request
// spends service/(1-utilization) in the system.
//
// The discrete-event engine can be pointed at that exact system: one client,
// one service with a single instance and an unbounded queue. Two independent
// implementations of the same claim then have to agree, and where they do not,
// the one that is not a theorem is wrong. Every other test in this package
// checks the engine against a property someone thought to state; this one
// checks it against an answer nobody here computed.
//
// It is also why queue.go was kept when it stopped being the product.
const (
	// oracleService is the mean service time of the single server under test.
	oracleService model.Millis = 5
	// oracleRun is how long each simulated run offers load for. Longer runs
	// dilute the empty system every run starts in — see oracleTolerance.
	oracleRun model.Millis = 60_000
	// oracleWarmup discards the first fifth of every run from the measurement.
	oracleWarmup = 0.2
	// oracleReplications is how many independent seeds each point of the sweep
	// averages. One run is a sample, not a measurement.
	oracleReplications = 10
	// oracleTolerance is how far the simulation may sit from the theorem.
	//
	// It absorbs two errors of different kinds. The first is sampling: a run
	// observes a finite stretch of a random process, and averaging independent
	// seeds shrinks that without removing it. The second is bias, and it only
	// points one way — every run starts with an empty system, which is quieter
	// than the steady state the closed form describes, and discarding the
	// warmup window shortens that head start rather than deleting it.
	//
	// Measured over twelve disjoint blocks of ten seeds at each point below,
	// the averaged estimate stayed within 5% of the closed form and leaned
	// low, which is the shape that bias predicts. Ten percent leaves room for
	// the seeds nobody ran. TestTheOracleToleranceIsNarrowEnoughToFail keeps
	// it from quietly becoming a band so wide that any number passes.
	//
	// That measurement is of how this engine draws its arrivals and service
	// times. Change how those draws are made and the number to redo is the
	// measurement, not the tolerance.
	oracleTolerance = 0.10
)

// oracleSweep is the range of utilizations the two models are compared at.
//
// One point would not be a check: service/(1-utilization) is a curve, and a
// simulation that got the queueing wrong but the service time right would sit
// on it at low load. The sweep runs to 0.8, where four fifths of a request's
// time is spent waiting rather than being served, so the curve is what is
// being tested and not the constant underneath it.
func oracleSweep() []float64 { return []float64{0.2, 0.4, 0.6, 0.7, 0.8} }

// analytic is the closed form's answer at a utilization.
func analytic(t *testing.T, utilization float64) time.Duration {
	t.Helper()
	q, err := sim.NewQueue(oracleService.Duration(), utilization)
	if err != nil {
		t.Fatalf("NewQueue(%v, %g) unexpected error: %v", oracleService.Duration(), utilization, err)
	}
	return q.Latency()
}

// simulated is the engine's answer at the same utilization, averaged over
// independent seeds.
//
// Utilization is offered load as a fraction of capacity, so a server that
// takes oracleService per request reaches it at utilization/oracleService
// requests per second.
func simulated(t *testing.T, utilization float64) time.Duration {
	t.Helper()
	var total time.Duration
	for seed := uint64(1); seed <= oracleReplications; seed++ {
		res, err := sim.Run(chain(1, oracleService, 0), model.Workload{
			RateRPS:        utilization / oracleService.Duration().Seconds(),
			ReadFraction:   1,
			Duration:       oracleRun,
			Seed:           seed,
			WarmupFraction: oracleWarmup,
		})
		if err != nil {
			t.Fatalf("Run() at utilization %g, seed %d: %v", utilization, seed, err)
		}
		if res.Dropped != 0 {
			t.Fatalf("an unbounded queue dropped %d requests: not the M/M/1 the closed form describes",
				res.Dropped)
		}
		total += res.MeanLatency
	}
	return total / oracleReplications
}

func TestMeanLatencyConvergesToTheClosedFormQueue(t *testing.T) {
	t.Parallel()
	for _, utilization := range oracleSweep() {
		t.Run(fmt.Sprintf("utilization %.1f", utilization), func(t *testing.T) {
			t.Parallel()
			want, got := analytic(t, utilization), simulated(t, utilization)
			off := math.Abs(float64(got-want)) / float64(want)
			if off > oracleTolerance {
				t.Errorf("simulated mean latency = %v, closed form = %v: %.1f%% apart, tolerance %.0f%%",
					got, want, 100*off, 100*oracleTolerance)
			}
		})
	}
}

// A tolerance is only worth as much as what it rejects, and this one is a
// number in a const block that any future run of red CI could widen. The check
// above would still pass at ±100%, and would then be asserting that the engine
// returns a duration.
//
// So: state what the band has to stay narrower than. Neighbouring points of
// the sweep are far enough apart that their tolerance bands do not touch,
// which means the engine cannot answer one point of the sweep with another
// point's latency and be accepted. Widening the tolerance past that fails
// here, in a test that says why, rather than silently downgrading the oracle
// into a smoke test.
func TestTheOracleToleranceIsNarrowEnoughToFail(t *testing.T) {
	t.Parallel()
	// Two bands [v(1-tolerance), v(1+tolerance)] are disjoint exactly when the
	// larger value exceeds the smaller by this ratio.
	separation := (1 + oracleTolerance) / (1 - oracleTolerance)
	sweep := oracleSweep()
	for i := 1; i < len(sweep); i++ {
		lower, upper := analytic(t, sweep[i-1]), analytic(t, sweep[i])
		if ratio := float64(upper) / float64(lower); ratio <= separation {
			t.Errorf("utilizations %.1f (%v) and %.1f (%v) are only %.3fx apart:"+
				" a %.0f%% tolerance accepts one where the other is right",
				sweep[i-1], lower, sweep[i], upper, ratio, 100*oracleTolerance)
		}
	}
}
