"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type AdminTagRow = {
  id: string;
  slug: string;
  nameUk: string;
  groupSlug: string | null;
  description: string | null;
  sortOrder: number;
  manual: boolean;
  products: number;
};
type GroupOpt = { slug: string; nameUk: string };

const inputCls =
  "w-full rounded-lg border border-zinc-600 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500";

function TagRow({ tag, groups, routeSecret, onError }: { tag: AdminTagRow; groups: GroupOpt[]; routeSecret: string; onError: (m: string | null) => void }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    nameUk: tag.nameUk,
    slug: tag.slug,
    groupSlug: tag.groupSlug ?? "",
    description: tag.description ?? "",
    sortOrder: String(tag.sortOrder),
  });

  async function save() {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/admin/tags/${tag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameUk: form.nameUk,
          slug: form.slug,
          groupSlug: form.groupSlug || null,
          description: form.description || null,
          sortOrder: parseInt(form.sortOrder, 10) || 0,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Збереження мітки");
      setEdit(false);
      router.refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Помилка");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const q = tag.products > 0 ? `Мітка «${tag.nameUk}» стоїть на ${tag.products} товарах. Зняти її з усіх і видалити?` : `Видалити мітку «${tag.nameUk}»?`;
    if (!confirm(q)) return;
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/admin/tags/${tag.id}?force=1`, { method: "DELETE" });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Видалення мітки");
      router.refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Помилка");
    } finally {
      setBusy(false);
    }
  }

  if (edit) {
    return (
      <tr className="bg-zinc-900/60">
        <td className="px-3 py-2" colSpan={5}>
          <div className="grid gap-2 md:grid-cols-5">
            <input className={inputCls} value={form.nameUk} onChange={(e) => setForm((f) => ({ ...f, nameUk: e.target.value }))} placeholder="Назва" />
            <input className={inputCls} value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="slug" />
            <select className={inputCls} value={form.groupSlug} onChange={(e) => setForm((f) => ({ ...f, groupSlug: e.target.value }))}>
              <option value="">— без групи —</option>
              {groups.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.nameUk}
                </option>
              ))}
            </select>
            <input className={inputCls} value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} placeholder="порядок" />
            <input className={inputCls} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Опис (для сторінки мітки)" />
          </div>
          <div className="mt-2 flex gap-3 text-sm">
            <button type="button" disabled={busy} onClick={() => void save()} className="rounded bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-500 disabled:opacity-50">
              Зберегти
            </button>
            <button type="button" disabled={busy} onClick={() => setEdit(false)} className="text-zinc-400 hover:text-zinc-200">
              Скасувати
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-zinc-900/50">
      <td className="px-3 py-2">
        <div className="font-medium text-zinc-100">{tag.nameUk}</div>
        <div className="text-xs text-zinc-500">
          {tag.slug}
          {tag.description ? ` · ${tag.description}` : ""}
        </div>
      </td>
      <td className="px-3 py-2 text-zinc-400">{tag.sortOrder}</td>
      <td className="px-3 py-2">
        {tag.products > 0 ? (
          <a href={`/ops/${routeSecret}/products?tag=${tag.slug}`} className="text-emerald-400 hover:underline">
            {tag.products}
          </a>
        ) : (
          <span className="text-zinc-500">0</span>
        )}
      </td>
      <td className="px-3 py-2">
        {tag.manual ? <span className="rounded bg-sky-900/50 px-1.5 py-0.5 text-xs text-sky-300">вручну</span> : <span className="text-xs text-zinc-500">таксономія</span>}
      </td>
      <td className="px-3 py-2 text-right text-sm whitespace-nowrap">
        <a href={`/tag/${tag.slug}`} target="_blank" rel="noreferrer" className="mr-3 text-zinc-400 hover:text-zinc-200">
          Сайт
        </a>
        <button type="button" onClick={() => setEdit(true)} className="mr-3 text-emerald-400 hover:underline">
          Редагувати
        </button>
        <button type="button" disabled={busy} onClick={() => void remove()} className="text-red-400 hover:underline disabled:opacity-50">
          Видалити
        </button>
      </td>
    </tr>
  );
}

export function AdminTagsManager({ routeSecret, groups, rows }: { routeSecret: string; groups: GroupOpt[]; rows: AdminTagRow[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ nameUk: "", groupSlug: groups[0]?.slug ?? "", description: "", sortOrder: "" });

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameUk: draft.nameUk,
          groupSlug: draft.groupSlug || null,
          description: draft.description || null,
          sortOrder: parseInt(draft.sortOrder, 10) || 0,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Створення мітки");
      setDraft((d) => ({ ...d, nameUk: "", description: "", sortOrder: "" }));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Помилка");
    } finally {
      setBusy(false);
    }
  }

  const byGroup = new Map<string, AdminTagRow[]>();
  for (const r of rows) {
    const k = r.groupSlug ?? "";
    byGroup.set(k, [...(byGroup.get(k) ?? []), r]);
  }
  const order = [...groups.map((g) => g.slug), ...[...byGroup.keys()].filter((k) => !groups.some((g) => g.slug === k))];
  const label = (k: string) => groups.find((g) => g.slug === k)?.nameUk ?? (k || "Без групи");

  return (
    <div className="space-y-8">
      <form
        className="rounded-lg border border-zinc-700/80 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Нова мітка</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <input className={inputCls} required value={draft.nameUk} onChange={(e) => setDraft((d) => ({ ...d, nameUk: e.target.value }))} placeholder="Назва (slug утвориться сам)" />
          <select className={inputCls} value={draft.groupSlug} onChange={(e) => setDraft((d) => ({ ...d, groupSlug: e.target.value }))}>
            <option value="">— без групи —</option>
            {groups.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.nameUk}
              </option>
            ))}
          </select>
          <input className={inputCls} value={draft.sortOrder} onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))} placeholder="Порядок (число)" />
          <input className={inputCls} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Опис для сторінки мітки" />
        </div>
        <div className="mt-3 flex items-center gap-4">
          <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
            Створити
          </button>
          {err ? <span className="text-sm text-red-400">{err}</span> : null}
        </div>
      </form>

      {order.map((k) => {
        const list = byGroup.get(k);
        if (!list?.length) return null;
        return (
          <section key={k || "none"}>
            <h2 className="mb-2 text-lg font-medium text-zinc-200">
              {label(k)} <span className="text-sm font-normal text-zinc-500">({list.length})</span>
            </h2>
            <div className="overflow-x-auto rounded-lg border border-zinc-700/80">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Мітка</th>
                    <th className="px-3 py-2">Порядок</th>
                    <th className="px-3 py-2">Товарів</th>
                    <th className="px-3 py-2">Джерело</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {list.map((t) => (
                    <TagRow key={t.id} tag={t} groups={groups} routeSecret={routeSecret} onError={setErr} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
