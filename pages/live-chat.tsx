import Head from "next/head";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import {
  RiCustomerService2Line,
  RiSendPlaneFill,
  RiArrowLeftLine,
  RiRefreshLine,
  RiFireFill,
  RiRobotLine,
  RiUser3Line,
  RiShieldCheckLine,
  RiCheckboxCircleLine,
  RiStopCircleLine,
  RiPlayCircleLine,
  RiNotification3Line,
} from "react-icons/ri";
import { toast } from "sonner";

interface ChatSession {
  id: string;
  visitor_name?: string;
  visitor_email?: string;
  company_name?: string;
  language: string;
  status: "ai_active" | "human_takeover" | "resolved" | "closed";
  needs_human: number;
  total_messages: number;
  last_message?: string;
  last_sender_type?: string;
  last_message_at?: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  session_id: string;
  sender_type: "visitor" | "ai" | "human_agent";
  sender_name?: string;
  message: string;
  created_at: string;
}

export default function LiveChatMobileAdmin() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check URL query param for deep link
  useEffect(() => {
    if (router.query.session && typeof router.query.session === "string") {
      setSelectedSessionId(router.query.session);
    }
  }, [router.query]);

  // Request browser notification permission
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        setNotificationsEnabled(true);
      }
    }
  }, []);

  const requestNotificationPerms = async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setNotificationsEnabled(true);
        toast.success("Notificaciones activadas en este dispositivo");
      }
    }
  };

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/live-chat/admin");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error("Error al cargar chats:", err);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/live-chat/admin?sessionId=${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentSession(data.session);
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Error al cargar mensajes:", err);
    }
  }, []);

  // Initial load and polling
  useEffect(() => {
    if (authStatus === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (authStatus === "authenticated") {
      loadSessions();
      const interval = setInterval(loadSessions, 4000);
      return () => clearInterval(interval);
    }
  }, [authStatus, loadSessions, router]);

  // Poll conversation when selected
  useEffect(() => {
    if (selectedSessionId) {
      loadMessages(selectedSessionId);
      const msgInterval = setInterval(() => {
        loadMessages(selectedSessionId);
      }, 3000);
      return () => clearInterval(msgInterval);
    }
  }, [selectedSessionId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSelectChat = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setLoadingDetail(true);
    loadMessages(sessionId).finally(() => setLoadingDetail(false));
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedSessionId || sending) return;

    setSending(true);
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          sessionId: selectedSessionId,
          message: replyText.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
        setReplyText("");
        if (currentSession) {
          setCurrentSession({ ...currentSession, status: "human_takeover", needs_human: 0 });
        }
        loadSessions();
      } else {
        toast.error("Error al enviar el mensaje");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setSending(false);
    }
  };

  const handleTakeover = async () => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "takeover", sessionId: selectedSessionId }),
      });
      if (res.ok) {
        toast.success("Has tomado el control. La IA está en pausa.");
        if (currentSession) {
          setCurrentSession({ ...currentSession, status: "human_takeover", needs_human: 0 });
        }
        loadSessions();
      }
    } catch {
      toast.error("Error al pausar la IA");
    }
  };

  const handleResumeAi = async () => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume_ai", sessionId: selectedSessionId }),
      });
      if (res.ok) {
        toast.success("IA reactivada para este chat");
        if (currentSession) {
          setCurrentSession({ ...currentSession, status: "ai_active" });
        }
        loadSessions();
      }
    } catch {
      toast.error("Error al reactivar IA");
    }
  };

  const handleResolve = async () => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", sessionId: selectedSessionId }),
      });
      if (res.ok) {
        toast.success("Chat marcado como resuelto");
        if (currentSession) {
          setCurrentSession({ ...currentSession, status: "resolved" });
        }
        loadSessions();
      }
    } catch {
      toast.error("Error al resolver chat");
    }
  };

  return (
    <>
      <Head>
        <title>InHubFlow Live Chat | PWA</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#4f46e5" />
      </Head>

      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col font-sans">
        {/* Top App Bar */}
        <header className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedSessionId ? (
              <button
                onClick={() => {
                  setSelectedSessionId(null);
                  setCurrentSession(null);
                }}
                className="p-1.5 -ml-1 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg cursor-pointer"
              >
                <RiArrowLeftLine size={22} />
              </button>
            ) : (
              <div className="p-2 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
                <RiCustomerService2Line size={20} />
              </div>
            )}
            <div>
              <h1 className="text-base font-bold text-gray-900 dark:text-white leading-tight">
                {selectedSessionId && currentSession
                  ? currentSession.visitor_name || currentSession.visitor_email || "Prospecto Web"
                  : "InHubFlow Live"}
              </h1>
              <span className="text-[11px] text-gray-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {selectedSessionId && currentSession
                  ? currentSession.status === "human_takeover"
                    ? "Control manual (Tú)"
                    : "IA SDR respondiendo"
                  : `${sessions.length} chats activos`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!notificationsEnabled && (
              <button
                onClick={requestNotificationPerms}
                title="Activar notificaciones en tu móvil"
                className="p-2 rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400 text-xs font-semibold flex items-center gap-1"
              >
                <RiNotification3Line size={16} />
                <span className="hidden sm:inline">Activar Alertas</span>
              </button>
            )}
            <button
              onClick={loadSessions}
              className="p-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
            >
              <RiRefreshLine size={18} />
            </button>
          </div>
        </header>

        {/* Main Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* List of Chats (Visible on mobile when no chat is open, or on left side on desktop) */}
          <div
            className={`w-full md:w-80 md:border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto ${
              selectedSessionId ? "hidden md:block" : "block"
            }`}
          >
            {loadingList ? (
              <div className="p-8 text-center text-xs text-gray-400">
                Cargando conversaciones...
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <RiCustomerService2Line className="mx-auto text-gray-300 dark:text-gray-600" size={40} />
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  No hay chats activos en este momento
                </p>
                <p className="text-xs text-gray-400">
                  Cuando un visitante en inhubflow.online abra el chat, aparecerá aquí al instante.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {sessions.map((s) => {
                  const isSelected = selectedSessionId === s.id;
                  const isHot = s.needs_human === 1;
                  return (
                    <div
                      key={s.id}
                      onClick={() => handleSelectChat(s.id)}
                      className={`p-4 cursor-pointer transition flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/60 ${
                        isSelected ? "bg-brand-50/60 dark:bg-brand-950/20" : ""
                      } ${isHot ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}
                    >
                      <div
                        className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center font-bold text-xs ${
                          isHot
                            ? "bg-red-500 text-white animate-pulse"
                            : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                        }`}
                      >
                        {isHot ? <RiFireFill size={18} /> : <RiUser3Line size={18} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="font-bold text-xs text-gray-900 dark:text-white truncate">
                            {s.visitor_name || s.visitor_email || "Prospecto"}
                          </span>
                          <span className="text-[10px] text-gray-400 shrink-0 font-mono">
                            {new Date(s.updated_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>

                        {s.company_name && (
                          <div className="text-[11px] text-brand-600 dark:text-brand-400 font-semibold mb-0.5 truncate">
                            🏢 {s.company_name}
                          </div>
                        )}

                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {s.last_message || "Nueva conversación"}
                        </p>

                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          {isHot && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                              🔥 REQUIERE ATENCIÓN
                            </span>
                          )}
                          {s.status === "human_takeover" && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                              Control Manual
                            </span>
                          )}
                          {s.status === "ai_active" && !isHot && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                              IA Activa
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Conversation Detail Area */}
          {selectedSessionId ? (
            <div className="flex-1 flex flex-col bg-gray-50/50 dark:bg-gray-950">
              {/* Quick Actions Header */}
              {currentSession && (
                <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-2.5 px-4 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    {currentSession.status === "human_takeover" ? (
                      <button
                        onClick={handleResumeAi}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold cursor-pointer hover:bg-gray-200"
                      >
                        <RiPlayCircleLine size={15} />
                        <span>Reanudar Bot IA</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleTakeover}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer shadow-xs"
                      >
                        <RiStopCircleLine size={15} />
                        <span>Tomar Control (Pausar Bot)</span>
                      </button>
                    )}

                    <button
                      onClick={handleResolve}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 font-semibold cursor-pointer border border-emerald-200 dark:border-emerald-800"
                    >
                      <RiCheckboxCircleLine size={15} />
                      <span>Resolver</span>
                    </button>
                  </div>

                  <div className="text-[11px] text-gray-400">
                    {currentSession.visitor_email ? `Email: ${currentSession.visitor_email}` : "Anónimo"}
                  </div>
                </div>
              )}

              {/* Messages Timeline */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingDetail ? (
                  <div className="py-12 text-center text-xs text-gray-400">
                    Cargando conversación...
                  </div>
                ) : (
                  messages.map((m) => {
                    const isVisitor = m.sender_type === "visitor";
                    const isAi = m.sender_type === "ai";
                    const isHuman = m.sender_type === "human_agent";

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isVisitor ? "items-start" : "items-end"}`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-md p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-xs ${
                            isVisitor
                              ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 rounded-tl-xs"
                              : isHuman
                              ? "bg-brand-600 text-white rounded-tr-xs"
                              : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800/80 rounded-tr-xs"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-1 opacity-80 text-[10px] font-bold">
                            {isVisitor ? (
                              <span className="flex items-center gap-1">
                                <RiUser3Line size={11} /> {m.sender_name || "Visitante"}
                              </span>
                            ) : isHuman ? (
                              <span className="flex items-center gap-1 text-white">
                                <RiShieldCheckLine size={11} /> Roberto (Tú)
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-indigo-700 dark:text-indigo-400">
                                <RiRobotLine size={11} /> Asistente IA InHubFlow
                              </span>
                            )}
                          </div>
                          <div className="whitespace-pre-wrap">{m.message}</div>
                          <div className="text-[9px] opacity-60 text-right mt-1 font-mono">
                            {new Date(m.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Bar */}
              <form
                onSubmit={handleSendReply}
                className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 p-2.5 px-4 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Escribe como Roberto..."
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="submit"
                  disabled={sending || !replyText.trim()}
                  className="p-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold transition shadow-xs cursor-pointer shrink-0"
                >
                  <RiSendPlaneFill size={18} />
                </button>
              </form>
            </div>
          ) : (
            <div className="hidden md:flex flex-1 items-center justify-center text-center p-8 text-gray-400">
              <div>
                <RiCustomerService2Line size={48} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm font-semibold">Selecciona una conversación para responder</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
