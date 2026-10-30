import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canHighlightSearchRule,
  matchesTextSearch,
  textSearchRanges,
  nextSearchMatchIndex,
  defaultAdvancedSearch,
  matchesSearchDuration,
  searchPatternError,
  searchLines,
  advancedSearchErrors,
  promptCharacterCount,
  semanticPromptErrors,
  searchQueryToMultiline,
  searchQueryToSingleLine,
} from "../../src/core/editor/textSearch.ts";

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

test("semantic prompt limits count nonempty entries and weighted Unicode characters", () => {
  const validate = (query, negativePrompts = "") =>
    advancedSearchErrors(query, "semantic", "contains", {
      ...defaultAdvancedSearch,
      negativePrompts,
    });
  assert.equal(promptCharacterCount("A中😀"), 5);
  assert.deepEqual(validate(Array.from({ length: 10 }, (_, i) => `p${i}`).join("\n")), {});
  assert.match(validate(Array.from({ length: 11 }, (_, i) => `p${i}`).join("\n")).query, /最多 10/);
  assert.match(
    validate("positive", Array.from({ length: 11 }, (_, i) => `n${i}`).join("\n")).negativePrompts,
    /最多 10/,
  );
  assert.deepEqual(validate("a".repeat(1000), "中".repeat(500)), {});
  assert.match(validate("a".repeat(1001)).query, /第 1 项超过 1000/);
  assert.match(validate("one\nsecond", "first\n" + "a".repeat(1001)).negativePrompts, /超过 1000/);
  assert.match(validate("a".repeat(999) + "中").query, /超过 1000/);
  assert.deepEqual(validate(" \r\n one \n", "\n two\r\n "), {});
});

test("semantic prompt gating is independent of rule and duration options", () => {
  assert.deepEqual(semanticPromptErrors("  one \n two |", "\n three \r\n"), {});
  assert.deepEqual(
    semanticPromptErrors("one\nshared", "shared"),
    advancedSearchErrors("one\nshared", "semantic", "regex", {
      ...defaultAdvancedSearch,
      negativePrompts: "shared",
    }),
  );
  assert.deepEqual(Object.keys(semanticPromptErrors("", "negative")), ["query"]);
  assert.match(semanticPromptErrors("", "negative").query, /正向描述/);
});

test("advanced errors identify each offending input and highlight both sides of conflicts", () => {
  const duplicate = advancedSearchErrors("one\n shared ", "semantic", "contains", {
    ...defaultAdvancedSearch,
    negativePrompts: "shared\ntwo",
  });
  assert.match(duplicate.query, /重复/);
  assert.match(duplicate.negativePrompts, /重复/);
  const errors = advancedSearchErrors("[", "filter", "regex", {
    ...defaultAdvancedSearch,
    minDuration: "-1",
    maxDuration: "not a number",
  });
  assert.ok(errors.query);
  assert.equal(errors.minDuration, "最短时长必须为非负数。");
  assert.equal(errors.maxDuration, "最长时长必须为数字。");
  const reversed = advancedSearchErrors("", "filter", "contains", {
    ...defaultAdvancedSearch,
    minDuration: "5",
    maxDuration: "2",
  });
  assert.equal(reversed.minDuration, reversed.maxDuration);
  assert.ok(reversed.minDuration);
  assert.deepEqual(advancedSearchErrors("", "filter", "contains", defaultAdvancedSearch), {});
  assert.equal(
    matchesSearchDuration(0, 10_000_000, {
      ...defaultAdvancedSearch,
      minDuration: " ",
      maxDuration: " ",
    }),
    true,
  );
  assert.ok(
    advancedSearchErrors("", "semantic", "contains", {
      ...defaultAdvancedSearch,
      negativePrompts: "one",
    }).query,
  );
});

test("duration validation distinguishes nonnumeric values from negative numbers", () => {
  for (const [field, label] of [
    ["minDuration", "最短"],
    ["maxDuration", "最长"],
  ]) {
    for (const value of ["你好", "abc", "12x", "NaN", "Infinity"]) {
      const errors = advancedSearchErrors("", "filter", "contains", {
        ...defaultAdvancedSearch,
        [field]: value,
      });
      assert.equal(errors[field], `${label}时长必须为数字。`);
    }
    for (const value of ["-1", "-0.1"]) {
      const errors = advancedSearchErrors("", "filter", "contains", {
        ...defaultAdvancedSearch,
        [field]: value,
      });
      assert.equal(errors[field], `${label}时长必须为非负数。`);
    }
    for (const value of ["", " ", "0", "0.5", "12"]) {
      assert.deepEqual(
        advancedSearchErrors("", "filter", "contains", {
          ...defaultAdvancedSearch,
          [field]: value,
        }),
        {},
      );
    }
  }
});

test("advanced text rules combine inclusion, exclusion and case sensitivity", () => {
  const options = { ...defaultAdvancedSearch, excludedText: "draft\nrough cut" };
  assert.equal(matchesTextSearch(["Hello world", "draft"], "hello", "contains", options), false);
  assert.equal(matchesTextSearch(["Hello world"], "hello", "contains", options), true);
  assert.equal(
    matchesTextSearch(["Hello world"], "hello", "contains", { ...options, caseSensitive: true }),
    false,
  );
  assert.equal(matchesTextSearch(["DRAFT"], "", "contains", options), false);
  assert.equal(matchesTextSearch(["a+b"], "a+b", "equals"), true);
  assert.equal(matchesTextSearch(["a+b extra"], "a+b", "equals"), false);
});

test("regex matching and highlighting handle invalid syntax and zero-width matches", () => {
  assert.equal(matchesTextSearch(["Episode 12"], "^Episode \\d+$", "regex"), true);
  assert.equal(matchesTextSearch(["Episode", "12"], "^Episode \\d+$", "regex"), false);
  assert.equal(matchesTextSearch(["Episode 12"], "[", "regex"), false);
  assert.ok(searchPatternError("[", "regex"));
  assert.equal(searchPatternError("[", "contains"), null);
  assert.deepEqual(textSearchRanges("😀AB ab", "ab", "regex", undefined, { caseSensitive: true }), [
    { start: 5, end: 7 },
  ]);
  assert.deepEqual(textSearchRanges("abc", "(?=a)", "regex"), []);
  assert.deepEqual(textSearchRanges("abc", "[", "regex"), []);
  assert.deepEqual(
    textSearchRanges("AB ab", "AB", "contains", undefined, { caseSensitive: true }),
    [{ start: 0, end: 2 }],
  );
  assert.deepEqual(textSearchRanges(" cat ", "cat", "equals"), [{ start: 1, end: 4 }]);
});

test("duration bounds are inclusive and prompt lines are trimmed and deduplicated", () => {
  const options = { ...defaultAdvancedSearch, minDuration: "1", maxDuration: "2" };
  assert.equal(matchesSearchDuration(1000000, 2000000, options), true);
  assert.equal(matchesSearchDuration(1000000, 3000000, options), true);
  assert.equal(matchesSearchDuration(1000000, 3000001, options), false);
  assert.equal(matchesSearchDuration(0, 500000, options), false);
  assert.deepEqual(searchLines(" sunset \r\n\nbeach\nsunset"), ["sunset", "beach"]);
});

test("search rules distinguish any, all, whole words and negative matches", () => {
  assert.equal(matchesTextSearch(["Hello world"], "hello missing", "contains"), true);
  assert.equal(matchesTextSearch(["Hello world"], "hello missing", "containsAll"), false);
  assert.equal(matchesTextSearch(["Hello", "WORLD"], "hello world", "containsAll"), true);
  assert.equal(matchesTextSearch(["catalog cat"], "cat", "containsWords"), true);
  assert.equal(matchesTextSearch(["catalog"], "cat", "containsWords"), false);
  assert.equal(matchesTextSearch(["字幕测试"], "字幕", "contains"), true);
  assert.equal(matchesTextSearch(["Hello world"], "bye", "doesNotContain"), true);
  assert.equal(matchesTextSearch(["hello", "world"], "WORLD", "endsWith"), true);
  assert.equal(matchesTextSearch(["hello", "world"], "wor", "startsWith"), true);
  assert.equal(matchesTextSearch(["", "  "], "ignored", "isEmpty"), true);
  assert.equal(matchesTextSearch(["hello"], "", "isNotEmpty"), true);
});

test("highlight ranges preserve text offsets, repeated matches and literal punctuation", () => {
  assert.deepEqual(textSearchRanges("😀Hello HELLO", "hello", "contains"), [
    { start: 2, end: 7 },
    { start: 8, end: 13 },
  ]);
  assert.deepEqual(textSearchRanges("catalog cat", "cat", "containsWords"), [
    { start: 8, end: 11 },
  ]);
  assert.deepEqual(textSearchRanges("banana", "ban banana", "contains"), [{ start: 0, end: 6 }]);
  assert.deepEqual(textSearchRanges("a+b a+b", "a+b", "startsWith"), [{ start: 0, end: 3 }]);
  assert.deepEqual(textSearchRanges("a+b a+b", "a+b", "endsWith"), [{ start: 4, end: 7 }]);
  assert.deepEqual(textSearchRanges("字幕测试字幕", "字幕", "contains"), [
    { start: 0, end: 2 },
    { start: 4, end: 6 },
  ]);
  assert.deepEqual(textSearchRanges("hello", "  ", "contains"), []);
});

test("keyword prefix and suffix highlights use individual field boundaries", () => {
  const text = "catalog, cat, Hello<world";
  const fields = [/[^,]+/g, /[^,<]+/g].flatMap((pattern) =>
    Array.from(text.matchAll(pattern), (match) => ({
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
  assert.deepEqual(textSearchRanges(text, "cat", "endsWith", fields), [{ start: 9, end: 12 }]);
  assert.deepEqual(textSearchRanges(text, "wor", "startsWith", fields), [{ start: 20, end: 23 }]);
});

test("only positive rules allow highlights", () => {
  for (const rule of ["contains", "containsAll", "containsWords", "startsWith", "endsWith"])
    assert.equal(canHighlightSearchRule(rule), true);
  for (const rule of ["doesNotContain", "isEmpty", "isNotEmpty"]) {
    assert.equal(canHighlightSearchRule(rule), false);
    assert.deepEqual(textSearchRanges("hello", "hello", rule), []);
  }
});

test("result navigation skips nonmatches and wraps in either direction", () => {
  assert.equal(nextSearchMatchIndex([], 0, 1), -1);
  assert.equal(nextSearchMatchIndex([1, 4, 7], -1, 1), 1);
  assert.equal(nextSearchMatchIndex([1, 4, 7], -1, -1), 7);
  assert.equal(nextSearchMatchIndex([1, 4, 7], 2, 1), 4);
  assert.equal(nextSearchMatchIndex([1, 4, 7], 2, -1), 1);
  assert.equal(nextSearchMatchIndex([1, 4, 7], 7, 1), 1);
  assert.equal(nextSearchMatchIndex([1, 4, 7], 1, -1), 7);
  assert.equal(nextSearchMatchIndex([4], 4, 1), 4);
});
