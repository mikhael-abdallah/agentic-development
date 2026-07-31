package model

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"strings"
)

// Scenario is a design worth studying, shipped inside the binary.
//
// A preset is content rather than code: a starting point someone can load,
// run, and then argue with by changing one number. It lives in model because
// both ways the engine reaches a browser serve the same presets — the HTTP API
// and the WASM build ARCHITECTURE.md anticipates — and because a preset that
// does not validate is a broken design, not a broken transport.
type Scenario struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Goal is what to try once it is loaded. A preset that only runs is a
	// demonstration; a preset that names the number to move is a lesson, and
	// the number to move is the part that is easy to get wrong from outside.
	Goal     string   `json:"goal"`
	Topology Topology `json:"topology"`
	Workload Workload `json:"workload"`
}

// Validate reports whether this scenario can be served and run.
func (s Scenario) Validate() error {
	for _, field := range []struct{ name, value string }{
		{"id", s.ID},
		{"title", s.Title},
		{"description", s.Description},
		{"goal", s.Goal},
	} {
		if strings.TrimSpace(field.value) == "" {
			return fmt.Errorf("%w: %s is empty", ErrScenario, field.name)
		}
	}
	if err := s.Topology.Validate(); err != nil {
		return fmt.Errorf("%w: %w", ErrScenario, err)
	}
	if err := s.Workload.Validate(); err != nil {
		return fmt.Errorf("%w: %w", ErrScenario, err)
	}
	return nil
}

// scenarioFiles holds the presets, compiled in rather than read from disk.
//
// embed is not the filesystem access the core forbids: nothing here opens a
// path at runtime, and a binary carrying its own presets has no working
// directory to be started from wrongly.
//
//go:embed scenarios/*.json
var scenarioFiles embed.FS

const scenarioDir = "scenarios"

// Decoded once at package init as well as on demand, so a preset that stopped
// parsing takes the process down at start rather than surfacing later as a
// single failed request — net/http recovers a panic in a handler, logs it, and
// keeps serving, which is the quietest possible way to ship a broken binary.
var _ = Scenarios()

// Scenarios returns the presets shipped with the engine, ordered by filename.
//
// The result is decoded fresh on each call rather than shared. Node holds
// pointers to its parameter struct, so any copy cheap enough to be worth
// caching is also shallow enough for one caller's edit to change what the next
// caller loads. The presets are a few kilobytes and nothing here is a hot path.
//
// A preset that does not parse or does not validate is a broken binary rather
// than a bad request, so this panics instead of widening every caller's
// signature with an error that cannot happen. What makes it impossible is
// TestEveryEmbeddedScenarioValidates, which runs on every change.
func Scenarios() []Scenario {
	loaded, err := loadScenarios(scenarioFiles)
	if err != nil {
		panic("model: " + err.Error())
	}
	return loaded
}

// loadScenarios reads every preset in fsys, in the order fs.ReadDir returns
// them — sorted by name, so the list a client sees does not depend on how the
// files happened to be laid out.
//
// It takes an fs.FS rather than reading scenarioFiles directly so its failure
// paths are reachable from a test. Every one of them is a corrupt binary in
// production and unreachable there by construction, which is exactly the kind
// of code that rots unless something exercises it.
func loadScenarios(fsys fs.FS) ([]Scenario, error) {
	entries, err := fs.ReadDir(fsys, scenarioDir)
	if err != nil {
		return nil, fmt.Errorf("%w: reading %s/: %w", ErrScenario, scenarioDir, err)
	}
	loaded := make([]Scenario, 0, len(entries))
	seen := make(map[string]string, len(entries))
	for _, entry := range entries {
		name := path.Join(scenarioDir, entry.Name())
		scenario, err := loadScenario(fsys, name)
		if err != nil {
			return nil, err
		}
		// Ids are how a client asks for one preset rather than all of them, so
		// two files claiming the same id make one of them unreachable — and
		// which one depends on iteration order, so it would not even be the
		// same one every time.
		if first, duplicate := seen[scenario.ID]; duplicate {
			return nil, fmt.Errorf("%w: %s and %s both claim the id %q",
				ErrScenario, first, name, scenario.ID)
		}
		seen[scenario.ID] = name
		loaded = append(loaded, scenario)
	}
	if len(loaded) == 0 {
		return nil, fmt.Errorf("%w: none are embedded, so every client would "+
			"open on an empty canvas with nothing to say so", ErrScenario)
	}
	return loaded, nil
}

// loadScenario decodes one preset and checks it before anyone can load it.
//
// Unknown fields are refused here for the same reason the HTTP layer refuses
// them: a preset naming "hitratio" would ship a cache with a hit ratio of zero
// and a plausible answer to a question nobody asked.
func loadScenario(fsys fs.FS, name string) (Scenario, error) {
	raw, err := fs.ReadFile(fsys, name)
	if err != nil {
		return Scenario{}, fmt.Errorf("%w: reading %s: %w", ErrScenario, name, err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var scenario Scenario
	if err := decoder.Decode(&scenario); err != nil {
		return Scenario{}, fmt.Errorf("%w: %s: %w", ErrScenario, name, err)
	}
	if err := scenario.Validate(); err != nil {
		return Scenario{}, fmt.Errorf("%s: %w", name, err)
	}
	return scenario, nil
}
