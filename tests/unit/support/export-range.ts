import * as timeline from "../../../src/core/editor/playback/timeline.ts";
import { createModuleLoader } from "./module-loader.ts";

export const exportRange = createModuleLoader(import.meta.url)<
  typeof import("../../../src/core/editor/export/exportRange.ts")
>("../../../src/core/editor/export/exportRange.ts", { "../playback/timeline": timeline });
