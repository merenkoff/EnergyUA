import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminProductEditor } from "@/components/admin/AdminProductEditor";
import { prisma } from "@/lib/prisma";

export default async function AdminProductPage({
  params,
}: {
  params: Promise<{ secret: string; id: string }>;
}) {
  const { secret, id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, nameUk: true } },
      brand: { select: { id: true, name: true } },
      images: { orderBy: { sortOrder: "asc" } },
      specs: {
        include: { definition: true },
        orderBy: { definition: { sortOrder: "asc" } },
      },
      mergedInto: { select: { id: true, slug: true, nameUk: true } },
    },
  });

  if (!product) notFound();

  const [categoriesRaw, brands] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ parentId: "asc" }, { nameUk: "asc" }],
      select: { id: true, nameUk: true, parent: { select: { nameUk: true } } },
    }),
    prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const categories = categoriesRaw.map((c) => ({
    id: c.id,
    label: c.parent ? `${c.parent.nameUk} → ${c.nameUk}` : c.nameUk,
  }));

  const payload = {
    id: product.id,
    slug: product.slug,
    sku: product.sku,
    nameUk: product.nameUk,
    nameRu: product.nameRu,
    shortDescription: product.shortDescription,
    description: product.description,
    priceUah: product.priceUah?.toString() ?? null,
    priceVisible: product.priceVisible,
    published: product.published,
    sortOrder: product.sortOrder,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    externalSource: product.externalSource,
    externalId: product.externalId,
    externalUrl: product.externalUrl,
    sourceCategoryUrl: product.sourceCategoryUrl,
    nameNormKey: product.nameNormKey,
    mergedIntoProductId: product.mergedIntoProductId,
    categoryId: product.categoryId,
    brandId: product.brandId,
    category: product.category,
    brand: product.brand,
    images: product.images.map((im) => ({
      id: im.id,
      url: im.url,
      sourceUrl: im.sourceUrl,
      altUk: im.altUk,
      sortOrder: im.sortOrder,
    })),
    specs: product.specs.map((s) => ({
      id: s.id,
      definitionId: s.definitionId,
      valueText: s.valueText,
      valueNumber: s.valueNumber?.toString() ?? null,
      definition: {
        slug: s.definition.slug,
        labelUk: s.definition.labelUk,
        unit: s.definition.unit,
      },
    })),
    mergedInto: product.mergedInto,
  };

  return (
    <div>
      <p className="mb-6 text-sm text-zinc-500">
        <Link href={`/ops/${secret}/products`} className="text-emerald-400 hover:underline">
          ← До списку
        </Link>
        {" · "}
        <a href={`/product/${product.slug}`} className="text-zinc-400 hover:text-zinc-200" target="_blank" rel="noreferrer">
          Публічна картка
        </a>
      </p>
      <AdminProductEditor routeSecret={secret} product={payload} categories={categories} brands={brands} />
    </div>
  );
}
