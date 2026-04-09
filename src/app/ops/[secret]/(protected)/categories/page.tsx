import Link from "next/link";
import { AdminCategoryTree } from "@/components/admin/AdminCategoryTree";
import { buildCategoryTree } from "@/lib/categoryTree";
import { prisma } from "@/lib/prisma";

const CATALOG_ROOT_SLUG = "tepla-pidloga";

export default async function AdminCategoriesPage({ params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;

  const rows = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
    select: { id: true, slug: true, nameUk: true, parentId: true, sortOrder: true },
  });

  const tree = buildCategoryTree(rows);

  const root = await prisma.category.findUnique({
    where: { slug: CATALOG_ROOT_SLUG },
    select: { id: true },
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-100">Категорії каталогу</h1>
        {root ? (
          <Link
            href={`/ops/${secret}/categories/new?parent=${root.id}`}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Нова категорія (під «Каталог»)
          </Link>
        ) : null}
      </div>
      <p className="mb-6 max-w-2xl text-sm text-zinc-400">
        Назви, slug і батьківський розділ синхронні з публічним каталогом{" "}
        <Link href="/catalog" className="text-emerald-400 hover:underline">
          /catalog
        </Link>
        . Підкатегорії відображаються на сторінці батька та в хлібних крихтах.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Категорій немає — виконайте seed або імпорт.</p>
      ) : (
        <AdminCategoryTree nodes={tree} secret={secret} />
      )}
    </div>
  );
}
