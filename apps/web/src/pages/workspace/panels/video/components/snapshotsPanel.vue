<template>
  <div class="snapshotsPanel">
    <div class="snapshotsHead">
      <b>快照</b>
      <span class="spacer" />
      <el-button type="primary" size="small" :disabled="busy" @click="save">保存快照…</el-button>
    </div>
    <div v-if="list === null" class="snapshotsEmpty">正在读取…</div>
    <div v-else-if="!list.length" class="snapshotsEmpty">还没有快照。大改之前保存一个，以便随时回到当时的时间线。</div>
    <ul v-else class="snapshotList">
      <li v-for="item in list" :key="item.id">
        <div class="snapshotInfo" :title="new Date(item.createdAt).toLocaleString()">
          <span class="snapshotName">{{ item.name }}</span>
          <span class="snapshotMeta">{{ new Date(item.createdAt).toLocaleString() }} · {{ item.clips }} 个片段 · {{ timecode(item.length, item.doc.fps) }}</span>
        </div>
        <el-button size="small" :disabled="busy" @click="restore(item)">恢复</el-button>
        <button class="iconButton" :disabled="busy" title="重命名" @click="rename(item)"><icon-pencil :size="14" /></button>
        <button class="iconButton danger" :disabled="busy" title="删除快照" @click="remove(item)"><icon-trash :size="14" /></button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { t, translate } from "@toonflow/i18n/vue";
import type { VideoDoc } from "../types";
import type { Media } from "../media";
import { makeSnapshot, readSnapshots, writeSnapshots, type VideoSnapshot } from "../videoFile";
import { sameValue } from "../merge";
import { timecode } from "../timeline";

/** 时间线快照：保存、恢复、重命名、删除。恢复前先把当前时间线存为快照（已有相同快照时跳过），并进入撤销历史。 */
const props = defineProps<{ media: Media; project: string; doc: VideoDoc }>();
const emit = defineEmits<{ restore: [doc: VideoDoc, name: string] }>();
const list = ref<VideoSnapshot[] | null>(null);
const busy = ref(false);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });

const load = async () => { list.value = await readSnapshots(props.media.files, props.project); };
onMounted(() => void load().catch(report));

function report(error: unknown) {
  ElMessage.error(error instanceof Error ? error.message : translate("快照操作失败"));
}

async function run(action: (current: VideoSnapshot[]) => VideoSnapshot[] | Promise<VideoSnapshot[]>) {
  if (disposed || busy.value) return false;
  const project = props.project;
  busy.value = true;
  try {
    const current = await readSnapshots(props.media.files, project);
    const next = await action(current);
    await writeSnapshots(props.media.files, project, next, props.media.ensureDirectory);
    if (props.project === project) list.value = next;
    return !disposed && props.project === project;
  } catch (error) {
    report(error);
    return false;
  } finally {
    busy.value = false;
  }
}

async function ask(title: string, value: string) {
  try {
    const { value: name } = await ElMessageBox.prompt(translate("名称"), title, { inputValue: value, inputValidator: input => !!input.trim() || translate("请输入名称") });
    return name.trim();
  } catch {
    return null;
  }
}

async function save() {
  const project = props.project;
  const name = await ask(translate("保存快照"), t`快照 ${new Date().toLocaleString()}`);
  if (name && props.project === project) {
    const doc = props.doc;
    await run(current => [makeSnapshot(name, doc), ...current]);
  }
}

async function restore(item: VideoSnapshot) {
  const project = props.project;
  try {
    await ElMessageBox.confirm(translate("时间线将回到此快照。当前内容会先存为快照（已有相同快照时跳过），并可用 Ctrl+Z 撤销恢复。"), t`恢复“${item.name}”？`, { type: "warning" });
  } catch {
    return;
  }
  if (props.project !== project) return;
  const doc = props.doc;
  const saved = await run(current => (current.some(snapshot => sameValue(snapshot.doc, doc)) ? current : [makeSnapshot(t`恢复“${item.name}”之前`, doc), ...current]));
  if (saved && props.doc === doc) emit("restore", item.doc, item.name);
}

async function rename(item: VideoSnapshot) {
  const project = props.project;
  const name = await ask(translate("重命名快照"), item.name);
  if (name && props.project === project) await run(current => current.map(snapshot => (snapshot.id === item.id ? { ...snapshot, name } : snapshot)));
}

async function remove(item: VideoSnapshot) {
  const project = props.project;
  try {
    await ElMessageBox.confirm(translate("快照将被永久删除，时间线本身不会改变。"), t`删除“${item.name}”？`, { type: "warning", confirmButtonText: translate("删除") });
  } catch {
    return;
  }
  if (props.project === project) await run(current => current.filter(snapshot => snapshot.id !== item.id));
}
</script>

<style lang="scss">
.snapshotsPanel {
  .snapshotsHead { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .spacer { flex: 1; }
  .snapshotsEmpty { padding: 12px 0; color: var(--el-text-color-secondary); font-size: 12px; }
  .snapshotList {
    max-height: 360px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;

    li { display: flex; align-items: center; gap: 4px; padding: 6px 0; border-top: 1px solid var(--el-border-color-lighter); }
  }
  .snapshotInfo { display: flex; flex: 1; flex-direction: column; min-width: 0; }
  .snapshotName { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .snapshotMeta { color: var(--el-text-color-secondary); font-size: 11px; }
  .iconButton { display: inline-flex; padding: 4px; border: none; border-radius: 4px; background: none; color: var(--el-text-color-regular); cursor: pointer; }
  .iconButton:hover:not(:disabled) { background: var(--el-fill-color-light); }
  .iconButton.danger { color: var(--el-color-danger); }
}
</style>
