import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";

const load = createModuleLoader(import.meta.url);
const columns = load<
  typeof import("../../../src/components/panels/AssetLibrary/assetLibraryColumns.ts")
>("../../../src/components/panels/AssetLibrary/assetLibraryColumns.ts");

test("subtitle and storyboard libraries expose their own fields and column menus", () => {
  const subtitles = columns.assetLibraryColumnsForRoot("subtitles").map((column) => column.id);
  const storyboards = columns.assetLibraryColumnsForRoot("storyboards").map((column) => column.id);
  assert.ok(subtitles.includes("subtitle"));
  assert.ok(!subtitles.includes("keywords"));
  assert.ok(storyboards.includes("keywords"));
  assert.ok(!storyboards.includes("subtitle"));
  for (const root of ["subtitles", "storyboards"] as const) {
    const menu = columns.assetLibraryToggleableColumns(root).map((column) => column.id);
    assert.ok(!menu.includes("name"));
    assert.ok(!menu.includes("location"));
    assert.ok(!menu.includes("keywords") || root === "storyboards");
  }
});

interface Element {
  props: Record<string, unknown>;
}

function descendants(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(descendants);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...descendants(element.props.children)];
}

function headerFixture(ids: string[]) {
  const jsx = (_type: unknown, props: Record<string, unknown>) => ({ props });
  const changes: [string, number][] = [];
  const header = load<
    typeof import("../../../src/components/panels/AssetLibrary/views/AssetLibraryListHeader.tsx")
  >(
    "../../../src/components/panels/AssetLibrary/views/AssetLibraryListHeader.tsx",
    {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: {
        useRef: (current: unknown) => ({ current }),
        useState: (initial: unknown) => [initial, () => {}],
        useEffect: () => {},
        useLayoutEffect: () => {},
      },
      "react-dom": {},
      "../../../common/PopupMenu": { useCloseOnOutsidePointer: () => {} },
      "../assetLibraryColumns": columns,
    },
    { document: { body: { classList: { add() {}, remove() {} } } } },
  );
  const rendered = header.AssetLibraryListHeader({
    root: "storyboards",
    columns: columns
      .assetLibraryColumnsForRoot("storyboards")
      .filter((column) => ids.includes(column.id)),
    columnWidths: columns.defaultAssetLibraryColumnWidths,
    visibleColumns: new Set(["source", "duration", "marks"]),
    sort: { key: "name", direction: "ascending" },
    itemCount: 1,
    selectedCount: 0,
    itemCheckboxes: false,
    onSort() {},
    onToggleColumn() {},
    onColumnWidthChange: (id, width) => changes.push([id, width]),
    onResetColumnWidths() {},
    onToggleAllSelected() {},
  });
  const handles = descendants(rendered).filter(
    (element) => element.props.className === "media-bin-column-resizer",
  );
  return { handles, changes };
}

function invoke(handle: Element, eventName: string, clientX: number) {
  const handler = handle.props[eventName] as (event: unknown) => void;
  handler({
    button: 0,
    pointerId: 1,
    clientX,
    preventDefault() {},
    stopPropagation() {},
    currentTarget: {
      setPointerCapture() {},
      hasPointerCapture: () => true,
      releasePointerCapture() {},
    },
  });
}

test("dragging a boundary grows the preceding visible column and hidden columns are skipped", () => {
  const { handles, changes } = headerFixture(["source", "duration", "marks"]);
  const expected = ["name", "source", "duration", "marks"] as const;
  assert.equal(handles.length, expected.length);
  handles.forEach((handle, index) => {
    invoke(handle, "onPointerDown", 100);
    invoke(handle, "onPointerMove", 140);
    invoke(handle, "onPointerUp", 140);
    assert.deepEqual(changes.at(-1), [
      expected[index],
      columns.defaultAssetLibraryColumnWidths[expected[index]!] + 40,
    ]);
  });
});

test("name remains resizable when all optional columns are hidden, and capture loss stops resizing", () => {
  const { handles, changes } = headerFixture([]);
  assert.equal(handles.length, 1);
  invoke(handles[0]!, "onPointerDown", 100);
  invoke(handles[0]!, "onPointerMove", 80);
  invoke(handles[0]!, "onLostPointerCapture", 80);
  invoke(handles[0]!, "onPointerMove", 60);
  assert.deepEqual(changes, [["name", columns.defaultAssetLibraryColumnWidths.name - 20]]);
});
