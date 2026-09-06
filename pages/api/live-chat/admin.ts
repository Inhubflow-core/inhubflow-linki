import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const userEmail = session.user.email?.trim().toLowerCase() || "";
  let userRole = (session.user as { role?: string })?.role || "user";
  if (userEmail === "inhubflow@gmail.com") userRole = "admin";

  const db = getDb();
  if (userRole !== "admin") {
    try {
      const u = db.prepare("SELECT role FROM users WHERE email = ?").get(userEmail) as { role?: string } | undefined;
      if (u?.role === "admin") userRole = "admin";
    } catch {}
  }

  if (userRole !== "admin") {
    return res.status(403).json({ error: "Acceso denegado" });
  }

  if (req.method === "GET") {
    try {
      const { sessionId } = req.query;

      if (sessionId && typeof sessionId === "string") {
        const chatSession = db.prepare("SELECT * FROM live_chat_sessions WHERE id = ?").get(sessionId) as any;
        if (!chatSession) {
          return res.status(404).json({ error: "Sesión no encontrada" });
        }

        const messages = db.prepare(`
          SELECT * FROM live_chat_messages WHERE session_id = ? ORDER BY created_at ASC
        `).all(sessionId);

        return res.status(200).json({ session: chatSession, messages });
      }

      // List all sessions
      const sessions = db.prepare(`
        SELECT 
          s.*,
          (SELECT COUNT(*) FROM live_chat_messages m WHERE m.session_id = s.id) as total_messages,
          (SELECT m.message FROM live_chat_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
          (SELECT m.sender_type FROM live_chat_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_sender_type,
          (SELECT m.created_at FROM live_chat_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at
        FROM live_chat_sessions s
        ORDER BY s.needs_human DESC, s.updated_at DESC
        LIMIT 50
      `).all();

      const counts = {
        total: sessions.length,
        needs_human: sessions.filter((s: any) => s.needs_human === 1).length,
        active: sessions.filter((s: any) => s.status === "ai_active" || s.status === "human_takeover").length,
      };

      return res.status(200).json({ sessions, counts });
    } catch (err: any) {
      console.error("[Live Chat Admin API] GET error:", err);
      return res.status(500).json({ error: "Error al cargar chats" });
    }
  }

  if (req.method === "POST") {
    try {
      const { action, sessionId, message } = req.body;

      if (!sessionId || typeof sessionId !== "string") {
        return res.status(400).json({ error: "sessionId es obligatorio" });
      }

      const chatSession = db.prepare("SELECT * FROM live_chat_sessions WHERE id = ?").get(sessionId) as any;
      if (!chatSession) {
        return res.status(404).json({ error: "Sesión no encontrada" });
      }

      if (action === "takeover") {
        db.prepare(`
          UPDATE live_chat_sessions 
          SET status = 'human_takeover', needs_human = 0, updated_at = datetime('now')
          WHERE id = ?
        `).run(sessionId);

        return res.status(200).json({ success: true, status: "human_takeover" });
      }

      if (action === "resume_ai") {
        db.prepare(`
          UPDATE live_chat_sessions 
          SET status = 'ai_active', updated_at = datetime('now')
          WHERE id = ?
        `).run(sessionId);

        return res.status(200).json({ success: true, status: "ai_active" });
      }

      if (action === "resolve" || action === "close") {
        const newStatus = action === "resolve" ? "resolved" : "closed";
        db.prepare(`
          UPDATE live_chat_sessions 
          SET status = ?, needs_human = 0, updated_at = datetime('now')
          WHERE id = ?
        `).run(newStatus, sessionId);

        return res.status(200).json({ success: true, status: newStatus });
      }

      if (action === "reply") {
        if (!message || typeof message !== "string" || !message.trim()) {
          return res.status(400).json({ error: "El mensaje no puede estar vacío" });
        }

        const messageId = randomUUID();
        const senderName = "Roberto (InHubFlow)";

        const replyTx = db.transaction(() => {
          db.prepare(`
            INSERT INTO live_chat_messages (id, session_id, sender_type, sender_name, message, created_at)
            VALUES (?, ?, 'human_agent', ?, ?, datetime('now'))
          `).run(messageId, sessionId, senderName, message.trim());

          // Automatically set status to human_takeover so AI doesn't interfere
          db.prepare(`
            UPDATE live_chat_sessions 
            SET status = 'human_takeover', needs_human = 0, updated_at = datetime('now')
            WHERE id = ?
          `).run(sessionId);
        });

        replyTx();

        return res.status(201).json({
          success: true,
          message: {
            id: messageId,
            session_id: sessionId,
            sender_type: "human_agent",
            sender_name: senderName,
            message: message.trim(),
            created_at: new Date().toISOString(),
          },
        });
      }

      return res.status(400).json({ error: "Acción no válida" });
    } catch (err: any) {
      console.error("[Live Chat Admin API] POST error:", err);
      return res.status(500).json({ error: "Error al procesar acción" });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: "Método no permitido" });
}
