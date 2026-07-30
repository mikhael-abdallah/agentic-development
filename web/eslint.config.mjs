import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import security from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

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
    },
  },

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
