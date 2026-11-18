import { asyncScheduler } from "rxjs";
import { clientError } from "../../../src/errors/model.ts";
import { createModuleLoader } from "./module-loader.ts";

// Exercise real scheduling in isolated modules without relying on bundler-only import resolution.
const scheduling = createModuleLoader(import.meta.url)<
  typeof import("../../../src/runtime/scheduling.ts")
>("../../../src/runtime/scheduling.ts", {
  rxjs: { asyncScheduler },
  "../errors/model": { clientError },
});

export const { scheduleAfter, repeatEvery, cancelTask, waitForDelay } = scheduling;
