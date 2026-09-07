import React, { useState, useEffect } from "react";
import {
  RiCloseLine,
  RiSettings4Line,
  RiTimeLine,
  RiFileCopyLine,
  RiCheckLine,
  RiGlobalLine,
} from "react-icons/ri";
import { toast } from "sonner";
import type { CalendarSettings } from "@/lib/calendar/schema";

interface CalendarSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (settings: CalendarSettings) => void;
}

const DAYS = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

export const CalendarSettingsModal: React.FC<CalendarSettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [slotDuration, setSlotDuration] = useState(30);
  const [bufferTime, setBufferTime] = useState(15);
  const [minNotice, setMinNotice] = useState(4);
  const [timezone, setTimezone] = useState("America/Santiago");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // Working hours per day: e.g. { mon: { enabled: true, start: "09:00", end: "18:00" }, ... }
  const [daysSchedule, setDaysSchedule] = useState<
    Record<string, { enabled: boolean; start: string; end: string }>
  >({
    mon: { enabled: true, start: "09:00", end: "18:00" },
    tue: { enabled: true, start: "09:00", end: "18:00" },
    wed: { enabled: true, start: "09:00", end: "18:00" },
    thu: { enabled: true, start: "09:00", end: "18:00" },
    fri: { enabled: true, start: "09:00", end: "18:00" },
    sat: { enabled: false, start: "10:00", end: "14:00" },
    sun: { enabled: false, start: "10:00", end: "14:00" },
  });

  // Fetch current settings on open
  useEffect(() => {
    if (!isOpen) return;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/calendar/settings");
        if (res.ok) {
          const { settings } = await res.json();
          setSlotDuration(settings.slot_duration_minutes || 30);
          setBufferTime(settings.buffer_time_minutes || 15);
          setMinNotice(settings.min_notice_hours || 4);
          setTimezone(settings.timezone || "America/Santiago");

          try {
            const parsed = JSON.parse(settings.working_hours_json || "{}");
            const newSchedule: any = {};
            for (const d of DAYS) {
              const intervals = parsed[d.key] || [];
              if (intervals.length > 0) {
                newSchedule[d.key] = {
                  enabled: true,
                  start: intervals[0].start || "09:00",
                  end: intervals[0].end || "18:00",
                };
              } else {
                newSchedule[d.key] = {
                  enabled: false,
                  start: "09:00",
                  end: "18:00",
                };
              }
            }
            setDaysSchedule(newSchedule);
          } catch {}
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [isOpen]);

  const bookingUrl = typeof window !== "undefined" ? `${window.location.origin}/book` : "/book";

  function handleCopyLink() {
    navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    toast.success("Enlace de reserva copiado al portapapeles");
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      // Build working_hours_json format
      const workingHoursObj: Record<string, Array<{ start: string; end: string }>> = {};
      for (const [dayKey, sched] of Object.entries(daysSchedule)) {
        if (sched.enabled) {
          workingHoursObj[dayKey] = [{ start: sched.start, end: sched.end }];
        } else {
          workingHoursObj[dayKey] = [];
        }
      }

      const res = await fetch("/api/calendar/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot_duration_minutes: slotDuration,
          buffer_time_minutes: bufferTime,
          min_notice_hours: minNotice,
          timezone,
          working_hours_json: JSON.stringify(workingHoursObj),
        }),
      });

      if (!res.ok) throw new Error("Error al guardar la configuración");

      const { settings } = await res.json();
      toast.success("Configuración de disponibilidad guardada");
      onSaved?.(settings);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-500 flex items-center justify-center">
              <RiSettings4Line size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-base">
                Ajustes de Disponibilidad y Reserva
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Define tus horarios de atención para la página pública y el SDR IA.
              </p>
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

        {/* Content */}
        <form onSubmit={handleSave} className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Public Booking Link Card */}
          <div className="p-3.5 rounded-xl border border-brand-500/20 bg-brand-50/50 dark:bg-brand-950/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-brand-700 dark:text-brand-300">
                Tu Enlace Público de Reserva (Estilo Calendly)
              </span>
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 dark:text-brand-400 hover:underline"
              >
                {copied ? (
                  <>
                    <RiCheckLine size={14} /> ¡Copiado!
                  </>
                ) : (
                  <>
                    <RiFileCopyLine size={14} /> Copiar enlace
                  </>
                )}
              </button>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono bg-white dark:bg-gray-900 p-2 rounded-lg border border-brand-500/20 truncate">
              {bookingUrl}
            </div>
          </div>

          {/* External Calendar Sync (iCal Feed) */}
          <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-850/60 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                Sincronización con Google Calendar / Outlook (Feed iCal)
              </span>
              <button
                type="button"
                onClick={() => {
                  const feedUrl = typeof window !== "undefined" ? `${window.location.origin}/api/calendar/feed` : "/api/calendar/feed";
                  navigator.clipboard.writeText(feedUrl);
                  toast.success("Enlace de suscripción iCal copiado. Pégalo en Google Calendar ('Desde URL') u Outlook.");
                }}
                className="inline-flex items-center gap-1 text-xs font-bold text-gray-600 dark:text-gray-300 hover:text-brand-500 dark:hover:text-brand-400 hover:underline"
              >
                <RiFileCopyLine size={14} /> Copiar Feed iCal
              </button>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              Agrega esta URL como suscripción de calendario web en tu Google Calendar, Apple Calendar o Microsoft Outlook para reflejar automáticamente las citas agendadas en tiempo real.
            </p>
            <div className="text-xs text-gray-600 dark:text-gray-300 font-mono bg-white dark:bg-gray-900 p-2 rounded-lg border border-gray-200 dark:border-gray-800 truncate">
              {typeof window !== "undefined" ? `${window.location.origin}/api/calendar/feed` : "/api/calendar/feed"}
            </div>
          </div>

          {/* Duration & Notice Parameters */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                Duración de Citas
              </label>
              <select
                value={slotDuration}
                onChange={(e) => setSlotDuration(Number(e.target.value))}
                className="w-full bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-brand-500"
              >
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={45}>45 minutos</option>
                <option value={60}>60 minutos</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                Aviso Mínimo Previo
              </label>
              <select
                value={minNotice}
                onChange={(e) => setMinNotice(Number(e.target.value))}
                className="w-full bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-brand-500"
              >
                <option value={1}>1 hora antes</option>
                <option value={2}>2 horas antes</option>
                <option value={4}>4 horas antes</option>
                <option value={12}>12 horas antes</option>
                <option value={24}>24 horas antes</option>
              </select>
            </div>
          </div>

          {/* Working Hours Schedule per day */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
              Días y Horarios Disponibles
            </label>

            <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 bg-gray-50/40 dark:bg-gray-850/40 overflow-hidden">
              {DAYS.map((d) => {
                const daySched = daysSchedule[d.key] || {
                  enabled: false,
                  start: "09:00",
                  end: "18:00",
                };

                return (
                  <div
                    key={d.key}
                    className="p-2.5 flex items-center justify-between text-xs transition-colors hover:bg-white dark:hover:bg-gray-850"
                  >
                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-gray-800 dark:text-gray-200 w-28">
                      <input
                        type="checkbox"
                        checked={daySched.enabled}
                        onChange={(e) =>
                          setDaysSchedule((prev) => ({
                            ...prev,
                            [d.key]: { ...daySched, enabled: e.target.checked },
                          }))
                        }
                        className="checkbox checkbox-xs checkbox-primary rounded"
                      />
                      <span>{d.label}</span>
                    </label>

                    {daySched.enabled ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={daySched.start}
                          onChange={(e) =>
                            setDaysSchedule((prev) => ({
                              ...prev,
                              [d.key]: { ...daySched, start: e.target.value },
                            }))
                          }
                          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-900 dark:text-white"
                        />
                        <span className="text-gray-400">—</span>
                        <input
                          type="time"
                          value={daySched.end}
                          onChange={(e) =>
                            setDaysSchedule((prev) => ({
                              ...prev,
                              [d.key]: { ...daySched, end: e.target.value },
                            }))
                          }
                          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-900 dark:text-white"
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 italic">No disponible</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Save Actions */}
          <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar Ajustes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
