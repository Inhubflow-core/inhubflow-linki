import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  RiCustomerService2Line,
  RiAddLine,
  RiMessage3Line,
  RiRefreshLine,
  RiArrowLeftLine,
  RiSendPlaneFill,
  RiTimeLine,
  RiShieldCheckLine,
  RiCheckboxCircleLine,
  RiAlertLine,
  RiUser3Line,
} from "react-icons/ri";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface Ticket {
  id: string;
  ticket_number: number;
  user_email: string;
  user_name?: string;
  company_name?: string;
  subject: string;
  category: string;
  priority: string;
  status: "open" | "in_progress" | "waiting_client" | "resolved" | "closed";
  message_count?: number;
  created_at: string;
  updated_at: string;
  last_reply_at: string;
}

interface TicketMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_email: string;
  sender_role: "user" | "admin";
  sender_name?: string;
  message: string;
  created_at: string;
}

export default function SupportPage() {
  const { t, locale } = useTranslation();
  const { data: session } = useSession();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  // Selected Ticket View
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  // New Ticket Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [newPriority, setNewPriority] = useState("normal");
  const [newMessage, setNewMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/support/tickets");
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch (err) {
      console.error("Error al obtener tickets:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const loadTicketDetail = async (ticketId: string) => {
    setSelectedTicketId(ticketId);
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedTicket(data.ticket);
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Error al cargar detalle del ticket:", err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.trim() || !newMessage.trim()) {
      toast.error(t("support.messagePlaceholder") || "Completa todos los campos requeridos");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: newSubject.trim(),
          category: newCategory,
          priority: newPriority,
          message: newMessage.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(t("support.toastCreated") || "Ticket creado exitosamente");
        setIsModalOpen(false);
        setNewSubject("");
        setNewMessage("");
        setNewCategory("general");
        setNewPriority("normal");
        await fetchTickets();
        if (data.ticket?.id) {
          loadTicketDetail(data.ticket.id);
        }
      } else {
        const err = await res.json();
        toast.error(err.error || "No se pudo crear el ticket");
      }
    } catch (err) {
      toast.error("Error de conexión al enviar el ticket");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedTicketId) return;

    setSendingReply(true);
    try {
      const res = await fetch(`/api/support/tickets/${selectedTicketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyText.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
        setReplyText("");
        toast.success(t("support.toastReplied") || "Respuesta enviada");
        if (selectedTicket && data.newStatus) {
          setSelectedTicket({ ...selectedTicket, status: data.newStatus });
        }
        fetchTickets();
      } else {
        const err = await res.json();
        toast.error(err.error || "Error al enviar la respuesta");
      }
    } catch (err) {
      toast.error("Error de conexión al responder");
    } finally {
      setSendingReply(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {t("support.statusOpen") || "Abierto"}
          </span>
        );
      case "in_progress":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            {t("support.statusInProgress") || "En Proceso"}
          </span>
        );
      case "waiting_client":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            {t("support.statusWaitingClient") || "Esperando tu respuesta"}
          </span>
        );
      case "resolved":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400 border border-teal-200 dark:border-teal-800">
            <RiCheckboxCircleLine size={12} className="text-teal-600 dark:text-teal-400" />
            {t("support.statusResolved") || "Resuelto"}
          </span>
        );
      case "closed":
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
            {t("support.statusClosed") || "Cerrado"}
          </span>
        );
    }
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case "campaigns": return t("support.categoryCampaigns") || "Campañas y Secuencias";
      case "linkedin": return t("support.categoryLinkedin") || "Conexión de LinkedIn";
      case "email": return t("support.categoryEmail") || "Cuentas de Email";
      case "sdr_ai": return t("support.categorySdrAi") || "Asistente SDR con IA";
      case "billing": return t("support.categoryBilling") || "Facturación";
      case "bug": return t("support.categoryBug") || "Error Técnico";
      case "other": return t("support.categoryOther") || "Otro";
      default: return t("support.categoryGeneral") || "Consulta General";
    }
  };

  const getPriorityBadge = (prio: string) => {
    switch (prio) {
      case "urgent":
        return <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400">{t("support.priorityUrgent") || "Urgente"}</span>;
      case "high":
        return <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400">{t("support.priorityHigh") || "Alta"}</span>;
      case "low":
        return <span className="text-[11px] font-normal px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{t("support.priorityLow") || "Baja"}</span>;
      case "normal":
      default:
        return <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">{t("support.priorityNormal") || "Normal"}</span>;
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(locale === "en" ? "en-US" : locale === "pt-BR" ? "pt-BR" : "es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      <Head>
        <title>{t("support.title")} | InHubFlow</title>
      </Head>

      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Main Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
                <RiCustomerService2Line size={24} />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                  {t("support.title")}
                </h1>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("support.subtitle")}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                fetchTickets();
                if (selectedTicketId) loadTicketDetail(selectedTicketId);
              }}
              className="p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition shadow-xs"
              title="Refrescar"
            >
              <RiRefreshLine size={18} />
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs sm:text-sm font-semibold transition shadow-xs cursor-pointer"
            >
              <RiAddLine size={18} />
              <span>{t("support.newTicket")}</span>
            </button>
          </div>
        </div>

        {/* View Mode: Thread or List */}
        {selectedTicketId && selectedTicket ? (
          /* Ticket Detail & Conversation View */
          <div className="space-y-6">
            <button
              onClick={() => {
                setSelectedTicketId(null);
                setSelectedTicket(null);
                setMessages([]);
              }}
              className="inline-flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
            >
              <RiArrowLeftLine size={16} />
              <span>{t("support.backToList")}</span>
            </button>

            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 p-6 shadow-xs">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-gray-200 dark:border-gray-800">
                <div>
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-md font-mono text-xs font-bold bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                      #TCK-{selectedTicket.ticket_number}
                    </span>
                    {getStatusBadge(selectedTicket.status)}
                    <span className="text-xs px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-gray-300 dark:border-gray-700 font-medium">
                      {getCategoryLabel(selectedTicket.category)}
                    </span>
                    {getPriorityBadge(selectedTicket.priority)}
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                    {selectedTicket.subject}
                  </h2>
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <RiTimeLine size={14} />
                  <span>{formatDate(selectedTicket.created_at)}</span>
                </div>
              </div>

              {/* Messages Timeline */}
              <div className="py-6 space-y-6">
                {loadingMessages ? (
                  <div className="py-12 text-center text-sm text-gray-500">
                    Cargando conversación...
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isAdmin = msg.sender_role === "admin";
                    return (
                      <div
                        key={msg.id}
                        className={`p-5 rounded-2xl border transition shadow-xs ${
                          isAdmin
                            ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-300 dark:border-indigo-800"
                            : "bg-white dark:bg-gray-800/80 border-gray-300 dark:border-gray-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                isAdmin
                                  ? "bg-indigo-600 text-white"
                                  : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                              }`}
                            >
                              {isAdmin ? <RiShieldCheckLine size={14} /> : <RiUser3Line size={14} />}
                            </div>
                            <div>
                              <span className="text-xs font-bold text-gray-900 dark:text-white block">
                                {isAdmin ? t("support.officialSupport") : msg.sender_name || t("support.client")}
                              </span>
                              {isAdmin && (
                                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold uppercase tracking-wider">
                                  InHubFlow Staff
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-[11px] text-gray-400">
                            {formatDate(msg.created_at)}
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                          {msg.message}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Reply Form */}
              {selectedTicket.status !== "closed" ? (
                <form onSubmit={handleSendReply} className="pt-6 border-t border-gray-200 dark:border-gray-800">
                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                      {t("support.replyPlaceholder")}
                    </label>
                    <textarea
                      rows={4}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={t("support.replyPlaceholder")}
                      className="w-full p-3.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 transition shadow-xs"
                    />
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={sendingReply || !replyText.trim()}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm transition cursor-pointer shadow-xs"
                      >
                        <RiSendPlaneFill size={15} />
                        <span>{sendingReply ? t("support.sendingReply") : t("support.sendReply")}</span>
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800 text-center text-xs text-gray-500 border border-gray-200 dark:border-gray-800">
                  Este ticket ha sido cerrado. Si tienes una nueva incidencia, por favor abre un nuevo ticket de soporte.
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Tickets Table / List View */
          <div className="space-y-6">
            {loading ? (
              <div className="p-12 text-center text-sm text-gray-500 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs">
                Cargando tickets de soporte...
              </div>
            ) : tickets.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400 flex items-center justify-center">
                  <RiMessage3Line size={28} />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-2">
                  {t("support.noTickets")}
                </h3>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                  {t("support.noTicketsDesc")}
                </p>
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs sm:text-sm transition shadow-xs cursor-pointer"
                >
                  <RiAddLine size={18} />
                  <span>{t("support.newTicket")}</span>
                </button>
              </div>
            ) : (
              <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400 font-semibold">
                        <th className="py-3.5 px-4 sm:px-6">{t("support.ticketNumber")}</th>
                        <th className="py-3.5 px-4 sm:px-6">{t("support.subject")}</th>
                        <th className="py-3.5 px-4">{t("support.category")}</th>
                        <th className="py-3.5 px-4">{t("support.priority")}</th>
                        <th className="py-3.5 px-4">{t("support.status")}</th>
                        <th className="py-3.5 px-4 text-right pr-6">{t("support.lastUpdate")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800 text-gray-700 dark:text-gray-300">
                      {tickets.map((tck) => (
                        <tr
                          key={tck.id}
                          onClick={() => loadTicketDetail(tck.id)}
                          className="hover:bg-gray-50/80 dark:hover:bg-gray-800/50 cursor-pointer transition"
                        >
                          <td className="py-4 px-4 sm:px-6 font-mono font-bold text-gray-900 dark:text-white">
                            #TCK-{tck.ticket_number}
                          </td>
                          <td className="py-4 px-4 sm:px-6 font-medium text-gray-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <span>{tck.subject}</span>
                              {tck.message_count && tck.message_count > 1 ? (
                                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 font-mono">
                                  <RiMessage3Line size={11} />
                                  {tck.message_count}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-gray-600 dark:text-gray-400 text-xs">
                            {getCategoryLabel(tck.category)}
                          </td>
                          <td className="py-4 px-4">{getPriorityBadge(tck.priority)}</td>
                          <td className="py-4 px-4">{getStatusBadge(tck.status)}</td>
                          <td className="py-4 px-4 text-right pr-6 text-xs text-gray-500 font-mono">
                            {formatDate(tck.updated_at || tck.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Modal: New Ticket */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 p-6 sm:p-8 shadow-2xl">
              <div className="mb-6">
                <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                  {t("support.modalNewTicket")}
                </h3>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {t("support.modalNewTicketDesc")}
                </p>
              </div>

              <form onSubmit={handleCreateTicket} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("support.subject")} *
                  </label>
                  <input
                    type="text"
                    required
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    placeholder={t("support.subjectPlaceholder")}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 transition shadow-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                      {t("support.category")}
                    </label>
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 transition shadow-xs"
                    >
                      <option value="general">{t("support.categoryGeneral")}</option>
                      <option value="campaigns">{t("support.categoryCampaigns")}</option>
                      <option value="linkedin">{t("support.categoryLinkedin")}</option>
                      <option value="email">{t("support.categoryEmail")}</option>
                      <option value="sdr_ai">{t("support.categorySdrAi")}</option>
                      <option value="billing">{t("support.categoryBilling")}</option>
                      <option value="bug">{t("support.categoryBug")}</option>
                      <option value="other">{t("support.categoryOther")}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                      {t("support.priority")}
                    </label>
                    <select
                      value={newPriority}
                      onChange={(e) => setNewPriority(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 transition shadow-xs"
                    >
                      <option value="low">{t("support.priorityLow")}</option>
                      <option value="normal">{t("support.priorityNormal")}</option>
                      <option value="high">{t("support.priorityHigh")}</option>
                      <option value="urgent">{t("support.priorityUrgent")}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("support.message")} *
                  </label>
                  <textarea
                    rows={5}
                    required
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder={t("support.messagePlaceholder")}
                    className="w-full p-3.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 transition shadow-xs"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs sm:text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition cursor-pointer shadow-xs"
                  >
                    {t("common.cancel") || "Cancelar"}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold transition shadow-xs cursor-pointer"
                  >
                    {submitting ? t("support.submitting") : t("support.submitTicket")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
