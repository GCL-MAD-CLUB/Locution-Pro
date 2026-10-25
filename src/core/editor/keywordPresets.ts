export const recentKeywordSet = "recent";
export const customKeywordSet = "custom";

export interface KeywordPreset {
  id: string;
  name: string;
  keywords: string[];
}

export function keywordSlots(keywords: readonly string[]) {
  return Array.from({ length: 9 }, (_, index) => keywords[index]?.trim() ?? "");
}

const defaultPresets: KeywordPreset[] = [
  {
    id: "builtin:subject",
    name: "画面主体",
    keywords: ["人物", "物件", "动物", "交通工具", "建筑", "自然景观", "文字屏幕"],
  },
  {
    id: "builtin:shot-size",
    name: "景别取景",
    keywords: ["人物远景", "人物全身", "人物半身", "人物特写", "物件全貌", "物件特写"],
  },
  {
    id: "builtin:camera-angle",
    name: "拍摄视角",
    keywords: ["平拍", "俯拍", "仰拍", "顶拍", "倾斜拍"],
  },
  {
    id: "builtin:subject-motion",
    name: "主体运动",
    keywords: ["静止", "原地动作", "空间移动", "混合运动"],
  },
  {
    id: "builtin:camera-motion",
    name: "镜头运动",
    keywords: ["固定", "推", "拉", "水平摇", "垂直摇", "移", "跟", "升降", "环绕"],
  },
  {
    id: "builtin:people-count",
    name: "人物数量",
    keywords: ["无人", "单人", "双人", "多人"],
  },
];

export function defaultKeywordPresets(): KeywordPreset[] {
  return defaultPresets.map((preset) => ({ ...preset, keywords: keywordSlots(preset.keywords) }));
}

export function isDefaultKeywordPreset(id: string) {
  return defaultPresets.some((preset) => preset.id === id);
}

export function restoreKeywordPresets(presets: readonly KeywordPreset[]) {
  return [
    ...defaultKeywordPresets(),
    ...presets.filter((preset) => !isDefaultKeywordPreset(preset.id)),
  ];
}

export function keywordPresetNameError(
  name: string,
  presets: readonly KeywordPreset[],
  exceptId?: string,
) {
  if (!name.trim()) return "请输入预设名称。";
  if (
    ["自定", "最近使用过的关键字"].includes(name.trim()) ||
    presets.some((preset) => preset.id !== exceptId && preset.name === name.trim())
  )
    return "名称已被使用。";
  return null;
}

export function decodeKeywordPresets(value: unknown): {
  presets: KeywordPreset[];
  selected: string;
} {
  const defaults = { presets: defaultKeywordPresets(), selected: recentKeywordSet };
  if (!value || typeof value !== "object") return defaults;
  const data = value as { presets?: unknown; selected?: unknown };
  if (!Array.isArray(data.presets)) return defaults;
  const presets: KeywordPreset[] = [];
  for (const item of data.presets) {
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      !Array.isArray(item.keywords) ||
      !item.keywords.every((keyword: unknown) => typeof keyword === "string")
    )
      continue;
    if (
      presets.some((preset) => preset.id === item.id) ||
      [recentKeywordSet, customKeywordSet].includes(item.id) ||
      keywordPresetNameError(item.name, presets)
    )
      continue;
    presets.push({ id: item.id, name: item.name.trim(), keywords: keywordSlots(item.keywords) });
  }
  const legacyKeywords = keywordSlots(["特写", "近景", "中景", "远景", "空镜"]);
  const merged = defaultKeywordPresets().map((preset) => {
    const saved = presets.find((item) => item.id === preset.id);
    if (!saved) return preset;
    // Upgrade the unchanged former 景别 default while retaining user edits and its selected ID.
    const legacy = saved.id === "builtin:shot-size" && saved.name === "景别";
    const unchanged = saved.keywords.every((keyword, index) => keyword === legacyKeywords[index]);
    return { ...preset, keywords: legacy && unchanged ? preset.keywords : saved.keywords };
  });
  for (const preset of presets.filter((item) => !isDefaultKeywordPreset(item.id))) {
    // New builtins may have the same name as an older custom preset; retain both contents.
    let name = preset.name;
    let suffix = 1;
    while (keywordPresetNameError(name, merged)) {
      name = `${preset.name}（自定义${suffix === 1 ? "" : suffix}）`;
      suffix += 1;
    }
    merged.push({ ...preset, name });
  }
  return {
    presets: merged,
    selected: merged.some((preset) => preset.id === data.selected)
      ? (data.selected as string)
      : recentKeywordSet,
  };
}
