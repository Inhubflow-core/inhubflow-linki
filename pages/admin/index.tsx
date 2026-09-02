import { useState, useEffect, useId } from "react";
import Head from "next/head";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import Layout from "@/components/layout/Layout";
import {
  RiShieldCheckLine,
  RiUserFollowLine,
  RiCpuLine,
  RiLinkedinBoxFill,
  RiSearchLine,
  RiEditLine,
  RiUserAddLine,
  RiCheckLine,
  RiCloseLine,
  RiRefreshLine,
  RiVipCrownLine,
  RiInformationLine,
} from "react-icons/ri";

interface Subscriber {
  id: string;
  email: string;
  role: string;
  company_name?: string;
  slots_limit: number;
  subscription_status: "active" | "trial" | "past_due" | "canceled";
  plan_tier: "starter" | "growth" | "scale" | "custom";
  paddle_customer_id?: string;
  paddle_subscription_id?: string;
  created_at: string;
  updated_at: string;
}

interface Stats {
  totalSubscribers: number;
  activeSubscriptions: number;
  totalSlotsAllocated: number;
  totalConnectedAccounts: number;
}

export default function AdminSubscribersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalSubscribers: 0,
    activeSubscriptions: 0,
    totalSlotsAllocated: 0,
    totalConnectedAccounts: 0,
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedSub, setSelectedSub] = useState<Subscriber | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Edit Form State
  const [editSlots, setEditSlots] = useState(1);
  const [editPlan, setEditPlan] = useState<"starter" | "growth" | "scale" | "custom">("starter");
  const [editStatus, setEditStatus] = useState<"active" | "trial" | "past_due" | "canceled">("active");
  const [editCompany, setEditCompany] = useState("");
  const [saving, setSaving] = useState(false);

  // Create Form State
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newSlots, setNewSlots] = useState(1);
  const [newPlan, setNewPlan] = useState<"starter" | "growth" | "scale" | "custom">("starter");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");

  const editSlotsInputId = useId();
  const editPlanSelectId = useId();
  const editStatusSelectId = useId();
  const editCompanyInputId = useId();
  const newEmailInputId = useId();
  const newPasswordInputId = useId();
  const newCompanyInputId = useId();
  const newSlotsInputId = useId();
  const newPlanSelectId = useId();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated") {
      const role = (session?.user as { role?: string })?.role;
      if (role !== "admin") {
        router.push("/");
      } else {
        loadData();
      }
    }
  }, [status, session]);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/subscribers");
      if (res.ok) {
        const data = await res.json();
        setSubscribers(data.subscribers || []);
        if (data.stats) setStats(data.stats);
      }
    } catch (err) {
      console.error("Error loading subscribers:", err);
    } finally {
      setLoading(false);
    }
  }

  function openEditModal(sub: Subscriber) {
    setSelectedSub(sub);
    setEditSlots(sub.slots_limit || 1);
    setEditPlan(sub.plan_tier || "starter");
    setEditStatus(sub.subscription_status || "active");
    setEditCompany(sub.company_name || "");
    setIsEditModalOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSub) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/subscribers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedSub.id,
          slots_limit: Number(editSlots),
          plan_tier: editPlan,
          subscription_status: editStatus,
          company_name: editCompany,
        }),
      });

      if (res.ok) {
        setIsEditModalOpen(false);
        loadData();
      } else {
        const err = await res.json();
        alert(err.error || "Error al actualizar suscriptor");
      }
    } catch {
      alert("Error de red al actualizar");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setCreating(true);
    try {
      const res = await fetch("/api/admin/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          company_name: newCompany,
          slots_limit: Number(newSlots),
          plan_tier: newPlan,
        }),
      });

      if (res.ok) {
        setIsCreateModalOpen(false);
        setNewEmail("");
        setNewPassword("");
        setNewCompany("");
        setNewSlots(1);
        loadData();
      } else {
        const err = await res.json();
        setFormError(err.error || "Error al crear cliente");
      }
    } catch {
      setFormError("Error de conexión");
    } finally {
      setCreating(false);
    }
  }

  const filteredSubscribers = subscribers.filter((sub) => {
    const matchesSearch =
      sub.email.toLowerCase().includes(search.toLowerCase()) ||
      (sub.company_name && sub.company_name.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus = statusFilter === "all" || sub.subscription_status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <Layout>
      <Head>
        <title>Panel SuperAdmin — InHubFlow</title>
      </Head>

      <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
        {/* Header Title & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
                <RiShieldCheckLine size={24} />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                SuperAdmin: Suscripciones y Clientes
              </h1>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Gestiona límites de slots, planes de clientes y sincronización automática con Paddle.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              title="Refrescar datos"
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors"
            >
              <RiRefreshLine className={loading ? "animate-spin" : ""} size={18} />
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm shadow-xs transition-all"
            >
              <RiUserAddLine size={18} />
              <span>Nuevo Cliente Manual</span>
            </button>
          </div>
        </div>

        {/* KPI Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Clientes</span>
              <span className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <RiUserFollowLine size={18} />
              </span>
            </div>
            <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
              {stats.totalSubscribers}
            </div>
            <div className="text-xs text-gray-400 mt-1">Cuentas registradas en la app</div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Suscripciones Activas</span>
              <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <RiVipCrownLine size={18} />
              </span>
            </div>
            <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {stats.activeSubscriptions}
            </div>
            <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80 mt-1">Facturando activamente</div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Slots Asignados</span>
              <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <RiCpuLine size={18} />
              </span>
            </div>
            <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
              {stats.totalSlotsAllocated}
            </div>
            <div className="text-xs text-gray-400 mt-1">Capacidad total vendida</div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Cuentas LinkedIn</span>
              <span className="p-2 rounded-xl bg-blue-600/10 text-[#0a66c2]">
                <RiLinkedinBoxFill size={18} />
              </span>
            </div>
            <div className="text-3xl font-extrabold text-[#0a66c2]">
              {stats.totalConnectedAccounts}
            </div>
            <div className="text-xs text-gray-400 mt-1">Conectadas en ejecución</div>
          </div>
        </div>

        {/* Filters and Search */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
          <div className="relative w-full sm:w-80">
            <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Buscar por email o empresa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs text-gray-400">Filtrar:</span>
            <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 text-xs">
              {[
                { id: "all", label: "Todos" },
                { id: "active", label: "Activos" },
                { id: "trial", label: "Prueba" },
                { id: "past_due", label: "Pendiente" },
                { id: "canceled", label: "Cancelados" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                    statusFilter === tab.id
                      ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-xs"
                      : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Subscribers Table */}
        <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Cliente / Email</th>
                  <th className="px-6 py-4">Plan</th>
                  <th className="px-6 py-4">Slots Autorizados</th>
                  <th className="px-6 py-4">Estado Suscripción</th>
                  <th className="px-6 py-4">Registro</th>
                  <th className="px-6 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredSubscribers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                      {loading ? "Cargando clientes..." : "No se encontraron clientes con los filtros aplicados."}
                    </td>
                  </tr>
                ) : (
                  filteredSubscribers.map((sub) => {
                    const isSuper = sub.role === "admin";
                    return (
                      <tr key={sub.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 font-bold flex items-center justify-center">
                              {sub.email.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                {sub.email}
                                {isSuper && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                    SUPERADMIN
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-400">
                                {sub.company_name || "Sin empresa especificada"}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold uppercase ${
                              sub.plan_tier === "scale"
                                ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                                : sub.plan_tier === "growth"
                                ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20"
                                : sub.plan_tier === "starter"
                                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                                : "bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20"
                            }`}
                          >
                            {sub.plan_tier === "scale" && "🚀 Scale (10)"}
                            {sub.plan_tier === "growth" && "⭐ Growth (5)"}
                            {sub.plan_tier === "starter" && "⚡ Starter (1)"}
                            {sub.plan_tier === "custom" && "🛠️ Custom"}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-base text-gray-900 dark:text-white">
                              {sub.slots_limit}
                            </span>
                            <span className="text-xs text-gray-400">cuentas máx.</span>
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                              sub.subscription_status === "active"
                                ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                                : sub.subscription_status === "trial"
                                ? "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
                                : sub.subscription_status === "past_due"
                                ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                                : "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                sub.subscription_status === "active"
                                  ? "bg-emerald-500"
                                  : sub.subscription_status === "trial"
                                  ? "bg-blue-500"
                                  : sub.subscription_status === "past_due"
                                  ? "bg-amber-500"
                                  : "bg-rose-500"
                              }`}
                            />
                            {sub.subscription_status === "active" && "Activa"}
                            {sub.subscription_status === "trial" && "En Prueba"}
                            {sub.subscription_status === "past_due" && "Pago Pendiente"}
                            {sub.subscription_status === "canceled" && "Cancelada"}
                          </span>
                        </td>

                        <td className="px-6 py-4 text-xs text-gray-400">
                          {new Date(sub.created_at).toLocaleDateString()}
                        </td>

                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => openEditModal(sub)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-300 transition-colors"
                          >
                            <RiEditLine size={14} />
                            <span>Gestionar</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Webhook Information Callout */}
        <div className="p-4 rounded-2xl bg-brand-500/5 border border-brand-500/10 flex items-start gap-3">
          <RiInformationLine className="text-brand-500 shrink-0 mt-0.5" size={20} />
          <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <div className="font-semibold text-gray-900 dark:text-white">
              Sincronización Automática con Paddle (Merchant of Record)
            </div>
            <div>
              Tu endpoint de webhook activo es: <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-brand-600 dark:text-brand-400">/api/webhooks/paddle</code>.
              Cuando un cliente compra en tu landing page, Paddle envía la confirmación y los slots se asignan al instante.
            </div>
          </div>
        </div>
      </div>

      {/* Edit Subscriber Modal */}
      {isEditModalOpen && selectedSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Gestionar Suscripción
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl">
              Editando a: <strong className="text-gray-900 dark:text-white">{selectedSub.email}</strong>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-sm">
              <div>
                <label htmlFor={editSlotsInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Límite de Slots (Cuentas permitidas)
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditSlots((s) => Math.max(1, s - 1))}
                    className="h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-center font-bold text-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    -
                  </button>
                  <input
                    id={editSlotsInputId}
                    type="number"
                    min={1}
                    max={100}
                    value={editSlots}
                    onChange={(e) => setEditSlots(Number(e.target.value))}
                    className="flex-1 text-center font-bold text-lg py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setEditSlots((s) => s + 1)}
                    className="h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-center font-bold text-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor={editPlanSelectId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Plan Comercial
                </label>
                <select
                  id={editPlanSelectId}
                  value={editPlan}
                  onChange={(e) => setEditPlan(e.target.value as "starter" | "growth" | "scale" | "custom")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                >
                  <option value="starter">Starter (1 cuenta - $49/mes)</option>
                  <option value="growth">Growth (5 cuentas - $199/mes)</option>
                  <option value="scale">Scale (10 cuentas - $349/mes)</option>
                  <option value="custom">Personalizado / Cortesía</option>
                </select>
              </div>

              <div>
                <label htmlFor={editStatusSelectId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Estado de Suscripción
                </label>
                <select
                  id={editStatusSelectId}
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as "active" | "trial" | "past_due" | "canceled")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                >
                  <option value="active">Activa (Acceso completo)</option>
                  <option value="trial">Periodo de Prueba</option>
                  <option value="past_due">Pendiente de Pago</option>
                  <option value="canceled">Cancelada (Bloquear acceso)</option>
                </select>
              </div>

              <div>
                <label htmlFor={editCompanyInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Empresa / Organización
                </label>
                <input
                  id={editCompanyInputId}
                  type="text"
                  value={editCompany}
                  onChange={(e) => setEditCompany(e.target.value)}
                  placeholder="Ej. Acme Corp"
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs shadow-xs disabled:opacity-50"
                >
                  <RiCheckLine size={16} />
                  <span>{saving ? "Guardando..." : "Guardar Cambios"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Subscriber Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Alta Manual de Cliente
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4 text-sm">
              <div>
                <label htmlFor={newEmailInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Email del Cliente *
                </label>
                <input
                  id={newEmailInputId}
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="cliente@empresa.com"
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label htmlFor={newPasswordInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Contraseña Inicial *
                </label>
                <input
                  id={newPasswordInputId}
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label htmlFor={newCompanyInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Empresa / Negocio
                </label>
                <input
                  id={newCompanyInputId}
                  type="text"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="Ej. Acme Corp"
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={newSlotsInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Slots Autorizados
                  </label>
                  <input
                    id={newSlotsInputId}
                    type="number"
                    min={1}
                    max={100}
                    value={newSlots}
                    onChange={(e) => setNewSlots(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-center font-bold"
                  />
                </div>

                <div>
                  <label htmlFor={newPlanSelectId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Plan
                  </label>
                  <select
                    id={newPlanSelectId}
                    value={newPlan}
                    onChange={(e) => setNewPlan(e.target.value as "starter" | "growth" | "scale" | "custom")}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                  >
                    <option value="starter">Starter (1)</option>
                    <option value="growth">Growth (5)</option>
                    <option value="scale">Scale (10)</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs shadow-xs disabled:opacity-50"
                >
                  <RiUserAddLine size={16} />
                  <span>{creating ? "Creando..." : "Crear Cliente"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
