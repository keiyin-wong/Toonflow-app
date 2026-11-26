import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { existsSync } from "@toonflow/file";
import { PATHS } from "electrobun/main";

// ACT: 本机构建可附带 Claude 订阅代理（claude-sub-proxy.exe，见 build.ts）；端口空闲时随应用启动，退出时关闭。
// 已有代理在运行（例如手动双击启动的）则不重复启动，也不去关它。没有附带代理的构建什么都不做。
const PROXY_PORT = 3470;

function portInUse(port: number) {
  return new Promise<boolean>(done => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); done(true); });
    socket.once("error", () => done(false));
  });
}

/** 启动附带的代理，返回关闭它的函数。 */
export default async function startSubProxy(dataDirectory: string): Promise<() => void> {
  const executable = resolve(PATHS.RESOURCES_FOLDER, "app/claude-sub-proxy.exe");
  if (process.platform !== "win32" || !existsSync(executable) || await portInUse(PROXY_PORT)) return () => {};
  const child = spawn(executable, [], {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, CLAUDE_PROXY_PORT: String(PROXY_PORT), CLAUDE_PROXY_HOME: resolve(dataDirectory, "claudeSubProxy") },
  });
  child.on("error", error => console.error("Claude 订阅代理启动失败：", error));
  return () => { if (child.exitCode === null && !child.killed) child.kill(); };
}
