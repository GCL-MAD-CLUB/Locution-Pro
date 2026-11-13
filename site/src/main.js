import { initAutomaticDemo } from "./demo.js";
import { initPlatformPicker, initReleaseDownload } from "./download.js";
import { initScrollMotion } from "./scroll-motion.js";

initAutomaticDemo();
initScrollMotion();
initPlatformPicker(document);
void initReleaseDownload(document);
