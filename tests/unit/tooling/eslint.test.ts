import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();

async function rules(source: string, filePath = "src/app/LintFixture.tsx") {
  const [result] = await eslint.lintText(source, { filePath });
  assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
  return result.messages.map((message) => message.ruleId);
}

test("React compiler and hooks diagnostics are errors", async () => {
  const config = await eslint.calculateConfigForFile("src/app/LintFixture.tsx");
  for (const name of [
    "rules-of-hooks",
    "exhaustive-deps",
    "purity",
    "immutability",
    "refs",
    "globals",
    "error-boundaries",
    "preserve-manual-memoization",
    "set-state-in-render",
    "set-state-in-effect",
    "static-components",
    "component-hook-factories",
    "unsupported-syntax",
    "incompatible-library",
    "use-memo",
    "config",
    "gating",
  ]) {
    assert.equal(config.rules[`react-hooks/${name}`][0], 2, name);
  }
});

test("effect hooks cannot be imported, aliased, re-exported, wrapped, or read from React", async () => {
  for (const name of ["useEffect", "useLayoutEffect", "useInsertionEffect"]) {
    for (const source of [
      `import { ${name} as run } from 'react'; export { run };`,
      `import * as React from 'react'; export const run = React.${name};`,
      `import React from 'react'; export const run = React['${name}'];`,
      `import React from 'react'; const { ${name}: run } = React; export { run };`,
      `import React from 'react'; const { '${name}': run } = React; export { run };`,
      `export { ${name} as run } from 'react';`,
      `export function useWrapper() { ${name}(() => {}, []); }`,
    ]) {
      for (const file of ["src/app/LintFixture.tsx", "tests/browser/components/lint.harness.js"]) {
        assert((await rules(source, file)).includes("no-restricted-syntax"), source);
      }
    }
  }
});

test("conditional render updates and setter aliases are forbidden", async () => {
  for (const statement of [
    "if (count < max) setCount(max);",
    "const update = setCount; if (count < max) update(max);",
    "useMemo(() => { if (count < max) setCount(max); return count; }, [count, max]);",
    "(() => { if (count < max) setCount(max); })();",
  ]) {
    assert(
      (
        await rules(`import {useState, useMemo} from 'react';
      export function Counter({max}: {max: number}) {
        const [count, setCount] = useState(0);
        ${statement}
        return <span>{count}</span>;
      }`)
      ).includes("project-react/no-render-state-update"),
      statement,
    );
  }
});

test("props and state must not be mirrored in useState", async () => {
  for (const initial of ["value", "value * 2", "() => value * 2", "count + 1"]) {
    assert(
      (
        await rules(`import {useState} from 'react';
      export function Counter({value}: {value: number}) {
        const [count] = useState(0);
        const [copy] = useState(${initial});
        return <span>{copy}</span>;
      }`)
      ).includes("project-react/no-derived-state"),
      initial,
    );
  }
  assert(
    (
      await rules(`import {Component} from 'react';
    export class Counter extends Component {
      static getDerivedStateFromProps() { return {}; }
      render() { this.setState({count: 1}); return null; }
    }`)
    ).includes("project-react/no-render-state-update"),
  );
});

test("pure derived values and event-owned state updates remain valid", async () => {
  assert.deepEqual(
    await rules(`import {useState} from 'react';
    export function Counter({max}: {max: number}) {
      const [count, setCount] = useState(0);
      const doubled = count * 2;
      return <button type="button" onClick={() => setCount(Math.min(count + 1, max))}>{doubled}</button>;
    }`),
    [],
  );
});

test("compiler rules detect impure renders, mutation, fake boundaries, and missing dependencies", async () => {
  for (const [expected, source] of [
    ["purity", "export function Clock() { return <span>{Date.now()}</span>; }"],
    [
      "immutability",
      "export function Card({item}) { item.title = 'changed'; return <span>{item.title}</span>; }",
    ],
    [
      "error-boundaries",
      "export function Parent() { try { return <Child />; } catch { return null; } }",
    ],
    [
      "exhaustive-deps",
      "import {useCallback} from 'react'; export function Card({onSave, value}) { const save = useCallback(() => onSave(value), [onSave]); return <button type='button' onClick={save}>Save</button>; }",
    ],
  ]) {
    assert((await rules(source)).includes(`react-hooks/${expected}`), expected);
  }
});

test("generated artifacts are ignored and authored tooling is linted", async () => {
  assert(await eslint.isPathIgnored("dist/generated.js"));
  assert(await eslint.isPathIgnored("src-tauri/target/generated.js"));
  assert.equal(await eslint.isPathIgnored("tooling/eslint/react-lifecycle.ts"), false);
  assert.equal(await eslint.isPathIgnored("site/src/main.js"), false);
});

test("production source rejects timer calls, aliases, destructuring, computed access and imports", async () => {
  for (const name of ["setTimeout", "setInterval"]) {
    for (const source of [
      `${name}(() => {}, 100);`,
      `window.${name}(() => {}, 100);`,
      `globalThis['${name}'](() => {}, 100);`,
      `const run = globalThis.${name}; run(() => {}, 100);`,
      `const { ${name}: run } = window; run(() => {}, 100);`,
      `const { '${name}': run } = globalThis; run(() => {}, 100);`,
      `const key = '${name}'; globalThis[key](() => {}, 100);`,
      `globalThis['set' + '${name.slice(3)}'](() => {}, 100);`,
      `const { ['${name}']: run } = window; run(() => {}, 100);`,
      `import { ${name} as wait } from 'node:timers'; wait(() => {}, 100);`,
      `import { '${name}' as wait } from 'node:timers'; wait(() => {}, 100);`,
      `export { ${name} as wait } from 'node:timers/promises';`,
      `export { '${name}' as wait } from 'node:timers/promises';`,
      `export function wait(callback) { return ${name}(callback, 100); }`,
      `/* eslint-disable project-scheduling/no-native-timers */ ${name}(() => {}, 100);`,
    ]) {
      for (const file of [
        "src/timerFixture.ts",
        "src/runtime/timerFixture.ts",
        "site/timerFixture.js",
        "docs/user-guide/.vitepress/theme/timerFixture.ts",
      ]) {
        assert(
          (await rules(source, file)).includes("project-scheduling/no-native-timers"),
          `${file}: ${source}`,
        );
      }
    }
  }
});

test("test and build tooling may use timers while production scheduling uses owned resources", async () => {
  for (const file of [
    "tests/unit/timerFixture.test.ts",
    "tests/browser/timerFixture.ts",
    "scripts/timerFixture.ts",
  ]) {
    assert(
      !(await rules("setTimeout(() => {}, 100); setInterval(() => {}, 100);", file)).includes(
        "project-scheduling/no-native-timers",
      ),
    );
  }
  assert(
    !(
      await rules(
        `import {scheduleAfter} from './runtime/scheduling'; const task = scheduleAfter(() => {}, 100); task.cancel();`,
        "src/timerFixture.ts",
      )
    ).includes("project-scheduling/no-native-timers"),
  );
});

test("production source cannot obtain timer namespaces or re-export whole native modules", async () => {
  for (const specifier of ["timers", "node:timers", "timers/promises", "node:timers/promises"]) {
    for (const source of [
      `export * from '${specifier}';`,
      `import * as scheduler from '${specifier}'; export {scheduler};`,
      `const scheduler = await import('${specifier}'); export {scheduler};`,
      `const scheduler = require('${specifier}'); module.exports = scheduler;`,
    ])
      assert(
        (await rules(source, "src/timerFixture.ts")).includes(
          "project-scheduling/no-native-timers",
        ),
        source,
      );
  }
});
