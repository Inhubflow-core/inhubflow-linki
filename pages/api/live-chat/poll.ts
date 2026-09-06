import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { cleanupInactiveLiveChats } from "@/lib/live-chat/cleanup";

function applyCors(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (applyCors(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { sessionId, visitorTyping } = req.query;
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId es obligatorio" });
  }

  const db = getDb();
  // Auto-prune inactive chats older than 5 minutes
  cleanupInactiveLiveChats(db);

  try {
    if (visitorTyping === "1" || visitorTyping === "true") {
      db.prepare(`
        UPDATE live_chat_sessions 
        SET visitor_typing_until = datetime('now', '+4 seconds'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(sessionId);
    }

    const session = db.prepare("SELECT * FROM live_chat_sessions WHERE id = ?").get(sessionId) as any;
    if (!session) {
      return res.status(200).json({ session: null, messages: [], status: "expired", expired: true });
    }

    const isOperatorTyping = db.prepare(`
      SELECT 1 FROM live_chat_sessions 
      WHERE id = ? AND operator_typing_until IS NOT NULL AND operator_typing_until > datetime('now')
    `).get(sessionId);

    const messages = db.prepare(`
      SELECT id, session_id, sender_type, sender_name, message, created_at 
      FROM live_chat_messages 
      WHERE session_id = ? 
      ORDER BY created_at ASC
    `).all(sessionId);

    return res.status(200).json({
      session: {
        id: session.id,
        status: session.status,
        needs_human: Boolean(session.needs_human),
        visitor_name: session.visitor_name,
        operator_typing: Boolean(isOperatorTyping),
      },
      messages,
    });
  } catch (err: any) {
    console.error("[Live Chat Poll API] Error:", err);
    return res.status(500).json({ error: "Error al obtener mensajes" });
  }
}
