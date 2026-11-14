import assert from "node:assert/strict";
import test from "node:test";
import type { MediaDocument, MediaStream } from "../../../src/types.ts";
import { createModuleLoader } from "../support/module-loader.ts";

type ProxyGenerationModule = typeof import("../../../src/application/media/proxyGeneration.ts");
type ProxyGenerationTaskModule =
  typeof import("../../../src/application/media/proxyGenerationTask.ts");

const load = createModuleLoader(import.meta.url);
const proxy = load<ProxyGenerationModule>("../../../src/application/media/proxyGeneration.ts");

function stream(index: number, codec_type: string, codec_name: string): MediaStream {
  return {
    index,
    codec_type,
    codec_name,
    language: null,
    title: null,
    width: null,
    height: null,
    channels: null,
    disposition: {},
  };
}

function document(
  streams: MediaStream[],
  path = "/media/clip.mkv",
  proxy_path: string | null = null,
): MediaDocument {
  return {
    asset: {
      id: "asset-1",
      path,
      file_name: path.split("/").pop() ?? path,
      file_size: 1,
      modified_at: 0,
      fingerprint: "fingerprint",
      duration_us: 1_000_000,
      start_time_us: 0,
      tape_name: null,
      video_stream_index: streams.find((item) => item.codec_type === "video")?.index ?? null,
      audio_stream_index: null,
    },
    streams,
    tracks: [],
    cues: {},
    cache_dir: "/cache",
    proxy_path,
  };
}

const autoRemux = (project: MediaDocument, patch: Partial<Record<string, boolean>> = {}) =>
  proxy.shouldAutoRemux({
    project,
    isMacOS: true,
    enabled: true,
    alreadyAttempted: false,
    ...patch,
  });

test("remux eligibility accepts only AVFoundation-playable video codecs", () => {
  for (const codec of ["h264", "hevc", "prores", "mjpeg", "HEVC"]) {
    assert.equal(proxy.isRemuxEligible(document([stream(0, "video", codec)])), true, codec);
  }
  for (const codec of ["av1", "vp9", "vp8", ""]) {
    assert.equal(proxy.isRemuxEligible(document([stream(0, "video", codec)])), false, codec);
  }
  assert.equal(proxy.isRemuxEligible(null), false);
  assert.equal(proxy.isRemuxEligible(document([stream(0, "audio", "aac")])), false);
});

test("eligibility follows the preview stream, not attached cover art", () => {
  const cover = { ...stream(0, "video", "mjpeg"), disposition: { attached_pic: 1 } };
  const project = document([cover, stream(1, "video", "av1")]);
  project.asset.video_stream_index = null;
  assert.equal(proxy.proxyVideoStream(project)?.index, 1);
  assert.equal(proxy.isRemuxEligible(project), false);
});

test("the dialog recommends remux unless the codec or a previous remux rules it out", () => {
  assert.equal(proxy.defaultProxyPreset(document([stream(0, "video", "h264")]), true), "remux");
  assert.equal(proxy.defaultProxyPreset(document([stream(0, "video", "vp9")]), true), "h264_mp4");
  assert.equal(proxy.defaultProxyPreset(null, true), "h264_mp4");
  // Chromium previews cannot play copied AC-3/ProRes, so only macOS gets remux.
  assert.equal(proxy.defaultProxyPreset(document([stream(0, "video", "h264")]), false), "h264_mp4");
  assert.equal(proxy.canOfferRemux(document([stream(0, "video", "hevc")]), false), false);
  assert.equal(proxy.canOfferRemux(document([stream(0, "video", "hevc")]), true), true);
  const remuxed = document(
    [stream(0, "video", "hevc")],
    "/media/clip.mkv",
    "/media/Proxy/clip_Remux.mov",
  );
  assert.equal(proxy.defaultProxyPreset(remuxed, true), "h264_mp4");
  assert.equal(proxy.isRemuxProxyPath("/media/Proxy/clip_Proxy.mov"), false);
  assert.equal(proxy.isRemuxProxyPath("C:\\media\\Proxy\\clip_remux.MOV"), true);
});

test("auto remux runs once for eligible MKV sources on macOS when enabled", () => {
  const mkv = document([stream(0, "video", "h264"), stream(1, "audio", "opus")]);
  assert.equal(autoRemux(mkv), true);
  assert.equal(autoRemux(mkv, { isMacOS: false }), false);
  assert.equal(autoRemux(mkv, { enabled: false }), false);
  assert.equal(autoRemux(mkv, { alreadyAttempted: true }), false);
  assert.equal(autoRemux(document([stream(0, "video", "av1")])), false);
  assert.equal(autoRemux(document([stream(0, "video", "h264")], "/media/clip.MKV")), true);
  assert.equal(autoRemux(document([stream(0, "video", "h264")], "/media/clip.avi")), false);
  assert.equal(
    autoRemux(document([stream(0, "video", "h264")], "/media/clip.mkv", "/p/clip_Proxy.mp4")),
    false,
  );
});

test("the unplayable-source message suggests the lossless option only when it applies", () => {
  assert.match(
    proxy.unplayableSourceMessage(document([stream(0, "video", "hevc")]), true),
    /无损重封装/u,
  );
  assert.doesNotMatch(
    proxy.unplayableSourceMessage(document([stream(0, "video", "vp9")]), true),
    /无损重封装/u,
  );
  assert.doesNotMatch(
    proxy.unplayableSourceMessage(document([stream(0, "video", "hevc")]), false),
    /无损重封装/u,
  );
  assert.equal(proxy.defaultProxyOptions("remux").preset, "remux");
  assert.equal(proxy.defaultProxyOptions("remux").location, "source_proxy_folder");
});

/** Values built inside the module sandbox have foreign prototypes. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function taskModule(invoke: (command: string, args: unknown) => Promise<unknown>) {
  const events: string[] = [];
  let cancel: (() => Promise<void>) | undefined;
  const module = load<ProxyGenerationTaskModule>(
    "../../../src/application/media/proxyGenerationTask.ts",
    {
      "../../errors": { invokeCommand: invoke },
      "../../platform/tauri/ffmpegProgress": {
        cancelFfmpegTask: async (id: string) => events.push(`cancel:${id}`),
        createFfmpegTaskId: (prefix: string) => `${prefix}-task`,
        listenToFfmpegTaskProgress: () => undefined,
      },
      "../../systems/TaskSystem": {
        createTaskProgress: async (options: { on_cancel: () => Promise<void> }) => {
          cancel = options.on_cancel;
          return {
            cancelled: false,
            update: () => events.push("update"),
            remove: () => events.push("remove"),
            fail: () => events.push("fail"),
          };
        },
      },
    },
  );
  return { module, events, cancel: () => cancel?.() };
}

test("proxy generation task reports success, cancellation, and failure", async () => {
  const options = proxy.defaultProxyOptions("remux");
  const calls: unknown[] = [];
  const ok = taskModule(async (command, args) => {
    calls.push([command, args]);
    return { proxy_path: "/media/Proxy/clip_Remux.mov" };
  });
  assert.deepEqual(
    plain(
      await ok.module.runProxyGenerationTask({ assetId: "asset-1", displayName: "clip", options }),
    ),
    { status: "success", proxyPath: "/media/Proxy/clip_Remux.mov" },
  );
  assert.deepEqual(plain(calls), [
    ["generate_proxy", { assetId: "asset-1", options: plain(options), taskId: "proxy-task" }],
  ]);
  assert.deepEqual(ok.events, ["update", "remove"]);

  let cancelled: ReturnType<typeof taskModule>;
  cancelled = taskModule(async () => {
    await cancelled.cancel();
    throw new Error("killed");
  });
  assert.deepEqual(
    plain(
      await cancelled.module.runProxyGenerationTask({ assetId: "a", displayName: "c", options }),
    ),
    { status: "cancelled" },
  );
  assert.deepEqual(cancelled.events, ["cancel:proxy-task", "remove"]);

  const failed = taskModule(async () => {
    throw new Error("ffmpeg failed");
  });
  assert.deepEqual(
    plain(await failed.module.runProxyGenerationTask({ assetId: "a", displayName: "c", options })),
    { status: "failed" },
  );
  assert.deepEqual(failed.events, ["fail"]);
});
