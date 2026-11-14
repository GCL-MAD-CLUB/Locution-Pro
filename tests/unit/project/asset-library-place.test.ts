import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";
import type {
  AssetLibraryFolder,
  AssetLibraryRoot,
  ProjectAssetLibraryState,
} from "../../../src/types.ts";

type PlaceModule = typeof import("../../../src/core/editor/assetLibraryPlace.ts");
type ColumnsModule =
  typeof import("../../../src/components/panels/AssetLibrary/assetLibraryColumns.ts");

const load = createModuleLoader(import.meta.url);
const timeline = load<typeof import("../../../src/core/editor/timeline.ts")>(
  "../../../src/core/editor/timeline.ts",
);
const assetLibrary = load<typeof import("../../../src/core/editor/assetLibrary.ts")>(
  "../../../src/core/editor/assetLibrary.ts",
  { "./timeline": timeline },
);
const place = load<PlaceModule>("../../../src/core/editor/assetLibraryPlace.ts", {
  "./assetLibrary": assetLibrary,
});
const columns = load<ColumnsModule>(
  "../../../src/components/panels/AssetLibrary/assetLibraryColumns.ts",
);

function folder(
  id: string,
  parentId: string | null,
  name: string,
  root: AssetLibraryRoot = "subtitles",
): AssetLibraryFolder {
  return { id, root, parent_id: parentId, name, created_at: 1, hidden: false };
}

const library: ProjectAssetLibraryState = {
  folders: [folder("a", null, "访谈"), folder("s", null, "镜头", "storyboards")],
  entries: [],
};
const project = { root: "project" as const, folderId: null };
const json = (value: unknown) => JSON.stringify(value);

test("address-bar text starts at the project", () => {
  assert.equal(place.assetLibraryPlacePathText(library, project), "此项目");
  assert.equal(
    place.assetLibraryPlacePathText(library, { root: "subtitles", folderId: "a" }),
    "此项目\\字幕\\访谈",
  );
});

test("typed paths may start at the project, which needs a library name next", () => {
  const inSubtitles = { root: "subtitles" as const, folderId: null };
  assert.equal(
    json(place.assetLibraryPlaceFromPath(library, " 此项目 ", inSubtitles)),
    json(project),
  );
  assert.equal(
    json(place.assetLibraryPlaceFromPath(library, "此项目\\分镜\\镜头", inSubtitles)),
    json({ root: "storyboards", folderId: "s" }),
  );
  assert.equal(
    json(place.assetLibraryPlaceFromPath(library, "字幕/访谈", project)),
    json({ root: "subtitles", folderId: "a" }),
  );
  assert.equal(
    json(place.assetLibraryPlaceFromPath(library, "访谈", inSubtitles)),
    json({ root: "subtitles", folderId: "a" }),
  );
  assert.equal(place.assetLibraryPlaceFromPath(library, "访谈", project), null);
  assert.equal(place.assetLibraryPlaceFromPath(library, "此项目\\访谈", inSubtitles), null);
});

test("the project lists every column of both libraries", () => {
  const ids = (scope: Parameters<ColumnsModule["assetLibraryColumnsForRoot"]>[0]) =>
    columns.assetLibraryColumnsForRoot(scope).map((column) => column.id);
  const projectIds = new Set(ids("project"));
  for (const id of [...ids("subtitles"), ...ids("storyboards")]) {
    assert.ok(projectIds.has(id), `project columns miss ${id}`);
  }
  assert.equal(ids("project").at(-1), "hidden");
});
