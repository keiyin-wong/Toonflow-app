// 剪辑工程以 JSON 文件保存在工作区中，根对象首字段为标记 `toonflowVideo`。快照保存在工作目录的隐藏文件夹。

import axios from "axios";
import type useWorkspaceFiles from "@/lib/workspaceFiles";
import type { TextSnapshot } from "@/lib/workspaceFiles";
import type { VideoDoc } from "./types";
import { docLength, newDoc, normalizeDoc, uid } from "./videoModel";
import { videoFolders } from "./media";

type Files = ReturnType<typeof useWorkspaceFiles>;
export type VideoProjectEntry = { path: string; name: string };
export type VideoSnapshot = { id: string; name: string; createdAt: number; clips: number; length: number; doc: VideoDoc };

const skippedFolders = new Set(["assets", ".agent", videoFolders.exports, videoFolders.work.toLowerCase()]);

export const serializeVideo = (doc: VideoDoc) => `${JSON.stringify({ toonflowVideo: true, ...doc }, null, 2)}\n`;

/** 读取文件头判断是否为剪辑工程。 */
async function isVideoFile(files: Files, path: string, signal?: AbortSignal) {
  try {
    const header = await files.readText(path, 4096, signal);
    if (/^\s*\{\s*"toonflowVideo"\s*:\s*true\s*[,}]/.test(header)) return true;
    if (!/^\s*\{/.test(header) || !header.includes("\"toonflowVideo\"")) return false;
    return JSON.parse(await files.readText(path, undefined, signal))?.toonflowVideo === true;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof SyntaxError) return false;
    // ACT: 扫描期间已消失或不可读的条目跳过，其他错误继续抛出。
    if (axios.isAxiosError(error) && [400, 404, 415].includes(error.response?.status ?? 0)) return false;
    throw error;
  }
}

/** 列出工作区中的剪辑工程（跳过素材、导出与隐藏目录）。 */
export async function listVideoProjects(files: Files, signal?: AbortSignal) {
  const projects: VideoProjectEntry[] = [];
  const folders = [""];
  for (const folder of folders) {
    const { entries } = await files.list(folder, signal);
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (entry.type === "directory") {
        if (!skippedFolders.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")) folders.push(entry.path);
      } else if (/\.json$/i.test(entry.name) && await isVideoFile(files, entry.path, signal)) {
        projects.push({ path: entry.path, name: entry.name.slice(0, -5) });
      }
    }
  }
  return projects.sort((a, b) => a.path.localeCompare(b.path));
}

/** 读取工程，返回规范化的时间线与版本号（用于保存时检测外部修改）。 */
export async function readVideoProject(files: Files, path: string) {
  const snapshot = await files.readTextSnapshot(path);
  const data = JSON.parse(snapshot.text);
  if (data?.toonflowVideo !== true) throw new Error("剪辑工程文件格式无效");
  return { doc: normalizeDoc(data), snapshot };
}

/** 新建工程文件（不覆盖已有文件），重名时追加序号；返回路径。 */
export async function createVideoProject(files: Files, name: string, doc = newDoc()) {
  for (let index = 0; index < 1000; index++) {
    const path = `${index ? `${name} (${index})` : name}.json`;
    try {
      await files.write(path, serializeVideo(doc), true);
      return path;
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 409) throw error;
    }
  }
  throw new Error("同名工程过多，请换一个名称");
}

/** 按版本号覆盖保存；文件被外部修改时抛出 409。 */
export function saveVideoProject(files: Files, path: string, doc: VideoDoc, snapshot: Pick<TextSnapshot, "revision" | "encoding">) {
  return files.writeTextSnapshot(path, serializeVideo(doc), snapshot);
}

const snapshotPath = (project: string) => {
  let hash = 2166136261;
  for (const char of project) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${videoFolders.work}/snapshots/${(hash >>> 0).toString(36)}.json`;
};

/** 工程的快照列表，最新的在前。 */
export async function readSnapshots(files: Files, project: string): Promise<VideoSnapshot[]> {
  try {
    const list = await files.readJson<VideoSnapshot[]>(snapshotPath(project));
    return Array.isArray(list) ? list.map(item => ({ ...item, doc: normalizeDoc(item.doc) })) : [];
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return [];
    throw error;
  }
}

export async function writeSnapshots(files: Files, project: string, list: VideoSnapshot[], ensureDirectory: (path: string) => Promise<void>) {
  await ensureDirectory(`${videoFolders.work}/snapshots`);
  await files.writeJson(snapshotPath(project), list);
}

export const makeSnapshot = (name: string, doc: VideoDoc): VideoSnapshot => ({ id: uid(), name, createdAt: Date.now(), clips: doc.clips.length, length: docLength(doc), doc });
