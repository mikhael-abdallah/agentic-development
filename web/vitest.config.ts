import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Mirror tsconfig's "@/*" path alias for the test runner.
  resolve: { alias: { "@": new URL("src", import.meta.url).pathname } },
  test: {
    environment: "jsdom",
    // The Go gate runs `go test -shuffle=on`; this is its counterpart.
    // Order dependence is one of the few defects a passing suite hides: a
    // test that only passes because an earlier one left state behind stays
    // green until the day something is inserted above it. Vitest isolates
    // files but does not shuffle, so within-file order — and the module state
    // a file's tests share — would otherwise never be exercised any other way.
    // The seed is printed on failure, so a red run stays reproducible.
    sequence: { shuffle: true },
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "cobertura"],
      reportsDirectory: "coverage",
      include: ["src/**"],
      // layout.tsx is the declarative <html> shell — jsdom cannot render a
      // nested <html> element, so it stays out of unit coverage.
      exclude: ["src/**/*.test.*", "src/app/layout.tsx"],
    },
  },
});
