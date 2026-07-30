package sim_test

import (
	"testing"
	"time"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

func TestCompose(t *testing.T) {
	t.Parallel()
	db := sim.Fixed(5 * time.Millisecond)
	cache := sim.Fixed(1 * time.Millisecond)
	hop := sim.Fixed(2 * time.Millisecond)

	tests := []struct {
		name string
		c    sim.Component
		want time.Duration
	}{
		{"fixed is its own latency", db, 5 * time.Millisecond},
		{"empty serial costs nothing", sim.Serial{}, 0},
		{"serial sums", sim.Serial{hop, db, hop}, 9 * time.Millisecond},
		{"empty parallel costs nothing", sim.Parallel{}, 0},
		{"parallel takes the slowest branch", sim.Parallel{cache, db, hop}, 5 * time.Millisecond},
		{
			"nested: hop then fan-out to db and cache",
			sim.Serial{hop, sim.Parallel{db, cache}},
			7 * time.Millisecond,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := tt.c.Latency(); got != tt.want {
				t.Errorf("Latency() = %v, want %v", got, tt.want)
			}
		})
	}
}
