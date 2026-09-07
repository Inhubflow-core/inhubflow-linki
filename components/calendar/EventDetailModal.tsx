import React, { useState } from "react";
import {
  RiCloseLine,
  RiTimeLine,
  RiVideoLine,
  RiUserLine,
  RiBuildingLine,
  RiMailLine,
  RiLinkedinBoxLine,
  RiDeleteBinLine,
  RiCheckDoubleLine,
  RiCloseCircleLine,
  RiAlertLine,
  RiCalendarCheckLine,
  RiExternalLinkLine,
} from "react-icons/ri";
import { toast } from "sonner";
import type { CalendarEventWithTarget } from "@/lib/calendar/calendar-service";

interface EventDetailModalProps {
  event: CalendarEventWithTarget | null;
  isOpen: boolean;
  onClose: () => void;
  onEventUpdated: (event: CalendarEventWithTarget) => void;
  onEventDeleted: (eventId: string) => void;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  event,
  isOpen,
  onClose,
  onEventUpdated,
  onEventDeleted,
}) => {
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!isOpen || !event) return null;

  function formatDateTime(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleString("es-ES", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  async function handleStatusChange(
    newStatus: "confirmed" | "completed" | "cancelled" | "no_show"
  ) {
    if (!event) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/calendar/events/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) throw new Error("Error al actualizar el estado");

      const data = await res.json();
      toast.success("Estado de la reunión actualizado");
      onEventUpdated(data.event);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar");
    } finally {
      setUpdating(false);
    }
  }

  async function handleDelete() {
    if (!event) return;
    if (!confirm("¿Estás seguro de que deseas eliminar esta reunión?")) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/calendar/events/${event.id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Error al eliminar la reunión");

      toast.success("Reunión eliminada");
      onEventDeleted(event.id);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="font-bold text-gray-900 dark:text-white text-base">
              {event.title}
            </h3>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <RiTimeLine size={14} className="text-brand-500" />
              <span>
                {formatDateTime(event.start_time)} — {formatDateTime(event.end_time)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <RiCloseLine size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5">
          {/* Prospect Card */}
          {event.target_name ? (
            <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-850/50 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                Prospecto Vinculado
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-brand-500 text-white font-bold text-xs flex items-center justify-center">
                    {event.target_name[0].toUpperCase()}
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-gray-900 dark:text-white">
                      {event.target_name}
                    </h4>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {event.target_title} {event.target_company ? `@ ${event.target_company}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {event.target_linkedin_url && (
                    <a
                      href={event.target_linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                      title="Ver en LinkedIn"
                    >
                      <RiLinkedinBoxLine size={18} />
                    </a>
                  )}
                  {event.target_email && (
                    <a
                      href={`mailto:${event.target_email}`}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      title="Enviar email"
                    >
                      <RiMailLine size={16} />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-400 italic">
              Sin prospecto vinculado a esta reunión.
            </div>
          )}

          {/* Meeting link action */}
          {event.meeting_link && (
            <div className="p-3.5 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <RiVideoLine size={18} className="text-brand-500 shrink-0" />
                <span className="text-xs font-semibold text-brand-700 dark:text-brand-300 truncate">
                  {event.meeting_link}
                </span>
              </div>
              <a
                href={
                  event.meeting_link.startsWith("http")
                    ? event.meeting_link
                    : `https://${event.meeting_link}`
                }
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-colors shrink-0 shadow-xs"
              >
                Unirse <RiExternalLinkLine size={12} />
              </a>
            </div>
          )}

          {/* Notes / Description */}
          {event.description && (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                Notas y Agenda
              </div>
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                {event.description}
              </div>
            </div>
          )}

          {/* Status Quick Switcher */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Estado de la Reunión
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                disabled={updating}
                onClick={() => handleStatusChange("confirmed")}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  event.status === "confirmed"
                    ? "bg-brand-500 text-white border-brand-500 shadow-xs"
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50"
                }`}
              >
                Confirmada
              </button>
              <button
                type="button"
                disabled={updating}
                onClick={() => handleStatusChange("completed")}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  event.status === "completed"
                    ? "bg-emerald-500 text-white border-emerald-500 shadow-xs"
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-emerald-50/50"
                }`}
              >
                Completada
              </button>
              <button
                type="button"
                disabled={updating}
                onClick={() => handleStatusChange("no_show")}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  event.status === "no_show"
                    ? "bg-rose-500 text-white border-rose-500 shadow-xs"
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-rose-50/50"
                }`}
              >
                No asistió
              </button>
              <button
                type="button"
                disabled={updating}
                onClick={() => handleStatusChange("cancelled")}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  event.status === "cancelled"
                    ? "bg-gray-600 text-white border-gray-600 shadow-xs"
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100"
                }`}
              >
                Cancelada
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-gray-50/80 dark:bg-gray-850/80 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
          >
            <RiDeleteBinLine size={14} /> Eliminar
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
