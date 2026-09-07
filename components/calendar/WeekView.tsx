import React from "react";
import type { CalendarEventWithTarget } from "@/lib/calendar/calendar-service";
import { RiVideoLine, RiTimeLine } from "react-icons/ri";

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEventWithTarget[];
  onSelectEvent: (event: CalendarEventWithTarget) => void;
  onSelectSlot: (date: Date, hour: number) => void;
}

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const HOUR_HEIGHT = 60; // px per hour slot

export const WeekView: React.FC<WeekViewProps> = ({
  currentDate,
  events,
  onSelectEvent,
  onSelectSlot,
}) => {
  // Calculate 7 days of current week (Monday to Sunday)
  const weekDays = React.useMemo(() => {
    const day = currentDate.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(currentDate);
    monday.setDate(currentDate.getDate() + diffToMonday);

    const days: Array<{
      date: Date;
      dateStr: string;
      dayName: string;
      dayNum: number;
      isToday: boolean;
      events: CalendarEventWithTarget[];
    }> = [];

    const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const todayStr = new Date().toISOString().split("T")[0];

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);

      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d.getDate()).padStart(2, "0");
      const dStr = `${y}-${m}-${dayNum}`;

      days.push({
        date: d,
        dateStr: dStr,
        dayName: dayNames[i],
        dayNum: d.getDate(),
        isToday: dStr === todayStr,
        events: events.filter((e) => {
          const eDate = new Date(e.start_time);
          const ey = eDate.getFullYear();
          const em = String(eDate.getMonth() + 1).padStart(2, "0");
          const ed = String(eDate.getDate()).padStart(2, "0");
          return `${ey}-${em}-${ed}` === dStr;
        }),
      });
    }

    return days;
  }, [currentDate, events]);

  function getStatusStyle(status: string) {
    switch (status) {
      case "completed":
        return "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-500/30";
      case "cancelled":
        return "bg-gray-200 dark:bg-gray-800 text-gray-500 line-through border-gray-300 dark:border-gray-700";
      case "no_show":
        return "bg-rose-500/20 text-rose-800 dark:text-rose-200 border-rose-500/30";
      default:
        return "bg-brand-500/20 text-brand-800 dark:text-brand-200 border-brand-500/30";
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

  // Calculate event positioning within the day column (08:00 to 21:00)
  function calculateEventPosition(event: CalendarEventWithTarget) {
    const start = new Date(event.start_time);
    const end = new Date(event.end_time);

    const startMinutesFrom8 = (start.getHours() - 8) * 60 + start.getMinutes();
    const durationMinutes = Math.max(25, (end.getTime() - start.getTime()) / (1000 * 60));

    const top = (startMinutesFrom8 / 60) * HOUR_HEIGHT;
    const height = Math.max(30, (durationMinutes / 60) * HOUR_HEIGHT - 2);

    return { top, height };
  }

  return (
    <div className="w-full rounded-2xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xs overflow-hidden flex flex-col">
      {/* Week header row */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 sticky top-0 z-10">
        <div className="py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 border-r border-gray-300 dark:border-gray-700">
          Hora
        </div>
        {weekDays.map((wd) => (
          <div
            key={wd.dateStr}
            className={`py-2.5 px-2 text-center border-r last:border-r-0 border-gray-300 dark:border-gray-700 transition-colors ${
              wd.isToday ? "bg-brand-500/5 dark:bg-brand-500/10" : ""
            }`}
          >
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              {wd.dayName}
            </div>
            <div
              className={`inline-flex items-center justify-center text-sm font-bold rounded-full w-7 h-7 mt-0.5 ${
                wd.isToday
                  ? "bg-brand-500 text-white shadow-xs"
                  : "text-gray-900 dark:text-white"
              }`}
            >
              {wd.dayNum}
            </div>
          </div>
        ))}
      </div>

      {/* Grid container with hours and day columns */}
      <div className="overflow-y-auto max-h-[620px] relative">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
          {/* Time axis */}
          <div className="border-r border-gray-300 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-850/60 select-none">
            {HOURS.map((hour) => (
              <div
                key={hour}
                style={{ height: `${HOUR_HEIGHT}px` }}
                className="text-[11px] font-medium text-gray-400 dark:text-gray-500 pr-2 pt-1 text-right border-b border-gray-200 dark:border-gray-800"
              >
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* 7 Day columns */}
          {weekDays.map((wd) => (
            <div
              key={wd.dateStr}
              className={`relative border-r last:border-r-0 border-gray-300 dark:border-gray-700 transition-colors ${
                wd.isToday ? "bg-brand-500/[0.02]" : ""
              }`}
            >
              {/* Hourly slot click targets */}
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  onClick={() => onSelectSlot(wd.date, hour)}
                  style={{ height: `${HOUR_HEIGHT}px` }}
                  className="border-b border-gray-200 dark:border-gray-800 hover:bg-brand-50/40 dark:hover:bg-brand-950/20 cursor-pointer transition-colors"
                />
              ))}

              {/* Event blocks */}
              {wd.events.map((evt) => {
                const { top, height } = calculateEventPosition(evt);
                // Only render if within visible window (top >= 0)
                if (top < 0) return null;

                return (
                  <div
                    key={evt.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEvent(evt);
                    }}
                    style={{
                      top: `${top}px`,
                      height: `${height}px`,
                      left: "3px",
                      right: "3px",
                    }}
                    title={`${formatTime(evt.start_time)} - ${formatTime(evt.end_time)} | ${evt.title}`}
                    className={`absolute rounded-xl border p-2 text-xs font-medium cursor-pointer shadow-xs transition-all hover:scale-[1.02] hover:z-20 overflow-hidden flex flex-col justify-between ${getStatusStyle(
                      evt.status
                    )}`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1 font-bold text-[11px]">
                        <RiTimeLine size={12} className="shrink-0" />
                        <span>
                          {formatTime(evt.start_time)} - {formatTime(evt.end_time)}
                        </span>
                      </div>
                      <div className="font-semibold truncate text-xs">
                        {evt.target_name || evt.title}
                      </div>
                      {evt.target_company && (
                        <div className="text-[10px] opacity-75 truncate">
                          {evt.target_company}
                        </div>
                      )}
                    </div>

                    {evt.meeting_link && (
                      <div className="flex items-center gap-1 text-[10px] font-semibold opacity-90 pt-1">
                        <RiVideoLine size={11} className="shrink-0" />
                        <span className="truncate">Videollamada</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
