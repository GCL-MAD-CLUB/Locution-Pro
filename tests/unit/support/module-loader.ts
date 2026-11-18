import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/** Isolate module state; every dependency substitution must be explicit. */
export function createModuleLoader(base: string) {
  return function loadModule<T>(
    path: string,
    imports: Record<string, unknown> | ((name: string) => unknown) = {},
    globals: Record<string, unknown> = {},
  ): T {
    const filename = new URL(path, base);
    const sourcePath = fileURLToPath(filename);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: sourcePath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        inlineSourceMap: true,
        inlineSources: true,
      },
      reportDiagnostics: true,
    });
    const errors = (compiled.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (errors.length)
      throw new Error(
        ts.formatDiagnostics(errors, {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: () => "",
          getNewLine: () => "\n",
        }),
      );
    const exports: Record<string, unknown> = {};
    runInNewContext(
      compiled.outputText,
      {
        ...globals,
        exports,
        require: (name: string) => {
          if (typeof imports === "function") return imports(name);
          if (!Object.hasOwn(imports, name))
            throw new Error(`Unexpected import in ${path}: ${name}`);
          return imports[name];
        },
      },
      { filename: sourcePath },
    );
    return exports as unknown as T;
  };
}

export function deferred<T = unknown>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
