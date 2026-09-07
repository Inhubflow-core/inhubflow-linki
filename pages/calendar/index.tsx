import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import type { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiCalendarEventLine,
  RiTimeLine,
  RiListCheck2,
  RiAddLine,
  RiSearchLine,
  RiRefreshLine,
  RiFilter3Line,
  RiShareLine,
  RiSettings4Line,
  RiCheckLine,
} from "react-icons/ri";
import { toast } from "sonner";
import { CalendarHeader, type CalendarViewMode } from "@/components/calendar/CalendarHeader";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { AgendaView } from "@/components/calendar/AgendaView";
import { ScheduleModal } from "@/components/calendar/ScheduleModal";
import { EventDetailModal } from "@/components/calendar/EventDetailModal";
import { CalendarSettingsModal } from "@/components/calendar/CalendarSettingsModal";
import {
  getCalendarEvents,
  type CalendarEventWithTarget,
} from "@/lib/calendar/calendar-service";

interface CalendarPageProps {
  initialEvents: CalendarEventWithTarget[];
}

export const getServerSideProps: GetServerSideProps<CalendarPageProps> = async () => {
  const db = getDb();
  const initialEvents = getCalendarEvents(db);

  return {
    props: {
      initialEvents,
    },
  };
};

export default function CalendarPage({ initialEvents }: CalendarPageProps) {
  const { t } = useTranslation();

  // State
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [events, setEvents] = useState<CalendarEventWithTarget[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  // Modals state
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleInitialDate, setScheduleInitialDate] = useState<Date | undefined>(undefined);
  const [scheduleInitialHour, setScheduleInitialHour] = useState<number>(10);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventWithTarget | null>(null);

  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const handleCopyBookingLink = () => {
    const url = `${window.location.origin}/book`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast.success("Enlace público de reserva copiado al portapapeles");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Fetch events from API
  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/calendar/events");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error("Error loading events:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Filter events client-side based on status & search
  const filteredEvents = events.filter((evt) => {
    if (statusFilter !== "all" && evt.status !== statusFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = evt.title.toLowerCase().includes(q);
      const matchTarget = (evt.target_name || "").toLowerCase().includes(q);
      const matchCompany = (evt.target_company || "").toLowerCase().includes(q);
      if (!matchTitle && !matchTarget && !matchCompany) return false;
    }
    return true;
  });

  // Date navigation handlers
  const handlePrev = () => {
    const newDate = new Date(currentDate);
    if (viewMode === "month") {
      newDate.setMonth(newDate.getMonth() - 1);
    } else if (viewMode === "week") {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setCurrentDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === "month") {
      newDate.setMonth(newDate.getMonth() + 1);
    } else if (viewMode === "week") {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Quick schedule from date click (MonthView)
  const handleSelectDate = (date: Date) => {
    setScheduleInitialDate(date);
    setScheduleInitialHour(10);
    setScheduleModalOpen(true);
  };

  // Quick schedule from slot click (WeekView)
  const handleSelectSlot = (date: Date, hour: number) => {
    setScheduleInitialDate(date);
    setScheduleInitialHour(hour);
    setScheduleModalOpen(true);
  };

  // Event selection for details
  const handleSelectEvent = (event: CalendarEventWithTarget) => {
    setSelectedEvent(event);
    setDetailModalOpen(true);
  };

  // Event mutations callbacks
  const handleEventCreated = (newEvent: CalendarEventWithTarget) => {
    setEvents((prev) => [newEvent, ...prev]);
  };

  const handleEventUpdated = (updatedEvent: CalendarEventWithTarget) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e))
    );
    setSelectedEvent(updatedEvent);
  };

  const handleEventDeleted = (eventId: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    setSelectedEvent(null);
  };

  return (
    <>
      <Head>
        <title>Calendario — Dashboard B2B</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div>
        {/* Top Header Banner (Matching other pages) */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl mb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                Calendario de Reuniones
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-600 dark:text-brand-400">
                {events.length} {events.length === 1 ? "reunión" : "reuniones"}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Gestión de citas comerciales, disponibilidad en tiempo real y sincronización automática con SDR IA.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* View switcher: Mes | Semana | Agenda */}
            <div className="join border border-gray-300 dark:border-gray-700 rounded-xl p-0.5 bg-base-200/50">
              <button
                type="button"
                onClick={() => setViewMode("month")}
                className={`join-item btn btn-xs gap-1 font-semibold ${
                  viewMode === "month"
                    ? "btn-primary shadow-xs"
                    : "btn-ghost text-base-content/60 hover:text-base-content"
                }`}
                title="Vista Mes"
              >
                <RiCalendarEventLine size={13} />
                Mes
              </button>
              <button
                type="button"
                onClick={() => setViewMode("week")}
                className={`join-item btn btn-xs gap-1 font-semibold ${
                  viewMode === "week"
                    ? "btn-primary shadow-xs"
                    : "btn-ghost text-base-content/60 hover:text-base-content"
                }`}
                title="Vista Semana"
              >
                <RiTimeLine size={13} />
                Semana
              </button>
              <button
                type="button"
                onClick={() => setViewMode("agenda")}
                className={`join-item btn btn-xs gap-1 font-semibold ${
                  viewMode === "agenda"
                    ? "btn-primary shadow-xs"
                    : "btn-ghost text-base-content/60 hover:text-base-content"
                }`}
                title="Vista Agenda"
              >
                <RiListCheck2 size={13} />
                Agenda
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopyBookingLink}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
              title="Copiar enlace de reserva pública estilo Calendly"
            >
              {copiedLink ? <RiCheckLine size={16} className="text-emerald-500" /> : <RiShareLine size={16} />}
              {copiedLink ? "¡Copiado!" : "Copiar Link"}
            </button>

            <button
              type="button"
              onClick={() => setSettingsModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
              title="Configurar horarios y disponibilidad"
            >
              <RiSettings4Line size={16} /> Horarios
            </button>

            <button
              type="button"
              onClick={() => {
                setScheduleInitialDate(new Date());
                setScheduleInitialHour(10);
                setScheduleModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs"
            >
              <RiAddLine size={16} /> Agendar Reunión
            </button>
          </div>
        </div>

        {/* Filter & Navigation Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          {/* Date navigation controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xs p-1">
              <button
                type="button"
                onClick={handlePrev}
                className="px-2 py-1 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs font-bold"
                title="Anterior"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={handleToday}
                className="px-3 py-1 rounded-lg text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="px-2 py-1 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs font-bold"
                title="Siguiente"
              >
                ▶
              </button>
            </div>

            <h2 className="text-base md:text-lg font-bold text-gray-900 dark:text-white capitalize">
              {currentDate.toLocaleDateString("es-ES", {
                month: "long",
                year: "numeric",
              })}
            </h2>

            <button
              type="button"
              onClick={fetchEvents}
              disabled={loading}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Actualizar calendario"
            >
              <RiRefreshLine size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {/* Search & Status Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/30 pointer-events-none">
                <RiSearchLine size={13} />
              </span>
              <input
                type="text"
                className="w-56 bg-base-200 border border-gray-300 dark:border-gray-700 rounded-xl pl-8 pr-3 py-1.5 text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/40"
                placeholder="Buscar por prospecto o título..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Status pills */}
            <div className="join border border-gray-300 dark:border-gray-700 rounded-xl p-0.5 bg-base-200 h-8 flex items-center">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={`join-item px-2.5 py-1 rounded text-xs transition-colors ${
                  statusFilter === "all"
                    ? "bg-brand-500 text-white font-medium shadow-xs"
                    : "text-base-content/60 hover:text-base-content"
                }`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("confirmed")}
                className={`join-item px-2.5 py-1 rounded text-xs transition-colors ${
                  statusFilter === "confirmed"
                    ? "bg-brand-500 text-white font-medium shadow-xs"
                    : "text-base-content/60 hover:text-base-content"
                }`}
              >
                Confirmadas
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("completed")}
                className={`join-item px-2.5 py-1 rounded text-xs transition-colors ${
                  statusFilter === "completed"
                    ? "bg-brand-500 text-white font-medium shadow-xs"
                    : "text-base-content/60 hover:text-base-content"
                }`}
              >
                Completadas
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("cancelled")}
                className={`join-item px-2.5 py-1 rounded text-xs transition-colors ${
                  statusFilter === "cancelled"
                    ? "bg-brand-500 text-white font-medium shadow-xs"
                    : "text-base-content/60 hover:text-base-content"
                }`}
              >
                Canceladas
              </button>
            </div>
          </div>
        </div>

        {/* Calendar View Area */}
        {viewMode === "month" && (
          <MonthView
            currentDate={currentDate}
            events={filteredEvents}
            onSelectEvent={handleSelectEvent}
            onSelectDate={handleSelectDate}
          />
        )}

        {viewMode === "week" && (
          <WeekView
            currentDate={currentDate}
            events={filteredEvents}
            onSelectEvent={handleSelectEvent}
            onSelectSlot={handleSelectSlot}
          />
        )}

        {viewMode === "agenda" && (
          <AgendaView
            events={filteredEvents}
            onSelectEvent={handleSelectEvent}
            onOpenScheduleModal={() => {
              setScheduleInitialDate(new Date());
              setScheduleInitialHour(10);
              setScheduleModalOpen(true);
            }}
          />
        )}

        {/* Schedule Meeting Modal */}
        <ScheduleModal
          isOpen={scheduleModalOpen}
          onClose={() => setScheduleModalOpen(false)}
          onEventCreated={handleEventCreated}
          initialDate={scheduleInitialDate}
          initialHour={scheduleInitialHour}
        />

        {/* Event Detail Modal */}
        <EventDetailModal
          event={selectedEvent}
          isOpen={detailModalOpen}
          onClose={() => setDetailModalOpen(false)}
          onEventUpdated={handleEventUpdated}
          onEventDeleted={handleEventDeleted}
        />

        {/* Calendar Settings Modal */}
        <CalendarSettingsModal
          isOpen={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          onSaved={() => fetchEvents()}
        />
      </div>
    </>
  );
}
