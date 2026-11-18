import type { SearchMode, SearchRule } from "../../../../src/core/editor/search/textSearch";
import { RenderLifetime } from "../../../../src/runtime/lifetime/RenderLifetime.ts";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PanelSearch } from "../../../../src/components/common/PanelSearch/PanelSearch.tsx";
import { defaultAdvancedSearch } from "../../../../src/core/editor/search/textSearch.ts";
import { useSubtitlePanelState } from "../../../../src/components/panels/SubtitlePanel/subtitlePanelState.ts";
import { useStoryboardPanelState } from "../../../../src/components/panels/StoryboardPanel/storyboardPanelState.ts";
import { PanelInstanceProvider } from "../../../../src/runtime/systems/PanelState.tsx";

export function mountAdvancedSearch(label: string) {
  function Harness() {
    const [query, setQuery] = useState("hello");
    const [mode, setMode] = useState<SearchMode>("filter");
    const [rule, setRule] = useState<SearchRule>("contains");
    const [scope, setScope] = useState<"any" | "title" | "keywords">("any");
    const [advanced, setAdvanced] = useState({ ...defaultAdvancedSearch });
    const [threshold, setThreshold] = useState(0);
    window.searchSnapshot = { query, mode, rule, scope, advanced, threshold };
    return React.createElement(PanelSearch, {
      label,
      historyKind: label === "字幕" ? "subtitle" : "storyboard",
      query,
      mode,
      rule,
      scope: label === "分镜" ? scope : undefined,
      advanced,
      disabled: false,
      canNavigate: false,
      summary: "",
      onQueryChange: setQuery,
      onModeChange: setMode,
      onRuleChange: setRule,
      onScopeChange: setScope,
      onAdvancedChange: setAdvanced,
      onNavigate: () => {},
      semantic: {
        threshold,
        thresholdDecimals: 3,
        available: true,
        onThresholdChange: setThreshold,
      },
    });
  }
  const host = document.createElement("div");
  document.body.append(host);
  createRoot(host).render(React.createElement(Harness));
}

export function mountAdvancedSearchWithPanelState(label: string) {
  function Harness() {
    const lifetime = new RenderLifetime();

    const usePanel = label === "字幕" ? useSubtitlePanelState : useStoryboardPanelState;
    const state = usePanel(lifetime, (state) => state, "mode-regression", 1);
    window.searchSnapshot = {
      query: state.query,
      mode: state.searchMode,
      rule: state.searchRule,
      scope: "searchScope" in state ? state.searchScope : undefined,
      threshold: state.semanticThreshold,
      advanced: state.advancedSearch,
    };
    return lifetime.render(
      React.createElement(PanelSearch, {
        label,
        historyKind: label === "字幕" ? "subtitle" : "storyboard",
        query: state.query,
        mode: state.searchMode,
        rule: state.searchRule,
        scope: "searchScope" in state ? state.searchScope : undefined,
        advanced: state.advancedSearch,
        disabled: false,
        canNavigate: false,
        summary: "",
        onQueryChange: state.setQuery,
        onModeChange: state.setSearchMode,
        onRuleChange: state.setSearchRule,
        onScopeChange: "setSearchScope" in state ? state.setSearchScope : undefined,
        onAdvancedChange: state.setAdvancedSearch,
        onNavigate: () => {},
        semantic: {
          threshold: state.semanticThreshold,
          thresholdDecimals: label === "分镜" ? 3 : 2,
          available: true,
          onThresholdChange: state.setSemanticThreshold,
        },
      }),
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  createRoot(host).render(
    <PanelInstanceProvider instanceId="mode-regression">
      <Harness />
    </PanelInstanceProvider>,
  );
}
