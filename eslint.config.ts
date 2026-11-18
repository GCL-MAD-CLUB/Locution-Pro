import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { frontendArchitecture } from "./tooling/eslint/frontend-architecture.ts";
import { reactLifecycle } from "./tooling/eslint/react-lifecycle.ts";
import { testArchitecture } from "./tooling/eslint/test-architecture.ts";
import { scheduling } from "./tooling/eslint/no-native-timers.ts";

const effectNames = "^(useEffect|useLayoutEffect|useInsertionEffect)$";
const effectMessage =
  "Effect hooks are forbidden, including aliases and wrappers. Use an explicit RenderLifetime owner.";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/target/**",
      "**/target-verify/**",
      "**/.cache/**",
      "**/.vitepress/cache/**",
      "**/.vitepress/dist/**",
      "**/.vitepress/.temp/**",
      ".agents/**",
      ".claude/**",
      ".playwright-mcp/**",
      "src-tauri/gen/**",
      "src-tauri/bin/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-debugger": "error",
      "no-constant-binary-expression": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: `ImportSpecifier[imported.name=/${effectNames}/]`, message: effectMessage },
        { selector: `ExportSpecifier[local.name=/${effectNames}/]`, message: effectMessage },
        { selector: `MemberExpression[property.name=/${effectNames}/]`, message: effectMessage },
        { selector: `MemberExpression[property.value=/${effectNames}/]`, message: effectMessage },
        {
          selector: `Property[key.name=/${effectNames}/][parent.type='ObjectPattern']`,
          message: effectMessage,
        },
        {
          selector: `Property[key.value=/${effectNames}/][parent.type='ObjectPattern']`,
          message: effectMessage,
        },
        { selector: `CallExpression[callee.name=/${effectNames}/]`, message: effectMessage },
        {
          selector: "MethodDefinition[key.name='getDerivedStateFromProps']",
          message: "Derived state is forbidden. Compute values from props during render.",
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,jsx,ts,mts,tsx}"],
    plugins: { react, "react-hooks": reactHooks, "project-react": reactLifecycle },
    settings: { react: { version: "detect" } },
    rules: {
      "project-react/no-render-state-update": "error",
      "project-react/no-derived-state": "error",
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...Object.fromEntries(
        Object.keys(reactHooks.configs.flat["recommended-latest"].rules).map((name) => [
          name,
          "error",
        ]),
      ),
      "react-hooks/component-hook-factories": "error",
      "react-hooks/no-deriving-state-in-effects": "error",
      "react-hooks/memo-dependencies": "error",
      "react/prop-types": "off", // TypeScript owns component prop contracts.
      "react/no-direct-mutation-state": "error",
      "react/no-did-mount-set-state": "error",
      "react/no-did-update-set-state": "error",
      "react/no-will-update-set-state": "error",
      "react/no-unused-state": "error",
      "react/jsx-no-useless-fragment": "error",
      "react/jsx-no-constructed-context-values": "error",
      "react/no-unstable-nested-components": "error",
      "react/no-array-index-key": "error",
      "react/button-has-type": "error",
    },
  },
  prettier,
  {
    files: [
      "src/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "site/src/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "site/_worker.ts",
      "docs/user-guide/.vitepress/theme/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    plugins: { "project-architecture": frontendArchitecture },
    rules: { "project-architecture/boundaries": "error" },
  },
  {
    files: [
      "src/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "site/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "docs/user-guide/.vitepress/theme/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    plugins: { "project-scheduling": scheduling },
    linterOptions: { noInlineConfig: true },
    rules: { "project-scheduling/no-native-timers": "error" },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    plugins: { "project-tests": testArchitecture },
    linterOptions: { noInlineConfig: true },
    rules: {
      "project-tests/boundaries": "error",
      "project-tests/behavior-assertions": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true },
      ],
    },
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs,mts,cts}"],
    linterOptions: { noInlineConfig: true },
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Program", message: "Authored frontend code must use .ts or .tsx." },
      ],
    },
  },
);
