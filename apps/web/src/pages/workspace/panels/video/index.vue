<template>
  <section ref="panelElement" class="videoPanel" aria-label="剪辑工作区" :class="{ resizing }">
    <div class="videoHead">
      <el-popover v-model:visible="projectListVisible" trigger="click" placement="bottom-start" :width="300" :showArrow="false">
        <template #reference>
          <el-button class="projectTrigger" text :loading="loadingProject">
            <icon-movie :size="16" />&nbsp;<span class="projectName">{{ projectPath ? projectName : translate("选择剪辑工程") }}</span><icon-chevron-down :size="14" />
          </el-button>
        </template>
        <div class="projectPicker">
          <div class="pickerToolbar">
            <span>剪辑工程</span>
            <span class="spacer" />
            <el-button size="small" text title="刷新" @click="loadProjects"><icon-refresh :size="14" /></el-button>
            <el-button size="small" type="primary" @click="newProject"><icon-plus :size="14" />&nbsp;新建</el-button>
          </div>
          <div v-if="!projects" class="pickerEmpty">正在读取…</div>
          <div v-else-if="!projects.length" class="pickerEmpty">工作区还没有剪辑工程</div>
          <div v-for="item in projects ?? []" :key="item.path" class="projectRow" :class="{ active: item.path === projectPath }" :title="item.path" @click="openProject(item.path)">
            <icon-movie :size="15" />
            <span class="projectRowName">{{ item.name }}</span>
            <el-button size="small" text title="重命名" @click.stop="renameProject(item.path)"><icon-pencil :size="13" /></el-button>
            <el-button size="small" text title="删除工程文件" @click.stop="deleteProject(item.path)"><icon-trash :size="13" /></el-button>
          </div>
        </div>
      </el-popover>
      <span v-if="projectPath" class="saveState" :class="saveState">{{ saveLabel }}</span>
      <span v-if="busy" class="headNote">{{ busy }}</span>
      <button v-if="recording" class="recordBadge" title="停止录音：配音会放到音频轨上" @click="recording.stop()">● REC {{ recordingClock }}</button>
      <span v-if="note" class="headNote">
        {{ note.text }}
        <el-button v-if="note.path" size="small" text @click="reveal(note.path)">在文件夹中显示</el-button>
        <button class="headIcon" title="关闭" @click="note = null"><icon-x :size="13" /></button>
      </span>
      <span class="spacer" />
      <span v-if="exportState" class="exportBadge" :class="exportState.state" :title="exportState.output">
        <template v-if="exportState.state === 'running'">
          <span class="progressBar"><span :style="{ width: `${Math.round(exportState.progress * 100)}%` }" /></span>
          导出中 {{ Math.round(exportState.progress * 100) }}%
          <el-button size="small" text @click="exportState.controller?.abort()">取消</el-button>
        </template>
        <template v-else-if="exportState.state === 'done'">
          ✓ {{ fileName(exportState.output) }}
          <el-button size="small" text @click="playOutput(exportState.output)">播放</el-button>
          <el-button size="small" text @click="reveal(exportState.output)">在文件夹中显示</el-button>
        </template>
        <span v-else-if="exportState.state === 'error'" class="exportError" :title="exportState.error">导出失败：{{ exportState.error?.split("\n").pop() }}</span>
        <span v-else>已取消导出</span>
        <button v-if="exportState.state !== 'running'" class="headIcon" title="关闭" @click="exportState = null"><icon-x :size="13" /></button>
      </span>
      <template v-if="projectPath">
        <button class="headIcon" :class="{ on: assetsOpen }" title="显示 / 隐藏素材面板" @click="assetsOpen = !assetsOpen"><icon-layout-sidebar :size="17" /></button>
        <button class="headIcon" :class="{ on: sourceOpen }" title="显示 / 隐藏源监视器：在素材中点击文件观看、标记入出点，再插入或覆盖" @click="sourceOpen = !sourceOpen"><icon-device-tv :size="17" /></button>
        <button class="headIcon" :class="{ on: inspectorOpen }" title="显示 / 隐藏属性面板" @click="inspectorOpen = !inspectorOpen"><icon-layout-sidebar-right :size="17" /></button>
        <el-popover trigger="click" placement="bottom-end" :width="380" :showArrow="false" :destroyOnClose="true">
          <template #reference>
            <button class="headIcon" title="快照：保存当前时间线，随时恢复"><icon-history :size="17" /></button>
          </template>
          <snapshotsPanel :key="projectPath" :media="media" :project="projectPath" :doc="doc" @restore="restoreSnapshot" />
        </el-popover>
        <button class="headIcon" title="快捷键（?）" @click="shortcutsVisible = true"><icon-keyboard :size="17" /></button>
        <button class="headIcon" :class="{ on: !!recording }" title="录制配音：从播放头开始边播边录（建议戴耳机），再次点击停止" @click="toggleRecording"><icon-microphone :size="17" /></button>
        <button class="headIcon" :disabled="!length" title="把播放头处的画面按导出效果存为 PNG" @click="exportFrame"><icon-camera :size="17" /></button>
        <el-button type="primary" size="small" :disabled="!length || exportState?.state === 'running'" title="MP4、GIF、MP3 或 WAV；整段或入点到出点；尺寸、画质与混入的轨道" @click="exportOptions = {}">
          <icon-share :size="14" />&nbsp;导出
        </el-button>
      </template>
    </div>

    <div v-if="!projectPath" class="videoEmpty">
      <icon-movie :size="40" stroke="1.3" />
      <b>{{ projects?.length ? translate("选择一个剪辑工程") : translate("工作区还没有剪辑工程") }}</b>
      <span>剪辑工程保存为工作区中的 JSON 文件，可以把画布生成的视频、图片与音频剪成成片。</span>
      <el-button type="primary" @click="newProject"><icon-plus :size="14" />&nbsp;新建剪辑</el-button>
    </div>

    <template v-else>
      <div class="videoUpper">
        <section v-if="assetsOpen" class="videoCard assetsCard" :style="{ width: `${assetsWidth}px` }">
          <assetsPanel :key="projectPath" :history="history" :directory="directory" :used="usedPaths" :refresh="refresh" :pictureClips="selectedPictures.length" :magneticClips="selectedJoins.length"
            @open="openSource" @add="addToTimeline" @menu="assetMenu" @fromCanvas="canvasPickerVisible = true" @importFiles="importFiles"
            @addText="(text, style) => addItem({ text, style })" @addShape="kind => addItem({ text: '', style: shapeStyle, shape: newShape(kind, doc.width / doc.height) })"
            @addSticker="emoji => addItem({ text: emoji, style: { ...shapeStyle, size: 12, font: 'Segoe UI Emoji' } })" @addEffect="addEffect"
            @look="name => history.set(patchClips(history.content.value, selectedPictures.map(clip => clip.id), lookPatch(name)))"
            @blend="blend => history.set(patchClips(history.content.value, selectedPictures.map(clip => clip.id), { blend: blend === 'normal' ? undefined : blend }))"
            @transition="applyTransition" @importSrt="importSrtText" @exportSrt="exportSrt" />
          <div class="paneHandle right" title="拖动调整宽度 · 双击恢复" @pointerdown="startResize($event, 'assets')" @dblclick="assetsWidth = 340" />
        </section>

        <section class="videoCard previewCard">
          <div ref="monitorsElement" class="monitors">
            <template v-if="sourceOpen">
              <div class="sourcePane" :style="{ flexBasis: `${sourceShare * 100}%` }" @pointerdown.capture="focus = 'source'">
                <sourceMonitor :source="source" :marks="marks" :fps="doc.fps" :active="focus === 'source'" :targets="sourceTargets" :target="sourceTargetId"
                  @marks="value => source && setMarks(source.path, value)" @activate="focus = 'source'" @target="value => (sourceTarget = value)" @put="mode => putSource(mode)"
                  @close="sourceOpen = false; focus = 'program'" @control="value => (sourceControl = value)" />
              </div>
              <div class="monitorSplit" title="拖动分配两个监视器的宽度 · 双击各占一半" @pointerdown="startResize($event, 'source')" @dblclick="sourceShare = 0.5" />
            </template>
            <div ref="programElement" class="programPane" :class="{ active: sourceOpen && focus === 'program' }" @pointerdown.capture="focus = 'program'">
              <videoPreview :history="history" :playing="playing" :rate="rate" :guides="guideMode" :zoom="zoom" :selection="selection"
                @select="ids => (selection = ids)" @time="onClockTime" @ended="onEnded" @scale="value => (shownScale = value)" @zoom="value => (zoom = value)" />
              <scrubBar :length="length" @seek="seek" />
              <div class="previewBar">
                <span class="timecode"><b><liveTime :format="value => smpte(value, doc.fps)" /></b><span class="total"> / {{ smpte(length, doc.fps) }}</span></span>
                <span v-if="rate !== 1 && playing" class="rateBadge">{{ rate > 0 ? "▶" : "◀" }} {{ Math.abs(rate) }}×</span>
                <span class="spacer" />
                <button class="barIcon" title="开头（Home）" @click="seek(0)"><icon-player-track-prev :size="15" /></button>
                <button class="barIcon" title="后退一帧（←）· Shift：一秒" @click="seek(now() - 1 / doc.fps)"><icon-player-skip-back :size="15" /></button>
                <button class="barIcon play" title="播放 / 暂停（空格）" :disabled="!length" @click="togglePlay"><component :is="playing ? IconPlayerPauseFilled : IconPlayerPlayFilled" :size="17" /></button>
                <button class="barIcon" title="前进一帧（→）· Shift：一秒" @click="seek(now() + 1 / doc.fps)"><icon-player-skip-forward :size="15" /></button>
                <button class="barIcon" title="结尾（End）" @click="seek(length)"><icon-player-track-next :size="15" /></button>
                <button class="barIcon" :class="{ on: loop }" :title="loop ? translate('循环播放已开启：在入点与出点（或整段）之间循环') : translate('循环播放')" @click="loop = !loop"><icon-repeat :size="15" /></button>
                <span class="spacer" />
                <button class="barIcon" title="缩小" @click="zoom = stepZoom(shownScale, -1)"><icon-zoom-out :size="15" /></button>
                <el-select class="zoomPick" :modelValue="zoom === null ? 'fit' : String(zoom)" size="small" @change="value => (zoom = value === 'fit' ? null : Number(value))">
                  <el-option :label="`${translate('适应')} (${Math.round(shownScale * 100)}%)`" value="fit" />
                  <el-option v-for="step in zoomSteps" :key="step" :label="`${Math.round(step * 100)}%`" :value="String(step)" />
                </el-select>
                <button class="barIcon" title="放大" @click="zoom = stepZoom(shownScale, 1)"><icon-zoom-in :size="15" /></button>
                <el-select class="guidePick" :modelValue="guideMode ?? ''" size="small" title="预览辅助线（不会导出）" @change="value => (guideMode = (value || null) as GuideMode | null)">
                  <el-option :label="translate('无辅助线')" value="" />
                  <el-option v-for="guide in guides" :key="guide.value" :label="translate(guide.label)" :value="guide.value" />
                </el-select>
                <button class="barIcon" title="全屏（F）· Esc 退出" @click="fullScreen"><icon-maximize :size="15" /></button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="inspectorOpen" class="videoCard inspectorCard" :style="{ width: `${inspectorWidth}px` }">
          <div class="paneHandle left" title="拖动调整宽度 · 双击恢复" @pointerdown="startResize($event, 'inspector')" @dblclick="inspectorWidth = 320" />
          <videoInspector :history="history" :selection="selection" :time="time" @seek="seek" @detachAudio="detach" @freeze="id => void freezeFrame(id)" />
        </section>
      </div>

      <div class="rowsHandle" title="拖动调整时间线高度 · 双击恢复" @pointerdown="startResize($event, 'timeline')" @dblclick="timelineHeight = 280" />
      <section class="videoCard timelineCard" :style="{ height: `${timelineHeight}px` }" @pointerdown.capture="focus = 'program'">
        <div class="timelineToolbar">
          <button class="barIcon" title="在播放头处切开（S）· Shift+S：所有轨道" @click="split()"><icon-scissors :size="16" /></button>
          <button class="barIcon" title="把选中片段与切开的另一段合并" :disabled="!canJoin(doc, selection)" @click="join()"><icon-arrow-merge :size="16" /></button>
          <button class="barIcon" title="切开并删除左侧（Q）" @click="splitSide('left')"><icon-arrow-bar-to-left :size="16" /></button>
          <button class="barIcon" title="切开并删除右侧（W）" @click="splitSide('right')"><icon-arrow-bar-to-right :size="16" /></button>
          <button class="barIcon" title="复制一份（Ctrl+D）" :disabled="!selection.length" @click="duplicateSelected()"><icon-copy :size="16" /></button>
          <button class="barIcon" title="在播放头处定格 2 秒" :disabled="!freezeTarget" @click="freezeTarget && freezeFrame(freezeTarget.id)"><icon-snowflake :size="16" /></button>
          <button class="barIcon" :title="ripple ? translate('删除并合拢空隙（波纹编辑已开启）') : translate('删除（Del）· Shift+Del 合拢空隙')" :disabled="!selection.length" @click="removeSelected()"><icon-trash :size="16" /></button>
          <span class="toolbarSeparator" />
          <button class="barIcon" :class="{ on: markerHere }" title="在播放头处添加 / 删除标记（M 添加）" @click="toggleMarker"><icon-bookmark :size="16" /></button>
          <button class="barIcon" title="静音 / 取消静音选中项" :disabled="!selection.length" @click="toggleFlag('muted')"><icon-volume-off :size="16" /></button>
          <button class="barIcon" title="隐藏 / 显示选中项（隐藏片段的声音照常播放）" :disabled="!selection.length" @click="toggleFlag('hidden')"><icon-eye-off :size="16" /></button>
          <button class="barIcon" title="在播放头处添加文字（T）" @click="addText()"><icon-typography :size="16" /></button>
          <span class="toolbarSeparator" />
          <button class="barIcon" title="标记入点（I）" @click="markProgram('in')">{</button>
          <button class="barIcon" title="标记出点（O）" @click="markProgram('out')">}</button>
          <template v-if="range.in !== null || range.out !== null">
            <el-button size="small" text title="移除入点到出点的内容，保留空隙（;）" @click="cutRange(false)">提升</el-button>
            <el-button size="small" text title="移除入点到出点的内容并合拢（'）" @click="cutRange(true)">提取</el-button>
            <button class="barIcon" title="清除入点与出点（Alt+X）" @click="setRange(noRange)"><icon-x :size="14" /></button>
          </template>
          <span class="toolbarSeparator" />
          <button class="barIcon" title="撤销（Ctrl+Z）" :disabled="!history.canUndo.value" @click="history.undo()"><icon-arrow-back-up :size="16" /></button>
          <button class="barIcon" title="重做（Ctrl+Shift+Z）" :disabled="!history.canRedo.value" @click="history.redo()"><icon-arrow-forward-up :size="16" /></button>
          <span class="spacer" />
          <span class="framePill">{{ doc.width }}×{{ doc.height }} · {{ doc.fps }} fps</span>
          <span class="spacer" />
          <button class="barIcon" :class="{ on: snapping }" :title="snapping ? translate('吸附已开启（N）') : translate('吸附已关闭（N）')" @click="snapping = !snapping"><icon-magnet :size="16" /></button>
          <button class="barIcon" :class="{ on: rippleOn }" :title="rippleOn ? translate('波纹编辑已开启：删除会合拢空隙') : translate('波纹编辑已关闭')" @click="rippleOn = !rippleOn"><icon-arrows-left-right :size="16" /></button>
          <span class="toolbarSeparator" />
          <button class="barIcon" title="缩小时间线" @click="pps = Math.max(minPps, pps / 1.4)"><icon-zoom-out :size="16" /></button>
          <el-slider class="ppsSlider" :modelValue="Math.log(pps)" :min="Math.log(minPps)" :max="Math.log(maxPps)" :step="0.01" :showTooltip="false" size="small" @input="value => (pps = Math.exp(value as number))" />
          <button class="barIcon" title="放大时间线" @click="pps = Math.min(maxPps, pps * 1.4)"><icon-zoom-in :size="16" /></button>
          <el-button size="small" text title="缩放到显示整个视频" @click="fitTimeline">适应</el-button>
        </div>
        <videoTimeline ref="timelineRef" :history="history" :time="time" :pps="pps" :selection="selection" :snapping="snapping" :heights="heights" :range="range"
          @pps="value => (pps = value)" @select="ids => (selection = ids)" @seek="seek" @drop="onDrop" @sourceDrop="dropSource" @menu="timelineMenu" @addTrack="kind => history.set(addTrack(history.content.value, kind).doc)" @height="setHeight" />
      </section>
    </template>

    <contextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menu.items" @close="menu = null" />
    <exportDialog v-if="exportOptions" :doc="doc" :only="exportOptions.only" :clipRange="exportOptions.part" :programRange="range.in !== null || range.out !== null ? rangeBounds() : undefined"
      @close="exportOptions = null" @export="options => { exportOptions = null; void runExport(options).catch(() => {}); }" />
    <canvasPicker v-if="canvasPickerVisible" @close="canvasPickerVisible = false" @pick="path => { canvasPickerVisible = false; void openSource(path); }"
      @addAll="paths => { canvasPickerVisible = false; void addFiles(paths, magneticTrack(history.content.value), null); }" />
    <el-dialog v-model="shortcutsVisible" title="快捷键" width="min(560px, calc(100vw - 32px))" appendToBody>
      <table class="shortcutTable">
        <tr v-for="([keys, action], index) in shortcuts" :key="index"><td><kbd>{{ typeof keys === "string" ? keys : translate(keys) }}</kbd></td><td>{{ translate(action) }}</td></tr>
      </table>
    </el-dialog>
    <el-dialog :modelValue="!!watching" :title="watching ? fileName(watching.path) : ''" width="min(900px, calc(100vw - 32px))" appendToBody destroyOnClose @close="watching = null">
      <img v-if="watching && extOf(watching.path) === 'gif'" class="watchMedia" :src="watching.url" alt="" />
      <audio v-else-if="watching && mediaKind(watching.path) === 'audio'" class="watchMedia" :src="watching.url" controls autoplay />
      <video v-else-if="watching" class="watchMedia" :src="watching.url" controls autoplay />
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, provide, ref, shallowRef, watch } from "vue";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import { msg, t, translate } from "@toonflow/i18n/vue";
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-vue";
import { useWorkspaceStore } from "@/stores/workspace";
import type { VideoClip, VideoDirection, VideoDoc, VideoEffectKind, VideoExportOptions, VideoShape, VideoTextStyle, VideoTrack, VideoTransitionKind } from "./types";
import type { TextSnapshot } from "@/lib/workspaceFiles";
import { useHistory } from "./useHistory";
import { createMedia, videoFolders } from "./media";
import { createVideoProject, listVideoProjects, readVideoProject, saveVideoProject, serializeVideo, type VideoProjectEntry } from "./videoFile";
import { guides, type GuideMode } from "./guides";
import { lookPatch } from "./presets";
import { markAt, putRange, rangeClip, type SourceMarks } from "./sourceEdit";
import { stepZoom, zoomSteps } from "./viewZoom";
import { applyOps, describeDoc, probeOps } from "./agentOps";
import {
  addEffectTrack, addTrack, asPhoto, canJoin, clipLength, closeGaps, copyItems, detachAudio, docLength, duplicate, effectSeconds, effectTrackFor, extOf, fileName, fits, formatSrt,
  freeTrackAt, gapAt, insertIndex, itemsAcross, joinItems, magneticTrack, mediaKind, mergeDocs, newDoc, newEffect, newShape, normalizeDoc, parseSrt, pasteItems, patchClips,
  patchTexts, patchTracks, placeAll, placeClip, remove, removeRange, shapeStyle, smpte, snapPoints, splitItems, subtitleStyle, syncDelete, textSeconds, trim, uid, type Clipboard,
} from "./timeline";
import assetsPanel from "./components/assetsPanel.vue";
import videoPreview from "./components/videoPreview.vue";
import videoTimeline, { type MenuTarget, type ProgramRange } from "./components/videoTimeline.vue";
import videoInspector from "./components/videoInspector.vue";
import sourceMonitor, { type SourceControl, type SourceFile } from "./components/sourceMonitor.vue";
import scrubBar from "./components/scrubBar.vue";
import liveTime from "./components/liveTime.vue";
import contextMenu, { type MenuItem } from "./components/contextMenu.vue";
import exportDialog from "./components/exportDialog.vue";
import canvasPicker from "./components/canvasPicker.vue";
import snapshotsPanel from "./components/snapshotsPanel.vue";

type SaveState = "saved" | "unsaved" | "saving" | "error";
type ExportState = { state: "running" | "done" | "error" | "cancelled"; progress: number; output: string; error?: string; controller?: AbortController };

const workspaceStore = useWorkspaceStore();
const directory = workspaceStore.project?.directory ?? "";
const media = createMedia(directory);
provide("videoMedia", media);
const clock = shallowRef(0);
provide("videoClock", clock);
const storage = (key: string) => `toonflow:video:${key}`;
const stored = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(storage(key)) ?? "null") ?? fallback; } catch { return fallback; }
};
const persisted = <T,>(key: string, fallback: T) => {
  const value = ref(stored(key, fallback));
  watch(value, next => localStorage.setItem(storage(key), JSON.stringify(next)), { deep: true });
  return value;
};

const panelElement = ref<HTMLElement>();
const monitorsElement = ref<HTMLElement>();
const programElement = ref<HTMLElement>();
const timelineRef = ref<InstanceType<typeof videoTimeline>>();
const active = ref(true);
const ready = ref(false);
const projects = shallowRef<VideoProjectEntry[] | null>(null);
const projectPath = ref("");
const projectListVisible = ref(false);
const loadingProject = ref(false);
const history = useHistory<VideoDoc>(newDoc());
const doc = computed(() => history.content.value);
const places = computed(() => placeAll(doc.value));
const length = computed(() => docLength(doc.value, places.value));
const projectName = computed(() => projectPath.value.split("/").pop()!.replace(/\.json$/i, ""));

// 播放头：`clock` 播放时每帧更新（只有预览、播放头和时间码读取），`time` 每 250 毫秒及停止时跟随，供属性面板与时间线使用。
const time = ref(0);
const playing = ref(false);
const rate = ref(1);
const now = () => clock.value;
let lastCommit = 0;
const selection = ref<string[]>([]);
const saveState = ref<SaveState>("saved");
const busy = ref("");
const note = ref<{ text: string; path?: string } | null>(null);
const menu = shallowRef<{ x: number; y: number; items: MenuItem[] } | null>(null);
const exportOptions = shallowRef<{ only?: VideoTrack; part?: { start: number; end: number } } | null>(null);
const exportState = ref<ExportState | null>(null);
const canvasPickerVisible = ref(false);
const shortcutsVisible = ref(false);
const watching = ref<{ path: string; url: string } | null>(null);
const refresh = ref(0);
const resizing = ref(false);
const recording = shallowRef<{ stop: () => void; since: number } | null>(null);
const recordingNow = ref(Date.now());
let clipboard: Clipboard | null = null;

const pps = persisted("pps", 40);
const minPps = 4;
const maxPps = 400;
const timelineHeight = persisted("timelineHeight", 280);
const assetsWidth = persisted("assetsWidth", 340);
const inspectorWidth = persisted("inspectorWidth", 320);
const sourceShare = persisted("sourceShare", 0.5);
const assetsOpen = persisted("assetsOpen", true);
const inspectorOpen = persisted("inspectorOpen", true);
const sourceOpen = persisted("sourceOpen", false);
const snapping = persisted("snapping", true);
const rippleOn = persisted("ripple", false);
const loop = persisted("loop", false);
const guideMode = persisted<GuideMode | null>("guide", null);
const heights = persisted<Record<string, number>>("trackHeights", {});
const ranges = persisted<Record<string, ProgramRange>>("ranges", {});
const marksMap = persisted<Record<string, SourceMarks>>("sourceMarks", {});
const zoom = ref<number | null>(null);
const shownScale = ref(1);
const ripple = computed(() => rippleOn.value);
const saveLabel = computed(() => ({ saved: translate("已保存"), saving: translate("保存中…"), unsaved: translate("已编辑"), error: translate("未保存") })[saveState.value]);
const recordingClock = computed(() => {
  const seconds = Math.max(0, Math.floor((recordingNow.value - (recording.value?.since ?? recordingNow.value)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});

function report(error: unknown) {
  const message = axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : String(error);
  ElMessage.error(message);
}

// ---- 工程列表与打开 ----

async function loadProjects() {
  try {
    projects.value = await listVideoProjects(media.files);
  } catch (error) {
    projects.value = [];
    report(error);
  }
}

async function newProject() {
  const session = projectSession;
  const ticket = opening;
  try {
    await flushSave();
    if (!currentSession(session) || ticket !== opening) return;
    const path = await createVideoProject(media.files, translate("剪辑"));
    await loadProjects();
    if (!currentSession(session) || ticket !== opening) return;
    await openProject(path);
  } catch (error) {
    report(error);
  }
}

let snapshot: Pick<TextSnapshot, "revision" | "encoding"> | null = null;
let lastSaved = "";
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | null = null;
let opening = 0;
let projectSession = 0;
let disposed = false;
const currentSession = (session: number) => !disposed && session === projectSession && workspaceStore.project?.directory === directory;

async function openProject(path: string) {
  projectListVisible.value = false;
  if (path === projectPath.value) {
    ++opening;
    loadingProject.value = false;
    return;
  }
  const ticket = ++opening;
  try {
    await flushSave();
    if (ticket !== opening || disposed) return;
    loadingProject.value = true;
    const loaded = await readVideoProject(media.files, path);
    if (ticket !== opening || disposed) return;
    // 读取目标工程期间仍可编辑旧工程，切换前必须再次排空保存。
    await flushSave();
    if (ticket !== opening || disposed) return;
    pauseAll();
    busy.value = "";
    note.value = null;
    watching.value = null;
    source.value = null;
    sourceControl.value = null;
    menu.value = null;
    exportOptions.value = null;
    canvasPickerVisible.value = false;
    cancelSave();
    snapshot = loaded.snapshot;
    lastSaved = serializeVideo(loaded.doc);
    projectPath.value = path;
    localStorage.setItem(storage(`last:${directory}`), path);
    history.reset(loaded.doc);
    playing.value = false;
    seek(0);
    selection.value = [];
    saveState.value = "saved";
    void backfillSizes(loaded.doc);
  } catch (error) {
    report(error);
  } finally {
    if (ticket === opening) loadingProject.value = false;
  }
}

/** 旧片段缺少像素尺寸时补读，使画框与蒙版比例正确。 */
async function backfillSizes(value: VideoDoc) {
  const session = projectSession;
  const missing = value.clips.filter(clip => clip.kind !== "audio" && clip.kind !== "effect" && !clip.width);
  if (!missing.length) return;
  const sizes = new Map<string, { width: number; height: number }>();
  await Promise.all([...new Set(missing.map(clip => clip.src))].map(async src => {
    const info = await media.probe(src).catch(() => null);
    if (info?.width && info.height) sizes.set(src, { width: info.width, height: info.height });
  }));
  if (currentSession(session) && sizes.size) history.live(patchClips(history.content.value, missing.map(clip => clip.id), clip => sizes.get(clip.src) ?? {}));
}

async function renameProject(path: string) {
  let name: string;
  try {
    ({ value: name } = await ElMessageBox.prompt(translate("名称"), translate("重命名剪辑工程"), { inputValue: path.split("/").pop()!.replace(/\.json$/i, ""), inputValidator: value => (!!value.trim() && !/[\\/:*?"<>|]/.test(value)) || translate("名称不能为空或包含特殊字符") }));
  } catch {
    return;
  }
  const target = `${path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : ""}${name.trim()}.json`;
  if (target === path) return;
  try {
    if (path === projectPath.value) await flushSave();
    while (saving) await saving;
    saving = media.files.rename(path, target).then(() => {
      if (path === projectPath.value) {
        projectPath.value = target;
        localStorage.setItem(storage(`last:${directory}`), target);
      }
    }).finally(() => { saving = null; });
    await saving;
    await flushSave();
    await loadProjects();
  } catch (error) {
    report(error);
  }
}

async function deleteProject(path: string) {
  try {
    await ElMessageBox.confirm(t`将删除工程文件“${path}”。时间线引用的素材与已导出的文件不会被删除，此操作无法撤销。`, translate("删除剪辑工程？"), { type: "warning", confirmButtonText: translate("删除") });
  } catch {
    return;
  }
  try {
    ++opening;
    while (saving) await saving;
    if (path === projectPath.value) {
      pauseAll();
      cancelSave();
      projectPath.value = "";
      snapshot = null;
      history.reset(newDoc());
      source.value = null;
      menu.value = null;
      exportOptions.value = null;
      canvasPickerVisible.value = false;
    }
    await media.files.remove(path);
    await loadProjects();
  } catch (error) {
    report(error);
  }
}

// ---- 保存：防抖覆盖写入；文件被外部修改时与本页未保存的修改三方合并后再写 ----

watch(() => history.content.value, () => {
  if (disposed || !projectPath.value) return;
  if (serializeVideo(history.content.value) === lastSaved) return;
  saveState.value = saving ? "saving" : "unsaved";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave().catch(() => {}), 600);
});

async function writeNow(path: string, session: number) {
  const value = history.content.value;
  const text = serializeVideo(value);
  if (text === lastSaved || !snapshot) return;
  const baseline = lastSaved;
  const expected = snapshot;
  const isCurrent = () => session === projectSession && path === projectPath.value;
  saveState.value = "saving";
  try {
    const revision = await saveVideoProject(media.files, path, value, expected);
    if (!isCurrent()) return;
    snapshot = { ...expected, revision };
    lastSaved = text;
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 409 || !isCurrent()) throw error;
    // 文件在别处被修改：以上次保存的内容为基准合并，再保存合并结果。
    const latest = await readVideoProject(media.files, path);
    if (!isCurrent()) return;
    const base = baseline ? normalizeDoc(JSON.parse(baseline)) : newDoc();
    const merged = mergeDocs(base, history.content.value, latest.doc);
    snapshot = latest.snapshot;
    lastSaved = serializeVideo(latest.doc);
    history.live(merged);
    const revision = await saveVideoProject(media.files, path, merged, latest.snapshot);
    if (!isCurrent()) return;
    snapshot = { ...latest.snapshot, revision };
    lastSaved = serializeVideo(merged);
  }
}

async function flushSave() {
  clearTimeout(saveTimer);
  const path = projectPath.value;
  const session = projectSession;
  if (!path) return;
  while (session === projectSession && path === projectPath.value) {
    if (saving) {
      await saving;
      continue;
    }
    clearTimeout(saveTimer);
    if (serializeVideo(history.content.value) === lastSaved || !snapshot) {
      saveState.value = "saved";
      return;
    }
    saving = writeNow(path, session).catch(error => {
      if (session === projectSession && path === projectPath.value) saveState.value = "error";
      report(error);
      throw error;
    }).finally(() => { saving = null; });
    await saving;
    // 写入期间发生的修改（包括冲突合并后的编辑）也必须保存后才能返回。
  }
}

function cancelSave() {
  projectSession++;
  clearTimeout(saveTimer);
  lastSaved = serializeVideo(history.content.value);
}

// ---- 播放头 ----

function seek(value: number) {
  const next = Math.max(0, Math.min(value, Math.max(length.value, 0)));
  clock.value = next;
  time.value = next;
}

watch(playing, value => { if (!value) time.value = clock.value; });

const range = computed(() => ranges.value[projectPath.value] ?? noRange);
const noRange: ProgramRange = { in: null, out: null };
function setRange(next: ProgramRange) {
  const { [projectPath.value]: _old, ...rest } = ranges.value;
  ranges.value = next.in === null && next.out === null ? rest : { ...rest, [projectPath.value]: next };
}
function markProgram(which: "in" | "out", at = now()) {
  const next = { ...range.value, [which]: at };
  if (next.in !== null && next.out !== null && next.out <= next.in) next[which === "in" ? "out" : "in"] = null;
  setRange(next);
}
const rangeBounds = () => ({ start: range.value.in ?? 0, end: range.value.out ?? length.value });

/** 预览每帧回报的时间；循环播放越过出点（或结尾）时回到入点（或开头）。 */
function onClockTime(value: number) {
  let looped = false;
  if (loop.value && rate.value > 0) {
    const { start, end } = rangeBounds();
    if (end - start > 0.05 && value >= end - 0.5 / doc.value.fps) [value, looped] = [start, true];
  }
  clock.value = value;
  const current = performance.now();
  if (current - lastCommit < 250 && !looped) return;
  lastCommit = current;
  time.value = value;
}

function onEnded() {
  playing.value = false;
  rate.value = 1;
  if (loop.value) {
    seek(rangeBounds().start);
    requestAnimationFrame(() => { playing.value = true; });
  }
}

function togglePlay() {
  if (!length.value) return;
  rate.value = 1;
  if (!playing.value && now() >= (loop.value ? range.value.out ?? length.value : length.value) - 1e-3) seek(loop.value ? range.value.in ?? 0 : 0);
  playing.value = !playing.value;
}

/** J / L：倒放 / 正放，同方向再按一次速度加倍（最高 8 倍）；K 停止。 */
function shuttle(direction: 1 | -1) {
  if (!length.value) return;
  const same = playing.value && Math.sign(rate.value) === direction;
  rate.value = same ? direction * Math.min(8, Math.abs(rate.value) * 2) : direction;
  if (!playing.value && direction > 0 && now() >= length.value - 1e-3) seek(0);
  playing.value = true;
}

/** ↑ / ↓：上一个 / 下一个编辑点（片段或文字边缘、标记）。 */
function jump(direction: 1 | -1) {
  const points = [...new Set(snapPoints(doc.value, places.value, -1, new Set()).filter(point => point >= 0).map(point => Math.round(point * 1000) / 1000))].sort((a, b) => a - b);
  const at = now();
  const next = direction > 0 ? points.find(point => point > at + 1e-3) : [...points].reverse().find(point => point < at - 1e-3);
  if (next !== undefined) seek(next);
}

// ---- 编辑 ----

const firstTrack = (kind: VideoTrack["kind"]) => (kind === "video" ? magneticTrack(history.content.value) : history.content.value.tracks.find(track => track.kind === kind)!);
const usedPaths = computed(() => new Set(doc.value.clips.map(clip => clip.src)));

/** 把文件放到轨道 `t` 处：磁性轨插入最近的间隙（或末尾），其他轨从 `t` 起依次排列；类型不符时放到第一条合适的轨道。 */
async function addFiles(paths: string[], track: VideoTrack, at: number | null) {
  const session = projectSession;
  const startAt = at ?? now();
  const usable = paths.filter(path => mediaKind(path));
  if (!usable.length) return ElMessage.warning(translate("只有视频、图片和音频能放到时间线上"));
  busy.value = t`正在读取 ${usable.length} 个文件…`;
  const settled = await Promise.allSettled(usable.map(path => media.clipFor(path, track.id)));
  if (!currentSession(session)) return;
  busy.value = "";
  track = history.content.value.tracks.find(item => item.id === track.id) ?? track;
  if (!history.content.value.tracks.includes(track)) return;
  const clips = settled.flatMap(result => (result.status === "fulfilled" && result.value ? [result.value] : []));
  const failed = settled.find(result => result.status === "rejected") as PromiseRejectedResult | undefined;
  if (failed) report(failed.reason);
  if (!clips.length) return;
  const made: string[] = [];
  history.set(value => {
    let next = value;
    let index = track.magnetic && at !== null ? insertIndex(value, at) : undefined;
    let start = startAt;
    for (const clip of clips) {
      const target = clip.kind === "audio" ? (track.kind === "audio" ? track : value.tracks.find(item => item.kind === "audio")!) : track.kind === "video" ? track : magneticTrack(value);
      const placed = { ...clip, track: target.id };
      next = { ...next, clips: [...next.clips, placed] };
      if (target.magnetic) {
        next = placeClip(next, placed.id, target.id, { index: index ?? Infinity });
        if (index !== undefined) index++;
      } else {
        next = placeClip(next, placed.id, target.id, { start });
        start += clipLength(placed);
      }
      made.push(placed.id);
    }
    return next;
  });
  selection.value = made;
}

const onDrop = (paths: string[], track: VideoTrack, at: number) => void addFiles(paths, track, at);

/** 直接放到时间线：视频与图片追加到 V1 末尾，声音放在播放头处。 */
function addToTimeline(path: string) {
  const kind = mediaKind(path);
  if (!kind) return;
  void (kind === "audio" ? addFiles([path], firstTrack("audio"), now()) : addFiles([path], magneticTrack(history.content.value), null));
}

async function importFiles(files: File[]) {
  const session = projectSession;
  try {
    busy.value = t`正在导入 ${files.length} 个文件…`;
    const paths: string[] = [];
    for (const file of files) {
      if (!currentSession(session)) return;
      paths.push(await media.importFile(file));
    }
    if (!currentSession(session)) return;
    busy.value = "";
    refresh.value++;
    for (const path of paths) addToTimeline(path);
  } catch (error) {
    if (currentSession(session)) {
      busy.value = "";
      report(error);
    }
  }
}

function importSrtText(text: string, name: string, trackId: string) {
  const cues = parseSrt(text);
  if (!cues.length) return ElMessage.warning(t`${name} 中没有找到字幕`);
  const style = history.content.value.texts.find(item => item.track === trackId && !item.shape)?.style ?? subtitleStyle;
  history.set(value => ({ ...value, texts: [...value.texts.filter(item => item.track !== trackId), ...cues.map(cue => ({ id: uid(), track: trackId, text: cue.text, start: cue.start, duration: cue.end - cue.start, style }))] }));
}

function exportSrt(track: VideoTrack) {
  const texts = doc.value.texts.filter(item => item.track === track.id);
  if (!texts.length) return ElMessage.warning(t`${track.name} 上没有文字`);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([formatSrt(texts)], { type: "text/plain;charset=utf-8" }));
  link.download = `${projectName.value} - ${track.name}.srt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function addText(at = now(), trackId?: string) {
  const track = trackId ?? firstTrack("text").id;
  const style = doc.value.texts.filter(item => item.track === track && !item.shape).pop()?.style ?? subtitleStyle;
  const id = uid();
  history.set(value => ({ ...value, texts: [...value.texts, { id, track, text: "", start: at, duration: textSeconds, style }] }));
  selection.value = [id];
}

/** 在播放头处的第一条文字轨添加文字项（文字、图形或贴纸）。 */
function addItem(item: { text: string; style: VideoTextStyle; shape?: VideoShape }) {
  const id = uid();
  const track = firstTrack("text").id;
  const start = now();
  history.set(value => ({ ...value, texts: [...value.texts, { id, track, start, duration: textSeconds, ...item }] }));
  selection.value = [id];
}

/** 在播放头处添加特效，放到有空位的最上层视频轨（没有时新建特效轨）。 */
function addEffect(kind: VideoEffectKind) {
  const value = history.content.value;
  const at = now();
  let next = value;
  let track = effectTrackFor(value, at, at + effectSeconds[kind]);
  if (!track) ({ doc: next, track } = addEffectTrack(value));
  const effect = newEffect(kind, track.id, at);
  history.set({ ...next, clips: [...next.clips, effect] });
  selection.value = [effect.id];
}

const addMarker = (at = now()) => history.set(value => ({ ...value, markers: [...value.markers, { id: uid(), time: at, label: "" }] }));
const markerHere = computed(() => doc.value.markers.some(marker => Math.abs(marker.time - time.value) < 0.5 / doc.value.fps));
function toggleMarker() {
  const near = doc.value.markers.find(marker => Math.abs(marker.time - now()) < 0.5 / doc.value.fps);
  if (near) history.set(value => remove(value, [near.id]));
  else addMarker();
}

function split(ids = selection.value) {
  const value = history.content.value;
  const at = now();
  const targets = ids.length ? ids : value.clips.filter(clip => {
    const place = places.value.get(clip.id)!;
    return clip.track === magneticTrack(value).id && at > place.start && at < place.end;
  }).map(clip => clip.id);
  const result = splitItems(value, targets, at);
  if (result.doc !== value) history.set(result.doc);
}

/** Shift+S / Ctrl+K：切开所有未锁定轨道上播放头经过的内容。 */
function splitAll() {
  const value = history.content.value;
  const result = splitItems(value, itemsAcross(value, now()), now());
  if (result.doc !== value) history.set(result.doc);
}

/** 删除选中项：V1 片段会带走其下其他轨道的内容并一起前移（见 syncDelete）。 */
function removeSelected(ids = selection.value) {
  if (!ids.length) return;
  history.set(value => syncDelete(value, ids, ripple.value));
  selection.value = [];
}

function rippleSelected(ids = selection.value) {
  if (!ids.length) return;
  history.set(value => syncDelete(value, ids, true));
  selection.value = [];
}

/** 切开并删除左 / 右侧：选中且被播放头经过的项（否则所有被经过的项）去掉播放头之前 / 之后的部分。 */
function splitSide(side: "left" | "right") {
  let value = history.content.value;
  const at = now();
  const across = itemsAcross(value, at);
  const chosen = selection.value.filter(id => across.includes(id));
  const targets = chosen.length ? chosen : across;
  if (!targets.length) return;
  let next = at;
  for (const id of targets) {
    const placeMap = placeAll(value);
    const text = value.texts.find(item => item.id === id);
    const start = text ? text.start : placeMap.get(id)!.start;
    const end = text ? text.start + text.duration : placeMap.get(id)!.end;
    value = trim(value, id, side === "left" ? "start" : "end", side === "left" ? at - start : at - end);
    // V1 片段裁掉开头后会合拢，原本在播放头的画面移到了片段起点。
    if (side === "left" && !text && value.tracks.find(track => track.id === value.clips.find(clip => clip.id === id)?.track)?.magnetic) next = Math.min(next, start);
  }
  history.set(value);
  seek(next);
}

/** Q / W：把播放头下的片段（优先选中的，否则 V1 的）的开头 / 结尾裁到播放头。 */
function trimToPlayhead(edge: "start" | "end") {
  const value = history.content.value;
  const at = now();
  const inside = (id: string) => at > places.value.get(id)!.start + 1e-3 && at < places.value.get(id)!.end - 1e-3;
  const magneticId = magneticTrack(value).id;
  const clip = value.clips.find(item => selection.value.includes(item.id) && inside(item.id)) ?? value.clips.find(item => item.track === magneticId && inside(item.id));
  if (!clip) return;
  const place = places.value.get(clip.id)!;
  history.set(trim(value, clip.id, edge, edge === "start" ? at - place.start : at - place.end));
  if (edge === "start" && clip.track === magneticId) seek(place.start);
}

/** 静音 / 隐藏选中项：有任一未开启则全部开启，否则全部关闭。 */
function toggleFlag(flag: "muted" | "hidden", ids = selection.value) {
  const value = history.content.value;
  const clips = value.clips.filter(clip => ids.includes(clip.id) && (flag === "hidden" ? clip.kind !== "audio" : clip.kind !== "image" && clip.kind !== "effect"));
  const texts = flag === "hidden" ? value.texts.filter(text => ids.includes(text.id)) : [];
  if (!clips.length && !texts.length) return;
  const on = [...clips, ...texts].some(item => !item[flag as "hidden"]);
  let next = patchClips(value, clips.map(clip => clip.id), { [flag]: on || undefined });
  if (texts.length) next = patchTexts(next, texts.map(text => text.id), () => ({ hidden: on || undefined }));
  history.set(next);
}

function join(ids = selection.value) {
  const value = history.content.value;
  const next = joinItems(value, ids);
  if (next === value) return ElMessage.warning(translate("没有可合并的内容：请选择被切开的片段，或切开后的几段（同一文件、相邻、中间未删除内容）"));
  history.set(next);
  selection.value = ids.filter(id => next.clips.some(clip => clip.id === id));
}

const copy = (ids = selection.value) => { clipboard = copyItems(doc.value, ids); };
function paste() {
  if (!clipboard) return;
  const result = pasteItems(history.content.value, clipboard, now());
  history.set(result.doc);
  selection.value = result.made;
}
function duplicateSelected(ids = selection.value) {
  if (!ids.length) return;
  const result = duplicate(history.content.value, ids);
  history.set(result.doc);
  selection.value = result.made;
}

function detach(id: string) {
  const result = detachAudio(history.content.value, id);
  if (!result.made) return;
  history.set(result.doc);
  selection.value = [result.made];
}

function photo(id: string) {
  const result = asPhoto(history.content.value, id);
  if (!result.made.length) return;
  history.set(result.doc);
  selection.value = [id];
}

const selectedPictures = computed(() => doc.value.clips.filter(clip => selection.value.includes(clip.id) && clip.kind !== "audio" && clip.kind !== "effect" && doc.value.tracks.find(track => track.id === clip.track)?.kind === "video"));
const selectedJoins = computed(() => {
  const magneticId = magneticTrack(doc.value).id;
  const first = doc.value.clips.find(clip => clip.track === magneticId)?.id;
  return selectedPictures.value.filter(clip => clip.track === magneticId && clip.id !== first);
});
const applyTransition = (kind: VideoTransitionKind | "cut", duration: number, direction?: VideoDirection) =>
  history.set(patchClips(history.content.value, selectedJoins.value.map(clip => clip.id), { transition: kind === "cut" ? undefined : { kind, duration, ...(direction && { direction }) } }));

const freezeTarget = computed(() => {
  const inside = (clip: VideoClip) => clip.kind === "video" && time.value > places.value.get(clip.id)!.start + 1e-3 && time.value < places.value.get(clip.id)!.end - 1e-3;
  return doc.value.clips.find(clip => selection.value.includes(clip.id) && inside(clip)) ?? doc.value.clips.find(clip => clip.track === magneticTrack(doc.value).id && inside(clip));
});

/** 定格：把播放头处的画面存为原尺寸图片，在片段两段之间保持 2 秒，并沿用片段的外观（填充、位置、裁切、调色…）。 */
async function freezeFrame(id: string) {
  const session = projectSession;
  const value = history.content.value;
  const clip = value.clips.find(item => item.id === id);
  const place = places.value.get(id);
  const at = now();
  if (!clip || !place || clip.kind !== "video" || at <= place.start || at >= place.end) return;
  try {
    busy.value = translate("正在生成静帧…");
    const path = await media.still(clip.src, clip.in + (at - place.start) * (clip.speed ?? 1), clip.name);
    if (!currentSession(session) || history.content.value !== value) return;
    const { id: _id, kind: _kind, src: _src, name: _name, in: _in, out: _out, srcDuration: _srcDuration, speed: _speed, volume: _volume, muted: _muted, audioFadeIn: _audioFadeIn, audioFadeOut: _audioFadeOut, transition: _transition, keys: _keys, fadeIn: _fadeIn, fadeOut: _fadeOut, kenBurns: _kenBurns, moveTo: _moveTo, start: _start, ...look } = clip;
    const still: VideoClip = { ...look, id: uid(), kind: "image", src: path, name: t`${clip.name}（定格）`, in: 0, out: 2 };
    history.set(current => {
      const result = splitItems(current, [id], at);
      const second = result.made[id];
      let next = { ...result.doc, clips: [...result.doc.clips, still] };
      const track = next.tracks.find(item => item.id === clip.track)!;
      if (track.magnetic) {
        const onTrack = next.clips.filter(item => item.track === track.id && item.id !== still.id);
        return placeClip(next, still.id, track.id, { index: onTrack.findIndex(item => item.id === second) });
      }
      next = placeClip(next, still.id, track.id, { start: at });
      return second ? patchClips(next, [second], item => ({ start: (item.start ?? at) + 2 })) : next;
    });
    selection.value = [still.id];
    refresh.value++;
  } catch (error) {
    report(error);
  } finally {
    if (currentSession(session)) busy.value = "";
  }
}

/** 播放头处的画面按导出效果保存为 PNG。 */
async function exportFrame() {
  const session = projectSession;
  try {
    busy.value = translate("正在渲染画面…");
    const path = await media.renderFrame(history.content.value, now(), projectName.value);
    if (!currentSession(session)) return;
    note.value = { text: t`已保存画面：${fileName(path)}`, path };
    refresh.value++;
  } catch (error) {
    report(error);
  } finally {
    if (currentSession(session)) busy.value = "";
  }
}

/** 导出当前工程；成功返回输出路径，失败或取消时更新导出状态后抛出（界面调用忽略异常）。 */
async function runExport(options: VideoExportOptions, signal?: AbortSignal) {
  void flushSave().catch(() => {});
  const controller = new AbortController();
  const exportSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  exportState.value = { state: "running", progress: 0, output: "", controller };
  try {
    const output = await media.runExport(history.content.value, options, projectName.value, progress => { if (exportState.value) exportState.value.progress = progress; }, exportSignal);
    exportState.value = { state: "done", progress: 1, output };
    refresh.value++;
    return output;
  } catch (error) {
    exportState.value = exportSignal.aborted
      ? { state: "cancelled", progress: 0, output: "" }
      : { state: "error", progress: 0, output: "", error: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}

// ---- Agent ----

// 每次内容变化（含撤销、用户编辑、切换工程）都换新的 revision，Agent 基于旧内容的修改会被拒绝。
let docRevision = 0;
watch(() => history.content.value, () => docRevision++, { flush: "sync" });
const revisionOf = () => `${projectPath.value}#${docRevision}`;

function agentState() {
  return {
    projects: (projects.value ?? []).slice(0, 100),
    project: projectPath.value ? { path: projectPath.value, name: projectName.value } : null,
    revision: revisionOf(),
    ...(projectPath.value ? describeDoc(history.content.value) : {}),
    playhead: Math.round(time.value * 1000) / 1000,
    selection: selection.value,
    ...(exportState.value && { lastExport: { state: exportState.value.state, output: exportState.value.output, ...(exportState.value.error && { error: exportState.value.error }) } }),
  };
}

async function agentCall(name: string, args: Record<string, unknown>, signal: AbortSignal) {
  signal.throwIfAborted();
  if (name === "getVideoEditor") {
    if (!projects.value) await loadProjects();
    return agentState();
  }
  if (name === "openVideoProject") {
    const session = projectSession;
    await flushSave();
    const path = typeof args.create === "string" ? await createVideoProject(media.files, args.create) : String(args.path);
    if (!currentSession(session)) throw new Error("工作区已切换，本次调用已停止");
    await loadProjects();
    if (!projects.value?.some(item => item.path === path)) throw new Error(`没有剪辑工程 ${path}`);
    await openProject(path);
    signal.throwIfAborted();
    if (projectPath.value !== path) throw new Error("剪辑工程打开失败");
    return agentState();
  }
  if (!projectPath.value) throw new Error("还没有打开剪辑工程，先用 openVideoProject 打开或新建");
  if (name === "editVideo") {
    if (args.revision !== revisionOf()) throw new Error("剪辑工程在此期间已被修改，请重新 getVideoEditor 后基于最新内容重做");
    const ops = args.ops as Parameters<typeof applyOps>[1];
    const base = history.content.value;
    const path = projectPath.value;
    const probed = await probeOps(ops, media.clipFor);
    signal.throwIfAborted();
    if (projectPath.value !== path || history.content.value !== base) throw new Error("剪辑工程在读取素材期间已被修改，请重新 getVideoEditor 后再试");
    const result = applyOps(base, ops, probed);
    if (result.doc !== base) history.set(result.doc);
    if (result.made.length) selection.value = result.made.filter(id => result.doc.clips.some(clip => clip.id === id) || result.doc.texts.some(text => text.id === id));
    return { ...agentState(), made: result.made };
  }
  if (name === "exportVideo") {
    if (!length.value) throw new Error("时间线是空的，没有可导出的内容");
    if (exportState.value?.state === "running") throw new Error("正在导出，等这次导出完成后再试");
    const output = await runExport(args as VideoExportOptions, signal);
    return { output, format: args.format ?? "mp4", length: Math.round(length.value * 1000) / 1000 };
  }
  throw new Error(`未知剪辑操作 ${name}`);
}

async function playOutput(path: string) {
  const session = projectSession;
  try {
    const url = await media.url(path);
    if (currentSession(session)) watching.value = { path, url };
  } catch (error) {
    report(error);
  }
}

const reveal = (path: string) => void media.files.reveal(path).catch(report);

/** 录制配音：从播放头开始边播边录（建议戴耳机），停止后放到当时空闲的音频轨。 */
let recordingTimer: ReturnType<typeof setInterval> | undefined;
let requestingRecording = false;
async function toggleRecording() {
  if (recording.value) return recording.value.stop();
  if (requestingRecording) return;
  const session = projectSession;
  requestingRecording = true;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    return report(new Error(t`无法使用麦克风：${(error as Error).message}`));
  } finally {
    requestingRecording = false;
  }
  if (!currentSession(session) || !active.value) {
    stream.getTracks().forEach(track => track.stop());
    return;
  }
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(item => MediaRecorder.isTypeSupported(item));
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  const start = now();
  const path = projectPath.value;
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach(track => track.stop());
    recording.value = null;
    clearInterval(recordingTimer);
    if (!currentSession(session)) return;
    playing.value = false;
    const blob = new Blob(chunks, { type: recorder.mimeType });
    if (!blob.size || path !== projectPath.value) return;
    try {
      busy.value = translate("正在保存配音…");
      const output = await media.convertRecording(blob, recorder.mimeType.includes("ogg") ? "ogg" : "webm");
      if (!currentSession(session)) return;
      const clip = await media.clipFor(output, "");
      if (!clip || !currentSession(session)) return;
      history.set(value => {
        const end = start + clipLength(clip);
        let next = value;
        let track = freeTrackAt(value, "audio", start, end);
        if (!track) ({ doc: next, track } = addTrack(value, "audio"));
        next = { ...next, clips: [...next.clips, { ...clip, track: track.id, name: translate("配音") }] };
        return placeClip(next, clip.id, track.id, { start });
      });
      selection.value = [clip.id];
      refresh.value++;
    } catch (error) {
      report(error);
    } finally {
      if (currentSession(session)) busy.value = "";
    }
  };
  recorder.start(1000);
  recording.value = { stop: () => recorder.state !== "inactive" && recorder.stop(), since: Date.now() };
  recordingTimer = setInterval(() => { recordingNow.value = Date.now(); }, 500);
  rate.value = 1;
  if (length.value && now() < length.value - 1e-3) playing.value = true;
}

/** 提升（保留空隙）或提取（合拢）入点到出点之间的内容。 */
function cutRange(rippleRange: boolean) {
  if (range.value.in === null && range.value.out === null) return ElMessage.warning(translate("请先在时间线上标记入点（I）和 / 或出点（O）"));
  const { start, end } = rangeBounds();
  history.set(value => removeRange(value, start, end, rippleRange));
  selection.value = [];
  seek(start);
  if (rippleRange) setRange(noRange);
}

function deleteTrack(track: VideoTrack) {
  const session = projectSession;
  const used = doc.value.clips.filter(clip => clip.track === track.id).length + doc.value.texts.filter(text => text.track === track.id).length;
  const drop = () => {
    if (currentSession(session)) history.set(value => ({ ...value, tracks: value.tracks.filter(item => item.id !== track.id), clips: value.clips.filter(clip => clip.track !== track.id), texts: value.texts.filter(text => text.track !== track.id) }));
  };
  if (!used) return drop();
  void ElMessageBox.confirm(t`轨道上的 ${used} 项内容会一起删除（Ctrl+Z 可恢复）。`, t`删除 ${track.name}？`, { type: "warning", confirmButtonText: translate("删除") }).then(drop, () => {});
}

function setHeight(trackId: string, height: number | null) {
  const { [trackId]: _old, ...rest } = heights.value;
  heights.value = height === null ? rest : { ...rest, [trackId]: height };
}

function fitTimeline() {
  const width = timelineRef.value?.fit() ?? 800;
  pps.value = Math.min(maxPps, Math.max(minPps, (width - 180) / Math.max(length.value, 5)));
}

function fullScreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void programElement.value?.requestFullscreen().catch(() => {});
}

function restoreSnapshot(value: VideoDoc, name: string) {
  history.set(value);
  selection.value = [];
  busy.value = t`已恢复“${name}”· Ctrl+Z 撤销`;
  setTimeout(() => { if (busy.value.includes(name)) busy.value = ""; }, 4000);
}

// ---- 源监视器 ----

const source = shallowRef<SourceFile | null>(null);
const sourceControl = shallowRef<SourceControl | null>(null);
const sourceTarget = ref<string | null>(null);
const focus = ref<"source" | "program">("program");
const marks = computed(() => (source.value && marksMap.value[source.value.path]) || { in: null, out: null });
function setMarks(path: string, value: SourceMarks) {
  const { [path]: _old, ...rest } = marksMap.value;
  marksMap.value = value.in === null && value.out === null ? rest : { ...Object.fromEntries(Object.entries(rest).slice(-199)), [path]: value };
}
const sourceTargets = computed(() => (source.value ? doc.value.tracks.filter(track => fits(source.value!.clip, track) && !track.locked) : []));
// 已选轨道仍适用时用它，否则画面放 V1、声音放第一条音频轨。
const sourceTargetId = computed(() => sourceTargets.value.find(track => track.id === sourceTarget.value)?.id ?? sourceTargets.value.find(track => track.magnetic)?.id ?? sourceTargets.value.find(track => track.kind === "audio")?.id ?? sourceTargets.value[0]?.id ?? null);

/** 在源监视器打开文件（`marks`：例如时间线片段的入出点）。 */
let sourceRequest = 0;
async function openSource(path: string, value?: SourceMarks) {
  const session = projectSession;
  const request = ++sourceRequest;
  if (!mediaKind(path)) return;
  try {
    busy.value = t`正在读取 ${fileName(path)}…`;
    const clip = await media.clipFor(path, "");
    if (!clip || !currentSession(session) || request !== sourceRequest) return;
    if (value) setMarks(path, value);
    source.value = { path, clip };
    sourceOpen.value = true;
    focus.value = "source";
  } catch (error) {
    report(error);
  } finally {
    if (currentSession(session)) busy.value = "";
  }
}

/** 在轨道 `at` 处插入或覆盖标记区间；播放头移到其末尾。 */
function putSource(mode: "insert" | "overwrite", at = now(), trackId = sourceTargetId.value) {
  if (!source.value) return;
  if (!trackId) return ElMessage.warning(t`没有可放置 ${source.value.clip.name} 的未锁定轨道`);
  const clip = { ...rangeClip(source.value.clip, marks.value), id: uid() };
  history.set(value => putRange(value, clip, trackId, at, mode));
  selection.value = [clip.id];
  seek(at + clipLength(clip));
}

/** 手柄拖到轨道：V1 上插入最近的间隙，其他轨覆盖原有内容。 */
function dropSource(track: VideoTrack, at: number) {
  if (!source.value) return;
  if (!fits(source.value.clip, track)) return ElMessage.warning(t`${source.value.clip.name} 不能放到 ${track.name}`);
  if (!track.magnetic) return putSource("overwrite", at, track.id);
  const onTrack = doc.value.clips.filter(clip => clip.track === track.id);
  const index = insertIndex(doc.value, at);
  putSource("insert", index ? places.value.get(onTrack[index - 1]!.id)!.end : 0, track.id);
}

// ---- 菜单 ----

function timelineMenu(event: MouseEvent, target: MenuTarget, at: number) {
  const session = projectSession;
  const items: MenuItem[] = [];
  if (target.marker) {
    const marker = doc.value.markers.find(item => item.id === target.marker)!;
    items.push(
      { label: translate("重命名标记…"), onClick: () => void ElMessageBox.prompt(translate("标签"), translate("标记"), { inputValue: marker.label }).then(({ value }) => { if (currentSession(session)) history.set(current => ({ ...current, markers: current.markers.map(item => (item.id === marker.id ? { ...item, label: value } : item)) })); }, () => {}) },
      { label: translate("删除标记"), danger: true, onClick: () => history.set(current => remove(current, [marker.id])) },
    );
  } else if (target.item) {
    const ids = selection.value.includes(target.item) ? selection.value : [target.item];
    const clip = doc.value.clips.find(item => item.id === target.item);
    const text = doc.value.texts.find(item => item.id === target.item);
    const itemTrack = doc.value.tracks.find(track => track.id === (clip ?? text)?.track);
    const place = clip ? places.value.get(clip.id) : text ? { start: text.start, end: text.start + text.duration } : undefined;
    const inside = clip && place && at > place.start && at < place.end;
    items.push(
      ...(clip && clip.kind !== "effect" ? [{ label: translate("在源监视器打开"), hint: translate("文件中此片段的入点与出点已标记"), onClick: () => void openSource(clip.src, clip.kind === "image" ? undefined : { in: clip.in, out: clip.out }) }] : []),
      { label: translate("在播放头处切开"), keys: "S", onClick: () => split(ids) },
      ...(clip && canJoin(doc.value, ids) ? [{ label: translate("合并"), hint: translate("与切开的另一段接回"), onClick: () => join(ids) }] : []),
      { label: translate("开头裁到播放头"), keys: "Q", onClick: () => trimToPlayhead("start") },
      { label: translate("结尾裁到播放头"), keys: "W", onClick: () => trimToPlayhead("end") },
      { label: translate("复制一份"), keys: "Ctrl+D", onClick: () => duplicateSelected(ids) },
      ...(itemTrack && place ? [{ label: translate("导出此片段…"), hint: translate("仅此轨、仅此片段的时间"), onClick: () => { exportOptions.value = { only: itemTrack, part: place }; } }] : []),
      { label: (clip ? clip.hidden : text?.hidden) ? translate("显示") : translate("隐藏"), hint: translate("不绘制画面，片段声音照常播放"), onClick: () => toggleFlag("hidden", ids) },
      { label: translate("复制"), keys: "Ctrl+C", onClick: () => copy(ids) },
      ...(clip && clip.kind !== "image" && clip.kind !== "effect" ? [{ label: clip.muted ? translate("取消静音") : translate("静音"), onClick: () => history.set(patchClips(history.content.value, [clip.id], { muted: !clip.muted || undefined })) }] : []),
      ...(clip && clip.kind === "video" && itemTrack?.kind === "video" ? [{ label: translate("分离音频"), hint: translate("声音成为音频轨上的独立片段"), onClick: () => detach(clip.id) }] : []),
      ...(clip && clip.kind !== "effect" && itemTrack?.kind === "video" ? [
        { label: translate("填充画面"), submenu: (["fit", "fill", "blur"] as const).map(fit => ({ label: translate({ fit: "适应（黑边）", fill: "填充（裁切）", blur: "适应 + 模糊背景" }[fit]), checked: (clip.fit ?? "fit") === fit, onClick: () => history.set(patchClips(history.content.value, ids, { fit: fit === "fit" ? undefined : fit })) })) },
        { label: translate("做成老照片"), hint: translate("缩小、加白边、叠在模糊背景上，并在角落写日期"), onClick: () => photo(clip.id) },
      ] : []),
      ...(clip && clip.kind === "video" && itemTrack?.kind === "video" && inside ? [{ label: translate("在播放头处定格"), hint: translate("把这一帧保持 2 秒后继续播放"), onClick: () => void freezeFrame(clip.id) }] : []),
      ...(clip && clip.kind !== "effect" ? [{ label: translate("在文件夹中显示"), onClick: () => reveal(clip.src) }] : []),
      "sep",
      { label: ids.length > 1 ? t`删除 ${ids.length} 项` : translate("删除"), keys: "Del", danger: true, onClick: () => removeSelected(ids) },
      { label: translate("波纹删除"), keys: "Shift+Del", hint: translate("删除并合拢空隙"), danger: true, onClick: () => rippleSelected(ids) },
    );
  } else {
    const gap = target.track && !target.track.magnetic && !target.track.locked ? gapAt(doc.value, target.track.id, at) : null;
    items.push(
      { label: translate("把播放头移到这里"), onClick: () => seek(at) },
      ...(gap ? [{ label: t`合拢此空隙（${(gap.end - gap.start).toFixed(2)} 秒）`, hint: translate("此轨后面的内容前移"), onClick: () => history.set(value => closeGaps(value, target.track!.id, at)) }] : []),
      ...(target.track?.kind === "text" ? [{ label: translate("在此添加文字"), keys: "T", onClick: () => addText(at, target.track!.id) }] : []),
      { label: translate("在此添加标记"), keys: "M", onClick: () => addMarker(at) },
      { label: translate("在此标记入点"), keys: "I", onClick: () => markProgram("in", at) },
      { label: translate("在此标记出点"), keys: "O", onClick: () => markProgram("out", at) },
      ...(range.value.in !== null || range.value.out !== null ? [
        { label: translate("提升入点到出点"), keys: ";", onClick: () => cutRange(false) },
        { label: translate("提取入点到出点"), keys: "'", hint: translate("并合拢空隙"), onClick: () => cutRange(true) },
        { label: translate("清除入点与出点"), keys: "Alt+X", onClick: () => setRange(noRange) },
      ] : []),
      { label: translate("在播放头处切开所有轨道"), keys: "Shift+S", onClick: splitAll },
      ...(clipboard ? [{ label: translate("粘贴"), keys: "Ctrl+V", onClick: paste }] : []),
      { label: translate("从画布挑选素材…"), hint: translate("放入源监视器"), onClick: () => { canvasPickerVisible.value = true; } },
    );
  }
  if (target.track && !target.item) {
    const track = target.track;
    items.push(
      "sep",
      { label: translate("导出此轨…"), hint: track.kind === "audio" ? translate("仅此轨声音，WAV 或 MP3") : track.kind === "text" ? translate("仅此轨文字叠在背景上") : translate("仅此轨的画面与声音"), onClick: () => { exportOptions.value = { only: track }; } },
      { label: t`重命名 ${track.name}…`, onClick: () => void ElMessageBox.prompt(translate("名称"), translate("重命名轨道"), { inputValue: track.name, inputValidator: value => !!value.trim() || translate("请输入名称") }).then(({ value }) => { if (currentSession(session)) history.set(patchTracks(history.content.value, track.id, { name: value.trim() })); }, () => {}) },
      ...(track.kind === "text" ? [{ label: translate("导出为 .srt"), onClick: () => exportSrt(track) }] : []),
      ...(!track.magnetic && !track.locked ? [{ label: t`合拢 ${track.name} 上的所有空隙`, onClick: () => history.set(value => closeGaps(value, track.id)) }] : []),
      ...(heights.value[track.id] ? [{ label: translate("恢复默认高度"), onClick: () => setHeight(track.id, null) }] : []),
      { label: translate("添加轨道"), submenu: (["video", "audio", "text"] as const).map(kind => ({ label: translate({ video: "视频轨", audio: "音频轨", text: "文字轨" }[kind]), onClick: () => history.set(addTrack(history.content.value, kind).doc) })) },
      ...(!track.magnetic ? [{ label: t`删除 ${track.name}`, danger: true, onClick: () => deleteTrack(track) }] : []),
    );
  }
  menu.value = { x: event.clientX, y: event.clientY, items };
}

function assetMenu(event: MouseEvent, path: string) {
  const kind = mediaKind(path);
  const items: MenuItem[] = [
    { label: translate("在源监视器打开"), hint: translate("标记入出点后插入或覆盖"), onClick: () => void openSource(path) },
    "sep",
    ...(kind === "audio" ? [{ label: translate("添加到播放头处的音频轨"), onClick: () => void addFiles([path], firstTrack("audio"), now()) }] : [
      { label: translate("添加到 V1 末尾"), onClick: () => void addFiles([path], magneticTrack(history.content.value), null) },
      ...doc.value.tracks.filter(track => track.kind === "video" && !track.magnetic && !track.locked).map(track => ({ label: t`添加到 ${track.name} 的播放头处`, onClick: () => void addFiles([path], track, now()) })),
      ...(kind === "video" ? [{ label: translate("把声音添加到播放头处的音频轨"), onClick: () => void addFiles([path], firstTrack("audio"), now()) }] : []),
    ]),
    "sep",
    { label: translate("在文件夹中显示"), onClick: () => reveal(path) },
    { label: translate("复制路径"), onClick: () => void navigator.clipboard?.writeText(path) },
  ];
  menu.value = { x: event.clientX, y: event.clientY, items };
}

// ---- 拖动调整面板 ----

function startResize(event: PointerEvent, which: "assets" | "inspector" | "timeline" | "source") {
  if (event.button !== 0) return;
  event.preventDefault();
  const [x0, y0] = [event.clientX, event.clientY];
  const start = { assets: assetsWidth.value, inspector: inspectorWidth.value, timeline: timelineHeight.value, source: sourceShare.value }[which];
  const total = monitorsElement.value?.offsetWidth ?? 1;
  resizing.value = true;
  const move = (moveEvent: PointerEvent) => {
    const dx = moveEvent.clientX - x0;
    const dy = moveEvent.clientY - y0;
    if (which === "assets") assetsWidth.value = Math.round(Math.min(640, Math.max(240, start + dx)));
    else if (which === "inspector") inspectorWidth.value = Math.round(Math.min(640, Math.max(240, start - dx)));
    else if (which === "timeline") timelineHeight.value = Math.round(Math.min(innerHeight - 260, Math.max(140, start - dy)));
    else sourceShare.value = Math.min(0.8, Math.max(0.2, start + dx / total));
  };
  const up = () => {
    resizing.value = false;
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}

// ---- 快捷键 ----

const shortcuts: [string | ReturnType<typeof msg>, ReturnType<typeof msg>][] = [
  ["Space", msg`播放 / 暂停`], ["J / K / L", msg`倒放（再按加速）/ 停止 / 正放（再按加速）`],
  ["← →", msg`前后一帧（Shift：一秒）`], ["↑ ↓", msg`上一个 / 下一个编辑点`], ["Home / End", msg`开头 / 结尾`],
  ["I / O", msg`在当前监视器标记入点 / 出点（Shift：跳转，Alt+X：清除）`], [", / .", msg`把源监视器的区间插入 / 覆盖到播放头处`],
  ["; / '", msg`提升 / 提取节目入点到出点（提取会合拢）`],
  ["S / C", msg`在播放头处切开选中项（或 V1 片段）`], ["Shift+S / Ctrl+K", msg`切开所有未锁定轨道`],
  ["Q / W", msg`片段开头 / 结尾裁到播放头`], ["Delete", msg`删除选中项（V1 片段会带走其下内容并同步前移）`], ["Shift+Delete", msg`波纹删除：合拢空隙`],
  ["Ctrl+C / X / V / D", msg`复制 / 剪切 / 在播放头处粘贴 / 复制一份`], ["Ctrl+A", msg`全选`], [msg`在轨道空白处拖动`, msg`框选（Shift 追加）`],
  ["T", msg`在播放头处添加文字`], ["M", msg`在播放头处添加标记`], ["N", msg`开关吸附`], ["F", msg`节目监视器全屏`],
  ["Ctrl+Z / Ctrl+Shift+Z", msg`撤销 / 重做`], ["Ctrl+滚轮", msg`缩放时间线`], ["Esc", msg`取消选择`],
];

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

function keydown(event: KeyboardEvent) {
  if (!active.value || !projectPath.value || isTyping(event.target) || menu.value || exportOptions.value || canvasPickerVisible.value || shortcutsVisible.value || watching.value) return;
  if (document.querySelector(".el-overlay-message-box, .el-message-box") || !panelElement.value?.offsetParent) return;
  if ((event.target as HTMLElement)?.closest?.("#agentPanel, .floatingAgent")) return;
  const modifier = event.ctrlKey || event.metaKey;
  const frame = 1 / doc.value.fps;
  const key = event.key.toLowerCase();
  const control = sourceControl.value;
  if (modifier && key === "z") {
    event.preventDefault();
    if (event.shiftKey) history.redo();
    else history.undo();
  } else if (modifier && key === "y") {
    event.preventDefault();
    history.redo();
  } else if (modifier && key === "c") copy();
  else if (modifier && key === "x") {
    copy();
    removeSelected();
  } else if (modifier && key === "v") {
    event.preventDefault();
    paste();
  } else if (modifier && key === "d") {
    event.preventDefault();
    duplicateSelected();
  } else if (modifier && key === "a") {
    event.preventDefault();
    selection.value = [...doc.value.clips.map(clip => clip.id), ...doc.value.texts.map(text => text.id)];
  } else if (modifier && key === "k") {
    event.preventDefault();
    splitAll();
  } else if (modifier) return;
  else if (event.altKey && key === "x") {
    if (source.value && focus.value === "source") setMarks(source.value.path, { in: null, out: null });
    else setRange(noRange);
  } else if ((key === "i" || key === "o") && (focus.value === "program" || !source.value || !control)) {
    event.preventDefault();
    if (event.shiftKey) seek(key === "i" ? range.value.in ?? 0 : range.value.out ?? length.value);
    else markProgram(key === "i" ? "in" : "out");
  } else if ((key === "i" || key === "o") && source.value && control) {
    event.preventDefault();
    if (event.shiftKey) control.seek(key === "i" ? marks.value.in ?? 0 : marks.value.out ?? source.value.clip.srcDuration ?? source.value.clip.out);
    else setMarks(source.value.path, markAt(marks.value, key === "i" ? "in" : "out", control.time()));
  } else if (event.key === ";" || event.key === "'") cutRange(event.key === "'");
  else if (key === "j" || key === "l") {
    event.preventDefault();
    if (focus.value === "source" && control) control.toggle();
    else shuttle(key === "l" ? 1 : -1);
  } else if (key === "n") snapping.value = !snapping.value;
  else if (key === "f") fullScreen();
  else if (event.key === "?") shortcutsVisible.value = true;
  else if (event.key === "," || event.key === ".") {
    if (source.value) putSource(event.key === "," ? "insert" : "overwrite");
  } else if (key === "q" || key === "w") trimToPlayhead(key === "q" ? "start" : "end");
  else if (focus.value === "source" && control && (event.key === " " || key === "k" || event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    if (event.key === " " || key === "k") control.toggle();
    else control.seek(control.time() + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : frame));
  } else if (key === "k") {
    playing.value = false;
    rate.value = 1;
  } else if (event.key === " ") {
    event.preventDefault();
    togglePlay();
  } else if (key === "s" && event.shiftKey) splitAll();
  else if (key === "s" || key === "c") split();
  else if ((event.key === "Delete" || event.key === "Backspace") && event.shiftKey) rippleSelected();
  else if (event.key === "Delete" || event.key === "Backspace") removeSelected();
  else if (key === "t") {
    event.preventDefault();
    addText();
  } else if (key === "m") addMarker();
  else if (event.key === "ArrowLeft") {
    event.preventDefault();
    seek(now() - (event.shiftKey ? 1 : frame));
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    seek(now() + (event.shiftKey ? 1 : frame));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    jump(-1);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    jump(1);
  } else if (event.key === "Home") seek(0);
  else if (event.key === "End") seek(length.value);
  else if (event.key === "Escape") selection.value = [];
}

function pauseAll() {
  playing.value = false;
  recording.value?.stop();
  panelElement.value?.querySelectorAll("video, audio").forEach(element => (element as HTMLMediaElement).pause());
}

onMounted(async () => {
  addEventListener("keydown", keydown);
  await loadProjects();
  const last = localStorage.getItem(storage(`last:${directory}`));
  const initial = projects.value?.find(item => item.path === last)?.path ?? projects.value?.[0]?.path;
  if (initial) await openProject(initial);
  ready.value = true;
});
onActivated(() => {
  active.value = true;
  refresh.value++;
});
onDeactivated(() => {
  active.value = false;
  pauseAll();
  void flushSave().catch(() => {});
});
onBeforeUnmount(() => {
  disposed = true;
  ++opening;
  void flushSave().catch(() => {});
  removeEventListener("keydown", keydown);
  pauseAll();
  clearInterval(recordingTimer);
  media.dispose();
});

defineExpose({ ready, flushSave, cancelSave, agentCall, folders: videoFolders });
</script>

<style lang="scss">
.videoPanel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 60px calc(var(--agentWidth, 0px) + 10px) 10px 10px;
  gap: 8px;
  overflow: hidden;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);

  &.resizing { cursor: col-resize; user-select: none; }

  .spacer { flex: 1; }

  .videoHead {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 6px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
    background: var(--el-bg-color);
    font-size: 12px;

    .projectTrigger { max-width: 280px; font-weight: 600; }
    .projectName { overflow: hidden; text-overflow: ellipsis; }
    .saveState { color: var(--el-text-color-secondary); }
    .saveState.unsaved, .saveState.saving { color: var(--el-color-warning); }
    .saveState.error { color: var(--el-color-danger); }
    .headNote { display: inline-flex; align-items: center; gap: 4px; overflow: hidden; color: var(--el-text-color-secondary); white-space: nowrap; }
    .recordBadge { padding: 2px 8px; border: none; border-radius: 10px; background: var(--el-color-danger); color: #fff; font-size: 11px; cursor: pointer; }
    .el-button + .el-button { margin-left: 0; }

    .exportBadge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 420px;
      overflow: hidden;
      white-space: nowrap;

      &.done { color: var(--el-color-success); }
      .exportError { overflow: hidden; color: var(--el-color-danger); text-overflow: ellipsis; }
      .progressBar { width: 90px; height: 6px; overflow: hidden; border-radius: 3px; background: var(--el-fill-color-darker); }
      .progressBar span { display: block; height: 100%; background: var(--el-color-primary); }
    }
  }

  .headIcon, .barIcon {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    padding: 0 4px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--el-text-color-regular);
    font-size: 14px;
    cursor: pointer;

    &:hover:not(:disabled) { background: var(--el-fill-color-light); }
    &:disabled { opacity: 0.4; cursor: default; }
    &.on { background: color-mix(in srgb, var(--el-color-primary) 14%, transparent); color: var(--el-color-primary); }
    &.play { color: var(--el-color-primary); }
  }

  .videoEmpty {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
    text-align: center;
  }

  .videoCard {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
    background: var(--el-bg-color);
  }

  .videoUpper { display: flex; flex: 1; gap: 8px; min-height: 0; }
  .assetsCard, .inspectorCard { flex-shrink: 0; }
  .previewCard { flex: 1; }

  .paneHandle {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 10;
    width: 6px;
    cursor: col-resize;

    &.right { right: 0; }
    &.left { left: 0; }
    &:hover { background: color-mix(in srgb, var(--el-color-primary) 30%, transparent); }
  }

  .monitors { display: flex; flex: 1; min-height: 0; }
  .sourcePane { display: flex; flex-shrink: 0; min-width: 0; }
  .monitorSplit { width: 5px; flex-shrink: 0; cursor: col-resize; background: var(--el-border-color-lighter); }
  .programPane { display: flex; flex: 1; flex-direction: column; min-width: 0; border: 1px solid transparent; }
  .programPane.active { border-color: color-mix(in srgb, var(--el-color-primary) 50%, transparent); }
  .programPane .scrubBar { margin-top: 8px; }

  .previewBar {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 38px;
    padding: 0 8px;
    font-size: 12px;

    .timecode { font-variant-numeric: tabular-nums; }
    .total { color: var(--el-text-color-secondary); }
    .rateBadge { margin-left: 6px; color: var(--el-color-warning); }
    .zoomPick { width: 110px; }
    .guidePick { width: 140px; margin-left: 4px; }
  }

  .rowsHandle { flex-shrink: 0; height: 4px; margin: -4px 0; cursor: row-resize; }
  .rowsHandle:hover { background: color-mix(in srgb, var(--el-color-primary) 30%, transparent); }
  .timelineCard { flex-shrink: 0; }

  .timelineToolbar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    min-height: 36px;
    padding: 0 6px;
    overflow-x: auto;
    border-bottom: 1px solid var(--el-border-color-lighter);

    .toolbarSeparator { width: 1px; height: 18px; margin: 0 4px; background: var(--el-border-color); }
    .framePill { padding: 2px 8px; border-radius: 10px; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 11px; white-space: nowrap; }
    .ppsSlider { width: 110px; margin: 0 6px; }
    .el-button + .el-button { margin-left: 0; }
  }
}

.projectPicker {
  .pickerToolbar { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; font-weight: 600; }
  .spacer { flex: 1; }
  .pickerEmpty { padding: 10px 4px; color: var(--el-text-color-secondary); font-size: 12px; }
  .projectRow {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 5px;
    cursor: pointer;

    &:hover { background: var(--el-fill-color-light); }
    &.active { color: var(--el-color-primary); }
    .projectRowName { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .el-button + .el-button { margin-left: 0; }
  }
}

.shortcutTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  td { padding: 5px 8px; border-bottom: 1px solid var(--el-border-color-lighter); }
  kbd { padding: 1px 6px; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-fill-color-light); font-family: inherit; font-size: 12px; white-space: nowrap; }
}

.watchMedia { display: block; width: 100%; max-height: 70vh; }
</style>
