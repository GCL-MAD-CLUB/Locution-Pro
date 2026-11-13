import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const checkerUrl = new URL("../../../scripts/check-repository-layout.ts", import.meta.url);
const checker = fileURLToPath(checkerUrl);

function fixture(
  t: TestContext,
  additions: Record<string, string> = {},
  extraScripts: Record<string, string> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "locution-pro-layout-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert(basename(root).startsWith("locution-pro-layout-"));
    rmSync(root, { recursive: true, force: true });
  });
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      type: "module",
      scripts: { "check:layout": "node scripts/check-repository-layout.ts", ...extraScripts },
    }),
    ".gitignore": "target/\n",
    "src-tauri/src/lib.rs": "fn value() {}\n#[cfg(test)] mod tests { #[test] fn check() {} }",
    // Ignored build output must not be subject to authored-file rules.
    "target/generated_tests.rs": "mod tests;",
    ...additions,
  };
  for (const [name, source] of Object.entries(files)) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(
    new URL("../../../scripts/check-repository-layout.ts", import.meta.url),
    join(root, "scripts/check-repository-layout.ts"),
  );
  execFileSync("git", ["init", "--quiet"], { cwd: root, windowsHide: true });
  const result = spawnSync(process.execPath, [checker, root], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.ifError(result.error);
  return result;
}

test("layout check accepts inline Rust tests and ignores generated build output", (t) => {
  const result = fixture(t);
  assert.equal(result.status, 0, result.stderr);
});

test("layout check accepts the separate static website JavaScript", (t) => {
  const result = fixture(t, { "site/src/main.js": "export {};" });
  assert.equal(result.status, 0, result.stderr);
});

for (const name of [
  "src-tauri/tests/contract.rs",
  "src-tauri/src/onnx_tests.rs",
  "src-tauri/src/test_onnx.rs",
]) {
  test(`layout check rejects standalone Rust test file ${name}`, (t) => {
    const result = fixture(t, { [name]: "#[test] fn check() {}" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Rust tests must be inline/);
  });
}

test("layout check rejects arbitrarily named external Rust test modules", (t) => {
  const result = fixture(t, {
    "src-tauri/src/lib.rs": '#[cfg(all(test, windows))]\n#[path = "checks.rs"]\nmod checks;',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /external Rust test modules/);
});

test("layout check rejects a test harness disguised as a maintenance command", (t) => {
  const result = fixture(
    t,
    { "scripts/check-fixture.ts": 'import { test } from "node:test";' },
    { fixture: "node scripts/check-fixture.ts" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /test code belongs in tests/);
});

test("layout check rejects dangling npm entries and orphan maintenance scripts", (t) => {
  const result = fixture(
    t,
    { "scripts/check-orphan.ts": "export {};" },
    { missing: "node scripts/missing.ts" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /references missing scripts\/missing.ts/);
  assert.match(result.stderr, /maintenance scripts must have a package.json entry point/);
});

test("layout check rejects misplaced JavaScript and invalid TypeScript without executing it", (t) => {
  const result = fixture(t, {
    "experiment.mjs": 'throw new Error("must not execute");',
    "tests/unit/tooling/broken.test.ts": "export const = ;",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JavaScript files must be site assets/);
  assert.match(result.stderr, /error TS\d+/);
  assert.doesNotMatch(result.stderr, /Error: must not execute/);
});

test("layout check rejects untyped escapes and type-suppression directives", (t) => {
  const colon = ":";
  const result = fixture(t, {
    "tests/unit/tooling/untyped.test.ts": `const value${colon} any = 1;`,
    "tests/unit/tooling/suppressed.test.ts": "// @ts-" + "ignore\nconst value = 1;",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not use any or type-suppression directives/);
});

test("layout accepts browser harnesses but rejects undiscovered browser tests", (t) => {
  const result = fixture(t, {
    "tests/browser/state/source.harness.js": "export function run() {}",
    "tests/browser/state/missed.test.mjs": "export {};",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missed\.test\.mjs: test files must follow/);
  assert.doesNotMatch(result.stderr, /source\.harness\.js/);
});

test("layout syntax-checks browser harnesses without executing native operations", (t) => {
  const result = fixture(t, {
    "tests/browser/state/valid.harness.js": 'throw new Error("must not execute");',
    "tests/browser/state/broken.harness.js": "export const = ;",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SyntaxError/);
  assert.doesNotMatch(result.stderr, /Error: must not execute/);
});

test("layout check rejects screenshot TODO files in published documentation assets", (t) => {
  const result = fixture(t, { "docs/user-guide/public/images/example.txt": "TODO screenshot" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not screenshot TODO files/);
});

test("layout accepts nested test domains and rejects tests the runners cannot discover", (t) => {
  const valid = fixture(t, {
    "tests/unit/search/query.test.ts": "export {};",
    "tests/browser/components/search/dialog.test.ts": "export {};",
    "tests/browser/state/search.test.ts": "export {};",
    "tests/integration/installer/resources.test.ts": "export {};",
  });
  assert.equal(valid.status, 0, valid.stderr);
  const invalid = fixture(t, {
    "src/editor.test.ts": "export {};",
    "tests/unit/flat.test.ts": "export {};",
    "tests/unit/search/nested/deep.test.ts": "export {};",
    "tests/browser/support/missed.test.ts": "export {};",
    "tests/browser/components/missed.spec.ts": "export {};",
    "tests/browser/components/bypass.test.ts": 'import { test } from "@playwright/test";',
  });
  assert.equal(invalid.status, 1);
  for (const name of ["editor.test.ts", "flat.test.ts", "deep.test.ts", "missed.spec.ts"])
    assert(invalid.stderr.includes(name), invalid.stderr);
  assert.match(invalid.stderr, /shared support\/fixtures diagnostics/);
});
