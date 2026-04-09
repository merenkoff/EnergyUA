import Link from "next/link";
import type { CategoryTreeNode } from "@/lib/categoryTree";

export function AdminCategoryTree({ nodes, secret }: { nodes: CategoryTreeNode[]; secret: string }) {
  return (
    <ul className="space-y-2">
      {nodes.map((n) => (
        <li key={n.id} className="border-l border-zinc-600 pl-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <Link href={`/ops/${secret}/categories/${n.id}`} className="font-medium text-emerald-400 hover:underline">
              {n.nameUk}
            </Link>
            <span className="text-xs text-zinc-500">{n.slug}</span>
            <Link
              href={`/ops/${secret}/categories/new?parent=${n.id}`}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              + підкатегорія
            </Link>
          </div>
          {n.children.length > 0 ? (
            <div className="mt-2">
              <AdminCategoryTree nodes={n.children} secret={secret} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
