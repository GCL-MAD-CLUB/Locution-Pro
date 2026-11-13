import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Commands that read media without a `MediaSources` snapshot.
 * `export_clips` receives filesystem paths on each `ExportClip`.
 */
const mediaSourceExceptions: Record<string, string> = {
  export_clips: "receives filesystem paths on each ExportClip",
};

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function filesUnder(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path, extension);
    return entry.name.endsWith(extension) ? [path] : [];
  });
}

function balanced(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): string | undefined {
  if (source[openIndex] !== open) return undefined;
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return undefined;
}

interface TauriCommand {
  name: string;
  parameters: string;
  path: string;
}

function tauriCommands(path: string, source: string): TauriCommand[] {
  const commands: TauriCommand[] = [];
  for (const attribute of source.matchAll(/#\[tauri::command(?:\([^)]*\))?\]/gu)) {
    if (attribute.index === undefined) continue;
    const remaining = source.slice(attribute.index + attribute[0].length);
    const functionMatch = remaining.match(
      /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)(?:\s*<[^;{]*?>)?\s*\(/u,
    );
    if (!functionMatch || functionMatch.index === undefined) continue;
    const openIndex =
      attribute.index + attribute[0].length + functionMatch.index + functionMatch[0].length - 1;
    const parameters = balanced(source, openIndex, "(", ")");
    if (parameters === undefined) {
      fail(`${relative(root, path)}: could not read the parameter list of ${functionMatch[1]}`);
      continue;
    }
    commands.push({ name: functionMatch[1], parameters, path });
  }
  return commands;
}

function takesMediaSources(parameters: string): boolean {
  return /(?:^|[^A-Za-z0-9_])MediaSources(?:[^A-Za-z0-9_]|$)/u.test(parameters);
}

function frontendMediaCommands(path: string): string[] | undefined {
  const source = readFileSync(path, "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let values: string[] | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "mediaCommands" &&
      node.initializer
    ) {
      values = stringSet(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return values;
}

function stringSet(node: ts.Expression): string[] | undefined {
  if (
    !ts.isNewExpression(node) ||
    !node.expression ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== "Set" ||
    node.arguments?.length !== 1
  ) {
    return undefined;
  }
  const entries = node.arguments[0];
  if (!ts.isArrayLiteralExpression(entries)) return undefined;
  const values: string[] = [];
  for (const element of entries.elements) {
    if (!ts.isStringLiteral(element)) return undefined;
    values.push(element.text);
  }
  return values;
}

const frontendPath = join(root, "src", "runtime", "mediaSources.ts");
const rustRoot = join(root, "src-tauri", "src");
if (!existsSync(frontendPath)) fail("src/runtime/mediaSources.ts is missing");
if (!existsSync(rustRoot)) fail("src-tauri/src is missing");

const frontendList = existsSync(frontendPath) ? frontendMediaCommands(frontendPath) : undefined;
if (existsSync(frontendPath) && !frontendList) {
  fail("src/runtime/mediaSources.ts must declare mediaCommands as new Set([string literals])");
}
if (frontendList && frontendList.length !== new Set(frontendList).size) {
  fail("src/runtime/mediaSources.ts lists a command more than once");
}
const frontend = new Set(frontendList ?? []);

const commands = existsSync(rustRoot)
  ? filesUnder(rustRoot, ".rs").flatMap((path) => tauriCommands(path, readFileSync(path, "utf8")))
  : [];
const seen = new Set<string>();
for (const command of commands) {
  if (seen.has(command.name)) {
    fail(`${relative(root, command.path)}: duplicate Tauri command ${command.name}`);
  }
  seen.add(command.name);
}
const mediaSourceCommands = new Set(
  commands
    .filter((command) => takesMediaSources(command.parameters))
    .map((command) => command.name),
);

for (const [name, reason] of Object.entries(mediaSourceExceptions)) {
  const command = commands.find((candidate) => candidate.name === name);
  if (!command) {
    fail(`exception ${name} (${reason}) is not a Tauri command`);
    continue;
  }
  if (takesMediaSources(command.parameters)) {
    fail(
      `exception ${name} (${reason}) now takes MediaSources; remove the exception and inject the snapshot`,
    );
  }
  if (frontend.has(name)) {
    fail(`exception ${name} (${reason}) must not be in the frontend injection set`);
  }
}

for (const name of [...mediaSourceCommands].sort()) {
  if (!frontend.has(name)) {
    fail(`${name} takes MediaSources but is missing from the frontend injection set`);
  }
}
for (const name of [...frontend].sort()) {
  if (!mediaSourceCommands.has(name)) {
    fail(`${name} is injected on the frontend but no Tauri command takes MediaSources`);
  }
}

if (failures.length > 0) {
  console.error("Media source injection check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Media source injection check passed.");
}
