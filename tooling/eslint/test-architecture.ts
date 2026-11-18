import { relative, resolve, dirname } from "node:path";
import { AST_NODE_TYPES, ASTUtils, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

const stylesheetAPIs = new Set([
  "getComputedStyle",
  "computedStyleMap",
  "toHaveCSS",
  "toHaveScreenshot",
  "toMatchSnapshot",
  "screenshot",
]);
const geometryAPIs = new Set([
  "boundingBox",
  "getBoundingClientRect",
  "getClientRects",
  "getBBox",
  "offsetHeight",
  "offsetWidth",
  "offsetLeft",
  "offsetTop",
  "clientHeight",
  "clientWidth",
  "clientLeft",
  "clientTop",
  "scrollHeight",
  "scrollWidth",
]);
const visualAttributes =
  /^(?:style|width|height|color|fill|stroke|stroke-width|opacity|font-size|viewBox|r|rx|ry)$/iu;
const testDeclaration = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

function owner(file: string) {
  const [, layer, group, feature] = file.split("/");
  if (group === "support") return `${layer}/support`;
  return layer === "integration" ? `${layer}/${group}` : `${layer}/${group}/${feature}`;
}

function isStyleSetup(node: TSESTree.MemberExpression) {
  const parent = node.parent;
  if (parent.type === AST_NODE_TYPES.AssignmentExpression)
    return parent.left === node && parent.operator === "=";
  if (parent.type !== AST_NODE_TYPES.MemberExpression || parent.object !== node) return false;
  const usage = parent.parent;
  return (
    (usage.type === AST_NODE_TYPES.AssignmentExpression &&
      usage.left === parent &&
      usage.operator === "=") ||
    (usage.type === AST_NODE_TYPES.CallExpression &&
      usage.callee === parent &&
      parent.property.type === AST_NODE_TYPES.Identifier &&
      ["setProperty", "removeProperty"].includes(parent.property.name))
  );
}

function readsPresentationProperty(node: TSESTree.Node) {
  const call = node.parent;
  const access = call?.parent;
  return (
    call?.type === AST_NODE_TYPES.CallExpression &&
    call.callee === node &&
    access?.type === AST_NODE_TYPES.MemberExpression &&
    access.object === call &&
    !access.computed &&
    access.property.type === AST_NODE_TYPES.Identifier &&
    ["opacity", "zIndex", "fill", "stroke"].includes(access.property.name)
  );
}

function readsGeneratedThemeImage(node: TSESTree.MemberExpression) {
  const method = node.parent;
  const call = method?.parent;
  if (
    method?.type !== AST_NODE_TYPES.MemberExpression ||
    method.object !== node ||
    ASTUtils.getPropertyName(method) !== "getPropertyValue" ||
    call?.type !== AST_NODE_TYPES.CallExpression ||
    call.callee !== method
  )
    return false;
  const property = call.arguments[0];
  return (
    property?.type === AST_NODE_TYPES.Literal &&
    typeof property.value === "string" &&
    /^--image-[\w-]+$/u.test(property.value)
  );
}

export const testArchitecture = {
  rules: {
    boundaries: ESLintUtils.RuleCreator.withoutDocs({
      meta: {
        type: "problem",
        schema: [],
        messages: {
          foreignFixture:
            "Use a fixture in this feature or in the same test layer's support directory.",
          testImport: "Test entry points run independently. Move reusable code to a fixture.",
          browserRunner: "Import browser test and expect from browser/support/fixtures.",
          nodeRunner: "Place node:test declarations in a unit or integration .test.ts entry point.",
          site: "Validate site through static checks and deterministic unit tests.",
          focused:
            "Keep the full suite discoverable. Resolve focused, skipped or unfinished tests.",
        },
      },
      defaultOptions: [],
      create(context) {
        const file = relative(context.cwd, context.filename).replaceAll("\\", "/");
        const layer = file.split("/")[1];
        const browser = layer === "browser";
        const supportedBrowserFixture = file === "tests/browser/support/fixtures.ts";
        const currentOwner = owner(file);

        function checkImport(node: TSESTree.Node, source: unknown, typeOnly = false) {
          if (typeof source !== "string") return;
          if (source === "node:test" && (browser || !testDeclaration.test(file))) {
            context.report({ node, messageId: "nodeRunner" });
          }
          if (
            source === "@playwright/test" &&
            (!browser || (!typeOnly && !supportedBrowserFixture))
          ) {
            context.report({ node, messageId: "browserRunner" });
          }
          if (!source.startsWith(".") && !source.startsWith("/")) return;
          const path = source.split(/[?#]/u)[0];
          const target = (
            path.startsWith("/")
              ? path.slice(1)
              : relative(context.cwd, resolve(dirname(context.filename), path))
          ).replaceAll("\\", "/");
          if (browser && (target === "site" || target.startsWith("site/"))) {
            context.report({ node, messageId: "site" });
          } else if (target.startsWith("tests/")) {
            if (testDeclaration.test(target) || /\.(?:test|spec)$/u.test(target)) {
              context.report({ node, messageId: "testImport" });
            } else if (owner(target) !== currentOwner && owner(target) !== `${layer}/support`) {
              context.report({ node, messageId: "foreignFixture" });
            }
          }
        }

        return {
          ImportDeclaration(node) {
            checkImport(
              node.source,
              node.source.value,
              node.importKind === "type" ||
                (node.specifiers.length > 0 &&
                  node.specifiers.every(
                    (specifier) =>
                      specifier.type === AST_NODE_TYPES.ImportSpecifier &&
                      specifier.importKind === "type",
                  )),
            );
          },
          ExportNamedDeclaration(node) {
            if (node.source)
              checkImport(node.source, node.source.value, node.exportKind === "type");
          },
          ExportAllDeclaration(node) {
            checkImport(node.source, node.source.value, node.exportKind === "type");
          },
          ImportExpression(node) {
            checkImport(
              node,
              ASTUtils.getStaticValue(node.source, context.sourceCode.getScope(node))?.value,
            );
          },
          CallExpression(node) {
            if (
              node.callee.type === AST_NODE_TYPES.Identifier &&
              node.callee.name === "require" &&
              node.arguments[0]
            ) {
              checkImport(
                node,
                ASTUtils.getStaticValue(node.arguments[0], context.sourceCode.getScope(node))
                  ?.value,
              );
            }
            if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return;
            const member = ASTUtils.getPropertyName(node.callee, context.sourceCode.getScope(node));
            const receiver = node.callee.object;
            if (
              ["only", "skip", "fixme", "todo"].includes(member ?? "") &&
              ((receiver.type === AST_NODE_TYPES.Identifier &&
                ["test", "it", "describe"].includes(receiver.name)) ||
                (receiver.type === AST_NODE_TYPES.MemberExpression &&
                  ASTUtils.getPropertyName(receiver) === "describe"))
            ) {
              context.report({ node, messageId: "focused" });
            }
            if (browser && member === "goto" && node.arguments[0]) {
              checkImport(
                node,
                ASTUtils.getStaticValue(node.arguments[0], context.sourceCode.getScope(node))
                  ?.value,
              );
            }
          },
          Literal(node) {
            // Browser-loaded harness paths passed through page.evaluate cross the runner boundary in a string.
            if (
              browser &&
              typeof node.value === "string" &&
              node.value.startsWith("/tests/") &&
              ![AST_NODE_TYPES.ImportDeclaration, AST_NODE_TYPES.ImportExpression].includes(
                node.parent.type,
              )
            ) {
              checkImport(node, node.value);
            }
            if (
              node.parent.type === AST_NODE_TYPES.TSLiteralType &&
              node.parent.parent.type === AST_NODE_TYPES.TSImportType
            ) {
              checkImport(node, node.value, true);
            }
          },
        };
      },
    }),
    "behavior-assertions": ESLintUtils.RuleCreator.withoutDocs({
      meta: {
        type: "problem",
        schema: [],
        messages: {
          appearance:
            "Assert observable behavior or application state. Styling, visual snapshots and static geometry are outside the test contract.",
          geometry:
            "Use pointerAt for input coordinates or the graph fixture for live canvas navigation.",
        },
      },
      defaultOptions: [],
      create(context) {
        const file = relative(context.cwd, context.filename).replaceAll("\\", "/");
        const pointer = file === "tests/browser/support/pointer.ts";
        const browser = file.startsWith("tests/browser/");
        const graph = file === "tests/browser/components/storyboard/graph-geometry.ts";
        const graphPresentation =
          file === "tests/browser/components/storyboard/graph-presentation.ts";

        const followViewport = file === "tests/browser/state/panel-sources/follow-viewport.ts";
        const themePresentation = file === "tests/browser/components/theme/theme-presentation.ts";

        function checkAPI(node: TSESTree.Node, name: string | null) {
          if (!name) return;
          if (stylesheetAPIs.has(name)) {
            if (graphPresentation && name === "getComputedStyle" && readsPresentationProperty(node))
              return;
            context.report({ node, messageId: "appearance" });
          } else if (geometryAPIs.has(name) && !graph && !(pointer && name === "boundingBox")) {
            if (followViewport && ["getBoundingClientRect", "clientHeight"].includes(name)) return;
            // Node unit tests can change a synthetic viewport input to exercise an algorithm.
            const parent = node.parent;
            if (
              !browser &&
              parent?.type === AST_NODE_TYPES.AssignmentExpression &&
              parent.left === node &&
              parent.operator === "="
            )
              return;
            context.report({ node, messageId: "geometry" });
          }
        }

        return {
          Identifier(node) {
            const parent = node.parent;
            if (
              (parent.type === AST_NODE_TYPES.MemberExpression && parent.property === node) ||
              parent.type === AST_NODE_TYPES.Property
            )
              return;
            checkAPI(node, node.name);
          },
          MemberExpression(node) {
            const name = ASTUtils.getPropertyName(node, context.sourceCode.getScope(node));
            checkAPI(node, name);
            if (
              name === "style" &&
              !graph &&
              !isStyleSetup(node) &&
              !(themePresentation && readsGeneratedThemeImage(node))
            )
              context.report({ node, messageId: "appearance" });
          },
          Property(node) {
            if (node.parent.type !== AST_NODE_TYPES.ObjectPattern) return;
            const name = ASTUtils.getPropertyName(node, context.sourceCode.getScope(node));
            checkAPI(node, name);
            if (name === "style") context.report({ node, messageId: "appearance" });
          },
          CallExpression(node) {
            if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return;
            const name = ASTUtils.getPropertyName(node.callee, context.sourceCode.getScope(node));
            if (!node.arguments[0] || (name !== "getAttribute" && name !== "toHaveAttribute"))
              return;
            const attribute = ASTUtils.getStaticValue(
              node.arguments[0],
              context.sourceCode.getScope(node),
            )?.value;
            if (typeof attribute === "string" && visualAttributes.test(attribute))
              context.report({ node, messageId: "appearance" });
          },
        };
      },
    }),
  },
};
