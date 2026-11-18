import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";

const sourceExtension = /\.[cm]?[jt]sx?$/u;
const desktopLayers = [
  "core",
  "runtime",
  "platform",
  "systems",
  "application",
  "components",
  "app",
];
const desktopRoot = new Set(["main.tsx", "types.ts", "vite-env.d.ts", "styles.css"]);
const guideTheme = "docs/user-guide/.vitepress/theme";
const entryPoints = [
  "src/main.tsx",
  "src/types.ts",
  "src/vite-env.d.ts",
  "site/src/main.js",
  "site/_worker.js",
  `${guideTheme}/index.ts`,
];

type DependencyKind = "runtime" | "type" | "asset";

interface Reference {
  specifier: string | undefined;
  kind: DependencyKind;
  line: number;
}

interface Edge extends Reference {
  target: string;
  external: boolean;
}

export interface ArchitectureIssue {
  file: string;
  line: number;
  message: string;
}

function normalized(path: string) {
  return path.replaceAll("\\", "/");
}

function surface(file: string) {
  if (file.startsWith("src/")) return "desktop";
  if (file.startsWith("site/")) return "site";
  if (file.startsWith(`${guideTheme}/`)) return "guide";
}

function layer(file: string) {
  const [, section] = file.split("/");
  if (section === "main.tsx") return "app";
  if (section === "styles.css") return "assets";
  if (section === "types.ts" || section === "vite-env.d.ts") return "core";
  return section;
}

function owner(file: string) {
  const [, section, category, name] = file.split("/");
  if (section === "components" && name) return `src/components/${category}/${name}`;
  if (section === "systems" && category) return `src/systems/${category}`;
}

function dependencyGroup(file: string) {
  const unit = owner(file);
  if (unit) return unit;
  if (surface(file) !== "desktop") {
    if (file === "site/_worker.js") return "site/worker";
    if (file === "site/src/release-contract.js") return "site/release";
    return surface(file) === "site" ? "site/browser" : guideTheme;
  }
  const [, section, category, name] = file.split("/");
  if (section === "core" && category === "editor" && name) return `src/core/editor/${name}`;
  if (section === "application" && category) return `src/application/${category}`;
  return `src/${layer(file)}`;
}

function organizationIssue(file: string, exists: (file: string) => boolean) {
  if (surface(file) !== "desktop") return;
  const [, section, category, name, ...parts] = file.split("/");
  if (desktopRoot.has(section) && !category) return;
  if ((!desktopLayers.includes(section) && section !== "assets") || !category) {
    return "Place source in an owned src layer. The root is reserved for entry points and global contracts.";
  }
  if (
    section === "components" &&
    (!["common", "panels"].includes(category) || !name || !parts.length)
  ) {
    return "Place UI in components/common/<Owner>/ or components/panels/<Owner>/.";
  }
  if (
    (section === "application" && !name) ||
    (section === "core" && category === "editor" && !parts.length)
  ) {
    return "Group feature code in a directory named after its responsibility.";
  }
  const unit = owner(file);
  if (unit && (!/^[A-Z][a-zA-Z0-9]+$/u.test(unit.split("/").at(-1)!) || unit === file)) {
    return "Component and system owners use PascalCase directories.";
  }
  if (unit && !exists(`${unit}/index.ts`)) return `Add a public index.ts for ${unit}.`;
  if (
    file.endsWith(".tsx") &&
    !/^(?:[A-Z]|use[A-Z]|panelDefinitions?\.)/u.test(file.split("/").at(-1)!)
  ) {
    return "Name TSX files after their component, hook, or panel definition.";
  }
}

function dependencyReferences(file: string, source: string): Reference[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const references: Reference[] = [];
  function add(node: ts.Node, argument: ts.Node | undefined, kind: DependencyKind) {
    const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
    references.push({
      line,
      kind,
      specifier: argument && ts.isStringLiteralLike(argument) ? argument.text : undefined,
    });
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typesOnly =
        clause?.isTypeOnly ||
        (!clause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((element) => element.isTypeOnly));
      add(node, node.moduleSpecifier, typesOnly ? "type" : "runtime");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const clause = node.exportClause;
      const typesOnly =
        node.isTypeOnly ||
        (clause &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((element) => element.isTypeOnly));
      add(node, node.moduleSpecifier, typesOnly ? "type" : "runtime");
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, "type");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node, node.moduleReference.expression, node.isTypeOnly ? "type" : "runtime");
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require")
      ) {
        add(node, node.arguments[0], "runtime");
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "glob" &&
        callee.expression.getText(parsed) === "import.meta"
      ) {
        add(node, undefined, "runtime");
      }
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL" &&
      node.arguments?.[1]?.getText(parsed).replace(/\s/gu, "") === "import.meta.url"
    ) {
      add(node, node.arguments[0], "asset");
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return references;
}

function packageName(specifier: string) {
  return specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
}

function packageIssue(file: string, name: string) {
  if (surface(file) === "site")
    return "Site scripts are deployed directly and must use local ES modules.";
  if (surface(file) !== "desktop") return;
  if (
    name.startsWith("@tauri-apps/") &&
    layer(file) !== "platform" &&
    !(name === "@tauri-apps/api" && file === "src/runtime/errors/runtime.ts")
  ) {
    return "Use the Tauri adapters in src/platform/tauri or the application command gateway.";
  }
  if (name === "rxjs" && file !== "src/runtime/scheduling.ts")
    return "Use the owned scheduling API in src/runtime/scheduling.ts.";
  if (name === "@tanstack/react-virtual" && file !== "src/runtime/state/useRowVirtualizer.ts")
    return "Use the row virtualizer in src/runtime/state/useRowVirtualizer.ts.";
  if (name === "d3-force" && !file.startsWith("src/core/editor/storyboardGraph/"))
    return "Keep d3-force inside the storyboard graph engine.";
  if (layer(file) === "core" && /^(?:react(?:-dom)?|zustand|lucide-react)$/u.test(name)) {
    return "Keep UI and state libraries out of core business rules.";
  }
}

function internalIssue(file: string, target: string) {
  if (surface(file) !== surface(target)) {
    if (file === "src/assets/appIcon.ts" && target === "src-tauri/icons/icon.ico") return;
    if (file === "src/assets/applicationVersion.ts" && target === "package.json") return;
    if (
      file === "src/assets/legalNotices.ts" &&
      ["LICENSE", "THIRD_PARTY_NOTICES"].includes(target)
    )
      return;
    return "Production code must stay within its desktop, site, or guide source tree.";
  }
  if (surface(file) === "site") {
    if (target === "site/src/release-contract.js") return;
    if (
      file === "site/_worker.js" ||
      file === "site/src/release-contract.js" ||
      target === "site/_worker.js"
    ) {
      return "The website browser and Worker may share the release contract only.";
    }
  }
  if (surface(file) !== "desktop") return;
  const from = layer(file);
  const to = layer(target);
  if (to !== "assets" && desktopLayers.indexOf(to) > desktopLayers.indexOf(from)) {
    return `Dependency points from ${from} to higher layer ${to}.`;
  }
  const fromOwner = owner(file);
  const toOwner = owner(target);
  if (!toOwner) return;
  if (fromOwner === toOwner) {
    if (target === `${toOwner}/index.ts`)
      return "Within an owner, import the implementation directly.";
    return;
  }
  if (
    fromOwner?.startsWith("src/components/panels/") &&
    toOwner.startsWith("src/components/panels/")
  ) {
    return "Panels are independent. Move shared behavior or UI to a common owner.";
  }
  if (
    fromOwner?.startsWith("src/components/common/") &&
    toOwner.startsWith("src/components/panels/")
  ) {
    return "Common UI cannot depend on a panel.";
  }
  if (target !== `${toOwner}/index.ts`) return `Use the public index.ts of ${toOwner}.`;
}

export function createFrontendArchitecture(root: string) {
  const host = ts.sys;
  const compilerOptions: ts.CompilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    resolveJsonModule: true,
  };
  const cache = ts.createModuleResolutionCache(
    root,
    host.useCaseSensitiveFileNames ? (name) => name : (name) => name.toLowerCase(),
    compilerOptions,
  );
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const runtimePackages = new Set(Object.keys(manifest.dependencies ?? {}));
  const devPackages = new Set(Object.keys(manifest.devDependencies ?? {}));

  function inspect(file: string, source: string) {
    const issues: ArchitectureIssue[] = [];
    const edges: Edge[] = [];
    const report = (line: number, message: string) => issues.push({ file, line, message });
    const layout = organizationIssue(file, (target) => host.fileExists(resolve(root, target)));
    if (layout) report(1, layout);
    for (const reference of dependencyReferences(file, source)) {
      const { line, kind, specifier } = reference;
      if (!specifier) {
        report(line, "Use a literal module path so dependencies can be checked.");
        continue;
      }
      const pathname = specifier.split(/[?#]/u, 1)[0];
      if (isAbsolute(pathname) || pathname.startsWith("/") || pathname.includes("\\")) {
        report(line, `${specifier}: use relative module paths for local source.`);
        continue;
      }
      const local = pathname.startsWith("./") || pathname.startsWith("../");
      const name = packageName(pathname);
      if (!local) {
        const declared =
          runtimePackages.has(name) || (surface(file) === "guide" && devPackages.has(name));
        const issue =
          packageIssue(file, name) ??
          (declared ? undefined : "Declare the package as a direct production dependency.");
        if (issue) report(line, `${specifier}: ${issue}`);
        else edges.push({ ...reference, target: name, external: true });
        continue;
      }
      const absolute = resolve(root, file);
      const candidate = resolve(dirname(absolute), pathname);
      // The website is served as authored. Its native ES modules need explicit filenames.
      const resolved = host.fileExists(candidate)
        ? candidate
        : surface(file) === "site"
          ? undefined
          : ts.resolveModuleName(pathname, absolute, compilerOptions, host, cache).resolvedModule
              ?.resolvedFileName;
      if (!resolved) {
        report(line, `${specifier}: unresolved local dependency.`);
        continue;
      }
      const target = normalized(relative(root, resolved));
      const issue = internalIssue(file, target);
      if (issue) report(line, `${specifier}: ${issue}`);
      edges.push({
        ...reference,
        kind: sourceExtension.test(target) ? kind : "asset",
        target,
        external: false,
      });
    }
    return { issues, edges };
  }

  return { inspect, runtimePackages };
}

function filesUnder(root: string, directory: string): string[] {
  if (!existsSync(resolve(root, directory))) return [];
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(root, file);
    return sourceExtension.test(file) ? [file] : [];
  });
}

// Report a concrete closed path for each DFS back edge, including type-only imports.
function cycles(graph: Map<string, Set<string>>) {
  const visited = new Set<string>();
  const active = new Map<string, number>();
  const path: string[] = [];
  const found: string[][] = [];
  function visit(file: string) {
    visited.add(file);
    active.set(file, path.length);
    path.push(file);
    for (const target of graph.get(file) ?? []) {
      const start = active.get(target);
      if (start !== undefined) found.push([...path.slice(start), target]);
      else if (!visited.has(target)) visit(target);
    }
    path.pop();
    active.delete(file);
  }
  for (const file of graph.keys()) if (!visited.has(file)) visit(file);
  return found;
}

export function analyzeFrontend(root: string) {
  const architecture = createFrontendArchitecture(root);
  const files = [
    ...filesUnder(root, "src"),
    ...filesUnder(root, "site/src"),
    ...filesUnder(root, guideTheme),
    "site/_worker.js",
  ]
    .filter((file) => existsSync(resolve(root, file)))
    .sort();
  const modules = files.map((file) => ({
    file,
    ...architecture.inspect(file, readFileSync(resolve(root, file), "utf8")),
  }));
  const issues = modules.flatMap((module) => module.issues);
  const localGraph = new Map<string, Set<string>>();
  const ownerGraph = new Map<string, Set<string>>();
  const external = new Map<string, Set<string>>();
  const groupEdges = new Map<
    string,
    { from: string; to: string; kind: DependencyKind; count: number }
  >();
  for (const { file, edges } of modules) {
    const targets = new Set<string>();
    localGraph.set(file, targets);
    for (const edge of edges) {
      if (edge.external || sourceExtension.test(edge.target)) {
        const from = dependencyGroup(file);
        const to = edge.external ? edge.target : dependencyGroup(edge.target);
        if (from !== to) {
          const key = JSON.stringify([from, to, edge.kind]);
          const group = groupEdges.get(key) ?? { from, to, kind: edge.kind, count: 0 };
          group.count++;
          groupEdges.set(key, group);
        }
      }
      if (edge.external) {
        const importers = external.get(edge.target) ?? new Set();
        importers.add(file);
        external.set(edge.target, importers);
        continue;
      }
      if (!sourceExtension.test(edge.target)) continue;
      targets.add(edge.target);
      const from = owner(file);
      const to = owner(edge.target);
      if (from && to && from !== to) {
        const owners = ownerGraph.get(from) ?? new Set();
        owners.add(to);
        ownerGraph.set(from, owners);
      }
    }
  }
  const moduleCycles = cycles(localGraph);
  const ownerCycles = cycles(ownerGraph);
  for (const [kind, groups] of [
    ["Module", moduleCycles],
    ["Owner", ownerCycles],
  ] as const) {
    for (const cycle of groups)
      issues.push({ file: cycle[0], line: 1, message: `${kind} cycle: ${cycle.join(" -> ")}` });
  }
  const reachable = new Set<string>();
  function visit(file: string) {
    if (reachable.has(file)) return;
    reachable.add(file);
    for (const target of localGraph.get(file) ?? []) visit(target);
  }
  for (const entry of entryPoints) visit(entry);
  const unreachable = files.filter((file) => !reachable.has(file));
  const unusedPackages = [...architecture.runtimePackages]
    .filter((name) => !external.has(name))
    .sort();
  return {
    issues,
    modules: modules.map(({ file, edges }) => ({
      file,
      owner: dependencyGroup(file),
      dependencies: edges,
    })),
    groups: [...groupEdges.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, edge]) => edge),
    packages: Object.fromEntries(
      [...external.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, importers]) => [name, [...importers].sort()]),
    ),
    unreachable,
    unusedPackages,
  };
}
