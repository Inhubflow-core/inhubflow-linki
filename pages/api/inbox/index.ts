import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export interface InboxReply {
  id: string;
  full_name: string | null;
  linkedin_url: string | null;
  email: string | null;
  headline: string | null;
  company: string | null;
  channel: "email" | "linkedin" | "both";
  replied_at: string;
  email_replied_at: string | null;
  last_replied_at: string | null;
  // run context
  run_id: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  // LinkedIn slot context
  linkedin_account_id: string | null;
  linkedin_account_name: string | null;
  linkedin_account_email: string | null;
  linkedin_account_inferred: number;
  // email account context
  email_account_id: string | null;
  email_account_name: string | null;
  email_account_from: string | null;
  // classifier / dispatcher context (from the most recent email_replies row)
  reply_id: string | null;
  reply_kind: string | null;
  reply_summary: string | null;
  reply_body: string | null;
  classified_at: string | null;
  classification_error: string | null;
  dispatched_at: string | null;
  dispatch_result_json: string | null;
  manually_edited: number;
  // SDR Autopilot state
  sdr_autopilot: number;
  // Latest campaign-attributed LinkedIn inbound event (account-scoped).
  linkedin_thread_id: string | null;
  linkedin_message_id: string | null;
  linkedin_reply_body: string | null;
  linkedin_reply_received_at: string | null;
}

const VALID_CHANNELS = new Set(["email", "linkedin"]);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const rawChannel = Array.isArray(req.query.channel) ? req.query.channel[0] : req.query.channel;
  const channel = rawChannel && VALID_CHANNELS.has(rawChannel) ? rawChannel : undefined;
  const rawAccountId = Array.isArray(req.query.accountId) ? req.query.accountId[0] : req.query.accountId;
  const accountId = rawAccountId?.trim() || undefined;

  if (rawChannel && !channel) {
    return res.status(400).json({ error: "Invalid channel filter" });
  }
  if (accountId) {
    const account = db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId);
    if (!account) return res.status(400).json({ error: "Invalid LinkedIn account filter" });
  }

  // OOO-followup replies intentionally leave email_replied_at NULL, so the captured
  // email_replies row must also qualify a contact for the inbox. LinkedIn events
  // are already campaign-attributed before entering this table.
  let channelFilter =
    "AND (t.email_replied_at IS NOT NULL OR er.id IS NOT NULL OR lie.id IS NOT NULL OR t.last_replied_at IS NOT NULL)";
  if (channel === "email") channelFilter = "AND (t.email_replied_at IS NOT NULL OR er.id IS NOT NULL)";
  if (channel === "linkedin") channelFilter = "AND (lie.id IS NOT NULL OR t.last_replied_at IS NOT NULL)";

  const params: string[] = [];
  let accountFilter = "";
  if (accountId) {
    accountFilter = `
      AND (
        (lie.id IS NOT NULL AND lie.account_id = ?)
        OR
        ((t.email_replied_at IS NOT NULL OR er.id IS NOT NULL)
          AND COALESCE(context_run.account_id, lc.account_id) = ?)
      )`;
    params.push(accountId, accountId);
  }

  const linkedinAccountFilter = accountId ? "WHERE m.account_id = ?" : "";
  if (accountId) params.unshift(accountId);

  const rows = db.prepare(`
    WITH ranked_linkedin_events AS (
      SELECT
        m.*,
        ROW_NUMBER() OVER (
          PARTITION BY m.target_id${accountId ? ", m.account_id" : ""}
          ORDER BY datetime(m.sent_at) DESC, datetime(m.captured_at) DESC, m.id DESC
        ) AS row_num
      FROM linkedin_inbox_messages m
      ${linkedinAccountFilter}
    ),
    latest_linkedin_event AS (
      SELECT * FROM ranked_linkedin_events WHERE row_num = 1
    ),
    ranked_email_replies AS (
      SELECT
        er0.*,
        ROW_NUMBER() OVER (
          PARTITION BY er0.target_id
          ORDER BY datetime(er0.received_at) DESC, datetime(er0.created_at) DESC, er0.id DESC
        ) AS row_num
      FROM email_replies er0
    ),
    latest_email_reply AS (
      SELECT * FROM ranked_email_replies WHERE row_num = 1
    ),
    ranked_run_context AS (
      SELECT
        rp.target_id,
        rp.run_id,
        rp.email_account_id,
        r0.account_id,
        r0.workflow_id,
        ROW_NUMBER() OVER (
          PARTITION BY rp.target_id
          ORDER BY
            CASE r0.status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
            datetime(COALESCE(r0.started_at, r0.created_at)) DESC,
            datetime(rp.created_at) DESC,
            rp.id DESC
        ) AS row_num
      FROM run_profiles rp
      JOIN runs r0 ON r0.id = rp.run_id
      WHERE r0.status IN ('running', 'paused', 'completed')
    ),
    latest_context AS (
      SELECT * FROM ranked_run_context WHERE row_num = 1
    )
    SELECT
      t.id,
      t.full_name,
      t.linkedin_url,
      t.email,
      t.headline,
      t.company,
      t.email_replied_at,
      t.last_replied_at,
      CASE
        WHEN (t.email_replied_at IS NOT NULL OR er.id IS NOT NULL) AND (t.last_replied_at IS NOT NULL OR lie.id IS NOT NULL) THEN 'both'
        WHEN t.email_replied_at IS NOT NULL OR er.id IS NOT NULL THEN 'email'
        ELSE 'linkedin'
      END AS channel,
      MAX(
        COALESCE(t.email_replied_at, ''),
        COALESCE(t.last_replied_at, ''),
        COALESCE(er.received_at, ''),
        COALESCE(lie.sent_at, '')
      ) AS replied_at,
      COALESCE(er.run_id, lie.run_id, context_run.id) AS run_id,
      COALESCE(lie.workflow_id, context_run.workflow_id) AS workflow_id,
      COALESCE(w.name, linked_workflow.name) AS workflow_name,
      COALESCE(lie.account_id, linkedin_account.id) AS linkedin_account_id,
      COALESCE(lie_account.name, linkedin_account.name) AS linkedin_account_name,
      COALESCE(lie_account.email, linkedin_account.email) AS linkedin_account_email,
      CASE
        WHEN lie.id IS NOT NULL OR t.last_replied_account_id IS NOT NULL THEN 0
        WHEN linkedin_account.id IS NOT NULL THEN 1
        ELSE 0
      END AS linkedin_account_inferred,
      ea.id AS email_account_id,
      ea.name AS email_account_name,
      ea.from_email AS email_account_from,
      er.id AS reply_id,
      er.classification_json AS classification_json,
      er.body_text AS reply_body,
      er.classified_at,
      er.classification_error,
      er.dispatched_at,
      er.dispatch_result_json,
      COALESCE(er.manually_edited, 0) AS manually_edited,
      COALESCE(t.sdr_autopilot, 0) AS sdr_autopilot,
      lie.external_thread_id AS linkedin_thread_id,
      lie.external_message_id AS linkedin_message_id,
      lie.body AS linkedin_reply_body,
      lie.sent_at AS linkedin_reply_received_at
    FROM targets t
    LEFT JOIN latest_email_reply er ON er.target_id = t.id
    LEFT JOIN latest_linkedin_event lie ON lie.target_id = t.id
    LEFT JOIN latest_context lc ON lc.target_id = t.id
    LEFT JOIN run_profiles reply_rp
      ON reply_rp.target_id = t.id AND reply_rp.run_id = er.run_id
    LEFT JOIN runs context_run ON context_run.id = COALESCE(er.run_id, lie.run_id, lc.run_id)
    LEFT JOIN workflows w ON w.id = context_run.workflow_id
    LEFT JOIN workflows linked_workflow ON linked_workflow.id = lie.workflow_id
    LEFT JOIN email_accounts ea
      ON ea.id = COALESCE(reply_rp.email_account_id, context_run.email_account_id, lc.email_account_id)
    LEFT JOIN accounts lie_account ON lie_account.id = lie.account_id
    LEFT JOIN accounts linkedin_account
      ON linkedin_account.id = COALESCE(t.last_replied_account_id, lie.account_id, context_run.account_id, lc.account_id)
    WHERE 1=1
      ${channelFilter}
      ${accountFilter}
    ORDER BY replied_at DESC
  `).all(...params) as Array<InboxReply & { classification_json: string | null }>;

  const replies: InboxReply[] = rows.map((row) => {
    let reply_kind: string | null = null;
    let reply_summary: string | null = null;
    if (row.classification_json) {
      try {
        const cls = JSON.parse(row.classification_json) as { kind?: string; summary?: string };
        reply_kind = cls.kind ?? null;
        reply_summary = cls.summary ?? null;
      } catch { /* malformed — leave null */ }
    }
    const { classification_json: _omit, ...rest } = row;
    void _omit;
    return { ...rest, reply_kind, reply_summary };
  });

  return res.json({ replies });
}
