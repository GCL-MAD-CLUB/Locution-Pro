import { AST_NODE_TYPES, ASTUtils, ESLintUtils } from "@typescript-eslint/utils";

const forbidden = new Set(["setTimeout", "setInterval"]);
const nativeModules = new Set(["timers", "node:timers", "timers/promises", "node:timers/promises"]);

/** Check API reads too, so aliases, destructuring and wrappers cannot hide a call. */
export const scheduling = {
  rules: {
    "no-native-timers": ESLintUtils.RuleCreator.withoutDocs({
      meta: {
        type: "problem",
        schema: [],
        messages: {
          forbidden:
            "Native timer APIs are forbidden in production source, including aliases and wrappers. Use owned scheduling resources or platform events.",
        },
      },
      defaultOptions: [],
      create(context) {
        return {
          ImportDeclaration(node) {
            if (nativeModules.has(String(node.source.value)))
              context.report({ node, messageId: "forbidden" });
          },
          ExportAllDeclaration(node) {
            if (nativeModules.has(String(node.source.value)))
              context.report({ node, messageId: "forbidden" });
          },
          ImportExpression(node) {
            const value = ASTUtils.getStaticValue(node.source, context.sourceCode.getScope(node));
            if (nativeModules.has(String(value?.value)))
              context.report({ node, messageId: "forbidden" });
          },
          CallExpression(node) {
            if (
              node.callee.type !== AST_NODE_TYPES.Identifier ||
              node.callee.name !== "require" ||
              !node.arguments[0]
            )
              return;
            const value = ASTUtils.getStaticValue(
              node.arguments[0],
              context.sourceCode.getScope(node),
            );
            if (nativeModules.has(String(value?.value)))
              context.report({ node, messageId: "forbidden" });
          },
          Identifier(node) {
            if (forbidden.has(node.name)) context.report({ node, messageId: "forbidden" });
          },
          MemberExpression(node) {
            if (!node.computed) return;
            const value = ASTUtils.getStaticValue(node.property, context.sourceCode.getScope(node));
            if (forbidden.has(String(value?.value)))
              context.report({ node, messageId: "forbidden" });
          },
          Property(node) {
            if (!node.computed && node.key.type !== AST_NODE_TYPES.Literal) return;
            const value = ASTUtils.getStaticValue(node.key, context.sourceCode.getScope(node));
            if (forbidden.has(String(value?.value)))
              context.report({ node, messageId: "forbidden" });
          },
          ImportSpecifier(node) {
            if (
              node.imported.type === AST_NODE_TYPES.Literal &&
              forbidden.has(String(node.imported.value))
            ) {
              context.report({ node, messageId: "forbidden" });
            }
          },
          ExportSpecifier(node) {
            if (
              node.local.type === AST_NODE_TYPES.Literal &&
              forbidden.has(String(node.local.value))
            ) {
              context.report({ node, messageId: "forbidden" });
            }
          },
        };
      },
    }),
  },
};
