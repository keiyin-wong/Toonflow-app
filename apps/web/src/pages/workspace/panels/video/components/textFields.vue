<template>
  <div class="inspectorHead">{{ text.shape ? translate(shapeLabels[text.shape.kind]) : translate("文字") }} · {{ track.name }}</div>
  <div class="inspectorScroll">
    <div class="inspectorTop">
      <el-input :modelValue="text.text" type="textarea" :rows="3" :placeholder="text.shape ? translate('图形上的文字（可选）') : translate('输入文字')" :autofocus="!text.text && !text.shape"
        @focus="history.begin()" @blur="history.end()" @keydown.stop @input="value => history.live(patchTexts(history.content.value, [text.id], () => ({ text: value })))" />
    </div>

    <inspectorSection v-if="shape" title="图形">
      <fieldRow label="类型" kind="pick" :value="shape.kind" :options="shapeOptions" @change="changeShapeKind" />
      <fieldRow label="宽" kind="range" :value="shape.w" :min="0" :max="1.5" :step="0.005" :history="history" :format="percent" @live="value => liveShape({ w: value })" />
      <fieldRow label="高" kind="range" :value="shape.h" :min="0" :max="1.5" :step="0.005" :history="history" :format="percent" @live="value => liveShape({ h: value })" />
      <fieldRow label="旋转" kind="range" :value="shape.rotation ?? 0" :min="-180" :max="180" :step="1" :history="history" :format="value => `${Math.round(value)}°`" @live="value => liveShape({ rotation: value || undefined })" />
      <template v-if="shape.kind !== 'line'">
        <fieldRow label="填充" kind="color" :value="shape.fill" :history="history" @live="value => liveShape({ fill: value })" />
        <fieldRow label="填充不透明度" kind="range" :value="shape.fillOpacity" :min="0" :max="1" :step="0.01" :history="history" :format="value => (value ? percent(value) : translate('无'))" @live="value => liveShape({ fillOpacity: value })" />
      </template>
      <fieldRow label="描边" kind="color" :value="shape.stroke" :history="history" @live="value => liveShape({ stroke: value })" />
      <fieldRow label="描边宽度" kind="range" :value="shape.strokeWidth" :min="0" :max="0.05" :step="0.001" :history="history" :format="value => (value ? `${(value * 100).toFixed(1)}%` : translate('无'))" @live="value => liveShape({ strokeWidth: value })" />
      <fieldRow v-if="shape.kind === 'rect'" label="圆角" kind="range" :value="shape.radius ?? 0" :min="0" :max="0.5" :step="0.01" :history="history" :format="percent" @live="value => liveShape({ radius: value || undefined })" />
      <fieldRow v-if="shape.kind === 'polygon' || shape.kind === 'star'" :label="shape.kind === 'star' ? translate('角数') : translate('边数')" kind="number" :step="1" :min="3" :max="12" :value="shape.sides ?? 5" @change="value => setShape({ sides: Math.round(value) })" />
      <p class="fieldHint">在预览中拖动即可移动；上方输入的文字会按下方字体绘制在图形上。</p>
    </inspectorSection>

    <inspectorSection title="时间">
      <el-checkbox :modelValue="!!text.hidden" size="small" @change="value => set({ hidden: Boolean(value) || undefined })">隐藏</el-checkbox>
      <fieldRow label="开始于" kind="number" suffix="s" :value="text.start" :min="0" @change="value => set({ start: value })" />
      <fieldRow label="时长" kind="number" suffix="s" :value="text.duration" :min="minSeconds" @change="value => set({ duration: value })" />
      <fieldRow label="淡入" kind="number" suffix="s" :value="text.fadeIn ?? 0" :min="0" @change="value => set({ fadeIn: value || undefined })" />
      <fieldRow label="淡出" kind="number" suffix="s" :value="text.fadeOut ?? 0" :min="0" @change="value => set({ fadeOut: value || undefined })" />
      <fieldRow label="滑入" kind="pick" :value="text.motionIn ?? 'none'" :options="motionOptions" @change="value => set({ motionIn: value === 'none' ? undefined : value as VideoTextMotion })" />
      <fieldRow label="滑出" kind="pick" :value="text.motionOut ?? 'none'" :options="motionOptions" @change="value => set({ motionOut: value === 'none' ? undefined : value as VideoTextMotion })" />
      <p v-if="text.motionIn || text.motionOut" class="fieldHint">滑动时长与淡入淡出相同（未设置时为 {{ motionSeconds }} 秒）。</p>
      <fieldRow label="模糊擦入" kind="number" suffix="s" :value="text.wipeIn ?? 0" :min="0" :max="text.duration" @change="value => set({ wipeIn: value || undefined })" />
      <fieldRow label="模糊擦出" kind="number" suffix="s" :value="text.wipeOut ?? 0" :min="0" :max="text.duration" @change="value => set({ wipeOut: value || undefined })" />
      <p v-if="!text.wipeIn && !text.wipeOut" class="fieldHint">模糊擦除让文字在柔和的模糊边缘后从左到右出现（约 {{ textWipeSeconds }} 秒）。</p>
    </inspectorSection>

    <inspectorSection title="字体">
      <fieldRow label="字体" kind="pick" :value="style.font" :options="fontOptions" @change="value => setStyle({ font: value })" />
      <fieldRow label="字号" kind="range" :value="style.size" :min="1" :max="25" :step="0.1" :history="history" :format="value => `${value.toFixed(1)}%`" @live="value => liveStyle({ size: value })" />
      <div class="toggleRow">
        <button class="toggleButton" :class="{ on: style.bold }" title="粗体" @click="setStyle({ bold: !style.bold })"><b>B</b></button>
        <button class="toggleButton" :class="{ on: style.italic }" title="斜体" @click="setStyle({ italic: !style.italic })"><i>I</i></button>
        <button v-for="align in aligns" :key="align.value" class="toggleButton" :class="{ on: style.align === align.value }" :title="align.title" @click="setStyle({ align: align.value })">
          <component :is="align.icon" :size="14" />
        </button>
        <button class="toggleButton" :class="{ on: style.shadow }" title="阴影" @click="setStyle({ shadow: !style.shadow })">S</button>
        <button class="toggleButton" :class="{ on: style.decoration === 'underline' }" title="下划线" @click="setStyle({ decoration: style.decoration === 'underline' ? undefined : 'underline' })"><u>U</u></button>
        <button class="toggleButton" :class="{ on: style.decoration === 'line-through' }" title="删除线" @click="setStyle({ decoration: style.decoration === 'line-through' ? undefined : 'line-through' })"><s>S</s></button>
      </div>
      <fieldRow label="字间距" kind="range" :value="style.letterSpacing ?? 0" :min="-20" :max="100" :step="1" :history="history" :format="value => `${value}%`" @live="value => liveStyle({ letterSpacing: value || undefined })" />
      <fieldRow label="行高" kind="range" :value="style.lineHeight ?? 1.3" :min="0.8" :max="3" :step="0.05" :history="history" :format="value => `${value.toFixed(2)}×`" @live="value => liveStyle({ lineHeight: Math.abs(value - 1.3) < 1e-3 ? undefined : value })" />
      <fieldRow label="颜色" kind="color" :value="style.color" :history="history" @live="value => liveStyle({ color: value })" />
      <fieldRow label="描边" kind="color" :value="style.stroke" :history="history" @live="value => liveStyle({ stroke: value })" />
      <fieldRow label="描边宽度" kind="range" :value="style.strokeWidth" :min="0" :max="40" :step="1" :history="history" :format="value => (value ? `${value}%` : translate('无'))" @live="value => liveStyle({ strokeWidth: value })" />
      <fieldRow label="底框" kind="color" :value="style.background" :history="history" @live="value => liveStyle({ background: value })" />
      <fieldRow label="底框不透明度" kind="range" :value="style.backgroundOpacity" :min="0" :max="1" :step="0.01" :history="history" :format="value => (value ? percent(value) : translate('无'))" @live="value => liveStyle({ backgroundOpacity: value })" />
    </inspectorSection>

    <inspectorSection title="位置">
      <div class="toggleRow">
        <button class="toggleButton wide" @click="setStyle({ y: 0.12 })">顶部</button>
        <button class="toggleButton wide" @click="setStyle({ y: 0.5 })">中间</button>
        <button class="toggleButton wide" @click="setStyle({ y: 0.82 })">底部</button>
        <button class="toggleButton wide" @click="setStyle({ x: 0.5 })">水平居中</button>
      </div>
      <fieldRow label="X" kind="number" suffix="%" :scale="100" :step="1" :value="style.x" @change="value => setStyle({ x: value })" />
      <fieldRow label="Y" kind="number" suffix="%" :scale="100" :step="1" :value="style.y" @change="value => setStyle({ y: value })" />
      <fieldRow label="换行宽度" kind="range" :value="style.maxWidth" :min="0.1" :max="1" :step="0.01" :history="history" :format="percent" @live="value => liveStyle({ maxWidth: value })" />
      <p class="fieldHint">在预览中拖动文字即可移动。</p>
    </inspectorSection>

    <inspectorSection title="样式预设" :open="false">
      <div class="toggleRow">
        <button class="toggleButton wide" @click="setStyle(subtitleStyle)">字幕</button>
        <button class="toggleButton wide" @click="setStyle(titleStyle)">标题</button>
        <button class="toggleButton wide" @click="setStyle({ ...subtitleStyle, strokeWidth: 0, backgroundOpacity: 0.6 })">底框</button>
        <button class="toggleButton wide" @click="setStyle({ ...subtitleStyle, color: '#ffe14d' })">黄色</button>
      </div>
      <el-button v-if="others > 0" size="small" @click="applyToTrack">把此样式应用到 {{ track.name }} 上的全部 {{ others + 1 }} 条文字</el-button>
    </inspectorSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { IconAlignCenter, IconAlignLeft, IconAlignRight } from "@tabler/icons-vue";
import type { VideoDoc, VideoShape, VideoText, VideoTextMotion, VideoTextStyle } from "../types";
import type { History } from "../useHistory";
import { motionLabels, shapeLabels } from "../labels";
import { fonts, minSeconds, motionSeconds, patchTexts, shapeKinds, subtitleStyle, textWipeSeconds, titleStyle } from "../timeline";
import fieldRow from "./fieldRow.vue";
import inspectorSection from "./inspectorSection.vue";

// 文字（以及图形、贴纸）：内容、时间、字体、位置与样式预设。
const props = defineProps<{ text: VideoText; history: History<VideoDoc> }>();
const doc = computed(() => props.history.content.value);
const track = computed(() => doc.value.tracks.find(item => item.id === props.text.track)!);
const style = computed(() => props.text.style);
const shape = computed(() => props.text.shape);
const others = computed(() => doc.value.texts.filter(item => item.track === props.text.track && item.id !== props.text.id).length);
const percent = (value: number) => `${Math.round(value * 100)}%`;
const set = (patch: Partial<VideoText>) => props.history.set(patchTexts(props.history.content.value, [props.text.id], () => patch));
const setStyle = (patch: Partial<VideoTextStyle>) => props.history.set(patchTexts(props.history.content.value, [props.text.id], text => ({ style: { ...text.style, ...patch } })));
const liveStyle = (patch: Partial<VideoTextStyle>) => props.history.live(patchTexts(props.history.content.value, [props.text.id], text => ({ style: { ...text.style, ...patch } })));
const setShape = (patch: Partial<VideoShape>) => props.history.set(patchTexts(props.history.content.value, [props.text.id], text => ({ shape: { ...text.shape!, ...patch } })));
const liveShape = (patch: Partial<VideoShape>) => props.history.live(patchTexts(props.history.content.value, [props.text.id], text => ({ shape: { ...text.shape!, ...patch } })));
const motionOptions = computed(() => (["none", "up", "down", "left", "right"] as const).map(value => ({ value: value as string, label: translate(motionLabels[value]) })));
const shapeOptions = computed(() => shapeKinds.map(kind => ({ value: kind as string, label: translate(shapeLabels[kind]) })));
const fontOptions = computed(() => (fonts.includes(style.value.font) ? fonts : [style.value.font, ...fonts]).map(font => ({ value: font, label: font })));
const aligns = computed(() => [
  { value: "left" as const, title: translate("左对齐"), icon: IconAlignLeft },
  { value: "center" as const, title: translate("居中"), icon: IconAlignCenter },
  { value: "right" as const, title: translate("右对齐"), icon: IconAlignRight },
]);

function changeShapeKind(value: string) {
  const kind = value as VideoShape["kind"];
  setShape({ kind, ...(kind === "polygon" && !shape.value?.sides && { sides: 6 }), ...(kind === "star" && !shape.value?.sides && { sides: 5 }) });
}

function applyToTrack() {
  const ids = doc.value.texts.filter(item => item.track === props.text.track).map(item => item.id);
  props.history.set(patchTexts(doc.value, ids, () => ({ style: props.text.style })));
}
</script>
