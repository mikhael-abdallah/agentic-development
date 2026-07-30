import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import security from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

// Architecture boundaries from ARCHITECTURE.md — the web counterpart to the
// Go engine's depguard rules. Dependencies point one way:
// app -> features -> components|lib.
//
// ESLint rule options *replace* rather than merge across config blocks, so a
// per-directory block must restate the shared patterns or it would silently
// switch them off exactly where an extra rule was being added. BOUNDARIES is
// spread into every block for that reason.
const BOUNDARIES = [
  {
    group: ["@/app", "@/app/*", "**/app/*"],
    message: "app/ holds routes; nothing may import from it.",
  },
  {
    // Deep relative traversal would slip past the @/ groups above, leaving the
    // boundary unchecked. Anything leaving its own directory uses the alias.
    group: ["../../*"],
    message: "Use the @/ alias for imports that leave the current directory.",
  },
  {
    group: ["**/*.test", "**/*.test.*"],
    message:
      "Test files are exempt from the length and complexity limits and from coverage — importing one moves product logic outside both.",
  },
];

const restrictImports = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns: [...BOUNDARIES, ...patterns] }],
});

// The feature slices from ARCHITECTURE.md. structure-check.sh enforces that
// src/features/ holds exactly these directories; the rule below stops them
// importing each other, which is what makes them slices rather than folders.
// Shared code moves down into lib/ or components/ instead.
const FEATURES = ["canvas", "palette", "inspector", "simulation"];

const sliceIsolation = (slice) => ({
  files: [`src/features/${slice}/**`],
  rules: restrictImports(
    ...FEATURES.filter((other) => other !== slice).map((other) => ({
      group: [`@/features/${other}`, `@/features/${other}/*`, `../${other}`, `../${other}/*`],
      message: `${slice} must not reach into the ${other} slice — move shared code into lib/ or components/.`,
    })),
  ),
});

export default tseslint.config(
  { ignores: [".next/**", "coverage/**", "node_modules/**", "next-env.d.ts", "*.config.*"] },

  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  nextPlugin.configs["core-web-vitals"],
  jsxA11y.flatConfigs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  sonarjs.configs.recommended,
  security.configs.recommended,
  comments.recommended,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // Clean-code limits (ROADMAP phase 3) — same intent as the Go gate.
      complexity: ["error", 12],
      "max-depth": ["error", 4],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
      "max-nested-callbacks": ["error", 3],
      "max-params": ["error", 4],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "sonarjs/cognitive-complexity": ["error", 15],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // Every suppression needs a written reason — mirrors Go's nolintlint.
      "@eslint-community/eslint-comments/require-description": "error",
      ...restrictImports(),
    },
  },

  {
    // components/ and lib/ are shared and sit below features/: they cannot
    // reach back up, or the arrow stops pointing one way.
    files: ["src/components/**", "src/lib/**"],
    rules: restrictImports({
      group: ["@/features", "@/features/*"],
      message: "components/ and lib/ are shared and must not depend on a feature.",
    }),
  },

  ...FEATURES.map(sliceIsolation),

  {
    // JSX is hierarchical markup: a readable component outgrows 60 lines
    // without gaining any branching, so the function-length cap is wider
    // here and cognitive complexity + max-depth stay the real guards.
    // Tuned before enforcement began, not relaxed after — the ratchet holds.
    files: ["**/*.tsx"],
    rules: {
      "max-lines-per-function": ["error", { max: 150, skipBlankLines: true, skipComments: true, IIFEs: true }],
    },
  },

  {
    // Tests trade brevity for coverage of many cases — length limits off,
    // like the Go gate's test-file exemptions.
    files: ["**/*.test.*"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-duplicate-string": "off",
    },
  },
);
