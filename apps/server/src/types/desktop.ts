export type PluginInstallType = "node" | "tool" | "skill" | "provider" | "agent" | "ext";
export type PluginInstallRequest = { type: PluginInstallType; url: string; fileName: string };

/** CapCut 在线曲库的一首歌（与 @toonflow/tool-browser/capcutMusic 的结构保持一致）。 */
export type CapcutSong = {
  id: string;
  title: string;
  author: string;
  duration: number; // 秒
  coverUrl: string;
  previewUrl: string; // 音频直链（CDN，匿名可取）
  paidType: string; // free / vip ...
};
export type CapcutSearchResult = { songs: CapcutSong[]; hasMore: boolean; cursor: number };

/**
 * 桌面端内嵌 CapCut webview 的曲库控制器：用应用自己的 webview（持久登录态）驱动真实页面触发搜索、
 * 拦截其 XHR 结果，替代外部 puppeteer 浏览器。首次使用需 login() 让用户在内嵌 webview 里登录一次。
 */
export interface CapcutMusicController {
  search(keyword: string): Promise<CapcutSearchResult>;
  recommend(): Promise<CapcutSearchResult>;
  /** 显示内嵌 webview 让用户登录 CapCut；登录成功后自行隐藏并 resolve。 */
  login(): Promise<void>;
  /** 当前内嵌 webview 是否已登录 CapCut（曲库搜索框可用即视为已登录）。 */
  loggedIn(): Promise<boolean>;
}

export type desktopUpdateAttempt = {
  attemptId: string;
  runtimeId: string;
  channel: string;
  targetVersion: string;
  targetHash: string;
  failure?: string;
};

export type updateSnapshot = {
  version: string;
  channel: string;
  hash: string;
  latestVersion: string;
  latestHash: string;
  error: string;
  updateAvailable: boolean;
  updateReady: boolean;
  updating: boolean;
  canUpdate: boolean;
  updateProgress?: { phase: "downloading" | "preparing"; received: number; total?: number };
  installFailure?: {
    attemptId: string;
    targetVersion: string;
    targetHash: string;
    currentVersion: string;
    currentHash: string;
    message: string;
    downloadUrl: string;
  };
};

export interface DesktopRuntime {
  openUrl(url: string): void;
  showNotification(options: { title: string; body?: string; silent?: boolean }): void | Promise<void>;
  showItemInFolder(path: string): void;
  readClipboardText(): string | null;
  readClipboardImage(): Uint8Array | null;
  writeClipboardImage(image: Uint8Array): void;
  writeClipboardText(text: string): void;
  selectProviderFile(): Promise<string | null>;
  selectDirectory(): Promise<string | null>;
  selectSaveFile(fileName: string): Promise<string | null>;
  saveFile(token: string, content: Uint8Array): Promise<boolean>;
  ready(failed?: boolean): Promise<void>;
  openDevTools(): void;
  /** 内嵌 CapCut 曲库（仅桌面客户端提供；非桌面或创建失败时为 undefined，接口自行降级）。 */
  capcutMusic?: CapcutMusicController;
  updater: {
    getLocalInfo(): Promise<{ version: string; channel: string; hash: string; baseUrl: string }>;
    updateInfo(): { version?: string; hash?: string; error?: string; installError?: string; updateAvailable?: boolean; updateReady?: boolean; updateProgress?: updateSnapshot["updateProgress"] } | undefined;
    checkForUpdate(): Promise<{ error?: string }>;
    onStatusChange?(callback: ((entry: { status: string; details?: { bytesDownloaded?: number; totalBytes?: number } }) => void) | null): void;
    confirmStartup?(failed?: boolean): void | Promise<void>;
    downloadUpdate?(): Promise<void>;
    applyUpdate?(): Promise<void>;
  };
}
