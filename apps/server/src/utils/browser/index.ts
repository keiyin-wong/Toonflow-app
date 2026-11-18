import { createBrowserRuntime } from "@toonflow/tool-browser/host";
import type { ToolContext } from "@toonflow/tools-scaffold/runtime";
import { getRuntimePlatform } from "@/lib/platform";
import { createBrowserFallback } from "./fallback";

export const browserRuntime = createBrowserRuntime();

export function createBrowserContext(cwd: string): ToolContext["browser"] {
  // 非桌面宿主降级为 HTTP 抓取：open、navigate、read 返回网页正文，交互类操作在降级实现中提示升级桌面客户端。
  if (!getRuntimePlatform().browserSupported) return createBrowserFallback();
  return { execute: (sessionId, args, config, signal, onUpdate) => browserRuntime.execute(cwd, sessionId, args, config, signal, onUpdate) };
}

export function closeBrowsers() {
  return browserRuntime.closeAll();
}
