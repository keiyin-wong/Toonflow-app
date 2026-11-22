import { mediaKind } from "../video/timeline";

/** 节点数据中指向工作区视频与图片的相对路径（剪辑「从画布挑选」与节点星标共用）。 */
export function nodeMediaPaths(data: unknown): Set<string> {
  const found = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6) return;
    if (typeof value === "string") {
      const path = value.replaceAll("\\", "/");
      const kind = mediaKind(path);
      if (kind && kind !== "audio" && !/^[a-z]+:/i.test(path) && !path.startsWith("/") && !path.includes("..")) found.add(path);
    } else if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
    else if (value && typeof value === "object") for (const item of Object.values(value)) visit(item, depth + 1);
  };
  visit(data, 0);
  return found;
}
