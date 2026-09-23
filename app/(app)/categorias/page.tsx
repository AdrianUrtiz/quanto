import { AppHeader } from "@/components/app-header";
import { CategoryManager } from "@/components/category-manager";
import { auth } from "@/auth";
import { getCatalog } from "@/lib/catalog";

export const metadata = { title: "Categorías" };
export const dynamic = "force-dynamic";

export default async function CategoriasPage() {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? "u-adrian";
  const cats = await getCatalog(meId);

  return (
    <>
      <AppHeader title="Categorías" />
      <CategoryManager cats={cats} />
    </>
  );
}
