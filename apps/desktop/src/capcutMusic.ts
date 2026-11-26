/**
 * 内嵌 CapCut 在线曲库（替代外部 puppeteer 浏览器）。
 *
 * 做法与 packages/tools/browser/src/capcutMusic.ts 相同——因为 CapCut 的音乐搜索接口受
 * ByteDance 风控签名保护、服务端无法复刻，所以仍要在真实页面里触发搜索并拦截其 XHR。
 * 区别是这里不再拉起外部 Edge/Chrome，而是用应用自己的 Electrobun webview：
 *   - 一个隐藏的 BrowserWindow 常驻加载 CapCut 编辑器（登录态随应用默认会话持久化）；
 *   - preload 在页面里装好 XHR 钩子 + 搜索驱动函数，结果通过 host-message 回传主进程；
 *   - 主进程用 executeJavascript 触发搜索/翻页，用事件收结果。
 * 首次使用需 login() 让用户在内嵌 webview 里登录一次 CapCut。
 */
import Electrobun, { BrowserWindow } from "electrobun/main";
import type { CapcutMusicController, CapcutSearchResult, CapcutSong } from "@toonflow/server/desktop";

const EDITOR = "https://www.capcut.com/editor?enter_from=new_homepage_tools&from_page=work_space&scenario=custom";
// 隐藏窗口仍给出正常尺寸，保证 CapCut 的 React 页面能正常布局；位置移出屏幕作为兜底。
const OFFSCREEN = { x: -32000, y: -32000, width: 1280, height: 860 };
const LOGIN_POS = { x: 120, y: 120 };

type Incoming =
  | { __capcut: true; kind: "result"; kw: string; data: CapcutSearchResult; error?: string }
  | { __capcut: true; kind: "recommend"; data: CapcutSearchResult; error?: string }
  | { __capcut: true; kind: "status"; hasSearch: boolean; loggedIn: boolean; url: string };

// 注入到 CapCut 页面（document-start）：钩 XHR、驱动搜索、把结果 postMessage 回宿主。
// 注意：此字符串会作为模板字面量，内部禁止出现反引号与 ${}；正则一律用 new RegExp 以免转义坑。
const PRELOAD = `
(function(){
  if (window.__ccHook) return;
  window.__ccHook = true;
  var SEARCH_INPUT = 'input[placeholder="Search music"]';
  var pending = [];
  function flush(){
    if (!(window.__electrobun && typeof window.__electrobun.postMessage === 'function')) return;
    while (pending.length) {
      try { window.__electrobun.postMessage(pending[0]); } catch(e){ return; }
      pending.shift();
    }
  }
  function post(obj){ obj.__capcut = true; pending.push(JSON.stringify(obj)); flush(); }
  setInterval(flush, 400);

  function mapData(d){
    return { cursor: d.new_cursor, hasMore: !!d.has_more,
      songs: (d.songs || []).map(function(x){ return {
        id: String(x.id), title: x.title, author: x.author, duration: x.duration,
        coverUrl: (x.cover_url && (x.cover_url.medium || x.cover_url.thumb || x.cover_url.large)) || '',
        previewUrl: x.preview_url || '', paidType: x.paid_type || '' }; }) };
  }

  var isMusic = new RegExp('/music/');
  var isLogin = new RegExp('/login');
  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u){ this.__u = String(u); return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(b){
    var s = this;
    if (isMusic.test(s.__u || '')) {
      try { s.__kw = (JSON.parse(b) || {}).keyword || ''; } catch(e){ s.__kw = ''; }
      s.addEventListener('load', function(){
        try {
          var j = JSON.parse(s.responseText);
          if (j && j.ret === '0' && j.data) {
            var r = mapData(j.data);
            if (s.__kw) post({ kind: 'result', kw: s.__kw, data: r });
            else if (j.data.songs) post({ kind: 'recommend', data: r });
          } else if (s.__kw) {
            post({ kind: 'result', kw: s.__kw, data: { songs: [], cursor: 0, hasMore: false } });
          }
        } catch(e){
          if (s.__kw) post({ kind: 'result', kw: s.__kw, data: { songs: [], cursor: 0, hasMore: false } });
        }
      });
    }
    return os.apply(this, arguments);
  };

  function qs(sel){ return document.querySelector(sel); }
  function clickAudio(){
    var els = Array.prototype.slice.call(document.querySelectorAll('[role="menuitem"],button,div'));
    for (var i = 0; i < els.length; i++) {
      if ((els[i].textContent || '').trim() === 'Audio') { els[i].click(); return; }
    }
  }
  function loggedIn(){ return !isLogin.test(location.pathname) && !!qs(SEARCH_INPUT); }
  window.__capcutStatus = function(){ post({ kind: 'status', hasSearch: !!qs(SEARCH_INPUT), loggedIn: loggedIn(), url: location.href }); };
  setInterval(function(){ try { window.__capcutStatus(); } catch(e){} }, 1000);

  window.__capcutEnsurePanel = function(){
    var tries = 0;
    return new Promise(function(resolve, reject){
      (function step(){
        if (isLogin.test(location.pathname)) { reject(new Error('not-logged-in')); return; }
        if (qs(SEARCH_INPUT)) { resolve(); return; }
        if (tries++ > 40) { reject(new Error('no-panel')); return; }
        clickAudio();
        setTimeout(step, 500);
      })();
    });
  };

  window.__capcutSearch = function(kw){
    window.__capcutEnsurePanel().then(function(){
      var input = qs(SEARCH_INPUT);
      if (!input) return;
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(input, kw); input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }).catch(function(e){ post({ kind: 'result', kw: kw, data: { songs: [], cursor: 0, hasMore: false }, error: String((e && e.message) || e) }); });
  };

  window.__capcutMore = function(){
    var node = qs(SEARCH_INPUT);
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 20) { node.scrollTop = node.scrollHeight; return; }
      node = node.parentElement;
    }
    window.scrollTo(0, document.body.scrollHeight);
  };

  window.__capcutRecommend = function(){
    window.__capcutEnsurePanel().catch(function(e){ post({ kind: 'recommend', data: { songs: [], cursor: 0, hasMore: false }, error: String((e && e.message) || e) }); });
  };
})();
`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const MAX_PAGES = 4;
const PAGE_BUDGET_MS = 20000;

export function createCapcutMusic(): CapcutMusicController {
  let win: BrowserWindow | null = null;
  let viewId: number | null = null;
  const listeners = new Set<(m: Incoming) => void>();
  let lastStatus = { hasSearch: false, loggedIn: false };
  let queue: Promise<unknown> = Promise.resolve();
  let warmed = false;

  function ensureWindow() {
    if (win) return;
    win = new BrowserWindow({
      title: "CapCut Music",
      url: EDITOR,
      hidden: true,
      frame: OFFSCREEN,
      navigationRules: JSON.stringify(["^https://*"]),
      preload: PRELOAD,
    });
    viewId = win.webview.id;
    win.setPosition(OFFSCREEN.x, OFFSCREEN.y);
    Electrobun.events.on(`host-message-${viewId}`, (event: { data: { detail: unknown } }) => {
      let detail = event.data.detail;
      if (typeof detail === "string") { try { detail = JSON.parse(detail); } catch { return; } }
      if (!detail || typeof detail !== "object" || (detail as { __capcut?: unknown }).__capcut !== true) return;
      const msg = detail as Incoming;
      if (msg.kind === "status") lastStatus = { hasSearch: msg.hasSearch, loggedIn: msg.loggedIn };
      for (const listener of [...listeners]) listener(msg);
    });
  }

  function exec(js: string) { ensureWindow(); win!.webview.executeJavascript(js); }

  /** 订阅回传消息，直到 match 返回非 undefined 或超时（返回 null）。 */
  function waitFor<T>(match: (m: Incoming) => T | undefined, ms: number): Promise<T | null> {
    return new Promise(resolve => {
      let done = false;
      const finish = (value: T | null) => { if (done) return; done = true; listeners.delete(handler); clearTimeout(timer); resolve(value); };
      const handler = (m: Incoming) => { const value = match(m); if (value !== undefined) finish(value); };
      const timer = setTimeout(() => finish(null), ms);
      listeners.add(handler);
    });
  }

  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.then(() => {}, () => {});
    return run;
  }

  /** 首次驱动前等页面真正加载（preload 加载后每秒汇报一次 status），避免 executeJavascript 落空。 */
  async function warmup() {
    ensureWindow();
    if (warmed) return;
    const seen = await waitFor(m => (m.kind === "status" ? true : undefined), 25000);
    if (seen) warmed = true;
  }

  async function doSearch(keyword: string): Promise<CapcutSearchResult> {
    await warmup();
    exec(`window.__capcutSearch(${JSON.stringify(keyword)})`);
    // 第一页：拿不到才算真超时（报错）。
    const first = await waitFor(m => (m.kind === "result" && m.kw === keyword ? m.data : undefined), 15000);
    if (!first) {
      if (!lastStatus.loggedIn) throw new Error("CapCut 曲库未登录，请先在音乐面板点「登录曲库」登录一次");
      throw new Error("音乐搜索超时，请稍后重试");
    }
    const byId = new Map<string, CapcutSong>();
    for (const song of first.songs) byId.set(song.id, song);
    let hasMore = first.hasMore;
    let cursor = first.cursor;
    // 后续页：预算内尽力翻，拿不到就停，不报错（已有首页可用）。
    const deadline = Date.now() + PAGE_BUDGET_MS;
    for (let pages = 1; hasMore && pages < MAX_PAGES && Date.now() < deadline; pages++) {
      exec("window.__capcutMore && window.__capcutMore()");
      const next = await waitFor(m => (m.kind === "result" && m.kw === keyword ? m.data : undefined), 6000);
      if (!next || !next.songs.length) break;
      for (const song of next.songs) byId.set(song.id, song);
      hasMore = next.hasMore;
      cursor = next.cursor;
    }
    return { songs: [...byId.values()], hasMore, cursor };
  }

  async function doRecommend(): Promise<CapcutSearchResult> {
    await warmup();
    exec("window.__capcutRecommend && window.__capcutRecommend()");
    const result = await waitFor(m => (m.kind === "recommend" ? m.data : undefined), 12000);
    return result ?? { songs: [], hasMore: false, cursor: 0 };
  }

  return {
    search: keyword => serialize(() => doSearch(keyword.trim())),
    recommend: () => serialize(doRecommend),
    async loggedIn() {
      ensureWindow();
      exec("window.__capcutStatus && window.__capcutStatus()");
      const status = await waitFor(m => (m.kind === "status" ? m : undefined), 4000);
      return status ? status.loggedIn : lastStatus.loggedIn;
    },
    async login() {
      ensureWindow();
      win!.webview.loadURL(EDITOR);
      win!.setPosition(LOGIN_POS.x, LOGIN_POS.y);
      win!.show();
      win!.focus();
      // 等用户在内嵌 webview 里登录到曲库可用为止（最长 5 分钟）。
      const ok = await waitFor(m => (m.kind === "status" && m.loggedIn ? true : undefined), 300000);
      await sleep(300);
      win!.hide();
      win!.setPosition(OFFSCREEN.x, OFFSCREEN.y);
      if (!ok) throw new Error("CapCut 登录未完成");
    },
  };
}
