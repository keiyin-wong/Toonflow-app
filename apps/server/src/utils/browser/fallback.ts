import { browserActionSchema } from "@toonflow/tool-browser/protocol";
import type { ToolContext } from "@toonflow/tools-scaffold/runtime";
import { downloadPublicFile } from "@/utils/workspace/download";

type FetchedPage = { url: string; title: string; text: string };
// ACT: 进程内按 Agent 会话缓存最近抓取的正文，最多 20 份、超出淘汰最旧；不落盘、不跨进程。
const pageLimit = 20;
const pages = new Map<string, FetchedPage>();

const namedEntities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, entity => {
    const body = entity.slice(1, -1).toLowerCase();
    if (Object.hasOwn(namedEntities, body)) return namedEntities[body];
    const code = body[1] === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

// ACT: 无 DOM 依赖的正则提取，近似 innerText：不执行脚本渲染、不保留链接与表格结构、假定 UTF-8 编码；动态渲染页面请使用桌面客户端浏览器。
function extractPage(html: string) {
  const title = decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "")
    .replace(/\s+/g, " ").trim().slice(0, 1000);
  const text = decodeEntities(html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(?:script|style|noscript|template|svg|head|iframe)\b[^>]*\/?>/gi, "")
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6]|section|article|header|footer|nav|aside|main|blockquote|pre|table|thead|tbody|ul|ol|dl|dt|dd|form|fieldset|option|button|label|caption|figcaption|address|details|summary|dialog|figure)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return { title, text };
}

async function fetchPage(url: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const bytes = await downloadPublicFile(url, {
    signal: requestSignal, maxBytes: 10 * 1024 * 1024, label: "网页",
    accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
  }).catch(error => {
    if (timeout.aborted) throw new Error("网页抓取超时（30 秒），请检查网络后重试");
    if (error instanceof Error && "status" in error) throw error;
    throw Object.assign(new Error("网页抓取连接失败，请检查地址、网络或 HTTPS 证书", { cause: error }), { status: 502 });
  });
  return extractPage(bytes.toString("utf8"));
}

// 分页与桌面浏览器 read 保持一致：每页 12000 字符，末尾代理对不拆分。
function paginate(text: string, offset: number) {
  if (offset > text.length) throw new Error("正文 offset 超出内容范围");
  let end = Math.min(offset + 12000, text.length);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  return { text: text.slice(offset, end), offset, total: text.length, nextOffset: end < text.length ? end : null };
}

/** 非桌面宿主的降级实现：open、navigate、newTab 抓取正文，read、snapshot、tabs 读取缓存；交互类操作报错。 */
export function createBrowserFallback(): NonNullable<ToolContext["browser"]> {
  return {
    async execute(sessionId, args, _config, signal, onUpdate) {
      const action = browserActionSchema.parse(args);
      if (["click", "hover", "type", "pressKey", "scroll", "screenshot", "selectTab", "closeTab"].includes(action.action)) {
        throw new Error("当前宿主为浏览器降级抓取模式，仅支持 open、navigate、read 获取网页正文；点击、输入等交互需要 Toonflow 桌面客户端");
      }
      const result = (page: FetchedPage | undefined, data: Record<string, unknown> = {}, status: "running" | "closed" = "running") => {
        const details = {
          browserSessionId: sessionId, tabId: "fetch", url: page?.url ?? "", title: page?.title ?? "",
          canGoBack: false, canGoForward: false, status, ...data,
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
      };
      if (action.action === "close") {
        const closed = result(pages.get(sessionId), {}, "closed");
        pages.delete(sessionId);
        return closed;
      }
      const url = "url" in action ? action.url : undefined;
      if (url) {
        onUpdate?.(result(pages.get(sessionId), { action: action.action, message: "正在抓取网页" }));
        const page = { url, ...await fetchPage(url, signal) };
        pages.delete(sessionId);
        pages.set(sessionId, page);
        while (pages.size > pageLimit) pages.delete(pages.keys().next().value!);
        return result(page);
      }
      const page = pages.get(sessionId);
      if (!page) throw new Error("浏览器降级抓取模式没有已打开的网页，请先使用 open 或 navigate 提供网址抓取");
      if (action.action === "read" || action.action === "snapshot") {
        const data = paginate(page.text, action.offset);
        return result(page, action.action === "snapshot"
          ? { ...data, notice: "当前为降级抓取模式，无元素引用可交互；点击、输入等操作需要 Toonflow 桌面客户端" }
          : data);
      }
      if (action.action === "tabs") {
        if (action.offset > 1) throw new Error("标签页 offset 超出内容范围");
        return result(page, { tabs: [{ tabId: "fetch", url: page.url.slice(0, 2000), title: page.title.slice(0, 300), active: true }], total: 1, nextOffset: null });
      }
      return result(page);
    },
  };
}
