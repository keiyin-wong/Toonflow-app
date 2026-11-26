/**
 * CapCut 在线音乐曲库 provider。
 *
 * CapCut 的音乐搜索接口 (POST /lv/v1/music/search/songs) 受 ByteDance 风控签名
 * (X-Bogus / X-Gnarly / msToken / sign) 保护，签名由页面内的 webmssdk 实时生成，
 * 服务端无法复刻。因此这里常驻一个登录态的本机浏览器（puppeteer 驱动 Edge/Chrome，
 * 持久 profile），通过真实页面触发搜索并拦截其 XHR 响应，把结果结构化返回。
 *
 * 首次使用前需用 capcutLogin.ts 在同一 profile 登录一次 CapCut。
 */
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, delimiter, isAbsolute } from "node:path";

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

const PROFILE = join(homedir(), ".toonflow", "capcut-profile");
const EDITOR = "https://www.capcut.com/editor?enter_from=new_homepage_tools&from_page=work_space&scenario=custom";
const SEARCH_INPUT = 'input[placeholder="Search music"]';

/** 允许代理下载的音频/封面 CDN 域名后缀，防 SSRF。 */
const ALLOWED_HOSTS = [".capcutstatic.com", ".tiktokcdn.com", ".capcut.com", ".byteimg.com"];

// 拦截音乐面板的 XHR：带 keyword 的 → 搜索结果 __ccResult；不带 keyword 的歌单（默认/推荐）→ __ccRecommend。
const HOOK = `(function(){
  if(window.__ccHook)return; window.__ccHook=true; window.__ccResult=undefined; window.__ccRecommend=undefined;
  function mapData(d){ return {cursor:d.new_cursor, hasMore:!!d.has_more,
    songs:(d.songs||[]).map(function(x){return {id:String(x.id), title:x.title, author:x.author, duration:x.duration,
      coverUrl:(x.cover_url&&(x.cover_url.medium||x.cover_url.thumb||x.cover_url.large))||'', previewUrl:x.preview_url||'', paidType:x.paid_type||''};})}; }
  var oo=XMLHttpRequest.prototype.open, os=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this.__u=String(u);return oo.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(b){var s=this;
    if(/\\/music\\//.test(s.__u||'')){
      try{s.__kw=(JSON.parse(b)||{}).keyword||'';}catch(e){s.__kw='';}
      s.addEventListener('load',function(){try{var j=JSON.parse(s.responseText);
        if(j && j.ret==='0' && j.data){ var r=mapData(j.data);
          if(s.__kw){ r.kw=s.__kw; window.__ccResult=r; } else if(j.data.songs){ window.__ccRecommend=r; } }
        else if(s.__kw){ window.__ccResult={kw:s.__kw, songs:[], cursor:0, hasMore:false}; } // 搜索出错/非 0 也结束等待
      }catch(e){ window.__ccErr=String(e); if(s.__kw){ window.__ccResult={kw:s.__kw, songs:[], cursor:0, hasMore:false}; } }});
    }
    return os.apply(this,arguments);};
})();`;

async function findBrowser(configured?: string): Promise<string> {
  if (configured && !isAbsolute(configured)) throw new Error("executablePath 必须是绝对路径");
  const env = process.platform === "win32"
    ? Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k.toUpperCase(), v])) : process.env;
  const candidates = configured ? [configured] : process.platform === "win32"
    ? [env["PROGRAMFILES(X86)"], env.PROGRAMFILES, env.LOCALAPPDATA].filter(Boolean).flatMap(root => [
      join(root!, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(root!, "Google", "Chrome", "Application", "chrome.exe"),
      join(root!, "Chromium", "Application", "chrome.exe"),
    ])
    : process.platform === "darwin"
      ? ["/Applications", join(homedir(), "Applications")].flatMap(root => [
        join(root, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
        join(root, "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
      ])
      : (process.env.PATH ?? "").split(delimiter).filter(Boolean).flatMap(root => ["google-chrome", "google-chrome-stable", "chromium", "microsoft-edge"].map(n => join(root, n)));
  for (const path of new Set(candidates)) {
    try { if (!(await stat(path)).isFile()) continue; await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK); return path; }
    catch { /* 试下一个 */ }
  }
  throw new Error("未找到 Chrome/Edge，请先安装浏览器");
}

let browser: Browser | null = null;
let pagePromise: Promise<Page> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function openPage(executablePath?: string): Promise<Page> {
  const exe = await findBrowser(executablePath);
  browser = await puppeteer.launch({
    executablePath: exe, headless: false, userDataDir: PROFILE,
    defaultViewport: { width: 1280, height: 860 },
    // 把窗口移出可视区域，避免打扰用户；网络请求不受影响。
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check", "--window-position=-32000,-32000"],
  });
  browser.once("disconnected", () => { browser = null; pagePromise = null; });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.evaluateOnNewDocument(HOOK);
  await page.goto(EDITOR, { waitUntil: "domcontentloaded", timeout: 60000 });
  await ensureAudioPanel(page);
  return page;
}

function getPage(executablePath?: string): Promise<Page> {
  if (!pagePromise) pagePromise = openPage(executablePath).catch(err => { pagePromise = null; throw err; });
  return pagePromise;
}

async function ensureAudioPanel(page: Page): Promise<void> {
  for (let i = 0; i < 25; i++) {
    const hasSearch = await page.$(SEARCH_INPUT);
    if (hasSearch) return;
    if (/\/login/.test(page.url())) throw new Error("CapCut 未登录或登录已过期，请重新运行 capcutLogin.ts 登录");
    await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ textContent: string | null; click(): void }> } }).document;
      const el = Array.from(doc.querySelectorAll('[role="menuitem"],button,div')).find(e => e.textContent?.trim() === "Audio");
      el?.click();
    });
    await sleep(800);
  }
  throw new Error("无法打开 CapCut 音乐面板");
}

/** 轮询页面内 HOOK 抓到的、关键词匹配的最新一页结果；ms 内没抓到返回 null。 */
async function waitResult(page: Page, keyword: string, ms: number): Promise<CapcutSearchResult | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await sleep(300);
    const res = await page.evaluate((kw: string) => {
      const r = (globalThis as unknown as { __ccResult?: { kw?: string } }).__ccResult;
      return r && r.kw === kw ? r : null;
    }, keyword);
    if (res) return res as unknown as CapcutSearchResult;
  }
  return null;
}

/** 单页最多约 30~40 首，这里在时间预算内滚动加载多页并合并去重。 */
const MAX_PAGES = 4;
const PAGE_BUDGET_MS = 20000; // 翻页总预算（首页之外），超时就返回已抓到的

async function doSearch(keyword: string, executablePath?: string): Promise<CapcutSearchResult> {
  let page = await getPage(executablePath);
  try { await ensureAudioPanel(page); }
  catch (e) {
    // 页面可能已失效，重启一次
    await browser?.close().catch(() => {}); browser = null; pagePromise = null;
    page = await getPage(executablePath); await ensureAudioPanel(page);
  }
  await page.evaluate(() => { (globalThis as unknown as { __ccResult?: unknown }).__ccResult = undefined; });
  await page.focus(SEARCH_INPUT).catch(() => {});
  await page.evaluate((sel: string) => { const i = (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document.querySelector(sel); if (i) i.value = ""; }, SEARCH_INPUT);
  await page.type(SEARCH_INPUT, keyword, { delay: 25 });
  await page.keyboard.press("Enter");

  // 第一页：拿不到才算真超时（报错）。
  const first = await waitResult(page, keyword, 15000);
  if (!first) throw new Error("音乐搜索超时，请稍后重试");

  const byId = new Map<string, CapcutSong>();
  for (const s of first.songs) byId.set(s.id, s);
  let cursor = first.cursor;
  let hasMore = first.hasMore;

  // 后续页：在预算内尽力抓，拿不到就停，绝不报错（已有首页结果可用）。
  const deadline = Date.now() + PAGE_BUDGET_MS;
  for (let pages = 1; hasMore && pages < MAX_PAGES && Date.now() < deadline; pages++) {
    await page.evaluate(() => { (globalThis as unknown as { __ccResult?: unknown }).__ccResult = undefined; });
    // 滚轮触发列表懒加载（窗口虽在屏外，视口坐标仍有效）。
    await page.mouse.move(220, 520).catch(() => {});
    await page.mouse.wheel({ deltaY: 4000 }).catch(() => {});
    const next = await waitResult(page, keyword, 6000);
    if (!next || !next.songs.length) break;
    for (const s of next.songs) byId.set(s.id, s);
    cursor = next.cursor;
    hasMore = next.hasMore;
  }

  return { songs: Array.from(byId.values()), hasMore, cursor };
}

/** 搜索 CapCut 音乐曲库（串行化，避免多请求互相干扰）。 */
export function searchMusic(keyword: string, executablePath?: string): Promise<CapcutSearchResult> {
  const run = queue.then(() => doSearch(keyword.trim(), executablePath));
  queue = run.then(() => {}, () => {});
  return run;
}

/** 音乐面板打开时自动加载的默认/推荐歌单（未搜索时的那一屏）。 */
async function doRecommend(executablePath?: string): Promise<CapcutSearchResult> {
  const page = await getPage(executablePath);
  await ensureAudioPanel(page);
  // 面板首次打开即触发默认歌单请求，HOOK 会写入 __ccRecommend；在这里等它出现。
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await sleep(300);
    const r = await page.evaluate(() => (globalThis as unknown as { __ccRecommend?: unknown }).__ccRecommend ?? null);
    if (r) return r as unknown as CapcutSearchResult;
  }
  return { songs: [], hasMore: false, cursor: 0 }; // 拿不到就空列表，前端回退到提示文案。
}

/** 推荐/默认歌单（串行化，与搜索共用同一浏览器）。 */
export function recommendMusic(executablePath?: string): Promise<CapcutSearchResult> {
  const run = queue.then(() => doRecommend(executablePath));
  queue = run.then(() => {}, () => {});
  return run;
}

/** 校验并代理下载音频/封面（避开浏览器 CORS，并限制在 CapCut 的 CDN 域）。 */
export function assertAllowedMediaUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("无效的 URL"); }
  if (url.protocol !== "https:") throw new Error("只允许 https");
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.some(suffix => host.endsWith(suffix))) throw new Error("不允许的下载域名");
  return url;
}

/** 关闭常驻浏览器（应用退出时调用）。 */
export async function closeCapcutMusic(): Promise<void> {
  const b = browser; browser = null; pagePromise = null;
  await b?.close().catch(() => {});
}
