import { useMemo, useSyncExternalStore } from "react";
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type VirtualizerOptions,
  type VirtualItem,
} from "@tanstack/react-virtual";
import type { RenderLifetime } from "../lifetime/RenderLifetime";

type Options = Partial<VirtualizerOptions<HTMLDivElement, Element>> &
  Pick<VirtualizerOptions<HTMLDivElement, Element>, "count" | "getScrollElement" | "estimateSize">;
type Controls = Pick<
  Virtualizer<HTMLDivElement, Element>,
  "measure" | "measureElement" | "scrollToOffset" | "scrollToIndex" | "getOffsetForIndex"
>;
interface RowSnapshot {
  readonly items: VirtualItem[];
  readonly totalSize: number;
  readonly scrollOffset: number | null;
  readonly scrollRect: Readonly<{ width: number; height: number }> | null;
}
export type { VirtualItem };

export interface RowVirtualizer extends RowSnapshot, Controls {}

/** Own the mutable virtualizer outside render. Consumers observe immutable snapshots. */
export class RowVirtualizerStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: RowSnapshot = { items: [], totalSize: 0, scrollOffset: null, scrollRect: null };
  private readonly instance = new Virtualizer<HTMLDivElement, Element>({
    count: 0,
    getScrollElement: () => null,
    estimateSize: () => 0,
    scrollToFn: elementScroll,
    observeElementOffset,
    observeElementRect,
    onChange: () => this.publish(),
  });
  readonly controls: Controls = {
    measure: () => this.instance.measure(),
    measureElement: (element) => this.instance.measureElement(element),
    scrollToOffset: (...args) => this.instance.scrollToOffset(...args),
    scrollToIndex: (...args) => this.instance.scrollToIndex(...args),
    getOffsetForIndex: (...args) => this.instance.getOffsetForIndex(...args),
  };
  readonly read = () => this.snapshot;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  mount() {
    return this.instance._didMount();
  }
  configure(options: Options) {
    this.instance.setOptions({
      scrollToFn: elementScroll,
      observeElementOffset,
      observeElementRect,
      ...options,
      onChange: (instance, sync) => {
        options.onChange?.(instance, sync);
        this.publish();
      },
    });
    this.instance._willUpdate();
    this.publish();
  }
  private publish() {
    const items = this.instance.getVirtualItems();
    const totalSize = this.instance.getTotalSize();
    const scrollOffset = this.instance.scrollOffset;
    const scrollRect = this.instance.scrollRect;
    const previous = this.snapshot;
    if (
      totalSize === previous.totalSize &&
      scrollOffset === previous.scrollOffset &&
      scrollRect?.height === previous.scrollRect?.height &&
      scrollRect?.width === previous.scrollRect?.width &&
      items.length === previous.items.length &&
      items.every((item, i) =>
        Object.keys(item).every(
          (key) => item[key as keyof VirtualItem] === previous.items[i][key as keyof VirtualItem],
        ),
      )
    )
      return;
    this.snapshot = {
      items: items.map((item) => ({ ...item })),
      totalSize,
      scrollOffset,
      scrollRect: scrollRect ? { ...scrollRect } : null,
    };
    for (const listener of this.listeners) listener();
  }
}

export function useRowVirtualizer(lifetime: RenderLifetime, options: Options): RowVirtualizer {
  const store = useMemo(() => new RowVirtualizerStore(), []);
  const snapshot = useSyncExternalStore(store.subscribe, store.read, store.read);
  lifetime.useBeforePaint(() => store.mount(), [store]);
  lifetime.useBeforePaint(() => store.configure(options), [store, options]);
  return useMemo(() => ({ ...snapshot, ...store.controls }), [snapshot, store]);
}
