import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import ts from "typescript";
import { analyzeFrontend } from "../tooling/frontend/architecture.ts";

const root = process.cwd();
const sourceRoot = join(root, "src");

const failures: string[] = [];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
  });
}

function fail(path: string, message: string): void {
  failures.push(`${relative(root, path)}: ${message}`);
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

for (const path of sourceFiles(sourceRoot)) {
  const source = readFileSync(path, "utf8");
  const parsed = sourceFile(path);
  const isComponent = path.startsWith(join(sourceRoot, "components"));

  if (/\b(?:emitAppEvent|useAppEvent|useAppStore|appStore)\b/u.test(source)) {
    fail(path, "legacy event/store API is forbidden");
  }
  if (/\buse[A-Za-z0-9]*System\b/u.test(source)) {
    fail(path, "component system-composition hooks are forbidden; use lower-level APIs directly");
  }
  if (isComponent && /System\.(?:ts|tsx)$/u.test(basename(path))) {
    fail(
      path,
      "component system-composition modules are forbidden; compose lower-level APIs directly",
    );
  }
  if (/\bnew\s+CustomEvent\s*</u.test(source) || /\bdispatchEvent\s*\(/u.test(source)) {
    fail(path, "application communication must use EventHub, not DOM events");
  }

  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (/(?:^|\/)(?:store|appEvents|projectHistory)$/u.test(specifier)) {
      fail(path, `legacy module import is forbidden: ${specifier}`);
    }
  }
}

const forbiddenRoutingFields =
  /^(?:target|targetId|targetSystem|targetInstanceId|receiver|receiverId|recipient|destination|consume|consumed)$/u;
const eventContractPath = join(sourceRoot, "runtime", "events", "contracts.ts");
for (const path of [eventContractPath, join(sourceRoot, "runtime", "events", "EventHub.ts")]) {
  const parsed = sourceFile(path);
  function visit(node: ts.Node): void {
    if (
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
      node.name &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      (forbiddenRoutingFields.test(node.name.text) ||
        (path === eventContractPath && node.name.text === "instanceId"))
    ) {
      fail(path, `event routing field "${node.name.text}" violates broadcast semantics`);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}

const projectStatePath = join(sourceRoot, "systems", "ProjectSystem", "ProjectState.ts");
const projectStateSource = readFileSync(projectStatePath, "utf8");
if (/\bpreferencesLoaded\b|^\s*preferences\s*:/mu.test(projectStateSource)) {
  fail(projectStatePath, "preferences belong to PreferencesSystem, not ProjectSystem");
}

const frontend = analyzeFrontend(root);
for (const { file, line, message } of frontend.issues)
  failures.push(file + ":" + line + ": " + message);
for (const file of frontend.unreachable)
  failures.push(file + ": unreachable from a frontend entry point");
for (const name of frontend.unusedPackages)
  failures.push("package.json: unused production dependency " + name);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...frontend, failures }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} else if (failures.length > 0) {
  console.error("System architecture check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    "System architecture check passed (" + frontend.modules.length + " frontend modules).",
  );
}
