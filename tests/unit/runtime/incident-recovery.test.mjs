import { createModuleLoader, deferred, flush } from "../support/module-loader.ts";
import assert from "node:assert/strict";
import test from "node:test";

const loadModule = createModuleLoader(import.meta.url);

function loadRecovery() {
  return loadModule("../../../src/errors/recovery.ts");
}

function loadRuntime() {
  const model = loadModule(
    "../../../src/errors/model.ts",
    {},
    { crypto: { randomUUID: () => "frontend-error-id" } },
  );
  return loadModule(
    "../../../src/errors/runtime.ts",
    {
      "@tauri-apps/api/core": { invoke: async () => undefined },
      "../runtime/mediaSources": loadModule("../../../src/runtime/mediaSources.ts"),
      "./model": model,
      "./recovery": loadRecovery(),
    },
    {
      window: { location: { pathname: "/" } },
      navigator: { userAgent: "test", onLine: true },
      document: { visibilityState: "visible" },
      setTimeout: () => 0,
    },
  );
}

test("VC runtime recovery is shared by features and includes installation steps", () => {
  const { incidentRecovery } = loadRecovery();
  const recovery = incidentRecovery("VC_RUNTIME_MISSING");

  assert.ok(recovery);
  assert.equal(recovery.action.url, "https://aka.ms/vs/17/release/vc_redist.x64.exe");
  assert.match(recovery.component, /Visual C\+\+/u);
  assert.equal(recovery.steps.length, 3);
  assert.doesNotMatch(recovery.message, /分镜/u);
});

test("incident recovery only applies to codes with a direct remedy", () => {
  const { incidentRecovery } = loadRecovery();

  assert.equal(incidentRecovery("toString"), null);
  assert.equal(incidentRecovery("UNEXPECTED_ERROR"), null);
  assert.equal(incidentRecovery("NATIVE_RUNTIME_MISSING").action, undefined);
  assert.equal(incidentRecovery("NATIVE_RUNTIME_LOAD_FAILED").action, undefined);
});

test("packaged dependency failures offer VC++ updates and retain application repair guidance", () => {
  const { incidentRecovery } = loadRecovery();
  const recovery = incidentRecovery("NATIVE_RUNTIME_DEPENDENCY_UNAVAILABLE");
  assert.equal(recovery.action.url, incidentRecovery("VC_RUNTIME_MISSING").action.url);
  assert.match(recovery.steps[0], /VC\+\+/u);
  assert.ok(recovery.steps.some((step) => step.includes("应用安装程序")));
  const runtime = loadRuntime();
  runtime.captureIncident(
    "subtitle.semanticSearch",
    runtimeError("old-vc", "NATIVE_RUNTIME_DEPENDENCY_UNAVAILABLE"),
  );
  assert.equal(runtime.getIncidentSnapshot().incidents[0].message, recovery.message);
});

test("the incident message uses the recovery guidance when available", () => {
  const runtime = loadRuntime();
  runtime.captureIncident("storyboard.detect", {
    errorId: "ERR-test",
    code: "VC_RUNTIME_MISSING",
    category: "resource",
    retryable: true,
    detail: "MSVCP140.dll is missing",
  });

  const [incident] = runtime.getIncidentSnapshot().incidents;
  const { incidentRecovery } = loadRecovery();
  assert.equal(incident.message, incidentRecovery("VC_RUNTIME_MISSING").message);
  assert.equal(incident.title, incidentRecovery("VC_RUNTIME_MISSING").title);
  assert.equal(incident.contextTitle, "分镜切分失败");
});

function runtimeError(errorId, code = "VC_RUNTIME_MISSING") {
  return {
    errorId,
    code,
    category: "resource",
    retryable: true,
    detail: "native loader diagnostic",
  };
}

test("simultaneous features share a recovery dialog and can report again after dismissal", () => {
  const runtime = loadRuntime();
  runtime.captureIncident("storyboard.detect", runtimeError("first"));
  runtime.captureIncident("subtitle.semanticSearch", runtimeError("second"));
  runtime.captureIncident("storyboard.semanticIndex", runtimeError("third"));
  assert.equal(runtime.getIncidentSnapshot().incidents.length, 1);
  runtime.dismissIncident(runtime.getIncidentSnapshot().incidents[0].id);
  runtime.captureIncident("subtitle.semanticSearch", runtimeError("retry"));
  assert.equal(runtime.getIncidentSnapshot().incidents.length, 1);
  assert.equal(runtime.getIncidentSnapshot().incidents[0].errorId, "retry");
});

test("unrelated failures remain separate and background checks remain silent", () => {
  const runtime = loadRuntime();
  runtime.captureIncident("subtitle.semanticAvailability", runtimeError("background"));
  assert.equal(runtime.getIncidentSnapshot().incidents.length, 0);
  runtime.captureIncident("storyboard.detect", runtimeError("first", "UNEXPECTED_ERROR"));
  runtime.captureIncident("subtitle.semanticSearch", runtimeError("second", "UNEXPECTED_ERROR"));
  assert.equal(runtime.getIncidentSnapshot().incidents.length, 2);
  assert.equal(runtime.getIncidentSnapshot().incidents[0].contextTitle, undefined);
});

function dialogHarness(openExternalUrl, overrides = {}) {
  const incident = {
    ...runtimeError("ERR-test"),
    id: "incident",
    presentation: "modal",
    title: "运行环境",
    message: "需要修复",
    ...overrides,
  };
  const states = [];
  const reported = [];
  const dismissed = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  function ModalDialog() {}
  const { ErrorOutlet } = loadModule("../../../src/errors/ErrorUI.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      Component: class {},
      useRef: (initial) => ({ current: initial }),
      useSyncExternalStore: () => ({ incidents: [incident] }),
      useState: (initial) => {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [
          states[index],
          (value) => {
            states[index] = value;
          },
        ];
      },
    },
    "lucide-react": {},
    "../components/common/ModalDialog": { ModalDialog },
    "../platform/tauri/externalUrl": { openExternalUrl },
    "./recovery": loadRecovery(),
    "./runtime": {
      captureOperationError: (...args) => reported.push(args),
      dismissIncident: (id) => dismissed.push(id),
    },
  });
  return {
    reported,
    dismissed,
    render() {
      cursor = 0;
      let dialog = ErrorOutlet();
      while (dialog.type !== ModalDialog) dialog = dialog.type(dialog.props);
      assert.equal(dialog.type, ModalDialog);
      return dialog;
    },
  };
}

function descendants(element) {
  if (!element || typeof element !== "object") return [];
  return [
    element,
    ...[element.props?.actions, ...[element.props?.children].flat()].flatMap(descendants),
  ];
}

test("ordinary errors retain their compact dialog, category line and single confirm action", () => {
  const title = "导入媒体失败：sample.mkv";
  const message = "媒体处理组件未能完成操作，请稍后重试。";
  const harness = dialogHarness(() => assert.fail("No download for ordinary errors"), {
    code: "FFMPEG_FAILED",
    category: "externalTool",
    title,
    message,
  });
  const dialog = harness.render();
  assert.equal(dialog.props.title, title);
  assert.equal(dialog.props.className, "error-dialog");
  assert.equal(dialog.props.focusTrap, undefined);
  const nodes = descendants(dialog);
  const paragraphs = nodes.filter((node) => node.type === "p").map((node) => node.props.children);
  assert.deepEqual(paragraphs, [message, "ERROR: ExternalToolError"]);
  assert.equal(
    nodes.some((node) => node.type === "small" || node.type === "ol"),
    false,
  );
  const buttons = nodes.filter((node) => node.type === "button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.children, "确定");
  buttons[0].props.onClick();
  assert.deepEqual(harness.dismissed, ["incident"]);
});

test("recovery download stays open, disables while pending, and handles opener failure inline", async () => {
  const download = deferred();
  const urls = [];
  const harness = dialogHarness((url) => {
    urls.push(url);
    return download.promise;
  });
  const primary = (dialog) =>
    descendants(dialog).find((node) => node.props?.className?.includes("error-dialog-download"));
  primary(harness.render()).props.onClick();
  assert.equal(primary(harness.render()).props.disabled, true);
  assert.equal(urls[0], "https://aka.ms/vs/17/release/vc_redist.x64.exe");
  download.reject(new Error("browser unavailable"));
  await flush();
  const dialog = harness.render();
  assert.equal(primary(dialog).props.disabled, false);
  const alert = descendants(dialog).find((node) => node.props?.role === "alert");
  assert.ok(alert);
  assert.ok(descendants(alert).some((node) => node.props?.children === urls[0]));
  assert.equal(harness.reported[0][0], "runtime.recovery");
  assert.equal(harness.dismissed.length, 0);
  dialog.props.onCancel();
  assert.deepEqual(harness.dismissed, ["incident"]);
});

test("successful download leaves installation instructions available", async () => {
  const harness = dialogHarness(async () => {});
  const button = descendants(harness.render()).find((node) =>
    node.props?.className?.includes("error-dialog-download"),
  );
  button.props.onClick();
  await flush();
  assert.equal(harness.reported.length, 0);
  assert.equal(harness.dismissed.length, 0);
  assert.equal(
    descendants(harness.render()).some((node) => node.props?.role === "alert"),
    false,
  );
});

test("packaged dependency failures render the VC++ download action", async () => {
  const urls = [];
  const harness = dialogHarness(
    async (url) => {
      urls.push(url);
    },
    {
      code: "NATIVE_RUNTIME_DEPENDENCY_UNAVAILABLE",
    },
  );
  const button = descendants(harness.render()).find((node) =>
    node.props?.className?.includes("error-dialog-download"),
  );
  assert.ok(button);
  button.props.onClick();
  await flush();
  assert.deepEqual(urls, ["https://aka.ms/vs/17/release/vc_redist.x64.exe"]);
  assert.equal(harness.reported.length, 0);
});
