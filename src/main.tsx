import { initializeAppearance } from "./runtime/theme";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { disableBrowserBehaviors } from "./app/disable-browser-behaviors";
import { AppErrorBoundary, ErrorOutlet } from "./app/ErrorUI";
import { installGlobalErrorHandlers } from "./runtime/errors";
import { isMacOSRuntime } from "./platform/tauri/runtime";
import "./styles.css";

if (isMacOSRuntime()) document.documentElement.dataset.platform = "macos";
initializeAppearance();
disableBrowserBehaviors();
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <ErrorOutlet />
  </React.StrictMode>,
);
