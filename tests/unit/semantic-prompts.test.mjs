import assert from "node:assert/strict";
import { test } from "node:test";
import { createModuleLoader } from "./support/module-loader.ts";
import { clientError } from "../../src/errors/model.ts";

const module = createModuleLoader(import.meta.url)("../../src/core/editor/semanticPrompts.ts", {
  "../../errors/model": { clientError },
});
const combinePromptMatches = (...args) => structuredClone(module.combinePromptMatches(...args));
const searchSemanticPrompts = async (...args) =>
  structuredClone(await module.searchSemanticPrompts(...args));

test("positive and negative maxima are computed per item and keep the winning positive frame", () => {
  const result = combinePromptMatches(
    [
      [
        { id: "a", similarity: 0.6, frame: 10 },
        { id: "b", similarity: 0.2, frame: 20 },
      ],
      [
        { id: "a", similarity: 0.8, frame: 30 },
        { id: "b", similarity: 0.1, frame: 40 },
      ],
    ],
    [
      [
        { id: "a", similarity: 0.1, frame: 50 },
        { id: "b", similarity: 0.4, frame: 60 },
      ],
      [{ id: "a", similarity: 0.3, frame: 70 }],
    ],
  );
  assert.deepEqual(result, [
    { id: "a", similarity: 0.5, frame: 30 },
    { id: "b", similarity: 0, frame: 20 },
  ]);
  assert.deepEqual(combinePromptMatches([[{ id: "a", similarity: 0.8 }]], []), [
    { id: "a", similarity: 0.8 },
  ]);
  assert.deepEqual(combinePromptMatches([], [[{ id: "a", similarity: 1 }]]), []);
});

test("negative cosine scores follow the formula without clamping individual maxima", () => {
  assert.deepEqual(
    combinePromptMatches([[{ id: "a", similarity: -0.1 }]], [[{ id: "a", similarity: -0.3 }]]),
    [{ id: "a", similarity: -0.1 - -0.3 }],
  );
});

test("deduplicated positive and negative prompts use one batch and keep their original roles", async () => {
  const calls = [];
  const result = await searchSemanticPrompts(
    ["one", "one", "shared"],
    ["shared", "two", "two"],
    async () => {
      throw new Error("unexpected single request");
    },
    () => true,
    async (prompts) => {
      calls.push(prompts);
      return prompts.map((_, index) => [
        { id: "a", similarity: [0.9, 0.3, 0.2][index], frame: index },
      ]);
    },
  );
  assert.deepEqual(structuredClone(calls), [["one", "shared", "two"]]);
  assert.deepEqual(result, [{ id: "a", similarity: 0.9 - 0.3, frame: 0 }]);
});

test("stale and incomplete prompt batches cannot publish results", async () => {
  let current = true;
  const result = await searchSemanticPrompts(
    ["one", "two"],
    [],
    async () => [],
    () => current,
    async () => {
      current = false;
      return [[{ id: "a", similarity: 1 }], []];
    },
  );
  assert.deepEqual(result, []);
  await assert.rejects(
    searchSemanticPrompts(
      ["one", "two"],
      [],
      async () => [],
      () => true,
      async () => [[]],
    ),
    /Incomplete/,
  );
  await assert.rejects(
    searchSemanticPrompts(
      ["one", "two"],
      [],
      async () => [],
      () => true,
      async () => {
        throw new Error("inference failed");
      },
    ),
    /inference failed/,
  );
});

test("prompt pump stops stale requests and propagates failure instead of publishing partial scores", async () => {
  let current = true;
  const calls = [];
  const result = await searchSemanticPrompts(
    ["one", "two"],
    ["three"],
    async (prompt) => {
      calls.push(prompt);
      current = false;
      return [{ id: "a", similarity: 0.8 }];
    },
    () => current,
  );
  assert.deepEqual(calls, ["one"]);
  assert.deepEqual(result, []);
  await assert.rejects(
    searchSemanticPrompts(
      ["one"],
      ["two"],
      async (prompt) => {
        if (prompt === "two") throw new Error("model failed");
        return [{ id: "a", similarity: 0.8 }];
      },
      () => true,
    ),
    /model failed/,
  );
});
