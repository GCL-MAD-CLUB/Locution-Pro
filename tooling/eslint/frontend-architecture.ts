import { relative } from "node:path";
import type { TSESLint } from "@typescript-eslint/utils";
import { createFrontendArchitecture } from "../frontend/architecture.ts";

const rule: TSESLint.RuleModule<"architecture", []> = {
  defaultOptions: [],
  meta: {
    type: "problem",
    schema: [],
    messages: { architecture: "{{message}}" },
  },
  create(context) {
    return {
      Program() {
        const file = relative(context.cwd, context.filename).replaceAll("\\", "/");
        const { issues } = createFrontendArchitecture(context.cwd).inspect(
          file,
          context.sourceCode.text,
        );
        for (const { line, message } of issues) {
          context.report({
            loc: { line, column: 0 },
            messageId: "architecture",
            data: { message },
          });
        }
      },
    };
  },
};

export const frontendArchitecture = { rules: { boundaries: rule } };
