import React, { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { useTheme } from "@/lib/context/ThemeContext";
import {
  RiMoonLine,
  RiSunLine,
  RiGlobalLine,
  RiApps2Line,
  RiLogoutBoxRLine,
  RiUserLine,
  RiMenuLine,
  RiMenuFoldLine,
  RiMenuUnfoldLine,
  RiCloseLine,
  RiCheckLine,
  RiMessage3Line,
  RiSendPlaneLine,
} from "react-icons/ri";
import { SlotsIndicator } from "./SlotsIndicator";

interface HeaderProps {
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
  isEmbedded?: boolean;
}

export default function Header({
  onToggleSidebar,
  isSidebarCollapsed,
  isEmbedded,
}: HeaderProps) {
  const { data: session } = useSession();
  const { locale, setLocale, supportedLocales, t } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  const [isLangOpen, setIsLangOpen] = useState(false);
  const [isUserOpen, setIsUserOpen] = useState(false);
  const [isSuiteOpen, setIsSuiteOpen] = useState(false);

  const langRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const suiteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setIsLangOpen(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setIsUserOpen(false);
      }
      if (suiteRef.current && !suiteRef.current.contains(e.target as Node)) {
        setIsSuiteOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (isEmbedded) return null;

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-gray-200 bg-white/80 px-4 backdrop-blur-md transition-colors dark:border-gray-800 dark:bg-gray-900/80 sm:px-6">
        {/* Left: Sidebar Toggle & Title */}
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white shadow-2xs"
            title={isSidebarCollapsed ? "Expandir menú lateral" : "Colapsar menú lateral"}
          >
            {isSidebarCollapsed ? <RiMenuUnfoldLine size={18} /> : <RiMenuFoldLine size={18} />}
          </button>
        )}

        <div className="hidden sm:flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-500/10 text-brand-500 text-xs font-semibold">
            <RiSendPlaneLine size={13} />
            <span>InHub Outreach</span>
          </div>
        </div>

        {/* Live Slots Capacity Indicator */}
        <SlotsIndicator />
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* App Switcher (InHubFlow Suite) */}
        <div className="relative" ref={suiteRef}>
          <button
            onClick={() => setIsSuiteOpen(!isSuiteOpen)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            title="InHubFlow Apps"
          >
            <RiApps2Line size={18} />
          </button>

          {isSuiteOpen && (
            <div className="absolute right-0 mt-2 w-72 origin-top-right rounded-2xl border border-gray-200 bg-white p-3 shadow-xl backdrop-blur-md dark:border-gray-800 dark:bg-gray-900 z-50">
              <div className="px-2 py-1.5 border-b border-gray-100 dark:border-gray-800 mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  InHubFlow Suite
                </p>
              </div>

              <div className="space-y-1">
                <a
                  href="https://b2c.inhubflow.online"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 group"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                    <RiMessage3Line size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-900 dark:text-white">
                      InHub Omnichannel B2C
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      WhatsApp, Instagram & Chatwoot (4 Agentes)
                    </p>
                  </div>
                </a>

                <div className="flex items-center gap-3 rounded-xl p-2.5 bg-brand-500/10 border border-brand-500/20">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
                    <RiSendPlaneLine size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-brand-600 dark:text-brand-400">
                        InHub Outreach B2B
                      </p>
                      <span className="text-[10px] font-bold px-1.5 py-0.2 bg-brand-500 text-white rounded">
                        Activo
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      LinkedIn & Cold Email (4 Slots)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          title={theme === "dark" ? "Cambiar a Modo Claro" : "Cambiar a Modo Oscuro"}
        >
          {theme === "dark" ? (
            <RiSunLine size={18} className="text-amber-400" />
          ) : (
            <RiMoonLine size={18} className="text-gray-700" />
          )}
        </button>

        {/* Language Dropdown */}
        <div className="relative" ref={langRef}>
          <button
            onClick={() => setIsLangOpen(!isLangOpen)}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-gray-200 px-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <span className="text-sm">
              {supportedLocales.find((l) => l.code === locale)?.flag}
            </span>
            <span className="hidden sm:inline uppercase font-bold text-[11px]">
              {locale}
            </span>
          </button>

          {isLangOpen && (
            <div className="absolute right-0 mt-2 w-44 origin-top-right rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl backdrop-blur-md dark:border-gray-800 dark:bg-gray-900 z-50">
              <div className="px-2.5 py-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                {t("settings.language")}
              </div>
              {supportedLocales.map((l) => (
                <button
                  key={l.code}
                  onClick={() => {
                    setLocale(l.code);
                    setIsLangOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-colors ${
                    locale === l.code
                      ? "bg-brand-500/10 font-semibold text-brand-600 dark:text-brand-400"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{l.flag}</span>
                    <span>{l.label}</span>
                  </div>
                  {locale === l.code && <RiCheckLine size={14} className="text-brand-500" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* User Profile Dropdown */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => setIsUserOpen(!isUserOpen)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 p-1.5 transition-colors hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-gray-800"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-brand-500 to-indigo-500 text-xs font-bold text-white shadow-sm">
              {session?.user?.email ? session.user.email[0].toUpperCase() : "U"}
            </div>
            <span className="hidden md:inline max-w-[120px] truncate text-xs font-medium text-gray-700 dark:text-gray-300">
              {session?.user?.email ?? "Usuario"}
            </span>
          </button>

          {isUserOpen && (
            <div className="absolute right-0 mt-2 w-56 origin-top-right rounded-2xl border border-gray-200 bg-white p-2 shadow-xl backdrop-blur-md dark:border-gray-800 dark:bg-gray-900 z-50">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 mb-1">
                <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                  {session?.user?.email ?? "Usuario"}
                </p>
                <p className="text-[11px] text-gray-400">InHub Administrator</p>
              </div>

              <a
                href="/settings"
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
                onClick={() => setIsUserOpen(false)}
              >
                <RiUserLine size={15} />
                <span>{t("nav.settings")}</span>
              </a>

              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 transition-colors"
              >
                <RiLogoutBoxRLine size={15} />
                <span>{t("nav.logout")}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
