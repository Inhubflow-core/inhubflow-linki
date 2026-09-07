import React, { useState } from "react";
import {
  RiAddLine,
  RiMore2Fill,
  RiEditLine,
  RiDeleteBinLine,
  RiLoader4Line,
} from "react-icons/ri";
import { toast } from "sonner";
import { KanbanCard } from "./KanbanCard";
import { LeadDrawer } from "./LeadDrawer";
import type { PipelineCard, PipelineStageWithCount } from "@/lib/pipeline/pipeline-service";

interface KanbanBoardProps {
  stages: PipelineStageWithCount[];
  cardsByStage: Record<string, PipelineCard[]>;
  onCardMoved: (cardId: string, fromStageId: string, toStageId: string) => Promise<void>;
  onReload: () => Promise<void>;
  loading?: boolean;
}

const PRESET_COLORS = [
  "#3b82f6", // Blue
  "#06b6d4", // Cyan
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#ec4899", // Pink
  "#ef4444", // Red
  "#64748b", // Slate
];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  stages,
  cardsByStage,
  onCardMoved,
  onReload,
  loading = false,
}) => {
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<PipelineCard | null>(null);

  // Stage creation / editing modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<PipelineStageWithCount | null>(null);
  const [stageName, setStageName] = useState("");
  const [stageColor, setStageColor] = useState("#3b82f6");
  const [savingStage, setSavingStage] = useState(false);

  function handleDragStart(e: React.DragEvent, cardId: string) {
    setDraggedCardId(cardId);
    e.dataTransfer.setData("text/plain", cardId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverStageId !== stageId) {
      setDragOverStageId(stageId);
    }
  }

  function handleDragLeave(e: React.DragEvent, stageId: string) {
    // Check if truly leaving the column
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX >= rect.right ||
      e.clientY < rect.top ||
      e.clientY >= rect.bottom
    ) {
      if (dragOverStageId === stageId) {
        setDragOverStageId(null);
      }
    }
  }

  async function handleDrop(e: React.DragEvent, targetStageId: string) {
    e.preventDefault();
    setDragOverStageId(null);
    const cardId = e.dataTransfer.getData("text/plain") || draggedCardId;
    setDraggedCardId(null);

    if (!cardId) return;

    // Find current stage of card
    let fromStageId: string | null = null;
    for (const [stId, cards] of Object.entries(cardsByStage)) {
      if (cards.some((c) => c.id === cardId)) {
        fromStageId = stId;
        break;
      }
    }

    if (!fromStageId || fromStageId === targetStageId) return;

    try {
      await onCardMoved(cardId, fromStageId, targetStageId);
    } catch {
      toast.error("Error al mover el prospecto");
    }
  }

  function openCreateStageModal() {
    setEditingStage(null);
    setStageName("");
    setStageColor(PRESET_COLORS[0]);
    setModalOpen(true);
  }

  function openEditStageModal(stage: PipelineStageWithCount) {
    setEditingStage(stage);
    setStageName(stage.name);
    setStageColor(stage.color);
    setModalOpen(true);
  }

  async function handleSaveStage() {
    if (!stageName.trim() || savingStage) return;
    setSavingStage(true);
    try {
      if (editingStage) {
        // Edit existing
        const res = await fetch("/api/pipeline/stages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingStage.id,
            name: stageName.trim(),
            color: stageColor,
          }),
        });
        if (!res.ok) throw new Error("Error al actualizar la etapa");
        toast.success("Etapa actualizada");
      } else {
        // Create new
        const res = await fetch("/api/pipeline/stages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: stageName.trim(),
            color: stageColor,
          }),
        });
        if (!res.ok) throw new Error("Error al crear la etapa");
        toast.success("Etapa creada");
      }
      setModalOpen(false);
      await onReload();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSavingStage(false);
    }
  }

  async function handleDeleteStage(stage: PipelineStageWithCount) {
    if (stage.is_system) {
      toast.error("Las etapas del sistema no se pueden eliminar");
      return;
    }
    if (!confirm(`¿Eliminar la etapa "${stage.name}"? Los prospectos serán reasignados a "Contactado".`)) {
      return;
    }

    try {
      const res = await fetch(`/api/pipeline/stages?id=${stage.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Error al eliminar");
      toast.success("Etapa eliminada");
      await onReload();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  return (
    <div className="relative flex-1 overflow-x-auto overflow-y-hidden pb-4">
      {loading && (
        <div className="absolute inset-0 bg-base-100/50 backdrop-blur-2xs flex items-center justify-center z-30">
          <RiLoader4Line size={32} className="animate-spin text-primary" />
        </div>
      )}

      {/* Columns Container */}
      <div className="inline-flex items-start gap-4 min-h-[calc(100vh-220px)] px-2">
        {stages.map((stage) => {
          const cards = cardsByStage[stage.id] || [];
          const isDragOver = dragOverStageId === stage.id;

          return (
            <div
              key={stage.id}
              onDragOver={(e) => handleDragOver(e, stage.id)}
              onDragLeave={(e) => handleDragLeave(e, stage.id)}
              onDrop={(e) => handleDrop(e, stage.id)}
              className={`w-72 shrink-0 flex flex-col rounded-2xl bg-base-200/50 border transition-all duration-150 ${
                isDragOver
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-base-300/70"
              }`}
              style={{ maxHeight: "calc(100vh - 220px)" }}
            >
              {/* Column Header */}
              <div className="p-3.5 border-b border-base-300/60 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full shrink-0 shadow-2xs"
                    style={{ backgroundColor: stage.color }}
                  />
                  <h3 className="font-semibold text-xs text-base-content truncate">
                    {stage.name}
                  </h3>
                  <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-base-300 text-base-content/70">
                    {cards.length}
                  </span>
                </div>

                {/* Stage options dropdown */}
                <div className="dropdown dropdown-end">
                  <button
                    tabIndex={0}
                    type="button"
                    className="p-1 rounded-md text-base-content/40 hover:text-base-content hover:bg-base-300/60 transition-colors"
                  >
                    <RiMore2Fill size={15} />
                  </button>
                  <ul
                    tabIndex={0}
                    className="dropdown-content z-20 menu p-1 shadow-lg bg-base-100 rounded-box w-40 border border-base-300 text-xs"
                  >
                    <li>
                      <button onClick={() => openEditStageModal(stage)}>
                        <RiEditLine size={13} /> Renombrar / Color
                      </button>
                    </li>
                    {!stage.is_system && (
                      <li>
                        <button
                          onClick={() => handleDeleteStage(stage)}
                          className="text-error hover:bg-error/10"
                        >
                          <RiDeleteBinLine size={13} /> Eliminar columna
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              {/* Cards Container */}
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                {cards.map((card) => (
                  <KanbanCard
                    key={card.id}
                    card={card}
                    onSelect={(c) => setSelectedCard(c)}
                    onDragStart={handleDragStart}
                  />
                ))}

                {cards.length === 0 && (
                  <div className="h-28 border border-dashed border-base-300 rounded-xl flex items-center justify-center text-xs text-base-content/40">
                    Arrastra prospectos aquí
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Add Stage Column */}
        <div className="w-72 shrink-0">
          <button
            type="button"
            onClick={openCreateStageModal}
            className="w-full h-14 border-2 border-dashed border-base-300 hover:border-primary/60 rounded-2xl flex items-center justify-center gap-2 text-xs font-semibold text-base-content/60 hover:text-primary transition-colors bg-base-100/50 hover:bg-primary/5"
          >
            <RiAddLine size={16} />
            Nueva Etapa
          </button>
        </div>
      </div>

      {/* Lead Detail Drawer */}
      <LeadDrawer
        card={selectedCard}
        stages={stages}
        isOpen={Boolean(selectedCard)}
        onClose={() => setSelectedCard(null)}
        onStageChange={async (cardId, newStageId) => {
          if (!selectedCard) return;
          await onCardMoved(cardId, selectedCard.stage_id || "", newStageId);
          setSelectedCard({ ...selectedCard, stage_id: newStageId });
        }}
        onCardUpdated={(updated) => {
          if (selectedCard) {
            setSelectedCard({ ...selectedCard, ...updated });
          }
        }}
      />

      {/* Modal: Create or Edit Stage */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-base-100 rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-base-300">
            <h3 className="font-bold text-base text-base-content mb-4">
              {editingStage ? "Editar Etapa" : "Crear Nueva Etapa"}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-base-content/70 mb-1">
                  Nombre de la etapa
                </label>
                <input
                  type="text"
                  value={stageName}
                  onChange={(e) => setStageName(e.target.value)}
                  placeholder="ej. En Negociación, Propuesta Enviada..."
                  className="input input-bordered input-sm w-full"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-base-content/70 mb-2">
                  Color distintivo
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setStageColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${
                        stageColor === c ? "ring-2 ring-offset-2 ring-primary scale-110" : ""
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="btn btn-sm btn-ghost"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveStage}
                disabled={!stageName.trim() || savingStage}
                className="btn btn-sm btn-primary"
              >
                {savingStage ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
