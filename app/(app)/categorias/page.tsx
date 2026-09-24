import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CategoryManager } from "@/components/category-manager";
import { auth } from "@/auth";
import { getCatalog } from "@/lib/catalog";

export const metadata = { title: "Categorías" };
export const dynamic = "force-dynamic";

export default async function CategoriasPage() {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id;
  if (!meId) redirect("/login");
  const cats = await getCatalog(meId);

  return (
    <>
      <div className="px-5 pt-4">
        <Link
          href="/ajustes"
          className="inline-flex items-center gap-1 text-sm font-semibold text-(--muted-foreground)"
        >
          <ChevronLeft className="size-4" /> Ajustes
        </Link>
      </div>
      <CategoryManager cats={cats} />
    </>
  );
}
