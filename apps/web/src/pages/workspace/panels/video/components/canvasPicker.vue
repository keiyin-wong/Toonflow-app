<template>
  <el-dialog :modelValue="true" title="从画布挑选" width="min(760px, calc(100vw - 32px))" appendToBody @close="emit('close')">
    <div class="canvasPicker">
      <div class="pickerBar">
        <el-select :modelValue="canvasId" size="small" :disabled="!canvases?.length" :placeholder="canvases?.length === 0 ? translate('还没有画布') : translate('选择画布')" @change="value => (canvasId = value)">
          <el-option v-for="canvas in canvases ?? []" :key="canvas.id" :label="canvas.name" :value="canvas.id" />
        </el-select>
        <span class="pickerHint">按画布阅读顺序（从上到下、从左到右）列出视频与图片。</span>
      </div>
      <div class="takeGrid">
        <div v-if="canvases === null" class="pickerHint">正在读取…</div>
        <div v-else-if="canvasId && !takes.length" class="pickerHint">此画布没有视频或图片</div>
        <button v-for="take in takes" :key="`${take.nodeId}:${take.path}`" class="take" :title="`${take.path}\n${translate('点击：在源监视器打开')}`" @click="emit('pick', take.path)">
          <span class="takeThumb">
            <img v-if="thumbs[take.path]" :src="thumbs[take.path]!" alt="" />
            <icon-player-play-filled v-if="mediaKind(take.path) === 'video'" class="takeKind" :size="14" />
          </span>
          <span class="takeName">{{ take.label }}</span>
        </button>
      </div>
    </div>
    <template #footer>
      <span class="pickerHint">点击素材在源监视器中观看并标记入点（I）与出点（O），再插入（,）或覆盖（.）。</span>
      <el-button :disabled="!takes.length" @click="emit('addAll', takes.map(take => take.path))">全部添加到 V1 末尾（{{ takes.length }}）</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { readCanvasFiles } from "../../canvas/canvasFiles";
import type { Media } from "../media";
import { fileName, mediaKind } from "../timeline";

type Take = { nodeId: string; label: string; path: string; x: number; y: number };

/** 从画布挑选：列出画布节点引用的视频与图片，点击放入源监视器，或全部追加到 V1 末尾。 */
const emit = defineEmits<{ pick: [path: string]; addAll: [paths: string[]]; close: [] }>();
const media = inject<Media>("videoMedia")!;
const canvases = shallowRef<{ id: string; name: string; nodes: { id: string; position?: { x: number; y: number }; data?: Record<string, unknown> }[] }[] | null>(null);
const canvasId = ref(localStorage.getItem("toonflow:videoFromCanvas") ?? "");
const thumbs = reactive<Record<string, string | null>>({});

onMounted(async () => {
  try {
    const list = await readCanvasFiles(media.files, "", { onError: () => {} });
    canvases.value = list.map(canvas => ({ id: canvas.id, name: canvas.name, nodes: canvas.data.nodes as never }));
    if (!list.some(canvas => canvas.id === canvasId.value)) canvasId.value = list[0]?.id ?? "";
  } catch {
    canvases.value = [];
  }
});
watch(canvasId, value => { if (value) localStorage.setItem("toonflow:videoFromCanvas", value); });

/** 递归收集节点数据中指向工作区媒体文件的路径。 */
function mediaPaths(value: unknown, found: Set<string>, depth = 0) {
  if (depth > 6) return;
  if (typeof value === "string") {
    const path = value.replaceAll("\\", "/");
    if (!/^[a-z]+:/i.test(path) && !path.startsWith("/") && !path.includes("..") && mediaKind(path) && mediaKind(path) !== "audio") found.add(path);
  } else if (Array.isArray(value)) for (const item of value) mediaPaths(item, found, depth + 1);
  else if (value && typeof value === "object") for (const item of Object.values(value)) mediaPaths(item, found, depth + 1);
}

const takes = computed<Take[]>(() => {
  const canvas = canvases.value?.find(item => item.id === canvasId.value);
  if (!canvas) return [];
  const result: Take[] = [];
  for (const node of canvas.nodes) {
    const found = new Set<string>();
    mediaPaths(node.data, found);
    const label = typeof node.data?.label === "string" && node.data.label.trim() ? node.data.label : "";
    for (const path of found) result.push({ nodeId: node.id, label: label || fileName(path), path, x: node.position?.x ?? 0, y: node.position?.y ?? 0 });
  }
  // 阅读顺序：按行（约 80 像素一行）自上而下，行内自左向右。
  return result.sort((a, b) => Math.round(a.y / 80) - Math.round(b.y / 80) || a.x - b.x);
});

watch(takes, list => {
  for (const take of list) {
    if (take.path in thumbs) continue;
    thumbs[take.path] = null;
    void media.thumbOf(take.path).then(url => { thumbs[take.path] = url; });
  }
}, { immediate: true });
</script>

<style lang="scss">
.canvasPicker {
  .pickerBar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .pickerBar .el-select { width: 220px; }
  .takeGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; max-height: 56vh; overflow: auto; }
  .take { display: flex; flex-direction: column; gap: 4px; padding: 0; border: none; background: none; color: inherit; text-align: left; cursor: pointer; }
  .takeThumb { position: relative; display: block; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 6px; background: var(--el-fill-color); }
  .takeThumb img { width: 100%; height: 100%; object-fit: cover; }
  .takeKind { position: absolute; right: 6px; bottom: 6px; color: #fff; filter: drop-shadow(0 1px 2px #000); }
  .takeName { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
}

.pickerHint { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
