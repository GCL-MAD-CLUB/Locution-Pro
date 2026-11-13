import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("../../../scripts/check-media-sources.ts", import.meta.url));

function check(t: TestContext, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "locution-pro-media-sources-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  const result = spawnSync(process.execPath, [checker, root], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.ifError(result.error);
  return result;
}

const frontend = (commands: string[]) => `const mediaCommands = new Set([
${commands.map((command) => `  "${command}",`).join("\n")}
]);
`;

const command = (name: string, parameters: string, body = "") => `#[tauri::command]
pub(crate) async fn ${name}(
    ${parameters}
) -> CommandResult<()> {
    ${body}
}
`;

const aligned = {
  "src/runtime/mediaSources.ts": frontend(["detect_storyboard_shots"]),
  "src-tauri/src/backend/media.rs": [
    command(
      "detect_storyboard_shots",
      "media_sources: crate::MediaSources,\n    asset_id: String,",
    ),
    command("export_clips", "clips: Vec<ExportClip>,\n    options: ExportOptions,"),
    command("path_is_file", "path: String,", 'let _comment = "MediaSources";'),
  ].join("\n"),
};

test("the injection list matches MediaSources commands and keeps path-based export out", (t) => {
  const result = check(t, aligned);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed/);
});

test("a new MediaSources command missing from the frontend list fails", (t) => {
  const result = check(t, {
    ...aligned,
    "src-tauri/src/backend/media.rs": `${aligned["src-tauri/src/backend/media.rs"]}\n${command(
      "read_storyboard_graph_vectors",
      "media_sources: crate::MediaSources,\n    shots: Vec<Shot>,",
    )}`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /read_storyboard_graph_vectors takes MediaSources/);
});

test("a frontend command that no longer takes MediaSources fails", (t) => {
  const result = check(t, {
    ...aligned,
    "src/runtime/mediaSources.ts": frontend(["detect_storyboard_shots", "path_is_file"]),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /path_is_file is injected/);
});

test("listing the ExportClip exception in the injection set fails", (t) => {
  const result = check(t, {
    ...aligned,
    "src/runtime/mediaSources.ts": frontend(["detect_storyboard_shots", "export_clips"]),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /export_clips .* must not be in the frontend injection set/);
});

test("giving the ExportClip exception a MediaSources parameter fails", (t) => {
  const result = check(t, {
    ...aligned,
    "src-tauri/src/backend/media.rs": [
      command(
        "detect_storyboard_shots",
        "media_sources: crate::MediaSources,\n    asset_id: String,",
      ),
      command("export_clips", "clips: Vec<ExportClip>,\n    media_sources: crate::MediaSources,"),
    ].join("\n"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /export_clips .* now takes MediaSources/);
});
