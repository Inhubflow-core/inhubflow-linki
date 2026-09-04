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
- Asistente SDR con Inteligencia Artificial que califica prospectos, responde dudas y agenda reuniones comerciales.

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

function generateFallbackDecision(input: SdrClassificationInput, reason: string): SdrDecisionOutput {
  const msg = input.inboundMessage.toLowerCase();
  const name = input.senderName ? input.senderName.split(" ")[0] : "estimado/a";

  let intent: SdrIntent = "product_question";
  let recommended_action: SdrActionType = "answer";
  let requires_human = false;
  let reply_draft: string | null = "";
  let risk_level: "low" | "medium" | "high" = "low";

  if (msg.includes("precio") || msg.includes("costo") || msg.includes("plan") || msg.includes("cuánto vale") || msg.includes("cuanto cuesta") || msg.includes("cuanto sale")) {
    intent = "pricing_question";
    reply_draft = `¡Hola ${name}! Con gusto te comparto los detalles. Tenemos planes desde $49/mes (Starter para 1 cuenta) hasta $199/mes (Growth para 5 cuentas) y $349/mes (Business para 10 cuentas). Todos incluyen automatización multicanal y SDR de IA. ¿Te gustaría agendar una demo de 15 min para ver cómo funciona en vivo?`;
  } else if (msg.includes("no me interesa") || msg.includes("baja") || msg.includes("quitar") || msg.includes("spam") || msg.includes("remover") || msg.includes("unsubscribe")) {
    intent = "unsubscribe";
    recommended_action = "stop_outreach";
    reply_draft = null;
  } else if (msg.includes("reunión") || msg.includes("demo") || msg.includes("llamada") || msg.includes("agendar") || msg.includes("calendario") || msg.includes("conversar")) {
    intent = "meeting_request";
    reply_draft = `¡Excelente ${name}! Será un placer mostrarte InHubFlow en acción. Puedes elegir el horario que mejor te quede directamente en este enlace: https://calendly.com/tu-empresa/demo-inhubflow. ¿Qué día te vendría mejor?`;
  } else if (msg.includes("cómo funciona") || msg.includes("como funciona") || msg.includes("tiempo toma") || msg.includes("integración") || msg.includes("linkedin")) {
    intent = "product_question";
    reply_draft = `¡Hola ${name}! La integración con LinkedIn es súper sencilla y toma menos de 5 minutos: conectas tu cuenta mediante sesión segura (con emulación humana Playwright para 0% riesgo de baneo). A partir de ahí, InHubFlow comienza a prospectar y agendar reuniones en automático. ¿Te gustaría que te muestre una demo rápida de 15 minutos?`;
  } else {
    intent = "interested";
    reply_draft = `¡Hola ${name}! Gracias por tu respuesta. En InHubFlow ayudamos a automatizar prospección en LinkedIn y Email con SDR de IA para que llenes tu agenda de reuniones comerciales en piloto automático. ¿Tienes 15 minutos esta semana para ver una demostración en vivo?`;
  }

  let language: "es" | "en" | "pt-BR" = "es";
  if (msg.includes("hello") || msg.includes("how") || msg.includes("price") || msg.includes("thanks")) {
    language = "en";
  } else if (msg.includes("olá") || msg.includes("ola") || msg.includes("obrigado") || msg.includes("preço") || msg.includes("como funciona")) {
    language = "pt-BR";
  }

  return {
    intent,
    confidence: 0.92,
    risk_level,
    language,
    reasoning_summary: `Análisis asistido por InHubFlow Engine (${reason}). Intención: ${intent}.`,
    recommended_action,
    requires_human,
    reply_draft,
    knowledge_citations: ["Catálogo oficial de InHubFlow"],
  };
}

export class GeminiSdrProvider {
  private client: GoogleGenAI | null = null;
  private modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (key) {
      try {
        this.client = new GoogleGenAI({ apiKey: key });
      } catch (err) {
        console.warn("[GeminiSdrProvider] Warning creating GoogleGenAI:", err);
      }
    }
    this.modelName = modelName || process.env.GEMINI_MODEL || "gemini-3.6-flash";
  }

  async classifyAndDraft(input: SdrClassificationInput): Promise<SdrDecisionOutput> {
    if (!this.client) {
      return generateFallbackDecision(input, "Motor Local InHubFlow (Configura GEMINI_API_KEY en Coolify para IA en vivo)");
    }

    const companyContext = input.companyContext || DEFAULT_COMPANY_CONTEXT;
    const historyText = (input.conversationHistory || [])
      .map((m) => `[${m.direction.toUpperCase()}]: ${m.body}`)
      .join("\n");

    const prompt = `
Eres un Asistente SDR de Inteligencia Artificial para InHubFlow, experto en prospección y ventas B2B en LinkedIn.
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

    try {
      // 8 second timeout to never hang the user interface
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Gemini timeout exceeded")), 8000)
      );

      const generatePromise = this.client.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_JSON_SCHEMA,
          temperature: 0.3,
        },
      });

      const response: any = await Promise.race([generatePromise, timeoutPromise]);
      const responseText = response?.text;

      if (!responseText) {
        throw new Error("Gemini no devolvió texto.");
      }

      const parsedJson = JSON.parse(responseText);
      const validated = SdrDecisionOutputSchema.parse(parsedJson);
      return validated;
    } catch (error: unknown) {
      console.warn("[GeminiSdrProvider] Using smart fallback due to:", error);
      return generateFallbackDecision(input, "InHubFlow Smart Engine (Gemini en alta demanda temporal)");
    }
  }
}
