package api

import (
	"net/http"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

// scenarios answers with every preset the binary ships, in a stable order.
//
// model.Scenario goes onto the wire as it stands, without a transport-side
// copy of its shape. A Result needed one because it carries durations, which
// Go marshals as nanoseconds; a Scenario is already the wire contract — it is
// assembled from the same types a client posts back to /simulate, so a preset
// this endpoint serves is a body /simulate accepts, and the two cannot drift
// apart without the compiler noticing.
func scenarios(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, model.Scenarios())
}
