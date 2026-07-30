package model

import (
	"errors"
	"fmt"
)

// The ways a design can be rejected. They are sentinels rather than strings
// because the HTTP layer has to turn "your design is wrong" into a status code
// and a message a person can act on, and matching on prose is how that stops
// working the first time someone rewords an error.
var (
	ErrNoNodes        = errors.New("a design needs at least one component")
	ErrNodeID         = errors.New("component ids must be unique and non-empty")
	ErrUnknownKind    = errors.New("unknown component kind")
	ErrClientCount    = errors.New("a design needs exactly one client")
	ErrParamsMismatch = errors.New("component parameters do not match its kind")
	ErrParamRange     = errors.New("parameter out of range")
	ErrEdgeEndpoint   = errors.New("edge refers to a component that does not exist")
	ErrEdgeShape      = errors.New("edge is a self-loop or a duplicate")
	ErrClientInbound  = errors.New("the client cannot receive traffic")
	ErrUnreachable    = errors.New("component cannot be reached from the client")
)

// Validate reports whether this design can be simulated.
//
// Everything here is checked once, up front, rather than discovered by the
// simulation as it runs. A missing node found halfway through a run would
// otherwise have to be reported as a partial result or a panic, and a
// half-simulated design is a number that looks like an answer.
func (t Topology) Validate() error {
	if len(t.Nodes) == 0 {
		return ErrNoNodes
	}
	if err := t.validateNodes(); err != nil {
		return err
	}
	// Built once and passed down. Looking each endpoint up by scanning the
	// node slice made validation cost edges times nodes, which is nothing on
	// a hand-drawn design and the wrong shape to leave lying around.
	index := t.index()
	if err := t.validateEdges(index); err != nil {
		return err
	}
	return t.validateReachability(t.adjacency())
}

// index maps component id to component.
func (t Topology) index() map[string]Node {
	byID := make(map[string]Node, len(t.Nodes))
	for _, n := range t.Nodes {
		byID[n.ID] = n
	}
	return byID
}

// adjacency maps each component to the ones it sends requests to, preserving
// edge order so that every traversal below visits in the same sequence twice.
func (t Topology) adjacency() map[string][]string {
	adj := make(map[string][]string, len(t.Nodes))
	for _, e := range t.Edges {
		adj[e.From] = append(adj[e.From], e.To)
	}
	return adj
}

// validateNodes checks each component on its own, and that the design has the
// single entry point every run starts from.
func (t Topology) validateNodes() error {
	seen := make(map[string]bool, len(t.Nodes))
	clients := 0
	for _, n := range t.Nodes {
		if n.ID == "" {
			return fmt.Errorf("%w: a component has an empty id", ErrNodeID)
		}
		if seen[n.ID] {
			return fmt.Errorf("%w: %q appears twice", ErrNodeID, n.ID)
		}
		seen[n.ID] = true
		if n.Kind == KindClient {
			clients++
		}
		if err := n.validate(); err != nil {
			return err
		}
	}
	if clients != 1 {
		return fmt.Errorf("%w: found %d", ErrClientCount, clients)
	}
	return nil
}

// validateEdges checks that every edge connects two real components, in a
// direction requests can actually travel.
func (t Topology) validateEdges(index map[string]Node) error {
	seen := make(map[Edge]bool, len(t.Edges))
	for _, e := range t.Edges {
		if _, ok := index[e.From]; !ok {
			return fmt.Errorf("%w: %q", ErrEdgeEndpoint, e.From)
		}
		to, ok := index[e.To]
		if !ok {
			return fmt.Errorf("%w: %q", ErrEdgeEndpoint, e.To)
		}
		if e.From == e.To {
			return fmt.Errorf("%w: %q sends to itself", ErrEdgeShape, e.From)
		}
		if seen[e] {
			return fmt.Errorf("%w: %q to %q appears twice", ErrEdgeShape, e.From, e.To)
		}
		seen[e] = true
		if to.Kind == KindClient {
			return fmt.Errorf("%w: %q sends to it", ErrClientInbound, e.From)
		}
	}
	return nil
}

// validateReachability rejects components no request can arrive at.
//
// An unreachable component is not a harmless extra. It sits on the canvas
// looking like part of the design, contributes nothing, and its absence from
// the results reads as "this component is not a bottleneck" rather than "this
// component was never wired up".
func (t Topology) validateReachability(adjacency map[string][]string) error {
	client, ok := t.Client()
	if !ok {
		return fmt.Errorf("%w: found 0", ErrClientCount)
	}
	seen := map[string]bool{client.ID: true}
	queue := []string{client.ID}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for _, next := range adjacency[id] {
			if !seen[next] {
				seen[next] = true
				queue = append(queue, next)
			}
		}
	}
	for _, n := range t.Nodes {
		if !seen[n.ID] {
			return fmt.Errorf("%w: %q", ErrUnreachable, n.ID)
		}
	}
	return nil
}
