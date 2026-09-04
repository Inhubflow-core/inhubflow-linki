import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getInstanceSettings } from "@/lib/auto-seed";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const session = await getServerSession(req, res, authOptions);
  const currentUser = session?.user as any;
  const { slotsLimit: defaultLimit, companyName: defaultCompanyName } = getInstanceSettings(db);

  let slotsLimit = defaultLimit;
  let companyName = defaultCompanyName || "InHubFlow Suite";
  let accountsCount = 0;
  let emailsCount = 0;

  if (currentUser) {
    const isSuperAdmin =
      currentUser.role === "admin" ||
      currentUser.email?.trim().toLowerCase() === "inhubflow@gmail.com";

    if (isSuperAdmin) {
      slotsLimit = currentUser.slots_limit || 999;
      companyName = defaultCompanyName || "InHubFlow Master";
      accountsCount =
        (db.prepare("SELECT COUNT(*) as count FROM accounts").get() as { count: number })?.count || 0;
      emailsCount =
        (db.prepare("SELECT COUNT(*) as count FROM email_accounts").get() as { count: number })?.count || 0;
    } else {
      // Client / Tenant or Team Member
      const workspaceOwnerId = currentUser.owner_id || currentUser.id;
      const userRow = db
        .prepare("SELECT slots_limit, company_name, plan_tier, role FROM users WHERE id = ?")
        .get(workspaceOwnerId) as { slots_limit?: number; company_name?: string; plan_tier?: string; role?: string } | undefined;

      slotsLimit = userRow?.slots_limit || currentUser.slots_limit || defaultLimit;
      companyName = userRow?.company_name || currentUser.name || "InHubFlow B2B";

      // Accounts belonging to this workspace
      accountsCount =
        (
          db
            .prepare(
              "SELECT COUNT(*) as count FROM accounts WHERE owner_id = ? OR assigned_user_id = ?"
            )
            .get(workspaceOwnerId, currentUser.id) as { count: number }
        )?.count || 0;

      try {
        emailsCount =
          (
            db
              .prepare("SELECT COUNT(*) as count FROM email_accounts WHERE owner_id = ?")
              .get(workspaceOwnerId) as { count: number }
          )?.count || 0;
      } catch {
        emailsCount = 0;
      }
    }
  } else {
    accountsCount =
      (db.prepare("SELECT COUNT(*) as count FROM accounts").get() as { count: number })?.count || 0;
    emailsCount =
      (db.prepare("SELECT COUNT(*) as count FROM email_accounts").get() as { count: number })?.count || 0;
  }

  return res.json({
    companyName: companyName || "InHubFlow Suite",
    slotsLimit,
    accountsUsed: accountsCount,
    emailsUsed: emailsCount,
    slotsRemaining: Math.max(0, slotsLimit - accountsCount),
    platform: "InHubFlow B2B Suite",
    version: "2026.1",
  });
}
