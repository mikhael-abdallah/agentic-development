package model_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

// reference is the design every case below starts from: the read path of a URL
// shortener, and small enough that each rejection can be provoked by changing
// one line of it. Building it fresh per case keeps one mutation from leaking
// into the next.
func reference() model.Topology {
	return model.Topology{
		Nodes: []model.Node{
			{ID: "client", Kind: model.KindClient, Label: "users"},
			{ID: "lb", Kind: model.KindLoadBalancer, LoadBalancer: &model.LoadBalancerParams{
				Algorithm: model.RoundRobin,
				Overhead:  1,
			}},
			{ID: "api", Kind: model.KindService, Service: &model.ServiceParams{
				Instances:     4,
				MeanService:   5,
				QueueCapacity: 100,
			}},
			{ID: "cache", Kind: model.KindCache, Cache: &model.CacheParams{
				HitRatio:   0.9,
				HitLatency: 1,
			}},
			{ID: "db", Kind: model.KindDatabase, Database: &model.DatabaseParams{
				Replicas:  2,
				MeanRead:  8,
				MeanWrite: 20,
				PoolSize:  50,
			}},
		},
		Edges: []model.Edge{
			{From: "client", To: "lb"},
			{From: "lb", To: "api"},
			{From: "api", To: "cache"},
			{From: "cache", To: "db"},
		},
	}
}

func TestValidateAcceptsTheReferenceDesign(t *testing.T) {
	t.Parallel()
	if err := reference().Validate(); err != nil {
		t.Fatalf("Validate() on the reference design = %v, want nil", err)
	}
}

// Every rule gets a case that must fail. A validator that accepts everything
// passes the happy-path test above and nothing else would notice.
func TestValidateRejects(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		mutate func(*model.Topology)
		want   error
	}{
		{"an empty design", func(tp *model.Topology) {
			tp.Nodes, tp.Edges = nil, nil
		}, model.ErrNoNodes},

		{"a component with no id", func(tp *model.Topology) {
			tp.Nodes[2].ID = ""
		}, model.ErrNodeID},

		{"two components sharing an id", func(tp *model.Topology) {
			tp.Nodes[2].ID = "lb"
		}, model.ErrNodeID},

		{"a kind the simulator does not model", func(tp *model.Topology) {
			tp.Nodes[2].Kind = "quantumMesh"
		}, model.ErrUnknownKind},

		{"no client", func(tp *model.Topology) {
			tp.Nodes[0].Kind = model.KindService
			tp.Nodes[0].Service = &model.ServiceParams{Instances: 1, MeanService: 1}
		}, model.ErrClientCount},

		{"two clients", func(tp *model.Topology) {
			tp.Nodes[2].Kind = model.KindClient
			tp.Nodes[2].Service = nil
		}, model.ErrClientCount},

		{"a client carrying parameters", func(tp *model.Topology) {
			tp.Nodes[0].Cache = &model.CacheParams{HitRatio: 0.5}
		}, model.ErrParamsMismatch},

		{"a service with no parameters", func(tp *model.Topology) {
			tp.Nodes[2].Service = nil
		}, model.ErrParamsMismatch},

		{"a service also carrying cache parameters", func(tp *model.Topology) {
			tp.Nodes[2].Cache = &model.CacheParams{HitRatio: 0.5}
		}, model.ErrParamsMismatch},

		{"a service pool with no instances", func(tp *model.Topology) {
			tp.Nodes[2].Service.Instances = 0
		}, model.ErrParamRange},

		{"a negative queue capacity", func(tp *model.Topology) {
			tp.Nodes[2].Service.QueueCapacity = -1
		}, model.ErrParamRange},

		{"a hit ratio above one", func(tp *model.Topology) {
			tp.Nodes[3].Cache.HitRatio = 1.5
		}, model.ErrParamRange},

		{"a database with no connections", func(tp *model.Topology) {
			tp.Nodes[4].Database.PoolSize = 0
		}, model.ErrParamRange},

		{"a negative replica count", func(tp *model.Topology) {
			tp.Nodes[4].Database.Replicas = -1
		}, model.ErrParamRange},

		{"a balancing strategy that does not exist", func(tp *model.Topology) {
			tp.Nodes[1].LoadBalancer.Algorithm = "coinFlip"
		}, model.ErrParamRange},

		{"a negative balancer overhead", func(tp *model.Topology) {
			tp.Nodes[1].LoadBalancer.Overhead = -1
		}, model.ErrParamRange},

		{"an edge from a component that does not exist", func(tp *model.Topology) {
			tp.Edges = append(tp.Edges, model.Edge{From: "ghost", To: "api"})
		}, model.ErrEdgeEndpoint},

		{"an edge to a component that does not exist", func(tp *model.Topology) {
			tp.Edges = append(tp.Edges, model.Edge{From: "api", To: "ghost"})
		}, model.ErrEdgeEndpoint},

		{"a component wired to itself", func(tp *model.Topology) {
			tp.Edges = append(tp.Edges, model.Edge{From: "api", To: "api"})
		}, model.ErrEdgeShape},

		{"the same edge twice", func(tp *model.Topology) {
			tp.Edges = append(tp.Edges, model.Edge{From: "lb", To: "api"})
		}, model.ErrEdgeShape},

		{"traffic sent back to the client", func(tp *model.Topology) {
			tp.Edges = append(tp.Edges, model.Edge{From: "db", To: "client"})
		}, model.ErrClientInbound},

		{"a component nothing can reach", func(tp *model.Topology) {
			tp.Nodes = append(tp.Nodes, model.Node{
				ID:      "orphan",
				Kind:    model.KindService,
				Service: &model.ServiceParams{Instances: 1, MeanService: 1},
			})
		}, model.ErrUnreachable},

		{"a service that answers instantly", func(tp *model.Topology) {
			tp.Nodes[2].Service.MeanService = 0
		}, model.ErrParamRange},

		{"a database read that costs nothing", func(tp *model.Topology) {
			tp.Nodes[4].Database.MeanRead = 0
		}, model.ErrParamRange},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			tp := reference()
			tt.mutate(&tp)
			err := tp.Validate()
			if !errors.Is(err, tt.want) {
				t.Errorf("Validate() with %s = %v, want %v", tt.name, err, tt.want)
			}
		})
	}
}

func TestTopologyLookups(t *testing.T) {
	t.Parallel()
	tp := reference()

	if n, ok := tp.Node("cache"); !ok || n.Kind != model.KindCache {
		t.Errorf("Node(\"cache\") = %+v, %v; want the cache component", n, ok)
	}
	if _, ok := tp.Node("ghost"); ok {
		t.Error("Node(\"ghost\") reported a component that is not in the design")
	}
	if c, ok := tp.Client(); !ok || c.ID != "client" {
		t.Errorf("Client() = %+v, %v; want the client component", c, ok)
	}
	if got := tp.Downstream("api"); !reflect.DeepEqual(got, []string{"cache"}) {
		t.Errorf("Downstream(\"api\") = %v, want [cache]", got)
	}
	if got := tp.Downstream("db"); len(got) != 0 {
		t.Errorf("Downstream(\"db\") = %v, want nothing past the last component", got)
	}
}

func TestClientOnADesignWithoutOne(t *testing.T) {
	t.Parallel()
	tp := model.Topology{Nodes: []model.Node{{ID: "api", Kind: model.KindService}}}
	if _, ok := tp.Client(); ok {
		t.Error("Client() found a client in a design that has none")
	}
}

// The JSON tags are the contract the HTTP API and the web client share, so a
// field that stops surviving the round trip is a break in both at once.
func TestTopologyJSONRoundTrip(t *testing.T) {
	t.Parallel()
	want := reference()

	encoded, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("Marshal() unexpected error: %v", err)
	}
	var got model.Topology
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatalf("Unmarshal() unexpected error: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("round trip changed the design:\n got %+v\nwant %+v", got, want)
	}
}

// The parameter union is only a union on the wire if the unset members stay
// off it. Without omitempty a client would read every component as carrying
// every kind's parameters, all of them zero.
func TestJSONOmitsParametersOfOtherKinds(t *testing.T) {
	t.Parallel()
	encoded, err := json.Marshal(reference().Nodes[3]) // the cache
	if err != nil {
		t.Fatalf("Marshal() unexpected error: %v", err)
	}
	body := string(encoded)
	if !strings.Contains(body, `"cache"`) {
		t.Errorf("the cache node encoded without its own parameters: %s", body)
	}
	for _, absent := range []string{"service", "database", "loadBalancer"} {
		if strings.Contains(body, `"`+absent+`"`) {
			t.Errorf("the cache node encoded %s parameters it does not have: %s", absent, body)
		}
	}
}
