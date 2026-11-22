import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeAtomic } from "@toonflow/file";

export const version = "0.36.0";
const toolDirectory = dirname(fileURLToPath(import.meta.url));
const resourceDirectory = join(toolDirectory, "pluginResources", "capcut");
const packageDirectory = join(resourceDirectory, "node_modules", "capcut-cli");
const cliPath = join(packageDirectory, "dist", "index.js");
const runtimePackage = { private: true, type: "module", dependencies: { "capcut-cli": version } };
const maxOutput = 64 * 1024;

type Editor = "CapCut" | "JianyingPro";

/**
 * 用户在 CapCut / 剪映「设置 → 草稿位置」改过的草稿目录：Windows 版存在 User Data\Config\globalSetting（Qt ini）的 currentCustomDraftPath。
 * 读不到或目录不存在时返回 null，沿用默认位置。
 */
function customDraftDir(editor: Editor, local: string) {
  try {
    const content = readFileSync(join(local, editor, "User Data/Config/globalSetting"), "utf8");
    let value = /^currentCustomDraftPath=(.*)$/m.exec(content)?.[1]?.trim();
    if (!value) return null;
    if (value.length > 1 && value.startsWith("\"") && value.endsWith("\"")) value = value.slice(1, -1);
    // Qt ini 转义：\\ 为反斜杠，\xHHHH 为非 ASCII 字符（如中文目录名）。
    value = value.replace(/\\x([0-9a-fA-F]{1,4})|\\(.)/g, (_match, hex: string | undefined, char: string | undefined) => hex ? String.fromCharCode(Number.parseInt(hex, 16)) : char!);
    return existsSync(value) && statSync(value).isDirectory() ? value : null;
  } catch { return null; }
}

/** 本机 CapCut / 剪映实际使用的草稿目录：CAPCUT_DRAFT_DIR 优先，其次软件设置里改过的位置，最后默认位置。 */
export function draftDirectories(): { editor: Editor | "custom"; path: string }[] {
  const override = process.env.CAPCUT_DRAFT_DIR?.trim();
  if (override) return existsSync(override) ? [{ editor: "custom", path: override }] : [];
  const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? homedir(), "AppData/Local");
  const editors: Editor[] = ["CapCut", "JianyingPro"];
  const candidates = platform() === "win32"
    ? editors.map(editor => ({ editor, path: customDraftDir(editor, local) ?? join(local, editor, "User Data/Projects/com.lveditor.draft") }))
    : platform() === "darwin" ? editors.map(editor => ({ editor, path: join(homedir(), "Movies", editor, "User Data/Projects/com.lveditor.draft") }))
    : [];
  return candidates.filter(item => existsSync(item.path));
}

export const draftRoots = () => draftDirectories().map(item => item.path);

async function installedVersion() {
  try { return JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8")).version as string; }
  catch { return null; }
}

let preparation: Promise<{ version: string; installed: boolean }> | undefined;

export function prepareCapcut(signal?: AbortSignal) {
  signal?.throwIfAborted();
  preparation ??= (async () => {
    if (await installedVersion() === version && existsSync(cliPath)) return { version, installed: false };
    await mkdir(resourceDirectory, { recursive: true });
    await writeAtomic(join(resourceDirectory, "package.json"), JSON.stringify(runtimePackage, null, 2));
    // 只装固定版本，不运行依赖的安装脚本；capcut-cli 本身没有运行时依赖。
    const child = Bun.spawn([process.execPath, "install", "--production", "--ignore-scripts", "--no-progress"], { cwd: resourceDirectory, stdout: "ignore", stderr: "pipe", windowsHide: true });
    const cancel = () => child.kill();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 180000);
    try {
      const errors = await new Response(child.stderr).text();
      if (await child.exited !== 0) throw new Error(`capcut-cli ${version} 安装失败，请检查网络后重试。${errors.slice(-1500)}`);
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
    if (await installedVersion() !== version || !existsSync(cliPath)) throw new Error(`capcut-cli ${version} 安装不完整，请重试 capcutPrepare`);
    return { version, installed: true };
  })().finally(() => { preparation = undefined; });
  return preparation;
}

/** 草稿文件夹名在草稿目录中查找；其他值（绝对路径、相对路径）原样交给 capcut-cli。 */
function resolveProject(project: string) {
  if (isAbsolute(project) || /[\\/]/.test(project)) return project;
  for (const root of draftRoots()) {
    const path = join(root, project);
    if (existsSync(path) && statSync(path).isDirectory()) return path;
  }
  return project;
}

/** Toonflow 自带的 FFmpeg（插件市场安装到数据目录 ffmpeg/<平台>/），加入 PATH 供 capcut-cli 读取媒体时长与尺寸。 */
function childEnv(jianying: boolean) {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" };
  // 用户在 CapCut / 剪映设置里改过草稿位置时，capcut-cli 只认默认位置；把实际目录通过它支持的 CAPCUT_DRAFT_DIR 传过去。
  if (!env.CAPCUT_DRAFT_DIR?.trim()) {
    const target = draftDirectories().find(item => item.editor === (jianying ? "JianyingPro" : "CapCut"));
    if (target) env.CAPCUT_DRAFT_DIR = target.path;
  }
  const bundled = join(dirname(toolDirectory), "ffmpeg", `${process.platform}-${process.arch}`);
  if (existsSync(join(bundled, process.platform === "win32" ? "ffprobe.exe" : "ffprobe"))) {
    const key = Object.keys(env).find(name => name.toLowerCase() === "path") ?? "PATH";
    env[key] = [bundled, env[key]].filter(Boolean).join(process.platform === "win32" ? ";" : ":");
  }
  return env;
}

const clip = (text: string) => text.length > maxOutput ? `${text.slice(0, maxOutput)}\n…（输出过长，已截断）` : text;

export async function runCapcut(request: { command: string; project?: string; args: (string | number | boolean)[]; input?: string; cwd?: string }, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (await installedVersion() !== version || !existsSync(cliPath)) throw new Error(`capcut-cli ${version} 尚未就绪，请先调用 capcutPrepare`);
  const project = request.project ? resolveProject(request.project) : undefined;
  const env = childEnv(request.args.includes("--jianying"));
  // projects 只认 --drafts，不读 CAPCUT_DRAFT_DIR：草稿位置改过时补上，列出的才是 CapCut 实际显示的草稿。
  const draftsFlag = request.command === "projects" && env.CAPCUT_DRAFT_DIR && !request.args.includes("--drafts") ? ["--drafts", env.CAPCUT_DRAFT_DIR] : [];
  const args = [cliPath, request.command, ...(project ? [project] : []), ...request.args.map(String), ...draftsFlag];
  // 优先用本机 Node（capcut-cli 的目标运行时），没有时用宿主 Bun。
  const runtime = Bun.which("node") ?? process.execPath;
  return await new Promise<{ ok: boolean; status: number | null; project?: string; stdout: string; stderr: string; json?: unknown }>((resolve, reject) => {
    const child = spawn(runtime, args, { cwd: request.cwd && existsSync(request.cwd) ? request.cwd : undefined, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { if (stdout.length <= maxOutput) stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { if (stderr.length <= maxOutput) stderr += chunk; });
    const cancel = () => child.kill();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 600000);
    child.on("error", error => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); reject(error); });
    child.on("close", status => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) return reject(signal.reason ?? new Error("已取消"));
      let json: unknown;
      try { if (stdout.trim()) json = JSON.parse(stdout); } catch { /* 部分命令输出纯文本 */ }
      resolve({ ok: status === 0, status, ...(project ? { project } : {}), stdout: clip(stdout), stderr: clip(stderr.trim()), ...(json !== undefined ? { json } : {}) });
    });
    child.stdin.end(request.input ?? "");
  });
}
