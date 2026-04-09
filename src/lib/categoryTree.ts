/** id → дочірні id (один рівень). */
export function childrenMapFromRows(rows: { id: string; parentId: string | null }[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    if (!m.has(r.parentId)) m.set(r.parentId, []);
    m.get(r.parentId)!.push(r.id);
  }
  return m;
}

/** Усі нащадки rootId (без самого rootId). */
export function collectDescendantIds(rootId: string, childrenByParent: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of childrenByParent.get(id) ?? []) stack.push(c);
  }
  return out;
}

export type CategoryTreeNode = {
  id: string;
  slug: string;
  nameUk: string;
  sortOrder: number;
  children: CategoryTreeNode[];
};

/** Плоский список категорій → дерево (корені — parentId відсутній або батько поза списком). */
export function buildCategoryTree(
  rows: Array<{ id: string; slug: string; nameUk: string; parentId: string | null; sortOrder: number }>,
): CategoryTreeNode[] {
  const map = new Map<string, CategoryTreeNode>();
  for (const r of rows) {
    map.set(r.id, { ...r, children: [] });
  }
  const roots: CategoryTreeNode[] = [];
  for (const r of rows) {
    const n = map.get(r.id)!;
    if (r.parentId && map.has(r.parentId)) {
      map.get(r.parentId)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  const sort = (ns: CategoryTreeNode[]) => {
    ns.sort((a, b) => a.sortOrder - b.sortOrder || a.nameUk.localeCompare(b.nameUk, "uk"));
    for (const c of ns) sort(c.children);
  };
  sort(roots);
  return roots;
}
