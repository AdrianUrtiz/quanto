import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

// Nota: NO importar prisma aquí a nivel superior — este módulo también se
// usa desde middleware.ts (edge) y Prisma solo corre en Node.
// El acceso a DB se hace con import dinámico dentro de authorize().

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const hasDb = Boolean(process.env.DATABASE_URL);

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Email y contraseña",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(raw) {
        const parsed = LoginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // Sin DB (demo local): acepta las cuentas semilla en memoria.
        if (!hasDb) {
          const demo = [
            { id: "u-adrian", email: "adrian@quanto.app", name: "Adrián", pass: "quanto123" },
            { id: "u-pareja", email: "pareja@quanto.app", name: "Pareja", pass: "quanto123" },
          ].find((u) => u.email.toLowerCase() === email.toLowerCase());
          if (demo && password === demo.pass) {
            return { id: demo.id, email: demo.email, name: demo.name };
          }
          return null;
        }

        const { prisma } = await import("@/lib/prisma");
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.avatar ?? undefined };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      if (user?.name) token.name = user.name;
      return token;
    },
    async session({ session, token }) {
      if (token.sub && session.user) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
});
