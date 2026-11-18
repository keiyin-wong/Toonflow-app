<template>
  <div class="mediaGrid">
    <div class="mediaBar">
      <button class="crumb" :class="{ on: showFavorites }" title="收藏的文件与文件夹" @click="showFavorites = !showFavorites">
        <component :is="showFavorites ? IconStarFilled : IconStar" :size="13" /> 收藏<span v-if="favorites.length" class="count">{{ favorites.length }}</span>
      </button>
      <button v-if="!showFavorites && path" class="crumb" title="返回上一级" @click="path = parent"><icon-chevron-left :size="14" /> {{ path }}</button>
      <span class="spacer" />
      <button class="crumb" title="刷新" @click="reload"><icon-refresh :size="13" /></button>
    </div>
    <div v-if="showFavorites && !favorites.length" class="mediaHint">还没有收藏：点击缩略图上的 ☆ 收藏文件或文件夹。</div>
    <div v-else-if="!shown" class="mediaHint">正在读取…</div>
    <div v-else-if="!shown.length" class="mediaHint">{{ kind === "audio" ? translate("此文件夹没有音频") : translate("此文件夹没有视频、图片或音频") }}</div>
    <div v-else class="thumbGrid">
      <template v-for="entry in shown" :key="entry.path">
        <div v-if="entry.type === 'directory'" class="thumb folder" role="button" tabindex="0" :title="entry.path" @click="openFolder(entry.path)" @keydown.enter="openFolder(entry.path)">
          <span class="thumbPicture"><icon-folder :size="30" stroke="1.4" /><button class="thumbStar" :class="{ on: isFavorite(entry) }" @click.stop="toggleFavorite(entry)"><component :is="isFavorite(entry) ? IconStarFilled : IconStar" :size="13" /></button></span>
          <span class="thumbName">{{ showFavorites ? entry.path : entry.name }}</span>
        </div>
        <div v-else class="thumb" :class="{ used: used.has(entry.path) }" :title="`${entry.path}\n${translate('点击：在源监视器中观看并标记入出点 · 拖到轨道 · + 添加整个文件')}`" draggable="true"
          @dragstart="drag($event, entry.path)" @click="emit('open', entry.path)" @contextmenu.prevent="emit('menu', $event, entry.path)">
          <span class="thumbPicture">
            <img v-if="thumbs[entry.path]" :src="thumbs[entry.path]!" alt="" draggable="false" />
            <icon-music v-else-if="mediaKind(entry.name) === 'audio'" :size="28" stroke="1.4" />
            <icon-photo v-else :size="26" stroke="1.2" class="placeholder" />
            <span v-if="lengths[entry.path]" class="thumbLength">{{ clock(lengths[entry.path]!) }}</span>
            <span v-if="used.has(entry.path)" class="thumbUsed">✓</span>
            <button class="thumbStar" :class="{ on: isFavorite(entry) }" @click.stop="toggleFavorite(entry)"><component :is="isFavorite(entry) ? IconStarFilled : IconStar" :size="13" /></button>
            <button class="thumbAdd" :title="mediaKind(entry.name) === 'audio' ? translate('添加到播放头处的音频轨') : translate('把整个文件添加到 V1 末尾')" @click.stop="emit('add', entry.path)"><icon-plus :size="14" /></button>
          </span>
          <span class="thumbName">{{ entry.name }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, reactive, ref, shallowRef, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { IconStar, IconStarFilled } from "@tabler/icons-vue";
import type { Media } from "../media";
import { videoFolders } from "../media";
import { assetDragType } from "../sourceEdit";
import { mediaKind } from "../timeline";

type Entry = { name: string; path: string; type: "file" | "directory" };

/**
 * 素材网格：浏览工作区文件夹中的视频、图片与音频缩略图（子文件夹在前）。点击在源监视器观看，拖到轨道添加，+ 直接添加整个文件；☆ 收藏文件或文件夹。
 */
const props = withDefaults(defineProps<{ directory: string; used: Set<string>; kind?: "all" | "audio"; refresh?: number }>(), { kind: "all", refresh: 0 });
const emit = defineEmits<{ open: [path: string]; add: [path: string]; menu: [event: MouseEvent, path: string] }>();
const media = inject<Media>("videoMedia")!;
const path = ref("");
const entries = shallowRef<Entry[] | null>(null);
const showFavorites = ref(false);
const thumbs = reactive<Record<string, string | null>>({});
const lengths = reactive<Record<string, number | null>>({});
const favoriteKey = `toonflow:videoFavorites:${props.directory}`;
const favorites = ref<string[]>((() => { try { return JSON.parse(localStorage.getItem(favoriteKey) ?? "[]"); } catch { return []; } })());
const parent = computed(() => (path.value.includes("/") ? path.value.slice(0, path.value.lastIndexOf("/")) : ""));
const hidden = new Set([videoFolders.work.toLowerCase(), ".agent"]);
const fits = (name: string) => (props.kind === "audio" ? mediaKind(name) === "audio" : !!mediaKind(name));

async function reload() {
  const folder = path.value;
  try {
    const { entries: list } = await media.files.list(folder);
    if (folder !== path.value) return;
    entries.value = [
      ...list.filter(entry => entry.type === "directory" && !hidden.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")),
      ...list.filter(entry => entry.type === "file" && fits(entry.name)),
    ];
  } catch {
    entries.value = [];
  }
}
watch(path, () => { entries.value = null; void reload(); }, { immediate: true });
watch(() => props.refresh, () => void reload());

const favoriteKeyOf = (entry: Entry) => (entry.type === "directory" ? `${entry.path}/` : entry.path);
const isFavorite = (entry: Entry) => favorites.value.includes(favoriteKeyOf(entry));
function toggleFavorite(entry: Entry) {
  const key = favoriteKeyOf(entry);
  favorites.value = favorites.value.includes(key) ? favorites.value.filter(item => item !== key) : [...favorites.value, key];
  localStorage.setItem(favoriteKey, JSON.stringify(favorites.value));
}
const favoriteEntries = computed<Entry[]>(() => [...favorites.value.filter(item => item.endsWith("/")), ...favorites.value.filter(item => !item.endsWith("/"))].map(item => {
  const folder = item.endsWith("/");
  const value = folder ? item.slice(0, -1) : item;
  return { name: value.split("/").pop()!, path: value, type: folder ? "directory" : "file" };
}));
const shown = computed(() => (showFavorites.value ? favoriteEntries.value : entries.value));

// 只为显示的文件生成缩略图与时长。
watch(shown, list => {
  for (const entry of list ?? []) {
    if (entry.type !== "file" || entry.path in thumbs) continue;
    thumbs[entry.path] = null;
    if (mediaKind(entry.name) !== "audio") void media.thumbOf(entry.path).then(url => { thumbs[entry.path] = url; });
    if (mediaKind(entry.name) !== "image") void media.probe(entry.path).then(info => { lengths[entry.path] = info.duration; }, () => {});
  }
}, { immediate: true });

function openFolder(folder: string) {
  showFavorites.value = false;
  path.value = folder;
}

function drag(event: DragEvent, file: string) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(assetDragType, JSON.stringify([file]));
  event.dataTransfer.setData("text/plain", file);
  event.dataTransfer.effectAllowed = "copy";
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
</script>

<style lang="scss">
.mediaGrid {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;

  .mediaBar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;

    .spacer { flex: 1; }
    .crumb {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      max-width: 100%;
      padding: 3px 6px;
      overflow: hidden;
      border: none;
      border-radius: 4px;
      background: none;
      color: var(--el-text-color-regular);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;

      &:hover { background: var(--el-fill-color-light); }
      &.on { color: var(--el-color-warning); }
      .count { color: var(--el-text-color-secondary); }
    }
  }

  .mediaHint { padding: 12px; color: var(--el-text-color-secondary); font-size: 12px; }

  .thumbGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
    padding: 4px 8px 12px;
    overflow: auto;
  }

  .thumb {
    display: flex;
    flex-direction: column;
    gap: 3px;
    cursor: pointer;

    &.used .thumbPicture { box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-success) 60%, transparent); }

    .thumbPicture {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      border-radius: 6px;
      background: var(--el-fill-color);
      color: var(--el-text-color-secondary);

      img { width: 100%; height: 100%; object-fit: cover; }
      .placeholder { opacity: 0.4; }
    }

    &:hover .thumbAdd, &:hover .thumbStar { opacity: 1; }
    .thumbLength { position: absolute; right: 4px; bottom: 4px; padding: 0 4px; border-radius: 3px; background: #000a; color: #fff; font-size: 10px; }
    .thumbUsed { position: absolute; left: 4px; bottom: 4px; padding: 0 4px; border-radius: 3px; background: var(--el-color-success); color: #fff; font-size: 10px; }
    .thumbStar, .thumbAdd {
      position: absolute;
      top: 4px;
      display: inline-flex;
      padding: 3px;
      border: none;
      border-radius: 4px;
      background: #000a;
      color: #fff;
      opacity: 0;
      cursor: pointer;
    }
    .thumbStar { left: 4px; }
    .thumbStar.on { color: #fcc419; opacity: 1; }
    .thumbAdd { right: 4px; }
    .thumbName { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  }
}
</style>
