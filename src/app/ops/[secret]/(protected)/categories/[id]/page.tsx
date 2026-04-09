import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminCategoryEditor } from "@/components/admin/AdminCategoryEditor";
import { childrenMapFromRows, collectDescendantIds } from "@/lib/categoryTree";
import { prisma } from "@/lib/prisma";

export default async function AdminEditCategoryPage({
  params,
}: {
  params: Promise<{ secret: string; id: string }>;
}) {
  const { secret, id } = await params;

  const category = await prisma.category.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      nameUk: true,
      nameRu: true,
      description: true,
      sortOrder: true,
      parentId: true,
    },
  });

  if (!category) notFound();

  const [categoriesRaw, allRows] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
      select: { id: true, nameUk: true, parent: { select: { nameUk: true } } },
    }),
    prisma.category.findMany({ select: { id: true, parentId: true } }),
  ]);

  const parentOptions = categoriesRaw.map((c) => ({
    id: c.id,
    label: c.parent ? `${c.parent.nameUk} → ${c.nameUk}` : c.nameUk,
  }));

  const childMap = childrenMapFromRows(allRows);
  const descendants = collectDescendantIds(category.id, childMap);
  const forbiddenParentIds = new Set(descendants);
  forbiddenParentIds.add(category.id);

  const productCount = await prisma.product.count({ where: { categoryId: id } });
  const childCount = await prisma.category.count({ where: { parentId: id } });

  return (
    <div>
      <p className="mb-6 text-sm text-zinc-500">
        <Link href={`/ops/${secret}/categories`} className="text-emerald-400 hover:underline">
          ← До дерева категорій
        </Link>
        {" · "}
        <a href={`/catalog/${category.slug}`} className="text-zinc-400 hover:text-zinc-200" target="_blank" rel="noreferrer">
          Публічна сторінка
        </a>
      </p>
      <h1 className="mb-2 text-2xl font-semibold text-zinc-100">Редагування категорії</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Товарів у розділі: {productCount}. Підкатегорій: {childCount}.
      </p>
      <AdminCategoryEditor
        mode="edit"
        routeSecret={secret}
        category={{
          id: category.id,
          slug: category.slug,
          nameUk: category.nameUk,
          nameRu: category.nameRu,
          description: category.description,
          sortOrder: category.sortOrder,
          parentId: category.parentId,
        }}
        parentOptions={parentOptions}
        forbiddenParentIds={forbiddenParentIds}
        defaultParentId={null}
      />
    </div>
  );
}
