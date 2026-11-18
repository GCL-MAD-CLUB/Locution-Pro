import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createModuleLoader } from "../../support/module-loader.ts";
import { RenderLifetime } from "../../support/lifetime.ts";
import { fallbackSelectionValue } from "../../../../src/components/common/PopupMenu/selectionValue.ts";
import * as scheduling from "../../support/scheduling.ts";

const menu = createModuleLoader(import.meta.url)<
  typeof import("../../../../src/components/common/PopupMenu/PopupMenu.tsx")
>("../../../../src/components/common/PopupMenu/PopupMenu.tsx", {
  react: React,
  "react/jsx-runtime": jsx,
  "react-dom": {},
  "lucide-react": {},
  "../../../runtime/lifetime/RenderLifetime": { RenderLifetime },
  "../../../runtime/scheduling": scheduling,
  "../../../runtime/errors": {
    clientError: (_code: string, message: string) => new Error(message),
  },
  "./selectionValue": { fallbackSelectionValue },
  "./PopupMenu.css": {},
});

test("popup selection keeps a valid default and falls back when it is disabled", () => {
  const render = (disabled: boolean) =>
    renderToStaticMarkup(
      jsx.jsxs(menu.PopupMenuSelectionGroup, {
        defaultValue: "second",
        children: [
          jsx.jsx(menu.PopupMenuSelectionItem, {
            value: "first",
            key: "first",
            children: "First",
          }),
          jsx.jsx(menu.PopupMenuSelectionItem, {
            value: "second",
            key: "second",
            disabled,
            children: "Second",
          }),
        ],
      }),
    );
  const enabled = render(false).match(/<button.*?<\/button>/g) ?? [];
  assert.equal(enabled.length, 2);
  assert.match(enabled[0] ?? "", /aria-checked="false"/);
  assert.match(enabled[1], /aria-checked="true"/);
  const disabled = render(true).match(/<button.*?<\/button>/g) ?? [];
  assert.equal(disabled.length, 2);
  assert.match(disabled[0] ?? "", /aria-checked="true"/);
  assert.match(disabled[1], /aria-checked="false"/);
});
