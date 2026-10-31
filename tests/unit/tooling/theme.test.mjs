import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";
import { clientError } from "../../../src/errors/model.ts";

const sourceRoot = new URL("../../../src/", import.meta.url);
const stylesheet = readFileSync(new URL("styles.css", sourceRoot), "utf8");
const rootTheme = stylesheet.match(/:root[^{]*\{([^}]+)\}/)[1];
const colors = new Map(
  Array.from(rootTheme.matchAll(/(--(?:color|palette)-[\w-]+):\s*([^;]+);/g), ([, name, value]) => [
    name,
    value.trim(),
  ]),
);
const load = createModuleLoader(import.meta.url);
const theme = load("../../../src/runtime/theme.ts", {
  "../styles.css?raw": stylesheet,
  "../errors/model": { clientError },
});
const references = (source) =>
  Array.from(source.matchAll(/--(?:color|palette)-[\w-]+/g), ([token]) => token);
const sourceFiles = readdirSync(sourceRoot, { recursive: true }).filter((name) =>
  /\.(?:css|tsx?|svg)$/.test(name),
);

function colorIdentity(value) {
  if (value === "transparent") return "0,0,0,0";
  if (value.startsWith("#")) {
    let hex = value.slice(1).toLowerCase();
    if (hex.length < 5) hex = Array.from(hex, (channel) => channel + channel).join("");
    const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    return [...channels, hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1].join(",");
  }
  const channels = Array.from(value.matchAll(/[\d.]+%?/g), ([number], index) =>
    number.endsWith("%") ? parseFloat(number) * (index === 3 ? 0.01 : 2.55) : Number(number),
  );
  return [...channels.slice(0, 3), channels[3] ?? 1].join(",");
}

test("theme literals are unique and all frontend colors are centralized", () => {
  const identities = new Map();
  for (const [name, value] of colors) {
    assert.doesNotMatch(name, /neutral-\d|(?:black|white)-\d/);
    if (value.startsWith("var(")) continue;
    const identity = colorIdentity(value);
    assert.equal(
      identities.get(identity),
      undefined,
      `${name} duplicates ${identities.get(identity)}`,
    );
    identities.set(identity, name);
  }
  for (const name of sourceFiles) {
    let source = readFileSync(new URL(name.replaceAll("\\", "/"), sourceRoot), "utf8");
    if (name === "styles.css") source = source.replace(rootTheme, "");
    assert.doesNotMatch(source, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(|%23[\da-f]{3,8}\b/i, name);
    if (name.endsWith(".css")) {
      assert.doesNotMatch(source, /:\s*(?:white|black|transparent)\s*[; }]/i, name);
      assert.doesNotMatch(source, /(?<!theme-)color-scheme:\s*(?:dark|light)\s*;/, name);
    }
  }
});

test("dark and light appearances explicitly define every semantic color role", () => {
  const roles = [...colors.keys()].filter((token) => token.startsWith("--color-"));
  for (const appearance of ["dark", "light"]) {
    const block = stylesheet.match(
      new RegExp(`\\[data-theme="${appearance}"\\]\\s*\\{([^}]+)\\}`),
    )[1];
    const overrides = new Map(
      Array.from(block.matchAll(/(--color-[\w-]+):\s*([^;]+);/g), ([, name, value]) => [
        name,
        value,
      ]),
    );
    assert.deepEqual([...overrides.keys()].sort(), [...roles].sort());
    for (const [name, value] of overrides) {
      assert.match(value, /^var\(\s*--palette-[\w-]+\s*\)$/, name);
      for (const token of references(value)) assert.ok(colors.has(token), token);
    }
  }
});

test("every theme token is used, defined, and resolves without cycles", () => {
  const used = new Set();
  for (const name of sourceFiles) {
    let source = readFileSync(new URL(name.replaceAll("\\", "/"), sourceRoot), "utf8");
    if (name === "styles.css") {
      source = source.replace(rootTheme, "");
      source += Array.from(
        rootTheme.matchAll(/--(?!color-)[\w-]+:\s*([^;]+);/g),
        ([, value]) => value,
      ).join("\n");
    }
    for (const token of references(source)) used.add(token);
  }
  function visit(token, ancestors = []) {
    assert.ok(colors.has(token), `Undefined theme token: ${token}`);
    assert.ok(
      !ancestors.includes(token),
      `Cyclic theme token: ${[...ancestors, token].join(" -> ")}`,
    );
    for (const dependency of references(colors.get(token))) {
      used.add(dependency);
      visit(dependency, [...ancestors, token]);
    }
  }
  for (const token of used) visit(token);
  for (const token of colors.keys())
    assert.doesNotMatch(theme.defaultThemeColor(token), /var\(/, token);
  assert.deepEqual(
    [...colors.keys()].filter((token) => !used.has(token)),
    [],
  );
});

test("saved media defaults remain concrete colors and cursor SVGs contain resolved colors", () => {
  assert.equal(theme.defaultThemeColor("--color-media-subtitle"), "#893a04");
  assert.equal(theme.defaultThemeColor("--color-media-video"), "#3e0aae");
  assert.equal(theme.defaultThemeColor("--color-media-video-audio"), "#004b67");
  assert.equal(theme.defaultThemeColor("--color-media-audio"), "#2a5507");
  assert.equal(theme.defaultThemeColor("--color-media-folder"), "#596b91");
  assert.equal(theme.mediaDisplayColor("#596B91"), "var(--color-media-folder)");
  assert.equal(theme.mediaDisplayColor("#3e0aae"), "var(--color-media-video)");
  assert.equal(theme.mediaDisplayColor("#123456"), "#123456");
  assert.throws(() => theme.defaultThemeColor("--color-missing"), /Unknown theme color/);
  const cursors = load("../../../src/components/common/utils/sprayToolModifiers.ts", {
    "../../../runtime/theme": theme,
    react: {},
  });
  for (const name of [
    "sprayEraserCursor",
    "sprayEyedropperAddCursor",
    "sprayEyedropperRemoveCursor",
  ]) {
    const cursor = cursors[name]();
    const svg = decodeURIComponent(cursor.match(/data:image\/svg\+xml,([^"]+)/)[1]);
    assert.doesNotMatch(svg, /var\(/);
    assert.match(svg, /<svg[^>]+viewBox=/);
    assert.match(svg, /stroke="#202020"/);
    assert.match(cursor, /\) 4 (?:17|18), crosshair$/);
  }
});
