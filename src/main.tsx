import { initializeAppearance } from "./runtime/theme";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { disableBrowserBehaviors } from "./disable-browser-behaviors";
import { AppErrorBoundary, ErrorOutlet, installGlobalErrorHandlers } from "./errors";
import "./styles.css";

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
