<template>
  <div class="musicLibrary">
    <div class="searchBox">
      <icon-search :size="14" class="searchIcon" />
      <input v-model="keyword" :placeholder="translate('搜索歌曲 / 艺人（建议英文）')" @keydown.enter="search()" @keydown.stop />
      <button v-if="keyword" class="clear" @click="keyword = ''"><icon-x :size="12" /></button>
    </div>

    <div class="chips">
      <button v-for="cat in categories" :key="cat.label" class="chip" :class="{ active: activeChip === cat.label }" @click="pick(cat)">{{ translate(cat.label) }}</button>
    </div>

    <div class="results">
      <div v-if="error" class="hint error">
        <p>{{ error }}</p>
        <button v-if="needLogin" class="loginBtn" :disabled="loggingIn" @click="loginLibrary">
          {{ loggingIn ? translate("请在弹出的窗口里登录…") : translate("登录 CapCut 曲库") }}
        </button>
      </div>
      <template v-else-if="loading">
        <div v-for="n in 6" :key="n" class="songRow skeleton"><span class="cover" /><span class="lines"><i /><i /></span></div>
      </template>
      <p v-else-if="!songs.length" class="hint">{{ searched ? translate("没有找到音乐，换个关键词试试（CapCut 曲库以英文为主）。") : translate("搜索 CapCut 在线曲库，拖到轨道或点 + 添加。") }}</p>

      <div v-for="song in loading ? [] : songs" :key="song.id" class="songRow" :class="{ playing: playingId === song.id }" draggable="true"
        :title="translate('拖到轨道 · 点封面试听 · + 添加到播放头')" @dragstart="drag($event, song)">
        <button class="cover" @click="togglePlay(song)">
          <img v-if="song.coverUrl" :src="song.coverUrl" alt="" loading="lazy" draggable="false" />
          <span class="playIcon"><icon-player-pause-filled v-if="playingId === song.id" :size="16" /><icon-player-play-filled v-else :size="16" /></span>
        </button>
        <div class="meta">
          <div class="title">{{ song.title }}<span v-if="song.paidType && song.paidType !== 'free'" class="vip">VIP</span></div>
          <div class="sub">{{ song.author || translate("未知艺人") }}</div>
          <div v-if="playingId === song.id" class="progress" @click.stop="seek($event)"><span :style="{ width: `${progress * 100}%` }" /></div>
        </div>
        <span class="duration">{{ formatDuration(song.duration) }}</span>
        <button class="add" :title="translate('添加到播放头')" @click.stop="emit('add', song.previewUrl, fileName(song))"><icon-plus :size="14" /></button>
      </div>
    </div>
    <audio ref="player" hidden @ended="playingId = ''" @timeupdate="onTime" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlus, IconSearch, IconX } from "@tabler/icons-vue";
import { translate } from "@toonflow/i18n/vue";
import http from "@/lib/http";
import { onlineMusicDragType } from "../sourceEdit";

type Song = { id: string; title: string; author: string; duration: number; coverUrl: string; previewUrl: string; paidType: string };
type SearchResult = { songs: Song[]; hasMore: boolean; cursor: number };
type Category = { label: string; keyword: string | null };

const emit = defineEmits<{ add: [previewUrl: string, name: string] }>();

// CapCut 曲库以英文为主：中文分类映射成英文关键词；keyword 为 null 表示推荐。
const categories: Category[] = [
  { label: "推荐", keyword: null },
  { label: "短剧", keyword: "drama" },
  { label: "悬疑", keyword: "suspense" },
  { label: "伤感", keyword: "sad piano" },
  { label: "甜宠", keyword: "romantic" },
  { label: "热血", keyword: "epic" },
  { label: "搞笑", keyword: "funny" },
  { label: "古风", keyword: "chinese traditional" },
  { label: "轻快", keyword: "happy" },
  { label: "Vlog", keyword: "vlog" },
  { label: "Lofi", keyword: "lofi" },
];

const keyword = ref("");
const songs = ref<Song[]>([]);
const loading = ref(false);
const searched = ref(false);
const error = ref("");
const activeChip = ref("推荐");
const playingId = ref("");
const progress = ref(0);
const player = ref<HTMLAudioElement>();
const needLogin = ref(false); // 内嵌 CapCut 曲库未登录时提示登录
const loggingIn = ref(false);
let token = 0; // 只采用最后一次请求的结果
let lastKw: string | null = null; // 便于登录后重跑当前查询

async function load(kw: string | null) {
  const mine = ++token;
  lastKw = kw;
  loading.value = true;
  error.value = "";
  searched.value = kw !== null;
  try {
    const result = kw === null
      ? await http<SearchResult>({ method: "GET", url: "/api/music/recommend", timeout: 90000 })
      : await http<SearchResult>({ method: "POST", url: "/api/music/search", data: { keyword: kw }, timeout: 90000 });
    if (mine !== token) return;
    songs.value = result.songs ?? [];
    needLogin.value = false;
  } catch (e) {
    if (mine !== token) return;
    songs.value = [];
    const message = e instanceof Error ? e.message : translate("搜索失败");
    // 未登录内嵌曲库时，连推荐也要把登录入口显出来；其余的推荐失败仍静默回退到提示。
    needLogin.value = /登录|login/i.test(message);
    if (kw !== null || needLogin.value) error.value = message;
  } finally {
    if (mine === token) loading.value = false;
  }
}

async function loginLibrary() {
  loggingIn.value = true;
  try {
    await http<{ loggedIn: boolean }>({ method: "POST", url: "/api/music/login", headers: { "x-toonflow-desktop": "1" }, timeout: 360000 });
    needLogin.value = false;
    void load(lastKw);
  } catch (e) {
    ElMessage.warning(e instanceof Error ? e.message : translate("登录失败"));
  } finally {
    loggingIn.value = false;
  }
}

function search() {
  const kw = keyword.value.trim();
  if (!kw) return;
  activeChip.value = "";
  void load(kw);
}

function pick(cat: Category) {
  activeChip.value = cat.label;
  keyword.value = "";
  void load(cat.keyword);
}

// 清空搜索框回到推荐。
watch(keyword, v => { if (!v.trim() && searched.value && !activeChip.value) pick(categories[0]!); });

function togglePlay(song: Song) {
  const el = player.value;
  if (!el) return;
  if (playingId.value === song.id) { el.pause(); playingId.value = ""; return; }
  progress.value = 0;
  el.src = song.previewUrl;
  el.play().then(() => (playingId.value = song.id)).catch(() => ElMessage.warning(translate("试听失败")));
}

function onTime() {
  const el = player.value;
  progress.value = el && el.duration ? el.currentTime / el.duration : 0;
}

function seek(event: MouseEvent) {
  const el = player.value;
  const bar = event.currentTarget as HTMLElement;
  if (!el || !el.duration) return;
  const rect = bar.getBoundingClientRect();
  el.currentTime = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * el.duration;
}

const fileName = (song: Song) => `${song.title}.mp3`.replace(/[\\/:*?"<>|]/g, "_");

function drag(event: DragEvent, song: Song) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(onlineMusicDragType, JSON.stringify({ url: song.previewUrl, name: fileName(song) }));
  event.dataTransfer.setData("text/plain", song.title);
  event.dataTransfer.effectAllowed = "copy";
}

function formatDuration(sec: number) {
  if (!sec || sec < 0) return "00:00";
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

onMounted(() => load(null));
onBeforeUnmount(() => { player.value?.pause(); });
</script>

<style lang="scss">
.musicLibrary {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;

  .searchBox {
    position: relative;
    display: flex;
    align-items: center;
    margin: 10px 12px 6px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--el-fill-color);

    &:focus-within { border-color: var(--el-color-primary); }
    .searchIcon { margin-left: 9px; color: var(--el-text-color-placeholder); }
    input { flex: 1; min-width: 0; height: 30px; padding: 0 8px; border: none; outline: none; background: none; color: var(--el-text-color-primary); font-size: 12px; }
    .clear { display: flex; margin-right: 6px; padding: 2px; border: none; border-radius: 50%; background: var(--el-fill-color-darker); color: var(--el-text-color-secondary); cursor: pointer; }
  }

  .chips {
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    padding: 2px 12px 8px;
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar { display: none; }
    .chip { flex-shrink: 0; padding: 3px 10px; border: none; border-radius: 6px; background: var(--el-fill-color-light); color: var(--el-text-color-regular); font-size: 12px; cursor: pointer; }
    .chip:hover { color: var(--el-text-color-primary); background: var(--el-fill-color); }
    .chip.active { background: var(--el-color-primary-light-8); color: var(--el-color-primary); font-weight: 600; }
  }

  .results { flex: 1; min-height: 0; padding: 0 6px 12px; overflow: auto; }
  .hint { margin: 12px; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.6; }
  .hint.error { color: var(--el-color-danger); }
  .loginBtn { margin-top: 8px; padding: 5px 12px; border: none; border-radius: 6px; background: var(--el-color-primary); color: #fff; font-size: 12px; cursor: pointer; }
  .loginBtn:disabled { opacity: 0.6; cursor: default; }

  .songRow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px;
    border-radius: 8px;
    cursor: grab;

    &:hover { background: var(--el-fill-color-light); }
    &:active { cursor: grabbing; }
    &.playing { background: var(--el-color-primary-light-9); }
    &.playing .title { color: var(--el-color-primary); }

    .cover {
      position: relative;
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      padding: 0;
      border: none;
      border-radius: 6px;
      background: linear-gradient(135deg, var(--el-fill-color-darker), var(--el-fill-color));
      overflow: hidden;
      cursor: pointer;

      img { width: 100%; height: 100%; object-fit: cover; }
      .playIcon { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; background: rgba(0, 0, 0, 0.4); opacity: 0; transition: opacity 0.15s; }
    }
    &:hover .cover .playIcon, &.playing .cover .playIcon { opacity: 1; }

    .meta { flex: 1; min-width: 0; }
    .title { display: flex; align-items: center; gap: 4px; overflow: hidden; font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
    .sub { margin-top: 3px; overflow: hidden; color: var(--el-text-color-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .vip { flex-shrink: 0; padding: 0 4px; border-radius: 3px; background: linear-gradient(90deg, #f7c46c, #e8a33d); color: #4a2d00; font-size: 9px; font-weight: 700; line-height: 14px; }
    .progress { position: relative; height: 3px; margin-top: 6px; border-radius: 2px; background: var(--el-fill-color-darker); cursor: pointer;
      span { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: var(--el-color-primary); }
    }

    .duration { flex-shrink: 0; color: var(--el-text-color-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
    .add { display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: 24px; height: 24px; border: none; border-radius: 50%; background: var(--el-color-primary); color: #fff; cursor: pointer; opacity: 0; transition: opacity 0.15s; }
    &:hover .add { opacity: 1; }
    &:hover .duration { display: none; }

    &.skeleton { cursor: default;
      .cover { animation: musicPulse 1.2s ease-in-out infinite; }
      .lines { display: flex; flex: 1; flex-direction: column; gap: 6px;
        i { display: block; height: 9px; border-radius: 4px; background: var(--el-fill-color); animation: musicPulse 1.2s ease-in-out infinite; }
        i:last-child { width: 45%; }
      }
    }
  }
}
@keyframes musicPulse { 50% { opacity: 0.45; } }
</style>
