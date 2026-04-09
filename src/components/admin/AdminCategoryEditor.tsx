"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

export type CategoryFormRow = {
  id: string;
  slug: string;
  nameUk: string;
  nameRu: string | null;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
};

type CatOpt = { id: string; label: string };

export function AdminCategoryEditor({
  mode,
  routeSecret,
  category,
  parentOptions,
  forbiddenParentIds,
  defaultParentId,
}: {
  mode: "create" | "edit";
  routeSecret: string;
  category: CategoryFormRow | null;
  parentOptions: CatOpt[];
  /** Для edit: id, які не можна обрати як батька (сама категорія + нащадки). */
  forbiddenParentIds: Set<string>;
  /** Для create: початковий батько (наприклад з ?parent= або корінь каталогу). */
  defaultParentId: string | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(() => ({
    slug: category?.slug ?? "",
    nameUk: category?.nameUk ?? "",
    nameRu: category?.nameRu ?? "",
    description: category?.description ?? "",
    sortOrder: String(category?.sortOrder ?? 0),
    parentId:
      mode === "create"
        ? (defaultParentId ?? parentOptions[0]?.id ?? "")
        : (category?.parentId ?? ""),
  }));

  const parentChoices =
    mode === "edit" && category
      ? parentOptions.filter((o) => o.id === category.parentId || !forbiddenParentIds.has(o.id))
      : parentOptions;

  const save = useCallback(async () => {
    setMsg(null);
    setErr(null);
    setSaving(true);
    try {
      const sortOrder = parseInt(form.sortOrder, 10);
      if (mode === "create") {
        const res = await fetch("/api/admin/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nameUk: form.nameUk,
            nameRu: form.nameRu.trim() || null,
            description: form.description.trim() || null,
            slug: form.slug.trim() || undefined,
            sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
            parentId: form.parentId,
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setErr(typeof j.error === "string" ? j.error : "Помилка збереження");
          return;
        }
        setMsg("Створено.");
        router.push(`/ops/${routeSecret}/categories`);
        router.refresh();
        return;
      }

      if (!category) return;
      const res = await fetch(`/api/admin/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameUk: form.nameUk,
          nameRu: form.nameRu.trim() || null,
          description: form.description.trim() || null,
          slug: form.slug.trim(),
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
          parentId: form.parentId || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof j.error === "string" ? j.error : "Помилка збереження");
        return;
      }
      setMsg("Збережено.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }, [category, form, mode, router, routeSecret]);

  const inputCls =
    "mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500";
  const labelCls = "block text-sm text-zinc-400";

  return (
    <div className="max-w-xl space-y-4">
      {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}
      {err ? <p className="text-sm text-red-400">{err}</p> : null}

      <label className={labelCls}>
        Назва (UK) *
        <input
          className={inputCls}
          value={form.nameUk}
          onChange={(e) => setForm((f) => ({ ...f, nameUk: e.target.value }))}
        />
      </label>

      <label className={labelCls}>
        Назва (RU)
        <input
          className={inputCls}
          value={form.nameRu}
          onChange={(e) => setForm((f) => ({ ...f, nameRu: e.target.value }))}
        />
      </label>

      <label className={labelCls}>
        Slug (URL) — зміна змінить посилання в каталозі
        <input
          className={inputCls}
          value={form.slug}
          onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
          placeholder="латиниця, дефіси"
        />
      </label>

      <label className={labelCls}>
        Опис
        <textarea
          className={`${inputCls} min-h-[100px]`}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </label>

      <label className={labelCls}>
        Порядок сортування
        <input
          type="number"
          className={inputCls}
          value={form.sortOrder}
          onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
        />
      </label>

      <label className={labelCls}>
        Батьківська категорія
        <select
          className={inputCls}
          value={form.parentId}
          onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
        >
          {mode === "edit" ? <option value="">— без батька (корінь) —</option> : null}
          {parentChoices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        disabled={saving || !form.nameUk.trim() || (mode === "create" && !form.parentId)}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        onClick={() => void save()}
      >
        {saving ? "Збереження…" : mode === "create" ? "Створити" : "Зберегти"}
      </button>
    </div>
  );
}
