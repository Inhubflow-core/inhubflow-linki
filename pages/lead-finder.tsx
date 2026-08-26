import Head from "next/head";
import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import {
  RiUserSearchLine,
  RiSearchLine,
  RiBuildingLine,
  RiMapPinLine,
  RiBriefcaseLine,
  RiFileList3Line,
  RiExternalLinkLine,
  RiArrowRightLine,
  RiShieldCheckLine,
  RiAlertLine,
  RiFlashlightLine,
  RiCheckboxCircleLine,
  RiSparklingLine,
  RiRadarLine,
  RiUserLine,
  RiRefreshLine,
  RiCheckLine,
  RiSettings4Line,
} from "react-icons/ri";

interface Account {
  id: string;
  name: string;
  email: string;
  is_authenticated: number;
}

interface Lead {
  linkedinUrl: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  profileImageUrl: string | null;
  degree: number | null;
  summary: string | null;
}

interface LeadFinderProps {
  accounts: Account[];
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const accounts = db
    .prepare(
      "SELECT id, name, email, is_authenticated FROM accounts ORDER BY is_authenticated DESC, name ASC"
    )
    .all() as Account[];
  return { props: { accounts } };
};

const SAMPLE_TITLES = ["CEO", "Director de Marketing", "Dentista", "Abogado", "CTO", "Founder", "Gerente de Ventas"];
const SAMPLE_LOCATIONS = [
  "Madrid, España",
  "Barcelona, España",
  "São Paulo, Brasil",
  "Bogotá, Colombia",
  "Ciudad de México",
  "Buenos Aires, Argentina",
  "Santiago, Chile",
  "Miami, Estados Unidos",
];

export default function LeadFinderPage({ accounts: initialAccounts }: LeadFinderProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const authenticatedAccounts = accounts.filter((a) => a.is_authenticated === 1);

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    authenticatedAccounts[0]?.id || accounts[0]?.id || ""
  );

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [company, setCompany] = useState("");
  const [limit, setLimit] = useState(25);
  const [listName, setListName] = useState("");
  const [customListName, setCustomListName] = useState(false);

  const [isSearching, setIsSearching] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [completedResult, setCompletedResult] = useState<{
    listId: string;
    listName: string;
    totalFound: number;
    importedCount: number;
    updatedCount: number;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  // Auto-generate a list name based on filters if user hasn't explicitly customized it
  useEffect(() => {
    if (!customListName) {
      const parts = [title.trim(), location.trim()].filter(Boolean);
      const dateStr = new Date().toLocaleDateString("es-ES", { month: "short", year: "numeric" });
      if (parts.length > 0) {
        setListName(`${parts.join(" - ")} (${dateStr})`);
      } else {
        setListName(`Prospectos LinkedIn (${dateStr})`);
      }
    }
  }, [title, location, customListName]);

  // Keep accounts updated if user authenticated elsewhere
  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAccounts(data);
          if (!selectedAccountId) {
            const authAcc = data.find((a) => a.is_authenticated === 1);
            if (authAcc) setSelectedAccountId(authAcc.id);
          }
        }
      })
      .catch(() => {});
  }, [selectedAccountId]);

  async function handleStartSearch(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedAccountId) {
      toast.error("Por favor selecciona una cuenta de LinkedIn conectada.");
      return;
    }

    const selectedAcc = accounts.find((a) => a.id === selectedAccountId);
    if (!selectedAcc?.is_authenticated) {
      toast.error("La cuenta seleccionada no está autenticada. Ve a Ajustes para iniciar sesión en LinkedIn.");
      return;
    }

    if (!title.trim() && !location.trim() && !company.trim()) {
      toast.error("Por favor ingresa al menos un Cargo o Ubicación para buscar.");
      return;
    }

    setIsSearching(true);
    setLeads([]);
    setCompletedResult(null);
    setProgressPercent(5);
    setProgressMessage("Conectando con el navegador seguro de LinkedIn...");
    setCurrentPage(1);
    setTotalPages(Math.ceil(limit / 10));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/linkedin/search-and-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          accountId: selectedAccountId,
          title: title.trim(),
          location: location.trim(),
          company: company.trim(),
          limit,
          listName: listName.trim() || undefined,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Error ${response.status}: No se pudo procesar la búsqueda.`);
      }

      if (!response.body) {
        throw new Error("El servidor no devolvió un flujo de eventos.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed) continue;

          let eventName = "message";
          let dataStr = "";

          for (const line of trimmed.split("\n")) {
            if (line.startsWith("event: ")) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataStr = line.slice(6).trim();
            }
          }

          if (!dataStr) continue;

          try {
            const parsedData = JSON.parse(dataStr);

            if (eventName === "init") {
              setProgressMessage(parsedData.message || "Buscando perfiles...");
            } else if (eventName === "progress") {
              if (parsedData.message) setProgressMessage(parsedData.message);
              if (parsedData.page) setCurrentPage(parsedData.page);
              if (parsedData.totalPages) setTotalPages(parsedData.totalPages);

              const estPages = parsedData.totalPages || Math.ceil(limit / 10);
              const curP = parsedData.page || 1;
              const found = parsedData.totalFound || 0;
              const calcPct = Math.min(
                Math.round((found / limit) * 85 + (curP / estPages) * 10),
                95
              );
              setProgressPercent(Math.max(calcPct, 15));
            } else if (eventName === "lead") {
              const newLead = parsedData as Lead;
              setLeads((prev) => {
                if (prev.some((l) => l.linkedinUrl === newLead.linkedinUrl)) return prev;
                return [...prev, newLead];
              });
            } else if (eventName === "saving") {
              setProgressMessage(parsedData.message || "Guardando en lista...");
              setProgressPercent(95);
            } else if (eventName === "complete") {
              setProgressPercent(100);
              const foundCount = parsedData.totalFound || leads.length;
              setProgressMessage(
                parsedData.message ||
                  (foundCount > 0 ? "¡Búsqueda y guardado completados!" : "No se encontraron resultados para esta búsqueda.")
              );
              setCompletedResult({
                listId: parsedData.listId,
                listName: parsedData.listName,
                totalFound: foundCount,
                importedCount: parsedData.importedCount || 0,
                updatedCount: parsedData.updatedCount || 0,
              });
              if (foundCount > 0) {
                toast.success(
                  `¡Lista "${parsedData.listName}" creada con éxito con ${foundCount} prospectos!`
                );
              } else {
                toast.info(
                  "No se encontraron perfiles con estos filtros. Prueba simplificar la búsqueda."
                );
              }
            } else if (eventName === "error") {
              throw new Error(parsedData.error || "Ocurrió un error en la búsqueda de LinkedIn.");
            }
          } catch (e: unknown) {
            if (e instanceof Error && e.name === "AbortError") throw e;
            console.error("Error parsing SSE block:", e);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        toast.info("Búsqueda cancelada por el usuario.");
      } else {
        const msg = err instanceof Error ? err.message : "Error inesperado al buscar en LinkedIn.";
        toast.error(msg);
        setProgressMessage(`Error: ${msg}`);
      }
    } finally {
      setIsSearching(false);
      abortControllerRef.current = null;
    }
  }

  function handleCancelSearch() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  const hasAuthAccount = authenticatedAccounts.length > 0;

  return (
    <>
      <Head>
        <title>🎯 Lead Finder — Captador de Prospectos de LinkedIn | InHubFlow</title>
        <meta
          name="description"
          content="Busca y extrae prospectos de LinkedIn directamente por Cargo, Ciudad y País y crea listas automáticas sin Sales Navigator."
        />
      </Head>

      <div className="space-y-6 pb-12">
        {/* Top Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-rose-500/10 via-brand-500/10 to-indigo-500/10 dark:from-rose-950/30 dark:via-brand-950/30 dark:to-indigo-950/30 border border-rose-500/20 dark:border-rose-500/10 p-5 md:p-6 rounded-2xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500 text-white shadow-xs">
                <RiSparklingLine size={13} /> NATIVO
              </span>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                Lead Finder en LinkedIn
              </h1>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Busca perfiles por Cargo, Ciudad y País y guárdalos automáticamente en una Lista de Linki sin suscripciones externas de pago.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/lists"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiFileList3Line size={16} /> Ver Mis Listas
            </Link>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiSettings4Line size={16} /> Cuentas
            </Link>
          </div>
        </div>

        {/* Warning if no authenticated account */}
        {!hasAuthAccount && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-300">
            <RiAlertLine size={20} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 text-sm space-y-1">
              <p className="font-semibold">No tienes ninguna cuenta de LinkedIn autenticada.</p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Para buscar perfiles en LinkedIn en vivo necesitas conectar e iniciar sesión con al menos una cuenta en la sección de Ajustes.
              </p>
            </div>
            <Link
              href="/settings"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white transition-all shrink-0"
            >
              Conectar Cuenta
            </Link>
          </div>
        )}

        {/* 2-Column Grid: Form & Results */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Search Form (5 cols on lg) */}
          <div className="lg:col-span-5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 md:p-6 shadow-theme-xs space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <RiSearchLine className="text-rose-500" /> Criterios de Prospección
              </h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">Paso 1 de 2</span>
            </div>

            <form onSubmit={handleStartSearch} className="space-y-4">
              {/* Account Selector */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  👤 Cuenta de LinkedIn
                </label>
                <div className="relative">
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    disabled={isSearching}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm font-medium text-gray-900 transition-all focus:border-rose-500 focus:bg-white focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-rose-500"
                  >
                    {accounts.length === 0 && <option value="">No hay cuentas registradas</option>}
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.email}) — {acc.is_authenticated ? "🟢 Conectada" : "🔴 Desconectada"}
                      </option>
                    ))}
                  </select>
                </div>
                {accounts.length > 0 && selectedAccountId && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {accounts.find((a) => a.id === selectedAccountId)?.is_authenticated ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <RiShieldCheckLine size={14} /> Sesión activa y segura con Playwright Stealth
                      </span>
                    ) : (
                      <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                        <RiAlertLine size={14} /> Requiere iniciar sesión en Ajustes
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Title / Cargo */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  👔 Cargo / Título Profesional <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <RiBriefcaseLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={isSearching}
                    placeholder="ej: CEO, Director de Marketing, Dentista, Abogado..."
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-3.5 py-2.5 text-sm text-gray-900 transition-all placeholder:text-gray-400 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-rose-500"
                  />
                </div>
                {/* Suggestions */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SAMPLE_TITLES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setTitle(st)}
                      disabled={isSearching}
                      className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-gray-100 text-gray-600 hover:bg-rose-50 hover:text-rose-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-colors"
                    >
                      +{st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Location */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  🏙️ Ubicación (Ciudad, País) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <RiMapPinLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    disabled={isSearching}
                    placeholder="ej: Madrid, España | São Paulo, Brasil | Bogotá..."
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-3.5 py-2.5 text-sm text-gray-900 transition-all placeholder:text-gray-400 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-rose-500"
                  />
                </div>
                {/* Suggestions */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SAMPLE_LOCATIONS.slice(0, 4).map((sl) => (
                    <button
                      key={sl}
                      type="button"
                      onClick={() => setLocation(sl)}
                      disabled={isSearching}
                      className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-gray-100 text-gray-600 hover:bg-rose-50 hover:text-rose-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-colors"
                    >
                      +{sl}
                    </button>
                  ))}
                </div>
              </div>

              {/* Company / Industry (Optional) */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  🏢 Empresa o Industria <span className="text-gray-400 font-normal">(Opcional)</span>
                </label>
                <div className="relative">
                  <RiBuildingLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    disabled={isSearching}
                    placeholder="ej: Salud, SaaS, Inmobiliaria, Google..."
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-3.5 py-2.5 text-sm text-gray-900 transition-all placeholder:text-gray-400 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-rose-500"
                  />
                </div>
              </div>

              {/* Quantity Limit */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  🔢 Cantidad de Prospectos a Extraer
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[10, 25, 50, 100].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setLimit(val)}
                      disabled={isSearching}
                      className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                        limit === val
                          ? "bg-rose-500 border-rose-500 text-white shadow-xs"
                          : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                      }`}
                    >
                      {val} leads
                    </button>
                  ))}
                </div>
              </div>

              {/* Target List Name */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  📋 Nombre de la Lista a Crear
                </label>
                <div className="relative">
                  <RiFileList3Line className="absolute left-3.5 top-3 text-gray-400" size={16} />
                  <input
                    type="text"
                    value={listName}
                    onChange={(e) => {
                      setListName(e.target.value);
                      setCustomListName(true);
                    }}
                    disabled={isSearching}
                    placeholder="ej: CEOs Madrid - Agosto 2026"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-3.5 py-2.5 text-sm text-gray-900 transition-all placeholder:text-gray-400 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-rose-500"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-2">
                {!isSearching ? (
                  <button
                    type="submit"
                    disabled={!hasAuthAccount}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 shadow-md shadow-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-[0.99]"
                  >
                    <RiFlashlightLine size={18} /> Buscar Perfiles y Crear Lista
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled
                      className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-rose-600 opacity-90 cursor-wait shadow-sm"
                    >
                      <RiRefreshLine className="animate-spin" size={18} /> Captando Leads ({leads.length}/{limit})...
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelSearch}
                      className="py-3 px-4 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                      Detener
                    </button>
                  </div>
                )}
              </div>
            </form>
          </div>

          {/* Right Column: Radar & Results (7 cols on lg) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Live Progress Card (Visible when searching or completed) */}
            {(isSearching || completedResult) && (
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 md:p-6 shadow-theme-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
                      {isSearching ? (
                        <>
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-xl bg-rose-400 opacity-30"></span>
                          <RiRadarLine size={22} className="animate-pulse" />
                        </>
                      ) : (
                        <RiCheckboxCircleLine size={24} className="text-emerald-500" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                        {isSearching ? "Escaneando LinkedIn en tiempo real" : "Extracción Finalizada"}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-sm md:max-w-md">
                        {progressMessage || "Procesando búsqueda..."}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
                      {leads.length} / {limit} leads
                    </span>
                    <p className="text-[11px] text-gray-400">
                      {isSearching ? `Página ${currentPage} de ~${totalPages}` : "100% Completado"}
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      completedResult ? "bg-emerald-500" : "bg-gradient-to-r from-rose-500 to-brand-500"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Completion Action Banner */}
                {completedResult && completedResult.totalFound > 0 && (
                  <div className="mt-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                        <RiCheckLine size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                          Lista &quot;{completedResult.listName}&quot; lista para prospección
                        </p>
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                          {completedResult.totalFound} contactos guardados en SQLite
                        </p>
                      </div>
                    </div>

                    <Link
                      href={`/lists/${completedResult.listId}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shrink-0 shadow-xs"
                    >
                      Abrir Lista <RiArrowRightLine size={14} />
                    </Link>
                  </div>
                )}

                {completedResult && completedResult.totalFound === 0 && (
                  <div className="mt-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex items-start gap-2.5">
                    <RiAlertLine size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1 text-amber-800 dark:text-amber-300">
                      <p className="font-semibold">No se encontraron perfiles con estos criterios específicos.</p>
                      <p className="text-amber-700 dark:text-amber-400">
                        💡 <strong>Consejo:</strong> Prueba simplificando la búsqueda dejando el campo de Empresa vacío, o usando un cargo más general (ej. <em>CEO</em>, <em>Director</em>, <em>Dentista</em>).
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Results Table / Cards */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-theme-xs overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <RiUserSearchLine className="text-rose-500" size={18} />
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                    Resultados Captados ({leads.length})
                  </h3>
                </div>

                {leads.length > 0 && (
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Vista previa en tiempo real
                  </span>
                )}
              </div>

              {leads.length === 0 ? (
                <div className="p-12 text-center space-y-3">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 dark:bg-rose-950/30">
                    <RiUserSearchLine size={28} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                      Listo para buscar y captar leads
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                      Ingresa el cargo y la ubicación que te interesan en el formulario y haz clic en{" "}
                      <span className="font-semibold text-rose-600 dark:text-rose-400">
                        &quot;Buscar Perfiles y Crear Lista&quot;
                      </span>
                      .
                    </p>
                  </div>
                  <div className="pt-2 flex items-center justify-center gap-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <RiShieldCheckLine size={13} className="text-emerald-500" /> Sin límites de Sales Navigator
                    </span>
                    <span>•</span>
                    <span>Modo Stealth Automático</span>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[580px] overflow-y-auto">
                  {leads.map((lead, idx) => (
                    <div
                      key={lead.linkedinUrl || idx}
                      className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors flex items-start gap-3.5"
                    >
                      {/* Avatar */}
                      <div className="relative h-11 w-11 rounded-xl overflow-hidden shrink-0 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                        {lead.profileImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={lead.profileImageUrl}
                            alt={lead.fullName}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <RiUserLine className="text-gray-400" size={20} />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                            {lead.fullName}
                          </span>
                          {lead.degree && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                              {lead.degree}º
                            </span>
                          )}
                          {lead.company && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                              <RiBuildingLine size={11} /> {lead.company}
                            </span>
                          )}
                        </div>

                        {lead.title && (
                          <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed">
                            {lead.title}
                          </p>
                        )}

                        {lead.location && (
                          <p className="text-[11px] text-gray-400 flex items-center gap-1">
                            <RiMapPinLine size={12} /> {lead.location}
                          </p>
                        )}
                      </div>

                      {/* LinkedIn Link */}
                      <div className="shrink-0 pt-0.5">
                        <a
                          href={lead.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Ver perfil en LinkedIn"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-rose-600 dark:hover:bg-gray-800 dark:hover:text-rose-400 transition-colors"
                        >
                          <RiExternalLinkLine size={16} />
                        </a>
                      </div>
                    </div>
                  ))}
                  <div ref={resultsEndRef} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
