import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = getDb();
  const body = req.body || {};
  const { taskId, status, targetId, runId, workflowId, stepIndex, type, connectionStatus, error } = body;

  if (!taskId || !targetId) {
    return res.status(400).json({ error: "Missing taskId or targetId" });
  }

  const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(targetId) as any;
  const name = target?.full_name || target?.linkedin_url || "Lead";

  const steps = workflowId ? (db.prepare(`
    SELECT * FROM workflow_steps 
    WHERE workflow_id = ? AND track = 'linkedin' 
    ORDER BY step_order ASC
  `).all(workflowId) as any[]) : [];

  if (status === "completed") {
    if (type === "visit") {
      db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, 'info', ?)").run(
        randomUUID(), runId, targetId, `Visited ${name}`
      );
    } else if (type === "connect") {
      if (connectionStatus === "already_connected") {
        db.prepare("UPDATE targets SET degree = 1, connected_at = COALESCE(connected_at, datetime('now')) WHERE id = ?").run(targetId);
        db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, 'info', ?)").run(
          randomUUID(), runId, targetId, `${name} already connected — skipping connect step`
        );
      } else {
        db.prepare("UPDATE targets SET connection_requested_at = datetime('now') WHERE id = ?").run(targetId);
        try {
          const runRow = runId ? (db.prepare("SELECT account_id FROM runs WHERE id = ?").get(runId) as { account_id: string } | undefined) : undefined;
          if (runRow?.account_id) {
            db.prepare(`
              INSERT INTO linkedin_connection_attempts (id, account_id, run_id, target_id, outcome, attempted_at)
              VALUES (?, ?, ?, ?, 'submitted', datetime('now'))
            `).run(randomUUID(), runRow.account_id, runId, targetId);
          }
        } catch { /* non-blocking */ }
        db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, 'info', ?)").run(
          randomUUID(), runId, targetId, `Connection request sent for ${name}`
        );
      }
    } else if (type === "message") {
      db.prepare("UPDATE targets SET message_sent_at = datetime('now') WHERE id = ?").run(targetId);
      db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, 'info', ?)").run(
        randomUUID(), runId, targetId, `Message sent to ${name}`
      );
    }

    // Advance track
    const currentStepNum = typeof stepIndex === "number" ? stepIndex : 0;
    const nextIndex = currentStepNum + 1;

    if (steps.length > 0 && nextIndex < steps.length) {
      const nextStep = steps[nextIndex];
      const nextAt = nextStep?.delay_seconds > 0 ? new Date(Date.now() + nextStep.delay_seconds * 1000).toISOString() : null;
      db.prepare(`
        UPDATE run_profile_tracks 
        SET current_step = ?, 
            last_step_at = datetime('now'), 
            next_step_at = ?,
            state = 'in_progress',
            error_message = NULL
        WHERE id = ?
      `).run(nextIndex, nextAt, taskId);
    } else {
      db.prepare(`
        UPDATE run_profile_tracks 
        SET state = 'completed', 
            current_step = ?, 
            last_step_at = datetime('now'), 
            next_step_at = NULL,
            error_message = NULL
        WHERE id = ?
      `).run(nextIndex, taskId);
    }

    return res.json({ ok: true, message: "Step completed and advanced" });
  }

  if (status === "failed") {
    const errorMsg = error || "Error desconocido al ejecutar acción";
    db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, 'warn', ?)").run(
      randomUUID(), runId, targetId, `Error en paso ${type} para ${name}: ${errorMsg}`
    );
    // Reschedule in 30 minutes for retry without failing immediately
    db.prepare(`
      UPDATE run_profile_tracks 
      SET error_message = ?, 
          next_step_at = datetime('now', '+30 minutes')
      WHERE id = ?
    `).run(errorMsg, taskId);

    return res.json({ ok: true, message: "Failure recorded and step rescheduled" });
  }

  return res.json({ ok: true });
}
