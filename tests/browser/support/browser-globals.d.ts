import type {
  StoryboardGraph,
  StoryboardGraphVector,
} from "../../../src/core/editor/storyboardGraph/graph";
import type {
  AdvancedSearchOptions,
  SearchMode,
  SearchRule,
} from "../../../src/core/editor/search/textSearch";
import type { StoryboardShotAnnotation } from "../../../src/types";
import type { installNative } from "./native";

declare global {
  interface Window {
    __nativeTest: ReturnType<typeof installNative>;
    searchSnapshot: {
      query: string;
      mode: SearchMode;
      rule: SearchRule;
      scope?: "any" | "title" | "keywords";
      advanced: AdvancedSearchOptions;
      threshold: number;
    };
    leakedKeys: string[];
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
