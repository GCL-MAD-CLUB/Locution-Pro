import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultAdvancedSearch,
  matchesSearchDuration,
  advancedSearchErrors,
  promptCharacterCount,
  semanticPromptErrors,
} from "../../../src/core/editor/textSearch.ts";

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
