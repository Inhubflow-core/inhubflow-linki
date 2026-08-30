import Head from "next/head";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  RiRobotLine,
  RiSettings4Line,
  RiBookOpenLine,
  RiChatCheckLine,
  RiHistoryLine,
  RiShieldCheckLine,
  RiAlertLine,
  RiSendPlaneLine,
  RiSaveLine,
  RiAddLine,
  RiDeleteBinLine,
  RiRefreshLine,
  RiSparklingLine,
  RiCheckLine,
  RiTimeLine,
  RiUserVoiceLine,
  RiCalendarCheckLine,
  RiLockLine,
} from "react-icons/ri";
import { useTranslation } from "@/lib/i18n/LanguageContext";

type Tab = "overview" | "prompts" | "knowledge" | "simulator" | "history";

interface KnowledgeSource {
  id: string;
  title: string;
  source_type: string;
  status: string;
  content: string;
  created_at: string;
}

interface SdrConfigData {
  agent: {
    id: string;
    name: string;
    status: string;
    mode: "off" | "shadow" | "approval" | "auto";
    default_language: string;
    model: string;
    confidence_threshold: number;
    max_auto_turns: number;
    handoff_email: string | null;
  };
  activeVersion: {
    id: string;
    version_number: number;
    model: string;
    system_prompt: string;
    policy: {
      company_context?: string;
      handoff_rules?: string;
    };
    config: {
      custom_instructions?: string;
    };
  };
  stats: {
    totalDecisions: number;
    totalHandoffs: number;
    totalThreads: number;
    activeThreads: number;
  };
  recentDecisions: Array<{
    id: string;
    intent: string;
    confidence: number;
    risk_level: string;
    language: string;
    recommended_action: string;
    requires_human: number;
    reason_code: string | null;
    reply_draft: string | null;
    model: string;
    latency_ms: number;
    created_at: string;
    target_name?: string;
    target_company?: string;
  }>;
}

export default function SdrPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<SdrConfigData | null>(null);

  // Form State
  const [agentName, setAgentName] = useState("");
  const [mode, setMode] = useState<"off" | "shadow" | "approval" | "auto">("shadow");
  const [model, setModel] = useState("gemini-3.6-flash");
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.85);
  const [maxAutoTurns, setMaxAutoTurns] = useState(3);
  const [handoffEmail, setHandoffEmail] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [handoffRules, setHandoffRules] = useState("");

  // Knowledge Sources State
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [newSourceTitle, setNewSourceTitle] = useState("");
  const [newSourceContent, setNewSourceContent] = useState("");
  const [newSourceType, setNewSourceType] = useState("catalog");
  const [addingSource, setAddingSource] = useState(false);

  // Simulator State
  const [simMessage, setSimMessage] = useState(
    "Hola Roberto, vi tu mensaje sobre la automatización de prospección B2B. ¿Cómo funciona la integración con LinkedIn y cuánto tiempo toma configurarlo?"
  );
  const [simSenderName, setSimSenderName] = useState("Carlos Mendoza");
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState<any | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/sdr/config");
      if (!res.ok) throw new Error("Error al cargar la configuración");
      const json: SdrConfigData = await res.json();
      setData(json);

      // Populate Form State
      setAgentName(json.agent.name || "Agente SDR InHubFlow");
      setMode(json.agent.mode || "shadow");
      setModel(json.agent.model || "gemini-3.6-flash");
      setConfidenceThreshold(json.agent.confidence_threshold || 0.85);
      setMaxAutoTurns(json.agent.max_auto_turns || 3);
      setHandoffEmail(json.agent.handoff_email || "");
      setSystemPrompt(json.activeVersion?.system_prompt || "");
      setCompanyContext(json.activeVersion?.policy?.company_context || "");
      setHandoffRules(json.activeVersion?.policy?.handoff_rules || "");
      setCustomInstructions(json.activeVersion?.config?.custom_instructions || "");
    } catch (err: any) {
      toast.error(err.message || "Error al conectar con el servidor SDR");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKnowledge = useCallback(async () => {
    try {
      const res = await fetch("/api/sdr/knowledge");
      if (res.ok) {
        const json = await res.json();
        setKnowledgeSources(json.sources || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadConfig();
    loadKnowledge();
  }, [loadConfig, loadKnowledge]);

  const handleSaveConfig = async () => {
    try {
      setSaving(true);
      const res = await fetch("/api/sdr/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentName,
          mode,
          model,
          confidence_threshold: confidenceThreshold,
          max_auto_turns: maxAutoTurns,
          handoff_email: handoffEmail,
          system_prompt: systemPrompt,
          company_context: companyContext,
          custom_instructions: customInstructions,
          handoff_rules: handoffRules,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error al guardar");
      }

      toast.success("Configuración del Agente SDR guardada correctamente");
      loadConfig();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar cambios");
    } finally {
      setSaving(false);
    }
  };

  const handleAddKnowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceTitle.trim() || !newSourceContent.trim()) {
      toast.error("Por favor completa el título y el contenido");
      return;
    }

    try {
      setAddingSource(true);
      const res = await fetch("/api/sdr/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newSourceTitle,
          source_type: newSourceType,
          content: newSourceContent,
          status: "approved",
        }),
      });

      if (!res.ok) throw new Error("Error al agregar fuente de conocimiento");
      toast.success("Documento añadido a la base de conocimiento");
      setNewSourceTitle("");
      setNewSourceContent("");
      loadKnowledge();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar");
    } finally {
      setAddingSource(false);
    }
  };

  const handleDeleteKnowledge = async (id: string) => {
    if (!confirm("¿Seguro que deseas eliminar este documento de la base de conocimiento?")) return;
    try {
      const res = await fetch(`/api/sdr/knowledge?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      toast.success("Documento eliminado");
      loadKnowledge();
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar");
    }
  };

  const handleSimulate = async () => {
    if (!simMessage.trim()) {
      toast.error("Por favor ingresa un mensaje para probar");
      return;
    }

    try {
      setSimLoading(true);
      setSimResult(null);
      const res = await fetch("/api/sdr/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: simMessage,
          senderName: simSenderName,
          systemPrompt,
          companyContext,
          customInstructions,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error en la simulación");

      setSimResult(json);
      toast.success("Simulación completada con Gemini");
    } catch (err: any) {
      toast.error(err.message || "Error en la simulación");
    } finally {
      setSimLoading(false);
    }
  };

  const getModeBadge = (m: string) => {
    switch (m) {
      case "auto":
        return { label: "Modo Autónomo (Auto)", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
      case "approval":
        return { label: "Modo Copiloto (Aprobación)", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
      case "shadow":
        return { label: "Modo Sombra (Shadow)", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
      default:
        return { label: "Desactivado (Off)", color: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
    }
  };

  return (
    <>
      <Head>
        <title>Agente SDR IA — Linki InHubFlow</title>
      </Head>

      <div className="p-8 max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-base-300/40 pb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
              <RiRobotLine size={28} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-base-content tracking-tight">Agente SDR con IA</h1>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${getModeBadge(mode).color}`}
                >
                  {getModeBadge(mode).label}
                </span>
              </div>
              <p className="text-sm text-base-content/60 mt-0.5">
                Calificación de prospectos, respuestas inteligentes y agendamiento automático para LinkedIn e Inbox.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadConfig}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium bg-base-200 hover:bg-base-300 text-base-content/80 border border-base-300/60 transition-colors"
            >
              <RiRefreshLine size={16} className={loading ? "animate-spin" : ""} />
              Actualizar
            </button>
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-600/30 transition-all disabled:opacity-50"
            >
              <RiSaveLine size={16} />
              {saving ? "Guardando..." : "Guardar Cambios"}
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-base-300/40 pb-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "overview"
                ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                : "text-base-content/60 hover:text-base-content hover:bg-base-200/50"
            }`}
          >
            <RiSettings4Line size={18} />
            Resumen & Modos
          </button>

          <button
            onClick={() => setActiveTab("prompts")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "prompts"
                ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                : "text-base-content/60 hover:text-base-content hover:bg-base-200/50"
            }`}
          >
            <RiUserVoiceLine size={18} />
            Prompts & Personalidad
          </button>

          <button
            onClick={() => setActiveTab("knowledge")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "knowledge"
                ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                : "text-base-content/60 hover:text-base-content hover:bg-base-200/50"
            }`}
          >
            <RiBookOpenLine size={18} />
            Base de Conocimiento ({knowledgeSources.length})
          </button>

          <button
            onClick={() => setActiveTab("simulator")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "simulator"
                ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                : "text-base-content/60 hover:text-base-content hover:bg-base-200/50"
            }`}
          >
            <RiSparklingLine size={18} />
            Playground & Simulador
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "history"
                ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                : "text-base-content/60 hover:text-base-content hover:bg-base-200/50"
            }`}
          >
            <RiHistoryLine size={18} />
            Historial de Decisiones
          </button>
        </div>

        {/* ─── TAB 1: OVERVIEW & MODES ────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-8">
            {/* Quick Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-base-200/60 border border-base-300/60 shadow-sm">
                <div className="text-xs font-medium text-base-content/50 mb-1 flex items-center gap-1.5">
                  <RiChatCheckLine className="text-violet-400" /> Decisiones IA Totales
                </div>
                <div className="text-2xl font-bold text-base-content">{data?.stats.totalDecisions ?? 0}</div>
              </div>

              <div className="p-5 rounded-2xl bg-base-200/60 border border-base-300/60 shadow-sm">
                <div className="text-xs font-medium text-base-content/50 mb-1 flex items-center gap-1.5">
                  <RiAlertLine className="text-amber-400" /> Handoffs a Humano
                </div>
                <div className="text-2xl font-bold text-amber-400">{data?.stats.totalHandoffs ?? 0}</div>
              </div>

              <div className="p-5 rounded-2xl bg-base-200/60 border border-base-300/60 shadow-sm">
                <div className="text-xs font-medium text-base-content/50 mb-1 flex items-center gap-1.5">
                  <RiRobotLine className="text-emerald-400" /> Hilos con IA Activa
                </div>
                <div className="text-2xl font-bold text-emerald-400">{data?.stats.activeThreads ?? 0}</div>
              </div>

              <div className="p-5 rounded-2xl bg-base-200/60 border border-base-300/60 shadow-sm">
                <div className="text-xs font-medium text-base-content/50 mb-1 flex items-center gap-1.5">
                  <RiShieldCheckLine className="text-blue-400" /> Nivel de Confianza
                </div>
                <div className="text-2xl font-bold text-base-content">{(confidenceThreshold * 100).toFixed(0)}%</div>
              </div>
            </div>

            {/* Mode Selection Cards */}
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-base-content">Modo de Operación del SDR</h2>
                <p className="text-sm text-base-content/50">
                  Selecciona cómo debe actuar la IA cuando reciba un mensaje en la bandeja de entrada o LinkedIn.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* OFF */}
                <div
                  onClick={() => setMode("off")}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                    mode === "off"
                      ? "bg-base-200 border-slate-400 ring-2 ring-slate-400/20 shadow-md"
                      : "bg-base-200/40 border-base-300/60 hover:bg-base-200/70"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400">
                      OFF
                    </span>
                    {mode === "off" && <RiCheckLine className="text-slate-400" size={18} />}
                  </div>
                  <h3 className="font-semibold text-base-content text-base mb-1">Desactivado</h3>
                  <p className="text-xs text-base-content/60 leading-relaxed">
                    El módulo no realiza análisis, ni clasificaciones, ni propuestas de respuesta.
                  </p>
                </div>

                {/* SHADOW */}
                <div
                  onClick={() => setMode("shadow")}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                    mode === "shadow"
                      ? "bg-amber-500/10 border-amber-500/40 ring-2 ring-amber-500/20 shadow-md"
                      : "bg-base-200/40 border-base-300/60 hover:bg-base-200/70"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                      RECOMENDADO
                    </span>
                    {mode === "shadow" && <RiCheckLine className="text-amber-400" size={18} />}
                  </div>
                  <h3 className="font-semibold text-base-content text-base mb-1">Modo Sombra (Shadow)</h3>
                  <p className="text-xs text-base-content/60 leading-relaxed">
                    La IA analiza y genera borradores en segundo plano para auditoría, pero garantiza 0 envíos salientes.
                  </p>
                </div>

                {/* APPROVAL */}
                <div
                  onClick={() => setMode("approval")}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                    mode === "approval"
                      ? "bg-blue-500/10 border-blue-500/40 ring-2 ring-blue-500/20 shadow-md"
                      : "bg-base-200/40 border-base-300/60 hover:bg-base-200/70"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                      COPILOTO
                    </span>
                    {mode === "approval" && <RiCheckLine className="text-blue-400" size={18} />}
                  </div>
                  <h3 className="font-semibold text-base-content text-base mb-1">Modo Aprobación</h3>
                  <p className="text-xs text-base-content/60 leading-relaxed">
                    La IA prepara la respuesta sugerida en tu Inbox para que la apruebes o edites con un solo clic.
                  </p>
                </div>

                {/* AUTO */}
                <div
                  onClick={() => setMode("auto")}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                    mode === "auto"
                      ? "bg-emerald-500/10 border-emerald-500/40 ring-2 ring-emerald-500/20 shadow-md"
                      : "bg-base-200/40 border-base-300/60 hover:bg-base-200/70"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                      AUTÓNOMO
                    </span>
                    {mode === "auto" && <RiCheckLine className="text-emerald-400" size={18} />}
                  </div>
                  <h3 className="font-semibold text-base-content text-base mb-1">Modo Automático</h3>
                  <p className="text-xs text-base-content/60 leading-relaxed">
                    La IA responde de inmediato a mensajes de alta confianza, con hard-stops estrictos ante objeciones complejas.
                  </p>
                </div>
              </div>
            </div>

            {/* Core Settings */}
            <div className="p-6 rounded-2xl bg-base-200/60 border border-base-300/60 space-y-6">
              <h3 className="font-semibold text-base-content text-base flex items-center gap-2">
                <RiSettings4Line className="text-violet-400" /> Parámetros del Motor de IA
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-2">
                    Modelo de Inteligencia Artificial
                  </label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-base-100 border border-base-300/80 text-sm font-medium text-base-content focus:outline-none focus:border-violet-500"
                  >
                    <option value="gemini-3.6-flash">Google Gemini 3.6 Flash (Recomendado - Ultrarrápido)</option>
                    <option value="gemini-3.7-flash">Google Gemini 3.7 Flash</option>
                  </select>
                  <p className="text-xs text-base-content/40 mt-1.5">
                    Utiliza la API de Gemini configurada en .env.local con salida JSON estructurada.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-2">
                    Umbral Mínimo de Confianza: {(confidenceThreshold * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min="0.70"
                    max="0.99"
                    step="0.01"
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                    className="w-full accent-violet-500 cursor-pointer mt-2"
                  />
                  <p className="text-xs text-base-content/40 mt-1.5">
                    Si la confianza es inferior, la IA solicitará revisión humana automáticamente.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-2">
                    Máximo de Turnos Consecutivos
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={maxAutoTurns}
                    onChange={(e) => setMaxAutoTurns(parseInt(e.target.value, 10))}
                    className="w-full px-4 py-2.5 rounded-xl bg-base-100 border border-base-300/80 text-sm font-medium text-base-content focus:outline-none focus:border-violet-500"
                  />
                  <p className="text-xs text-base-content/40 mt-1.5">
                    Límite de respuestas de IA continuas antes de requerir intervención humana.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 2: PROMPTS & PERSONALITY ──────────────────────────────────── */}
        {activeTab === "prompts" && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-base-200/60 border border-base-300/60 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-base-content mb-1">
                  Prompt del Sistema / Rol del SDR
                </label>
                <p className="text-xs text-base-content/50 mb-3">
                  Define la identidad, el tono, las directivas comerciales y cómo debe presentarse tu agente ante los prospectos.
                </p>
                <textarea
                  rows={8}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="w-full p-4 rounded-xl bg-base-100 border border-base-300/80 font-mono text-xs text-base-content leading-relaxed focus:outline-none focus:border-violet-500"
                  placeholder="Instrucciones del rol del SDR..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 rounded-2xl bg-base-200/60 border border-base-300/60 space-y-3">
                <label className="block text-sm font-semibold text-base-content">
                  Reglas de Seguridad y Handoff (Hard Stops)
                </label>
                <p className="text-xs text-base-content/50">
                  Situaciones donde la IA debe detenerse de inmediato y derivar la conversación a un humano.
                </p>
                <textarea
                  rows={5}
                  value={handoffRules}
                  onChange={(e) => setHandoffRules(e.target.value)}
                  className="w-full p-3 rounded-xl bg-base-100 border border-base-300/80 text-xs text-base-content focus:outline-none focus:border-violet-500"
                  placeholder="Ej: Si el prospecto pide un descuento personalizado, tiene dudas legales o solicita hablar con el dueño..."
                />
              </div>

              <div className="p-6 rounded-2xl bg-base-200/60 border border-base-300/60 space-y-3">
                <label className="block text-sm font-semibold text-base-content">
                  Instrucciones Personalizadas Adicionales
                </label>
                <p className="text-xs text-base-content/50">
                  Instrucciones específicas temporales (ej: promociones del mes, enlaces a webinars o demos).
                </p>
                <textarea
                  rows={5}
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  className="w-full p-3 rounded-xl bg-base-100 border border-base-300/80 text-xs text-base-content focus:outline-none focus:border-violet-500"
                  placeholder="Ej: Para clientes en Brasil, ofrecer soporte en portugués nativo..."
                />
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 3: KNOWLEDGE BASE ─────────────────────────────────────────── */}
        {activeTab === "knowledge" && (
          <div className="space-y-6">
            {/* General Company Context */}
            <div className="p-6 rounded-2xl bg-base-200/60 border border-base-300/60 space-y-3">
              <label className="block text-sm font-semibold text-base-content">
                Contexto Principal de la Empresa y Servicios
              </label>
              <p className="text-xs text-base-content/50">
                Información general de InHubFlow que el agente siempre tendrá en memoria como base de verdad.
              </p>
              <textarea
                rows={6}
                value={companyContext}
                onChange={(e) => setCompanyContext(e.target.value)}
                className="w-full p-4 rounded-xl bg-base-100 border border-base-300/80 text-xs text-base-content leading-relaxed focus:outline-none focus:border-violet-500"
                placeholder="Servicios, propuesta de valor, diferenciadores comerciales..."
              />
            </div>

            {/* Add Knowledge Item Form */}
            <form onSubmit={handleAddKnowledge} className="p-6 rounded-2xl bg-base-200/60 border border-base-300/60 space-y-4">
              <h3 className="font-semibold text-base-content text-base flex items-center gap-2">
                <RiAddLine className="text-violet-400" /> Añadir Documento / FAQ / Catálogo
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <input
                    type="text"
                    value={newSourceTitle}
                    onChange={(e) => setNewSourceTitle(e.target.value)}
                    placeholder="Título (ej: Preguntas Frecuentes de Integración con LinkedIn)"
                    className="w-full px-4 py-2 rounded-xl bg-base-100 border border-base-300/80 text-sm text-base-content focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <select
                    value={newSourceType}
                    onChange={(e) => setNewSourceType(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl bg-base-100 border border-base-300/80 text-sm text-base-content focus:outline-none focus:border-violet-500"
                  >
                    <option value="catalog">Catálogo de Productos / Servicios</option>
                    <option value="policy">Políticas & FAQs</option>
                    <option value="text">Documento de Texto Libre</option>
                  </select>
                </div>
              </div>

              <div>
                <textarea
                  rows={4}
                  value={newSourceContent}
                  onChange={(e) => setNewSourceContent(e.target.value)}
                  placeholder="Detalle o respuestas a preguntas frecuentes para que la IA consulte..."
                  className="w-full p-4 rounded-xl bg-base-100 border border-base-300/80 text-xs text-base-content focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={addingSource}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-50"
                >
                  <RiAddLine size={16} />
                  {addingSource ? "Añadiendo..." : "Añadir a la Base"}
                </button>
              </div>
            </form>

            {/* List of Knowledge Sources */}
            <div className="space-y-3">
              <h3 className="font-semibold text-base-content text-sm">Documentos Guardados ({knowledgeSources.length})</h3>
              {knowledgeSources.length === 0 ? (
                <div className="p-8 text-center rounded-2xl bg-base-200/30 border border-base-300/40 text-sm text-base-content/40">
                  No hay documentos adicionales registrados. La IA usará el contexto general.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {knowledgeSources.map((s) => (
                    <div key={s.id} className="p-5 rounded-2xl bg-base-200/40 border border-base-300/60 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 uppercase">
                            {s.source_type}
                          </span>
                          <button
                            onClick={() => handleDeleteKnowledge(s.id)}
                            className="p-1.5 rounded-lg text-base-content/40 hover:text-error hover:bg-error/10 transition-colors"
                          >
                            <RiDeleteBinLine size={15} />
                          </button>
                        </div>
                        <h4 className="font-semibold text-base-content text-sm mb-1">{s.title}</h4>
                        <p className="text-xs text-base-content/60 line-clamp-3 leading-relaxed">{s.content}</p>
                      </div>
                      <div className="text-[10px] text-base-content/30 mt-3">
                        {new Date(s.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB 4: SIMULATOR / PLAYGROUND ─────────────────────────────────── */}
        {activeTab === "simulator" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Input Simulation Form */}
            <div className="p-6 rounded-2xl bg-base-200/60 border border-base-300/60 space-y-4">
              <h3 className="font-semibold text-base-content text-base flex items-center gap-2">
                <RiSparklingLine className="text-violet-400" /> Simulador de Mensaje Entrante
              </h3>
              <p className="text-xs text-base-content/50">
                Prueba cómo respondería tu Agente SDR en tiempo real con la configuración actual antes de activarlo en vivo.
              </p>

              <div>
                <label className="block text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-1.5">
                  Nombre del Prospecto
                </label>
                <input
                  type="text"
                  value={simSenderName}
                  onChange={(e) => setSimSenderName(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl bg-base-100 border border-base-300/80 text-sm text-base-content focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-1.5">
                  Mensaje del Prospecto (Inbound)
                </label>
                <textarea
                  rows={5}
                  value={simMessage}
                  onChange={(e) => setSimMessage(e.target.value)}
                  className="w-full p-4 rounded-xl bg-base-100 border border-base-300/80 text-sm text-base-content leading-relaxed focus:outline-none focus:border-violet-500"
                  placeholder="Escribe el mensaje del prospecto aquí..."
                />
              </div>

              <button
                type="button"
                onClick={handleSimulate}
                disabled={simLoading}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-600/20 transition-all disabled:opacity-50"
              >
                <RiSendPlaneLine size={18} />
                {simLoading ? "Procesando con Gemini..." : "Simular Respuesta con IA"}
              </button>
            </div>

            {/* Simulation Results Display */}
            <div className="p-6 rounded-2xl bg-base-200/60 border border-base-300/60 flex flex-col justify-between">
              {simResult ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-base-300/40 pb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-base-content/50">
                      Resultado del Análisis
                    </span>
                    <span className="text-xs text-base-content/40 flex items-center gap-1">
                      <RiTimeLine size={12} /> {simResult.latencyMs} ms ({simResult.model})
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-base-100 border border-base-300/60">
                      <div className="text-[10px] uppercase font-bold text-base-content/40">Intención</div>
                      <div className="text-sm font-bold text-violet-400 uppercase mt-0.5">
                        {simResult.decision.intent}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-base-100 border border-base-300/60">
                      <div className="text-[10px] uppercase font-bold text-base-content/40">Confianza</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5">
                        {(simResult.decision.confidence * 100).toFixed(1)}%
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-base-100 border border-base-300/60">
                      <div className="text-[10px] uppercase font-bold text-base-content/40">Acción Sugerida</div>
                      <div className="text-sm font-semibold text-base-content mt-0.5">
                        {simResult.decision.recommended_action}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-base-100 border border-base-300/60">
                      <div className="text-[10px] uppercase font-bold text-base-content/40">Requiere Humano</div>
                      <div
                        className={`text-sm font-semibold mt-0.5 ${
                          simResult.decision.requires_human ? "text-amber-400" : "text-emerald-400"
                        }`}
                      >
                        {simResult.decision.requires_human ? "⚠️ SÍ" : "NO"}
                      </div>
                    </div>
                  </div>

                  {simResult.decision.reply_draft && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-base-content/60">Borrador Sugerido por la IA:</div>
                      <div className="p-4 rounded-xl bg-base-100 border border-violet-500/30 text-sm text-base-content leading-relaxed whitespace-pre-line">
                        {simResult.decision.reply_draft}
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-base-content/50 italic bg-base-100/50 p-3 rounded-xl border border-base-300/40">
                    <span className="font-semibold not-italic">Justificación IA:</span> {simResult.decision.reasoning_summary}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-base-content/40">
                  <RiRobotLine size={48} className="mb-3 opacity-30" />
                  <p className="text-sm font-medium">No hay simulaciones recientes</p>
                  <p className="text-xs mt-1">Escribe un mensaje de prueba y haz clic en "Simular Respuesta con IA".</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB 5: DECISION HISTORY ───────────────────────────────────────── */}
        {activeTab === "history" && (
          <div className="p-6 rounded-2xl bg-base-200/60 border border-base-300/60 space-y-4">
            <h3 className="font-semibold text-base-content text-base flex items-center gap-2">
              <RiHistoryLine className="text-violet-400" /> Registro de Decisiones Recientes
            </h3>
            <p className="text-xs text-base-content/50">
              Auditoría completa de todas las clasificaciones y borradores generados por el SDR.
            </p>

            {data?.recentDecisions?.length === 0 ? (
              <div className="p-8 text-center text-sm text-base-content/40">
                Aún no hay decisiones registradas en la base de datos.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-base-300/40 text-left text-xs font-semibold text-base-content/40 uppercase">
                      <th className="py-3 px-4">Fecha</th>
                      <th className="py-3 px-4">Prospecto</th>
                      <th className="py-3 px-4">Intención</th>
                      <th className="py-3 px-4">Confianza</th>
                      <th className="py-3 px-4">Acción</th>
                      <th className="py-3 px-4">Humano</th>
                      <th className="py-3 px-4">Borrador</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-base-300/30">
                    {data?.recentDecisions?.map((d) => (
                      <tr key={d.id} className="hover:bg-base-200/40 transition-colors">
                        <td className="py-3 px-4 text-xs text-base-content/60 whitespace-nowrap">
                          {new Date(d.created_at).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-medium text-base-content">
                          {d.target_name || "Prospecto"}
                          {d.target_company && <span className="block text-xs text-base-content/40">{d.target_company}</span>}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-500/10 text-violet-400">
                            {d.intent}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-emerald-400">
                          {(d.confidence * 100).toFixed(0)}%
                        </td>
                        <td className="py-3 px-4 text-xs text-base-content/70">{d.recommended_action}</td>
                        <td className="py-3 px-4">
                          {d.requires_human ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400">
                              Requerido
                            </span>
                          ) : (
                            <span className="text-xs text-base-content/40">No</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-base-content/60 max-w-xs truncate">
                          {d.reply_draft || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
