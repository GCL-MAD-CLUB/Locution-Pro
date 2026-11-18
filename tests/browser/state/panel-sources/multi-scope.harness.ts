import { countPlaybackRowMeasurements, playbackRowCenterOffset } from "./follow-viewport";
import { check, equal } from "../../support/assertions";
import { installHarnessNative } from "../../support/harness-native";
import { videoFixture, workspaceFixture } from "../../support/project-workspace";
import type { PanelManagerInitialState } from "../../../../src/components/common/DockLayout/types";
import type { StoryboardShot } from "../../../../src/types";
import { RenderLifetime } from "../../../../src/runtime/lifetime/RenderLifetime.ts";
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { PanelInstanceProvider } from "../../../../src/runtime/systems/PanelState.tsx";
import {
  PanelManagerProvider,
  usePanelManagerState,
} from "../../../../src/components/common/DockLayout/index.ts";
import { usePanelMediaSourceSelection } from "../../../../src/components/common/PanelMediaSources/index.ts";
import { AssetLibrary } from "../../../../src/components/panels/AssetLibrary/index.ts";
import { assetEntryKey } from "../../../../src/components/panels/AssetLibrary/model/nodes.ts";
import { useAssetLibraryState } from "../../../../src/components/panels/AssetLibrary/state/panelState.ts";
import { StoryboardPanel } from "../../../../src/components/panels/StoryboardPanel/StoryboardPanel.tsx";
import { SubtitlePanel } from "../../../../src/components/panels/SubtitlePanel/SubtitlePanel.tsx";
import {
  useProjectPort,
  getProjectWorkspaceSnapshot,
} from "../../../../src/systems/ProjectSystem/index.ts";
import { useStoryboardPanelState } from "../../../../src/components/panels/StoryboardPanel/storyboardPanelState.ts";
import { useSubtitlePanelState } from "../../../../src/components/panels/SubtitlePanel/subtitlePanelState.ts";
import { useStoryboardDetection } from "../../../../src/components/common/StoryboardDetection/useStoryboardDetection.tsx";
import {
  emptyStoryboard,
  sourceScope,
  sourceRowId,
} from "../../../../src/core/editor/mediaSources/multiSource.ts";
import { stateHub } from "../../../../src/runtime/state/StateHub.ts";
import { PLAYBACK_STATUS_PROJECTION } from "../../../../src/runtime/state/contracts.ts";
import { eventHub } from "../../../../src/runtime/events/EventHub.ts";
import { emptyAssetLibraryAnnotation } from "../../../../src/core/editor/assetLibrary/assetLibrary.ts";

const h = React.createElement;
const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
function workspace() {
  const projects = ["a", "b"].map((id) => videoFixture(id, { trackCount: 2 }));
  return {
    ...workspaceFixture(projects),
    storyboards: Object.fromEntries(
      projects.map(({ asset }) => [
        `${asset.id}:${asset.id}:fp`,
        {
          ...emptyStoryboard(),
          shots: [1, 2].map((sequence) => ({
            id: `shot-${sequence}`,
            sequence,
            start_frame: (sequence - 1) * 120,
            end_frame: sequence * 120 - 1,
            start_us: (sequence - 1) * 5_000_000,
            end_us: sequence * 5_000_000 - 1,
          })),
        },
      ]),
    ),
  };
}

export type PanelSourceScenario =
  "import" | "asset-preview" | "follow" | "merge" | "history" | "detection";

export async function runPanelSourceScenario(scenario: PanelSourceScenario) {
  const playbackOwner = { system: "multi-scope-player" };
  type FinishDetection = (result: { shots: StoryboardShot[]; frame_rate: number }) => void;
  let finishDetection: FinishDetection | undefined;
  const detectionFinishes = new Map<string, FinishDetection>();
  let detectionCalls = 0;
  const restoreNative = installHarnessNative<{ assetId: string }>(async (command, args) => {
    if (command === "plugin:event|listen") return 1;
    if (command === "load_project_states") return {};
    if (command === "detect_storyboard_shots") {
      detectionCalls += 1;
      return new Promise((resolve) => {
        finishDetection = resolve;
        detectionFinishes.set(args.assetId, resolve);
      });
    }
    return null;
  });

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function useBridgePort() {
    return useProjectPort(
      ["projectHistory", "activeVideoId", "activeTrackId"],
      [
        "projectOpened",
        "projectClosed",
        "mediaItemsRemoved",
        "mediaItemsEnabledChanged",
        "projectHistoryJumped",
        "storyboardUpdated",
        "subtitleCuesDeleted",
        "mediaBinEntriesRemoved",
        "mediaProjectsAdded",
      ],
    );
  }
  type PanelId = "board" | "sub";
  type PanelKind = "storyboard" | "subtitles";
  type PanelSnapshot = {
    source: ReturnType<typeof usePanelMediaSourceSelection>;
    board: ReturnType<
      typeof useStoryboardPanelState<
        Parameters<typeof useStoryboardPanelState>[1] extends (state: infer State) => unknown
          ? State
          : never
      >
    >;
    subtitle: ReturnType<
      typeof useSubtitlePanelState<
        Parameters<typeof useSubtitlePanelState>[1] extends (state: infer State) => unknown
          ? State
          : never
      >
    >;
    detection: ReturnType<typeof useStoryboardDetection>;
  };
  const snapshots = {} as Record<PanelId, PanelSnapshot> & {
    port: ReturnType<typeof useBridgePort>;
    manager: ReturnType<typeof useManagerSnapshot>;
    assets: ReturnType<typeof useAssetsSnapshot>;
  };
  const useManagerSnapshot = () => usePanelManagerState((state) => state);
  const useAssetsSnapshot = () => useAssetLibraryState((state) => state);

  function Bridge() {
    snapshots.port = useBridgePort();
    snapshots.manager = useManagerSnapshot();
    return null;
  }
  function Panel({ id, kind }: { id: PanelId; kind: PanelKind }) {
    const lifetime = new RenderLifetime();

    const source = usePanelMediaSourceSelection(lifetime, kind);
    const board = useStoryboardPanelState(lifetime, (state) => state);
    const subtitle = useSubtitlePanelState(lifetime, (state) => state);
    const detection = useStoryboardDetection(lifetime);
    const context = sourceScope(source.selectedSources.map((entry) => entry.context));
    lifetime.useAfterCommit(() => board.syncVideoContext(context), [context]);
    const trackContext = sourceScope(
      source.selectedSources
        .filter((entry) => entry.trackId)
        .map((entry) => `${entry.context}:${entry.trackId}`),
    );
    lifetime.useAfterCommit(() => subtitle.syncTrackContext(trackContext), [trackContext]);
    snapshots[id] = { source, board, subtitle, detection };
    return lifetime.render(
      h(
        "div",
        { className: "dock-panel-surface active", style: { width: 550, height: 600 } },
        h(kind === "storyboard" ? StoryboardPanel : SubtitlePanel),
        detection.detectionDialog,
      ),
    );
  }
  function Assets() {
    snapshots.assets = useAssetsSnapshot();
    return h(AssetLibrary);
  }
  const initial: PanelManagerInitialState = {
    instances: [
      { id: "board", type: "storyboard", params: {} },
      { id: "sub", type: "subtitles", params: {} },
      { id: "assets", type: "asset-library", params: {} },
    ],
    layout: {
      root: {
        type: "split",
        id: "audit-split",
        axis: "x",
        ratio: 0.5,
        first: { type: "area", areaId: "left" },
        second: { type: "area", areaId: "right" },
      },
      areas: {
        left: { tabs: ["board"], activePanelId: "board" },
        right: { tabs: ["sub"], activePanelId: "sub" },
      },
    },
    focusedPanelId: "board",
  };
  const act = async (callback: () => void) => {
    flushSync(callback);
    await pause();
  };
  const reset = async () => {
    detectionFinishes.clear();
    await act(() => snapshots.port.projectClosed());
    await act(() => snapshots.port.projectOpened(workspace(), "/audit.lcut", "audit"));
    await act(() => snapshots.board.source.selectVideo("a", "a-1"));
    await act(() => snapshots.sub.source.selectVideo("a", "a-1"));
    await act(() => snapshots.manager.focusPanel("board"));
  };
  const sourceIds = (id: PanelId) =>
    snapshots[id].source.selectedSources.map((source) => source.videoId);
  const historySize = () => snapshots.port.projectHistory.entries.length;
  try {
    await act(() =>
      root.render(
        h(PanelManagerProvider, {
          initialState: initial,
          children: [
            h(Bridge, { key: "bridge" }),
            ...(["board", "sub"] as const).map((id) =>
              h(PanelInstanceProvider, {
                instanceId: id,
                key: id,
                children: h(Panel, { id, kind: id === "board" ? "storyboard" : "subtitles" }),
              }),
            ),
            h(PanelInstanceProvider, { instanceId: "assets", key: "assets", children: h(Assets) }),
          ],
        }),
      ),
    );
    if (scenario === "import") {
      const emptyWorkspace = workspace();
      emptyWorkspace.projects = [];
      emptyWorkspace.media_bin.items = [];
      emptyWorkspace.editor.active_video_id = "";
      emptyWorkspace.editor.active_track_id = "";
      emptyWorkspace.storyboards = {};
      await act(() => snapshots.port.projectOpened(emptyWorkspace, "/empty.lcut", "empty-audit"));
      await act(() => snapshots.port.mediaProjectsAdded(workspace().projects));
      equal(
        snapshots.board.source.selection.videoId,
        "a",
        "first import initializes panel selection",
      );
      equal(historySize(), 1, "initial preview creates no extra history");
      return true;
    }
    if (scenario === "asset-preview") {
      await reset();
      const clipWorkspace = workspace();
      clipWorkspace.asset_library = {
        folders: [],
        entries: clipWorkspace.projects.map(({ asset }) => ({
          id: `clip-${asset.id}`,
          root: "storyboards",
          folder_id: null,
          name: `Clip ${asset.id}`,
          created_at: 1,
          hidden: false,
          media: {
            video_id: asset.id,
            path: asset.path,
            file_name: asset.file_name,
            fingerprint: asset.fingerprint,
            frame_rate: 24,
            duration_us: asset.duration_us,
          },
          start_us: 1_000_000,
          end_us: 2_000_000,
          text: "",
          annotation: emptyAssetLibraryAnnotation(),
        })),
      };
      await act(() => snapshots.port.projectOpened(clipWorkspace, "/clips.lcut", "clips"));
      await act(() => {
        snapshots.board.source.toggleSource("b");
        snapshots.board.board.setViewMode("graph");
        snapshots.manager.focusPanel("assets");
        snapshots.assets.navigate({ root: "storyboards", folderId: null });
        snapshots.assets.setDetailsVisible(true);
      });
      const storyboardWorkspace = snapshots.board.source.selection.workspaceId;
      const graph = document.querySelector(".storyboard-graph-view");
      equal(Boolean(graph), true, "storyboard graph is mounted");
      for (const videoId of ["a", "b"]) {
        await act(() => snapshots.assets.select([assetEntryKey(`clip-${videoId}`)]));
        const play = document.querySelector<HTMLButtonElement>(".asset-library-preview-play");
        check(play, "asset playback button is mounted");
        equal(play?.disabled, false, "the selected clip can play from its properties");
        await act(() => play.click());
        const request = eventHub
          .recentEvents()
          .reverse()
          .find(
            (event) =>
              event.type === "playback.seek.requested" && event.source.instanceId === "assets",
          );
        equal(
          request?.payload,
          { videoId, timeUs: 1_000_000, focusEndUs: 2_000_000, play: true },
          "asset playback sends a bounded seek to the source monitor",
        );
        equal(snapshots.port.activeVideoId, videoId, "the source monitor switches to the clip");
        equal(sourceIds("board"), ["a", "b"], "asset playback preserves graph sources");
        equal(
          snapshots.board.source.selection.workspaceId,
          storyboardWorkspace,
          "asset playback preserves the storyboard workspace",
        );
        equal(
          document.querySelector(".storyboard-graph-view") === graph,
          true,
          "asset playback preserves the mounted graph",
        );
      }
      await act(() => snapshots.board.board.setViewMode("list"));
      return true;
    }
    if (scenario === "follow") {
      await reset();
      const differentRates = workspace();
      differentRates.projects[1].streams[0].avg_frame_rate = "60/1";
      await act(() => snapshots.port.projectOpened(differentRates, "/rates.lcut", "rates"));
      await act(() => snapshots.board.source.selectVideo("a", "a-1"));
      await act(() => snapshots.board.source.toggleSource("b"));
      await act(() => snapshots.sub.source.selectVideo("b", "b-1"));
      await act(() => snapshots.manager.focusPanel("sub"));
      await act(() =>
        snapshots.board.board.shotSelectionReplaced([sourceRowId("a:a:fp", "shot-2")]),
      );
      await act(() => snapshots.sub.subtitle.cueSelectionReplaced(["b-1-cue-1"]));
      await act(() =>
        snapshots.board.source.selection.setSourceLocked(
          true,
          snapshots.board.source.selectedSources,
        ),
      );
      const play = (videoId: string, currentFrame: number, sourcePanelId: string) =>
        act(() =>
          stateHub.publish(PLAYBACK_STATUS_PROJECTION, playbackOwner, {
            active: true,
            lastFocusedAt: 1,
            videoId,
            currentFrame,
            sourcePanelId,
            isPlaying: true,
          }),
        );
      const current = (kind: PanelId) =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            kind === "board" ? ".shot-row.is-current" : ".cue-row.is-current",
          ),
          (row) => (kind === "board" ? row.dataset.storyboardShotId : row.dataset.subtitleCueId),
        );
      const historyBefore = historySize();
      await play("b", 90, "sub");
      equal(
        current("board"),
        [sourceRowId("b:b:fp", "shot-1")],
        "board follows a playing subset source without switching its active source",
      );
      equal(current("sub"), ["b-1-cue-1"], "subtitle follows playing source");
      await play("b", 135, "sub");
      equal(current("board"), [sourceRowId("b:b:fp", "shot-2")], "board follows the next shot");
      equal(current("sub"), ["b-1-cue-2"], "subtitle uses playing media frame rate");
      equal(
        snapshots.board.source.activeVideoId,
        "a",
        "follow does not replace the panel active source",
      );
      equal(
        [...snapshots.board.board.selectedShotIds],
        [sourceRowId("a:a:fp", "shot-2")],
        "follow preserves shot selection",
      );
      equal(
        [...snapshots.sub.subtitle.selectedCueIds],
        ["b-1-cue-1"],
        "follow preserves cue selection",
      );
      equal(historySize(), historyBefore, "following playback does not add edit history");
      await act(() => snapshots.board.source.selection.setSourceLocked(false));
      await act(() => snapshots.board.source.selectVideo("b", "b-1"));
      await act(() => snapshots.sub.source.selectVideo("a", "a-1"));
      await act(() => snapshots.sub.source.toggleSource("b"));
      await act(() => snapshots.manager.focusPanel("board"));
      await play("b", 135, "board");
      equal(current("board"), ["shot-2"], "single-source board follows playback");
      equal(
        current("sub"),
        [sourceRowId("b:b:fp:b-1", "b-1-cue-2")],
        "subtitle follows the shared source from its larger source set using 60fps",
      );
      equal(
        snapshots.sub.source.activeVideoId,
        "a",
        "subtitle source selection remains independent",
      );
      await play("outside", 0, "other");
      equal(current("board"), [], "unrelated playback does not falsely highlight the first shot");
      equal(current("sub"), [], "unrelated playback does not highlight a subtitle");
      await act(() => stateHub.remove(PLAYBACK_STATUS_PROJECTION, playbackOwner));

      await reset();
      const longWorkspace = workspace();
      for (const project of longWorkspace.projects) {
        project.asset.duration_us = 320_000_000;
        for (const track of project.tracks) {
          track.cue_count = 64;
          project.cues[track.id] = Array.from({ length: 64 }, (_, index) => ({
            id: `${track.id}-cue-${index + 1}`,
            track_id: track.id,
            sequence: index + 1,
            start_us: index * 5_000_000,
            end_us: (index + 1) * 5_000_000,
            plain_text: `subtitle ${index + 1}`,
            raw_text: `subtitle ${index + 1}`,
            speaker: null,
            style: null,
            layer: null,
          }));
        }
        const frames = project.asset.id === "a" ? 1 : 120;
        longWorkspace.storyboards![`${project.asset.id}:${project.asset.id}:fp`].shots = Array.from(
          { length: 64 },
          (_, index) => ({
            id: `shot-${index + 1}`,
            sequence: index + 1,
            start_frame: index * frames,
            end_frame: (index + 1) * frames - 1,
            start_us: (index * frames * 1_000_000) / 24,
            end_us: ((index + 1) * frames * 1_000_000) / 24 - 1,
          }),
        );
      }
      await act(() => snapshots.port.projectOpened(longWorkspace, "/scroll.lcut", "scroll"));
      await act(() => snapshots.board.source.selectVideo("a", "a-1"));
      await act(() => snapshots.board.source.toggleSource("b"));
      await act(() => snapshots.sub.source.selectVideo("b", "b-1"));
      await act(() => snapshots.manager.focusPanel("sub"));
      await act(() => snapshots.board.board.shotSelectionReplaced([]));
      await act(() => snapshots.sub.subtitle.cueSelectionReplaced([]));
      const lists = [
        document.querySelector<HTMLElement>(".shot-list")!,
        document.querySelector<HTMLElement>(".cue-list")!,
      ];
      lists.forEach((list) => (list.scrollTop = 0));
      await pause();
      const publishFrame = (frame: number, isPlaying = true) =>
        stateHub.publish(PLAYBACK_STATUS_PROJECTION, playbackOwner, {
          active: true,
          lastFocusedAt: 1,
          videoId: "b",
          sourcePanelId: "sub",
          currentFrame: frame,
          isPlaying,
        });
      const assertFollowing = () => {
        for (const [index, list] of lists.entries()) {
          const row = list.querySelector(
            index === 0 ? ".shot-row.is-current" : ".cue-row.is-current",
          );
          check(row, "current row is rendered after following playback");
          const centerOffset = playbackRowCenterOffset(list, row);
          check(
            Math.abs(centerOffset) < 0.01,
            `playback follows the current row to the viewport center (offset: ${centerOffset})`,
          );
        }
      };
      const positions = lists.map((): number[] => []);
      const rowMeasurements = await countPlaybackRowMeasurements(async () => {
        flushSync(() => publishFrame(3600));
        const startedAt = performance.now();
        await new Promise<void>((resolve) => {
          let lastFrame = 3600;
          const sample = (now: number) => {
            const elapsed = now - startedAt;
            const frame = 3600 + Math.floor((elapsed * 24) / 1000);
            if (frame !== lastFrame) {
              flushSync(() => publishFrame(frame));
              lastFrame = frame;
            }
            lists.forEach((list, i) => positions[i].push(list.scrollTop));
            if (elapsed < 1200) requestAnimationFrame(sample);
            else resolve();
          };
          requestAnimationFrame(sample);
        });
      });
      equal(rowMeasurements, 0, "following playback does not synchronously measure rendered rows");
      for (const samples of positions) {
        const finalOffset = samples.at(-1) ?? 0;
        equal(finalOffset > 0, true, "follow reaches a distant row");
        equal(
          samples.some((offset) => offset > 0 && offset < finalOffset),
          true,
          "long-list follow animates rather than jumping, including mixed source durations",
        );
      }
      assertFollowing();
      await play("b", 1200, "sub");
      await act(() => publishFrame(1201, false));
      const pausedOffsets = lists.map((list) => list.scrollTop);
      await new Promise((resolve) => setTimeout(resolve, 150));
      equal(
        lists.map((list) => list.scrollTop),
        pausedOffsets,
        "pausing cancels follow animation",
      );
      const sizes = [snapshots.board.board.thumbnailSize, snapshots.sub.subtitle.thumbnailSize];
      await act(() => publishFrame(1201));
      await act(() => {
        snapshots.board.board.setThumbnailSize(sizes[0] + 10);
        snapshots.sub.subtitle.setThumbnailSize(sizes[1] + 10);
      });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assertFollowing();
      await act(() => stateHub.remove(PLAYBACK_STATUS_PROJECTION, playbackOwner));
      await act(() => {
        snapshots.board.board.setThumbnailSize(sizes[0]);
        snapshots.sub.subtitle.setThumbnailSize(sizes[1]);
      });
      return true;
    }

    const aShot = (id: number) => sourceRowId("a:a:fp", `shot-${id}`);
    const bShot = (id: number) => sourceRowId("b:b:fp", `shot-${id}`);
    if (scenario === "merge") {
      await reset();
      const fourShots = {
        ...emptyStoryboard(),
        shots: Array.from({ length: 4 }, (_, index) => ({
          id: `shot-${index + 1}`,
          sequence: index + 1,
          start_frame: index * 60,
          end_frame: (index + 1) * 60 - 1,
          start_us: index * 2_500_000,
          end_us: (index + 1) * 2_500_000 - 1,
        })),
      };
      await act(() => snapshots.port.storyboardUpdated("a:a:fp", "four shots", () => fourShots));
      await act(() => snapshots.board.board.shotSelectionReplaced(["shot-1", "shot-3"]));
      const mergeHistory = historySize();
      await act(() => snapshots.board.board.mergeShots(["shot-1", "shot-3"]));
      equal(
        getProjectWorkspaceSnapshot().storyboards!["a:a:fp"],
        fourShots,
        "nonadjacent merge leaves all intervals untouched",
      );
      equal(historySize(), mergeHistory, "invalid merge creates no history");
      equal(
        [...snapshots.board.board.selectedShotIds],
        ["shot-1", "shot-3"],
        "invalid merge preserves selection",
      );
      {
        for (const mode of ["list", "grid"] as const) {
          await act(() => snapshots.board.board.setViewMode(mode));
          const row = document.querySelector('[data-storyboard-shot-id="shot-1"]');
          await act(() =>
            row!.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                button: 2,
                clientX: 100,
                clientY: 150,
              }),
            ),
          );
          const merge = Array.from(
            document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
          ).find((item) => item.textContent?.includes("合并(M)"));
          equal(merge?.disabled, true, `${mode} disables merge for nonadjacent selected shots`);
          await act(() =>
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
          );
        }
        await act(() => snapshots.board.board.setViewMode("list"));
      }
      await act(() => snapshots.board.board.mergeShots(["shot-3", "shot-2"]));
      equal(
        getProjectWorkspaceSnapshot().storyboards!["a:a:fp"].shots.map((shot) => [
          shot.id,
          shot.start_frame,
          shot.end_frame,
        ]),
        [
          ["shot-1", 0, 59],
          ["shot-2", 60, 179],
          ["shot-4", 180, 239],
        ],
        "adjacent merge removes only the chosen internal cut",
      );
      equal(
        [...snapshots.board.board.selectedShotIds],
        ["shot-2"],
        "merged selection keeps the first chronological shot",
      );
      await reset();
      await act(() => snapshots.port.storyboardUpdated("a:a:fp", "four shots", () => fourShots));
      await act(() => snapshots.board.source.toggleSource("b"));
      const boardsBeforeMerge = getProjectWorkspaceSnapshot().storyboards;
      const mergeCursor = snapshots.port.projectHistory.cursor;
      await act(() => snapshots.board.board.mergeShots([aShot(1), aShot(3), bShot(1), bShot(2)]));
      equal(
        getProjectWorkspaceSnapshot().storyboards,
        boardsBeforeMerge,
        "one nonadjacent source rejects the entire multi-source merge",
      );
      equal(snapshots.port.projectHistory.cursor, mergeCursor, "rejected batch creates no history");
      await act(() => snapshots.board.board.mergeShots([aShot(1), aShot(2), bShot(1), bShot(2)]));
      equal(
        getProjectWorkspaceSnapshot().storyboards!["a:a:fp"].shots.length,
        3,
        "valid batch merges adjacent A shots",
      );
      equal(
        getProjectWorkspaceSnapshot().storyboards!["b:b:fp"].shots.length,
        1,
        "valid batch merges adjacent B shots",
      );
      equal(
        snapshots.port.projectHistory.cursor,
        mergeCursor + 1,
        "valid multi-source merge is one history entry",
      );
      await act(() => snapshots.port.projectHistoryJumped(mergeCursor));
      equal(
        getProjectWorkspaceSnapshot().storyboards,
        boardsBeforeMerge,
        "undo restores all merged sources",
      );
      return true;
    }
    if (scenario === "history") {
      await reset();
      await act(() => snapshots.board.source.selection.rememberFrame("a", 48));
      await act(() => snapshots.board.board.shotSelectionReplaced(["shot-2"], "shot-2"));
      await act(() => snapshots.port.mediaItemsRemoved(["a"]));
      equal(sourceIds("board"), [], "deleting sole selected source leaves the panel empty");
      equal(snapshots.port.activeVideoId, "", "unselected media is not opened automatically");
      equal(
        snapshots.board.source.selection.sources.map((source) => source.videoId),
        ["a"],
        "original source is retained",
      );
      equal(historySize(), 1, "fallback adds no history");
      await act(() => snapshots.port.projectHistoryJumped(0));
      equal(sourceIds("board"), ["a"], "undo restores source");
      equal(snapshots.board.source.selection.savedFrame(), 48, "undo restores frame");
      equal(
        [...snapshots.board.board.selectedShotIds],
        ["shot-2"],
        "undo restores selection session",
      );
      equal(snapshots.port.activeVideoId, "a", "undo restores preview");
      await act(() => snapshots.port.projectHistoryJumped(1));
      equal(sourceIds("board"), [], "redo restores the empty source");
      equal(historySize(), 1, "redo adds no history");

      await reset();
      await act(() => snapshots.board.source.toggleSource("b"));
      const scope = snapshots.board.board.videoContext;
      const selected = sourceRowId("a:a:fp", "shot-2");
      await act(() => snapshots.board.board.shotSelectionReplaced([selected], selected));
      await act(() => snapshots.port.mediaItemsRemoved(["a"]));
      equal(sourceIds("board"), ["b"], "multi-source deletion removes only effective source");
      await act(() => snapshots.port.projectHistoryJumped(0));
      equal(sourceIds("board"), ["a", "b"], "undo restores multi-source scope");
      equal(snapshots.board.board.videoContext, scope, "scope identity survives undo");
      equal(
        [...snapshots.board.board.selectedShotIds],
        [selected],
        "multi-source selection survives undo",
      );

      await reset();
      await act(() => snapshots.port.mediaItemsRemoved(["a", "b"]));
      equal(sourceIds("board"), [], "delete all empties effective sources");
      equal(snapshots.port.activeVideoId, "", "delete all clears preview");
      await act(() => snapshots.port.projectHistoryJumped(0));
      equal(sourceIds("board"), ["a"], "undo all restores original source");
      equal(historySize(), 1, "empty preview adds no history");

      await reset();
      await act(() => snapshots.port.mediaItemsRemoved(["a"]));
      await act(() => snapshots.board.source.selectVideo("b", "b-1"));
      await act(() => snapshots.board.source.selection.rememberFrame("b", 72));
      await act(() => snapshots.port.projectHistoryJumped(0));
      equal(sourceIds("board"), ["b"], "explicit choice during deletion survives undo");
      equal(
        snapshots.board.source.selection.savedFrame(),
        72,
        "explicit preview retains requested frame",
      );

      await reset();
      await act(() => snapshots.sub.subtitle.cueSelectionReplaced(["a-1-cue-2"]));
      await act(() => snapshots.sub.subtitle.setQuery("a"));
      await act(() => snapshots.port.mediaItemsRemoved(["a"]));
      await act(() => snapshots.port.projectHistoryJumped(0));
      equal(
        [...snapshots.sub.subtitle.selectedCueIds],
        ["a-1-cue-2"],
        "subtitle session selection restored",
      );
      equal(snapshots.sub.subtitle.query, "a", "subtitle session filter restored");

      await reset();
      const folderWorkspace = workspace();
      folderWorkspace.media_bin.folders = [
        { id: "parent", name: "parent", parent_id: null, hidden: false, color: "" },
        { id: "child", name: "child", parent_id: "parent", hidden: false, color: "" },
      ];
      folderWorkspace.media_bin.items[0].bin_id = "child";
      await act(() =>
        snapshots.port.projectOpened(folderWorkspace, "/folder.lcut", "folder-audit"),
      );
      const foldersBefore = getProjectWorkspaceSnapshot().media_bin.folders;
      await act(() => snapshots.port.mediaBinEntriesRemoved(["parent"], []));
      equal(sourceIds("board"), [], "recursive folder deletion leaves the panel empty");
      equal(getProjectWorkspaceSnapshot().media_bin.folders, [], "folder descendants deleted");
      await act(() => snapshots.port.projectHistoryJumped(0));
      equal(sourceIds("board"), ["a"], "undo recursive folder restores panel source");
      equal(
        getProjectWorkspaceSnapshot().media_bin.folders,
        foldersBefore,
        "undo restores folder hierarchy",
      );

      for (const ripple of [false, true]) {
        await reset();
        await act(() => snapshots.board.source.toggleSource("b"));
        const before = getProjectWorkspaceSnapshot().storyboards;
        await act(() =>
          snapshots.board.board.deleteShots(
            [sourceRowId("a:a:fp", "shot-1"), sourceRowId("b:b:fp", "shot-1")],
            ripple,
          ),
        );
        equal(
          snapshots.board.board.shots.length,
          2,
          "multi-source shot deletion affects both sources",
        );
        equal(
          getProjectWorkspaceSnapshot().storyboards!["b:b:fp"].shots[0].start_frame,
          ripple ? 0 : 120,
          "ripple is confined to each source",
        );
        equal(historySize(), 1, "multi-source shot deletion is one history entry");
        await act(() => snapshots.port.projectHistoryJumped(0));
        equal(
          getProjectWorkspaceSnapshot().storyboards,
          before,
          "undo shot deletion restores complete metadata",
        );
        await act(() => snapshots.port.projectHistoryJumped(1));
        equal(snapshots.board.board.shots.length, 2, "redo shot deletion restores both sources");
      }

      for (const ripple of [false, true]) {
        await reset();
        await act(() => snapshots.sub.source.toggleSource("b"));
        await act(() =>
          snapshots.sub.subtitle.setCueRatings(
            [sourceRowId("a:a:fp:a-1", "a-1-cue-1"), sourceRowId("b:b:fp:b-1", "b-1-cue-1")],
            5,
          ),
        );
        const before = getProjectWorkspaceSnapshot();
        const cursor = snapshots.port.projectHistory.cursor;
        await act(() => {
          for (const videoId of ["a", "b"])
            snapshots.port.subtitleCuesDeleted(
              videoId,
              `${videoId}:${videoId}:fp:${videoId}-1`,
              `${videoId}-1`,
              [`${videoId}-1-cue-1`],
              ripple,
              "multi-cue-delete",
            );
        });
        equal(
          getProjectWorkspaceSnapshot().projects.map((project) => project.tracks[0].cue_count),
          [1, 1],
          "cue deletion updates both track counts",
        );
        equal(
          snapshots.port.projectHistory.cursor,
          cursor + 1,
          "multi-source cue deletion grouped into one undo",
        );
        await act(() => snapshots.port.projectHistoryJumped(cursor));
        const after = getProjectWorkspaceSnapshot();
        equal(after.projects, before.projects, "undo cue deletion restores timings and counts");
        equal(after.subtitles, before.subtitles, "undo cue deletion restores annotations");
        await act(() => snapshots.port.projectHistoryJumped(cursor + 1));
        equal(
          getProjectWorkspaceSnapshot().projects.map((project) => project.tracks[0].cue_count),
          [1, 1],
          "redo cue deletion restores counts",
        );
      }

      await reset();
      await act(() => snapshots.port.mediaItemsEnabledChanged(["a"], false));
      equal(sourceIds("board"), [], "disabled source leaves the panel empty");
      await act(() => snapshots.port.projectHistoryJumped(0));
      equal(sourceIds("board"), ["a"], "undo disable restores original source");

      await reset();
      await act(() => snapshots.manager.focusPanel("sub"));
      await act(() => snapshots.sub.source.toggleSource("a", "a-2"));
      equal(snapshots.sub.source.activeTrackId, "a-2", "panel chooses track");
      equal(snapshots.port.activeTrackId, "a-2", "preview chooses track");
      equal(historySize(), 1, "explicit track switch records history");
      await act(() => snapshots.port.projectHistoryJumped(0));
      equal(snapshots.sub.source.activeTrackId, "a-1", "undo restores panel track");
      equal(snapshots.port.activeTrackId, "a-1", "undo restores preview track");
      equal(snapshots.board.source.activeTrackId, "a-1", "undo leaves other panel independent");
      await act(() => snapshots.port.projectHistoryJumped(1));
      equal(snapshots.sub.source.activeTrackId, "a-2", "redo restores panel track");
      await act(() => snapshots.manager.focusPanel("board"));
      await act(() => snapshots.manager.focusPanel("sub"));
      equal(historySize(), 1, "focus adds no history");

      await reset();
      await act(() => snapshots.manager.focusPanel("sub"));
      await act(() => snapshots.sub.source.toggleSource("a", "a-2"));
      await act(() => snapshots.port.mediaItemsRemoved(["a"]));
      await act(() => snapshots.port.projectHistoryJumped(0));
      equal(sourceIds("sub"), ["a"], "jump across switch and deletion restores source");
      equal(snapshots.sub.source.activeTrackId, "a-1", "jump restores original track");
      await act(() => snapshots.port.projectHistoryJumped(2));
      equal(sourceIds("sub"), [], "redo jump restores empty source after deletion");
      await act(() => snapshots.port.projectHistoryJumped(1));
      equal(
        snapshots.sub.source.activeTrackId,
        "a-2",
        "undo deletion retains earlier track switch",
      );
      equal(historySize(), 2, "history jumps never append synthetic edits");
      return true;
    }

    await reset();
    await act(() => snapshots.port.storyboardUpdated("a:a:fp", "empty", () => emptyStoryboard()));
    await act(() => snapshots.board.detection.requestDetection(["a"], true));
    for (let index = 0; !finishDetection && index < 100; index += 1) await pause();
    equal(detectionCalls, 1, "detection started");
    const manual = workspace().storyboards!["a:a:fp"];
    manual.shotAnnotations = { "shot-1": { title: "manual", rating: 5, retained: true } };
    await act(() => snapshots.port.storyboardUpdated("a:a:fp", "manual edit", () => manual));
    await act(() => finishDetection!({ shots: manual.shots, frame_rate: 24 }));
    equal(
      Boolean(document.querySelector(".storyboard-detection-conflict-dialog")),
      true,
      "completion conflict prompts again",
    );
    equal(
      getProjectWorkspaceSnapshot().storyboards!["a:a:fp"].shotAnnotations["shot-1"].rating,
      5,
      "awaiting confirmation preserves edits",
    );
    await act(() =>
      document
        .querySelector<HTMLButtonElement>(
          ".storyboard-detection-conflict-dialog .modal-dialog-confirm",
        )!
        .click(),
    );
    equal(detectionCalls, 1, "confirmation uses existing result");
    equal(
      getProjectWorkspaceSnapshot().storyboards!["a:a:fp"].shotAnnotations["shot-1"].rating,
      5,
      "merge preserves manual annotations",
    );

    for (const mode of ["overwrite", "cancel"]) {
      await reset();
      finishDetection = undefined;
      await act(() => snapshots.port.storyboardUpdated("a:a:fp", "empty", () => emptyStoryboard()));
      await act(() => snapshots.board.detection.requestDetection(["a"], true));
      for (let index = 0; !finishDetection && index < 100; index += 1) await pause();
      await act(() => snapshots.port.storyboardUpdated("a:a:fp", "manual edit", () => manual));
      await act(() => finishDetection!({ shots: manual.shots, frame_rate: 24 }));
      equal(snapshots.board.detection.detectionTasks.length, 0, "confirmation releases task queue");
      const buttons = document.querySelectorAll<HTMLButtonElement>(
        ".storyboard-detection-conflict-dialog button",
      );
      const button = [...buttons].find(
        (entry) => entry.textContent === (mode === "overwrite" ? "覆盖" : "取消"),
      );
      await act(() => button!.click());
      equal(
        getProjectWorkspaceSnapshot().storyboards!["a:a:fp"].shotAnnotations["shot-1"].rating,
        mode === "overwrite" ? 0 : 5,
        "completion applies confirmed overwrite or cancellation",
      );
      equal(
        Boolean(document.querySelector(".storyboard-detection-conflict-dialog")),
        false,
        "completion dialog closes",
      );
    }

    await reset();
    finishDetection = undefined;
    await act(() => snapshots.board.detection.requestDetection(["a", "b"]));
    await act(() =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".storyboard-detection-conflict-dialog button",
        ),
      ]
        .find((button) => button.textContent === "覆盖")!
        .click(),
    );
    for (let index = 0; detectionFinishes.size < 2 && index < 100; index += 1) await pause();
    equal(detectionFinishes.size, 2, "both sources start in the three-slot scheduler");
    const finishA = detectionFinishes.get("a");
    const finishB = detectionFinishes.get("b");
    await act(() => snapshots.port.storyboardUpdated("b:b:fp", "queued manual edit", () => manual));
    await act(() => finishA!({ shots: manual.shots, frame_rate: 24 }));
    await act(() => finishB!({ shots: manual.shots, frame_rate: 24 }));
    equal(
      Boolean(document.querySelector(".storyboard-detection-conflict-dialog")),
      true,
      "edits during concurrent detection also prompt again",
    );
    await act(() =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".storyboard-detection-conflict-dialog button",
        ),
      ]
        .find((button) => button.textContent === "取消")!
        .click(),
    );
    equal(
      getProjectWorkspaceSnapshot().storyboards!["b:b:fp"].shotAnnotations["shot-1"].rating,
      5,
      "queued edits preserved on cancel",
    );
    equal(
      Boolean(document.querySelector(".storyboard-detection-conflict-dialog")),
      false,
      "unrelated source edits do not create extra conflicts",
    );

    await reset();
    finishDetection = undefined;
    await act(() => snapshots.port.storyboardUpdated("a:a:fp", "empty", () => emptyStoryboard()));
    await act(() => snapshots.board.detection.requestDetection(["a"], true));
    for (let index = 0; !finishDetection && index < 100; index += 1) await pause();
    await act(() => snapshots.port.mediaItemsRemoved(["a"]));
    const deletionCursor = snapshots.port.projectHistory.cursor;
    await act(() => finishDetection!({ shots: manual.shots, frame_rate: 24 }));
    equal(
      Boolean(getProjectWorkspaceSnapshot().storyboards!["a:a:fp"]),
      false,
      "deleted source ignores detection result",
    );
    equal(
      snapshots.port.projectHistory.cursor,
      deletionCursor,
      "late detection does not append history",
    );
    equal(
      Boolean(document.querySelector(".storyboard-detection-conflict-dialog")),
      false,
      "deleted source has no completion dialog",
    );
    await act(() => snapshots.port.projectHistoryJumped(deletionCursor - 1));
    equal(
      getProjectWorkspaceSnapshot().storyboards!["a:a:fp"].shots,
      [],
      "undo deletion does not apply discarded late result",
    );

    await reset();
    finishDetection = undefined;
    await act(() => snapshots.port.storyboardUpdated("a:a:fp", "empty", () => emptyStoryboard()));
    await act(() => snapshots.board.detection.requestDetection(["a"], true));
    for (let index = 0; !finishDetection && index < 100; index += 1) await pause();
    await act(() => snapshots.port.storyboardUpdated("a:a:fp", "manual edit", () => manual));
    await act(() => finishDetection!({ shots: manual.shots, frame_rate: 24 }));
    equal(
      Boolean(document.querySelector(".storyboard-detection-conflict-dialog")),
      true,
      "awaiting completion confirmation",
    );
    await act(() => snapshots.port.mediaItemsRemoved(["a"]));
    equal(
      Boolean(document.querySelector(".storyboard-detection-conflict-dialog")),
      false,
      "deleting confirmation target dismisses expired dialog",
    );
    await act(() => snapshots.port.projectHistoryJumped(snapshots.port.projectHistory.cursor - 1));
    equal(
      getProjectWorkspaceSnapshot().storyboards!["a:a:fp"].shotAnnotations["shot-1"].rating,
      5,
      "undo restores manual edits without committing cancelled detection",
    );
    return true;
  } finally {
    stateHub.remove(PLAYBACK_STATUS_PROJECTION, playbackOwner);
    flushSync(() => root.unmount());
    host.remove();
    restoreNative();
  }
}
