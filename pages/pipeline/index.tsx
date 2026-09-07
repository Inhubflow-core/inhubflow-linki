import Head from "next/head";
import Link from "next/link";
import { useState, useEffect, useCallback, useTransition } from "react";
import type { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiKanbanView,
  RiListCheck2,
  RiSearchLine,
  RiRefreshLine,
  RiFilter3Line,
  RiAlertLine,
  RiFlowChart,
  RiFileList3Line,
  RiUserSearchLine,
} from "react-icons/ri";
import { toast } from "sonner";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import type {
  PipelineCard,
  PipelineStageWithCount,
  PipelineFilterOptions,
} from "@/lib/pipeline/pipeline-service";

interface PipelinePageProps {
  initialLists: Array<{ id: string; name: string }>;
  initialWorkflows: Array<{ id: string; name: string }>;
}

export const getServerSideProps: GetServerSideProps<PipelinePageProps> = async () => {
  const db = getDb();
  const initialLists = db
    .prepare("SELECT id, name FROM lists ORDER BY name COLLATE NOCASE ASC")
    .all() as Array<{ id: string; name: string }>;

  const initialWorkflows = db
    .prepare("SELECT id, name FROM workflows ORDER BY name COLLATE NOCASE ASC")
    .all() as Array<{ id: string; name: string }>;

  return {
    props: {
      initialLists,
      initialWorkflows,
    },
  };
};

export default function PipelinePage({
  initialLists,
  initialWorkflows,
}: PipelinePageProps) {
  const { t } = useTranslation();

  // Filters state
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>("");
  const [selectedList, setSelectedList] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [channelFilter, setChannelFilter] = useState<"all" | "linkedin" | "email">("all");
  const [onlyHuman, setOnlyHuman] = useState(false);

  // Board data state
  const [stages, setStages] = useState<PipelineStageWithCount[]>([]);
  const [cardsByStage, setCardsByStage] = useState<Record<string, PipelineCard[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [, startTransition] = useTransition();

  const fetchBoardData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedWorkflow) params.set("workflowId", selectedWorkflow);
      if (selectedList) params.set("listId", selectedList);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      if (channelFilter !== "all") params.set("channel", channelFilter);
      if (onlyHuman) params.set("onlyHumanIntervention", "true");

      const [stagesRes, cardsRes] = await Promise.all([
        fetch(`/api/pipeline/stages?${params.toString()}`),
        fetch(`/api/pipeline/cards?${params.toString()}`),
      ]);

      if (!stagesRes.ok || !cardsRes.ok) {
        throw new Error("Error al cargar datos del pipeline");
      }

      const stagesData = await stagesRes.json();
      const cardsData = await cardsRes.json();

      startTransition(() => {
        setStages(stagesData.stages || []);
        setCardsByStage(cardsData.cardsByStage || {});
      });
    } catch (err: unknown) {
      console.error(err);
      toast.error("No se pudo cargar el Pipeline");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedWorkflow, selectedList, searchTerm, channelFilter, onlyHuman]);

  useEffect(() => {
    setLoading(true);
    fetchBoardData();
  }, [fetchBoardData]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchBoardData();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, fetchBoardData]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchBoardData();
  }

  // Optimistic drag and drop update
  async function handleCardMoved(
    cardId: string,
    fromStageId: string,
    toStageId: string
  ) {
    // 1. Snapshot previous state for rollback
    const previousCards = { ...cardsByStage };
    const cardToMove = (cardsByStage[fromStageId] || []).find((c) => c.id === cardId);

    if (!cardToMove) return;

    // 2. Optimistic update
    const updatedCard: PipelineCard = {
      ...cardToMove,
      stage_id: toStageId,
      stage_updated_at: new Date().toISOString(),
    };

    setCardsByStage((prev) => ({
      ...prev,
      [fromStageId]: (prev[fromStageId] || []).filter((c) => c.id !== cardId),
      [toStageId]: [updatedCard, ...(prev[toStageId] || [])],
    }));

    // Update stages counts optimistically
    setStages((prev) =>
      prev.map((s) => {
        if (s.id === fromStageId) return { ...s, target_count: Math.max(0, s.target_count - 1) };
        if (s.id === toStageId) return { ...s, target_count: s.target_count + 1 };
        return s;
      })
    );

    // 3. API persistence
    try {
      const res = await fetch("/api/pipeline/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: cardId, stageId: toStageId }),
      });

      if (!res.ok) {
        throw new Error("Error al persistir movimiento en servidor");
      }
    } catch (err: unknown) {
      // Rollback on error
      setCardsByStage(previousCards);
      toast.error("Error al mover el prospecto. Se restauró la posición.");
      console.error(err);
    }
  }

  const totalCards = Object.values(cardsByStage).reduce((acc, list) => acc + list.length, 0);

  return (
    <>
      <Head>
        <title>Pipeline — Dashboard B2B</title>
      </Head>

      <div className="flex flex-col h-[calc(100vh-4rem)] p-4 md:p-6 overflow-hidden">
        {/* Top Header Banner (Matching other pages) */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl mb-6 shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                Pipeline
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-600 dark:text-brand-400">
                {totalCards.toLocaleString()} {totalCards === 1 ? "prospecto" : "prospectos"}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Gestión visual de embudo comercial y sincronización en tiempo real con SDR IA.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* View switcher: Table vs Kanban */}
            <div className="join border border-base-300 rounded-lg p-0.5 bg-base-200/50">
              <Link
                href="/contacts"
                className="join-item btn btn-xs btn-ghost gap-1 text-base-content/60 hover:text-base-content"
                title="Ver lista tabular de contactos"
              >
                <RiListCheck2 size={13} />
                Tabla
              </Link>
              <button
                type="button"
                className="join-item btn btn-xs btn-primary gap-1 shadow-2xs font-semibold"
                title="Vista actual: Tablero Kanban"
              >
                <RiKanbanView size={13} />
                Kanban
              </button>
            </div>

            <Link
              href="/lead-finder"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiUserSearchLine size={16} /> {t("nav.leadFinder")}
            </Link>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiRefreshLine size={16} className={refreshing ? "animate-spin" : ""} />
              Actualizar
            </button>
          </div>
        </div>

        {/* Filter row (Clean style like contacts) */}
        <div className="flex items-center gap-3 mb-5 flex-wrap shrink-0">
          {/* Search */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/30 pointer-events-none">
              <RiSearchLine size={13} />
            </span>
            <input
              type="text"
              className="w-56 bg-base-200 border border-base-300/50 rounded-lg pl-8 pr-3 py-1.5 text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/40"
              placeholder="Buscar prospecto, empresa..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Workflow selector */}
          <select
            className="bg-base-200 border border-base-300/50 rounded-lg px-2.5 py-1.5 text-sm text-base-content focus:outline-none focus:border-primary/40 h-8"
            value={selectedWorkflow}
            onChange={(e) => setSelectedWorkflow(e.target.value)}
          >
            <option value="">Todas las Campañas</option>
            {initialWorkflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>

          {/* List selector */}
          <select
            className="bg-base-200 border border-base-300/50 rounded-lg px-2.5 py-1.5 text-sm text-base-content focus:outline-none focus:border-primary/40 h-8"
            value={selectedList}
            onChange={(e) => setSelectedList(e.target.value)}
          >
            <option value="">Todas las Listas</option>
            {initialLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>

          {/* Channel selector */}
          <div className="join border border-base-300/50 rounded-lg p-0.5 bg-base-200 h-8 flex items-center">
            <button
              type="button"
              onClick={() => setChannelFilter("all")}
              className={`join-item px-2.5 py-1 rounded text-xs transition-colors ${
                channelFilter === "all" ? "bg-brand-500 text-white font-medium shadow-xs" : "text-base-content/60 hover:text-base-content"
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setChannelFilter("linkedin")}
              className={`join-item px-2.5 py-1 rounded text-xs transition-colors ${
                channelFilter === "linkedin" ? "bg-brand-500 text-white font-medium shadow-xs" : "text-base-content/60 hover:text-base-content"
              }`}
            >
              LinkedIn
            </button>
            <button
              type="button"
              onClick={() => setChannelFilter("email")}
              className={`join-item px-2.5 py-1 rounded text-xs transition-colors ${
                channelFilter === "email" ? "bg-brand-500 text-white font-medium shadow-xs" : "text-base-content/60 hover:text-base-content"
              }`}
            >
              Email
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlyHuman((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                onlyHuman
                  ? "bg-error/15 text-error border-error/30 font-semibold"
                  : "bg-base-200 border-base-300/50 text-base-content/60 hover:text-base-content"
              }`}
            >
              <RiAlertLine size={13} />
              Solo requiere humano
            </button>
          </div>
        </div>

        {/* Board Component */}
        <KanbanBoard
          stages={stages}
          cardsByStage={cardsByStage}
          onCardMoved={handleCardMoved}
          onReload={fetchBoardData}
          loading={loading}
        />
      </div>
    </>
  );
}
