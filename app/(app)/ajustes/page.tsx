import { AjustesClient } from "@/components/ajustes-client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Ajustes" };

export default async function AjustesPage() {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id;
  let username: string | undefined;
  if (meId) {
    try {
      const me = await prisma.user.findUnique({ where: { id: meId }, select: { username: true } });
      username = me?.username;
    } catch {
      username = undefined;
    }
  }

  return <AjustesClient username={username} />;
}
