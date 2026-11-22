<template>
  <el-dialog :modelValue="true" :title="title" width="min(520px, calc(100vw - 32px))" appendToBody @close="emit('close')">
    <el-form class="exportForm" labelPosition="top" size="small">
      <p class="exportHint">导出到工作区的 exports 文件夹，顶部显示进度。如需另行配音：单独导出人声轨为 WAV，再导出取消勾选该轨（或不勾选任何声音）的 MP4。</p>
      <el-form-item label="格式">
        <el-radio-group v-model="format">
          <el-radio value="mp4">MP4 视频</el-radio>
          <el-radio value="gif">GIF 动图</el-radio>
          <el-radio value="mp3">仅 MP3 声音</el-radio>
          <el-radio value="wav">仅 WAV 声音</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="format === 'mp4' || format === 'gif'" label="绘制的画面">
        <el-checkbox v-for="track in pictureTracks" :key="track.id" v-model="shown[track.id]">{{ track.name }}{{ track.hidden ? translate("（时间线上已隐藏）") : "" }}</el-checkbox>
      </el-form-item>
      <el-form-item v-if="format !== 'gif'" label="混入的声音">
        <el-checkbox v-for="track in soundTracks" :key="track.id" v-model="heard[track.id]">{{ track.name }}{{ track.muted ? translate("（时间线上已静音）") : "" }}</el-checkbox>
      </el-form-item>
      <el-form-item v-if="format === 'mp4'" label="画质">
        <el-radio-group v-model="quality">
          <el-radio value="high">高</el-radio>
          <el-radio value="medium">中（约一半大小）</el-radio>
          <el-radio value="small">小文件</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="format === 'mp4' || format === 'gif'" label="尺寸">
        <el-radio-group v-model="scale">
          <el-radio v-for="option in scaleOptions" :key="option.value" :value="option.value">{{ option.label }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="范围">
        <el-radio-group v-model="part">
          <el-radio v-if="clipRange" value="clip">此片段 · {{ timecode(clipRange.start, doc.fps) }} – {{ timecode(clipRange.end, doc.fps) }}</el-radio>
          <el-radio value="all">整个视频 · {{ timecode(length, doc.fps) }}</el-radio>
          <el-radio v-if="programRange" value="inout">入点到出点 · {{ timecode(programRange.start, doc.fps) }} – {{ timecode(programRange.end, doc.fps) }}</el-radio>
          <el-radio value="custom">自定义时间段</el-radio>
        </el-radio-group>
        <div v-if="part === 'custom'" class="customRange">
          <el-input v-model="customStart" placeholder="0:00.00" style="width: 110px" />
          <span>–</span>
          <el-input v-model="customEnd" placeholder="0:00.00" style="width: 110px" />
          <span class="customHint">分:秒.帧，或秒数（如 12.5）</span>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" @click="submit">导出</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { t, translate } from "@toonflow/i18n/vue";
import type { VideoDoc, VideoExportOptions, VideoTrack } from "../types";
import { docLength, timecode } from "../timeline";

/**
 * 导出设置：格式、画质、尺寸、范围（记住上次选择），以及绘制与混入哪些轨道（默认全部；“导出此轨”只勾选该轨，“导出此片段”同时限定片段时间）。
 */
const props = defineProps<{ doc: VideoDoc; only?: VideoTrack; clipRange?: { start: number; end: number }; programRange?: { start: number; end: number } }>();
const emit = defineEmits<{ close: []; export: [options: VideoExportOptions] }>();
const storageKey = "toonflow:videoExportOptions";
const last = (() => { try { const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {}; } catch { return {}; } })();
const length = computed(() => docLength(props.doc));
const title = computed(() => (props.only ? t`导出 ${props.only.name}${props.clipRange ? translate("（片段）") : ""}` : translate("导出")));
const soundTracks = computed(() => props.doc.tracks.filter(track => track.kind === "video" || track.kind === "audio"));
const pictureTracks = computed(() => props.doc.tracks.filter(track => track.kind === "video" || track.kind === "text"));
const ticked = (track: VideoTrack) => !props.only || track.id === props.only.id;
const format = ref<NonNullable<VideoExportOptions["format"]>>(props.only ? (props.only.kind === "audio" ? "wav" : "mp4") : (["mp4", "gif", "mp3", "wav"].includes(last.format ?? "") ? last.format as NonNullable<VideoExportOptions["format"]> : "mp4"));
const quality = ref<NonNullable<VideoExportOptions["quality"]>>(["high", "medium", "small"].includes(last.quality ?? "") ? last.quality as NonNullable<VideoExportOptions["quality"]> : "high");
const scale = ref(["1", "0.75", "0.5", "0.25"].includes(last.scale ?? "") ? last.scale : "1");
const part = ref(props.clipRange ? "clip" : props.programRange && last.part === "inout" ? "inout" : "all");
const customStart = ref(timecode(props.programRange?.start ?? 0, props.doc.fps));
const customEnd = ref(timecode(props.programRange?.end ?? docLength(props.doc), props.doc.fps));

/** "1:23.12"（分:秒.帧）、"1:02:03.04"、"83.5"（秒）→ 秒；无法识别返回 null。 */
function parseTime(text: string, fps: number): number | null {
  const value = text.trim().replace(/：/g, ":");
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const match = /^(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const [, hours = "0", minutes, seconds, frames = "0"] = match;
  if (Number(seconds) >= 60 || Number(frames) >= Math.ceil(fps)) return null;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(frames) / fps;
}
const heard = reactive(Object.fromEntries(soundTracks.value.map(track => [track.id, ticked(track)])));
const shown = reactive(Object.fromEntries(pictureTracks.value.map(track => [track.id, ticked(track)])));
const even = (factor: number, value: number) => Math.round((value * factor) / 2) * 2;
const scaleOptions = computed(() => [
  { value: "1", label: t`原尺寸 · ${props.doc.width}×${props.doc.height}` },
  { value: "0.75", label: `75% · ${even(0.75, props.doc.width)}×${even(0.75, props.doc.height)}` },
  { value: "0.5", label: `50% · ${even(0.5, props.doc.width)}×${even(0.5, props.doc.height)}` },
  { value: "0.25", label: `25% · ${even(0.25, props.doc.width)}×${even(0.25, props.doc.height)}` },
]);

function submit() {
  const heardIds = soundTracks.value.filter(track => heard[track.id]).map(track => track.id);
  const shownIds = pictureTracks.value.filter(track => shown[track.id]).map(track => track.id);
  if ((format.value === "mp3" || format.value === "wav") && !heardIds.length) return ElMessage.warning(translate("请至少勾选一条要导出声音的轨道"));
  if ((format.value === "mp4" || format.value === "gif") && !shownIds.length && (format.value === "gif" || !heardIds.length)) {
    return ElMessage.warning(translate("没有勾选任何内容：请勾选轨道的画面或声音"));
  }
  let custom: { start: number; end: number } | undefined;
  if (part.value === "custom") {
    const start = parseTime(customStart.value, props.doc.fps);
    const end = parseTime(customEnd.value, props.doc.fps);
    if (start === null || end === null) return ElMessage.warning(translate("时间格式不对：请填 分:秒.帧（如 1:23.12）或秒数（如 83.5）"));
    const clampedEnd = Math.min(end, length.value);
    if (clampedEnd - start < 1 / props.doc.fps) return ElMessage.warning(translate("结束时间要晚于开始时间，且不超过视频长度"));
    custom = { start: Math.max(0, start), end: clampedEnd };
  }
  // 轨道勾选不记忆：轨道 id 属于各工程，“导出此轨”从该轨单独开始。
  if (!props.only) localStorage.setItem(storageKey, JSON.stringify({ format: format.value, quality: quality.value, scale: scale.value, part: part.value }));
  emit("export", {
    format: format.value,
    ...(heardIds.length < soundTracks.value.length && { audioTracks: heardIds }),
    ...(shownIds.length < pictureTracks.value.length && { shownTracks: shownIds }),
    quality: quality.value,
    scale: Number(scale.value) || 1,
    ...(part.value === "inout" && props.programRange && { range: props.programRange }),
    ...(part.value === "clip" && props.clipRange && { range: props.clipRange }),
    ...(custom && { range: custom }),
  });
}
</script>

<style lang="scss">
.exportForm {
  .exportHint { margin: 0 0 12px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
  .el-radio-group { display: flex; flex-direction: column; align-items: flex-start; }
  .el-checkbox { margin-right: 12px; }
  .customRange { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .customHint { color: var(--el-text-color-secondary); font-size: 12px; }
}
</style>
