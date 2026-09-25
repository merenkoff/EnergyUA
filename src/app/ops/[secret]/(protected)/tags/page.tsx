import { AdminTagsManager } from "@/components/admin/AdminTagsManager";
import { prisma } from "@/lib/prisma";
import { TAG_GROUPS } from "@/lib/tagGroups";

export default async function AdminTagsPage({ params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const tags = await prisma.tag.findMany({
    orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
    select: {
      id: true,
      slug: true,
      nameUk: true,
      groupSlug: true,
      description: true,
      sortOrder: true,
      manual: true,
      _count: { select: { products: true } },
    },
  });
  const rows = tags.map((t) => ({
    id: t.id,
    slug: t.slug,
    nameUk: t.nameUk,
    groupSlug: t.groupSlug,
    description: t.description,
    sortOrder: t.sortOrder,
    manual: t.manual,
    products: t._count.products,
  }));
  const groups = [...TAG_GROUPS].sort((a, b) => a.sortOrder - b.sortOrder).map((g) => ({ slug: g.slug, nameUk: g.nameUk }));

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-zinc-100">Мітки</h1>
      <p className="mb-6 max-w-2xl text-sm text-zinc-400">
        Мітка — довільна кількість на товар; одна позиція видна в кількох зрізах одночасно. Мітки «таксономія» задає парсер
        прайсів; після редагування тут мітка стає «вручну» і seed її більше не перезаписує. Мітки конкретного товару
        редагуються на його картці.
      </p>
      <AdminTagsManager routeSecret={secret} groups={groups} rows={rows} />
    </div>
  );
}
