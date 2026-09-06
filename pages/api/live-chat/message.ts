import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { sendLiveChatPushNotification } from "@/lib/live-chat/push";

function applyCors(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

const INHUBFLOW_KNOWLEDGE_SYSTEM_PROMPT = `
Eres "InHubFlow Concierge", el Asistente SDR oficial de InHubFlow B2B Suite en el sitio web inhubflow.online.
Tu objetivo es orientar a los visitantes, resolver dudas comerciales y técnicas frecuentes de forma concisa, educada y persuasiva, y pre-calificar al lead para el equipo humano.

CONOCIMIENTO OFICIAL DE INHUBFLOW:
1. ¿QUÉ ES INHUBFLOW?: Suite tecnológica empresarial SaaS para prospección comercial B2B multicanal (LinkedIn + Email), enriquecimiento con Google X-Ray y Asistente SDR con Inteligencia Artificial que pre-califica respuestas y agenda reuniones comerciales.
2. SEGURIDAD EN LINKEDIN: InHubFlow opera con algoritmos de cadencia humana y respeta estrictamente el límite seguro recomendado de 20 invitaciones diarias por cuenta (hasta 100/semana por cuenta). Con una cuenta de 10 slots se contactan 4,000 personas al mes de manera segura sin riesgo de penalizaciones.
3. PLANES Y PRECIOS:
   - Plan Starter: $49/mes (1 cuenta de LinkedIn, 20 inv/día, secuencias multicanal, CRM).
   - Plan Growth: $149/mes (5 cuentas de LinkedIn, Asistente SDR con IA, enriquecimiento de datos).
   - Plan Business: $249/mes (10 cuentas de LinkedIn / multi-asiento, 1,000 inv/semana, soporte prioritario, reportes ejecutivos).
   - Contratación anual: 20% de descuento.
4. FACTURACIÓN Y CANCELACIÓN: Pagos procesados con Lemon Squeezy by Stripe y PayPal. Autonomía total: el cliente puede cancelar su suscripción en cualquier momento desde su panel sin penalizaciones.
5. PROGRAMA DE PARTNERS: 50% de comisión recurrente mensual para agencias y consultores que recomienden InHubFlow, atribución de cookie de 60 días.

REGLAS DE COMPORTAMIENTO:
- Responde siempre en el idioma en que te hable el usuario (Español por defecto, Portugués o Inglés).
- Sé conciso y directo: respuestas de 2 a 4 frases, profesionales y cálidas. No sueltes muros de texto.
- DETECCIÓN DE ATENCIÓN HUMANA (HANDOFF):
  Si el visitante:
  a) Solicita hablar con una persona, asesor, el fundador (Roberto) o soporte.
  b) Pide un plan empresarial a medida (más de 10 cuentas o franquicia).
  c) Hace una pregunta técnica o de precios compleja que no esté en tu conocimiento.
  d) Ya está listo para comprar o contratar y quiere atención guiada.
  -> Responde cordialmente indicando que con mucho gusto lo conectas con Roberto de nuestro equipo, y pídele amablemente su nombre y empresa/correo si aún no los ha dado.
  -> Marca en el JSON que "needs_human" es true.

FORMATO DE SALIDA OBLIGATORIO:
Debes responder SIEMPRE un JSON válido con esta estructura exacta:
{
  "reply": "Tu mensaje para el visitante...",
  "needs_human": false o true,
  "lead_intent": "pricing" | "features" | "support" | "demo_request" | "partner" | "other",
  "extracted_name": "Nombre si lo detectaste o null",
  "extracted_email": "Email si lo detectaste o null",
  "extracted_company": "Empresa si la detectaste o null"
}
`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Método no permitido" });
  }

  const db = getDb();

  try {
    const {
      sessionId,
      message,
      visitorName,
      visitorEmail,
      visitorPhone,
      companyName,
      language = "es",
      pageUrl = "",
    } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "El mensaje es obligatorio" });
    }

    const cleanSessionId = sessionId && typeof sessionId === "string" && sessionId.trim()
      ? sessionId.trim()
      : randomUUID();

    // Verify or create session
    let session = db.prepare("SELECT * FROM live_chat_sessions WHERE id = ?").get(cleanSessionId) as any;

    if (!session) {
      db.prepare(`
        INSERT INTO live_chat_sessions (
          id, visitor_name, visitor_email, visitor_phone, company_name, language, 
          status, needs_human, human_notified, page_url, user_agent, 
          created_at, updated_at, last_visitor_message_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ai_active', 0, 0, ?, ?, datetime('now'), datetime('now'), datetime('now'))
      `).run(
        cleanSessionId,
        visitorName || null,
        visitorEmail || null,
        visitorPhone || null,
        companyName || null,
        language,
        pageUrl,
        req.headers["user-agent"] || null
      );
      session = db.prepare("SELECT * FROM live_chat_sessions WHERE id = ?").get(cleanSessionId);
    } else {
      // Update session activity and phone/name if provided
      db.prepare(`
        UPDATE live_chat_sessions 
        SET updated_at = datetime('now'), 
            last_visitor_message_at = datetime('now'),
            visitor_name = COALESCE(visitor_name, ?),
            visitor_phone = COALESCE(visitor_phone, ?)
        WHERE id = ?
      `).run(visitorName || null, visitorPhone || null, cleanSessionId);
    }

    // Save visitor message
    const visitorMessageId = randomUUID();
    db.prepare(`
      INSERT INTO live_chat_messages (id, session_id, sender_type, sender_name, message, created_at)
      VALUES (?, ?, 'visitor', ?, ?, datetime('now'))
    `).run(
      visitorMessageId,
      cleanSessionId,
      session.visitor_name || visitorName || "Visitante",
      message.trim()
    );

    // If human already took over this chat, do not run AI. Human will reply from PWA.
    if (session.status === "human_takeover") {
      // Notify admin that visitor sent another message while in takeover
      notifyAdminNewMessage(db, session, message.trim());
      return res.status(200).json({
        success: true,
        sessionId: cleanSessionId,
        status: "human_takeover",
        waitingForHuman: true,
      });
    }

    // Load recent history (last 10 messages)
    const historyRows = db.prepare(`
      SELECT sender_type, message FROM live_chat_messages 
      WHERE session_id = ? 
      ORDER BY created_at ASC LIMIT 12
    `).all(cleanSessionId) as Array<{ sender_type: string; message: string }>;

    const conversationContext = historyRows
      .map((r) => `${r.sender_type === "visitor" ? "Visitante" : "Asistente"}: ${r.message}`)
      .join("\n");

    // Call Gemini for intelligent response & qualification
    let aiParsed = {
      reply: "¡Hola! Gracias por contactarnos. ¿Tienes dudas sobre cómo InHubFlow automatiza tu prospección en LinkedIn o sobre nuestros planes?",
      needs_human: false,
      lead_intent: "other",
      extracted_name: null,
      extracted_email: null,
      extracted_company: null,
    };

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (apiKey) {
      try {
        const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.7-flash";
        const knowledgeRow = db.prepare("SELECT value FROM app_settings WHERE key = 'live_chat_ai_knowledge'").get() as { value?: string } | undefined;
        const activeSystemPrompt = knowledgeRow?.value?.trim() || INHUBFLOW_KNOWLEDGE_SYSTEM_PROMPT;

        const prompt = `
Historial de la conversación reciente:
${conversationContext}

Nuevo mensaje del visitante: "${message.trim()}"
`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: activeSystemPrompt },
                    { text: prompt },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.3,
              },
            }),
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText);
            if (parsed.reply) {
              aiParsed = parsed;
            }
          }
        }
      } catch (geminiErr) {
        console.warn("[Live Chat AI] Gemini error:", geminiErr);
      }
    }

    // Save AI response
    const aiMessageId = randomUUID();
    db.prepare(`
      INSERT INTO live_chat_messages (id, session_id, sender_type, sender_name, message, metadata_json, created_at)
      VALUES (?, ?, 'ai', 'Asistente InHubFlow', ?, ?, datetime('now'))
    `).run(
      aiMessageId,
      cleanSessionId,
      aiParsed.reply,
      JSON.stringify({ intent: aiParsed.lead_intent, needs_human: aiParsed.needs_human })
    );

    // If AI detected that customer needs human assistance, trigger handoff & notification
    if (aiParsed.needs_human) {
      db.prepare(`
        UPDATE live_chat_sessions 
        SET needs_human = 1, 
            visitor_name = COALESCE(visitor_name, ?),
            visitor_email = COALESCE(visitor_email, ?),
            company_name = COALESCE(company_name, ?),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        aiParsed.extracted_name || null,
        aiParsed.extracted_email || null,
        aiParsed.extracted_company || null,
        cleanSessionId
      );

      // Trigger Push / Email Alert to Roberto
      notifyAdminHandoff(db, cleanSessionId, aiParsed, message.trim());
    }

    return res.status(200).json({
      success: true,
      sessionId: cleanSessionId,
      reply: aiParsed.reply,
      needsHuman: Boolean(aiParsed.needs_human),
      status: "ai_active",
    });
  } catch (err: any) {
    console.error("[Live Chat Message API] Error:", err);
    return res.status(500).json({ error: "Error procesando mensaje", details: err?.message });
  }
}

// Push notification / Resend email dispatcher when human attention is required
async function notifyAdminHandoff(db: any, sessionId: string, aiParsed: any, latestMessage: string) {
  try {
    const session = db.prepare("SELECT * FROM live_chat_sessions WHERE id = ?").get(sessionId) as any;
    if (!session || session.human_notified) return;

    // Mark notified
    db.prepare("UPDATE live_chat_sessions SET human_notified = 1 WHERE id = ?").run(sessionId);

    const clientName = session.visitor_name || aiParsed.extracted_name || "Prospecto Web";
    const clientCompany = session.company_name || aiParsed.extracted_company || "";
    const clientEmail = session.visitor_email || aiParsed.extracted_email || "";
    const clientPhone = session.visitor_phone || "";
    const cleanPhone = clientPhone.replace(/[^0-9]/g, "");

    const title = `🔥 Lead Caliente en la Web: ${clientName}`;
    const body = `"${latestMessage}" — Toca para responder desde tu PWA InHubFlow`;
    const chatUrl = `https://b2b.inhubflow.online/live-chat?session=${sessionId}`;
    const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : null;

    // 1. Email notification via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const fromEmail = process.env.RESEND_FROM_EMAIL || "InHubFlow Live <info@inhubflow.online>";
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: fromEmail,
          to: ["inhubflow@gmail.com"],
          subject: `[LIVE CHAT] Lead Caliente: ${clientName} (${clientPhone || clientEmail || 'InHubFlow Web'})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
              <h2 style="color: #ef4444; margin-top: 0;">🔥 Prospecto Caliente en InHubFlow</h2>
              <p>Un visitante en el chat web de <strong>inhubflow.online</strong> requiere atención humana:</p>
              <p><strong>Cliente:</strong> ${clientName} ${clientCompany ? `(${clientCompany})` : ''}</p>
              ${clientPhone ? `<p><strong>WhatsApp:</strong> <a href="${waUrl}" style="color: #25D366; font-weight: bold;">${clientPhone} (Abrir WhatsApp)</a></p>` : ''}
              ${clientEmail ? `<p><strong>Email:</strong> ${clientEmail}</p>` : ''}
              <p><strong>Último mensaje:</strong></p>
              <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; font-style: italic;">
                "${latestMessage}"
              </div>
              <div style="margin-top: 24px; display: flex; gap: 12px;">
                <a href="${chatUrl}" style="background: #4f46e5; color: #fff; padding: 12px 22px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
                  Abrir Chat y Responder en Vivo
                </a>
                ${waUrl ? `
                <a href="${waUrl}" style="background: #25D366; color: #fff; padding: 12px 22px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block; margin-left: 10px;">
                  Chatear por WhatsApp
                </a>` : ''}
              </div>
            </div>
          `,
        }),
      }).catch((e) => console.warn("[Live Chat Alert] Resend error:", e));
    }

    // 2. Web Push Notification to mobile PWA (works even when app is closed / phone locked)
    sendLiveChatPushNotification(db, {
      title,
      body: `"${latestMessage}"`,
      sessionId,
    }).catch((err) => console.warn("[Live Chat Push Alert] Error:", err));
  } catch (err) {
    console.warn("[Live Chat Alert] Failed to dispatch alert:", err);
  }
}

async function notifyAdminNewMessage(db: any, session: any, latestMessage: string) {
  try {
    const clientName = session.visitor_name || "Prospecto Web";
    sendLiveChatPushNotification(db, {
      title: `💬 ${clientName}`,
      body: latestMessage,
      sessionId: session.id,
    }).catch((err) => console.warn("[Live Chat Push Message] Error:", err));
  } catch (err) {
    console.warn("[Live Chat Push] Error:", err);
  }
}
