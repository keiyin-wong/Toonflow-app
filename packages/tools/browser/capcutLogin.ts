/**
 * 用 email+密码在持久 profile 里登录 CapCut；先 dump 登录页结构，再自动尝试，并长时间保持窗口开放供手动兜底。
 * 登录成功后跑一次音乐搜索验证签名。
 *   CAPCUT_EMAIL=... CAPCUT_PASS=... bun capcutLogin.ts
 */
import puppeteer, { type Page } from "puppeteer-core";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = join(homedir(), ".toonflow", "capcut-profile");
const LOG = join(import.meta.dirname, "capcutLogin.log");
const EMAIL = process.env.CAPCUT_EMAIL ?? "";
const PASS = process.env.CAPCUT_PASS ?? "";
const EDITOR = "https://www.capcut.com/editor?enter_from=new_homepage_tools&from_page=work_space&scenario=custom";

mkdirSync(PROFILE, { recursive: true });
writeFileSync(LOG, "");
const log = (...a: unknown[]) => {
  const line = `[${new Date().toISOString()}] ${a.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
  console.log(line); appendFileSync(LOG, line + "\n");
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const PROBE_INJECT = `(function(){ if(window.__probe)return; window.__probe={ret:null,songs:null,status:null,errmsg:null};
  var oo=XMLHttpRequest.prototype.open,os=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this.__u=String(u);return oo.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(b){var s=this;if(/music\\/search\\/songs/.test(s.__u||'')){s.addEventListener('load',function(){try{var j=JSON.parse(s.responseText);window.__probe.status=s.status;window.__probe.ret=j.ret;window.__probe.errmsg=j.errmsg;window.__probe.songs=(j.data&&j.data.songs)?j.data.songs.length:0;window.__probe.first=(j.data&&j.data.songs&&j.data.songs[0])?{title:j.data.songs[0].title,preview:j.data.songs[0].preview_url}:null;}catch(e){window.__probe.err=String(e);}});}return os.apply(this,arguments);};
})();`;

async function dumpStructure(page: Page, tag: string) {
  for (const f of page.frames()) {
    try {
      const info = await f.evaluate(() => {
        const inputs = [...document.querySelectorAll("input")].map(i => ({ type: i.type, name: i.name, ph: i.placeholder, id: i.id })).slice(0, 15);
        const btns = [...document.querySelectorAll('button,a,[role="button"]')].map(b => (b.textContent || "").trim()).filter(Boolean).slice(0, 30);
        return { inputs, btns };
      });
      if (info.inputs.length || info.btns.length) log(`DUMP[${tag}] frame=${f.url().slice(0, 80)} inputs=${JSON.stringify(info.inputs)} btns=${JSON.stringify(info.btns)}`);
    } catch { /* detached */ }
  }
}

async function loggedIn(page: Page): Promise<boolean> {
  try {
    const cookies = await page.cookies("https://www.capcut.com");
    const has = cookies.some(c => /sessionid|sid_tt|sid_guard|uid_tt|passport_auth/i.test(c.name) && c.value && c.value.length > 10 && !/^0+$/.test(c.value));
    const offLogin = !/\/login/.test(page.url());
    return has || (offLogin && /capcut\.com/.test(page.url()) && !/about:blank/.test(page.url()));
  } catch { return false; }
}

async function tryAutoLogin(page: Page) {
  // 若首屏没有邮箱输入框，先点 "Sign in with email" 之类
  const hasEmail = await page.$('input[type="email"], input[name="email"], input[placeholder*="mail" i]');
  if (!hasEmail) {
    const clicked = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button,a,div,span,[role="button"]')] as HTMLElement[];
      const el = els.find(e => { const t = (e.textContent || "").trim().toLowerCase(); return t === "sign in with email" || t === "continue with email" || t === "log in with email" || t === "use email" || t === "邮箱登录"; });
      if (el) { el.click(); return (el.textContent || "").trim(); }
      return null;
    });
    log("click email-option:", JSON.stringify(clicked));
    await sleep(2500);
  }
  const filled = await page.evaluate((email: string, pass: string) => {
    const em = document.querySelector('input[type="email"], input[name="email"], input[placeholder*="mail" i], input[placeholder*="邮箱"]') as HTMLInputElement | null;
    const pw = document.querySelector('input[type="password"], input[name="password"], input[placeholder*="assword" i], input[placeholder*="密码"]') as HTMLInputElement | null;
    const set = (el: HTMLInputElement | null, v: string) => { if (!el) return false; el.focus(); const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, "value"); d?.set?.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; };
    return { email: set(em, email), pass: set(pw, pass) };
  }, EMAIL, PASS);
  log("auto-filled:", JSON.stringify(filled));
  await sleep(600);
  if (filled.email) {
    const submitted = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button,[type="submit"]')] as HTMLButtonElement[];
      const el = btns.find(b => { const t = (b.textContent || "").trim().toLowerCase(); return (t === "sign in" || t === "log in" || t === "continue" || t === "登录") && !b.disabled; });
      if (el) { el.click(); return (el.textContent || "").trim(); }
      return null;
    });
    log("submit:", JSON.stringify(submitted));
  }
}

async function run() {
  if (!EMAIL || !PASS) { log("MISSING CAPCUT_EMAIL / CAPCUT_PASS"); return; }
  log("launching Edge headful, profile:", PROFILE, "email:", EMAIL);
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: false, userDataDir: PROFILE, defaultViewport: null, args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check", "--start-maximized"] });
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    await page.evaluateOnNewDocument(PROBE_INJECT);
    await page.bringToFront().catch(() => {});

    if (await loggedIn(page)) log("already logged in");
    else {
      log("goto login…");
      await page.goto("https://www.capcut.com/login?enter_from=web_home", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(e => log("goto warn", String(e)));
      await sleep(5000);
      await page.bringToFront().catch(() => {});
      await dumpStructure(page, "login");
      await tryAutoLogin(page).catch(e => log("autoLogin warn", String(e)));
      await sleep(2000);
      await dumpStructure(page, "after-fill");
      log(">>> 若未自动登录，请在这个 Edge 窗口手动完成登录（含验证码）。窗口会保持打开。");
    }

    const deadline = Date.now() + 10 * 60 * 1000;
    let ok = false;
    while (Date.now() < deadline) {
      await sleep(6000);
      if (await loggedIn(page)) { ok = true; log("### LOGIN OK url:", page.url()); break; }
    }
    if (!ok) { log("login not detected within timeout"); await dumpStructure(page, "timeout"); }
    else {
      log("verify: open editor + search music…");
      await page.goto(EDITOR, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(e => log("editor goto warn", String(e)));
      await sleep(6000);
      for (let i = 0; i < 40; i++) {
        await page.evaluate(() => { const el = [...document.querySelectorAll('[role="menuitem"],button,div')].find(e => e.textContent?.trim() === "Audio") as HTMLElement | undefined; el?.click(); });
        await sleep(1200);
        const hasSearch = await page.evaluate(() => !!document.querySelector('input[placeholder="Search music"]'));
        if (hasSearch) { await page.click('input[placeholder="Search music"]').catch(() => {}); await page.type('input[placeholder="Search music"]', "guitar chill", { delay: 40 }).catch(() => {}); await page.keyboard.press("Enter").catch(() => {}); await sleep(3500); }
        const probe = await page.evaluate(() => (window as unknown as { __probe?: unknown }).__probe ?? null);
        log("verify tick", i, "hasSearch:", hasSearch, "probe:", JSON.stringify(probe));
        if (probe && (probe as { ret?: unknown }).ret != null) { log("### MUSIC SEARCH RESULT:", JSON.stringify(probe)); break; }
      }
    }
    log("keeping browser open 60s for inspection…");
    await sleep(60000);
  } catch (e) { log("FATAL:", String(e)); }
  finally { await browser.close().catch(() => {}); log("closed."); }
}
run();
