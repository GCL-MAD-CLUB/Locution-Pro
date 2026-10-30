import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PanelSearch } from "../../src/components/common/PanelSearch/PanelSearch.tsx";
import { defaultAdvancedSearch } from "../../src/core/editor/textSearch.ts";
import { useSubtitlePanelState } from "../../src/components/panels/SubtitlePanel/subtitlePanelState.ts";
import { useStoryboardPanelState } from "../../src/components/panels/StoryboardPanel/storyboardPanelState.ts";
import { PanelInstanceProvider } from "../../src/runtime/systems/PanelState.tsx";

export function mountAdvancedSearch(label) {
  function Harness() {
    const [query, setQuery] = useState("hello");
    const [mode, setMode] = useState("filter");
    const [rule, setRule] = useState("contains");
    const [scope, setScope] = useState("any");
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

export function mountAdvancedSearchWithPanelState(label) {
  function Harness() {
    const usePanel = label === "字幕" ? useSubtitlePanelState : useStoryboardPanelState;
    const state = usePanel((state) => state, "mode-regression", 1);
    window.searchSnapshot = {
      query: state.query,
      mode: state.searchMode,
      advanced: state.advancedSearch,
    };
    return React.createElement(PanelSearch, {
      label,
      historyKind: label === "字幕" ? "subtitle" : "storyboard",
      query: state.query,
      mode: state.searchMode,
      rule: state.searchRule,
      scope: label === "分镜" ? state.searchScope : undefined,
      advanced: state.advancedSearch,
      disabled: false,
      canNavigate: false,
      summary: "",
      onQueryChange: state.setQuery,
      onModeChange: state.setSearchMode,
      onRuleChange: state.setSearchRule,
      onScopeChange: state.setSearchScope,
      onAdvancedChange: state.setAdvancedSearch,
      onNavigate: () => {},
      semantic: {
        threshold: state.semanticThreshold,
        available: true,
        onThresholdChange: state.setSemanticThreshold,
      },
    });
  }
  const host = document.createElement("div");
  document.body.append(host);
  createRoot(host).render(
    React.createElement(
      PanelInstanceProvider,
      { instanceId: "mode-regression" },
      React.createElement(Harness),
    ),
  );
}
