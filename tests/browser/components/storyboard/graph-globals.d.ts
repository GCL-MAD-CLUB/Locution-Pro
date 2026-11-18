import type {
  StoryboardGraph,
  StoryboardGraphVector,
} from "../../../../src/core/editor/storyboardGraph/graph";
import type { StoryboardShotAnnotation } from "../../../../src/types";

declare global {
  interface Window {
    graphGeometry: typeof import("./graph-geometry").graphGeometry;
    graphLiveTarget: StoryboardGraph;
    graphLiveHold: boolean;
    graphLiveHoldSearch: boolean;
    graphLiveReleaseIndex: () => void;
    graphLiveRelease: () => void;
    graphLiveReleaseSearch: () => void;
    graphLiveRequests: Array<{
      vectors?: StoryboardGraphVector[];
      visibleIds: string[];
      options: { clusterEnabled: boolean };
    }>;
    graphLiveInteractions: {
      selections: string[][];
      activations: string[];
      sprays: string[][];
      menus: number;
    };
    graphLiveCalls: Array<{ command: string; args: Record<string, unknown> }>;
    graphLiveThreshold: (threshold: number) => void;
    graphLiveQuery: (query: string) => void;
    graphLiveSearchStatus: string;
    graphInitialTrace: Array<{ x: number; y: number }>;
    graphLiveTrace: Array<{ x: number; y: number }>;
    graphLiveSetSprayActive: (active: boolean) => void;
    graphLiveWorkers: number;
    graphLiveFilter: (ids: string[] | null) => void;
    graphLiveRetained: Element | null;
    graphLiveProgress: string[];
    graphLiveDelete: (ids: string[]) => void;
    graphSelection: string[];
    graphActivatedShot: string | null;
    graphActivations: string[];
    graphSprays: Array<{ ids: string[]; historyGroupId: string; eraseWithAlt: boolean }>;
    graphSetSprayActive: (active: boolean) => void;
    graphSetSelection: (ids: Set<string>) => void;
    graphComputedGraph: StoryboardGraph;
    graphSetMaxVisibleDegree: (degree: number) => void;
    graphSetAnnotations: (annotations: Record<string, StoryboardShotAnnotation>) => void;
  }
}
