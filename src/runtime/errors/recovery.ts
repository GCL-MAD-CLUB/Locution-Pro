/** User-facing recovery guidance for failures that have a direct remedy. */
export interface IncidentRecovery {
  title: string;
  component: string;
  message: string;
  steps: readonly string[];
  action?: { label: string; url: string };
}

const vcRuntimeRecovery: IncidentRecovery = {
  title: "需要修复运行环境",
  component: "Microsoft Visual C++ 运行库（x64）",
  message: "此运行库缺失、版本不兼容或已损坏，当前操作无法继续。",
  steps: [
    "从微软官方下载并运行安装程序。",
    "按提示完成安装；如果已经安装，请选择“修复”。",
    "关闭并重新启动应用，再重试刚才的操作。",
  ],
  action: {
    label: "下载 VC++ 运行库",
    url: "https://aka.ms/vs/17/release/vc_redist.x64.exe",
  },
};

const incidentRecoveries: Readonly<Record<string, IncidentRecovery>> = {
  VC_RUNTIME_MISSING: vcRuntimeRecovery,
  NATIVE_RUNTIME_DEPENDENCY_UNAVAILABLE: {
    title: "需要修复运行环境",
    component: "本地运行组件及依赖",
    message: "运行组件或其依赖缺失、版本过旧或不兼容，当前操作无法继续。",
    steps: [
      "先从微软官方下载并安装最新的 VC++ 运行库；如果已经安装，请尝试修复。",
      "关闭并重新启动应用，再重试刚才的操作。",
      "如果问题持续，请使用应用安装程序重新安装，修复随附的运行组件。",
    ],
    action: vcRuntimeRecovery.action,
  },
  NATIVE_RUNTIME_MISSING: {
    title: "应用运行组件不完整",
    component: "本地运行组件",
    message: "应用随附的运行组件缺失，当前操作无法继续。",
    steps: ["使用应用安装程序重新安装，补全运行组件。", "重新启动应用后，再重试刚才的操作。"],
  },
  NATIVE_RUNTIME_LOAD_FAILED: {
    title: "无法加载运行组件",
    component: "本地运行组件",
    message: "运行组件加载失败，可能与文件损坏、访问权限或系统兼容性有关。",
    steps: [
      "重新启动应用后重试。",
      "如果问题持续，请使用应用安装程序重新安装，并检查文件访问权限。",
    ],
  },
};

export function incidentRecovery(code: string): IncidentRecovery | null {
  return Object.hasOwn(incidentRecoveries, code) ? incidentRecoveries[code] : null;
}
