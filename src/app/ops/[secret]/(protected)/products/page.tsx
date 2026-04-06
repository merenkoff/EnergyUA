import Link from "next/link";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 40;

type Props = {
  params: Promise<{ secret: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
};

export default async function AdminProductsPage({ params, searchParams }: Props) {
  const { secret } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const where = q
    ? {
        OR: [
          { nameUk: { contains: q, mode: "insensitive" as const } },
          { slug: { contains: q, mode: "insensitive" as const } },
          { sku: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: PAGE_SIZE,
      skip,
      select: {
        id: true,
        slug: true,
        nameUk: true,
        sku: true,
        published: true,
        priceUah: true,
        category: { select: { nameUk: true, slug: true } },
      },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (extra: Record<string, string>) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    Object.entries(extra).forEach(([k, v]) => u.set(k, v));
    const s = u.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Товари</h1>
      <form method="get" className="mb-6 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Пошук: назва, slug, SKU"
          className="min-w-[200px] flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        />
        <button type="submit" className="rounded-lg bg-zinc-700 px-4 py-2 text-sm hover:bg-zinc-600">
          Шукати
        </button>
      </form>

      <p className="mb-3 text-sm text-zinc-500">
        Знайдено: {total} · сторінка {page} / {pages}
      </p>

      <div className="overflow-x-auto rounded-lg border border-zinc-700/80">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Назва</th>
              <th className="px-3 py-2">Категорія</th>
              <th className="px-3 py-2">Ціна</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-zinc-900/50">
                <td className="px-3 py-2">
                  <div className="font-medium text-zinc-100">{p.nameUk}</div>
                  <div className="text-xs text-zinc-500">{p.slug}</div>
                </td>
                <td className="px-3 py-2 text-zinc-400">{p.category.nameUk}</td>
                <td className="px-3 py-2 text-zinc-300">
                  {p.priceUah != null ? `${p.priceUah.toString()} ₴` : "—"}
                </td>
                <td className="px-3 py-2">
                  {p.published ? (
                    <span className="text-emerald-400">опубліковано</span>
                  ) : (
                    <span className="text-zinc-500">чернетка</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/ops/${secret}/products/${p.id}`}
                    className="text-emerald-400 hover:underline"
                  >
                    Редагувати
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav className="mt-6 flex flex-wrap gap-2 text-sm">
          {page > 1 ? (
            <Link
              href={`/ops/${secret}/products${qs({ page: String(page - 1) })}`}
              className="rounded border border-zinc-600 px-3 py-1 hover:bg-zinc-800"
            >
              ← Назад
            </Link>
          ) : null}
          {page < pages ? (
            <Link
              href={`/ops/${secret}/products${qs({ page: String(page + 1) })}`}
              className="rounded border border-zinc-600 px-3 py-1 hover:bg-zinc-800"
            >
              Далі →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
