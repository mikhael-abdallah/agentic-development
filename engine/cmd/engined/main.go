// Command engined serves the simulation engine over HTTP.
//
// It is wiring and nothing else: a flag, a signal, and a server. Everything
// with a decision in it lives in internal/api, because a decision made in main
// is one nothing can test.
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/api"
)

func main() {
	addr := flag.String("addr", ":8080", "address to listen on")
	dir := flag.String("assets", "", "directory of the built web app, or empty for the JSON API alone")
	flag.Parse()

	assets, err := api.AssetsAt(*dir)
	if err != nil {
		log.Fatalf("engined: %v", err)
	}

	// SIGTERM as well as interrupt: it is what a container runtime sends, and
	// a server that only handles Ctrl-C is a server that is always killed.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Printf("engined listening on %s", *addr)
	if err := api.Serve(ctx, api.NewServer(*addr, assets)); err != nil {
		log.Fatalf("engined: %v", err)
	}
}
