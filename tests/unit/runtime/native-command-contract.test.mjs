import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../../", import.meta.url);
function files(directory, extension) {
  return readdirSync(new URL(directory, root), { recursive: true })
    .filter((name) => extension.test(name))
    .map((name) => new URL(`${directory}/${name.replaceAll("\\", "/")}`, root));
}
const camelCase = (name) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

test("literal native command calls use the backend's top-level argument names", () => {
  const commands = new Map();
  for (const file of files("src-tauri/src", /\.rs$/)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /#\[tauri::command\]\s+pub\(crate\) (?:async )?fn (\w+)\(([^)]*)\)/g,
    )) {
      commands.set(
        match[1],
        [...match[2].matchAll(/(?:^|,)\s*(\w+)\s*:/g)].map((parameter) => camelCase(parameter[1])),
      );
    }
  }
  let calls = 0;
  for (const file of files("src", /\.tsx?$/)) {
    const source = ts.createSourceFile(
      file.pathname,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "invokeCommand" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        calls++;
        const command = node.arguments[0].text;
        const parameters = commands.get(command);
        assert.ok(parameters, `Unknown native command ${command} in ${file.pathname}`);
        const args = node.arguments[1];
        if (args && ts.isObjectLiteralExpression(args)) {
          for (const property of args.properties) {
            if (!property.name) continue;
            const name = ts.isStringLiteral(property.name)
              ? property.name.text
              : property.name.getText(source);
            assert.ok(
              parameters.includes(name),
              `${command}: unexpected argument ${name} in ${file.pathname}`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(commands.size >= 75, "Backend command scan must cover the application");
  assert.ok(calls >= 88, "Frontend command scan must cover the application");
});
