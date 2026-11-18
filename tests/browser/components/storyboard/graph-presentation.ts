import type { Locator } from "@playwright/test";

export function renderedOpacity(locator: Locator) {
  return locator.evaluate((element) => Number(getComputedStyle(element).opacity));
}

export function renderedLayer(locator: Locator) {
  return locator.evaluate((element) => Number(getComputedStyle(element).zIndex) || 0);
}

export function renderedNodeFill(locator: Locator) {
  return locator.evaluate((element) => getComputedStyle(element).fill);
}

export function renderedRingStroke(locator: Locator) {
  return locator.evaluate((element) => getComputedStyle(element).stroke);
}
