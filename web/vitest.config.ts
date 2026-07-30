import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Mirror tsconfig's "@/*" path alias for the test runner.
  resolve: { alias: { "@": new URL("src", import.meta.url).pathname } },
  test: {
    environment: "jsdom",
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
