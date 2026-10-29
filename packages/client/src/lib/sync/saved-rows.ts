import type { PushRows } from "@newtab-todo/shared/push-payload";

type Row = { id: string; updatedAt?: string };

// A push can arrive after a fetch that already had a later copy of the row
const isNewer = (incoming: Row, saved: Row) =>
  !incoming.updatedAt || !saved.updatedAt || incoming.updatedAt >= saved.updatedAt;

/**
 * Only lists that were saved and changed come back; one never saved is left for the fetch to fill.
 */
export const applyRows = (saved: Map<string, unknown>, events: PushRows["events"]) => {
  const changed = new Map<string, Row[]>();
  for (const { model, action, data } of events) {
    const before = changed.get(model) ?? saved.get(model);
    if (!Array.isArray(before)) continue;
    const list = [...(before as Row[])];
    const row = data as Row;
    const index = list.findIndex((r) => r.id === row.id);
    if (action === "delete") {
      if (index >= 0) list.splice(index, 1);
    } else if (index >= 0) {
      if (isNewer(row, list[index]!)) list[index] = { ...list[index]!, ...row };
    } else if (action === "insert") {
      list.push(row);
    }
    changed.set(model, list);
  }
  return changed;
};
