package sim

import (
	"errors"
	"fmt"
	"time"
)

// ErrUtilization reports a queue built with utilization outside [0, 1).
// At 1 the model's wait time diverges — the tier is saturated.
var ErrUtilization = errors.New("utilization must be in [0, 1)")

// Queue models a service behind a queue with the M/M/1 approximation:
// mean latency = service time / (1 - utilization). It captures the
// non-linear blow-up that makes hot tiers dominate system latency.
type Queue struct {
	service     time.Duration
	utilization float64
}

// NewQueue validates and builds a Queue. Utilization is offered load as a
// fraction of capacity.
func NewQueue(service time.Duration, utilization float64) (Queue, error) {
	if service < 0 {
		return Queue{}, fmt.Errorf("service time %v is negative", service)
	}
	if utilization < 0 || utilization >= 1 {
		return Queue{}, fmt.Errorf("utilization %g: %w", utilization, ErrUtilization)
	}
	return Queue{service: service, utilization: utilization}, nil
}

// Latency implements Component.
func (q Queue) Latency() time.Duration {
	return time.Duration(float64(q.service) / (1 - q.utilization))
}
