import type { AssetLibraryEntry } from "../../types";
import { assetLibraryEntryDurationUs, assetLibraryEntryFlag } from "./assetLibrary";
import { assetLibraryEntryColorFilter, assetLibraryFilterColors } from "./assetLibraryFilter";

export type AssetLibraryGroupKey =
  "name" | "created" | "kind" | "duration" | "rating" | "flag" | "color";

/** File-manager grouping: a key, or none, and the order of the groups themselves. */
export interface AssetLibraryGrouping {
  key: AssetLibraryGroupKey | null;
  direction: "ascending" | "descending";
}

export const assetLibraryGroupKeys: readonly AssetLibraryGroupKey[] = [
  "name",
  "created",
  "kind",
  "duration",
  "rating",
  "flag",
  "color",
];

export const assetLibraryGroupKeyLabels: Record<AssetLibraryGroupKey, string> = {
  name: "名称",
  created: "添加时间",
  kind: "类型",
  duration: "时长",
  rating: "星级",
  flag: "旗标",
  color: "色标",
};

export const noAssetLibraryGrouping: AssetLibraryGrouping = { key: null, direction: "ascending" };

/** Dates and ratings list the newest and highest first, as a file manager does for dates. */
export function assetLibraryGroupingFor(key: AssetLibraryGroupKey | null): AssetLibraryGrouping {
  const descending = key === "created" || key === "rating";
  return { key, direction: descending ? "descending" : "ascending" };
}

/** What grouping needs to know about a listed item. */
export interface AssetLibraryGroupItem {
  kind: "folder" | "entry" | "library";
  name: string;
  createdAt: number | null;
  entry: AssetLibraryEntry | null;
}

export interface AssetLibraryGroup<T> {
  id: string;
  label: string;
  items: T[];
}

interface GroupSlot {
  label: string;
  rank: number;
}

/** Items a key does not apply to, such as a folder's rating; always listed last. */
const unspecified: GroupSlot = { label: "未指定", rank: Number.NaN };

const pinyinCollator = new Intl.Collator("zh-Hans-CN-u-co-pinyin", { sensitivity: "base" });
/** The first character of each pinyin initial, in collation order; no pinyin starts with I, U or V. */
const pinyinBoundaries = [..."阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀"];
const pinyinInitials = "ABCDEFGHJKLMNOPQRSTWXYZ";

/** The Latin letter a name files under; Chinese names file under their pinyin initial. */
export function assetLibraryNameInitial(name: string) {
  const first = [...name.trim()][0] ?? "";
  if (/[0-9]/.test(first)) return "0";
  if (/[a-z]/i.test(first)) return first.toLocaleUpperCase();
  if (!/\p{Script=Han}/u.test(first)) return null;
  let index = -1;
  pinyinBoundaries.forEach((boundary, boundaryIndex) => {
    if (pinyinCollator.compare(first, boundary) >= 0) index = boundaryIndex;
  });
  return index < 0 ? null : pinyinInitials[index]!;
}

/** Latin names, then Chinese names by pinyin initial, each in their own letter ranges. */
const nameRanges: readonly { prefix: string; from: string; to: string; han: boolean }[] = [
  { prefix: "", from: "A", to: "H", han: false },
  { prefix: "", from: "I", to: "P", han: false },
  { prefix: "", from: "Q", to: "Z", han: false },
  { prefix: "拼音 ", from: "A", to: "F", han: true },
  { prefix: "拼音 ", from: "G", to: "L", han: true },
  { prefix: "拼音 ", from: "M", to: "S", han: true },
  { prefix: "拼音 ", from: "T", to: "Z", han: true },
];

function nameSlot(name: string): GroupSlot {
  const initial = assetLibraryNameInitial(name);
  if (initial === "0") return { label: "0 - 9", rank: 0 };
  const han = /\p{Script=Han}/u.test([...name.trim()][0] ?? "");
  const range = nameRanges.findIndex(
    (candidate) =>
      initial && candidate.han === han && initial >= candidate.from && initial <= candidate.to,
  );
  if (range < 0) return { label: "其他", rank: nameRanges.length + 1 };
  const { prefix, from, to } = nameRanges[range]!;
  return { label: `${prefix}${from} - ${to}`, rank: range + 1 };
}

function startOfDay(time: Date, dayOffset = 0) {
  return new Date(time.getFullYear(), time.getMonth(), time.getDate() + dayOffset).getTime();
}

/** Relative date groups, newest last so that the rank grows with recency. Weeks start on Monday. */
export function assetLibraryDateGroup(timestamp: number, now: number): GroupSlot {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return unspecified;
  const today = new Date(now);
  const weekday = (today.getDay() + 6) % 7;
  const bounds: [number, string][] = [
    [startOfDay(today), "今天"],
    [startOfDay(today, -1), "昨天"],
    [startOfDay(today, -weekday), "本周早些时候"],
    [startOfDay(today, -weekday - 7), "上周"],
    [new Date(today.getFullYear(), today.getMonth(), 1).getTime(), "这个月的早些时候"],
    [new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime(), "上个月"],
    [new Date(today.getFullYear(), 0, 1).getTime(), "今年早些时候"],
  ];
  const index = bounds.findIndex(([start]) => timestamp >= start);
  return index < 0
    ? { label: "很久以前", rank: 0 }
    : { label: bounds[index]![1], rank: bounds.length - index };
}

const durationSlots: readonly [number, string][] = [
  [5, "很短 (0 - 5 秒)"],
  [30, "短 (5 - 30 秒)"],
  [120, "中等 (30 秒 - 2 分钟)"],
  [600, "长 (2 - 10 分钟)"],
];

function durationSlot(entry: AssetLibraryEntry): GroupSlot {
  const seconds = assetLibraryEntryDurationUs(entry) / 1_000_000;
  const index = durationSlots.findIndex(([limit]) => seconds < limit);
  return index < 0
    ? { label: "很长 (> 10 分钟)", rank: durationSlots.length }
    : { label: durationSlots[index]![1], rank: index };
}

const flagSlots = { retained: "留用", none: "无旗标", excluded: "排除" } as const;
const colorSlotLabels = {
  red: "红色",
  yellow: "黄色",
  green: "绿色",
  blue: "蓝色",
  purple: "紫色",
  custom: "自定义",
  none: "无色标",
} as const;

function groupSlot(item: AssetLibraryGroupItem, key: AssetLibraryGroupKey, now: number): GroupSlot {
  if (key === "name") return nameSlot(item.name);
  if (key === "created") return assetLibraryDateGroup(item.createdAt ?? Number.NaN, now);
  const { entry } = item;
  if (key === "kind") {
    if (!entry) return { label: "文件夹", rank: 0 };
    return entry.root === "subtitles"
      ? { label: "字幕素材", rank: 1 }
      : { label: "分镜素材", rank: 2 };
  }
  if (!entry) return unspecified;
  switch (key) {
    case "duration":
      return durationSlot(entry);
    case "rating": {
      const { rating } = entry.annotation;
      return rating > 0 ? { label: `${rating} 星`, rank: rating } : { label: "未分级", rank: 0 };
    }
    case "flag": {
      const flag = assetLibraryEntryFlag(entry);
      return { label: flagSlots[flag], rank: Object.keys(flagSlots).indexOf(flag) };
    }
    case "color": {
      const color = assetLibraryEntryColorFilter(entry);
      return { label: colorSlotLabels[color], rank: assetLibraryFilterColors.indexOf(color) };
    }
  }
}

/**
 * Splits already sorted items into groups, keeping their order inside each group. Groups
 * follow the grouping direction, with items the key does not apply to last.
 */
export function groupedAssetLibraryItems<T>(
  items: readonly T[],
  describe: (item: T) => AssetLibraryGroupItem,
  grouping: AssetLibraryGrouping,
  now: number,
): AssetLibraryGroup<T>[] {
  const { key } = grouping;
  if (!key) return [];
  const groups = new Map<string, { slot: GroupSlot; items: T[] }>();
  for (const item of items) {
    const slot = groupSlot(describe(item), key, now);
    const group = groups.get(slot.label);
    if (group) group.items.push(item);
    else groups.set(slot.label, { slot, items: [item] });
  }
  const direction = grouping.direction === "ascending" ? 1 : -1;
  return [...groups.values()]
    .sort((left, right) => {
      const leftUnspecified = Number.isNaN(left.slot.rank);
      const rightUnspecified = Number.isNaN(right.slot.rank);
      if (leftUnspecified || rightUnspecified) {
        return Number(leftUnspecified) - Number(rightUnspecified);
      }
      return (left.slot.rank - right.slot.rank) * direction;
    })
    .map(({ slot, items: groupItems }) => ({
      id: slot.label,
      label: slot.label,
      items: groupItems,
    }));
}
