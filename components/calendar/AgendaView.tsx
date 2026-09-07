import React from "react";
import type { CalendarEventWithTarget } from "@/lib/calendar/calendar-service";
import {
  RiVideoLine,
  RiTimeLine,
  RiUserLine,
  RiBuildingLine,
  RiLinkedinBoxLine,
  RiExternalLinkLine,
  RiCalendarEventLine,
  RiCheckDoubleLine,
  RiCloseCircleLine,
  RiAlertLine,
  RiMore2Fill,
} from "react-icons/ri";

interface AgendaViewProps {
  events: CalendarEventWithTarget[];
  onSelectEvent: (event: CalendarEventWithTarget) => void;
  onOpenScheduleModal: () => void;
  onUpdateStatus?: (eventId: string, status: "confirmed" | "completed" | "cancelled" | "no_show") => void;
}

export const AgendaView: React.FC<AgendaViewProps> = ({
  events,
  onSelectEvent,
  onOpenScheduleModal,
  onUpdateStatus,
}) => {
  // Group events by date string (YYYY-MM-DD)
  const groupedEvents = React.useMemo(() => {
    const map = new Map<string, CalendarEventWithTarget[]>();

    // Sort ascending
    const sorted = [...events].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    for (const evt of sorted) {
      const dateKey = evt.start_time.split("T")[0];
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(evt);
    }

    return Array.from(map.entries());
  }, [events]);

  function formatDateHeader(dateStr: string) {
    try {
      const [y, m, d] = dateStr.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  }

  function formatTime(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function calculateDuration(start: string, end: string) {
    try {
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      return Math.round((e - s) / (1000 * 60));
    } catch {
      return 30;
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
            <RiCheckDoubleLine size={12} /> Completada
          </span>
        );
      case "cancelled":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-200 dark:bg-gray-800 text-gray-500 border border-gray-300 dark:border-gray-700">
            <RiCloseCircleLine size={12} /> Cancelada
          </span>
        );
      case "no_show":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/20">
            <RiAlertLine size={12} /> No asistió
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-500/20">
            Confirmada
          </span>
        );
    }
  }

  if (events.length === 0) {
    return (
      <div className="w-full rounded-2xl border border-dashed border-gray-300 dark:border-gray-800 p-12 text-center bg-white dark:bg-gray-900 flex flex-col items-center justify-center space-y-4 shadow-xs">
        <div className="w-14 h-14 rounded-2xl bg-brand-500/10 text-brand-500 flex items-center justify-center shadow-xs">
          <RiCalendarEventLine size={28} />
        </div>
        <div className="space-y-1 max-w-sm">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            Sin reuniones programadas
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            No hay citas registradas para este período. Puedes agendar una reunión manualmente o esperar que el SDR IA la programe automáticamente.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenScheduleModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs"
        >
          + Agendar primera reunión
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groupedEvents.map(([dateStr, dayEvents]) => (
        <div
          key={dateStr}
          className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xs overflow-hidden"
        >
          {/* Group Header */}
          <div className="px-5 py-3 bg-gray-50/80 dark:bg-gray-850/80 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider capitalize">
              {formatDateHeader(dateStr)}
            </h3>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {dayEvents.length} {dayEvents.length === 1 ? "reunión" : "reuniones"}
            </span>
          </div>

          {/* Events list */}
          <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {dayEvents.map((evt) => {
              const duration = calculateDuration(evt.start_time, evt.end_time);

              return (
                <div
                  key={evt.id}
                  onClick={() => onSelectEvent(evt)}
                  className="p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-gray-50/50 dark:hover:bg-gray-850/50 transition-colors cursor-pointer group"
                >
                  {/* Left: Time & Prospect info */}
                  <div className="flex items-start gap-4 min-w-0">
                    {/* Time Box */}
                    <div className="w-24 shrink-0 rounded-xl bg-gray-100 dark:bg-gray-800 p-2.5 text-center border border-gray-200 dark:border-gray-700/60 group-hover:border-brand-500/40 transition-colors">
                      <div className="text-xs font-bold text-gray-900 dark:text-white">
                        {formatTime(evt.start_time)}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                        {duration} min
                      </div>
                    </div>

                    {/* Prospect Info */}
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">
                          {evt.title}
                        </h4>
                        {getStatusBadge(evt.status)}
                      </div>

                      {evt.target_name && (
                        <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400 flex-wrap">
                          <span className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1">
                            <RiUserLine size={13} className="text-brand-500" />
                            {evt.target_name}
                          </span>

                          {evt.target_company && (
                            <span className="flex items-center gap-1 text-gray-500">
                              <RiBuildingLine size={13} />
                              {evt.target_company}
                            </span>
                          )}

                          {evt.target_linkedin_url && (
                            <a
                              href={evt.target_linkedin_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
                            >
                              <RiLinkedinBoxLine size={14} /> LinkedIn
                            </a>
                          )}
                        </div>
                      )}

                      {evt.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 pt-0.5">
                          {evt.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center">
                    {evt.meeting_link && (
                      <a
                        href={
                          evt.meeting_link.startsWith("http")
                            ? evt.meeting_link
                            : `https://${evt.meeting_link}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs"
                      >
                        <RiVideoLine size={14} /> Unirse a la reunión
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(evt);
                      }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <RiMore2Fill size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
