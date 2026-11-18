// 预览辅助线：安全区、三分线，或竖屏平台被按钮与文案遮挡的区域。仅显示在屏幕上，不会导出。

export type GuideMode = "safe" | "grid" | "tiktok" | "reels" | "shorts";

export const guides: { value: GuideMode; label: string }[] = [
  { value: "safe", label: "安全区与三分线" },
  { value: "grid", label: "三分网格" },
  { value: "tiktok", label: "抖音 / TikTok" },
  { value: "reels", label: "Instagram Reels" },
  { value: "shorts", label: "YouTube Shorts" },
];

/** 各平台竖屏安全区边距（画面比例），取自平台公开的 1080×1920 模板并取整；不同版本略有变化，需留余量。 */
export const platformZones: Record<"tiktok" | "reels" | "shorts", { top: number; bottom: number; left: number; right: number }> = {
  tiktok: { top: 0.078, bottom: 0.234, left: 0.056, right: 0.111 },
  reels: { top: 0.115, bottom: 0.219, left: 0.056, right: 0.111 },
  shorts: { top: 0.078, bottom: 0.198, left: 0.056, right: 0.139 },
};
