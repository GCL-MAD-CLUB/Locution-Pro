import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { ESLint } from "eslint";
import { analyzeFrontend } from "../../../../tooling/frontend/architecture.ts";

function fixture(t: TestContext, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "locution-architecture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, source] of Object.entries({ "package.json": "{}", ...files })) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return analyzeFrontend(root);
}

test("lint enforces source placement, layer direction, and public owner entries", async () => {
  const eslint = new ESLint();
  const cases = [
    ["src/application/loose.ts", "export {};", "Group feature code"],
    [
      "src/core/editor/search/example.ts",
      'export type Shell = typeof import("../../../app/App");',
      "higher layer",
    ],
    [
      "src/components/panels/SubtitlePanel/example.ts",
      'export { Shot } from "../StoryboardPanel";',
      "Panels are independent",
    ],
    [
      "src/app/example.ts",
      'export type { TaskProgressView } from "../systems/TaskSystem/TaskSystem";',
      "public index.ts",
    ],
    [
      "src/app/example.ts",
      'export const dependency = import("@tauri-apps/api/core");',
      "Use the Tauri adapters",
    ],
    ["site/_worker.ts", 'export * from "./src/download.ts";', "share the release contract"],
  ] as const;
  for (const [filePath, source, expected] of cases) {
    const [result] = await eslint.lintText(source, { filePath });
    assert(
      result.messages.some(
        (message) =>
          message.ruleId === "project-architecture/boundaries" &&
          message.message.includes(expected),
      ),
      JSON.stringify(result.messages),
    );
  }
});

test("graph follows workers, type imports, and re-exports and reports orphan modules and packages", (t) => {
  const result = fixture(t, {
    "package.json": '{"dependencies":{"react":"*","unused":"*"}}',
    "src/main.tsx": `
      import { start } from "./app/start";
      new Worker(new URL("./application/mediaImport/worker.ts", import.meta.url));
      start();
    `,
    "src/app/start.ts": 'export { start } from "./shell";',
    "src/app/shell.ts":
      'import type { Media } from "../types"; import "react"; export const start = () => {};',
    "src/types.ts": "export interface Media {}",
    "src/application/mediaImport/worker.ts": "export {};",
    "src/application/mediaImport/orphan.ts": "export {};",
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.unreachable, ["src/application/mediaImport/orphan.ts"]);
  assert.deepEqual(result.unusedPackages, ["unused"]);
  assert.deepEqual(result.packages, { react: ["src/app/shell.ts"] });
  assert(
    result.groups.some(
      ({ from, to, kind }) =>
        from === "src/app" && to === "src/application/mediaImport" && kind === "asset",
    ),
  );
  assert(
    result.modules.some(({ dependencies }) =>
      dependencies.some(({ kind, target }) => kind === "type" && target === "src/types.ts"),
    ),
  );
});

test("graph rejects module and owner cycles and detects dependencies it cannot resolve", (t) => {
  const result = fixture(t, {
    "src/main.tsx": 'import "./systems/First";',
    "src/systems/First/index.ts": 'export * from "./first";',
    "src/systems/First/first.ts": 'export type First = import("../Second").Second;',
    "src/systems/Second/index.ts": 'export * from "./second";',
    "src/systems/Second/second.ts": `
      export type Second = import("../First").First;
      import "./missing";
      import("undeclared");
      const specifier = "./variable";
      import(specifier);
    `,
  });
  const messages = result.issues.map(({ message }) => message);
  for (const expected of [
    "Module cycle",
    "Owner cycle",
    "unresolved local",
    "direct production dependency",
    "literal module path",
  ]) {
    assert(
      messages.some((message) => message.includes(expected)),
      expected,
    );
  }
});
