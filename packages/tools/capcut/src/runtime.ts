import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
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

/** 本机存在的 CapCut / 剪映草稿目录（与 capcut-cli 的默认查找顺序一致）。 */
export function draftRoots(): string[] {
  const override = process.env.CAPCUT_DRAFT_DIR?.trim();
  const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? homedir(), "AppData/Local");
  const candidates = override ? [override]
    : platform() === "win32" ? [join(local, "CapCut/User Data/Projects/com.lveditor.draft"), join(local, "JianyingPro/User Data/Projects/com.lveditor.draft")]
    : platform() === "darwin" ? [join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft"), join(homedir(), "Movies/JianyingPro/User Data/Projects/com.lveditor.draft")]
    : [];
  return candidates.filter(path => existsSync(path));
}

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
function childEnv() {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" };
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
  const args = [cliPath, request.command, ...(project ? [project] : []), ...request.args.map(String)];
  // 优先用本机 Node（capcut-cli 的目标运行时），没有时用宿主 Bun。
  const runtime = Bun.which("node") ?? process.execPath;
  return await new Promise<{ ok: boolean; status: number | null; project?: string; stdout: string; stderr: string; json?: unknown }>((resolve, reject) => {
    const child = spawn(runtime, args, { cwd: request.cwd && existsSync(request.cwd) ? request.cwd : undefined, env: childEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
