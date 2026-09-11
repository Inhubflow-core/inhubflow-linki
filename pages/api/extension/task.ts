import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { randomUUID } from "crypto";

function renderTemplate(body: string, target: any): string {
  if (!body) return "";
  const firstName = target.first_name || target.full_name?.split(" ")[0] || "";
  const lastName = target.last_name || target.full_name?.split(" ").slice(1).join(" ") || "";
  return body
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{last_name\}\}/gi, lastName)
    .replace(/\{\{full_name\}\}/gi, target.full_name || "")
    .replace(/\{\{company\}\}/gi, target.company || "")
    .replace(/\{\{title\}\}/gi, target.title || "")
    .replace(/\{\{location\}\}/gi, target.location || "")
    .trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = getDb();
  let accountId = (req.headers["x-account-id"] || req.query.account_id || req.body?.account_id) as string | undefined;

  // Smart multi-account resolution: match by LinkedIn session token if accountId is not provided
  const tokenHeader = (req.headers["x-linkedin-token"] || req.body?.li_at || req.query?.li_at) as string | undefined;
  if (!accountId && tokenHeader && tokenHeader.length > 20) {
    const allAccounts = db.prepare("SELECT id, cookies_json FROM accounts WHERE is_authenticated = 1").all() as any[];
    for (const a of allAccounts) {
      if (!a.cookies_json) continue;
      const dec = decryptSecret(a.cookies_json);
      if (dec && dec.includes(tokenHeader.trim())) {
        accountId = a.id;
        break;
      }
    }
  }

  // Fallback: If no account ID passed, resolve the first active authenticated account
  if (!accountId) {
    const acc = db.prepare("SELECT id FROM accounts WHERE is_authenticated = 1 LIMIT 1").get() as { id: string } | undefined;
    accountId = acc?.id;
  }

  if (!accountId) {
    return res.status(200).json({
      task: null,
      stats: null,
      reason: "no_account_connected",
      message: "No active LinkedIn account found",
    });
  }

  // Update extension activity ping
  try {
    db.prepare(`
      UPDATE accounts 
      SET extension_active = 1, 
          last_extension_ping_at = datetime('now') 
      WHERE id = ?
    `).run(accountId);
  } catch { /* ignore */ }

  const account = db.prepare(`
    SELECT id, email, daily_connect_limit, daily_message_limit, active_hours_start, active_hours_end, timezone, working_days
    FROM accounts WHERE id = ?
  `).get(accountId) as any;

  if (!account) {
    return res.status(200).json({ task: null, reason: "account_not_found", message: "Account not found" });
  }

  // Safety limits today
  const connectsToday = (db.prepare(`
    SELECT COUNT(*) as c FROM logs 
    WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
      AND (message LIKE 'Connection request sent%' OR message LIKE '%connected%')
      AND date(created_at) = date('now')
  `).get(accountId) as { c: number })?.c || 0;

  const messagesToday = (db.prepare(`
    SELECT COUNT(*) as c FROM logs 
    WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
      AND message LIKE 'Message sent%'
      AND date(created_at) = date('now')
  `).get(accountId) as { c: number })?.c || 0;

  const maxConnects = account.daily_connect_limit || 20;
  const maxMessages = account.daily_message_limit || 20;

  // Candidate due track runs across active campaigns
  const candidates = db.prepare(`
    SELECT rt.id as track_id, rt.run_profile_id, rt.current_step, rt.state, rt.next_step_at, rt.force_run_once,
           rp.target_id, rp.run_id, r.workflow_id, r.account_id,
           t.full_name, t.first_name, t.last_name, t.company, t.title, t.location, t.linkedin_url, t.degree,
           t.connection_requested_at, t.connected_at, t.last_replied_at
    FROM run_profile_tracks rt
    JOIN run_profiles rp ON rp.id = rt.run_profile_id
    JOIN runs r ON r.id = rp.run_id
    JOIN targets t ON t.id = rp.target_id
    WHERE r.account_id = ?
      AND r.status = 'running'
      AND rt.track = 'linkedin'
      AND rt.state IN ('pending', 'in_progress')
      AND (
        rt.force_run_once = 1 
        OR rt.next_step_at IS NULL 
        OR rt.next_step_at <= datetime('now')
      )
    ORDER BY rt.force_run_once DESC, rt.next_step_at ASC
    LIMIT 10
  `).all(accountId) as any[];

  if (candidates.length === 0) {
    return res.json({
      task: null,
      stats: { connectsToday, maxConnects, messagesToday, maxMessages },
      reason: "queue_empty"
    });
  }

  for (const tr of candidates) {
    // Reply unenrollment check
    if (tr.last_replied_at) {
      db.prepare("UPDATE run_profile_tracks SET state = 'skipped', error_message = 'Lead replied' WHERE id = ?").run(tr.track_id);
      continue;
    }

    const steps = db.prepare(`
      SELECT * FROM workflow_steps 
      WHERE workflow_id = ? AND track = 'linkedin' 
      ORDER BY step_order ASC
    `).all(tr.workflow_id) as any[];

    if (!steps || steps.length === 0) continue;

    let stepIndex = tr.current_step;
    if (stepIndex >= steps.length) {
      db.prepare("UPDATE run_profile_tracks SET state = 'completed', last_step_at = datetime('now'), next_step_at = NULL WHERE id = ?").run(tr.track_id);
      continue;
    }

    let step = steps[stepIndex];

    // Auto-advance delay steps
    while (step && step.step_type === "delay") {
      stepIndex++;
      if (stepIndex >= steps.length) {
        db.prepare("UPDATE run_profile_tracks SET state = 'completed', current_step = ?, last_step_at = datetime('now'), next_step_at = NULL WHERE id = ?").run(stepIndex, tr.track_id);
        break;
      }
      const nextStep = steps[stepIndex];
      const nextAt = nextStep.delay_seconds > 0 ? new Date(Date.now() + nextStep.delay_seconds * 1000).toISOString() : null;
      db.prepare("UPDATE run_profile_tracks SET current_step = ?, last_step_at = datetime('now'), next_step_at = ? WHERE id = ?").run(stepIndex, nextAt, tr.track_id);
      db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, 'info', ?)").run(
        randomUUID(), tr.run_id, tr.target_id, `Delay step passed for ${tr.full_name || tr.linkedin_url}`
      );
      step = nextStep;
    }

    if (!step || stepIndex >= steps.length) continue;

    // Reset force_run_once
    if (tr.force_run_once === 1) {
      db.prepare("UPDATE run_profile_tracks SET force_run_once = 0 WHERE id = ?").run(tr.track_id);
    }

    const cleanUrl = tr.linkedin_url?.trim();
    if (!cleanUrl || !cleanUrl.includes("linkedin.com/")) {
      db.prepare("UPDATE run_profile_tracks SET state = 'failed', error_message = 'Invalid LinkedIn profile URL' WHERE id = ?").run(tr.track_id);
      continue;
    }

    // Step type: VISIT
    if (step.step_type === "visit") {
      return res.json({
        task: {
          id: tr.track_id,
          type: "visit",
          runId: tr.run_id,
          targetId: tr.target_id,
          workflowId: tr.workflow_id,
          stepIndex,
          targetUrl: cleanUrl,
          fullName: tr.full_name || "Lead",
        },
        stats: { connectsToday, maxConnects, messagesToday, maxMessages }
      });
    }

    // Step type: CONNECT
    if (step.step_type === "connect") {
      if (connectsToday >= maxConnects && tr.force_run_once !== 1) {
        continue;
      }

      if (tr.degree === 1) {
        // Already connected
        const nextIndex = stepIndex + 1;
        const nextStep = steps[nextIndex];
        const nextAt = nextStep?.delay_seconds > 0 ? new Date(Date.now() + nextStep.delay_seconds * 1000).toISOString() : null;
        db.prepare("UPDATE run_profile_tracks SET current_step = ?, last_step_at = datetime('now'), next_step_at = ? WHERE id = ?").run(nextIndex, nextAt, tr.track_id);
        db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, 'info', ?)").run(
          randomUUID(), tr.run_id, tr.target_id, `${tr.full_name || cleanUrl} already connected — skipping connect step`
        );
        continue;
      }

      let noteText = "";
      if (step.connect_note) {
        noteText = renderTemplate(step.connect_note, tr);
      } else if (step.template_id) {
        const tmpl = db.prepare("SELECT body FROM templates WHERE id = ?").get(step.template_id) as any;
        if (tmpl?.body) noteText = renderTemplate(tmpl.body, tr);
      }

      return res.json({
        task: {
          id: tr.track_id,
          type: "connect",
          runId: tr.run_id,
          targetId: tr.target_id,
          workflowId: tr.workflow_id,
          stepIndex,
          targetUrl: cleanUrl,
          fullName: tr.full_name || "Lead",
          note: noteText || undefined,
        },
        stats: { connectsToday, maxConnects, messagesToday, maxMessages }
      });
    }

    // Step type: MESSAGE
    if (step.step_type === "message") {
      if (messagesToday >= maxMessages && tr.force_run_once !== 1) {
        continue;
      }

      let messageText = "";
      if (step.message_body) {
        messageText = renderTemplate(step.message_body, tr);
      } else if (step.template_id) {
        const tmpl = db.prepare("SELECT body FROM templates WHERE id = ?").get(step.template_id) as any;
        if (tmpl?.body) messageText = renderTemplate(tmpl.body, tr);
      } else {
        messageText = `Hola ${tr.first_name || tr.full_name || ""}, un placer conectar contigo.`;
      }

      return res.json({
        task: {
          id: tr.track_id,
          type: "message",
          runId: tr.run_id,
          targetId: tr.target_id,
          workflowId: tr.workflow_id,
          stepIndex,
          targetUrl: cleanUrl,
          fullName: tr.full_name || "Lead",
          body: messageText,
        },
        stats: { connectsToday, maxConnects, messagesToday, maxMessages }
      });
    }
  }

  return res.json({
    task: null,
    stats: { connectsToday, maxConnects, messagesToday, maxMessages },
    reason: "no_executable_task"
  });
}
