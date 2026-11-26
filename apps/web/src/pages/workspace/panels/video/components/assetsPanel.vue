<template>
  <div class="assetsPanel">
    <nav class="assetsRail">
      <button v-for="item in tabs" :key="item.id" :class="{ active: tab === item.id }" :title="translate(item.label)" @click="tab = item.id">
        <component :is="item.icon" :size="17" />
      </button>
    </nav>
    <div class="assetsContent">
      <template v-if="tab === 'media' || tab === 'audio'">
        <div class="panelHead">
          <span class="panelTitle">{{ tab === "audio" ? translate("音乐与音效") : translate("素材") }}</span>
          <div v-if="tab === 'audio' && capcutMusicEnabled" class="subTabs">
            <button :class="{ on: audioView === 'online' }" @click="audioView = 'online'">{{ translate("在线曲库") }}</button>
            <button :class="{ on: audioView === 'local' }" @click="audioView = 'local'">{{ translate("本地") }}</button>
          </div>
          <span class="spacer" />
          <button v-if="tab === 'media'" class="iconButton" title="从画布挑选视频与图片" @click="emit('fromCanvas')"><icon-vector :size="16" /></button>
          <el-button v-if="tab === 'media' || audioView === 'local'" size="small" title="从本机导入文件到工作区并放到时间线" @click="fileInput?.click()"><icon-upload :size="14" />&nbsp;导入</el-button>
          <input ref="fileInput" type="file" multiple hidden :accept="tab === 'audio' ? 'audio/*' : 'video/*,image/*,audio/*'" @change="importFiles" />
        </div>
        <musicLibrary v-if="tab === 'audio' && capcutMusicEnabled && audioView === 'online'" @add="(url, name) => emit('addOnlineAudio', url, name)" />
        <mediaGrid v-else :key="tab" :directory="directory" :used="used" :kind="tab === 'audio' ? 'audio' : 'all'" :refresh="refresh" @open="path => emit('open', path)" @add="path => emit('add', path)" @menu="(event, path) => emit('menu', event, path)" />
      </template>

      <div v-else-if="tab === 'text'" class="assetsPane">
        <div class="panelHead"><span class="panelTitle">文字</span></div>
        <p class="paneHint">点击即在播放头处的文字轨添加，然后在右侧编辑。</p>
        <div class="tileGrid">
          <button v-for="preset in textPresets" :key="translate(preset.label)" class="tile" @click="emit('addText', preset.text, preset.style)">
            <span class="textSample" :style="{ fontWeight: preset.style.bold ? 700 : 400, fontStyle: preset.style.italic ? 'italic' : undefined, textDecoration: preset.style.decoration, letterSpacing: preset.style.letterSpacing ? `${preset.style.letterSpacing / 100}em` : undefined }">{{ preset.text.split("\n")[0] }}</span>
            <span class="tileLabel">{{ translate(preset.label) }}</span>
          </button>
        </div>
      </div>

      <div v-else-if="tab === 'stickers'" class="assetsPane">
        <div class="panelHead"><span class="panelTitle">贴纸</span></div>
        <p class="paneHint">Emoji 按文字绘制：用字号调整大小，在预览中拖动移动。</p>
        <template v-for="group in stickers" :key="group.group">
          <div class="sectionLabel">{{ translate(group.group) }}</div>
          <div class="stickerGrid">
            <button v-for="emoji in group.items" :key="emoji" class="sticker" @click="emit('addSticker', emoji)">{{ emoji }}</button>
          </div>
        </template>
      </div>

      <div v-else-if="tab === 'shapes'" class="assetsPane">
        <div class="panelHead"><span class="panelTitle">图形</span></div>
        <p class="paneHint">添加后可在右侧调整填充、描边、圆角与角数。</p>
        <div class="tileGrid">
          <button v-for="kind in shapeKinds" :key="kind" class="tile" @click="emit('addShape', kind)">
            <svg class="shapeIcon" viewBox="0 0 32 32" aria-hidden="true">
              <rect v-if="kind === 'rect'" x="4" y="7" width="24" height="18" rx="2" />
              <ellipse v-else-if="kind === 'ellipse'" cx="16" cy="16" rx="13" ry="10" />
              <polygon v-else-if="kind === 'triangle'" points="16,4 29,28 3,28" />
              <polygon v-else-if="kind === 'polygon'" :points="polygonPoints(6, 14)" />
              <polygon v-else-if="kind === 'star'" :points="starPoints" />
              <path v-else-if="kind === 'heart'" d="M16 28 C3 18 6 4 16 11 C26 4 29 18 16 28 Z" />
              <line v-else x1="4" y1="16" x2="28" y2="16" class="stroke" />
            </svg>
            <span class="tileLabel">{{ translate(shapeLabels[kind]) }}</span>
          </button>
        </div>
      </div>

      <div v-else-if="tab === 'effects'" class="assetsPane">
        <div class="panelHead"><span class="panelTitle">特效</span></div>
        <p class="paneHint">在播放头处添加到特效轨：持续期间改变其下所有轨道的画面。拖动边缘调整时长，在右侧调整强度。</p>
        <div class="tileGrid">
          <button v-for="kind in effectKinds" :key="kind" class="tile" @click="emit('addEffect', kind)">
            <span class="tileIcon">{{ effectIcons[kind] }}</span>
            <span class="tileLabel">{{ translate(effectLabels[kind]) }}</span>
          </button>
        </div>
        <p class="paneHint">{{ pictureClips ? t`作用于选中的 ${pictureClips} 个画面片段。` : translate("先在视频轨上选中片段。") }}</p>
        <div class="sectionLabel">调色</div>
        <div class="tileGrid">
          <button v-for="(look, name) in looks" :key="name" class="tile" :disabled="!pictureClips" @click="emit('look', name)">
            <span class="lookSwatch" :style="{ filter: cssFilters(look.values) || undefined }" />
            <span class="tileLabel">{{ translate(look.label) }}</span>
          </button>
        </div>
        <div class="sectionLabel">混合模式</div>
        <div class="rowList">
          <button v-for="blend in blends" :key="blend" class="listRow" :disabled="!pictureClips" @click="emit('blend', blend)">{{ translate(blendLabels[blend]) }}</button>
        </div>
      </div>

      <div v-else-if="tab === 'transitions'" class="assetsPane">
        <div class="panelHead"><span class="panelTitle">转场</span></div>
        <p class="paneHint">{{ magneticClips ? t`应用到选中的 ${magneticClips} 个 V1 片段（与前一片段之间）。` : translate("先选中 V1 上的片段（第一个除外）：转场连接它与前一片段。") }}</p>
        <label class="fieldRow">
          <span class="fieldLabel">时长</span>
          <el-input-number :modelValue="duration ?? undefined" size="small" :controls="false" :min="0.05" :max="5" :step="0.05" placeholder="自动" @keydown.stop @change="value => (duration = value ?? null)" />
          <span class="fieldSuffix">s</span>
        </label>
        <div class="fieldRow">
          <span class="fieldLabel">方向</span>
          <div class="directionButtons">
            <button v-for="arrow in arrows" :key="arrow.dir" :class="{ on: direction === arrow.dir }" :title="translate(directionLabels[arrow.dir])" @click="direction = arrow.dir">{{ arrow.label }}</button>
          </div>
          <span />
        </div>
        <button class="listRow" :disabled="!magneticClips" @click="emit('transition', 'cut', 0)">✂️ 硬切（无转场）</button>
        <template v-for="group in transitionGroups" :key="translate(group.title)">
          <div class="sectionLabel">{{ translate(group.title) }}</div>
          <div class="tileGrid">
            <button v-for="kind in group.kinds" :key="kind" class="tile" :disabled="!magneticClips" @click="emit('transition', kind, duration ?? transitionSeconds[kind], transitionDirected.includes(kind) ? direction : undefined)">
              <span class="tileIcon">{{ transitionIcons[kind] }}</span>
              <span class="tileLabel">{{ translate(transitionLabels[kind]) }}</span>
            </button>
          </div>
        </template>
      </div>

      <div v-else-if="tab === 'captions'" class="assetsPane">
        <div class="panelHead"><span class="panelTitle">字幕</span></div>
        <label v-if="textTracks.length > 1" class="fieldRow">
          <span class="fieldLabel">轨道</span>
          <el-select :modelValue="captionTrack?.id" size="small" @change="value => (captionTrackId = value)">
            <el-option v-for="track in textTracks" :key="track.id" :label="track.name" :value="track.id" />
          </el-select>
          <span />
        </label>
        <div class="rowList">
          <button class="listRow" :disabled="!captionTrack" @click="srtInput?.click()">⇩ 导入字幕（.srt / .vtt）…</button>
          <button class="listRow" :disabled="!captionTrack" @click="captionTrack && emit('exportSrt', captionTrack)">⇧ 导出此轨为 .srt</button>
        </div>
        <p class="paneHint">导入会替换该轨的全部文字（Ctrl+Z 可恢复）。也可把素材中的 .srt 文件拖到文字轨。</p>
        <input ref="srtInput" type="file" accept=".srt,.vtt,text/plain" hidden @change="importSrt" />
      </div>

      <projectFields v-else-if="tab === 'settings'" :history="history" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { msg, t, translate } from "@toonflow/i18n/vue";
import { capcutMusicEnabled } from "@toonflow/server/capcutMusic";
import { IconAdjustmentsHorizontal, IconChevronsRight, IconFolder, IconMusic, IconShape, IconSparkles, IconSticker, IconSubtitles, IconTypography } from "@tabler/icons-vue";
import type { VideoBlend, VideoDirection, VideoDoc, VideoEffectKind, VideoShape, VideoTextStyle, VideoTrack, VideoTransitionKind } from "../types";
import type { History } from "../useHistory";
import { blendLabels, directionLabels, effectLabels, shapeLabels, transitionLabels } from "../labels";
import { looks, textPresets } from "../presets";
import { cssFilters } from "../effects";
import { blends, effectKinds, shapeKinds, stickers, transitionDirected, transitionSeconds } from "../timeline";
import mediaGrid from "./mediaGrid.vue";
import projectFields from "./projectFields.vue";

type Tab = "media" | "audio" | "text" | "stickers" | "shapes" | "effects" | "transitions" | "captions" | "settings";

/** OpenCut 的素材面板：左侧标签栏与当前标签内容。素材为工作区文件；其他标签在播放头处添加文字、贴纸、图形、特效，或对选中内容应用调色、混合与转场。 */
const props = defineProps<{ history: History<VideoDoc>; directory: string; used: Set<string>; refresh: number; pictureClips: number; magneticClips: number }>();
const emit = defineEmits<{
  open: [path: string]; add: [path: string]; menu: [event: MouseEvent, path: string]; fromCanvas: []; importFiles: [files: File[]];
  addText: [text: string, style: VideoTextStyle]; addShape: [kind: VideoShape["kind"]]; addSticker: [emoji: string]; addEffect: [kind: VideoEffectKind];
  look: [name: string]; blend: [blend: VideoBlend]; transition: [kind: VideoTransitionKind | "cut", duration: number, direction?: VideoDirection];
  importSrt: [text: string, name: string, track: string]; exportSrt: [track: VideoTrack];
  addOnlineAudio: [url: string, name: string];
}>();
const tabs: { id: Tab; label: ReturnType<typeof msg>; icon: unknown }[] = [
  { id: "media", label: msg`素材`, icon: IconFolder },
  { id: "audio", label: msg`音乐与音效`, icon: IconMusic },
  { id: "text", label: msg`文字`, icon: IconTypography },
  { id: "stickers", label: msg`贴纸`, icon: IconSticker },
  { id: "shapes", label: msg`图形`, icon: IconShape },
  { id: "effects", label: msg`特效`, icon: IconSparkles },
  { id: "transitions", label: msg`转场`, icon: IconChevronsRight },
  { id: "captions", label: msg`字幕`, icon: IconSubtitles },
  { id: "settings", label: msg`工程设置`, icon: IconAdjustmentsHorizontal },
];
const tab = ref<Tab>((localStorage.getItem("toonflow:videoAssetsTab") as Tab) || "media");
watch(tab, value => localStorage.setItem("toonflow:videoAssetsTab", value));
const musicLibrary = defineAsyncComponent(() => import("./musicLibrary.vue"));
const audioView = ref<"online" | "local">(capcutMusicEnabled ? "online" : "local");
const fileInput = ref<HTMLInputElement>();
const srtInput = ref<HTMLInputElement>();
const duration = ref<number | null>(null);
const direction = ref<VideoDirection>("left");
const captionTrackId = ref("");
const textTracks = computed(() => props.history.content.value.tracks.filter(track => track.kind === "text"));
const captionTrack = computed(() => textTracks.value.find(track => track.id === captionTrackId.value) ?? textTracks.value[0]);
const effectIcons: Partial<Record<VideoEffectKind, string>> = { shake: "📳", flash: "⚡", glitch: "📺", vignette: "🔅", oldFilm: "🎞️", grain: "🌫️", lightLeak: "🌅", dirBlur: "💨", adjust: "🎚️" };
const transitionGroups: { title: ReturnType<typeof msg>; kinds: VideoTransitionKind[] }[] = [
  { title: msg`回忆`, kinds: ["flash", "leak", "blink"] },
  { title: msg`经典`, kinds: ["dissolve", "dipBlack", "dipWhite"] },
  { title: msg`移动`, kinds: ["whip", "push", "slide"] },
  { title: msg`揭开`, kinds: ["wipe", "circle"] },
  { title: msg`动感`, kinds: ["zoom", "spin", "glitch"] },
];
const transitionIcons: Record<VideoTransitionKind, string> = { flash: "✨", leak: "🌅", blink: "👁️", dissolve: "◐", dipBlack: "⬛", dipWhite: "⬜", whip: "💨", push: "⇆", slide: "⇤", wipe: "▧", circle: "◎", zoom: "🔍", spin: "🌀", glitch: "📺" };
const arrows: { dir: VideoDirection; label: string }[] = [{ dir: "left", label: "←" }, { dir: "right", label: "→" }, { dir: "up", label: "↑" }, { dir: "down", label: "↓" }];
const polygonPoints = (sides: number, radius: number) => Array.from({ length: sides }, (_, index) => {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides;
  return `${16 + Math.cos(angle) * radius},${16 + Math.sin(angle) * radius}`;
}).join(" ");
const starPoints = Array.from({ length: 10 }, (_, index) => {
  const angle = -Math.PI / 2 + (index * Math.PI) / 5;
  const radius = index % 2 ? 6.3 : 14;
  return `${16 + Math.cos(angle) * radius},${16 + Math.sin(angle) * radius}`;
}).join(" ");

function importFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (files.length) emit("importFiles", files);
}

let disposed = false;
onBeforeUnmount(() => { disposed = true; });

async function importSrt(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const track = captionTrack.value;
  if (!file || !track) return;
  try {
    const text = await file.text();
    if (!disposed) emit("importSrt", text, file.name, track.id);
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : translate("读取字幕失败"));
  }
}
</script>

<style lang="scss">
.assetsPanel {
  display: flex;
  height: 100%;
  min-height: 0;

  .assetsRail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 4px;
    border-right: 1px solid var(--el-border-color-lighter);

    button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 6px;
      background: none;
      color: var(--el-text-color-secondary);
      cursor: pointer;

      &:hover { background: var(--el-fill-color-light); }
      &.active { background: color-mix(in srgb, var(--el-color-primary) 14%, transparent); color: var(--el-color-primary); }
    }
  }

  .assetsContent { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
  .assetsPane { flex: 1; min-height: 0; padding-bottom: 12px; overflow: auto; }

  .panelHead {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 38px;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    .panelTitle { font-size: 13px; font-weight: 600; }
    .subTabs {
      display: flex;
      gap: 2px;
      margin-left: 8px;

      button { padding: 2px 8px; border: none; border-radius: 5px; background: none; color: var(--el-text-color-secondary); font-size: 12px; cursor: pointer; }
      button:hover { background: var(--el-fill-color-light); }
      button.on { background: color-mix(in srgb, var(--el-color-primary) 14%, transparent); color: var(--el-color-primary); }
    }
    .spacer { flex: 1; }
    .iconButton { display: inline-flex; padding: 4px; border: none; border-radius: 5px; background: none; color: var(--el-text-color-regular); cursor: pointer; }
    .iconButton:hover { background: var(--el-fill-color-light); }
  }

  .paneHint { margin: 8px 12px; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.5; }
  .sectionLabel { margin: 10px 12px 4px; color: var(--el-text-color-secondary); font-size: 11px; font-weight: 600; }
  .fieldRow { margin: 4px 12px; }

  .tileGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(82px, 1fr));
    gap: 6px;
    padding: 0 12px;

    .tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 64px;
      padding: 6px 4px;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: 6px;
      background: var(--el-fill-color-lighter);
      color: var(--el-text-color-primary);
      cursor: pointer;

      &:hover:not(:disabled) { border-color: var(--el-color-primary); }
      &:disabled { opacity: 0.45; cursor: default; }
      .tileLabel { font-size: 11px; color: var(--el-text-color-secondary); text-align: center; }
      .tileIcon { font-size: 22px; }
      .textSample { max-width: 100%; overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
      .shapeIcon { width: 28px; height: 28px; fill: currentColor; opacity: 0.8; }
      .shapeIcon .stroke { stroke: currentColor; stroke-width: 2.5; }
      .lookSwatch { width: 44px; height: 28px; border-radius: 4px; background: linear-gradient(135deg, #f76707, #fab005 40%, #40c057 70%, #228be6); }
    }
  }

  .stickerGrid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 2px;
    padding: 0 10px;

    .sticker { height: 36px; border: none; border-radius: 6px; background: none; font-size: 22px; cursor: pointer; }
    .sticker:hover { background: var(--el-fill-color-light); }
  }

  .rowList { display: flex; flex-direction: column; padding: 0 8px; }
  .listRow {
    padding: 6px 8px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--el-text-color-primary);
    font-size: 12px;
    text-align: left;
    cursor: pointer;

    &:hover:not(:disabled) { background: var(--el-fill-color-light); }
    &:disabled { color: var(--el-text-color-disabled); cursor: default; }
  }

  .directionButtons {
    display: flex;
    gap: 2px;

    button { width: 28px; height: 24px; border: 1px solid var(--el-border-color); border-radius: 4px; background: none; color: var(--el-text-color-regular); cursor: pointer; }
    button.on { border-color: var(--el-color-primary); color: var(--el-color-primary); }
  }
}
</style>
