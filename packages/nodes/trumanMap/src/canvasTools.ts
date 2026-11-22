import { useNodeToolsContext, type NodeAiTool } from "@toonflow/nodes-scaffold/runtime";
import type { useVueFlow } from "@vue-flow/core";

// ACT: 内置 Agent 改画布上的其他节点（例如场景图片生成节点改提示词、重新生成）。宿主的“画布”工具插件要宿主画布桥，
// 临时对话接不上；本节点就在画布里，直接用同一个 Vue Flow 实例找节点、读数据、调用节点注册的函数（和宿主 nodeTools 同一张注册表）。
type Flow = ReturnType<typeof useVueFlow>;

const skipKeys = new Set(["promptModel", "handles", "history", "agentSessions"]);
/** 节点数据给模型看：去掉编辑器内部结构，长字符串截断，整体不超过约 2 万字。 */
function summarize(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > 6000 ? `${value.slice(0, 6000)}…（共 ${value.length} 字）` : value;
  if (!value || typeof value !== "object") return value;
  if (depth > 5) return "…";
  if (Array.isArray(value)) return [...value.slice(0, 30).map(item => summarize(item, depth + 1)), ...(value.length > 30 ? [`…（共 ${value.length} 项）`] : [])];
  return Object.fromEntries(Object.entries(value).filter(([key]) => !skipKeys.has(key)).map(([key, item]) => [key, summarize(item, depth + 1)]));
}

export function createCanvasTools(flow: Flow, selfId: string): NodeAiTool[] {
  const context = useNodeToolsContext(flow);
  const label = (node: { id: string; type?: string; data?: Record<string, unknown> }) => String(node.data?.label ?? node.type ?? node.id);
  const target = (id: unknown) => {
    const node = typeof id === "string" ? flow.findNode(id) : undefined;
    if (!node) throw new Error(`画布上没有节点 ${String(id)}，先用 canvasFind 查找`);
    return node;
  };
  return [
    {
      name: "canvasFind",
      description: "在本节点所在的画布上按名称或类型查找其他节点（图片生成、视频生成、文本节点等），返回 id、类型、名称和可调用的节点函数名。用户要求改画布上的图片、提示词、重新生成时先用它找到目标节点。",
      parameters: { type: "object", properties: { query: { type: "string", description: "名称里包含的文字，可留空" }, type: { type: "string", description: "节点类型里包含的文字，如 imageGeneration、videoGeneration、textNode，可留空" } }, additionalProperties: false },
      execute(args) {
        const query = String(args.query ?? "").trim().toLowerCase();
        const type = String(args.type ?? "").trim().toLowerCase();
        const nodes = flow.getNodes.value.filter(node => node.id !== selfId
          && (!query || label(node).toLowerCase().includes(query)) && (!type || String(node.type).toLowerCase().includes(type)));
        return {
          total: nodes.length,
          nodes: nodes.slice(0, 60).map(node => ({ id: node.id, type: node.type, label: label(node), functions: [...context().list([node.id])].map(tool => tool.name) })),
        };
      },
    },
    {
      name: "canvasRead",
      description: "读取画布上一个节点的数据（提示词、模型配置、生成结果的工作区相对路径等）。看图片时把结果里的图片路径交给 read 工具。",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      execute(args) {
        const node = target(args.id);
        const text = JSON.stringify({ id: node.id, type: node.type, label: label(node), data: summarize(node.data) });
        return text.length > 20000 ? `${text.slice(0, 20000)}…（已截断）` : text;
      },
    },
    {
      name: "canvasFunctions",
      description: "列出画布上某个节点注册的函数（如图片生成节点的 node:getConfig、node:setConfig、node:setPrompt、node:generateImage、node:getGenerationStatus），含说明和完整 parameters。调用前先查，不猜函数名和参数。",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      execute(args) {
        const node = target(args.id);
        return { id: node.id, label: label(node), functions: [...context().list([node.id])].map(({ name, description, parameters }) => ({ name, description, parameters })) };
      },
    },
    {
      name: "canvasCall",
      description: "调用画布上某个节点的函数，name 和 args 按 canvasFunctions 返回的原样填写。例：改提示词 node:setPrompt，再 node:generateImage 重新生成，之后用 node:getGenerationStatus 查结果。生成会用掉用户的额度，只在用户要求修改或重做时调用生成。",
      parameters: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, args: { type: "object" } }, required: ["id", "name"], additionalProperties: false },
      async execute(args, signal) {
        const node = target(args.id);
        if (node.id === selfId) throw new Error("本节点的场景请用世界工具修改，canvasCall 只操作画布上的其他节点");
        const name = String(args.name);
        const call = (name.startsWith("node:") ? name : `node:${name}`) as `node:${string}`;
        const result = await context().call({ nodeId: node.id, name: call, args: args.args && typeof args.args === "object" ? args.args as Record<string, unknown> : {} }, signal);
        return summarize(result);
      },
    },
  ];
}
