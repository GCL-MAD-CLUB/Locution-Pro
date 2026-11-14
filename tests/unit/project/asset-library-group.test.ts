import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";
import type { AssetLibraryAnnotation, AssetLibraryEntry } from "../../../src/types.ts";

type GroupModule = typeof import("../../../src/core/editor/assetLibraryGroup.ts");
type GroupItem = import("../../../src/core/editor/assetLibraryGroup.ts").AssetLibraryGroupItem;

const load = createModuleLoader(import.meta.url);
const timeline = load<typeof import("../../../src/core/editor/timeline.ts")>(
  "../../../src/core/editor/timeline.ts",
);
const assetLibrary = load<typeof import("../../../src/core/editor/assetLibrary.ts")>(
  "../../../src/core/editor/assetLibrary.ts",
  { "./timeline": timeline },
);
const filter = load<typeof import("../../../src/core/editor/assetLibraryFilter.ts")>(
  "../../../src/core/editor/assetLibraryFilter.ts",
  { "./assetLibrary": assetLibrary },
);
const groups = load<GroupModule>("../../../src/core/editor/assetLibraryGroup.ts", {
  "./assetLibrary": assetLibrary,
  "./assetLibraryFilter": filter,
});

function entry(name: string, annotation: Partial<AssetLibraryAnnotation> = {}): GroupItem {
  const value = {
    id: name,
    root: "subtitles",
    folder_id: null,
    name,
    created_at: 1,
    media: {} as unknown as AssetLibraryEntry["media"],
    start_us: 0,
    end_us: 1_000_000,
    text: "",
    annotation: {
      rating: 0,
      retained: false,
      excluded: false,
      color_label: null,
      custom_label: null,
      title: null,
      keywords: [],
      ...annotation,
    },
    hidden: false,
  } satisfies AssetLibraryEntry;
  return { kind: "entry", name, createdAt: value.created_at, entry: value };
}

function folder(name: string, createdAt = 1): GroupItem {
  return { kind: "folder", name, createdAt, entry: null };
}

const summary = (items: GroupItem[], grouping: GroupModule["noAssetLibraryGrouping"], now = 0) =>
  groups
    .groupedAssetLibraryItems(items, (item) => item, grouping, now)
    .map((group) => `${group.label}:${group.items.map((item) => item.name).join(",")}`);

test("no grouping key gives no groups", () => {
  assert.equal(summary([folder("a")], groups.noAssetLibraryGrouping).length, 0);
});

test("names group by letter range, with Chinese names under their pinyin initial", () => {
  assert.equal(groups.assetLibraryNameInitial("访谈"), "F");
  assert.equal(groups.assetLibraryNameInitial("镜头"), "J");
  assert.equal(groups.assetLibraryNameInitial("1号"), "0");
  assert.equal(groups.assetLibraryNameInitial("_x"), null);
  const items = [folder("镜头"), folder("Zoom"), folder("访谈"), folder("2"), folder("#")];
  assert.equal(
    JSON.stringify(summary(items, groups.assetLibraryGroupingFor("name"))),
    JSON.stringify(["0 - 9:2", "Q - Z:Zoom", "拼音 A - F:访谈", "拼音 G - L:镜头", "其他:#"]),
  );
});

test("dates fall into relative groups, newest first by default", () => {
  const now = new Date(2026, 10, 12, 15).getTime(); // A Thursday.
  const at = (month: number, day: number, year = 2026) => new Date(year, month, day, 9).getTime();
  const label = (time: number) => groups.assetLibraryDateGroup(time, now).label;
  assert.equal(label(at(10, 12)), "今天");
  assert.equal(label(at(10, 11)), "昨天");
  assert.equal(label(at(10, 9)), "本周早些时候");
  assert.equal(label(at(10, 3)), "上周");
  assert.equal(label(at(10, 1)), "这个月的早些时候");
  assert.equal(label(at(9, 20)), "上个月");
  assert.equal(label(at(1, 1)), "今年早些时候");
  assert.equal(label(at(11, 30, 2025)), "很久以前");
  const items = [folder("old", at(1, 1)), folder("new", at(10, 12)), folder("mid", at(10, 3))];
  assert.equal(
    JSON.stringify(summary(items, groups.assetLibraryGroupingFor("created"), now)),
    JSON.stringify(["今天:new", "上周:mid", "今年早些时候:old"]),
  );
});

test("entry-only keys put folders last as unspecified, whatever the direction", () => {
  const items = [folder("f"), entry("a", { rating: 2 }), entry("b"), entry("c", { rating: 5 })];
  assert.equal(
    JSON.stringify(summary(items, groups.assetLibraryGroupingFor("rating"))),
    JSON.stringify(["5 星:c", "2 星:a", "未分级:b", "未指定:f"]),
  );
  assert.equal(
    JSON.stringify(summary(items, { key: "rating", direction: "ascending" })),
    JSON.stringify(["未分级:b", "2 星:a", "5 星:c", "未指定:f"]),
  );
});

test("kind, flag and color keep item order inside each group", () => {
  const items = [
    folder("f"),
    entry("a", { color_label: "red" }),
    entry("b", { custom_label: "精选", retained: true }),
    entry("c", { color_label: "red", excluded: true }),
  ];
  assert.equal(
    JSON.stringify(summary(items, groups.assetLibraryGroupingFor("kind"))),
    JSON.stringify(["文件夹:f", "字幕素材:a,b,c"]),
  );
  assert.equal(
    JSON.stringify(summary(items, groups.assetLibraryGroupingFor("flag"))),
    JSON.stringify(["留用:b", "无旗标:a", "排除:c", "未指定:f"]),
  );
  assert.equal(
    JSON.stringify(summary(items, groups.assetLibraryGroupingFor("color"))),
    JSON.stringify(["红色:a,c", "自定义:b", "未指定:f"]),
  );
});
