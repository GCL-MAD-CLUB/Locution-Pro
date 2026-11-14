import { defineConfig } from "vitepress";

const repository = "GCL-MAD-CLUB/Locution-Pro";

function normalizeBase(value: string | undefined) {
  const candidate = (value ?? "/").trim();

  if (!candidate || candidate === "/") {
    return "/";
  }

  return `/${candidate.replace(/^\/+|\/+$/g, "")}/`;
}

export default defineConfig({
  lang: "zh-CN",
  title: "Locution Pro 帮助中心",
  description: "管理媒体，按画面查找镜头，整理并交付所需片段。",
  base: normalizeBase(process.env.DOCS_BASE),
  cleanUrls: false,
  lastUpdated: true,
  sitemap: { hostname: "https://helpx.locution.dpdns.org" },
  head: [
    [
      "link",
      {
        rel: "icon",
        type: "image/x-icon",
        href: `${normalizeBase(process.env.DOCS_BASE)}favicon.ico`,
      },
    ],
    ["meta", { name: "theme-color", content: "#315efb" }],
    ["meta", { property: "og:locale", content: "zh_CN" }],
  ],
  themeConfig: {
    siteTitle: "Locution Pro 帮助中心",
    nav: [
      { text: "官网", link: "https://locution.dpdns.org/" },
      { text: "开始使用", link: "/getting-started/first-project" },
      { text: "按任务学习", link: "/workflows/find-visuals" },
      { text: "故障排查", link: "/troubleshooting/troubleshooting" },
      { text: "下载", link: "https://locution.dpdns.org/#download" },
    ],
    sidebar: [
      {
        text: "Locution Pro 帮助中心",
        items: [
          {
            text: "概览",
            link: "/",
          },
        ],
      },
      {
        text: "开始使用",
        collapsed: false,
        items: [
          {
            text: "系统要求",
            link: "/getting-started/system-requirements",
          },
          {
            text: "安装与首次启动",
            link: "/getting-started/install",
          },
          {
            text: "常见问题",
            link: "/getting-started/faq",
          },
          {
            text: "创建第一个项目",
            link: "/getting-started/first-project",
          },
          {
            text: "认识工作界面",
            link: "/getting-started/interface",
          },
          {
            text: "更新与获取帮助",
            link: "/getting-started/updates",
          },
        ],
      },
      {
        text: "工作区和操作",
        collapsed: true,
        items: [
          {
            text: "工作区、面板与任务",
            link: "/workspace/workspace",
          },
          {
            text: "管理来源工作区和导航历史",
            link: "/workspace/source-workspaces",
          },
          {
            text: "使用历史记录和后台任务",
            link: "/workspace/tasks-history",
          },
          {
            text: "键盘快捷键",
            link: "/workspace/shortcuts",
          },
        ],
      },
      {
        text: "管理项目和首选项",
        collapsed: true,
        items: [
          {
            text: "创建和管理项目",
            link: "/projects/projects",
          },
          {
            text: "保存、自动保存和恢复项目",
            link: "/projects/save-recover",
          },
          {
            text: "备份和移交项目与素材",
            link: "/projects/transfer-project",
          },
          {
            text: "首选项",
            link: "/projects/preferences",
          },
        ],
      },
      {
        text: "导入和整理媒体",
        collapsed: true,
        items: [
          {
            text: "导入和整理媒体",
            link: "/media/import-organize",
          },
          {
            text: "浏览和选择待导入文件",
            link: "/media/browse-files",
          },
          {
            text: "设置导入组织、复制和自动绑定",
            link: "/media/copy-media",
          },
          {
            text: "创建和管理媒体箱",
            link: "/media/organize-bin",
          },
          {
            text: "管理音频与字幕轨",
            link: "/media/tracks-binding",
          },
        ],
      },
      {
        text: "媒体连接和代理",
        collapsed: true,
        items: [
          {
            text: "管理离线媒体与代理",
            link: "/media/offline-proxies",
          },
          {
            text: "重新链接、替换和断开媒体",
            link: "/media/relink-media",
          },
          {
            text: "创建、连接和管理代理",
            link: "/media/create-proxies",
          },
        ],
      },
      {
        text: "预览和导出静帧",
        collapsed: true,
        items: [
          {
            text: "使用源监视器",
            link: "/source/source-monitor",
          },
          {
            text: "播放和精确定位媒体",
            link: "/source/playback-navigation",
          },
          {
            text: "添加、移动和清除切点",
            link: "/source/edit-cuts",
          },
          {
            text: "从视频导出静帧",
            link: "/source/export-still",
          },
        ],
      },
      {
        text: "检测、查找和整理分镜",
        collapsed: true,
        items: [
          {
            text: "使用分镜",
            link: "/storyboard/storyboards",
          },
          {
            text: "检测和重新切分镜头",
            link: "/storyboard/detect-shots",
          },
          {
            text: "浏览、排序和选择分镜",
            link: "/storyboard/browse-shots",
          },
          { text: "使用分镜图谱", link: "/storyboard/graph" },
          {
            text: "按标题和关键字查找分镜",
            link: "/storyboard/text-search",
          },
          {
            text: "按画面描述查找分镜",
            link: "/storyboard/semantic-search",
          },
          {
            text: "标记和筛选分镜",
            link: "/storyboard/rate-filter",
          },
          {
            text: "堆叠和合并镜头",
            link: "/storyboard/stack-merge",
          },
          {
            text: "删除和恢复分镜",
            link: "/storyboard/delete-restore",
          },
          {
            text: "使用直方图和帧迹图审看分镜",
            link: "/storyboard/frame-data",
          },
        ],
      },
      {
        text: "为分镜添加关键字",
        collapsed: true,
        items: [
          {
            text: "使用关键字",
            link: "/storyboard/use-keywords",
          },
          {
            text: "维护关键字层级和同义词",
            link: "/storyboard/manage-keywords",
          },
          {
            text: "使用关键字集和喷涂工具",
            link: "/storyboard/keyword-sets",
          },
        ],
      },
      {
        text: "浏览和查找字幕",
        collapsed: true,
        items: [
          {
            text: "使用字幕",
            link: "/subtitles/subtitles",
          },
          {
            text: "选择和管理字幕来源",
            link: "/subtitles/choose-sources",
          },
          {
            text: "浏览、排序和预览字幕",
            link: "/subtitles/browse-preview",
          },
          {
            text: "按文字查找字幕",
            link: "/subtitles/text-search",
          },
          {
            text: "按含义查找字幕",
            link: "/subtitles/semantic-search",
          },
          {
            text: "设置字幕高级搜索条件",
            link: "/subtitles/advanced-search",
          },
          {
            text: "标注和筛选字幕",
            link: "/subtitles/rate-filter",
          },
          {
            text: "删除字幕条目",
            link: "/subtitles/delete-cues",
          },
          {
            text: "从字幕导出对白片段",
            link: "/subtitles/export-clips",
          },
        ],
      },
      {
        text: "导出媒体",
        collapsed: true,
        items: [
          {
            text: "导出媒体",
            link: "/export/exporting",
          },
          {
            text: "选择、预览和调整待导出片段",
            link: "/export/prepare-clips",
          },
          {
            text: "设置视频格式、尺寸和质量",
            link: "/export/video-settings",
          },
          {
            text: "设置音频和纯音频输出",
            link: "/export/audio-settings",
          },
          {
            text: "设置导出位置、文件名和同名处理",
            link: "/export/naming-location",
          },
          {
            text: "提交导出、查看结果和复用设置",
            link: "/export/run-export",
          },
        ],
      },
      {
        text: "按任务学习",
        collapsed: true,
        items: [
          {
            text: "按画面查找镜头",
            link: "/workflows/find-visuals",
          },
          {
            text: "整理分镜并建立关键字",
            link: "/workflows/organize-storyboard",
          },
          {
            text: "通过字幕找到片段",
            link: "/workflows/find-dialogue",
          },
          {
            text: "生成代理以流畅预览",
            link: "/workflows/create-proxy",
          },
          {
            text: "转码媒体文件",
            link: "/workflows/transcode-media",
          },
          {
            text: "导出所选片段或成片",
            link: "/workflows/export-video",
          },
        ],
      },
      {
        text: "格式和使用条件",
        collapsed: true,
        items: [
          {
            text: "支持的格式与兼容性",
            link: "/reference/supported-formats",
          },
          {
            text: "当前限制与使用边界",
            link: "/reference/limitations",
          },
        ],
      },
      {
        text: "故障排查与支持",
        collapsed: true,
        items: [
          {
            text: "故障排查",
            link: "/troubleshooting/troubleshooting",
          },
          {
            text: "解决导入、连接和预览问题",
            link: "/troubleshooting/media-playback",
          },
          {
            text: "解决分镜和字幕检索问题",
            link: "/troubleshooting/search-results",
          },
          {
            text: "解决保存、恢复和导出问题",
            link: "/troubleshooting/save-export",
          },
        ],
      },
    ],
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: "搜索", buttonAriaLabel: "搜索帮助中心" },
              modal: {
                noResultsText: "没有找到相关内容",
                resetButtonTitle: "清除搜索",
                backButtonTitle: "关闭搜索",
                displayDetails: "显示详细列表",
                footer: {
                  selectText: "选择",
                  selectKeyAriaLabel: "回车",
                  navigateText: "切换",
                  navigateUpKeyAriaLabel: "向上箭头",
                  navigateDownKeyAriaLabel: "向下箭头",
                  closeText: "关闭",
                  closeKeyAriaLabel: "Esc",
                },
              },
            },
          },
        },
      },
    },
    outline: { level: [2, 3], label: "本页内容" },
    lastUpdated: { text: "最后更新于" },
    docFooter: { prev: "上一篇", next: "下一篇" },
    footer: {
      message: "Locution Pro 用户指南 · 媒体管理、画面检索与镜头整理",
      copyright: "Copyright © GCL MAD CLUB",
    },
    socialLinks: [{ icon: "github", link: `https://github.com/${repository}` }],
  },
});
