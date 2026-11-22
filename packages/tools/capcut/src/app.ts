import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Running = { Id: number; Name: string; Path: string | null; Window: number };

// capcut-cli 中写入草稿的命令（命令契约里标记为会修改的命令）。写入时 CapCut 必须关闭，否则它退出时会用内存里的旧状态覆盖草稿与草稿列表。
const writingCommands = new Set(["set-text", "shift", "shift-all", "speed", "volume", "trim", "opacity", "import-timeline", "add-audio", "add-video", "add-text", "tts", "crop", "cut", "duplicate", "remove", "keyframe", "transition", "mask", "bg-blur", "text-style", "restyle", "text-anim", "image-anim", "add-sticker", "mix-mode", "audio-fade", "add-cover", "add-filter", "bubble-text", "add-effect", "apply-template", "batch", "import-srt", "import-ass", "text-ranges", "caption", "migrate", "add-sfx", "chroma", "matting", "prune", "register", "rename", "relink", "replace-media", "concat", "sync-timelines", "restore", "export", "init", "quickstart", "compile"]);

export function writesDrafts(command: string, args: (string | number | boolean)[]) {
  return writingCommands.has(command) && !args.some(arg => typeof arg === "string" && /^--(check|plan|dry-run)$/.test(arg));
}

function powershell(script: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `PowerShell 退出码 ${code}`)));
  });
}

async function running(): Promise<Running[]> {
  const output = await powershell("@(Get-Process -Name CapCut,JianyingPro -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Id = $_.Id; Name = $_.Name; Path = $_.Path; Window = [int64]$_.MainWindowHandle } }) | ConvertTo-Json -Compress");
  if (!output.trim()) return [];
  const parsed = JSON.parse(output) as Running | Running[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 启动器（Apps\CapCut.exe）会选择已安装的最新版本；找不到时用关闭前主进程的路径。 */
function launcherFor(app: Running) {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local");
  const launcher = app.Name.toLowerCase() === "jianyingpro" ? join(local, "JianyingPro/Apps/JianyingPro.exe") : join(local, "CapCut/Apps/CapCut.exe");
  return existsSync(launcher) ? launcher : app.Path;
}

/**
 * 关闭正在运行的 CapCut / 剪映（与点窗口的关闭按钮相同，CapCut 会自行保存），返回关闭前的主程序以便之后重新打开。
 * 20 秒内没有退出（例如弹出了确认框）就报错，不强制结束进程，以免丢失用户的编辑。
 */
export async function closeEditor(signal?: AbortSignal): Promise<{ name: string; launcher: string | null } | null> {
  if (process.platform !== "win32") return null;
  const apps = await running();
  if (!apps.length) return null;
  const main = apps.find(app => app.Window !== 0) ?? apps[0]!;
  const windows = apps.filter(app => app.Window !== 0).map(app => app.Id);
  if (windows.length) await powershell(`${windows.map(id => `$null = (Get-Process -Id ${id} -ErrorAction SilentlyContinue).CloseMainWindow()`).join("; ")}`);
  for (let waited = 0; waited < 20000; waited += 500) {
    signal?.throwIfAborted();
    await sleep(500);
    if (!(await running()).length) {
      // 进程退出后稍等，让 CapCut 写完草稿列表。
      await sleep(1000);
      return { name: main.Name, launcher: launcherFor(main) };
    }
  }
  throw new Error(`${main.Name} 没有在 20 秒内自动关闭（可能弹出了确认框或正在导出）。请手动关闭 ${main.Name} 后重试；未写入任何草稿。`);
}

export function reopenEditor(closed: { launcher: string | null }) {
  if (!closed.launcher) return false;
  const child = spawn(closed.launcher, [], { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", () => {});
  child.unref();
  return true;
}
