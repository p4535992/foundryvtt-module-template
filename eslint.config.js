import js from "@eslint/js";
import globals from "globals";

const foundryGlobals = Object.fromEntries(
  ["Hooks", "game", "ui", "foundry", "CONFIG", "CONST", "canvas", "Handlebars", "BUILD_MODE"].map((name) => [
    name,
    "readonly",
  ]),
);

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "artifacts/**",
      ".release-stage/**",
      ".vite-cache/**",
      "coverage/**",
      ".test-tmp/**",
      "src/scripts/lib/libwrapper-shim.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: {
      "array-callback-return": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "off",
      "no-duplicate-imports": ["error", { includeExports: true }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-new-wrappers": "error",
      "no-throw-literal": "error",
      "no-var": "error",
      "no-void": ["error", { allowAsStatement: true }],
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.browser, ...foundryGlobals } },
  },
  {
    files: ["build/**/*.{js,mjs,cjs}", "utils/**/*.{js,mjs,cjs}", "tests/**/*.{js,mjs,cjs}", "*.config.{js,mjs,cjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
];
