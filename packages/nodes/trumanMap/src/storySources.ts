// 剧情资料：白模预演的 Agent 自己到画布文本节点、工作区剧本文件里找剧本，不用用户每次复制或连线。
import { z, type NodeAiTool, type WorkspaceFiles } from "@toonflow/nodes-scaffold/runtime";

export type StoryWorkspace = { name: string; files: WorkspaceFiles };
/** 当前画布上的文本节点（未保存的修改也在里面）。 */
export type LiveTextNode = { id: string; label: string; text: string };
type StoryItem = { ref: string; workspace: string; kind: "node" | "file"; label: string; canvas?: string; load(): Promise<string> };

const textFile = /\.(md|markdown|txt|fountain|srt)$/i;
const skippedDirectory = /^(assets|exports|node_modules|\.)/;
const readLimit = 6000;
const previewLength = 80;

const input = z.strictObject({
  action: z.enum(["list", "read", "search"]).describe("list 列出可读的剧本来源；read 读一份（ref）；search 按关键词在所有来源里找"),
  workspace: z.string().max(200).optional().describe("只看这个项目（list 返回的 workspace 名称）"),
  ref: z.string().max(4096).optional().describe("read 用：list/search 返回的 ref，原样传入"),
  query: z.string().max(200).optional().describe("search 用：角色名、场次、台词片段等"),
  offset: z.number().int().min(0).default(0).describe("read 续读：上一次返回的 nextOffset"),
});

const preview = (text: string) => {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > previewLength ? `${value.slice(0, previewLength)}…` : value;
};

async function listCanvasTexts(workspace: StoryWorkspace, index: number, liveCanvas: string | undefined, live: LiveTextNode[]): Promise<StoryItem[]> {
  const { entries } = await workspace.files.list();
  const items: StoryItem[] = [];
  for (const entry of entries) {
    if (entry.type !== "file" || !/\.json$/i.test(entry.name)) continue;
    if (entry.path === liveCanvas) {
      for (const node of live) items.push({ ref: `${index}:node:${entry.path}#${node.id}`, workspace: workspace.name, kind: "node", label: node.label, canvas: entry.path, load: async () => node.text });
      continue;
    }
    const canvas = await workspace.files.readJson<{ toonflowCanvas?: boolean; nodes?: { id?: string; type?: string; data?: Record<string, unknown> }[] }>(entry.path).catch(() => undefined);
    if (!canvas?.toonflowCanvas || !Array.isArray(canvas.nodes)) continue;
    for (const node of canvas.nodes) {
      if (node.type !== "remote-textNode" || typeof node.id !== "string" || !node.data) continue;
      const data = node.data as { label?: unknown; textPath?: unknown; textSnapshot?: unknown; outputs?: { text?: { value?: unknown } } };
      const inline = typeof data.textSnapshot === "string" ? data.textSnapshot : typeof data.outputs?.text?.value === "string" ? data.outputs.text.value : "";
      const path = typeof data.textPath === "string" ? data.textPath : "";
      items.push({
        ref: `${index}:node:${entry.path}#${node.id}`, workspace: workspace.name, kind: "node", label: typeof data.label === "string" ? data.label : "文本", canvas: entry.path,
        load: async () => (path ? await workspace.files.readText(path).catch(() => inline) : inline),
      });
    }
  }
  return items;
}

async function listTextFiles(workspace: StoryWorkspace, index: number): Promise<StoryItem[]> {
  const items: StoryItem[] = [];
  const visit = async (path: string, depth: number) => {
    const { entries } = await workspace.files.list(path).catch(() => ({ entries: [] as Awaited<ReturnType<WorkspaceFiles["list"]>>["entries"] }));
    for (const entry of entries) {
      if (entry.type === "directory" && depth < 2 && !skippedDirectory.test(entry.name)) await visit(entry.path, depth + 1);
      if (entry.type === "file" && textFile.test(entry.name) && !/^(AGENTS|README)\.md$/i.test(entry.name)) {
        items.push({ ref: `${index}:file:${entry.path}`, workspace: workspace.name, kind: "file", label: entry.path, load: () => workspace.files.readText(entry.path) });
      }
    }
  };
  await visit("", 0);
  return items;
}

export function createStoryTools(options: { workspaces: () => StoryWorkspace[]; liveCanvas?: () => string | undefined; liveNodes?: () => LiveTextNode[] }): NodeAiTool[] {
  async function collect(workspaceName: string | undefined, signal?: AbortSignal) {
    const workspaces = options.workspaces();
    const items: StoryItem[] = [];
    for (const [index, workspace] of workspaces.entries()) {
      if (workspaceName && workspace.name !== workspaceName) continue;
      signal?.throwIfAborted();
      const live = index === 0 ? options.liveNodes?.() ?? [] : [];
      items.push(...await listCanvasTexts(workspace, index, index === 0 ? options.liveCanvas?.() : undefined, live).catch(() => []));
      items.push(...await listTextFiles(workspace, index));
    }
    return { items, workspaces: workspaces.map(item => item.name) };
  }
  return [{
    name: "readStory",
    description: "读取剧情资料：画布上的文本节点（剧本、分场、对白、人物小传）和项目里的剧本文件（.md/.txt/.fountain/.srt）。用户提到剧本、某一场、某个角色的台词，或要“按剧本”搭景、排戏、分镜，而本轮消息里没有附剧本时，先 list（或 search 关键词）找到来源，再 read 读全文；读到的对白原样用于 stageShots 的 auto.script。只读，不修改任何文件。",
    parameters: z.toJSONSchema(input, { io: "input" }),
    async execute(raw, signal) {
      const args = input.parse(raw);
      if (args.action === "read") {
        if (!args.ref) throw new Error("read 需要 list 或 search 返回的 ref");
        const workspaceIndex = Number(args.ref.split(":")[0]);
        const { items } = await collect(options.workspaces()[workspaceIndex]?.name, signal);
        const item = items.find(entry => entry.ref === args.ref);
        if (!item) throw new Error("没有这个来源，请重新 list");
        const text = await item.load();
        const chunk = text.slice(args.offset, args.offset + readLimit);
        const nextOffset = args.offset + chunk.length;
        return { ref: item.ref, label: item.label, ...(item.canvas && { canvas: item.canvas }), total: text.length, text: chunk, ...(nextOffset < text.length && { nextOffset }) };
      }
      const { items, workspaces } = await collect(args.workspace, signal);
      if (args.action === "list") {
        const listed = [];
        for (const item of items.slice(0, 200)) {
          const text = await item.load().catch(() => "");
          if (!text.trim()) continue;
          listed.push({ ref: item.ref, workspace: item.workspace, kind: item.kind, label: item.label, ...(item.canvas && { canvas: item.canvas }), chars: text.length, preview: preview(text) });
        }
        return { workspaces, sources: listed, ...(items.length > 200 && { note: "来源太多，只列了前 200 个；用 workspace 或 search 缩小范围" }) };
      }
      const query = args.query?.trim();
      if (!query) throw new Error("search 需要 query");
      const hits = [];
      for (const item of items.slice(0, 400)) {
        signal?.throwIfAborted();
        const text = await item.load().catch(() => "");
        const at = text.indexOf(query);
        if (at < 0 && !item.label.includes(query)) continue;
        const from = Math.max(0, at - 60);
        hits.push({ ref: item.ref, workspace: item.workspace, label: item.label, ...(item.canvas && { canvas: item.canvas }), chars: text.length, snippet: at < 0 ? preview(text) : text.slice(from, at + query.length + 120).replace(/\s+/g, " "), ...(at >= 0 && { offset: from }) });
        if (hits.length >= 30) break;
      }
      return { workspaces, hits };
    },
  }];
}
