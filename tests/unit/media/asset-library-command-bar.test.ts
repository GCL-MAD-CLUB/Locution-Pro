import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL(
    "../../../src/components/panels/AssetLibrary/views/AssetLibraryCommandBar.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("toolbar measurement is attached to its rendered element", () => {
  const syntax = ts.createSourceFile(
    "CommandBar.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found = false;
  function visit(node: ts.Node) {
    if (
      ts.isJsxOpeningElement(node) &&
      node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(syntax) === "className" &&
          attribute.initializer &&
          ts.isStringLiteral(attribute.initializer) &&
          attribute.initializer.text === "asset-library-command-bar",
      )
    ) {
      found = node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(syntax) === "ref" &&
          attribute.initializer?.getText(syntax) === "{barRef}",
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  assert.ok(found, "the resize observer requires the toolbar DOM ref");
  assert.ok(!source.includes('label: "??'));
});

test("toolbar collapses below its full width and expands after resizing back", () => {
  const start = source.indexOf("  lifetime.useBeforePaint(() => {");
  const end = source.indexOf("  const commands =", start);
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let compact = false;
  let resize = () => {};
  let release: (() => void) | undefined;
  let disconnected = false;
  const child = {
    getBoundingClientRect: () => ({ width: 100 }),
    classList: { contains: () => false },
  };
  const bar = { clientWidth: 240, children: [child, child] };
  runInNewContext(compiled, {
    barRef: { current: bar },
    setCompact: (value: boolean) => {
      compact = value;
    },
    getComputedStyle: () => ({
      marginLeft: "0px",
      marginRight: "0px",
      columnGap: "5px",
      paddingLeft: "8px",
      paddingRight: "8px",
    }),
    ResizeObserver: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(element: unknown) {
        assert.equal(element, bar);
      }
      disconnect() {
        disconnected = true;
      }
    },
    lifetime: {
      useBeforePaint: (acquire: () => () => void) => {
        release = acquire();
      },
    },
  });
  assert.equal(compact, false);
  bar.clientWidth = 220;
  resize();
  assert.equal(compact, true);
  bar.clientWidth = 240;
  resize();
  assert.equal(compact, false);
  release?.();
  assert.equal(disconnected, true);
});
