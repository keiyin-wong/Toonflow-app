// 按 id 三方合并：本页未保存的修改与磁盘上被其他地方改过的工程合并，一方改过的项保留该方版本。

export type Prefer = "mine" | "theirs";

/** JSON 等价比较，忽略键顺序。 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const list = b as unknown[];
    return a.length === list.length && a.every((item, index) => sameValue(item, list[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).filter(key => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter(key => right[key] !== undefined);
  return leftKeys.length === rightKeys.length && leftKeys.every(key => sameValue(left[key], right[key]));
}

/** 合并一个列表：仅一方改动取该方；双方改动不同按 `prefer` 取舍并记录冲突 id。 */
export function mergeById<T extends { id: string }>(base: T[], mine: T[], theirs: T[], prefer: Prefer = "mine", conflicts?: string[]): T[] {
  const baseMap = new Map(base.map(item => [item.id, item]));
  const mineMap = new Map(mine.map(item => [item.id, item]));
  const theirsMap = new Map(theirs.map(item => [item.id, item]));
  const pick = (id: string): T | null => {
    const [baseItem, mineItem, theirsItem] = [baseMap.get(id), mineMap.get(id), theirsMap.get(id)];
    if (!baseItem) return mineItem ?? theirsItem ?? null;
    const mineChanged = !mineItem || !sameValue(mineItem, baseItem);
    const theirsChanged = !theirsItem || !sameValue(theirsItem, baseItem);
    if (!mineChanged) return theirsItem ?? null;
    if (!theirsChanged) return mineItem ?? null;
    if (!mineItem && !theirsItem) return null;
    if (mineItem && theirsItem && sameValue(mineItem, theirsItem)) return mineItem;
    conflicts?.push(id);
    return (prefer === "mine" ? mineItem : theirsItem) ?? null;
  };
  const ids = (list: T[], keep: Map<string, T>) => list.map(item => item.id).filter(id => keep.has(id));
  const mineReordered = !sameValue(ids(base, mineMap), ids(mine, baseMap));
  const order = [...(mineReordered ? mine : theirs).map(item => item.id), ...mine.map(item => item.id), ...theirs.map(item => item.id)];
  const result: T[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = pick(id);
    if (item) result.push(item);
  }
  return result;
}
