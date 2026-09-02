import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { isRateLimited } from "@/lib/rate-limit";

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role?: string;
  slots_limit?: number;
  subscription_status?: string;
  plan_tier?: string;
};

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        // Throttle login attempts per IP — this is the password brute-force surface.
        if (isRateLimited(req, "login", 10, 15 * 60 * 1000)) {
          throw new Error("Too many attempts. Try again later.");
        }

        const db = getDb();
        const user = db
          .prepare(
            "SELECT id, email, password_hash, role, slots_limit, subscription_status, plan_tier FROM users WHERE email = ?"
          )
          .get(credentials.email) as UserRow | undefined;

        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) return null;

        const isSuperAdmin = credentials.email.trim().toLowerCase() === "inhubflow@gmail.com";
        if (isSuperAdmin && user.role !== "admin") {
          db.prepare("UPDATE users SET role = 'admin', slots_limit = 999, plan_tier = 'custom' WHERE id = ?").run(user.id);
          user.role = "admin";
          user.slots_limit = 999;
        }

        return {
          id: user.id,
          email: user.email,
          role: isSuperAdmin ? "admin" : (user.role || "user"),
          slots_limit: isSuperAdmin ? 999 : (user.slots_limit || 1),
          subscription_status: user.subscription_status || "active",
          plan_tier: isSuperAdmin ? "custom" : (user.plan_tier || "starter"),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role || "user";
        token.slots_limit = (user as { slots_limit?: number }).slots_limit || 1;
        token.subscription_status = (user as { subscription_status?: string }).subscription_status || "active";
        token.plan_tier = (user as { plan_tier?: string }).plan_tier || "starter";
      }

      // Auto-heal existing sessions: query DB to ensure role and slots are always up to date
      if (token.email) {
        try {
          const db = getDb();
          const userRow = db
            .prepare("SELECT id, role, slots_limit, subscription_status, plan_tier FROM users WHERE email = ?")
            .get(token.email) as { id: string; role?: string; slots_limit?: number; subscription_status?: string; plan_tier?: string } | undefined;

          if (userRow) {
            // If user is first in DB, ensure they are promoted to admin
            const firstUser = db.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
            if (firstUser && firstUser.id === userRow.id && userRow.role !== "admin") {
              db.prepare("UPDATE users SET role = 'admin', slots_limit = 999, plan_tier = 'custom' WHERE id = ?").run(userRow.id);
              userRow.role = "admin";
              userRow.slots_limit = 999;
            }

            token.id = userRow.id;
            token.role = userRow.role || "user";
            token.slots_limit = userRow.slots_limit || 1;
            token.subscription_status = userRow.subscription_status || "active";
            token.plan_tier = userRow.plan_tier || "starter";
          }
        } catch {
          // ignore error if db busy
        }
      }

      // Special guarantee for inhubflow@gmail.com
      if (token.email && token.email.trim().toLowerCase() === "inhubflow@gmail.com") {
        token.role = "admin";
        token.slots_limit = 999;
        token.plan_tier = "custom";
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as Record<string, unknown>;
        u.id = token.id as string;
        u.role = (token.role as string) || "user";
        u.slots_limit = (token.slots_limit as number) || 1;
        u.subscription_status = (token.subscription_status as string) || "active";
        u.plan_tier = (token.plan_tier as string) || "starter";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
