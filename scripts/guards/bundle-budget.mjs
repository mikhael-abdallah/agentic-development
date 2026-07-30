// Bundle budget: every prerendered route's first-load JS must stay under
// the gzipped budget. The route's own HTML is the ground truth for what a
// first load ships — the script tags Next emitted — so this survives
// bundler/manifest reshuffles (Turbopack dropped app-build-manifest.json).
// Run from web/ after `next build` (web-build.sh does both).
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { gzipSync } from "node:zlib";

// The Next 16 + React 19 framework floor measured 181 kB gzipped on an
// empty page — the budget sits above it with headroom for the canvas work,
// and gets ratcheted down like every other threshold, never up.
const BUDGET_BYTES = 250_000;
const APP_DIR = ".next/server/app";

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath, e.name));
}

// Internal routes (_not-found, _global-error) aren't user-facing pages.
const routes = htmlFiles(APP_DIR).filter((f) => !basename(f).startsWith("_"));
if (routes.length === 0) {
  throw new Error(
    `bundle-budget: no prerendered routes under ${APP_DIR} — ` +
      "if the build layout changed, fix this guard rather than skipping it",
  );
}

let failed = false;
for (const file of routes) {
  const html = readFileSync(file, "utf8");
  const scripts = new Set(
    [...html.matchAll(/\/_next\/(static\/[^"]+?\.js)/g)].map((m) => m[1]),
  );
  if (scripts.size === 0) {
    throw new Error(`bundle-budget: no script refs found in ${file}`);
  }
  let bytes = 0;
  for (const s of scripts) {
    bytes += gzipSync(readFileSync(join(".next", s))).length;
  }
  const route = `/${relative(APP_DIR, file).replace(/index\.html$|\.html$/, "")}`;
  const label = `${route}: ${(bytes / 1024).toFixed(1)} kB gzipped over ${scripts.size.toFixed(0)} chunks (budget ${(BUDGET_BYTES / 1024).toFixed(0)} kB)`;
  if (bytes > BUDGET_BYTES) {
    console.error(`OVER  ${label}`);
    failed = true;
  } else {
    console.log(`ok    ${label}`);
  }
}
process.exit(failed ? 1 : 0);
