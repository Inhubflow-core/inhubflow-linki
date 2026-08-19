import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import {
  RiLayoutGridLine,
  RiFlowChart,
  RiFileList3Line,
  RiLogoutBoxLine,
  RiUserSettingsLine,
  RiArrowUpCircleLine,
  RiBuildingLine,
  RiContactsLine,
  RiInboxLine,
  RiMailCheckLine,
  RiCheckboxCircleLine,
  RiQuestionLine,
  RiCompassLine,
  RiPlayCircleLine,
  RiGlobalLine,
} from "react-icons/ri";
import { pathToTourPage, replayPageTour } from "@/lib/tour";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { useTheme } from "@/lib/context/ThemeContext";

const LEARNING_PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLBf6xNJOmsIQ";

const mainNav = [
  { href: "/", labelKey: "nav.dashboard", icon: RiLayoutGridLine, color: "#465fff", tour: "nav-dashboard" },
  { href: "/lists", labelKey: "nav.lists", icon: RiFileList3Line, color: "#12b76a", tour: "nav-lists" },
  { href: "/contacts", labelKey: "nav.contacts", icon: RiContactsLine, color: "#0ba5ec", tour: "nav-contacts" },
  { href: "/companies", labelKey: "nav.companies", icon: RiBuildingLine, color: "#7a5af8", tour: "nav-companies" },
  { href: "/workflows", labelKey: "nav.campaigns", icon: RiFlowChart, color: "#f79009", tour: "nav-workflows" },
  { href: "/inbox", labelKey: "nav.inbox", icon: RiInboxLine, color: "#0086c9", tour: "nav-inbox" },
  { href: "/email-health", labelKey: "nav.emailHealth", icon: RiMailCheckLine, color: "#fb6514", tour: "nav-email-health" },
];

const premiumNav = [
  { href: "/todos", labelKey: "nav.todos", icon: RiCheckboxCircleLine, color: "#ee46bc", tour: "nav-todos" },
];

interface SidebarProps {
  onCollapse?: (collapsed: boolean) => void;
  isEmbedded?: boolean;
  isCollapsed?: boolean;
}

export default function Sidebar({
  onCollapse,
  isEmbedded = false,
  isCollapsed = false,
}: SidebarProps) {
  const router = useRouter();
  const { t, locale, setLocale, supportedLocales } = useTranslation();
  const { theme } = useTheme();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [hasPremium, setHasPremium] = useState(true);

  const helpRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const tourPage = pathToTourPage(router.pathname);
  const nav = hasPremium ? [...mainNav, ...premiumNav] : mainNav;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (helpOpen && helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setHelpOpen(false);
      }
      if (langOpen && langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [helpOpen, langOpen]);

  useEffect(() => {
    fetch("/api/premium-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setHasPremium(!!d.hasPremium);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/system/update")
      .then((r) => r.json())
      .then((d) => {
        if (d?.updateAvailable) {
          setUpdateAvailable(true);
          setLatestVersion(d.latest);
        }
      })
      .catch(() => {});
  }, []);

  function isActive(href: string) {
    if (href === "/") return router.pathname === "/";
    if (href === "/settings") {
      return ["/settings", "/accounts"].some((p) => router.pathname.startsWith(p));
    }
    return router.pathname.startsWith(href);
  }

  const currentLocaleOption = supportedLocales.find((l) => l.code === locale) ?? supportedLocales[0];

  return (
    <aside
      className={`fixed top-0 left-0 h-screen z-50 flex flex-col border-r border-gray-200 bg-white transition-all duration-300 dark:border-gray-800 dark:bg-gray-900 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Brand Header */}
      <div className={`flex shrink-0 items-center border-b border-gray-100 dark:border-gray-800 transition-all duration-300 ${
        isCollapsed ? "h-16 justify-center px-2" : "h-20 justify-start px-5"
      }`}>
        <Link href="/" className="flex items-center w-full">
          {isCollapsed ? (
            <div className="relative flex h-10 w-10 mx-auto items-center justify-center rounded-xl bg-transparent">
              <Image
                src="/logo-icon.png"
                alt="InHubFlow"
                width={38}
                height={38}
                className="h-10 w-10 object-contain"
                priority
              />
            </div>
          ) : (
            <div className="flex flex-col items-start justify-center w-full py-1">
              <Image
                src={theme === "dark" ? "/logo-master-dark.png" : "/logo-master-light.png"}
                alt="InHubFlow"
                width={220}
                height={55}
                className="w-full max-w-[200px] h-auto object-contain transition-all duration-200"
                priority
              />
              <span className="text-[10px] font-extrabold text-brand-500 uppercase tracking-widest pl-1 mt-1">
                B2B OUTREACH ENGINE
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
        {!isCollapsed && (
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
            Navegación
          </p>
        )}

        {nav.map((item) => {
          const active = isActive(item.href);
          const label = t(item.labelKey);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-tour={item.tour}
              title={isCollapsed ? label : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition-all ${
                active
                  ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 font-semibold shadow-sm"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              } ${isCollapsed ? "justify-center px-0" : ""}`}
            >
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                  active
                    ? "bg-brand-500 text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                }`}
              >
                <item.icon size={15} />
              </div>
              {!isCollapsed && <span className="truncate">{label}</span>}
              {!isCollapsed && active && (
                <div className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Update Banner */}
      {updateAvailable && !isCollapsed && (
        <div className="mx-3 mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RiArrowUpCircleLine size={16} />
            <span>v{latestVersion} disponible</span>
          </div>
          <Link href="/settings" className="font-bold underline text-[11px]">
            Actualizar
          </Link>
        </div>
      )}

      {/* Footer Navigation */}
      <div className="border-t border-gray-100 dark:border-gray-800 p-3 space-y-1">
        {/* Settings link */}
        <Link
          href="/settings"
          title={isCollapsed ? t("nav.settings") : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
            isActive("/settings")
              ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 font-semibold"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          } ${isCollapsed ? "justify-center px-0" : ""}`}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            <RiUserSettingsLine size={15} />
          </div>
          {!isCollapsed && <span>{t("nav.settings")}</span>}
        </Link>

        {/* Tour & Help Guide */}
        <div className="relative" ref={helpRef}>
          <button
            onClick={() => setHelpOpen((v) => !v)}
            title={isCollapsed ? t("nav.help") : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white transition-colors ${
              isCollapsed ? "justify-center px-0" : ""
            }`}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              <RiQuestionLine size={15} />
            </div>
            {!isCollapsed && <span>{t("nav.help")}</span>}
          </button>

          {helpOpen && (
            <div className="absolute left-full bottom-0 ml-2 w-52 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl backdrop-blur-md dark:border-gray-800 dark:bg-gray-900 z-50">
              {tourPage && (
                <button
                  onClick={() => {
                    replayPageTour(tourPage);
                    setHelpOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors text-left"
                >
                  <RiCompassLine size={14} className="text-gray-400 shrink-0" />
                  {t("nav.replayTour")}
                </button>
              )}
              <a
                href={LEARNING_PLAYLIST_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setHelpOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
              >
                <RiPlayCircleLine size={14} className="text-gray-400 shrink-0" />
                {t("nav.videoGuides")}
              </a>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
