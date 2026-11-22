<template>
  <nodeSkeleton v-if="loading" loading :label="node.data.label || node.type" :handles="node.data.handles" :outputs="node.data.outputs" />
  <component v-else-if="component && !error && !runtimeError" :is="component" v-bind="$attrs" />
  <el-card v-else class="remoteNodeState failed" shadow="never" role="alert">
    <div class="stateHeader">
      <strong>{{ node.data.label || node.type }}</strong>
      <span class="stateLabel">error</span>
      <div class="stateActions nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop>
        <el-button :icon="IconRefresh" text :loading="reloading" title="重新加载节点" aria-label="重新加载节点" @click.stop="retry" />
        <el-button :icon="IconTrash" text title="移除节点" aria-label="移除节点" @click.stop="removeNodes(node.id)" />
      </div>
    </div>
    <p>{{ error || runtimeError || "远程节点未加载，请确认插件已安装并启用" }}</p>
  </el-card>
  <button
    v-if="!loading && hasMedia"
    type="button"
    class="nodeStar nodrag nopan"
    :class="{ starred: node.data.starred }"
    :title="node.data.starred ? '取消星标' : '星标：剪辑「从画布挑选」时优先列出'"
    :aria-label="node.data.starred ? '取消星标' : '星标'"
    :aria-pressed="!!node.data.starred"
    @pointerdown.stop @mousedown.stop @dblclick.stop
    @click.stop="updateNodeData(node.id, { starred: !node.data.starred })">
    <icon-star-filled v-if="node.data.starred" :size="14" />
    <icon-star v-else :size="14" />
  </button>
</template>

<script setup lang="ts">
import { computed, inject, onErrorCaptured, ref, watch, type Component } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElCard } from "element-plus";
import { IconRefresh, IconStar, IconStarFilled, IconTrash } from "@tabler/icons-vue";
import { nodeSkeleton, type NodeData } from "@toonflow/nodes-scaffold/runtime";
import { nodeMediaPaths } from "../nodeMedia";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ component?: Component | string; error?: string; loading?: boolean }>();
const { node } = useNode<NodeData & { starred?: boolean }>();
const { removeNodes, updateNodeData } = useVueFlow();
// 星标只对有视频或图片的节点显示；已标星的节点即使素材被清空也保留按钮，便于取消。
const hasMedia = computed(() => !!node.data.starred || nodeMediaPaths(node.data).size > 0);
const reload = inject<((type: string) => Promise<void>)>("reloadRemoteNode");
const runtimeError = ref("");
const reloading = ref(false);

onErrorCaptured(error => {
  runtimeError.value = error instanceof Error ? error.message : String(error);
  console.error(`远程节点 ${node.type} (${node.id}) 运行失败`, error);
  return false;
});
watch(() => props.component, () => { runtimeError.value = ""; });

async function retry() {
  if (!reload || reloading.value) return;
  reloading.value = true;
  try { await reload(node.type); }
  catch (error) { runtimeError.value = error instanceof Error ? error.message : String(error); }
  finally { reloading.value = false; }
}
</script>

<style scoped lang="scss">
.remoteNodeState {
  width: 320px;
  &.failed { border-color: var(--el-color-danger); }
  .stateHeader {
    display: flex;
    align-items: center;
    gap: 8px;
    strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .stateLabel { font-size: 12px; color: var(--el-text-color-secondary); }
    .stateActions {
      display: flex;
      .el-button { width: 28px; height: 28px; margin: 0; padding: 0; }
    }
  }
  &.failed .stateLabel { color: var(--el-color-danger); }
  p { margin: 10px 0 0; font-size: 12px; color: var(--el-text-color-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
}
</style>

<style lang="scss">
// 节点外框（.vue-flow__node）右上角的星标；未标星时悬停或选中才显示。
.vue-flow__node > .nodeStar {
  position: absolute;
  top: -11px;
  right: -11px;
  z-index: 5;
  display: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 50%;
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  box-shadow: var(--el-box-shadow-light);
  &:hover { color: var(--el-color-warning); }
  &.starred { display: flex; border-color: var(--el-color-warning); color: var(--el-color-warning); }
}
.vue-flow__node:hover > .nodeStar,
.vue-flow__node.selected > .nodeStar { display: flex; }
</style>
