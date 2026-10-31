export const preferencesCategories = [
  { id: "general", label: "常规", mnemonic: "G" },
  { id: "appearance", label: "外观", mnemonic: "P" },
  { id: "backup", label: "自动保存", mnemonic: "U" },
  { id: "cache", label: "媒体缓存", mnemonic: "C" },
  { id: "tools", label: "媒体工具", mnemonic: "T" },
] as const;

export type PreferencesCategory = (typeof preferencesCategories)[number]["id"];
