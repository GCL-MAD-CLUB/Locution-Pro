import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PanelSearch } from "../../src/components/common/PanelSearch/PanelSearch.tsx";
import { defaultAdvancedSearch } from "../../src/core/editor/textSearch.ts";

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
