import { redirect } from "next/navigation";

export default async function AdminIndex({ params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  redirect(`/ops/${secret}/products`);
}
