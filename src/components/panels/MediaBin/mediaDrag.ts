interface MediaDragSession {
  itemIds: string[];
  videoId: string | null;
  handled: boolean;
}

let activeSession: MediaDragSession | null = null;

export function beginMediaDrag(itemIds: string[], videoId: string | null) {
  activeSession = {
    itemIds: [...itemIds],
    videoId,
    handled: false,
  };
}

export function activeMediaDragItemIds() {
  return activeSession?.itemIds ?? [];
}

export function activeMediaDragVideoId() {
  return activeSession?.videoId ?? null;
}

export function mediaDragWasHandled() {
  return activeSession?.handled ?? false;
}

export function markMediaDragHandled() {
  if (activeSession) {
    activeSession.handled = true;
  }
}

export function finishMediaDrag() {
  activeSession = null;
}

/** Drag data type carrying the dragged media-bin item ids as JSON. */
export const mediaDragType = "application/x-locution-pro-media";

/** True when a drag carries media-bin items. */
export function isMediaDrag(dataTransfer: DataTransfer) {
  return activeMediaDragItemIds().length > 0 || dataTransfer.types.includes(mediaDragType);
}

/** The media-bin item ids a drop carries. */
export function readMediaDragItemIds(dataTransfer: DataTransfer): string[] {
  const serialized = dataTransfer.getData(mediaDragType);
  if (serialized) {
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (Array.isArray(parsed)) {
        return parsed.filter((itemId): itemId is string => typeof itemId === "string");
      }
    } catch {
      // Fall through to the text/plain representation used by some WebViews.
    }
  }
  const plainText = dataTransfer.getData("text/plain").trim();
  if (!plainText) {
    return activeMediaDragItemIds();
  }
  try {
    const parsed: unknown = JSON.parse(plainText);
    return Array.isArray(parsed)
      ? parsed.filter((itemId): itemId is string => typeof itemId === "string")
      : [];
  } catch {
    return [plainText];
  }
}
