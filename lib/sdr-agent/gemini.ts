import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { z } from "zod";

export const SdrIntentSchema = z.enum([
  "interested",
  "product_question",
  "pricing_question",
  "objection",
  "meeting_request",
  "not_interested",
  "unsubscribe",
  "human_requested",
  "referral",
  "ooo",
  "ambiguous",
  "hostile_or_legal",
]);
export type SdrIntent = z.infer<typeof SdrIntentSchema>;

export const SdrActionTypeSchema = z.enum([
  "answer",
  "ask_clarification",
  "offer_slots",
  "stop_outreach",
  "handoff",
  "no_action",
]);
export type SdrActionType = z.infer<typeof SdrActionTypeSchema>;

export const SdrDecisionOutputSchema = z.object({
  intent: SdrIntentSchema,
  confidence: z.number().min(0).max(1),
  risk_level: z.enum(["low", "medium", "high"]),
  language: z.enum(["es", "en", "pt-BR"]),
  reasoning_summary: z.string(),
  recommended_action: SdrActionTypeSchema,
  requires_human: z.boolean(),
  reason_code: z.string().nullable().optional(),
  reply_draft: z.string().nullable().optional(),
  knowledge_citations: z.array(z.string()).optional(),
});
export type SdrDecisionOutput = z.infer<typeof SdrDecisionOutputSchema>;

export interface SdrClassificationInput {
  inboundMessage: string;
  senderName?: string | null;
  conversationHistory?: Array<{ direction: "inbound" | "outbound" | "system"; body: string; sentAt?: string }>;
  companyContext?: string;
  productCatalog?: string;
  customInstructions?: string;
}

const DEFAULT_COMPANY_CONTEXT = `
InHubFlow es una suite empresarial de prospección comercial y atención omnicanal B2B y B2C.
Servicios B2B principales:
- Automatización de prospección en LinkedIn (visitas, solicitudes de conexión con notas personalizadas, secuencias inteligentes de mensajes y seguimiento).
- Cold Email secuenciado de alta entregabilidad con rotación multicuenta y warm-up.
- Integración con Apollo.io y LinkedIn Sales Navigator para extracción y enriquecimiento de leads.
- Agente SDR con Inteligencia Artificial que califica prospectos, responde dudas y agenda reuniones comerciales.

Tono y Estilo:
- Profesional, cálido, conciso y orientado a generar valor y curiosidad.
- No sonar a spam ni a robot; respuestas directas y breves (máximo 2 a 3 párrafos cortos).
- Si el prospecto tiene interés, proponer agendar una breve llamada de 15 minutos para mostrar una demo o ver si encaja con su negocio.
- Si el prospecto pide hablar con una persona, solicita precios especiales no autorizados o plantea temas legales/amenazas, marcar requires_human = true y recommended_action = "handoff" o "stop_outreach".
`;

const RESPONSE_JSON_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: [
        "interested",
        "product_question",
        "pricing_question",
        "objection",
        "meeting_request",
        "not_interested",
        "unsubscribe",
        "human_requested",
        "referral",
        "ooo",
        "ambiguous",
        "hostile_or_legal",
      ],
      description: "Clasificación de la intención comercial del mensaje entrante",
    },
    confidence: {
      type: Type.NUMBER,
      description: "Nivel de confianza en la clasificación entre 0.0 y 1.0",
    },
    risk_level: {
      type: Type.STRING,
      enum: ["low", "medium", "high"],
      description: "Nivel de riesgo de la interacción",
    },
    language: {
      type: Type.STRING,
      enum: ["es", "en", "pt-BR"],
      description: "Idioma detectado del mensaje",
    },
    reasoning_summary: {
      type: Type.STRING,
      description: "Explicación breve y concisa de por qué se eligió esta clasificación y respuesta",
    },
    recommended_action: {
      type: Type.STRING,
      enum: [
        "answer",
        "ask_clarification",
        "offer_slots",
        "stop_outreach",
        "handoff",
        "no_action",
      ],
      description: "Acción recomendada para el pipeline",
    },
    requires_human: {
      type: Type.BOOLEAN,
      description: "True si se requiere la intervención o supervisión de un humano antes de responder",
    },
    reason_code: {
      type: Type.STRING,
      description: "Código de motivo si requiere humano o stop_outreach (ej: human_explicit_request, legal_risk, unapproved_pricing, low_confidence)",
    },
    reply_draft: {
      type: Type.STRING,
      description: "Borrador de respuesta sugerido para el prospecto en el mismo idioma del mensaje, redactado de forma natural y profesional. Debe incluirse para 'answer', 'ask_clarification' u 'offer_slots'. Dejar null únicamente si la acción es stop_outreach, handoff o no_action.",
    },
    knowledge_citations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Puntos clave de conocimiento utilizados",
    },
  },
  required: [
    "intent",
    "confidence",
    "risk_level",
    "language",
    "reasoning_summary",
    "recommended_action",
    "requires_human",
  ],
};

export class GeminiSdrProvider {
  private client: GoogleGenAI;
  private modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY no está configurada en las variables de entorno ni fue provista.");
    }
    this.client = new GoogleGenAI({ apiKey: key });
    this.modelName = modelName || process.env.GEMINI_MODEL || "gemini-3.6-flash";
  }

  async classifyAndDraft(input: SdrClassificationInput): Promise<SdrDecisionOutput> {
    const companyContext = input.companyContext || DEFAULT_COMPANY_CONTEXT;
    const historyText = (input.conversationHistory || [])
      .map((m) => `[${m.direction.toUpperCase()}]: ${m.body}`)
      .join("\n");

    const prompt = `
Eres un Agente SDR de Inteligencia Artificial para InHubFlow, experto en prospección y ventas B2B en LinkedIn.
Tu objetivo es analizar el mensaje entrante del prospecto, clasificar su intención, evaluar riesgos y sugerir un borrador de respuesta natural, empático y persuasivo.

=== INFORMACIÓN DE LA EMPRESA Y PRODUCTO ===
${companyContext}

${input.customInstructions ? `=== INSTRUCCIONES ESPECÍFICAS ===\n${input.customInstructions}\n` : ""}

=== HISTORIAL PREVIO DE LA CONVERSACIÓN ===
${historyText || "(Sin historial previo registrado)"}

=== MENSAJE ENTRANTE RECIENTE ===
Remitente: ${input.senderName || "Prospecto"}
Mensaje: """${input.inboundMessage}"""

=== REGLAS OBLIGATORIAS ===
1. Responde en el MISMO idioma del prospecto (español, inglés o portugués de Brasil).
2. Si el mensaje es una objeción ("ahora no tengo tiempo", "ya usamos otra herramienta"), responde con empatía y muestra cómo InHubFlow se complementa o ahorra horas de trabajo manual.
3. Si el mensaje es de interés o pide una reunión/demo, responde con entusiasmo, ofrece disponibilidad para una llamada rápida de 15 minutos y genera siempre el borrador en reply_draft.
4. Si el mensaje pide no ser contactado (unsubscribe / baja), no insistas: clasifícalo como "unsubscribe", recommended_action = "stop_outreach", requires_human = false, reply_draft = null.
5. Si el mensaje contiene amenazas legales, insultos o pide hablar con el dueño/humano explícitamente, requires_human = true.
6. Nunca inventes precios específicos que no estén en la información de la empresa.

Genera la respuesta estrictamente en el formato estructurado JSON solicitado.
`;

    const maxRetries = 3;
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        attempt++;
        const response = await this.client.models.generateContent({
          model: this.modelName,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_JSON_SCHEMA,
            temperature: 0.3,
          },
        });

        const responseText = response.text;
        if (!responseText) {
          throw new Error("Gemini no devolvió texto en la respuesta.");
        }

        const parsedJson = JSON.parse(responseText);
        const validated = SdrDecisionOutputSchema.parse(parsedJson);
        return validated;
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          throw new Error(`Error validando el esquema de decisión de Gemini: ${error.issues.map(i => `${i.path}: ${i.message}`).join(", ")}`);
        }
        const errObj = error as { status?: number; message?: string };
        const isTransient =
          errObj?.status === 503 ||
          errObj?.status === 429 ||
          String(errObj?.message).includes("high demand") ||
          String(errObj?.message).includes("RESOURCE_EXHAUSTED") ||
          String(errObj?.message).includes("UNAVAILABLE");

        if (isTransient && attempt < maxRetries) {
          const delayMs = attempt * 2500;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw error;
      }
    }
    throw new Error("Reintentos agotados al consultar Gemini.");
  }
}
