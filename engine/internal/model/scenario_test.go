package model

import (
	"errors"
	"fmt"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"
)

// preset is the smallest scenario that validates, so a test about loading is
// about loading rather than about the design it happens to carry.
func preset(id string) string {
	return fmt.Sprintf(`{
	  "id": %q, "title": "t", "description": "d", "goal": "g",
	  "topology": {
	    "nodes": [
	      {"id": "client", "kind": "client"},
	      {"id": "svc", "kind": "service",
	       "service": {"instances": 1, "meanServiceMs": 1, "queueCapacity": 0}}
	    ],
	    "edges": [{"from": "client", "to": "svc"}]
	  },
	  "workload": {"rateRps": 10, "readFraction": 1, "durationMs": 1000,
	               "seed": 1, "warmupFraction": 0.1}
	}`, id)
}

// files builds a scenario directory from filename to content.
func files(named map[string]string) fstest.MapFS {
	fsys := fstest.MapFS{}
	for name, content := range named {
		fsys[scenarioDir+"/"+name] = &fstest.MapFile{Data: []byte(content)}
	}
	return fsys
}

// This is the test the panic in Scenarios depends on. A preset that stops
// parsing or stops validating is a broken binary, and this is what makes that
// impossible rather than merely unlikely.
func TestEveryEmbeddedScenarioValidates(t *testing.T) {
	t.Parallel()
	loaded, err := loadScenarios(scenarioFiles)
	if err != nil {
		t.Fatalf("a preset shipped with the engine is broken: %v", err)
	}
	if len(loaded) == 0 {
		t.Fatal("no presets are embedded")
	}
}

func TestTheUrlShortenerIsShipped(t *testing.T) {
	t.Parallel()
	var shortener Scenario
	for _, s := range Scenarios() {
		if s.ID == "url-shortener" {
			shortener = s
		}
	}
	if shortener.ID == "" {
		t.Fatal("the url-shortener preset is not among the embedded scenarios")
	}
	// Every kind the simulator models, because the point of the first preset
	// is that it exercises the whole engine rather than a corner of it.
	kinds := map[NodeKind]bool{}
	for _, n := range shortener.Topology.Nodes {
		kinds[n.Kind] = true
	}
	for _, want := range Kinds() {
		if !kinds[want] {
			t.Errorf("the url-shortener preset has no %s", want)
		}
	}
	// Read-heavy, or the cache in it is decoration.
	if shortener.Workload.ReadFraction < 0.9 {
		t.Errorf("readFraction is %g, which is not the read-heavy load a "+
			"shortener is", shortener.Workload.ReadFraction)
	}
}

// Presets are decoded per call rather than shared. Node points at its
// parameter struct, so a shared copy would let whoever loaded a preset first
// change what everybody after them loads — and nothing downstream could tell
// that the design it was handed is not the one that shipped.
func TestLoadingAScenarioTwiceGivesTwoOfThem(t *testing.T) {
	t.Parallel()
	first := Scenarios()
	for i := range first {
		for j := range first[i].Topology.Nodes {
			first[i].Topology.Nodes[j].ID = "vandalised"
			if params := first[i].Topology.Nodes[j].Service; params != nil {
				params.Instances = 9999
			}
		}
	}
	for _, s := range Scenarios() {
		for _, n := range s.Topology.Nodes {
			if n.ID == "vandalised" {
				t.Fatalf("scenario %q shares its nodes with an earlier caller", s.ID)
			}
			if n.Service != nil && n.Service.Instances == 9999 {
				t.Fatalf("scenario %q shares its parameters with an earlier caller", s.ID)
			}
		}
	}
}

func TestABrokenPresetIsRefused(t *testing.T) {
	t.Parallel()
	valid := preset("ok")
	tests := []struct {
		name string
		fsys fstest.MapFS
		want string
	}{
		{"not JSON at all", files(map[string]string{"a.json": `{"id":`}), "a.json"},
		// A key nobody reads is a parameter silently left at zero: this preset
		// would ship a service with no instances rather than be refused.
		{"a misspelled parameter", files(map[string]string{
			"a.json": strings.Replace(valid, `"instances"`, `"instance"`, 1),
		}), "a.json"},
		{"a design that does not validate", files(map[string]string{
			"a.json": strings.Replace(valid, `"kind": "client"`, `"kind": "cache"`, 1),
		}), "a.json"},
		{"a workload that does not validate", files(map[string]string{
			"a.json": strings.Replace(valid, `"rateRps": 10`, `"rateRps": 0`, 1),
		}), "rateRps"},
		{"no title", files(map[string]string{
			"a.json": strings.Replace(valid, `"title": "t"`, `"title": " "`, 1),
		}), "title"},
		{"no goal", files(map[string]string{
			"a.json": strings.Replace(valid, `"goal": "g"`, `"goal": ""`, 1),
		}), "goal"},
		// Whichever one wins depends on iteration order, so one of the two is
		// unreachable and not reliably the same one.
		{
			"two presets with one id",
			files(map[string]string{"a.json": valid, "b.json": valid}), "both claim the id",
		},
		// A directory that exists and holds nothing reads differently from one
		// that was never embedded, and only one of the two is a build mistake.
		{
			"a directory with nothing in it",
			fstest.MapFS{scenarioDir: &fstest.MapFile{Mode: fs.ModeDir}},
			"none are embedded",
		},
		{"no scenarios directory at all", files(nil), "reading " + scenarioDir},
		// Listed like a preset, unreadable as one. Refusing it beats appending
		// the zero Scenario and serving a design with no components in it.
		{
			"a directory where a preset should be",
			files(map[string]string{"sub/a.json": valid}), scenarioDir + "/sub",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			_, err := loadScenarios(tt.fsys)
			if err == nil {
				t.Fatalf("loadScenarios accepted %s", tt.name)
			}
			if !errors.Is(err, ErrScenario) {
				t.Errorf("error does not wrap ErrScenario: %v", err)
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error does not say which or why (want %q): %v", tt.want, err)
			}
		})
	}
}

// Filename order, so the list a client opens on is the same list every time
// rather than whatever the filesystem felt like returning.
func TestPresetsComeBackInFilenameOrder(t *testing.T) {
	t.Parallel()
	loaded, err := loadScenarios(files(map[string]string{
		"zebra.json":    preset("zebra"),
		"aardvark.json": preset("aardvark"),
	}))
	if err != nil {
		t.Fatalf("loadScenarios: %v", err)
	}
	if got := []string{loaded[0].ID, loaded[1].ID}; got[0] != "aardvark" || got[1] != "zebra" {
		t.Errorf("presets came back as %v, want them sorted by filename", got)
	}
}
