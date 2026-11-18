import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../../support/module-loader.ts";

const load = createModuleLoader(import.meta.url);

function registerShuttleProcessor() {
  const outbound: unknown[] = [];
  class WorkletProcessor {
    readonly port = {
      onmessage: (_event: { data: unknown }) => {},
      postMessage: (message: unknown) => outbound.push(message),
    };
  }

  type Processor = WorkletProcessor & {
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  };
  let ProcessorClass: (new () => Processor) | undefined;
  load(
    "../../../../src/components/panels/SourceMonitor/audio/shuttleAudio.worklet.ts",
    {},
    {
      AudioWorkletProcessor: WorkletProcessor,
      sampleRate: 48_000,
      registerProcessor(name: string, constructor: new () => Processor) {
        assert.equal(name, "locution-pro-shuttle-audio");
        ProcessorClass = constructor;
      },
    },
  );

  assert(ProcessorClass, "worklet registered its processor");
  const processor = new ProcessorClass();
  return {
    outbound,
    send: (data: unknown) => processor.port.onmessage({ data }),
    render: () => {
      const channels = [new Float32Array(128), new Float32Array(128)];
      assert.equal(processor.process([], [channels]), true);
      return channels;
    },
  };
}

for (const algorithm of ["wsola", "phase-vocoder"] as const) {
  test(`${algorithm} requests missing PCM, ignores obsolete playback sessions and stops cleanly`, () => {
    const worklet = registerShuttleProcessor();
    const frameCount = 8192;
    worklet.send({
      type: "start",
      session: 2,
      sourceIds: ["source"],
      sourceFrame: 0,
      playbackRate: 1,
      direction: 1,
      algorithm,
      durationFrames: frameCount,
      windowFrames: frameCount,
    });
    const window = {
      type: "append-window",
      sourceId: "source",
      startFrame: 0,
      frameCount,
      left: new Float32Array(frameCount).fill(0.25).buffer,
      right: new Float32Array(frameCount).fill(-0.125).buffer,
    };
    const silent = (channels: Float32Array[]) =>
      channels.every((channel) => channel.every((sample) => sample === 0));
    worklet.send({ ...window, session: 1 });
    assert(silent(worklet.render()));
    assert(silent(worklet.render()));
    assert.deepEqual(structuredClone(worklet.outbound), [
      { type: "need-window", session: 2, sourceId: "source", startFrame: 0 },
    ]);
    worklet.send({ ...window, session: 2 });
    for (let i = 0; i < 8; i++) worklet.render();
    const [left, right] = worklet.render();
    assert(left.some((sample) => sample > 0));
    assert(right.some((sample) => sample < 0));
    assert([...left, ...right].every(Number.isFinite));
    worklet.send({ type: "stop" });
    assert(silent(worklet.render()));
  });
}
