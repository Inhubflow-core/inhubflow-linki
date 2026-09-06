import Database from "better-sqlite3";

/**
 * Automatically deletes live chat sessions and their messages after 5 minutes of inactivity.
 * A session is considered inactive if updated_at is older than 5 minutes.
 */
export function cleanupInactiveLiveChats(db: Database.Database): number {
  try {
    // 1. Delete all messages associated with inactive sessions (> 5 minutes without activity)
    db.prepare(`
      DELETE FROM live_chat_messages 
      WHERE session_id IN (
        SELECT id FROM live_chat_sessions 
        WHERE updated_at < datetime('now', '-5 minutes')
      )
    `).run();

    // 2. Delete inactive sessions
    const res = db.prepare(`
      DELETE FROM live_chat_sessions 
      WHERE updated_at < datetime('now', '-5 minutes')
    `).run();

    // 3. Clean up any orphaned messages that may have lost their session
    db.prepare(`
      DELETE FROM live_chat_messages 
      WHERE session_id NOT IN (SELECT id FROM live_chat_sessions)
    `).run();

    return res.changes;
  } catch (err) {
    console.warn("[Live Chat Auto-Cleanup] Error cleaning inactive chats:", err);
    return 0;
  }
}
