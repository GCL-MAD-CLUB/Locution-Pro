import type { Locator } from "@playwright/test";

export async function pointerAt(locator: Locator, horizontal = 0.5, vertical = 0.5) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error(`Cannot target an element without a box: ${locator}`);
  return { x: bounds.x + bounds.width * horizontal, y: bounds.y + bounds.height * vertical };
}
