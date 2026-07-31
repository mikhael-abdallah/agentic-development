import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is a canvas that runs in the browser and asks the engine for
  // simulations over HTTP. Nothing here needs rendering on a server, so there
  // is no reason to ship one: exported to static files, the whole product is
  // one Go binary serving JSON and a directory of assets — a container with no
  // Node in it and no process supervisor. It also puts the page and the API on
  // one origin, which is what lets the client ask for /simulate with no CORS
  // policy to keep in step.
  output: "export",
};

export default nextConfig;
