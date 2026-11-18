# AGENTS.md

## Repository organization

- Keep Rust tests inline in the implementation file under `#[cfg(test)] mod tests`.
  Do not create standalone Rust test files, external test modules, or Rust test directories.
- Keep deterministic frontend tests in `tests/unit/`, manual browser tests in
  `tests/browser/`, and external-tool tests in `tests/integration/`.
  Create feature directories within each layer. Colocate local fixtures with their tests and keep
  shared test support scoped to its layer. Test entry points use `.test.ts`.
- Use `.ts` and `.tsx` for all authored frontend, test, and tooling code. Keep executable code out
  of HTML and SVG markup. Compile browser and deployment artifacts during the build.
- Do not add or run browser E2E tests for the official website (`site/`). Validate
  the website through static checks and deterministic unit tests instead.
- E2E tests verify behavior: user actions, state changes, validation, persistence,
  focus, and command dispatch. Do not assert CSS, static geometry, colors, typography, or visual
  snapshots. Use the pointer helper for input coordinates. Test interaction-driven presentation with
  semantic states or focused probes that compare the result against the previous state.
- Run `npm test` to enforce frontend coverage. Add deterministic coverage for logic branches,
  failure paths, and state transitions when modifying them.
- `scripts/` contains executable build, asset preparation, release, and repository
  check commands only. Every script needs a `package.json` entry point. Do not put
  tests, experiments, or documentation inventories there.
- Keep documentation focused on maintained contracts and user instructions.
  Delete obsolete notes instead of accumulating progress logs, incident reports,
  one-off benchmarks, unfinished plans, and duplicate feature inventories.
- Run `npm run check:layout` and `npm test` after changing repository tooling or
  moving tests. Keep real media encoding and model/GPU checks out of normal CI.

## Pull requests

- Use an English title for pull requests.

## React lifecycle

- Do not import, call, alias, or wrap React `useEffect`, `useLayoutEffect`, or
  `useInsertionEffect`. The ban also applies to browser harnesses.
- Derive values during render and handle user actions in event handlers.
- External resources must have an explicit owner and release path. Pass a
  `RenderLifetime` explicitly through hooks that need the component lifetime;
  render its boundary on every return path, including empty content. Register
  resources unconditionally in a stable order; put activation conditions inside
  acquisition callbacks. Never acquire resources during render.

## Scheduling

- Production source (`src/`, `site/`, and the user guide theme) must not reference, import, alias, or wrap
  native `setTimeout` or `setInterval`, including computed property access. Do not
  disable the lint rule. Dependencies and generated artifacts are outside this ban;
  tests and build tooling may use native timers.
- Prefer events for completion and derive values during render. Necessary delays,
  deadlines and recurring work use `src/runtime/scheduling.ts`, backed by RxJS.
  The owner must cancel scheduled resources on replacement or disposal. Register
  component resources through `RenderLifetime`, never during render. Async waits
  may pass an `AbortSignal`; Worker request deadlines use platform abort signals.
- Do not replace timers with animation-frame polling or add a native timer wrapper.

## Code formatting

- TypeScript, TSX, JSON, CSS, HTML, and Markdown are formatted with the
  project-local Prettier configuration in `.prettierrc.json`.
- Rust is formatted with `cargo fmt` using `src-tauri/Cargo.toml`.
- Format changed frontend files with `npx prettier --write <files>`.
- Format Rust changes with `npm run format:rust`.
- Use `npm run format` only when formatting the whole repository is intentional.
- `npm run format:check` checks the whole repository; report pre-existing failures instead of
  reformatting unrelated files.
- Do not manually reformat unrelated files or overwrite unrelated working-tree changes.
- VS Code is configured in `.vscode/settings.json` to format supported files on save.
- Conduct reviews primarily at the code level; generating videos and then using software to perform complex tests is prohibited.
- If you need to preview the frontend, please shut down your preview process yourself after the task is finished. Do not leave port 1420 occupied when you are done.
