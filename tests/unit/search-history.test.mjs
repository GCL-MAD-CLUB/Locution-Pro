import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "./support/module-loader.ts";
import * as textSearch from "../../src/core/editor/textSearch.ts";
import * as storageModule from "../../src/runtime/storage.ts";
import * as searchRules from "../../src/components/common/PanelSearch/searchRules.ts";

const load = createModuleLoader(import.meta.url);
const {
  rememberSearch,
  readSearchHistory,
  searchHistoryText,
  hasAdvancedSearch,
  filterSearchHistory,
} = Object.fromEntries(
  Object.entries(
    load("../../src/components/common/PanelSearch/searchHistory.ts", {
      "../../../core/editor/textSearch": textSearch,
      "../../../runtime/storage": storageModule,
      "./searchRules": searchRules,
    }),
  ).map(([name, fn]) => [name, (...args) => structuredClone(fn(...args))]),
);
const configuration = (query, changes = {}) => ({
  query,
  mode: "filter",
  rule: "contains",
  threshold: 0,
  scope: undefined,
  options: { ...textSearch.defaultAdvancedSearch },
  ...changes,
});
function storage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test("history keeps six LRU entries and updates configuration by generated text", () => {
  const store = storage();
  for (let i = 0; i < 7; i++) rememberSearch("subtitle", configuration(`query ${i}`), store);
  assert.deepEqual(
    readSearchHistory("subtitle", "text", store).map((entry) => entry.text),
    ["query 6", "query 5", "query 4", "query 3", "query 2", "query 1"],
  );
  const updated = configuration("  query\n2  ", {
    mode: "highlight",
    rule: "equals",
    options: {
      ...textSearch.defaultAdvancedSearch,
      excludedText: "draft",
      caseSensitive: true,
      minDuration: "1",
      maxDuration: "3",
    },
  });
  rememberSearch("subtitle", updated, store);
  const history = readSearchHistory("subtitle", "text", store);
  assert.equal(history.length, 6);
  assert.equal(history[0].text, "query 2");
  assert.deepEqual(history[0].configuration, updated);
  assert.equal(history.filter((entry) => entry.text === "query 2").length, 1);
  assert.equal(hasAdvancedSearch(history[0].configuration), true);
  rememberSearch("subtitle", configuration("query 2"), store);
  assert.equal(
    hasAdvancedSearch(readSearchHistory("subtitle", "text", store)[0].configuration),
    false,
  );
});

test("semantic and text histories have independent capacity and subtitle/storyboard remain isolated", () => {
  const store = storage();
  rememberSearch("subtitle", configuration("same", { mode: "highlight" }), store);
  for (let i = 0; i < 8; i++)
    rememberSearch("subtitle", configuration(`semantic ${i}`, { mode: "semantic" }), store);
  rememberSearch("storyboard", configuration("storyboard", { scope: "keywords" }), store);
  assert.equal(readSearchHistory("subtitle", "semantic", store).length, 6);
  assert.deepEqual(
    readSearchHistory("subtitle", "text", store).map((entry) => entry.text),
    ["same"],
  );
  assert.deepEqual(
    readSearchHistory("storyboard", "text", store).map((entry) => entry.text),
    ["storyboard"],
  );
  assert.deepEqual(readSearchHistory("storyboard", "semantic", store), []);
});

test("semantic display normalization deduplicates full prompt configurations and preserves negative prompts and thresholds", () => {
  const store = storage();
  const first = configuration(" sunset \n beach ", {
    mode: "semantic",
    threshold: 0.123,
    options: { ...textSearch.defaultAdvancedSearch, negativePrompts: "crowd\ncity" },
  });
  assert.equal(searchHistoryText(first), "sunset|beach");
  rememberSearch("storyboard", first, store);
  const updated = { ...first, query: "sunset | beach", threshold: 0.234 };
  rememberSearch("storyboard", updated, store);
  const history = readSearchHistory("storyboard", "semantic", store);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].configuration, updated);
  assert.equal(history[0].text.includes("*"), false);
  assert.equal(hasAdvancedSearch(updated), true);
  assert.equal(
    hasAdvancedSearch({
      ...updated,
      options: { ...textSearch.defaultAdvancedSearch, excludedText: "inactive" },
    }),
    false,
  );
});

test("legacy strings migrate only into text history with panel defaults and branding compatibility", () => {
  const store = storage();
  store.setItem("linecut:search-history:subtitle", JSON.stringify([" one ", "one", 1, "two", ""]));
  assert.deepEqual(
    readSearchHistory("subtitle", "text", store).map((entry) => entry.text),
    ["one", "two"],
  );
  assert.equal(readSearchHistory("subtitle", "text", store)[0].configuration.rule, "containsAll");
  assert.deepEqual(readSearchHistory("subtitle", "semantic", store), []);
  rememberSearch("subtitle", configuration("three"), store);
  assert.deepEqual(
    readSearchHistory("subtitle", "text", store).map((entry) => entry.text),
    ["three", "one", "two"],
  );
});

test("storage recovery ignores malformed records and derives labels from configurations", () => {
  const store = storage();
  store.setItem(
    "locution-pro:search-history:subtitle:text",
    JSON.stringify([
      null,
      "legacy",
      { configuration: {} },
      { text: "forged", configuration: configuration("actual") },
      { configuration: configuration("actual") },
      { configuration: configuration("wrong space", { mode: "semantic" }) },
    ]),
  );
  assert.deepEqual(
    readSearchHistory("subtitle", "text", store).map((entry) => entry.text),
    ["actual"],
  );
  const bad = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.deepEqual(readSearchHistory("subtitle", "text", bad), []);
  assert.equal(
    rememberSearch("subtitle", configuration("still usable"), bad)[0].text,
    "still usable",
  );
  assert.deepEqual(
    rememberSearch("subtitle", configuration("[", { rule: "regex" }), store).map(
      (entry) => entry.text,
    ),
    ["actual"],
  );
  assert.equal(rememberSearch("subtitle", configuration("  "), store).length, 1);
});

test("prefix filtering uses display text and exact display text defines identity", () => {
  const store = storage();
  rememberSearch("subtitle", configuration("Hello"), store);
  rememberSearch("subtitle", configuration("hello"), store);
  rememberSearch("subtitle", configuration("other"), store);
  assert.deepEqual(
    filterSearchHistory(readSearchHistory("subtitle", "text", store), " HEL ").map(
      (entry) => entry.text,
    ),
    ["hello", "Hello"],
  );
});
