import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader, flush } from "../support/module-loader.ts";
import { RenderLifetime } from "../support/lifetime.ts";

interface Element {
  props: Record<string, unknown>;
}

function fixture() {
  const ended: (() => void)[] = [];
  const states: unknown[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0,
    closed = 0;
  const jsx = (_type: unknown, props: Record<string, unknown>) => ({ props });
  class AudioContext {
    currentTime = 0;
    destination = {};
    createOscillator() {
      return {
        frequency: { setValueAtTime() {} },
        connect() {},
        start() {},
        stop() {},
        addEventListener: (_name: string, callback: () => void) => ended.push(callback),
      };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    close() {
      closed++;
      return Promise.resolve();
    }
  }
  const module = createModuleLoader(import.meta.url)<
    typeof import("../../../src/components/common/ModalDialog/ModalDialog.tsx")
  >(
    "../../../src/components/common/ModalDialog/ModalDialog.tsx",
    {
      "../../../runtime/lifetime/RenderLifetime": { RenderLifetime },
      react: {
        useId: () => "dialog",
        useRef: (current: unknown) => ({ current }),
        useState: (initial: unknown) => [initial, (next: unknown) => states.push(next)],
      },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "lucide-react": {},
      "./ModalDialog.css": {},
      "../../../errors": {
        invokeCommand: async () => false,
        captureOperationError: (operation: string, error: unknown) =>
          assert.fail(`${operation}: ${String(error)}`),
        runBackgroundOperation: (_operation: string, action: () => Promise<void>) => action(),
      },
    },
    {
      window: { AudioContext },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.set(++sequence, callback);
        return sequence;
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
    },
  );
  const root = module.ModalDialog({
    title: "Dialog",
    children: null,
    onCancel() {},
    onConfirm() {},
  });
  const backdrop = root.props.children as unknown as Element;
  const section = backdrop.props.children as Element;
  return {
    ended,
    states,
    frames,
    closed: () => closed,
    attention: backdrop.props.onMouseDown as () => void,
    finish: section.props.onAnimationEnd as (event: unknown) => void,
    release: root.props.lifetime.resources[0].acquire(),
    frame() {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
    },
  };
}

test("fallback sound releases the audio context when its final oscillator actually ends", async () => {
  const view = fixture();
  view.attention();
  await flush();
  assert.equal(view.closed(), 0);
  assert.equal(view.ended.length, 1);
  view.ended[0]();
  await flush();
  assert.equal(view.closed(), 1);
  view.release?.();
});

test("attention waits for its own animation end and cancels queued frames on unmount", async () => {
  const view = fixture();
  view.attention();
  view.attention();
  assert.equal(view.frames.size, 1);
  view.frame();
  view.frame();
  assert.equal(view.states.at(-1), true);
  const target = {};
  view.finish({ target: {}, currentTarget: target, animationName: "modal-dialog-attention-title" });
  assert.equal(view.states.at(-1), true);
  view.finish({ target, currentTarget: target, animationName: "modal-dialog-attention-shadow" });
  assert.equal(view.states.at(-1), false);
  view.attention();
  view.release?.();
  assert.equal(view.frames.size, 0);
  await flush();
});
