"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export type AdminTagOption = { id: string; slug: string; nameUk: string; groupSlug: string | null; sortOrder: number };
export type AdminTagGroup = { slug: string; nameUk: string; tags: AdminTagOption[] };

export function AdminProductTags({
  routeSecret,
  productId,
  initialTagIds,
  initialManual,
  fromPricelist,
  groups,
}: {
  routeSecret: string;
  productId: string;
  initialTagIds: string[];
  initialManual: boolean;
  /** Товар імпортовано з прайсу: можна повернути мітки «як у прайсі». */
  fromPricelist: boolean;
  groups: AdminTagGroup[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialTagIds));
  const [saved, setSaved] = useState<Set<string>>(() => new Set(initialTagIds));
  const [manual, setManual] = useState(initialManual);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dirty = useMemo(() => {
    if (selected.size !== saved.size) return true;
    for (const id of selected) if (!saved.has(id)) return true;
    return false;
  }, [selected, saved]);

  const q = filter.trim().toLowerCase();
  const visible = groups
    .map((g) => ({ ...g, tags: q ? g.tags.filter((t) => t.nameUk.toLowerCase().includes(q) || t.slug.includes(q)) : g.tags }))
    .filter((g) => g.tags.length);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/products/${productId}/tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: [...selected] }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; tagIds?: string[]; tagsManual?: boolean };
      if (!res.ok) throw new Error(j.error ?? "Збереження міток");
      setSaved(new Set(j.tagIds ?? [...selected]));
      setManual(Boolean(j.tagsManual));
      setMsg("Мітки збережено");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Помилка");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirm("Повернути мітки з прайсу? Ручні зміни міток цього товару буде втрачено.")) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/products/${productId}/tags/reset`, { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { error?: string; tagIds?: string[] };
      if (!res.ok) throw new Error(j.error ?? "Скидання міток");
      const ids = new Set(j.tagIds ?? []);
      setSelected(ids);
      setSaved(new Set(ids));
      setManual(false);
      setMsg("Мітки повернуто з прайсу; імпорт знову оновлюватиме їх");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Помилка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-zinc-200">
          Мітки <span className="text-sm font-normal text-zinc-500">({selected.size})</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/ops/${routeSecret}/tags`} className="text-sm text-zinc-400 hover:text-zinc-200">
            Керувати мітками
          </a>
          {fromPricelist && manual ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void reset()}
              className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Повернути з прайсу
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => void save()}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Збереження…" : "Зберегти мітки"}
          </button>
        </div>
      </div>
      <p className="mb-3 text-sm text-zinc-500">
        {fromPricelist
          ? manual
            ? "Мітки задано вручну: імпорт прайсів їх не змінює."
            : "Мітки з прайсу: імпорт оновлює їх при кожному деплої. Після ручного збереження імпорт перестане їх чіпати."
          : "Мітки цього товару задаються лише тут."}
      </p>
      {msg ? <p className="mb-2 text-sm text-emerald-400">{msg}</p> : null}
      {err ? <p className="mb-2 text-sm text-red-400">{err}</p> : null}
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Фільтр міток…"
        className="mb-4 w-full max-w-sm rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((g) => (
          <fieldset key={g.slug} className="rounded-lg border border-zinc-700/80 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">{g.nameUk}</legend>
            <div className="flex flex-wrap gap-1.5">
              {g.tags.map((t) => {
                const on = selected.has(t.id);
                return (
                  <label
                    key={t.id}
                    className={`cursor-pointer select-none rounded-full border px-2.5 py-1 text-xs transition ${
                      on
                        ? "border-emerald-500 bg-emerald-600/20 text-emerald-200"
                        : "border-zinc-600 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200"
                    }`}
                    title={t.slug}
                  >
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(t.id)} />
                    {t.nameUk}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        {visible.length === 0 ? <p className="text-sm text-zinc-500">Нічого не знайдено.</p> : null}
      </div>
    </section>
  );
}
