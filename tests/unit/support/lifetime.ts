import * as React from "react";
import { createModuleLoader } from "./module-loader.ts";

// Keep the real lifecycle implementation and React boundary; replace only the
// application's error reporter, which pulls in the native command bridge.
const lifetime = createModuleLoader(import.meta.url)<
  typeof import("../../../src/runtime/lifetime/RenderLifetime.ts")
>(
  "../../../src/runtime/lifetime/RenderLifetime.ts",
  {
    react: React,
    "../errors/runtime": { normalizeError: (error: unknown) => error },
  },
  { queueMicrotask, AggregateError },
);

export const RenderLifetime = lifetime.RenderLifetime;
export type RenderLifetime =
  import("../../../src/runtime/lifetime/RenderLifetime.ts").RenderLifetime;
export const CommittedLifetime = lifetime.CommittedLifetime;
export type CommittedLifetime =
  import("../../../src/runtime/lifetime/RenderLifetime.ts").CommittedLifetime;
