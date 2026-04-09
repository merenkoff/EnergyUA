import Link from "next/link";
import { AdminCategoryEditor } from "@/components/admin/AdminCategoryEditor";
import { prisma } from "@/lib/prisma";

const CATALOG_ROOT_SLUG = "tepla-pidloga";

export default async function AdminNewCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ secret: string }>;
  searchParams: Promise<{ parent?: string }>;
}) {
  const { secret } = await params;
  const sp = await searchParams;

  const root = await prisma.category.findUnique({
    where: { slug: CATALOG_ROOT_SLUG },
    select: { id: true },
  });

  let defaultParentId: string | null = root?.id ?? null;
  const q = typeof sp.parent === "string" ? sp.parent.trim() : "";
  if (q) {
    const p = await prisma.category.findUnique({ where: { id: q }, select: { id: true } });
    if (p) defaultParentId = p.id;
  }

  if (!defaultParentId) {
    return (
      <div>
        <p className="text-zinc-400">Немає кореневої категорії — виконайте npm run db:seed.</p>
        <Link href={`/ops/${secret}/categories`} className="mt-4 inline-block text-emerald-400 hover:underline">
          ← До списку
        </Link>
      </div>
    );
  }

  const categoriesRaw = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
    select: { id: true, nameUk: true, parent: { select: { nameUk: true } } },
  });
  const parentOptions = categoriesRaw.map((c) => ({
    id: c.id,
    label: c.parent ? `${c.parent.nameUk} → ${c.nameUk}` : c.nameUk,
  }));

  return (
    <div>
      <p className="mb-6 text-sm text-zinc-500">
        <Link href={`/ops/${secret}/categories`} className="text-emerald-400 hover:underline">
          ← До дерева категорій
        </Link>
      </p>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-100">Нова категорія</h1>
      <AdminCategoryEditor
        mode="create"
        routeSecret={secret}
        category={null}
        parentOptions={parentOptions}
        forbiddenParentIds={new Set()}
        defaultParentId={defaultParentId}
      />
    </div>
  );
}
