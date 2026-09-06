import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

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

  const { sessionId } = req.query;
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId es obligatorio" });
  }

  const db = getDb();
  try {
    const session = db.prepare("SELECT * FROM live_chat_sessions WHERE id = ?").get(sessionId) as any;
    if (!session) {
      return res.status(200).json({ messages: [], status: "not_found" });
    }

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
      },
      messages,
    });
  } catch (err: any) {
    console.error("[Live Chat Poll API] Error:", err);
    return res.status(500).json({ error: "Error al obtener mensajes" });
  }
}
