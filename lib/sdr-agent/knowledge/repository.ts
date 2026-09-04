import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type KnowledgeSourceStatus = "draft" | "approved" | "retired";

export interface KnowledgeSourceRecord {
  id: string;
  agent_id: string;
  workspace_owner_id: string | null;
  status: KnowledgeSourceStatus;
  title: string;
  source_type: "text" | "file" | "url" | "catalog" | "policy";
  content: string | null;
  metadata_json: string;
  revision: number;
  checksum: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeSourceInput {
  agentId: string;
  workspaceOwnerId: string;
  title: string;
  sourceType: KnowledgeSourceRecord["source_type"];
  content: string;
}

function normalizedContent(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function readKnowledgeContent(source: Pick<KnowledgeSourceRecord, "content" | "metadata_json">): string {
  if (source.content?.trim()) return normalizedContent(source.content);
  try {
    const metadata = JSON.parse(source.metadata_json) as { content?: unknown };
    return typeof metadata.content === "string" ? normalizedContent(metadata.content) : "";
  } catch {
    return "";
  }
}

export function splitKnowledgeContent(content: string, maxLength = 1_200): string[] {
  const normalized = normalizedContent(content);
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      push();
      for (let offset = 0; offset < paragraph.length; offset += maxLength) {
        chunks.push(paragraph.slice(offset, offset + maxLength).trim());
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxLength) push();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  push();
  return chunks;
}

export function createKnowledgeDraft(
  db: Database.Database,
  input: CreateKnowledgeSourceInput,
): KnowledgeSourceRecord {
  const title = input.title.trim();
  const content = normalizedContent(input.content);
  if (!title || title.length > 300) throw new Error("Knowledge title must contain 1-300 characters");
  if (!content || content.length > 250_000) throw new Error("Knowledge content must contain 1-250000 characters");

  const id = randomUUID();
  db.prepare(`
    INSERT INTO sdr_knowledge_sources (
      id, agent_id, workspace_owner_id, status, title, source_type,
      content, checksum, metadata_json
    ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)
  `).run(
    id,
    input.agentId,
    input.workspaceOwnerId,
    title,
    input.sourceType,
    content,
    checksum(content),
    JSON.stringify({ content }),
  );
  return db.prepare("SELECT * FROM sdr_knowledge_sources WHERE id = ?").get(id) as KnowledgeSourceRecord;
}

export function approveKnowledgeSource(
  db: Database.Database,
  sourceId: string,
  workspaceOwnerId: string,
  approvedByUserId: string,
): KnowledgeSourceRecord {
  return db.transaction(() => {
    const source = db.prepare(`
      SELECT * FROM sdr_knowledge_sources
      WHERE id = ? AND workspace_owner_id = ?
    `).get(sourceId, workspaceOwnerId) as KnowledgeSourceRecord | undefined;
    if (!source) throw new Error("Knowledge source not found");
    if (source.status === "retired") throw new Error("Retired knowledge cannot be approved");
    const content = readKnowledgeContent(source);
    if (!content) throw new Error("Knowledge source has no content");
    const nextRevision = source.status === "approved" ? source.revision + 1 : source.revision;
    const sourceChecksum = checksum(content);
    const chunks = splitKnowledgeContent(content);
    if (chunks.length === 0) throw new Error("Knowledge source produced no searchable chunks");

    db.prepare(`
      UPDATE sdr_knowledge_sources
      SET status = 'approved', content = ?, checksum = ?, revision = ?,
        approved_by_user_id = ?, approved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND workspace_owner_id = ?
    `).run(content, sourceChecksum, nextRevision, approvedByUserId, sourceId, workspaceOwnerId);
    db.prepare("DELETE FROM sdr_knowledge_chunks WHERE source_id = ?").run(sourceId);
    const insert = db.prepare(`
      INSERT INTO sdr_knowledge_chunks (
        id, source_id, workspace_owner_id, revision, ordinal, content, checksum
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    chunks.forEach((chunk, ordinal) => {
      insert.run(
        randomUUID(),
        sourceId,
        workspaceOwnerId,
        nextRevision,
        ordinal,
        chunk,
        checksum(chunk),
      );
    });
    return db.prepare("SELECT * FROM sdr_knowledge_sources WHERE id = ?").get(sourceId) as KnowledgeSourceRecord;
  })();
}

export function retireKnowledgeSource(
  db: Database.Database,
  sourceId: string,
  workspaceOwnerId: string,
): boolean {
  return db.transaction(() => {
    const result = db.prepare(`
      UPDATE sdr_knowledge_sources
      SET status = 'retired', updated_at = datetime('now')
      WHERE id = ? AND workspace_owner_id = ? AND status != 'retired'
    `).run(sourceId, workspaceOwnerId);
    if (result.changes) db.prepare("DELETE FROM sdr_knowledge_chunks WHERE source_id = ?").run(sourceId);
    return result.changes === 1;
  })();
}

export function listKnowledgeSources(
  db: Database.Database,
  agentId: string,
  workspaceOwnerId: string,
): KnowledgeSourceRecord[] {
  return db.prepare(`
    SELECT * FROM sdr_knowledge_sources
    WHERE agent_id = ? AND workspace_owner_id = ?
    ORDER BY created_at DESC
  `).all(agentId, workspaceOwnerId) as KnowledgeSourceRecord[];
}
