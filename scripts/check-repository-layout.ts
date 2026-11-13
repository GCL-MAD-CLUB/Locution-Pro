import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// The explicit root keeps the layout rules testable against an isolated fixture.
const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
// Inspect authored files, including untracked additions, without walking build outputs.
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter((file) => file && existsSync(resolve(root, file)));
const failures: string[] = [];
const fail = (file: string, message: string) => failures.push(`${file}: ${message}`);
const pack = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const scripts = pack.scripts ?? {};
const entryPoints = new Set<string>();

for (const [name, command] of Object.entries(scripts)) {
  for (const [entry] of command.matchAll(/\b(?:scripts|tests)\/[\w./-]+\.ts\b/gu)) {
    entryPoints.add(entry);
    if (!files.includes(entry)) fail("package.json", `${name} references missing ${entry}`);
  }
}

function typescriptSyntaxErrors(file: string) {
  const result = ts.transpileModule(readFileSync(resolve(root, file), "utf8"), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  return (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
}

function failTypescriptSyntax(file: string, diagnostics: readonly ts.Diagnostic[]) {
  const message = ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  });
  fail(file, message.trim());
}

for (const file of files) {
  const source = () => readFileSync(resolve(root, file), "utf8");
  if (file.endsWith(".rs")) {
    if (
      /(?:^|\/)tests?(?:\/|\.rs$)|(?:^|\/)(?:test[_.-][^/]+|[^/]+[_.-]tests?)\.rs$/u.test(file) ||
      /#!\[cfg\([^\]]*\btest\b[^\]]*\)\]/u.test(source())
    ) {
      fail(file, "Rust tests must be inline #[cfg(test)] modules in their implementation file");
    }
    if (
      /\bmod\s+tests?\s*;/u.test(source()) ||
      /#\[cfg\([^\]]*\btest\b[^\]]*\)\]\s*(?:#\[[^\n]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*;/u.test(
        source(),
      )
    ) {
      fail(file, "external Rust test modules are forbidden; use mod tests { ... }");
    }
  }
  if (file.startsWith("docs/user-guide/public/images/") && file.endsWith(".txt")) {
    fail(file, "publish real documentation assets, not screenshot TODO files");
  }
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)) {
    const discovered =
      /^tests\/unit\/[\w-]+\/[\w-]+\.test\.ts$/u.test(file) ||
      /^tests\/browser\/(?:workflows|components|state)\/(?:[\w-]+\/)*[\w-]+\.test\.ts$/u.test(
        file,
      ) ||
      /^tests\/integration\/(?:[\w-]+\/)*[\w-]+\.test\.ts$/u.test(file);
    if (!discovered)
      fail(
        file,
        "test files must follow the documented layer, domain and runner naming conventions",
      );
    if (
      file.startsWith("tests/browser/") &&
      /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*["']@playwright\/test["']/u.test(source())
    ) {
      fail(file, "browser tests must use the shared support/fixtures diagnostics");
    }
  }
  if (file.startsWith("scripts/")) {
    if (!/^scripts\/(?:check-[\w-]+|build-[\w-]+|prepare-[\w-]+|release)\.ts$/u.test(file)) {
      fail(
        file,
        "scripts/ is reserved for build, asset preparation, release and repository checks",
      );
    }
    if (!entryPoints.has(file))
      fail(file, "maintenance scripts must have a package.json entry point");
    if (
      /\b(?:from\s*|import\s*\(|require\s*\()\s*["'](?:node:)?(?:test|assert)(?:[/'"])/u.test(
        source(),
      )
    ) {
      fail(file, "test code belongs in tests/, not scripts/");
    }
  }
  if (/\.(?:mjs|js)$/u.test(file)) {
    if (
      !file.startsWith("site/") &&
      !file.startsWith("src/") &&
      !/^tests\/browser\/(?:components|state)\/(?:[\w-]+\/)*[\w-]+\.harness\.js$/u.test(file)
    ) {
      fail(file, "JavaScript files must be site assets, source files or browser harnesses");
    }
    try {
      execFileSync(process.execPath, ["--check", resolve(root, file)], {
        encoding: "utf8",
        stdio: "pipe",
        windowsHide: true,
      });
    } catch (error) {
      const failure = error as { stderr?: string; message?: string };
      fail(file, failure.stderr?.trim() || failure.message || String(error));
    }
  }
  if (file.endsWith(".ts") && (file.startsWith("scripts/") || file.startsWith("tests/"))) {
    const diagnostics = typescriptSyntaxErrors(file);
    if (diagnostics.length > 0) failTypescriptSyntax(file, diagnostics);
    const strictTypeScript =
      file.startsWith("scripts/") ||
      file.startsWith("tests/unit/") ||
      file.startsWith("tests/integration/");
    if (
      strictTypeScript &&
      file !== "scripts/check-repository-layout.ts" &&
      (/@ts-(?:ignore|nocheck|expect-error)\b/u.test(source()) ||
        /\bas\s+any\b|:\s*any\b|<any>|\bany\[\]|\[\s*any\s*\]/u.test(source()))
    ) {
      fail(file, "TypeScript must not use any or type-suppression directives");
    }
  }
}

if (failures.length) {
  console.error(
    `Repository layout check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log("Repository layout and syntax checks passed.");
}
