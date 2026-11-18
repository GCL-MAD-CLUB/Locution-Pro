import { initAutomaticDemo } from "./demo.ts";
import { initPlatformPicker, initReleaseDownload } from "./download.ts";
import { initScrollMotion } from "./scroll-motion.ts";

initAutomaticDemo();
initScrollMotion();
initPlatformPicker(document);
void initReleaseDownload(document);
