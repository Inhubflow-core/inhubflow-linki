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
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4 shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 text-primary flex items-center justify-center border border-primary/20 shadow-2xs">
                <RiKanbanView size={20} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-base-content flex items-center gap-2">
                  Pipeline de Oportunidades
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {totalCards} prospectos
                  </span>
                </h1>
                <p className="text-xs text-base-content/60">
                  Gestión inteligente de embudo comercial y sincronización en tiempo real con SDR IA
                </p>
              </div>
            </div>
          </div>

          {/* Right Top Actions */}
          <div className="flex items-center gap-2">
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

            {/* Refresh */}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn btn-sm btn-outline border-base-300 gap-1 text-xs"
              title="Actualizar datos"
            >
              <RiRefreshLine size={14} className={refreshing ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-base-100 border border-base-300/80 rounded-2xl p-3 mb-4 shrink-0 shadow-2xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
            {/* Search */}
            <div className="relative min-w-[180px] max-w-xs flex-1">
              <RiSearchLine
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40"
              />
              <input
                type="text"
                placeholder="Buscar prospecto, empresa..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input input-sm input-bordered w-full pl-8 text-xs"
              />
            </div>

            {/* Filter by Campaign/Workflow */}
            <div className="relative">
              <select
                value={selectedWorkflow}
                onChange={(e) => setSelectedWorkflow(e.target.value)}
                className="select select-sm select-bordered text-xs font-medium pr-8"
              >
                <option value="">Todas las Campañas</option>
                {initialWorkflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter by List */}
            <div className="relative">
              <select
                value={selectedList}
                onChange={(e) => setSelectedList(e.target.value)}
                className="select select-sm select-bordered text-xs font-medium pr-8"
              >
                <option value="">Todas las Listas</option>
                {initialLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter by Channel */}
            <div className="join border border-base-300 rounded-lg p-0.5 bg-base-200/40">
              <button
                type="button"
                onClick={() => setChannelFilter("all")}
                className={`join-item btn btn-xs ${
                  channelFilter === "all" ? "btn-primary font-semibold" : "btn-ghost text-base-content/60"
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setChannelFilter("linkedin")}
                className={`join-item btn btn-xs ${
                  channelFilter === "linkedin" ? "btn-primary font-semibold" : "btn-ghost text-base-content/60"
                }`}
              >
                LinkedIn
              </button>
              <button
                type="button"
                onClick={() => setChannelFilter("email")}
                className={`join-item btn btn-xs ${
                  channelFilter === "email" ? "btn-primary font-semibold" : "btn-ghost text-base-content/60"
                }`}
              >
                Email
              </button>
            </div>
          </div>

          {/* Quick toggle: Needs Human Attention */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlyHuman((prev) => !prev)}
              className={`btn btn-xs rounded-lg gap-1.5 transition-colors ${
                onlyHuman
                  ? "btn-error text-white font-semibold"
                  : "btn-outline border-base-300 text-base-content/60 hover:text-base-content"
              }`}
            >
              <RiAlertLine size={13} className={onlyHuman ? "animate-bounce" : ""} />
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
