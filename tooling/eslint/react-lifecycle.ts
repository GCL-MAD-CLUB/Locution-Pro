import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator.withoutDocs;
type Node = TSESTree.Node;

function enclosingFunction(node: Node): Node | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      parent.type === AST_NODE_TYPES.FunctionDeclaration ||
      parent.type === AST_NODE_TYPES.FunctionExpression ||
      parent.type === AST_NODE_TYPES.ArrowFunctionExpression
    )
      return parent;
  }
}

function hookName(node: Node): string | undefined {
  if (node.type === AST_NODE_TYPES.Identifier) return node.name;
  if (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
  )
    return node.property.name;
}

function runsDuringRender(node: Node, owner: Node): boolean {
  let current = node;
  while (current !== owner) {
    const boundary = enclosingFunction(current);
    if (!boundary) return false;
    if (boundary === owner) return true;
    const call = boundary.parent;
    if (
      call?.type !== AST_NODE_TYPES.CallExpression ||
      (call.callee !== boundary && !["useMemo", "useState"].includes(hookName(call.callee) ?? ""))
    ) {
      return false;
    }
    current = call;
  }
  return true;
}

export const reactLifecycle = {
  rules: {
    "no-render-state-update": createRule({
      meta: {
        type: "problem",
        schema: [],
        messages: {
          update:
            "State updates during render are forbidden, including conditional updates. Move the update to an event handler.",
        },
      },
      defaultOptions: [],
      create(context) {
        return {
          VariableDeclarator(node) {
            if (
              node.id.type !== AST_NODE_TYPES.ArrayPattern ||
              node.init?.type !== AST_NODE_TYPES.CallExpression ||
              !["useState", "useReducer"].includes(hookName(node.init.callee) ?? "")
            )
              return;
            const setter = node.id.elements[1];
            const owner = enclosingFunction(node);
            if (setter?.type !== AST_NODE_TYPES.Identifier || !owner) return;
            const variable = context.sourceCode
              .getDeclaredVariables(node)
              .find((entry) => entry.name === setter.name);
            const visited = new Set<unknown>();
            function check(binding: typeof variable): void {
              if (!binding || visited.has(binding)) return;
              visited.add(binding);
              for (const reference of binding.references) {
                const identifier = reference.identifier;
                const parent = identifier.parent;
                if (
                  parent?.type === AST_NODE_TYPES.CallExpression &&
                  parent.callee === identifier &&
                  runsDuringRender(parent, owner!)
                )
                  context.report({ node: parent, messageId: "update" });
                if (
                  parent?.type === AST_NODE_TYPES.VariableDeclarator &&
                  parent.init === identifier
                ) {
                  for (const alias of context.sourceCode.getDeclaredVariables(parent)) check(alias);
                }
              }
            }
            check(variable);
          },
          "CallExpression[callee.type='MemberExpression'][callee.object.type='ThisExpression'][callee.property.name='setState']"(
            node: TSESTree.CallExpression,
          ) {
            const owner = enclosingFunction(node);
            if (
              owner?.parent?.type === AST_NODE_TYPES.MethodDefinition &&
              owner.parent.key.type === AST_NODE_TYPES.Identifier &&
              owner.parent.key.name === "render"
            ) {
              context.report({ node, messageId: "update" });
            }
          },
        };
      },
    }),
    "no-derived-state": createRule({
      meta: {
        type: "problem",
        schema: [],
        messages: {
          derived:
            "Do not mirror props or state in useState. Derive this value during render; keep user edits in event-owned state.",
        },
      },
      defaultOptions: [],
      create(context) {
        return {
          "Program:exit"() {
            for (const scope of context.sourceCode.scopeManager?.scopes ?? []) {
              for (const reference of scope.references) {
                const variable = reference.resolved;
                if (!variable) continue;
                let current: Node = reference.identifier;
                while (current.parent) {
                  const parent: Node = current.parent;
                  if (
                    parent.type === AST_NODE_TYPES.CallExpression &&
                    hookName(parent.callee) === "useState" &&
                    parent.arguments[0] === current
                  ) {
                    const owner = enclosingFunction(parent);
                    const derived = variable.defs.some(
                      (def) =>
                        (def.type === "Parameter" && def.node === owner) ||
                        (def.type === "Variable" &&
                          def.node.init?.type === AST_NODE_TYPES.CallExpression &&
                          ["useState", "useReducer"].includes(
                            hookName(def.node.init.callee) ?? "",
                          )),
                    );
                    if (derived) context.report({ node: parent, messageId: "derived" });
                    break;
                  }
                  current = parent;
                }
              }
            }
          },
        };
      },
    }),
  },
};
