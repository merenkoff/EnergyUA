"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

type SpecRow = {
  id: string;
  definitionId: string;
  valueText: string | null;
  valueNumber: string | null;
  definition: { slug: string; labelUk: string; unit: string | null };
};

type ImgRow = {
  id: string;
  url: string;
  sourceUrl: string | null;
  altUk: string | null;
  sortOrder: number;
};

type ProductPayload = {
  id: string;
  slug: string;
  sku: string | null;
  nameUk: string;
  nameRu: string | null;
  shortDescription: string | null;
  description: string | null;
  priceUah: string | null;
  priceVisible: boolean;
  published: boolean;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  externalSource: string | null;
  externalId: string | null;
  externalUrl: string | null;
  sourceCategoryUrl: string | null;
  nameNormKey: string | null;
  mergedIntoProductId: string | null;
  categoryId: string;
  brandId: string | null;
  category: { id: string; nameUk: string };
  brand: { id: string; name: string } | null;
  images: ImgRow[];
  specs: SpecRow[];
  mergedInto: { id: string; slug: string; nameUk: string } | null;
};

type CatOpt = { id: string; label: string };
type BrandOpt = { id: string; name: string };

function ImageMetaFields({
  img,
  onApply,
}: {
  img: ImgRow;
  onApply: (altUk: string, sortOrder: number) => void;
}) {
  const [altUk, setAltUk] = useState(img.altUk ?? "");
  const [sortOrder, setSortOrder] = useState(String(img.sortOrder));
  const inputCls =
    "mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500";
  const labelCls = "block text-sm text-zinc-400";
  return (
    <>
      <label className={labelCls}>
        alt (UK)
        <input className={inputCls} value={altUk} onChange={(e) => setAltUk(e.target.value)} />
      </label>
      <label className={labelCls}>
        sortOrder
        <input
          type="number"
          className={inputCls}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="text-sm text-emerald-400 hover:underline"
        onClick={() => onApply(altUk, parseInt(sortOrder, 10) || 0)}
      >
        Застосувати alt / порядок
      </button>
    </>
  );
}

export function AdminProductEditor({
  routeSecret,
  product,
  categories,
  brands,
}: {
  routeSecret: string;
  product: ProductPayload;
  categories: CatOpt[];
  brands: BrandOpt[];
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(() => ({
    slug: product.slug,
    sku: product.sku ?? "",
    nameUk: product.nameUk,
    nameRu: product.nameRu ?? "",
    shortDescription: product.shortDescription ?? "",
    description: product.description ?? "",
    priceUah: product.priceUah ?? "",
    priceVisible: product.priceVisible,
    published: product.published,
    sortOrder: String(product.sortOrder),
    seoTitle: product.seoTitle ?? "",
    seoDescription: product.seoDescription ?? "",
    externalSource: product.externalSource ?? "",
    externalId: product.externalId ?? "",
    externalUrl: product.externalUrl ?? "",
    sourceCategoryUrl: product.sourceCategoryUrl ?? "",
    nameNormKey: product.nameNormKey ?? "",
    mergedIntoProductId: product.mergedIntoProductId ?? "",
    categoryId: product.categoryId,
    brandId: product.brandId ?? "",
  }));

  const [specs, setSpecs] = useState(
    () =>
      product.specs.map((s) => ({
        id: s.id,
        label: s.definition.labelUk,
        unit: s.definition.unit,
        valueText: s.valueText ?? "",
        valueNumber: s.valueNumber ?? "",
      })),
  );

  const [images, setImages] = useState(product.images);

  const productId = product.id;

  const saveProduct = useCallback(async () => {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        slug: form.slug,
        sku: form.sku.trim() || null,
        nameUk: form.nameUk,
        nameRu: form.nameRu.trim() || null,
        shortDescription: form.shortDescription || null,
        description: form.description || null,
        priceUah: form.priceUah.trim() ? form.priceUah.replace(",", ".") : null,
        priceVisible: form.priceVisible,
        published: form.published,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
        seoTitle: form.seoTitle.trim() || null,
        seoDescription: form.seoDescription.trim() || null,
        externalSource: form.externalSource.trim() || null,
        externalId: form.externalId.trim() || null,
        externalUrl: form.externalUrl.trim() || null,
        sourceCategoryUrl: form.sourceCategoryUrl.trim() || null,
        categoryId: form.categoryId,
        brandId: form.brandId.trim() ? form.brandId : null,
      };
      if (form.nameNormKey.trim()) body.nameNormKey = form.nameNormKey.trim();
      if (form.mergedIntoProductId.trim()) body.mergedIntoProductId = form.mergedIntoProductId.trim();
      else body.mergedIntoProductId = null;

      const res = await fetch(`/api/admin/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Збереження товару");

      const specPayload = {
        specs: specs.map((s) => ({
          id: s.id,
          valueText: s.valueText.trim() || null,
          valueNumber: s.valueNumber.trim() ? parseFloat(s.valueNumber.replace(",", ".")) : null,
        })),
      };
      const res2 = await fetch(`/api/admin/products/${productId}/specs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(specPayload),
      });
      const j2 = (await res2.json().catch(() => ({}))) as { error?: string };
      if (!res2.ok) throw new Error(j2.error ?? "Збереження характеристик");

      setMsg("Збережено");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Помилка");
    } finally {
      setSaving(false);
    }
  }, [form, productId, router, specs]);

  async function uploadImage(file: File, imageId?: string) {
    setErr(null);
    const fd = new FormData();
    fd.set("file", file);
    if (imageId) fd.set("imageId", imageId);
    const res = await fetch(`/api/admin/products/${productId}/images`, { method: "POST", body: fd });
    const j = (await res.json().catch(() => ({}))) as { error?: string; image?: ImgRow };
    if (!res.ok) throw new Error(j.error ?? "Завантаження");
    if (j.image) {
      if (imageId) {
        setImages((prev) => prev.map((x) => (x.id === imageId ? j.image! : x)));
      } else {
        setImages((prev) => [...prev, j.image!].sort((a, b) => a.sortOrder - b.sortOrder));
      }
    }
    router.refresh();
  }

  async function deleteImage(imageId: string) {
    if (!confirm("Видалити зображення?")) return;
    setErr(null);
    const res = await fetch(`/api/admin/products/${productId}/images/${imageId}`, { method: "DELETE" });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(j.error ?? "Видалення");
    setImages((prev) => prev.filter((x) => x.id !== imageId));
    router.refresh();
  }

  async function patchImageMeta(imageId: string, altUk: string, sortOrder: number) {
    const res = await fetch(`/api/admin/products/${productId}/images/${imageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ altUk: altUk || null, sortOrder }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? "Оновлення");
    }
    router.refresh();
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500";
  const labelCls = "block text-sm text-zinc-400";

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-50">Редагування товару</h1>
        <button
          type="button"
          onClick={() => saveProduct()}
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "Збереження…" : "Зберегти зміни"}
        </button>
      </div>
      {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}
      {err ? <p className="text-sm text-red-400">{err}</p> : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-medium text-zinc-200">Основне</h2>
          <div className="space-y-3">
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
              Slug *
              <input
                className={inputCls}
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              />
            </label>
            <label className={labelCls}>
              SKU
              <input
                className={inputCls}
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              />
            </label>
            <label className={labelCls}>
              Категорія *
              <select
                className={inputCls}
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Бренд
              <select
                className={inputCls}
                value={form.brandId}
                onChange={(e) => setForm((f) => ({ ...f, brandId: e.target.value }))}
              >
                <option value="">— немає —</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Ціна (UAH)
              <input
                className={inputCls}
                value={form.priceUah}
                onChange={(e) => setForm((f) => ({ ...f, priceUah: e.target.value }))}
                placeholder="8990"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={form.priceVisible}
                onChange={(e) => setForm((f) => ({ ...f, priceVisible: e.target.checked }))}
              />
              Показувати ціну
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))}
              />
              Опубліковано
            </label>
            <label className={labelCls}>
              Порядок сортування
              <input
                className={inputCls}
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            </label>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-medium text-zinc-200">Опис і SEO</h2>
          <div className="space-y-3">
            <label className={labelCls}>
              Короткий опис
              <textarea
                className={`${inputCls} min-h-[80px]`}
                value={form.shortDescription}
                onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value }))}
              />
            </label>
            <label className={labelCls}>
              Опис HTML
              <textarea
                className={`${inputCls} min-h-[160px] font-mono text-xs`}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
            <label className={labelCls}>
              SEO title
              <input className={inputCls} value={form.seoTitle} onChange={(e) => setForm((f) => ({ ...f, seoTitle: e.target.value }))} />
            </label>
            <label className={labelCls}>
              SEO description
              <textarea
                className={`${inputCls} min-h-[72px]`}
                value={form.seoDescription}
                onChange={(e) => setForm((f) => ({ ...f, seoDescription: e.target.value }))}
              />
            </label>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-zinc-200">Імпорт / злиття</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <label className={labelCls}>
            externalSource
            <input className={inputCls} value={form.externalSource} onChange={(e) => setForm((f) => ({ ...f, externalSource: e.target.value }))} />
          </label>
          <label className={labelCls}>
            externalId
            <input className={inputCls} value={form.externalId} onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))} />
          </label>
          <label className={labelCls}>
            externalUrl
            <input className={inputCls} value={form.externalUrl} onChange={(e) => setForm((f) => ({ ...f, externalUrl: e.target.value }))} />
          </label>
          <label className={labelCls}>
            sourceCategoryUrl
            <input
              className={inputCls}
              value={form.sourceCategoryUrl}
              onChange={(e) => setForm((f) => ({ ...f, sourceCategoryUrl: e.target.value }))}
            />
          </label>
          <label className={labelCls}>
            nameNormKey (авто з назви, можна вручну)
            <input className={inputCls} value={form.nameNormKey} onChange={(e) => setForm((f) => ({ ...f, nameNormKey: e.target.value }))} />
          </label>
          <label className={labelCls}>
            mergedIntoProductId (cuid канонічного товару або порожньо)
            <input
              className={inputCls}
              value={form.mergedIntoProductId}
              onChange={(e) => setForm((f) => ({ ...f, mergedIntoProductId: e.target.value }))}
            />
          </label>
        </div>
        {product.mergedInto ? (
          <p className="mt-2 text-sm text-amber-400">
            Зараз зливається в:{" "}
            <a className="underline" href={`/ops/${routeSecret}/products/${product.mergedInto.id}`}>
              {product.mergedInto.nameUk}
            </a>{" "}
            ({product.mergedInto.slug})
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-zinc-200">Зображення</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Файли зберігаються у MEDIA_ROOT; URL у БД — <code className="text-zinc-400">/api/media/…</code>
        </p>
        <div className="space-y-6">
          {images.map((img) => (
            <div key={img.id} className="flex flex-col gap-3 rounded-lg border border-zinc-700 p-4 sm:flex-row sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="h-28 w-28 shrink-0 rounded bg-zinc-800 object-contain" />
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <div className="truncate text-zinc-500">{img.url}</div>
                <ImageMetaFields
                  img={img}
                  onApply={(altUk, sortOrder) => {
                    void patchImageMeta(img.id, altUk, sortOrder).catch((x) => setErr(String(x)));
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <label className="cursor-pointer rounded border border-zinc-600 px-3 py-1.5 text-emerald-400 hover:bg-zinc-800">
                    Замінити файл
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadImage(f, img.id).catch((x) => setErr(String(x)));
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded border border-red-900/80 px-3 py-1.5 text-red-400 hover:bg-red-950/40"
                    onClick={() => void deleteImage(img.id).catch((x) => setErr(String(x)))}
                  >
                    Видалити
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-zinc-600 px-4 py-3 text-sm text-zinc-400 hover:border-emerald-600 hover:text-emerald-400">
              + Додати зображення
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadImage(f).catch((x) => setErr(String(x)));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-zinc-200">Характеристики</h2>
        <div className="space-y-4">
          {specs.map((s, i) => (
            <div key={s.id} className="rounded-lg border border-zinc-700/80 p-3">
              <div className="mb-2 text-sm font-medium text-zinc-200">
                {s.label}
                {s.unit ? <span className="text-zinc-500"> ({s.unit})</span> : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={labelCls}>
                  Текст
                  <input
                    className={inputCls}
                    value={s.valueText}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSpecs((prev) => prev.map((row, j) => (j === i ? { ...row, valueText: v } : row)));
                    }}
                  />
                </label>
                <label className={labelCls}>
                  Число
                  <input
                    className={inputCls}
                    value={s.valueNumber}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSpecs((prev) => prev.map((row, j) => (j === i ? { ...row, valueNumber: v } : row)));
                    }}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-end border-t border-zinc-800 pt-6">
        <button
          type="button"
          onClick={() => saveProduct()}
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "Збереження…" : "Зберегти все"}
        </button>
      </div>
    </div>
  );
}
