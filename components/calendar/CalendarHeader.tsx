import React from "react";
import {
  RiCalendarEventLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiAddLine,
  RiCalendarCheckLine,
  RiTimeLine,
  RiListCheck2,
} from "react-icons/ri";

export type CalendarViewMode = "month" | "week" | "agenda";

interface CalendarHeaderProps {
  currentDate: Date;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onOpenScheduleModal: () => void;
  totalMeetingsCount: number;
}

export const CalendarHeader: React.FC<CalendarHeaderProps> = ({
  currentDate,
  viewMode,
  onViewModeChange,
  onPrev,
  onNext,
  onToday,
  onOpenScheduleModal,
  totalMeetingsCount,
}) => {
  // Format period title based on view mode
  const periodTitle = React.useMemo(() => {
    const months = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];
    const year = currentDate.getFullYear();
    const monthName = months[currentDate.getMonth()];

    if (viewMode === "month") {
      return `${monthName} ${year}`;
    }

    if (viewMode === "week") {
      // Calculate start and end of week (Monday to Sunday)
      const day = currentDate.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      const monday = new Date(currentDate);
      monday.setDate(currentDate.getDate() + diffToMonday);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const mondayMonth = months[monday.getMonth()].slice(0, 3);
      const sundayMonth = months[sunday.getMonth()].slice(0, 3);

      if (monday.getMonth() === sunday.getMonth()) {
        return `${monday.getDate()} - ${sunday.getDate()} de ${monthName} ${year}`;
      }
      return `${monday.getDate()} ${mondayMonth} - ${sunday.getDate()} ${sundayMonth} ${year}`;
    }

    // Agenda: Upcoming view
    return `Agenda - ${monthName} ${year}`;
  }, [currentDate, viewMode]);

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      {/* Date Navigation & Period Title */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xs p-1">
          <button
            type="button"
            onClick={onPrev}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Anterior"
          >
            <RiArrowLeftSLine size={18} />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="px-3 py-1 rounded-lg text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={onNext}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Siguiente"
          >
            <RiArrowRightSLine size={18} />
          </button>
        </div>

        <h2 className="text-lg md:text-xl font-bold tracking-tight text-gray-900 dark:text-white min-w-[180px]">
          {periodTitle}
        </h2>
      </div>

      {/* View Switcher & Action Button */}
      <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
        {/* Switcher: Mes | Semana | Agenda */}
        <div className="join border border-base-300 rounded-lg p-0.5 bg-base-200/50">
          <button
            type="button"
            onClick={() => onViewModeChange("month")}
            className={`join-item btn btn-xs gap-1 font-semibold ${
              viewMode === "month"
                ? "btn-primary"
                : "btn-ghost text-base-content/60 hover:text-base-content"
            }`}
          >
            <RiCalendarEventLine size={13} />
            Mes
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("week")}
            className={`join-item btn btn-xs gap-1 font-semibold ${
              viewMode === "week"
                ? "btn-primary"
                : "btn-ghost text-base-content/60 hover:text-base-content"
            }`}
          >
            <RiTimeLine size={13} />
            Semana
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("agenda")}
            className={`join-item btn btn-xs gap-1 font-semibold ${
              viewMode === "agenda"
                ? "btn-primary"
                : "btn-ghost text-base-content/60 hover:text-base-content"
            }`}
          >
            <RiListCheck2 size={13} />
            Agenda
          </button>
        </div>

        {/* Schedule button */}
        <button
          type="button"
          onClick={onOpenScheduleModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs"
        >
          <RiAddLine size={16} /> Agendar Reunión
        </button>
      </div>
    </div>
  );
};
