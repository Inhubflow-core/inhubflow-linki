import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

export interface AutoSeedResult {
  adminSeeded: boolean;
  adminEmail?: string;
  slotsLimit: number;
  companyName: string;
}

/**
 * Automatically seeds the instance upon first boot or environment configuration.
 * Idempotent, safe, and fast.
 */
export function autoSeedInstance(db: Database.Database): AutoSeedResult {
  const adminEmail = (process.env.INITIAL_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "";
  const adminPasswordHash = process.env.INITIAL_ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH || "";
  const slotsLimit = parseInt(process.env.SLOTS_LIMIT || process.env.MAX_SLOTS || "4", 10);
  const companyName = (process.env.COMPANY_NAME || process.env.CLIENT_COMPANY || "").trim();

  let adminSeeded = false;

  // 1. Ensure instance_settings table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS instance_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 2. Save / update slots limit and company info
  const setSettingStmt = db.prepare(`
    INSERT INTO instance_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  setSettingStmt.run("slots_limit", String(slotsLimit));
  if (companyName) {
    setSettingStmt.run("company_name", companyName);
  }

  // 3. Seed initial admin user if configured
  if (adminEmail) {
    const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail) as { id: string } | undefined;

    if (!existingUser) {
      let finalHash = adminPasswordHash;

      if (!finalHash || !finalHash.startsWith("$2")) {
        const rawPassword = adminPassword || "InHubFlow2026!";
        finalHash = bcrypt.hashSync(rawPassword, 10);
      }

      const userId = randomUUID();
      db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
        userId,
        adminEmail,
        finalHash
      );

      adminSeeded = true;
      console.log(`[InHubFlow AutoSeed] ✅ Initial admin user seeded successfully: ${adminEmail}`);
    } else {
      console.log(`[InHubFlow AutoSeed] ℹ️ Admin user already exists: ${adminEmail}`);
    }
  }

  console.log(`[InHubFlow AutoSeed] 🚀 Instance initialized with ${slotsLimit} slots limit${companyName ? ` for '${companyName}'` : ""}.`);

  return {
    adminSeeded,
    adminEmail: adminEmail || undefined,
    slotsLimit,
    companyName,
  };
}

/**
 * Helper to fetch instance limits
 */
export function getInstanceSettings(db: Database.Database): { slotsLimit: number; companyName: string } {
  try {
    const rows = db.prepare("SELECT key, value FROM instance_settings").all() as { key: string; value: string }[];
    const settingsMap = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
      slotsLimit: parseInt(settingsMap.slots_limit || "4", 10),
      companyName: settingsMap.company_name || "",
    };
  } catch {
    return { slotsLimit: 4, companyName: "" };
  }
}
