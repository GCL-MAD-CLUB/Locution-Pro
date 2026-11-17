import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import test from "node:test";
import ts from "typescript";
import { CommittedLifetime, RenderLifetime } from "../support/lifetime.ts";

function resource(log: string[], name: string) {
  return () => {
    log.push(`open:${name}`);
    return () => {
      log.push(`close:${name}`);
    };
  };
}

function commit(owner: CommittedLifetime, render: RenderLifetime) {
  owner.commit(render, "beforePaint");
  owner.commit(render, "afterCommit");
}

test("abandoned renders acquire nothing and committed resources follow their phase", () => {
  const log: string[] = [];
  const abandoned = new RenderLifetime();
  abandoned.afterCommit(resource(log, "abandoned"), []);
  abandoned.render(null);
  assert.deepEqual(log, []);
  const render = new RenderLifetime();
  render.afterCommit(resource(log, "subscription"), []);
  render.beforePaint(resource(log, "measurement"), []);
  const owner = new CommittedLifetime();
  owner.commit(render, "beforePaint");
  assert.deepEqual(log, ["open:measurement"]);
  owner.commit(render, "afterCommit");
  owner.dispose();
  assert.deepEqual(log, [
    "open:measurement",
    "open:subscription",
    "close:subscription",
    "close:measurement",
  ]);
});

test("unchanged keys retain resources; project switches flush old writers before opening new ones", () => {
  const log: string[] = [];
  const owner = new CommittedLifetime();
  const render = (project: string) => {
    const next = new RenderLifetime();
    next.afterCommit(resource(log, `writer:${project}`), [project]);
    next.afterCommit(resource(log, `reader:${project}`), [project]);
    return next;
  };
  commit(owner, render("a"));
  commit(owner, render("a"));
  assert.equal(log.length, 2);
  commit(owner, render("b"));
  assert.deepEqual(log, [
    "open:writer:a",
    "open:reader:a",
    "close:writer:a",
    "close:reader:a",
    "open:writer:b",
    "open:reader:b",
  ]);
  owner.dispose();
});

test("removed resources and repeated disposal release each handle exactly once", () => {
  const log: string[] = [];
  const owner = new CommittedLifetime();
  const render = new RenderLifetime();
  render.afterCommit(resource(log, "timer"), []);
  commit(owner, render);
  commit(owner, new RenderLifetime());
  owner.dispose();
  owner.dispose();
  assert.deepEqual(log, ["open:timer", "close:timer"]);
});

test("keys use Object.is and omitted keys reconnect at every commit", () => {
  const log: string[] = [];
  const owner = new CommittedLifetime();
  const next = (key: number) => {
    const render = new RenderLifetime();
    render.beforePaint(resource(log, "keyed"), [key]);
    render.afterCommit(resource(log, "every"));
    return render;
  };
  commit(owner, next(NaN));
  commit(owner, next(NaN));
  assert.equal(log.filter((entry) => entry === "open:keyed").length, 1);
  commit(owner, next(0));
  commit(owner, next(-0));
  assert.equal(log.filter((entry) => entry === "open:keyed").length, 3);
  assert.equal(log.filter((entry) => entry === "open:every").length, 4);
  owner.dispose();
});

test("one failing cleanup cannot leak the remaining resources", () => {
  const log: string[] = [];
  const owner = new CommittedLifetime();
  const render = new RenderLifetime();
  render.afterCommit(
    () => () => {
      throw new Error("cleanup failed");
    },
    [],
  );
  render.afterCommit(resource(log, "observer"), []);
  commit(owner, render);
  assert.throws(() => owner.dispose(), /cleanup failed/);
  owner.dispose();
  assert.deepEqual(log, ["open:observer", "close:observer"]);
});

test("unmount invalidates asynchronous results and Strict Mode replay reacquires resources", async () => {
  let deliver!: () => void;
  const results: string[] = [];
  const render = new RenderLifetime();
  render.afterCommit(() => {
    let active = true;
    deliver = () => {
      if (active) results.push("result");
    };
    return () => {
      active = false;
    };
  }, []);
  const owner = new CommittedLifetime();
  commit(owner, render);
  const stale = deliver;
  owner.dispose();
  commit(owner, render);
  await Promise.resolve().then(stale);
  assert.deepEqual(results, []);
  deliver();
  assert.deepEqual(results, ["result"]);
  owner.dispose();
});

interface Boundary {
  props: { lifetime: RenderLifetime; children: null };
  componentDidMount(): void;
  componentDidUpdate(previous: Boundary["props"]): void;
  componentWillUnmount(): void;
}
function boundary(lifetime: RenderLifetime): Boundary {
  const element = lifetime.render(null);
  const Constructor = element.type as unknown as new (props: Boundary["props"]) => Boundary;
  return new Constructor({ lifetime, children: null });
}

test("boundary cancels deferred acquisition on unmount and replays a fresh mount", async () => {
  const log: string[] = [];
  const render = new RenderLifetime();
  render.afterCommit(resource(log, "listener"), []);
  const instance = boundary(render);
  instance.componentDidMount();
  instance.componentWillUnmount();
  await Promise.resolve();
  assert.deepEqual(log, []);
  instance.componentDidMount();
  await Promise.resolve();
  instance.componentWillUnmount();
  assert.deepEqual(log, ["open:listener", "close:listener"]);
});

test("rapid commits flush pending subscriptions and replace them without leaking callbacks", async () => {
  const log: string[] = [];
  const first = new RenderLifetime();
  first.afterCommit(resource(log, "a"), ["a"]);
  const instance = boundary(first);
  instance.componentDidMount();
  const previous = instance.props;
  const second = new RenderLifetime();
  second.afterCommit(resource(log, "b"), ["b"]);
  instance.props = { lifetime: second, children: null };
  instance.componentDidUpdate(previous);
  await Promise.resolve();
  instance.componentWillUnmount();
  assert.deepEqual(log, ["open:a", "close:a", "open:b", "close:b"]);
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.[cm]?[jt]sx?$/.test(entry.name)
        ? [path]
        : [];
  });
}

test("application, website and browser harnesses cannot introduce forbidden React hooks, including aliases", () => {
  const banned = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
  const failures: string[] = [];
  for (const directory of ["src", "site", "tests/browser"]) {
    for (const path of sourceFiles(resolve(directory))) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        extname(path).endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      function visit(node: ts.Node) {
        if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && banned.has(node.text)) {
          const location = source.getLineAndCharacterOfPosition(node.getStart(source));
          failures.push(`${path}:${location.line + 1}: ${node.text}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  assert.deepEqual(failures, []);
});
