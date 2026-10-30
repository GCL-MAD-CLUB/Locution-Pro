import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchesTextSearch,
  textSearchRanges,
  defaultAdvancedSearch,
  advancedSearchErrors,
  searchQueryToMultiline,
  searchQueryToSingleLine,
} from "../../../src/core/editor/textSearch.ts";

test("text search converts whitespace runs between single-line and multiline inputs", () => {
  for (const mode of ["filter", "highlight"]) {
    assert.equal(
      searchQueryToSingleLine("  alpha\n\n beta\t \r\n gamma\u3000delta  ", mode),
      "alpha beta gamma delta",
    );
    assert.equal(
      searchQueryToMultiline("alpha  beta\t gamma\u3000delta", mode),
      "alpha\nbeta\ngamma\ndelta",
    );
    assert.equal(
      searchQueryToSingleLine(searchQueryToMultiline("alpha beta", mode), mode),
      "alpha beta",
    );
    assert.equal(searchQueryToMultiline(" \n\t ", mode), "");
    assert.equal(searchQueryToSingleLine("(cat|dog)\\s+here", mode), "(cat|dog)\\s+here");
  }
  assert.equal(matchesTextSearch(["hello world"], "hello\n\t world", "equals"), true);
  assert.equal(matchesTextSearch(["hello world"], "hello\nworld", "regex"), true);
  assert.deepEqual(textSearchRanges("hello world", "hello\nworld", "equals"), [
    { start: 0, end: 11 },
  ]);
});

test("semantic search uses pipes as prompt boundaries and preserves spaces inside descriptions", () => {
  assert.equal(
    searchQueryToSingleLine(" a sunny beach\n\n a moonlit city ", "semantic"),
    "a sunny beach|a moonlit city",
  );
  assert.equal(
    searchQueryToMultiline("a sunny beach | | a moonlit city || ", "semantic"),
    "a sunny beach\na moonlit city",
  );
  assert.equal(
    searchQueryToMultiline("sunset\r\n|beach\u2028city", "semantic"),
    "sunset\nbeach\ncity",
  );
  assert.equal(searchQueryToSingleLine(" || \n ", "semantic"), "");
  assert.ok(
    advancedSearchErrors("one | two", "semantic", "contains", {
      ...defaultAdvancedSearch,
      negativePrompts: "two",
    }).query,
  );
  assert.match(
    advancedSearchErrors(
      Array.from({ length: 11 }, (_, i) => `p${i}`).join("|"),
      "semantic",
      "contains",
      defaultAdvancedSearch,
    ).query,
    /最多 10/,
  );
});
