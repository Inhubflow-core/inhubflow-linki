import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  RiCloseLine,
  RiExternalLinkLine,
  RiInboxLine,
  RiLinkedinBoxLine,
  RiLoader4Line,
  RiMailLine,
  RiPulseLine,
  RiSearchLine,
  RiSendPlaneLine,
} from "react-icons/ri";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import type { Locale, TranslationParams } from "@/lib/i18n/types";
import type { InboxReply } from "./api/inbox/index";
import type { EmailMessage } from "./api/inbox/thread";

type Translate = (key: string, params?: TranslationParams) => string;

type ChannelFilter = "all" | "email" | "linkedin";

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

const DATE_LOCALES: Record<Locale, string> = {
  en: "en-US",
  es: "es-ES",
  "pt-BR": "pt-BR",
};

const CHANNELS: ChannelFilter[] = ["all", "email", "linkedin"];

const VERDICT_KEYS = [
  "all",
  "ooo_followup",
  "substitute",
  "call_task",
  "human_reply",
  "not_interested",
  "pending",
  "failed",
  "none",
] as const;

const VERDICT_CLASSES: Record<string, string> = {
  ooo_followup: "bg-warning/15 text-warning",
  substitute: "bg-secondary/15 text-secondary",
  call_task: "bg-success/15 text-success",
  human_reply: "bg-info/15 text-info",
  not_interested: "bg-error/15 text-error",
  cancelled: "bg-base-300/60 text-base-content/50",
  pending: "bg-base-300/60 text-base-content/50",
  failed: "bg-error/15 text-error",
  none: "bg-base-300/40 text-base-content/30",
};

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

function OriginBadges({ reply, t }: { reply: InboxReply; t: Translate }) {
  const hasLinkedIn = reply.channel === "linkedin" || reply.channel === "both";
  const hasEmail = reply.channel === "email" || reply.channel === "both";

  return (
    <div className="flex flex-col items-start gap-1">
      {hasLinkedIn && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary max-w-48"
          title={reply.linkedin_account_inferred ? t("inbox.originInferred") : reply.linkedin_account_email ?? undefined}
        >
          <RiLinkedinBoxLine size={11} className="shrink-0" />
          <span className="truncate">
            {reply.linkedin_account_name ?? reply.linkedin_account_email ?? t("inbox.unattributed")}
          </span>
        </span>
      )}
      {hasEmail && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-info/10 text-info max-w-48"
          title={reply.email_account_from ?? undefined}
        >
          <RiMailLine size={11} className="shrink-0" />
          <span className="truncate">
            {reply.email_account_name ?? reply.email_account_from ?? t("inbox.unattributed")}
          </span>
        </span>
      )}
    </div>
  );
}

interface ReplyModalProps {
  reply: InboxReply;
  onClose: () => void;
  onActionDone: () => void;
  hasPremium: boolean;
}

function ReplyModal({ reply, onClose, onActionDone, hasPremium }: ReplyModalProps) {
  const { t, locale } = useTranslation();
  const hasEmailReply = reply.channel === "email" || reply.channel === "both";
  const hasLinkedInReply = reply.channel === "linkedin" || reply.channel === "both";
  const canReplyByEmail = hasEmailReply && !!reply.email && !!reply.email_account_id;
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [linkedinMessages, setLinkedinMessages] = useState<LinkedInThreadMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(canReplyByEmail);
  const [loadingLinkedInThread, setLoadingLinkedInThread] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<"reclassify" | "cancel" | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const verdict = verdictBadge(reply, t);
  const dispatch = (() => {
    if (!reply.dispatch_result_json) return null;
    try { return JSON.parse(reply.dispatch_result_json) as Record<string, unknown>; } catch { return null; }
  })();
  const scheduledFor = dispatch?.scheduled_for as string | undefined;

  async function handleReclassify() {
    if (!reply.reply_id) return;
    setActing("reclassify");
    try {
      const response = await fetch(`/api/inbox/${reply.reply_id}/reclassify`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("inbox.errors.reclassify"));
      toast.success(t("inbox.toasts.reclassified"));
      onActionDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("inbox.errors.reclassify"));
    } finally {
      setActing(null);
    }
  }

  async function handleCancelFollowup() {
    if (!reply.reply_id) return;
    setActing("cancel");
    try {
      const response = await fetch(`/api/inbox/${reply.reply_id}/cancel-followup`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("inbox.errors.cancelFollowup"));
      toast.success(t("inbox.toasts.followupCancelled"));
      onActionDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("inbox.errors.cancelFollowup"));
    } finally {
      setActing(null);
    }
  }

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
      .finally(() => { if (!cancelled) setLoadingThread(false); });

    return () => { cancelled = true; };
  }, [canReplyByEmail, reply.id, reply.email_account_id, reply.email, t]);

  useEffect(() => {
    if (!hasLinkedInReply || !reply.linkedin_account_id || !reply.linkedin_thread_id) {
      setLoadingLinkedInThread(false);
      setLinkedinMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingLinkedInThread(true);
    const params = new URLSearchParams({
      targetId: reply.id,
      accountId: reply.linkedin_account_id,
      threadId: reply.linkedin_thread_id,
    });
    fetch(`/api/inbox/linkedin-thread?${params}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? t("inbox.errors.loadLinkedInThread"));
        return data as { messages?: LinkedInThreadMessage[] };
      })
      .then((data) => {
        if (!cancelled) setLinkedinMessages(data.messages ?? []);
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : t("inbox.errors.loadLinkedInThread"));
      })
      .finally(() => { if (!cancelled) setLoadingLinkedInThread(false); });

    return () => { cancelled = true; };
  }, [hasLinkedInReply, reply.id, reply.linkedin_account_id, reply.linkedin_thread_id, t]);
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, linkedinMessages]);

  async function handleSend() {
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("inbox.errors.send"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[85vh] flex flex-col bg-base-100 border border-base-300/50 rounded-xl shadow-2xl mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-300/50">
          <div className="min-w-0">
            <div className="font-semibold text-base-content truncate">
              {reply.full_name ?? reply.email ?? t("inbox.unknown")}
            </div>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <OriginBadges reply={reply} t={t} />
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("inbox.close")}
            className="text-base-content/40 hover:text-base-content transition-colors p-1"
          >
            <RiCloseLine size={18} />
          </button>
        </div>

        {reply.reply_id && (
          <div className="px-5 py-3.5 border-b border-base-300/50 bg-base-200/40 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${verdict.cls}`}>
                {verdict.label}
              </span>
              {reply.manually_edited === 1 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300/60 text-base-content/50">
                  {t("inbox.edited")}
                </span>
              )}
              {reply.reply_summary && <span className="text-xs text-base-content/60">{reply.reply_summary}</span>}
            </div>

            {reply.classification_error && (
              <div className="text-xs text-error/80">
                {t("inbox.classifierError", { error: reply.classification_error })}
              </div>
            )}

            {dispatch && (
              <div className="text-xs text-base-content/45 space-y-0.5">
                {scheduledFor && (
                  <div>{t("inbox.followupScheduled", { date: formatDate(scheduledFor, locale) })}</div>
                )}
                {dispatch.substitute_target_id ? <div>{t("inbox.substituteEnrolled")}</div> : null}
                {dispatch.todo_id ? (
                  <div>
                    {t("inbox.callTaskCreated")}
                    {dispatch.phone_number ? ` · ${dispatch.phone_number}` : ""}
                  </div>
                ) : null}
              </div>
            )}

            <div className="flex items-center gap-2 pt-0.5">
              {hasPremium && (
                <button
                  onClick={handleReclassify}
                  disabled={acting !== null}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-base-300/50 text-base-content/70 hover:bg-base-300 disabled:opacity-40 transition-colors"
                >
                  {acting === "reclassify" ? <RiLoader4Line size={12} className="animate-spin" /> : null}
                  {t("inbox.reclassify")}
                </button>
              )}
              {scheduledFor && (
                <button
                  onClick={handleCancelFollowup}
                  disabled={acting !== null}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-error/10 text-error hover:bg-error/20 disabled:opacity-40 transition-colors"
                >
                  {acting === "cancel" ? <RiLoader4Line size={12} className="animate-spin" /> : null}
                  {t("inbox.cancelFollowup")}
                </button>
              )}
            </div>
          </div>
        )}

        {hasLinkedInReply && reply.linkedin_url && (
          <div className="px-5 py-3 border-b border-base-300/50 bg-primary/5 flex items-center justify-between gap-3">
            <div className="text-xs text-base-content/55">{t("inbox.linkedinReplyDetected")}</div>
            <a
              href={reply.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
            >
              <RiExternalLinkLine size={12} /> {t("inbox.openInLinkedin")}
            </a>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
        {hasLinkedInReply && (
          <div className="px-5 py-4 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-base-content/45">
              {t("inbox.linkedinConversation")}
            </div>
            {loadingLinkedInThread ? (
              <div className="flex items-center justify-center gap-2 text-base-content/30 py-8">
                <RiLoader4Line size={18} className="animate-spin" />
                <span className="text-sm">{t("inbox.linkedinConversationLoading")}</span>
              </div>
            ) : linkedinMessages.length === 0 ? (
              reply.linkedin_reply_body ? (
                <div className="rounded-lg p-3.5 bg-base-200 border border-base-300/40">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-base-content/60">{reply.full_name ?? t("inbox.unknown")}</span>
                    {reply.linkedin_reply_received_at && (
                      <span className="text-xs text-base-content/30">{formatDate(reply.linkedin_reply_received_at, locale)}</span>
                    )}
                  </div>
                  <p className="text-sm text-base-content whitespace-pre-wrap leading-relaxed">{reply.linkedin_reply_body}</p>
                </div>
              ) : (
                <p className="text-center text-base-content/30 text-sm py-8">{t("inbox.linkedinNotCaptured")}</p>
              )
            ) : (
              linkedinMessages.map((message) => {
                const isInbound = message.direction === "inbound";
                return (
                  <div
                    key={`${message.externalThreadId}-${message.externalMessageId}`}
                    className={`rounded-lg p-3.5 ${
                      isInbound ? "bg-base-200 border border-base-300/40" : "bg-primary/8 border border-primary/20"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <span className="text-xs font-medium text-base-content/60">
                        {isInbound ? (message.senderName ?? reply.full_name ?? t("inbox.unknown")) : t("inbox.linkedinOutbound")}
                      </span>
                      <span className="text-xs text-base-content/30 whitespace-nowrap">{formatDate(message.sentAt, locale)}</span>
                    </div>
                    <p className="text-sm text-base-content whitespace-pre-wrap leading-relaxed">{message.body}</p>
                  </div>
                );
              })
            )}
          </div>
        )}

        {hasEmailReply && (
          <div className="px-5 py-4 space-y-4 border-t border-base-300/40">
            {loadingThread ? (
              <div className="flex items-center justify-center gap-2 text-base-content/30 py-10">
                <RiLoader4Line size={18} className="animate-spin" />
                <span className="text-sm">{t("inbox.loadingThread")}</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center text-base-content/30 text-sm py-10">
                {canReplyByEmail ? t("inbox.noMessages") : t("inbox.noEmailAccount")}
              </div>
            ) : (
              messages.map((message, index) => {
                const isFromContact = message.from.toLowerCase().includes((reply.email ?? "").toLowerCase());
                return (
                  <div
                    key={`${message.uid}-${index}`}
                    className={`rounded-lg p-3.5 ${
                      isFromContact
                        ? "bg-base-200 border border-base-300/40"
                        : "bg-primary/8 border border-primary/20"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-base-content/60">{message.from}</span>
                      <span className="text-xs text-base-content/30">{formatDate(message.date, locale)}</span>
                    </div>
                    <p className="text-sm text-base-content whitespace-pre-wrap leading-relaxed">
                      {message.text || t("inbox.noTextContent")}
                    </p>
                  </div>
                );
              })
            )}
            <div ref={threadEndRef} />
          </div>
        )}
        </div>

        {canReplyByEmail && (
          <div className="border-t border-base-300/50 px-5 py-4 space-y-2.5">
            <input
              type="text"
              value={replySubject}
              onChange={(event) => setReplySubject(event.target.value)}
              placeholder={t("inbox.subject")}
              className="w-full bg-base-200 border border-base-300/50 rounded-lg px-3 py-1.5 text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/40"
            />
            <textarea
              value={replyText}
              onChange={(event) => setReplyText(event.target.value)}
              placeholder={t("inbox.replyTo", { name: reply.full_name ?? reply.email ?? t("inbox.unknown") })}
              rows={4}
              className="w-full bg-base-200 border border-base-300/50 rounded-lg px-3 py-2 text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/40 resize-none"
            />
            <div className="flex justify-end">
              <button
                onClick={handleSend}
                disabled={!replyText.trim() || !replySubject.trim() || sending}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? <RiLoader4Line size={14} className="animate-spin" /> : <RiSendPlaneLine size={14} />}
                {sending ? t("inbox.sending") : t("inbox.send")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  const { t, locale } = useTranslation();
  const [replies, setReplies] = useState<InboxReply[]>([]);
  const [accounts, setAccounts] = useState<LinkedInAccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [accountId, setAccountId] = useState("");
  const [verdict, setVerdict] = useState<string>("all");
  const [selectedReply, setSelectedReply] = useState<InboxReply | null>(null);
  const [reclassifyingAll, setReclassifyingAll] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [hasPremium, setHasPremium] = useState(false);

  useEffect(() => {
    fetch("/api/premium-status")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setHasPremium(!!data.hasPremium); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/accounts")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? t("inbox.errors.loadAccounts"));
        return data;
      })
      .then((data) => { if (!cancelled) setAccounts(Array.isArray(data) ? data : []); })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : t("inbox.errors.loadAccounts"));
      });
    return () => { cancelled = true; };
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
      setReplies(data.replies ?? []);
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
      if (!response.ok) throw new Error(data.error ?? t("inbox.errors.reclassify"));
      toast.success(
        data.total === 0
          ? t("inbox.toasts.nothingToReclassify")
          : t("inbox.toasts.reclassifiedCount", {
              classified: data.classified,
              total: data.total,
              failed: data.failed ? ` (${data.failed} ${t("inbox.verdicts.failed").toLowerCase()})` : "",
            })
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("inbox.errors.reclassify"));
    } finally {
      setReclassifyingAll(false);
    }
  }

  const [syncingLinkedIn, setSyncingLinkedIn] = useState(false);

  async function handleSyncLinkedIn() {
    const authAccounts = accounts.filter((a) => a.is_authenticated === 1);
    if (authAccounts.length === 0) {
      toast.error("No hay cuentas de LinkedIn autenticadas para sincronizar.");
      return;
    }

    setSyncingLinkedIn(true);
    let totalCaptured = 0;
    try {
      for (const acc of authAccounts) {
        const res = await fetch(`/api/accounts/${acc.id}/sync-linkedin-inbox`, { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          totalCaptured += data.captured ?? 0;
        }
      }
      toast.success(
        totalCaptured > 0
          ? `Sincronización completada: ${totalCaptured} nueva(s) respuesta(s) capturada(s).`
          : "Sincronización completada. Bandeja al día."
      );
      await load();
    } catch (err: any) {
      toast.error(err.message || "Error al sincronizar LinkedIn");
    } finally {
      setSyncingLinkedIn(false);
    }
  }

  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<any | null>(null);

  async function handleDiagnose() {
    const authAccounts = accounts.filter((a) => a.is_authenticated === 1);
    if (authAccounts.length === 0) {
      toast.error("No hay cuentas de LinkedIn autenticadas para diagnosticar.");
      return;
    }

    setDiagnosing(true);
    try {
      const targetAcc = authAccounts[0];
      const res = await fetch(`/api/accounts/${targetAcc.id}/diagnose-inbox-live`);
      const data = await res.json();
      setDiagnosticReport(data);
      if (res.ok) {
        toast.success("Diagnóstico en vivo completado con éxito.");
      } else {
        toast.error(data.error || "Error en diagnóstico");
      }
    } catch (err: any) {
      toast.error(err.message || "Error al ejecutar diagnóstico");
    } finally {
      setDiagnosing(false);
    }
  }

  const filtered = replies.filter((reply) => {
    if (verdict !== "all" && verdictKey(reply) !== verdict) return false;
    if (!search) return true;
    const query = search.toLowerCase();
    return [
      reply.full_name,
      reply.email,
      reply.company,
      reply.workflow_name,
      reply.linkedin_account_name,
      reply.linkedin_account_email,
      reply.email_account_name,
      reply.email_account_from,
    ].some((value) => (value ?? "").toLowerCase().includes(query));
  });

  return (
    <>
      <Head>
        <title>{t("inbox.pageTitle")}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      {diagnosticReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-base-100 border border-base-300 rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
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
              <div className="grid grid-cols-2 gap-3 bg-base-200/50 p-3.5 rounded-lg border border-base-300/40 text-xs">
                <div>
                  <span className="text-base-content/50">Cuenta:</span>{" "}
                  <span className="font-semibold">{diagnosticReport.account?.name} ({diagnosticReport.account?.email})</span>
                </div>
                <div>
                  <span className="text-base-content/50">Estado Autenticación:</span>{" "}
                  <span className="font-semibold text-success">{diagnosticReport.account?.is_authenticated ? "Conectado" : "Desconectado"}</span>
                </div>
                <div>
                  <span className="text-base-content/50">URL Actual Navegador:</span>{" "}
                  <span className="font-mono">{diagnosticReport.browser?.currentUrl || "N/A"}</span>
                </div>
                <div>
                  <span className="text-base-content/50">Muro de Login/AuthWall:</span>{" "}
                  <span className={diagnosticReport.browser?.isAuthWall ? "text-error font-bold" : "text-success font-semibold"}>
                    {diagnosticReport.browser?.isAuthWall ? "SÍ (Requiere Re-login)" : "NO (Sesión Válida)"}
                  </span>
                </div>
                <div>
                  <span className="text-base-content/50">Chats Detectados en DOM:</span>{" "}
                  <span className="font-bold text-primary">{diagnosticReport.browser?.dom?.conversationsFoundInDom ?? 0}</span>
                </div>
                <div>
                  <span className="text-base-content/50">Prospectos Enrolados en DB:</span>{" "}
                  <span className="font-semibold">{diagnosticReport.database?.campaignTargetCount ?? 0}</span>
                </div>
              </div>

              {diagnosticReport.browser?.screenshot && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-base-content/70">Captura de Pantalla Real de LinkedIn:</span>
                  <div className="rounded-lg overflow-hidden border border-base-300 bg-black/40">
                    <img
                      src={diagnosticReport.browser.screenshot}
                      alt="LinkedIn Live Screen"
                      className="w-full h-auto max-h-80 object-contain mx-auto"
                    />
                  </div>
                </div>
              )}

              {diagnosticReport.browser?.dom?.conversations?.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-base-content/70">Conversaciones Visibles en el Chat:</span>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {diagnosticReport.browser.dom.conversations.map((c: any, i: number) => (
                      <div key={i} className="p-2.5 bg-base-200/60 rounded-lg text-xs border border-base-300/30 flex justify-between items-center">
                        <div>
                          <span className="font-semibold text-base-content">{c.name || "Sin nombre"}</span>
                          <span className="text-base-content/50 ml-2">({c.profileUrl || "Sin enlace"})</span>
                          <p className="text-base-content/70 mt-0.5">{c.lastMessage || "Sin snippet"}</p>
                        </div>
                        <span className="text-base-content/40 shrink-0">{c.timeText}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-base-content/70">Reporte JSON Completo:</span>
                <pre className="p-3 bg-base-300/40 rounded-lg text-xs font-mono overflow-x-auto max-h-40">
                  {JSON.stringify(diagnosticReport, null, 2)}
                </pre>
              </div>
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

      {selectedReply && (
        <ReplyModal
          reply={selectedReply}
          onClose={() => setSelectedReply(null)}
          onActionDone={load}
          hasPremium={hasPremium}
        />
      )}

      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold">{t("inbox.title")}</h1>
            {!loading && filtered.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-success/15 text-success">
                {t(filtered.length === 1 ? "inbox.replyCount" : "inbox.replyCountPlural", { count: filtered.length })}
              </span>
            )}
          </div>
          <p className="text-base-content/40 text-sm mt-0.5">{t("inbox.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDiagnose}
            disabled={diagnosing}
            title="Diagnosticar sesión y ver captura real de LinkedIn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-warning/10 border border-warning/30 text-warning hover:bg-warning/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
          >
            {diagnosing ? <RiLoader4Line size={13} className="animate-spin" /> : <RiPulseLine size={14} />}
            {diagnosing ? "Diagnosticando..." : "🔍 Diagnóstico en Vivo"}
          </button>
          <button
            onClick={handleSyncLinkedIn}
            disabled={syncingLinkedIn}
            title="Sincronizar respuestas entrantes de LinkedIn ahora"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 border border-primary/25 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
          >
            {syncingLinkedIn ? <RiLoader4Line size={13} className="animate-spin" /> : <RiLinkedinBoxLine size={14} />}
            {syncingLinkedIn ? "Sincronizando..." : "Sincronizar LinkedIn"}
          </button>
          {hasPremium ? (
            <>
              <button
                onClick={handleBackfill}
                disabled={backfilling}
                title={t("inbox.backfillTitle")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-base-200 border border-base-300/50 text-base-content/70 hover:bg-base-300/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {backfilling ? <RiLoader4Line size={13} className="animate-spin" /> : null}
                {backfilling ? t("inbox.backfilling") : t("inbox.backfill")}
              </button>
              <button
                onClick={handleReclassifyAll}
                disabled={reclassifyingAll}
                title={t("inbox.reclassifyAllTitle")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-base-200 border border-base-300/50 text-base-content/70 hover:bg-base-300/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {reclassifyingAll ? <RiLoader4Line size={13} className="animate-spin" /> : null}
                {reclassifyingAll ? t("inbox.reclassifying") : t("inbox.reclassifyAll")}
              </button>
            </>
          ) : (
            <a
              href="https://opsily.com?utm_source=linki&utm_medium=app&utm_campaign=reply-ai"
              target="_blank"
              rel="noopener noreferrer"
              title={t("inbox.upgradeTitle")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors"
            >
              {t("inbox.upgrade")}
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/30 pointer-events-none">
            <RiSearchLine size={13} />
          </span>
          <input
            type="text"
            className="w-56 bg-base-200 border border-base-300/50 rounded-lg pl-8 pr-3 py-1.5 text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/40"
            placeholder={t("inbox.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <select
          aria-label={t("inbox.slotFilter")}
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          className="h-8 min-w-48 bg-base-200 border border-base-300/50 rounded-lg px-2.5 text-xs font-medium text-base-content/70 focus:outline-none focus:border-primary/40 cursor-pointer"
        >
          <option value="">{t("inbox.allSlots")}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} · {account.email}{account.is_authenticated ? "" : ` · ${t("inbox.disconnected")}`}
            </option>
          ))}
        </select>

        <div className="w-px h-4 bg-base-300/60" />

        <div className="flex items-center gap-1">
          {CHANNELS.map((item) => (
            <button
              key={item}
              onClick={() => setChannel(item)}
              className={`h-7 px-3 rounded-lg text-xs font-medium transition-colors ${
                channel === item
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-base-content/50 hover:text-base-content hover:bg-base-300/50"
              }`}
            >
              {t(`inbox.channels.${item}`)}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-base-300/60" />

        <select
          aria-label={t("inbox.verdictFilter")}
          value={verdict}
          onChange={(event) => setVerdict(event.target.value)}
          className="h-7 bg-base-200 border border-base-300/50 rounded-lg px-2.5 text-xs font-medium text-base-content/70 focus:outline-none focus:border-primary/40 cursor-pointer"
        >
          {VERDICT_KEYS.map((key) => (
            <option key={key} value={key}>{t(`inbox.verdictFilters.${key}`)}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 text-base-content/30 py-24">
          <span className="loading loading-spinner loading-md" />
          <span className="text-sm">{t("inbox.loadingReplies")}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 text-base-content/30 py-24">
          <RiInboxLine size={36} className="opacity-30" />
          <div className="text-center">
            <p className="text-sm font-medium">
              {search ? t("inbox.noSearchMatches") : t("inbox.noReplies")}
            </p>
            {!search && <p className="text-xs mt-1 text-base-content/25">{t("inbox.detectedAutomatically")}</p>}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-base-300/50 overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-base-300/50 bg-base-200/60">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-base-content/40">{t("inbox.columns.contact")}</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-base-content/40">{t("inbox.columns.channel")}</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-base-content/40">{t("inbox.columns.verdict")}</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-base-content/40">{t("inbox.columns.origin")}</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-base-content/40">{t("inbox.columns.campaign")}</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-base-content/40">{t("inbox.columns.replied")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((reply) => (
                <tr
                  key={reply.id}
                  className="border-b border-base-300/30 hover:bg-base-200/40 transition-colors cursor-pointer"
                  onClick={() => setSelectedReply(reply)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-base-content">
                            {reply.full_name ?? reply.email ?? reply.linkedin_url ?? t("inbox.unknown")}
                          </span>
                          {reply.linkedin_url && (
                            <a
                              href={reply.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={t("inbox.openInLinkedin")}
                              className="text-base-content/25 hover:text-primary transition-colors"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <RiExternalLinkLine size={12} />
                            </a>
                          )}
                        </div>
                        <div className="text-xs text-base-content/40 mt-0.5">
                          {reply.company ?? reply.email ?? ""}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {(reply.channel === "email" || reply.channel === "both") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-info/15 text-info">
                          <RiMailLine size={11} /> {t("inbox.channels.email")}
                        </span>
                      )}
                      {(reply.channel === "linkedin" || reply.channel === "both") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/15 text-primary">
                          <RiLinkedinBoxLine size={11} /> LinkedIn
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    {(() => {
                      const badge = verdictBadge(reply, t);
                      return (
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                          {reply.reply_summary && (
                            <span className="text-xs text-base-content/35 truncate max-w-[16rem]" title={reply.reply_summary}>
                              {reply.reply_summary}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>

                  <td className="px-4 py-3"><OriginBadges reply={reply} t={t} /></td>

                  <td className="px-4 py-3">
                    {reply.workflow_id ? (
                      <Link
                        href={`/workflows/${reply.workflow_id}`}
                        className="text-xs text-base-content/60 hover:text-base-content transition-colors"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {reply.workflow_name ?? reply.workflow_id}
                      </Link>
                    ) : (
                      <span className="text-xs text-base-content/25">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-base-content/40">{timeAgo(reply.replied_at, locale, t)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
