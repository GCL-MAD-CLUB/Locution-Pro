export function playbackRowCenterOffset(list: HTMLElement, currentRow: Element) {
  const row = currentRow.getBoundingClientRect();
  const viewport = list.getBoundingClientRect();
  const distance = row.top + row.height / 2 - viewport.top - list.clientHeight / 2;
  return distance / list.clientHeight;
}

export async function countPlaybackRowMeasurements(run: () => Promise<void>) {
  let count = 0;
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this.matches(".shot-row, .cue-row")) count += 1;
    return original.call(this);
  };
  try {
    await run();
    return count;
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
}
