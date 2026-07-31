package model

import (
	"math"
	"testing"
)

// The check has to reject its own boundary, and the reason is not obvious:
// float64 cannot represent math.MaxInt64 and rounds it up to 2^63, one
// nanosecond past what a Duration holds. So the largest value that may be
// accepted is the float step below the constant, and what this pins is the
// property rather than the number — whatever representable admits must still
// convert forwards to a positive Duration.
func TestTheLongestAcceptedRunStillConvertsForwards(t *testing.T) {
	t.Parallel()
	if err := representable("durationMs", maxRepresentableMillis); err == nil {
		t.Error("representable accepted its own boundary, which overflows the clock")
	}
	longest := math.Nextafter(maxRepresentableMillis, 0)
	if err := representable("durationMs", longest); err != nil {
		t.Errorf("representable rejected %g, one step inside the boundary: %v", longest, err)
	}
	if d := Millis(longest).Duration(); d <= 0 {
		t.Errorf("the longest accepted run converts to %v, which the engine reads as a "+
			"run that ends before it starts", d)
	}
}
