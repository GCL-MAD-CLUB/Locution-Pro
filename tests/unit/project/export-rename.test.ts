import { createModuleLoader } from "../support/module-loader.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExportClip, ExportSettings } from "../../../src/systems/ExportSystem/exportTypes.ts";

const loadModule = createModuleLoader(import.meta.url);

const exportTypesModule = loadModule<
  typeof import("../../../src/systems/ExportSystem/exportTypes.ts")
>("../../../src/systems/ExportSystem/exportTypes.ts", {});

const rename = loadModule<typeof import("../../../src/systems/ExportSystem/exportRename.ts")>(
  "../../../src/systems/ExportSystem/exportRename.ts",
  {
    "../../core/editor/time": { formatMonitorTime: () => "00:00:00:00" },
    "./exportTypes": exportTypesModule,
  },
);

const emoji = "\u{1F600}";

function settings(
  customName: string,
): Pick<
  ExportSettings,
  "renameRule" | "customName" | "startNumber" | "extensionCase" | "container"
> {
  return {
    renameRule: "custom",
    customName,
    startNumber: 1,
    extensionCase: "lower",
    container: "mp4_h264",
  };
}

test("clampFileName counts Unicode scalars and does not split a surrogate pair", () => {
  const atLimit = `${"a".repeat(115)}${emoji}.mp4`;
  assert.equal(atLimit.length, 121);
  assert.equal([...atLimit].length, 120);
  assert.equal(rename.clampFileName(atLimit), atLimit);

  const boundary = `${"a".repeat(115)}${emoji}b.mp4`;
  assert.equal(rename.clampFileName(boundary), `${"a".repeat(115)}${emoji}.mp4`);
  assert.equal(rename.clampFileName(`${"a".repeat(200)}.mp4`), `${"a".repeat(116)}.mp4`);
  assert.equal(rename.clampFileName("short.mp4"), "short.mp4");
  assert.equal(rename.clampFileName(`${"a".repeat(119)}${emoji}`), `${"a".repeat(119)}${emoji}`);
});

test("export file name preview keeps a surrogate pair near the length limit", () => {
  const base = `${"a".repeat(113)}${emoji}z`;
  const names = rename.computeExportFileNames(
    [{ id: "a" }, { id: "b" }] as ExportClip[],
    settings(base),
  );
  assert.equal(names[0].fileName, `${base}.mp4`);
  assert.equal(names[1].fileName, `${"a".repeat(113)}${emoji}-1.mp4`);
  assert.equal([...names[1].fileName].length, 120);
});
