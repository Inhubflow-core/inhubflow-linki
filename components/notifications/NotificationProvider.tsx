import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

export interface ClientNotification {
  id: string;
  type: string;
  priority: "normal" | "urgent" | "critical";
  title: string;
  body: string;
  href: string;
  entityType: string;
  entityId: string;
  threadId: string | null;
  handoffId: string | null;
  messageId: string | null;
  data: Record<string, unknown>;
  state: "unread" | "read";
  createdAt: string;
  readAt: string | null;
}

interface NotificationContextValue {
  notifications: ClientNotification[];
  unreadCount: number;
  loading: boolean;
  pushAvailable: boolean;
  pushSubscribed: boolean;
  soundEnabled: boolean;
  refresh: () => Promise<void>;
  openNotification: (notification: ClientNotification) => Promise<void>;
  markAllRead: () => Promise<void>;
  enablePush: () => Promise<void>;
  setSoundEnabled: (enabled: boolean) => void;
  testBeep: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) output[index] = raw.charCodeAt(index);
  return output;
}

function playBeep(): void {
  try {
    const AudioContextConstructor = window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.2, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.45);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.45);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Visual notifications remain available when autoplay is blocked.
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status } = useSession();
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pushAvailable, setPushAvailable] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const initialized = useRef(false);
  const surfaced = useRef(new Set<string>());

  useEffect(() => {
    setSoundEnabledState(localStorage.getItem("inhubflow_notification_sound") !== "off");
  }, []);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    localStorage.setItem("inhubflow_notification_sound", enabled ? "on" : "off");
  }, []);

  const refresh = useCallback(async () => {
    if (status !== "authenticated") return;
    try {
      const response = await fetch("/api/sdr/notifications?limit=40", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar las notificaciones");
      const next = (data.notifications ?? []) as ClientNotification[];
      setNotifications(next);
      setUnreadCount(Number(data.unreadCount) || 0);

      if (!initialized.current) {
        next.forEach((notification) => surfaced.current.add(notification.id));
        initialized.current = true;
        return;
      }
      const newest = [...next].reverse().filter((notification) =>
        notification.state === "unread" && !surfaced.current.has(notification.id));
      for (const notification of newest) {
        surfaced.current.add(notification.id);
        if (soundEnabled && notification.type === "sdr_handoff") playBeep();
        toast(notification.title, {
          description: notification.body,
          duration: notification.priority === "normal" ? 8_000 : 20_000,
          action: {
            label: "Abrir",
            onClick: () => void router.push(notification.href),
          },
        });
      }
    } catch {
      // Polling is best-effort; durable notifications remain on the server.
    } finally {
      setLoading(false);
    }
  }, [router, soundEnabled, status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh, status]);

  useEffect(() => {
    if (status !== "authenticated" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const subscription = await registration.pushManager.getSubscription();
        const configResponse = await fetch("/api/sdr/push-subscription");
        const config = await configResponse.json();
        setPushAvailable(Boolean(config.enabled));
        setPushSubscribed(Boolean(subscription));
      } catch {
        setPushAvailable(false);
      }
    })();
  }, [status]);

  const enablePush = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast.error("Este navegador no soporta Web Push.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast.error("El permiso de notificaciones no fue concedido.");
      return;
    }
    const configResponse = await fetch("/api/sdr/push-subscription");
    const config = await configResponse.json();
    if (!configResponse.ok || !config.enabled || typeof config.publicKey !== "string") {
      toast.error("Web Push todavía no está configurado en el servidor.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.publicKey),
    });
    const saveResponse = await fetch("/api/sdr/push-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!saveResponse.ok) {
      const error = await saveResponse.json().catch(() => ({}));
      throw new Error(error.error || "No se pudo guardar la suscripción Web Push");
    }
    setPushAvailable(true);
    setPushSubscribed(true);
    playBeep();
    toast.success("Web Push y sonido habilitados.");
  }, []);

  const openNotification = useCallback(async (notification: ClientNotification) => {
    if (notification.state === "unread") {
      await fetch("/api/sdr/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notification.id }),
      });
      setNotifications((items) => items.map((item) =>
        item.id === notification.id ? { ...item, state: "read" } : item));
      setUnreadCount((count) => Math.max(0, count - 1));
    }
    await router.push(notification.href);
  }, [router]);

  const markAllRead = useCallback(async () => {
    await fetch("/api/sdr/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setNotifications((items) => items.map((item) => ({ ...item, state: "read" })));
    setUnreadCount(0);
  }, []);

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      loading,
      pushAvailable,
      pushSubscribed,
      soundEnabled,
      refresh,
      openNotification,
      markAllRead,
      enablePush,
      setSoundEnabled,
      testBeep: playBeep,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("useNotifications must be used inside NotificationProvider");
  return value;
}
