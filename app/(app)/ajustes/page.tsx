import { AjustesClient } from "@/components/ajustes-client";
import { auth } from "@/auth";

export const metadata = { title: "Ajustes" };

export default async function AjustesPage() {
  const session = await auth();
  const email = session?.user?.email ?? undefined;

  return <AjustesClient email={email} />;
}
