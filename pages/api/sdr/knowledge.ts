import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "node:crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    try {
      const agent = db.prepare("SELECT id FROM sdr_agents ORDER BY created_at ASC LIMIT 1").get() as any;
      if (!agent) {
        return res.status(200).json({ sources: [] });
      }

      const sources = db.prepare("SELECT * FROM sdr_knowledge_sources WHERE agent_id = ? ORDER BY created_at DESC").all(agent.id) as any[];

      const parsedSources = sources.map((s) => {
        let meta = { content: "" };
        try {
          meta = JSON.parse(s.metadata_json);
        } catch {}
        return {
          ...s,
          content: meta.content || "",
        };
      });

      return res.status(200).json({ sources: parsedSources });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || "Error al obtener fuentes de conocimiento" });
    }
  }

  if (req.method === "POST") {
    try {
      const { title, source_type, content, status } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: "Título y contenido son obligatorios" });
      }

      const agent = db.prepare("SELECT id FROM sdr_agents ORDER BY created_at ASC LIMIT 1").get() as any;
      if (!agent) {
        return res.status(404).json({ error: "No se encontró el agente SDR" });
      }

      const id = randomUUID();
      const metadata = JSON.stringify({ content });

      db.prepare(`
        INSERT INTO sdr_knowledge_sources (
          id, agent_id, status, title, source_type, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        agent.id,
        status || "approved",
        title,
        source_type || "catalog",
        metadata
      );

      return res.status(201).json({ id, ok: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || "Error al crear fuente de conocimiento" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { id } = req.query;
      if (!id || typeof id !== "string") {
        return res.status(400).json({ error: "ID inválido" });
      }

      db.prepare("DELETE FROM sdr_knowledge_sources WHERE id = ?").run(id);
      return res.status(200).json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || "Error al eliminar fuente" });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res.status(405).json({ error: "Method not allowed" });
}
