package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/api"
)

// scenarioBody is only what this endpoint promises a client. Decoding into the
// model types would test that the server can read its own output, which it can
// by construction; decoding into the fields a canvas needs tests the contract.
type scenarioBody struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Goal        string          `json:"goal"`
	Topology    json.RawMessage `json:"topology"`
	Workload    json.RawMessage `json:"workload"`
}

func getScenarios(t *testing.T) []scenarioBody {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/scenarios", nil)
	rec := httptest.NewRecorder()
	api.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /scenarios = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q", got)
	}
	var body []scenarioBody
	decodeInto(t, rec, &body)
	if len(body) == 0 {
		t.Fatal("GET /scenarios returned nothing, so a client opens on an empty canvas")
	}
	return body
}

func TestScenariosAreServed(t *testing.T) {
	t.Parallel()
	var found bool
	for _, s := range getScenarios(t) {
		if s.ID != "url-shortener" {
			continue
		}
		found = true
		// The prose is the reason a preset exists rather than a fixture. An
		// empty description or goal loads a design with nothing to say about
		// what to do with it.
		if s.Title == "" || s.Description == "" || s.Goal == "" {
			t.Errorf("the %s preset arrived without its prose: %+v", s.ID, s)
		}
		if len(s.Topology) == 0 || len(s.Workload) == 0 {
			t.Errorf("the %s preset arrived without a design to load", s.ID)
		}
	}
	if !found {
		t.Error("GET /scenarios does not offer the url-shortener preset")
	}
}

// The one thing worth proving about this endpoint: what it hands out is what
// the other endpoint takes back. /simulate refuses unknown fields, so a
// scenario carrying a key the request struct does not have would be a 400 —
// which is how the two shapes would drift apart otherwise, silently, until a
// client tried to run the design it had just been given.
func TestAServedScenarioCanBeRunAsGiven(t *testing.T) {
	t.Parallel()
	for _, s := range getScenarios(t) {
		t.Run(s.ID, func(t *testing.T) {
			t.Parallel()
			request, err := json.Marshal(map[string]json.RawMessage{
				"topology": s.Topology,
				"workload": s.Workload,
			})
			if err != nil {
				t.Fatalf("marshalling the preset back: %v", err)
			}
			rec := post(t, string(request))
			if rec.Code != http.StatusOK {
				t.Fatalf("POST /simulate with the %s preset = %d, want %d: %s",
					s.ID, rec.Code, http.StatusOK, rec.Body)
			}
			var result struct {
				Completed  int    `json:"completed"`
				Bottleneck string `json:"bottleneck"`
			}
			decodeInto(t, rec, &result)
			if result.Completed == 0 {
				t.Errorf("the %s preset ran and completed nothing", s.ID)
			}
			if result.Bottleneck == "" {
				t.Errorf("the %s preset ran and named no bottleneck", s.ID)
			}
		})
	}
}

func TestTheWrongMethodOnScenariosIsRefused(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodPost, "/scenarios", nil)
	rec := httptest.NewRecorder()
	api.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /scenarios = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
