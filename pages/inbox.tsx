import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  RiAlertLine,
  RiAttachment2,
  RiBuildingLine,
  RiCheckDoubleLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEmotionLine,
  RiExternalLinkLine,
  RiFilePdfLine,
  RiFileTextLine,
  RiFilter3Line,
  RiImageLine,
  RiInboxLine,
  RiInformationLine,
  RiLinkedinBoxLine,
  RiLoader4Line,
  RiMailLine,
  RiNotification3Line,
  RiPulseLine,
  RiRefreshLine,
  RiRobotLine,
  RiSearchLine,
  RiSendPlaneLine,
  RiSparklingLine,
  RiTimeLine,
  RiUserLine,
  RiVideoLine,
  RiVolumeUpLine,
} from "react-icons/ri";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import type { Locale, TranslationParams } from "@/lib/i18n/types";
import type { InboxReply } from "./api/inbox/index";
import type { EmailMessage } from "./api/inbox/thread";

type Translate = (key: string, params?: TranslationParams) => string;

type ChannelFilter = "all" | "email" | "linkedin";

type QuickFilter = "all" | "linkedin" | "email" | "autopilot" | "handoff";

interface LinkedInThreadMessage {
  externalThreadId: string;
  externalMessageId: string;
  direction: "inbound" | "outbound" | "system";
  body: string;
  sentAt: string;
  senderExternalId: string | null;
  senderName: string | null;
  metadataJson: string;
}

interface LinkedInAccountOption {
  id: string;
  name: string;
  email: string;
  is_authenticated: number;
}

interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

const DATE_LOCALES: Record<Locale, string> = {
  en: "en-US",
  es: "es-ES",
  "pt-BR": "pt-BR",
};

const VERDICT_CLASSES: Record<string, string> = {
  ooo_followup: "bg-warning/15 text-warning border-warning/30",
  substitute: "bg-secondary/15 text-secondary border-secondary/30",
  call_task: "bg-success/15 text-success border-success/30",
  human_reply: "bg-info/15 text-info border-info/30",
  not_interested: "bg-error/15 text-error border-error/30",
  cancelled: "bg-base-300/60 text-base-content/50 border-base-300",
  pending: "bg-base-300/60 text-base-content/50 border-base-300",
  failed: "bg-error/15 text-error border-error/30",
  none: "bg-base-300/40 text-base-content/40 border-base-300/50",
};

const EMOJI_CATEGORIES = [
  { label: "Populares B2B", emojis: ["👍", "🤝", "🚀", "💼", "📈", "🎯", "✅", "💡", "🔥", "⭐"] },
  { label: "Expresiones", emojis: ["😀", "😊", "😉", "🤗", "🤩", "😎", "🥳", "🤔", "💬", "🙏"] },
  { label: "Oficina & Tech", emojis: ["💻", "📱", "📊", "📅", "📍", "✉️", "🔗", "🏆", "📂", "🔍"] },
];

function timeAgo(iso: string, locale: Locale, t: Translate): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("inbox.time.justNow");
  if (mins < 60) return t("inbox.time.minutes", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("inbox.time.hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("inbox.time.days", { count: days });
  return new Date(iso).toLocaleDateString(DATE_LOCALES[locale], { month: "short", day: "numeric" });
}

function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(DATE_LOCALES[locale], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function verdictKey(reply: InboxReply): string {
  if (reply.classification_error) return "failed";
  if (reply.reply_id && !reply.classified_at) return "pending";
  if (reply.reply_kind && VERDICT_CLASSES[reply.reply_kind]) return reply.reply_kind;
  return "none";
}

function verdictBadge(reply: InboxReply, t: Translate): { label: string; cls: string } {
  const key = verdictKey(reply);
  return {
    label: t(`inbox.verdicts.${key}`),
    cls: VERDICT_CLASSES[key] ?? VERDICT_CLASSES.none,
  };
}

function dedupeLinkedInMessages(msgs: LinkedInThreadMessage[]): LinkedInThreadMessage[] {
  const seen = new Set<string>();
  const result: LinkedInThreadMessage[] = [];
  for (const m of msgs) {
    const key = `${m.direction}:${m.body.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(m);
    }
  }
  return result;
}

function playNotificationChime() {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // Tone 1 (D5 - 587Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
    gain1.gain.setValueAtTime(0.18, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.3);

    // Tone 2 (A5 - 880Hz, vibrant ding)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880.0, ctx.currentTime + 0.1);
    gain2.gain.setValueAtTime(0.22, ctx.currentTime + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.1);
    osc2.stop(ctx.currentTime + 0.6);
  } catch {
    // AudioContext blocked or not allowed yet
  }
}

function triggerDesktopNotification(options: {
  title: string;
  body: string;
  onClick?: () => void;
}) {
  playNotificationChime();
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(options.title, {
        body: options.body,
        icon: "/favicon.ico",
      });
      if (options.onClick) {
        n.onclick = () => {
          window.focus();
          options.onClick?.();
          n.close();
        };
      }
    } catch {
      // Notification constructor blocked
    }
  }
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getAvatarColor(name: string | null | undefined): string {
  if (!name) return "bg-primary/20 text-primary border-primary/30";
  const colors = [
    "bg-primary/20 text-primary border-primary/30",
    "bg-secondary/20 text-secondary border-secondary/30",
    "bg-accent/20 text-accent border-accent/30",
    "bg-info/20 text-info border-info/30",
    "bg-success/20 text-success border-success/30",
    "bg-warning/20 text-warning border-warning/30",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// ── RIGHT PANE: Full Chat Panel ──
interface ChatPanelProps {
  reply: InboxReply;
  onActionDone: () => void;
  hasPremium: boolean;
}

function ChatPanel({ reply, onActionDone, hasPremium }: ChatPanelProps) {
  const { t, locale } = useTranslation();
  const hasEmailReply = reply.channel === "email" || reply.channel === "both";
  const hasLinkedInReply = reply.channel === "linkedin" || reply.channel === "both";
  const canReplyByEmail = hasEmailReply && !!reply.email && !!reply.email_account_id;

  const [activeChannelTab, setActiveChannelTab] = useState<"linkedin" | "email">(
    hasLinkedInReply ? "linkedin" : "email"
  );
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [linkedinMessages, setLinkedinMessages] = useState<LinkedInThreadMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(canReplyByEmail);
  const [loadingLinkedInThread, setLoadingLinkedInThread] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [aiSuggestionMeta, setAiSuggestionMeta] = useState<{ reasoning?: string; confidence?: string } | null>(null);
  const [autopilot, setAutopilot] = useState(reply.sdr_autopilot === 1);
  const [togglingAutopilot, setTogglingAutopilot] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Sync autopilot state when reply prop updates
  useEffect(() => {
    setAutopilot(reply.sdr_autopilot === 1);
  }, [reply.sdr_autopilot, reply.id]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("El archivo supera el límite de 20 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachment({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: reader.result as string,
      });
      toast.success(`Archivo adjunto: ${file.name}`);
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleInsertEmoji(emoji: string) {
    setReplyText((prev) => prev + emoji);
  }

  // Load Email Thread
  useEffect(() => {
    if (!canReplyByEmail || !reply.email_account_id || !reply.email) {
      setLoadingThread(false);
      return;
    }

    let cancelled = false;
    setLoadingThread(true);
    const params = new URLSearchParams({ targetId: reply.id, emailAccountId: reply.email_account_id });
    fetch(`/api/inbox/thread?${params}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? t("inbox.errors.loadThread"));
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        const loadedMessages = (data.messages ?? []) as EmailMessage[];
        setMessages(loadedMessages);
        const last = loadedMessages.at(-1);
        if (last) setReplySubject(last.subject.startsWith("Re:") ? last.subject : `Re: ${last.subject}`);
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : t("inbox.errors.loadThread"));
      })
      .finally(() => {
        if (!cancelled) setLoadingThread(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canReplyByEmail, reply.id, reply.email_account_id, reply.email, t]);

  // Load LinkedIn Thread
  useEffect(() => {
    if (!hasLinkedInReply && !reply.linkedin_url) {
      setLoadingLinkedInThread(false);
      setLinkedinMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingLinkedInThread(true);
    const params = new URLSearchParams({ targetId: reply.id });
    if (reply.linkedin_account_id) params.set("accountId", reply.linkedin_account_id);
    if (reply.linkedin_thread_id) params.set("threadId", reply.linkedin_thread_id);

    fetch(`/api/inbox/linkedin-thread?${params}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? t("inbox.errors.loadLinkedInThread"));
        return data as { messages?: LinkedInThreadMessage[] };
      })
      .then((data) => {
        if (cancelled) return;
        const loaded = data.messages ?? [];
        if (loaded.length === 0 && reply.linkedin_reply_body) {
          setLinkedinMessages([
            {
              externalThreadId: reply.linkedin_thread_id || `thread-${reply.id}`,
              externalMessageId: `inbound-${reply.id}`,
              direction: "inbound",
              senderName: reply.full_name,
              senderExternalId: null,
              body: reply.linkedin_reply_body,
              sentAt: reply.linkedin_reply_received_at || new Date().toISOString(),
              metadataJson: "{}",
            },
          ]);
        } else {
          setLinkedinMessages(dedupeLinkedInMessages(loaded));
        }
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : t("inbox.errors.loadLinkedInThread"));
      })
      .finally(() => {
        if (!cancelled) setLoadingLinkedInThread(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    hasLinkedInReply,
    reply.id,
    reply.linkedin_account_id,
    reply.linkedin_thread_id,
    reply.linkedin_url,
    reply.linkedin_reply_body,
    reply.linkedin_reply_received_at,
    reply.full_name,
    t,
  ]);

  // Auto-scroll on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, linkedinMessages]);

  // Live polling for LinkedIn messages every 4s
  useEffect(() => {
    if (!hasLinkedInReply && !reply.linkedin_url) return;

    const interval = setInterval(() => {
      const params = new URLSearchParams({ targetId: reply.id });
      if (reply.linkedin_account_id) params.set("accountId", reply.linkedin_account_id);
      fetch(`/api/inbox/linkedin-thread?${params}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.ok && Array.isArray(data.messages) && data.messages.length > 0) {
            const deduped = dedupeLinkedInMessages(data.messages);
            setLinkedinMessages((prev) => {
              if (deduped.length !== prev.length || JSON.stringify(deduped) !== JSON.stringify(prev)) {
                return deduped;
              }
              return prev;
            });
          }
        })
        .catch(() => {});
    }, 4000);

    return () => clearInterval(interval);
  }, [hasLinkedInReply, reply.id, reply.linkedin_account_id, reply.linkedin_url]);

  async function handleSuggestReply() {
    setSuggesting(true);
    setAiSuggestionMeta(null);
    try {
      const lastMsg =
        reply.linkedin_reply_body || linkedinMessages.at(-1)?.body || messages.at(-1)?.text || "";
      const history = hasLinkedInReply
        ? linkedinMessages.map((m) => ({ direction: m.direction, body: m.body }))
        : messages.map((m) => ({
            direction: m.from.includes(reply.email || "") ? "inbound" : "outbound",
            body: m.text,
          }));

      const response = await fetch("/api/inbox/suggest-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: reply.id,
          lastMessage: lastMsg,
          history,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo generar la sugerencia.");
      if (data.suggestedReply) {
        setReplyText(data.suggestedReply);
        setAiSuggestionMeta({
          reasoning: data.reasoning || "Generada según el conocimiento de tu empresa y el perfil del prospecto.",
          confidence: data.confidence ? `${Math.round(data.confidence * 100)}%` : undefined,
        });
        toast.success("Sugerencia de SDR IA generada.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al generar sugerencia.");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSendLinkedIn() {
    if (!replyText.trim() && !attachment) return;
    const accountId = reply.linkedin_account_id;
    if (!accountId) {
      toast.error("No se encontró la cuenta de LinkedIn asociada.");
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/inbox/reply-linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: reply.id,
          accountId,
          messageText: replyText,
          threadId: reply.linkedin_thread_id,
          attachment: attachment
            ? {
                name: attachment.name,
                type: attachment.type,
                dataUrl: attachment.dataUrl,
              }
            : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Error al enviar mensaje a LinkedIn");

      toast.success("Mensaje enviado a LinkedIn con éxito.");
      const newMsg: LinkedInThreadMessage = {
        externalThreadId: reply.linkedin_thread_id || `thread-${reply.id}`,
        externalMessageId: data.messageId || `outbound-${Date.now()}`,
        direction: "outbound",
        senderName: reply.linkedin_account_name || "Tú",
        senderExternalId: null,
        metadataJson: JSON.stringify(data.metadata || {}),
        body: data.body || replyText.trim() || (attachment ? `📎 [Archivo: ${attachment.name}]` : ""),
        sentAt: data.sentAt || new Date().toISOString(),
      };
      setLinkedinMessages((prev) => {
        if (prev.length === 0 && reply.linkedin_reply_body) {
          const initialInbound: LinkedInThreadMessage = {
            externalThreadId: reply.linkedin_thread_id || `thread-${reply.id}`,
            externalMessageId: `inbound-${reply.id}`,
            direction: "inbound",
            senderName: reply.full_name,
            senderExternalId: null,
            body: reply.linkedin_reply_body,
            sentAt: reply.linkedin_reply_received_at || new Date().toISOString(),
            metadataJson: "{}",
          };
          return [initialInbound, newMsg];
        }
        return [...prev, newMsg];
      });
      setReplyText("");
      setAttachment(null);
      setShowEmojiPicker(false);
      setAiSuggestionMeta(null);
      onActionDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al enviar mensaje a LinkedIn");
    } finally {
      setSending(false);
    }
  }

  async function handleSendEmail() {
    if (!replyText.trim() || !reply.email || !reply.email_account_id) return;
    setSending(true);
    try {
      const response = await fetch("/api/inbox/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailAccountId: reply.email_account_id,
          to: reply.email,
          subject: replySubject,
          body: replyText,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("inbox.errors.send"));
      toast.success(t("inbox.toasts.replySent"));
      setReplyText("");
      setAiSuggestionMeta(null);
      onActionDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("inbox.errors.send"));
    } finally {
      setSending(false);
    }
  }

  async function handleToggleAutopilot() {
    setTogglingAutopilot(true);
    try {
      const next = !autopilot;
      const res = await fetch("/api/inbox/toggle-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: reply.id, enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cambiar piloto automático");
      setAutopilot(data.sdr_autopilot === 1);
      toast.success(
        data.message || (next ? "Piloto Automático SDR activado." : "Piloto Automático SDR desactivado.")
      );
      onActionDone();
    } catch (err: any) {
      toast.error(err.message || "Error al alternar piloto automático");
    } finally {
      setTogglingAutopilot(false);
    }
  }

  const vBadge = verdictBadge(reply, t);

  return (
    <div className="flex-1 flex flex-col h-full bg-base-100 min-w-0 overflow-hidden">
      {/* ── Chat Header ── */}
      <div className="px-5 py-3.5 border-b border-base-300/60 bg-base-100/90 backdrop-blur-sm flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm border shadow-sm ${getAvatarColor(
                reply.full_name
              )}`}
            >
              {getInitials(reply.full_name ?? reply.email)}
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-success ring-2 ring-base-100" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-base text-base-content truncate">
                {reply.full_name ?? reply.email ?? t("inbox.unknown")}
              </h2>
              {reply.linkedin_url && (
                <a
                  href={reply.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir perfil en LinkedIn"
                  className="text-primary hover:text-primary-focus transition-colors p-0.5 rounded"
                >
                  <RiExternalLinkLine size={14} />
                </a>
              )}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${vBadge.cls}`}>
                {vBadge.label}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-base-content/60 truncate mt-0.5">
              {reply.company && (
                <span className="flex items-center gap-1 font-medium text-base-content/80 truncate">
                  <RiBuildingLine size={12} className="shrink-0 text-base-content/40" />
                  {reply.company}
                </span>
              )}
              {reply.headline && <span className="text-base-content/40 truncate">· {reply.headline}</span>}
              {reply.linkedin_account_name && (
                <span className="text-primary/80 font-medium shrink-0">
                  (vía {reply.linkedin_account_name})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {reply.channel === "both" && (
            <div className="join join-horizontal bg-base-200 p-0.5 rounded-lg border border-base-300/60 text-xs">
              <button
                onClick={() => setActiveChannelTab("linkedin")}
                className={`join-item px-2.5 py-1 rounded-md font-medium transition-all ${
                  activeChannelTab === "linkedin"
                    ? "bg-primary text-primary-content shadow-sm"
                    : "text-base-content/60 hover:text-base-content"
                }`}
              >
                LinkedIn
              </button>
              <button
                onClick={() => setActiveChannelTab("email")}
                className={`join-item px-2.5 py-1 rounded-md font-medium transition-all ${
                  activeChannelTab === "email"
                    ? "bg-primary text-primary-content shadow-sm"
                    : "text-base-content/60 hover:text-base-content"
                }`}
              >
                Email
              </button>
            </div>
          )}

          <button
            onClick={handleToggleAutopilot}
            disabled={togglingAutopilot}
            title={
              autopilot
                ? "Piloto Automático ACTIVO: El SDR responderá automáticamente a este lead"
                : "Activar Piloto Automático SDR para que la IA responda por ti"
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all shadow-sm ${
              autopilot
                ? "bg-success/15 border-success/35 text-success hover:bg-success/25"
                : "bg-base-200 border-base-300/60 text-base-content/70 hover:bg-base-300 hover:text-base-content"
            }`}
          >
            {togglingAutopilot ? <RiLoader4Line size={13} className="animate-spin" /> : <RiRobotLine size={14} />}
            {autopilot ? "SDR: ACTIVO" : "SDR: OFF"}
          </button>
        </div>
      </div>

      {/* ── Messages Timeline Area ── */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-base-200/20">
        {activeChannelTab === "linkedin" ? (
          loadingLinkedInThread ? (
            <div className="flex flex-col items-center justify-center py-16 text-base-content/40 gap-2">
              <RiLoader4Line size={24} className="animate-spin text-primary" />
              <span className="text-xs font-medium">Cargando conversación de LinkedIn...</span>
            </div>
          ) : linkedinMessages.length === 0 ? (
            <div className="text-center py-16 text-base-content/40">
              <RiLinkedinBoxLine size={36} className="mx-auto opacity-30 mb-2" />
              <p className="text-sm font-medium">Sin mensajes de LinkedIn todavía</p>
              <p className="text-xs mt-1 text-base-content/30">Envía un mensaje o sincroniza para ver el historial.</p>
            </div>
          ) : (
            <div className="space-y-4 max-w-3xl mx-auto">
              <div className="flex items-center justify-center my-3">
                <span className="px-3 py-1 bg-base-200 border border-base-300/50 rounded-full text-[11px] font-medium text-base-content/50">
                  Conversación en LinkedIn · Sincronizada en vivo
                </span>
              </div>

              {linkedinMessages.map((msg, index) => {
                const isOutbound = msg.direction === "outbound";
                return (
                  <div
                    key={msg.externalMessageId || index}
                    className={`flex items-end gap-2.5 ${isOutbound ? "justify-end" : "justify-start"}`}
                  >
                    {!isOutbound && (
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 border ${getAvatarColor(
                          reply.full_name
                        )}`}
                      >
                        {getInitials(reply.full_name)}
                      </div>
                    )}

                    <div
                      className={`relative rounded-2xl px-4 py-3 text-sm shadow-sm transition-all max-w-[82%] sm:max-w-[72%] ${
                        isOutbound
                          ? "bg-primary text-primary-content rounded-br-xs"
                          : "bg-base-100 text-base-content border border-base-300/60 rounded-bl-xs"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 text-[10px] mb-1 opacity-70">
                        <span className="font-semibold">{isOutbound ? "Tú" : msg.senderName || reply.full_name}</span>
                        <span>{formatDate(msg.sentAt, locale)}</span>
                      </div>

                      <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.body}</p>

                      <div className="flex items-center justify-end gap-1 mt-1 text-[10px] opacity-60">
                        {isOutbound && <RiCheckDoubleLine size={12} />}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>
          )
        ) : loadingThread ? (
          <div className="flex flex-col items-center justify-center py-16 text-base-content/40 gap-2">
            <RiLoader4Line size={24} className="animate-spin text-info" />
            <span className="text-xs font-medium">Cargando hilo de correos...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16 text-base-content/40">
            <RiMailLine size={36} className="mx-auto opacity-30 mb-2" />
            <p className="text-sm font-medium">Sin correos electrónicos registrados</p>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((msg, idx) => {
              const isLead = msg.from.toLowerCase().includes((reply.email ?? "").toLowerCase());
              return (
                <div
                  key={msg.uid || msg.messageId || idx}
                  className={`flex flex-col ${
                    isLead
                      ? "bg-base-100 border border-base-300/60 rounded-2xl rounded-tl-xs p-4 shadow-sm"
                      : "bg-primary/10 border border-primary/20 rounded-2xl rounded-tr-xs p-4 shadow-sm ml-8"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-base-content/60 pb-2 border-b border-base-300/30">
                    <span className="font-semibold text-base-content">{isLead ? reply.full_name || msg.from : "Tú"}</span>
                    <span>{formatDate(msg.date, locale)}</span>
                  </div>
                  <div className="font-medium text-xs text-base-content/70 mt-2 mb-1">Asunto: {msg.subject}</div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed mt-1 text-base-content">{msg.text}</p>
                </div>
              );
            })}
            <div ref={threadEndRef} />
          </div>
        )}
      </div>

      {/* ── Composer Box ── */}
      <div className="p-4 border-t border-base-300/60 bg-base-100 shrink-0 space-y-2.5 relative">
        {/* AI Suggestion Card preview */}
        {aiSuggestionMeta && (
          <div className="flex items-center justify-between bg-primary/10 border border-primary/25 rounded-xl px-3 py-2 text-xs text-primary animate-fadeIn">
            <div className="flex items-center gap-2 min-w-0">
              <RiSparklingLine className="shrink-0 text-base" />
              <span className="truncate">
                <strong>Sugerencia de IA Lista:</strong> {aiSuggestionMeta.reasoning}
              </span>
            </div>
            <button
              onClick={() => setAiSuggestionMeta(null)}
              className="p-1 text-primary/60 hover:text-primary rounded-lg transition-colors ml-2"
            >
              <RiCloseLine size={14} />
            </button>
          </div>
        )}

        {/* Attachment preview chip */}
        {attachment && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-base-200 border border-base-300 text-xs text-base-content/80 shadow-sm animate-fadeIn">
            {attachment.type.includes("pdf") ? (
              <RiFilePdfLine className="text-error text-base" />
            ) : attachment.type.includes("image") ? (
              <RiImageLine className="text-info text-base" />
            ) : (
              <RiFileTextLine className="text-primary text-base" />
            )}
            <span className="font-medium max-w-48 truncate">{attachment.name}</span>
            <span className="text-[10px] text-base-content/40">({(attachment.size / 1024).toFixed(1)} KB)</span>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="p-0.5 hover:bg-base-300 rounded text-base-content/50 hover:text-error transition-colors"
            >
              <RiDeleteBinLine size={13} />
            </button>
          </div>
        )}

        {/* Text Input Area */}
        <div className="relative">
          {activeChannelTab === "email" && (
            <input
              type="text"
              placeholder="Asunto del correo..."
              value={replySubject}
              onChange={(e) => setReplySubject(e.target.value)}
              className="w-full mb-2 bg-base-200 border border-base-300/60 rounded-xl px-3.5 py-2 text-xs font-semibold focus:outline-none focus:border-primary/50"
            />
          )}

          <textarea
            rows={3}
            placeholder={
              activeChannelTab === "linkedin"
                ? "Escribe un mensaje de LinkedIn para este prospecto..."
                : "Escribe la respuesta de correo..."
            }
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (activeChannelTab === "linkedin") void handleSendLinkedIn();
                else void handleSendEmail();
              }
            }}
            className="w-full bg-base-200/70 border border-base-300/70 rounded-2xl px-4 py-3 text-sm text-base-content placeholder:text-base-content/35 focus:outline-none focus:border-primary/50 focus:bg-base-200 transition-all resize-none shadow-inner"
          />

          {/* Emoji Picker Popover */}
          {showEmojiPicker && (
            <div className="absolute bottom-16 left-2 z-50 bg-base-100 border border-base-300 rounded-2xl shadow-2xl p-3 w-72 space-y-2.5 animate-fadeIn">
              <div className="flex items-center justify-between pb-1.5 border-b border-base-300/40 text-xs font-semibold text-base-content/70">
                <span>Emojis Rápidos</span>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(false)}
                  className="p-1 rounded hover:bg-base-200 text-base-content/40 hover:text-base-content"
                >
                  <RiCloseLine size={14} />
                </button>
              </div>
              {EMOJI_CATEGORIES.map((cat) => (
                <div key={cat.label} className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-base-content/40">{cat.label}</span>
                  <div className="grid grid-cols-5 gap-1 text-lg">
                    {cat.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          handleInsertEmoji(emoji);
                          setShowEmojiPicker(false);
                        }}
                        className="p-1 hover:bg-base-200 rounded-lg text-center transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.mp4"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Toolbar Bottom Row */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-1.5">
            {activeChannelTab === "linkedin" && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Adjuntar documento o imagen (PDF, PNG, JPG, Docx)"
                  className="p-2 rounded-xl text-base-content/60 hover:text-base-content hover:bg-base-200 transition-colors"
                >
                  <RiAttachment2 size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  title="Insertar emojis"
                  className={`p-2 rounded-xl transition-colors ${
                    showEmojiPicker
                      ? "bg-primary/15 text-primary"
                      : "text-base-content/60 hover:text-base-content hover:bg-base-200"
                  }`}
                >
                  <RiEmotionLine size={17} />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleSuggestReply}
              disabled={suggesting}
              title="Generar respuesta inteligente usando la base de conocimiento de tu empresa y el perfil del prospecto"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary/10 border border-primary/25 text-primary hover:bg-primary/20 disabled:opacity-40 transition-all shadow-sm"
            >
              {suggesting ? <RiLoader4Line size={13} className="animate-spin" /> : <RiSparklingLine size={14} />}
              {suggesting ? "Pensando..." : "Sugerir con IA"}
            </button>
          </div>

          <button
            type="button"
            onClick={activeChannelTab === "linkedin" ? handleSendLinkedIn : handleSendEmail}
            disabled={sending || (!replyText.trim() && !attachment)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-primary text-primary-content hover:bg-primary-focus disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md active:scale-95"
          >
            {sending ? <RiLoader4Line size={14} className="animate-spin" /> : <RiSendPlaneLine size={14} />}
            {sending ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN INBOX PAGE ──
export default function InboxPage() {
  const { t, locale } = useTranslation();
  const [replies, setReplies] = useState<InboxReply[]>([]);
  const [accounts, setAccounts] = useState<LinkedInAccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [accountId, setAccountId] = useState("");
  const [selectedReply, setSelectedReply] = useState<InboxReply | null>(null);
  const [reclassifyingAll, setReclassifyingAll] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [syncingLinkedIn, setSyncingLinkedIn] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<any | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const seenReplyIdsRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  async function handleToggleNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error("Tu navegador no soporta notificaciones de escritorio.");
      return;
    }
    if (Notification.permission === "granted") {
      playNotificationChime();
      triggerDesktopNotification({
        title: "🔔 Notificaciones Linki Activas",
        body: "¡Listo! Sonará un timbre y recibirás una alerta cuando tu Agente SDR IA requiera tu ayuda.",
        onClick: () => {},
      });
      toast.success("Notificaciones activas. ¡Prueba emitida con sonido!");
      return;
    }
    const perm = await Notification.requestPermission();
    setNotificationPermission(perm);
    if (perm === "granted") {
      playNotificationChime();
      triggerDesktopNotification({
        title: "🔔 Notificaciones Linki Habilitadas",
        body: "Te avisaremos de inmediato con sonido cuando un cliente responda o se requiera tu intervención.",
        onClick: () => {},
      });
      toast.success("Notificaciones de escritorio habilitadas con éxito.");
    } else {
      toast.error("Permiso de notificaciones no otorgado en el navegador.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/accounts")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? t("inbox.errors.loadAccounts"));
        return data;
      })
      .then((data) => {
        if (!cancelled) setAccounts(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : t("inbox.errors.loadAccounts"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (channel !== "all") params.set("channel", channel);
    if (accountId) params.set("accountId", accountId);

    try {
      const response = await fetch(`/api/inbox?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("inbox.errors.loadReplies"));
      const newReplies = (data.replies ?? []) as InboxReply[];
      setReplies(newReplies);

      // Seed seen keys on initial load
      if (!initialLoadDoneRef.current) {
        for (const rep of newReplies) {
          const repKey = `${rep.id}:${rep.linkedin_reply_received_at || rep.last_replied_at || ""}`;
          seenReplyIdsRef.current.add(repKey);
        }
        initialLoadDoneRef.current = true;
      }
    } catch (error) {
      setReplies([]);
      toast.error(error instanceof Error ? error.message : t("inbox.errors.loadReplies"));
    } finally {
      setLoading(false);
    }
  }, [accountId, channel, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Silent live auto-refresh for inbox list every 15s with Desktop Alerts and Sound
  useEffect(() => {
    const interval = setInterval(() => {
      const params = new URLSearchParams();
      if (channel !== "all") params.set("channel", channel);
      if (accountId) params.set("accountId", accountId);

      fetch(`/api/inbox?${params}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.replies && Array.isArray(data.replies)) {
            const newReplies = data.replies as InboxReply[];
            setReplies(newReplies);

            if (initialLoadDoneRef.current) {
              for (const rep of newReplies) {
                const repKey = `${rep.id}:${rep.linkedin_reply_received_at || rep.last_replied_at || ""}`;
                if (!seenReplyIdsRef.current.has(repKey)) {
                  seenReplyIdsRef.current.add(repKey);

                  const sender = rep.full_name || rep.email || "Prospecto";
                  const snippet =
                    rep.linkedin_reply_body || rep.reply_body || rep.reply_summary || "Nuevo mensaje recibido";
                  const isHandoff =
                    rep.reply_kind === "human_handoff" ||
                    rep.reply_kind === "objection" ||
                    rep.reply_kind === "pricing";

                  triggerDesktopNotification({
                    title: isHandoff ? `⚠️ InHubFlow SDR: ¡Intervención Requerida!` : `💬 Nuevo mensaje de ${sender}`,
                    body: `${sender}: "${snippet.slice(0, 110)}"`,
                    onClick: () => {
                      setSelectedReply(rep);
                    },
                  });
                  break;
                }
              }
            } else {
              for (const rep of newReplies) {
                const repKey = `${rep.id}:${rep.linkedin_reply_received_at || rep.last_replied_at || ""}`;
                seenReplyIdsRef.current.add(repKey);
              }
              initialLoadDoneRef.current = true;
            }
          }
        })
        .catch(() => {});
    }, 15000);

    return () => clearInterval(interval);
  }, [accountId, channel]);

  async function handleBackfill() {
    setBackfilling(true);
    try {
      const response = await fetch("/api/inbox/backfill", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("inbox.errors.backfill"));
      toast.success(
        data.to_process === 0
          ? t("inbox.toasts.nothingToBackfill")
          : t("inbox.toasts.backfilled", {
              classified: data.classified,
              captured: data.captured,
              failed: data.failed ? ` (${data.failed} ${t("inbox.verdicts.failed").toLowerCase()})` : "",
            })
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("inbox.errors.backfill"));
    } finally {
      setBackfilling(false);
    }
  }

  async function handleReclassifyAll() {
    setReclassifyingAll(true);
    try {
      const response = await fetch("/api/inbox/reclassify-all", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("inbox.errors.reclassifyAll"));
      toast.success(
        data.to_process === 0
          ? t("inbox.toasts.nothingToReclassify")
          : t("inbox.toasts.reclassifiedAll", { count: data.to_process })
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("inbox.errors.reclassifyAll"));
    } finally {
      setReclassifyingAll(false);
    }
  }

  async function handleSyncLinkedIn() {
    const accId = accountId || accounts[0]?.id;
    if (!accId) {
      toast.error("Selecciona una cuenta de LinkedIn para sincronizar.");
      return;
    }
    setSyncingLinkedIn(true);
    try {
      const res = await fetch(`/api/accounts/${accId}/sync-linkedin-inbox`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al sincronizar LinkedIn");
      toast.success(`LinkedIn sincronizado: ${data.capturedCount || 0} respuestas capturadas.`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Error al sincronizar");
    } finally {
      setSyncingLinkedIn(false);
    }
  }

  async function handleDiagnose() {
    const accId = accountId || accounts[0]?.id;
    if (!accId) {
      toast.error("Selecciona una cuenta de LinkedIn para diagnosticar.");
      return;
    }
    setDiagnosing(true);
    try {
      const res = await fetch(`/api/accounts/${accId}/diagnose-inbox-live`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al ejecutar diagnóstico.");
      setDiagnosticReport(data);
      toast.success("Diagnóstico en vivo completado.");
    } catch (err: any) {
      toast.error(err.message || "Error en el diagnóstico.");
    } finally {
      setDiagnosing(false);
    }
  }

  // Filter conversations
  const filtered = useMemo(() => {
    return replies.filter((reply) => {
      // Quick filter
      if (quickFilter === "linkedin" && reply.channel !== "linkedin" && reply.channel !== "both") return false;
      if (quickFilter === "email" && reply.channel !== "email" && reply.channel !== "both") return false;
      if (quickFilter === "autopilot" && reply.sdr_autopilot !== 1) return false;
      if (
        quickFilter === "handoff" &&
        reply.reply_kind !== "human_reply" &&
        reply.reply_kind !== "human_handoff" &&
        reply.reply_kind !== "objection" &&
        reply.reply_kind !== "pricing"
      ) {
        return false;
      }

      // Search query
      const query = search.toLowerCase().trim();
      if (!query) return true;
      return [
        reply.full_name,
        reply.email,
        reply.company,
        reply.workflow_name,
        reply.linkedin_account_name,
        reply.linkedin_account_email,
        reply.email_account_name,
        reply.email_account_from,
        reply.linkedin_reply_body,
        reply.reply_body,
        reply.reply_summary,
      ].some((value) => (value ?? "").toLowerCase().includes(query));
    });
  }, [replies, quickFilter, search]);

  // Auto-select first conversation on initial load or if current selection is invalid
  useEffect(() => {
    if (filtered.length > 0 && !selectedReply) {
      setSelectedReply(filtered[0]);
    } else if (selectedReply && !filtered.some((r) => r.id === selectedReply.id)) {
      setSelectedReply(filtered[0] || null);
    }
  }, [filtered, selectedReply]);

  return (
    <>
      <Head>
        <title>{t("inbox.pageTitle")}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      {/* ── LinkedIn Diagnostic Report Modal ── */}
      {diagnosticReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-base-100 border border-base-300 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-fadeIn">
            <div className="flex items-center justify-between px-5 py-4 border-b border-base-300">
              <div className="flex items-center gap-2">
                <RiPulseLine className="text-warning text-lg" />
                <h3 className="font-semibold text-base">Diagnóstico en Vivo de Bandeja LinkedIn</h3>
              </div>
              <button
                onClick={() => setDiagnosticReport(null)}
                className="p-1 rounded-lg hover:bg-base-200 text-base-content/50 hover:text-base-content"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 bg-base-200/50 p-3.5 rounded-xl border border-base-300/40 text-xs">
                <div>
                  <span className="text-base-content/50">Cuenta:</span>{" "}
                  <span className="font-semibold">
                    {diagnosticReport.account?.name} ({diagnosticReport.account?.email})
                  </span>
                </div>
                <div>
                  <span className="text-base-content/50">Estado:</span>{" "}
                  <span className="font-semibold text-success">
                    {diagnosticReport.account?.is_authenticated ? "Conectado" : "Desconectado"}
                  </span>
                </div>
              </div>

              {diagnosticReport.browser?.screenshotBase64 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-base-content/70">Captura en Vivo:</span>
                  <div className="rounded-xl overflow-hidden border border-base-300 bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:image/png;base64,${diagnosticReport.browser.screenshotBase64}`}
                      alt="LinkedIn Live Screen"
                      className="w-full h-auto max-h-80 object-contain mx-auto"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-base-300 flex justify-end">
              <button
                onClick={() => setDiagnosticReport(null)}
                className="px-4 py-1.5 rounded-lg bg-base-200 hover:bg-base-300 text-xs font-semibold"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top Header Banner (Lead Finder Style) ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl mb-4 shrink-0">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              {t("inbox.title")}
            </h1>
            {!loading && filtered.length > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-600 dark:text-brand-400">
                {filtered.length} {filtered.length === 1 ? "conversación" : "conversaciones"}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("inbox.subtitle")}
          </p>
        </div>

        {/* Global Toolbar Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleToggleNotifications}
            title={
              notificationPermission === "granted"
                ? "Alertas activas: Haz clic para probar el timbre sonoro"
                : "Activar notificaciones de escritorio y sonido"
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs md:text-sm font-medium border transition-all shadow-xs ${
              notificationPermission === "granted"
                ? "bg-success/15 border-success/35 text-success hover:bg-success/25"
                : "text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
            }`}
          >
            <RiNotification3Line
              size={15}
              className={notificationPermission === "granted" ? "text-success" : ""}
            />
            {notificationPermission === "granted" ? "Alertas (Probar)" : "Activar Alertas"}
          </button>

          <button
            onClick={handleDiagnose}
            disabled={diagnosing}
            title="Diagnosticar sesión y ver captura real de LinkedIn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs md:text-sm font-medium bg-warning/10 border border-warning/30 text-warning hover:bg-warning/20 disabled:opacity-40 transition-all shadow-xs"
          >
            {diagnosing ? <RiLoader4Line size={14} className="animate-spin" /> : <RiPulseLine size={15} />}
            {diagnosing ? "Diagnosticando..." : "Diagnóstico"}
          </button>

          <button
            onClick={handleSyncLinkedIn}
            disabled={syncingLinkedIn}
            title="Sincronizar respuestas entrantes de LinkedIn ahora"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs disabled:opacity-40"
          >
            {syncingLinkedIn ? <RiLoader4Line size={14} className="animate-spin" /> : <RiLinkedinBoxLine size={15} />}
            {syncingLinkedIn ? "Sincronizando..." : "Sincronizar LinkedIn"}
          </button>

          <button
            onClick={handleBackfill}
            disabled={backfilling}
            title={t("inbox.backfillTitle")}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 disabled:opacity-40 transition-colors shadow-xs"
          >
            {backfilling ? <RiLoader4Line size={13} className="animate-spin" /> : <RiRefreshLine size={14} />}
            {backfilling ? t("inbox.backfilling") : "Recuperar"}
          </button>

          <button
            onClick={handleReclassifyAll}
            disabled={reclassifyingAll}
            title={t("inbox.reclassifyAllTitle")}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 disabled:opacity-40 transition-colors shadow-xs"
          >
            {reclassifyingAll ? <RiLoader4Line size={13} className="animate-spin" /> : null}
            {reclassifyingAll ? t("inbox.reclassifying") : t("inbox.reclassifyAll")}
          </button>
        </div>
      </div>

      {/* ── 2-COLUMN SPLIT VIEW CONTAINER (LinkedIn Style) ── */}
      <div className="flex-1 flex min-h-[640px] h-[calc(100vh-7.5rem)] bg-base-100 rounded-2xl border border-base-300/70 shadow-xl overflow-hidden">
        {/* ── LEFT COLUMN: Conversations List ── */}
        <div className="w-full sm:w-80 md:w-96 lg:w-[410px] shrink-0 flex flex-col border-r border-base-300/70 bg-base-100/70 select-none">
          {/* Top Search & Filter Bar */}
          <div className="p-3.5 border-b border-base-300/60 space-y-2.5 bg-base-100">
            {/* Search input */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40 pointer-events-none">
                <RiSearchLine size={14} />
              </span>
              <input
                type="text"
                className="w-full bg-base-200 border border-base-300/60 rounded-xl pl-9 pr-8 py-2 text-xs text-base-content placeholder:text-base-content/35 focus:outline-none focus:border-primary/50 focus:bg-base-100 transition-all shadow-inner"
                placeholder="Buscar prospecto o mensaje..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content p-0.5 rounded"
                >
                  <RiCloseLine size={14} />
                </button>
              )}
            </div>

            {/* Quick Filter Pills (LinkedIn Style) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
              {[
                { id: "all", label: "Todos", icon: null },
                { id: "linkedin", label: "LinkedIn", icon: RiLinkedinBoxLine },
                { id: "email", label: "Email", icon: RiMailLine },
                { id: "autopilot", label: "Autopilot", icon: RiRobotLine },
                { id: "handoff", label: "Intervención", icon: RiAlertLine },
              ].map((filter) => {
                const Icon = filter.icon;
                return (
                  <button
                    key={filter.id}
                    onClick={() => setQuickFilter(filter.id as QuickFilter)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all ${
                      quickFilter === filter.id
                        ? "bg-primary text-primary-content shadow-sm"
                        : "bg-base-200 text-base-content/60 hover:bg-base-300 hover:text-base-content"
                    }`}
                  >
                    {Icon && <Icon size={12} />}
                    <span>{filter.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Account Slot Selector if multiple exist */}
            {accounts.length > 1 && (
              <select
                aria-label="Filtrar por cuenta"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full h-7 bg-base-200 border border-base-300/50 rounded-lg px-2 text-[11px] font-medium text-base-content/70 focus:outline-none cursor-pointer"
              >
                <option value="">Todas las cuentas de LinkedIn</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.email})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Conversations Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-base-300/40">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-base-content/40 gap-2">
                <RiLoader4Line size={24} className="animate-spin text-primary" />
                <span className="text-xs font-medium">Cargando mensajes...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-base-content/40 px-6 text-center">
                <RiInboxLine size={36} className="opacity-30 mb-2" />
                <p className="text-xs font-semibold">No se encontraron conversaciones</p>
                <p className="text-[11px] text-base-content/30 mt-0.5">
                  {search ? "Prueba con otra búsqueda" : "Las respuestas se capturarán automáticamente."}
                </p>
              </div>
            ) : (
              filtered.map((reply) => {
                const isSelected = selectedReply?.id === reply.id;
                const vB = verdictBadge(reply, t);
                const snippet =
                  reply.linkedin_reply_body ||
                  reply.reply_body ||
                  reply.reply_summary ||
                  "Nuevo mensaje recibido";

                return (
                  <div
                    key={reply.id}
                    onClick={() => setSelectedReply(reply)}
                    className={`relative p-3.5 cursor-pointer transition-all flex items-start gap-3 hover:bg-base-200/60 ${
                      isSelected
                        ? "bg-primary/10 border-l-4 border-primary"
                        : "border-l-4 border-transparent"
                    }`}
                  >
                    {/* Avatar with status indicator */}
                    <div className="relative shrink-0 mt-0.5">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs border shadow-sm ${getAvatarColor(
                          reply.full_name
                        )}`}
                      >
                        {getInitials(reply.full_name ?? reply.email)}
                      </div>
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-success ring-2 ring-base-100" />
                    </div>

                    {/* Content Body */}
                    <div className="flex-1 min-w-0">
                      {/* Name & Time */}
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span
                          className={`text-xs truncate font-bold ${
                            isSelected ? "text-primary" : "text-base-content"
                          }`}
                        >
                          {reply.full_name ?? reply.email ?? t("inbox.unknown")}
                        </span>
                        <span className="text-[10px] text-base-content/40 shrink-0">
                          {timeAgo(reply.replied_at, locale, t)}
                        </span>
                      </div>

                      {/* Company / Headline */}
                      {reply.company && (
                        <p className="text-[11px] text-base-content/50 font-medium truncate mb-1">
                          {reply.company}
                        </p>
                      )}

                      {/* Snippet */}
                      <p className="text-xs text-base-content/70 line-clamp-2 leading-snug mb-1.5">
                        {snippet}
                      </p>

                      {/* Badges footer */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {reply.channel === "linkedin" || reply.channel === "both" ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary">
                            <RiLinkedinBoxLine size={11} /> LinkedIn
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-info/15 text-info">
                            <RiMailLine size={11} /> Email
                          </span>
                        )}

                        {reply.sdr_autopilot === 1 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-success/15 text-success">
                            <RiRobotLine size={10} /> Autopilot
                          </span>
                        )}

                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${vB.cls}`}>
                          {vB.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN: Selected Conversation Chat / Empty State ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-base-100/50">
          {selectedReply ? (
            <ChatPanel
              key={selectedReply.id}
              reply={selectedReply}
              onActionDone={load}
              hasPremium={true}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-base-200/10">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center text-primary mb-4 shadow-sm animate-bounce">
                <RiLinkedinBoxLine size={32} />
              </div>
              <h3 className="font-bold text-lg text-base-content mb-1">
                Tus Mensajes y Conversaciones
              </h3>
              <p className="text-xs text-base-content/50 max-w-sm">
                Selecciona un contacto de la lista a la izquierda para ver el historial completo, redactar
                respuestas o activar el SDR IA en piloto automático.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
