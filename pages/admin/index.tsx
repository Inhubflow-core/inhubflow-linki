import { useState, useEffect, useId } from "react";
import Head from "next/head";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";

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
  RiHandHeartLine,
  RiFileCopyLine,
  RiMoneyDollarCircleLine,
  RiExternalLinkLine,
  RiBankCardLine,
} from "react-icons/ri";

interface Subscriber {
  id: string;
  email: string;
  role: string;
  company_name?: string;
  slots_limit: number;
  subscription_status: "active" | "trial" | "past_due" | "canceled";
  plan_tier: "starter" | "growth" | "business" | "scale" | "custom";
  paddle_customer_id?: string;
  paddle_subscription_id?: string;
  lemon_customer_id?: string;
  lemon_subscription_id?: string;
  partner_id?: string;
  created_at: string;
  updated_at: string;
}

interface Stats {
  totalSubscribers: number;
  activeSubscriptions: number;
  totalSlotsAllocated: number;
  totalConnectedAccounts: number;
}

interface Partner {
  id: string;
  code: string;
  name: string;
  email: string;
  phone?: string;
  payout_method: string;
  payout_account?: string;
  commission_pct: number;
  balance: number;
  total_paid: number;
  status: "active" | "paused" | "archived";
  notes?: string;
  created_at: string;
  discount_link: string;
  total_referrals?: number;
  active_referrals?: number;
  total_revenue_generated?: number;
  total_commission_accumulated?: number;
}

interface PartnerSummary {
  total_partners: number;
  active_partners: number;
  total_referrals: number;
  total_balance_due: number;
  total_paid_out: number;
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
  const [editPlan, setEditPlan] = useState<"starter" | "growth" | "business" | "scale" | "custom">("starter");
  const [editStatus, setEditStatus] = useState<"active" | "trial" | "past_due" | "canceled">("active");
  const [editCompany, setEditCompany] = useState("");
  const [saving, setSaving] = useState(false);

  // Create Form State
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newSlots, setNewSlots] = useState(1);
  const [newPlan, setNewPlan] = useState<"starter" | "growth" | "business" | "scale" | "custom">("starter");
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

  // Navigation section switcher
  const [adminSection, setAdminSection] = useState<"subscribers" | "partners">("subscribers");

  // Partners State
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerSummary, setPartnerSummary] = useState<PartnerSummary>({
    total_partners: 0,
    active_partners: 0,
    total_referrals: 0,
    total_balance_due: 0,
    total_paid_out: 0,
  });
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [isCreatePartnerModalOpen, setIsCreatePartnerModalOpen] = useState(false);
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [selectedPartnerForPayout, setSelectedPartnerForPayout] = useState<Partner | null>(null);
  const [payoutAmount, setPayoutAmount] = useState<number>(0);
  const [payoutRef, setPayoutRef] = useState("");
  const [payoutNotes, setPayoutNotes] = useState("");
  const [payoutSaving, setPayoutSaving] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // New Partner Form State
  const [newPartnerName, setNewPartnerName] = useState("");
  const [newPartnerEmail, setNewPartnerEmail] = useState("");
  const [newPartnerPhone, setNewPartnerPhone] = useState("");
  const [newPartnerPayoutMethod, setNewPartnerPayoutMethod] = useState("PayPal");
  const [newPartnerPayoutAccount, setNewPartnerPayoutAccount] = useState("");
  const [newPartnerCommission, setNewPartnerCommission] = useState(50);
  const [newPartnerCustomCode, setNewPartnerCustomCode] = useState("");
  const [newPartnerNotes, setNewPartnerNotes] = useState("");
  const [partnerCreating, setPartnerCreating] = useState(false);
  const [partnerFormError, setPartnerFormError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated") {
      loadData();
      loadPartners();
    }
  }, [status]);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/subscribers");
      if (res.ok) {
        const data = await res.json();
        setSubscribers(data.subscribers || []);
        if (data.stats) setStats(data.stats);
      } else if (res.status === 401) {
        router.push("/login");
      } else if (res.status === 403) {
        router.push("/");
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

  async function loadPartners() {
    setPartnersLoading(true);
    try {
      const res = await fetch("/api/admin/partners");
      if (res.ok) {
        const data = await res.json();
        setPartners(data.partners || []);
        if (data.summary) setPartnerSummary(data.summary);
      }
    } catch (err) {
      console.error("Error loading partners:", err);
    } finally {
      setPartnersLoading(false);
    }
  }

  async function handleCreatePartner(e: React.FormEvent) {
    e.preventDefault();
    setPartnerFormError("");
    setPartnerCreating(true);
    try {
      const res = await fetch("/api/admin/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPartnerName,
          email: newPartnerEmail,
          phone: newPartnerPhone,
          payout_method: newPartnerPayoutMethod,
          payout_account: newPartnerPayoutAccount,
          commission_pct: Number(newPartnerCommission),
          custom_code: newPartnerCustomCode,
          notes: newPartnerNotes,
        }),
      });

      if (res.ok) {
        setIsCreatePartnerModalOpen(false);
        setNewPartnerName("");
        setNewPartnerEmail("");
        setNewPartnerPhone("");
        setNewPartnerPayoutAccount("");
        setNewPartnerCustomCode("");
        setNewPartnerNotes("");
        loadPartners();
      } else {
        const err = await res.json();
        setPartnerFormError(err.error || "Error al crear Partner");
      }
    } catch {
      setPartnerFormError("Error de conexión");
    } finally {
      setPartnerCreating(false);
    }
  }

  function openPayoutModal(p: Partner) {
    setSelectedPartnerForPayout(p);
    setPayoutAmount(p.balance > 0 ? p.balance : 0);
    setPayoutRef("");
    setPayoutNotes("");
    setIsPayoutModalOpen(true);
  }

  async function handleConfirmPayout(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPartnerForPayout) return;
    setPayoutSaving(true);
    try {
      const res = await fetch(`/api/admin/partners/${selectedPartnerForPayout.id}/payout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(payoutAmount),
          reference: payoutRef,
          notes: payoutNotes,
        }),
      });

      if (res.ok) {
        setIsPayoutModalOpen(false);
        loadPartners();
      } else {
        const err = await res.json();
        alert(err.error || "Error al registrar liquidación");
      }
    } catch {
      alert("Error de red");
    } finally {
      setPayoutSaving(false);
    }
  }

  function copyDiscountLink(link: string, code: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(link);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2500);
    }
  }

  const filteredSubscribers = subscribers.filter((sub) => {
    const matchesSearch =
      sub.email.toLowerCase().includes(search.toLowerCase()) ||
      (sub.company_name && sub.company_name.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus = statusFilter === "all" || sub.subscription_status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const filteredPartners = partners.filter((p) => {
    return (
      p.name.toLowerCase().includes(partnerSearch.toLowerCase()) ||
      p.email.toLowerCase().includes(partnerSearch.toLowerCase()) ||
      p.code.toLowerCase().includes(partnerSearch.toLowerCase())
    );
  });

  return (
    <>
      <Head>
        <title>Panel SuperAdmin — InHubFlow</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="space-y-6">
        {/* ── Top Header Banner ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
                <RiShieldCheckLine size={24} />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                {adminSection === "subscribers" ? "SuperAdmin: Suscripciones y Clientes" : "SuperAdmin: Partners Oficiales (50% Recurrente)"}
              </h1>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {adminSection === "subscribers"
                ? "Gestiona límites de slots, planes de clientes y sincronización automática con Lemon Squeezy by Stripe."
                : "Programa de Embajadores & Agencias B2B con Links de Descuento exclusivos (?20-OFF=CODIGO)."}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (adminSection === "subscribers") loadData();
                else loadPartners();
              }}
              title="Refrescar datos"
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors shadow-xs"
            >
              <RiRefreshLine className={loading || partnersLoading ? "animate-spin" : ""} size={18} />
            </button>
            {adminSection === "subscribers" ? (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm shadow-xs transition-all"
              >
                <RiUserAddLine size={18} />
                <span>Nuevo Cliente Manual</span>
              </button>
            ) : (
              <button
                onClick={() => setIsCreatePartnerModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm shadow-xs transition-all cursor-pointer"
              >
                <RiHandHeartLine size={18} />
                <span>+ Nuevo Partner Oficial</span>
              </button>
            )}
          </div>
        </div>

        {/* ── Section Switcher Tabs ── */}
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 pb-2">
          <button
            onClick={() => setAdminSection("subscribers")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
              adminSection === "subscribers"
                ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <RiUserFollowLine size={18} />
            <span>Suscripciones & Clientes</span>
            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {stats.totalSubscribers}
            </span>
          </button>

          <button
            onClick={() => setAdminSection("partners")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
              adminSection === "partners"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <RiHandHeartLine size={18} />
            <span>Partners Oficiales (50% Recurrente)</span>
            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold">
              {partners.length}
            </span>
          </button>
        </div>

        {/* ── SECTION 1: SUBSCRIBERS ── */}
        {adminSection === "subscribers" && (
          <div className="space-y-6">
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
                          ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs"
                          : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-300"
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
                  <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs uppercase font-semibold border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className="px-6 py-4">Usuario / Empresa</th>
                      <th className="px-6 py-4">Plan Actual</th>
                      <th className="px-6 py-4">Slots Permitidos</th>
                      <th className="px-6 py-4">Estado</th>
                      <th className="px-6 py-4">Fecha Registro</th>
                      <th className="px-6 py-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                          <RiRefreshLine className="animate-spin inline-block mr-2" size={20} />
                          Cargando clientes...
                        </td>
                      </tr>
                    ) : filteredSubscribers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                          No se encontraron clientes con los filtros aplicados.
                        </td>
                      </tr>
                    ) : (
                      filteredSubscribers.map((sub) => {
                        return (
                          <tr key={sub.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-semibold text-gray-900 dark:text-white">
                                {sub.email}
                              </div>
                              <div className="text-xs text-gray-400">
                                {sub.company_name || "Sin empresa"} • Rol: {sub.role}
                              </div>
                            </td>

                            <td className="px-6 py-4">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 uppercase">
                                {sub.plan_tier || "starter"}
                              </span>
                            </td>

                            <td className="px-6 py-4">
                              <div className="flex items-center gap-1.5 font-bold text-gray-800 dark:text-gray-200">
                                <RiCpuLine size={16} className="text-gray-400" />
                                <span>{sub.slots_limit} {sub.slots_limit === 1 ? "Slot" : "Slots"}</span>
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
                  Sincronización Automática con Lemon Squeezy by Stripe (Merchant of Record)
                </div>
                <div>
                  Tu endpoint de webhook activo es: <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-brand-600 dark:text-brand-400">/api/webhooks/lemonsqueezy</code>.
                  Cuando un cliente compra en tu landing page, Lemon Squeezy by Stripe envía la confirmación y los slots se asignan al instante.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 2: INHUBFLOW PARTNERS (25% RECURRENT) ── */}
        {adminSection === "partners" && (
          <div className="space-y-6">
            {/* Partners KPI Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Partners</span>
                  <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <RiHandHeartLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
                  {partnerSummary.total_partners}
                </div>
                <div className="text-xs text-gray-400 mt-1">Agencias & Promotores activos</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Clientes Referidos</span>
                  <span className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <RiUserFollowLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-blue-600 dark:text-blue-400">
                  {partnerSummary.total_referrals}
                </div>
                <div className="text-xs text-gray-400 mt-1">Suscripciones B2B traídas</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Comisiones Pendientes</span>
                  <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <RiMoneyDollarCircleLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  ${partnerSummary.total_balance_due.toFixed(2)} USD
                </div>
                <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80 mt-1">Por liquidar a Partners (25%)</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Liquidado</span>
                  <span className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <RiBankCardLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-purple-600 dark:text-purple-400">
                  ${partnerSummary.total_paid_out.toFixed(2)} USD
                </div>
                <div className="text-xs text-gray-400 mt-1">Pagado históricamente</div>
              </div>
            </div>

            {/* Partners Search */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
              <div className="relative w-full sm:w-96">
                <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Buscar partner por nombre, email o código..."
                  value={partnerSearch}
                  onChange={(e) => setPartnerSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="text-xs text-gray-500">
                Mostrando <strong className="text-gray-900 dark:text-white">{filteredPartners.length}</strong> de {partners.length} Partners Oficiales
              </div>
            </div>

            {/* Partners Table */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs uppercase font-semibold border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className="px-6 py-4">Partner / Contacto</th>
                      <th className="px-6 py-4">Link de Descuento Oficial</th>
                      <th className="px-6 py-4">Comisión</th>
                      <th className="px-6 py-4">Método de Cobro</th>
                      <th className="px-6 py-4">Clientes Activos</th>
                      <th className="px-6 py-4">Saldo Pendiente</th>
                      <th className="px-6 py-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {partnersLoading ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                          <RiRefreshLine className="animate-spin inline-block mr-2" size={20} />
                          Cargando Partners Oficiales...
                        </td>
                      </tr>
                    ) : filteredPartners.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                          {partners.length === 0 ? (
                            <div className="space-y-3">
                              <p>Aún no has registrado ningún Partner Oficial.</p>
                              <button
                                onClick={() => setIsCreatePartnerModalOpen(true)}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-xs"
                              >
                                <RiHandHeartLine size={16} />
                                <span>Dar de alta el Primer Partner</span>
                              </button>
                            </div>
                          ) : (
                            "No se encontraron Partners con ese criterio de búsqueda."
                          )}
                        </td>
                      </tr>
                    ) : (
                      filteredPartners.map((p) => {
                        const isCopied = copiedCode === p.code;
                        return (
                          <tr key={p.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <span>{p.name}</span>
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 text-xs font-mono font-bold">
                                  {p.code}
                                </span>
                              </div>
                              <div className="text-xs text-gray-400">
                                {p.email} {p.phone ? `• ${p.phone}` : ""}
                              </div>
                            </td>

                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <code className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 font-mono text-xs text-brand-600 dark:text-brand-400 max-w-[240px] truncate">
                                  {p.discount_link}
                                </code>
                                <button
                                  onClick={() => copyDiscountLink(p.discount_link, p.code)}
                                  title="Copiar link de descuento"
                                  className={`p-1.5 rounded-lg border transition-all ${
                                    isCopied
                                      ? "bg-emerald-500 text-white border-emerald-600"
                                      : "border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                                  }`}
                                >
                                  {isCopied ? <RiCheckLine size={14} /> : <RiFileCopyLine size={14} />}
                                </button>
                              </div>
                              {isCopied && (
                                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  ¡Link de Descuento copiado!
                                </span>
                              )}
                            </td>

                            <td className="px-6 py-4">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                {p.commission_pct}% Recurrente
                              </span>
                            </td>

                            <td className="px-6 py-4">
                              <div className="text-xs font-medium text-gray-900 dark:text-white">
                                {p.payout_method || "PayPal"}
                              </div>
                              <div className="text-[11px] text-gray-400 truncate max-w-[180px]">
                                {p.payout_account || "No especificada"}
                              </div>
                            </td>

                            <td className="px-6 py-4">
                              <div className="font-bold text-gray-900 dark:text-white">
                                {p.active_referrals || 0}
                              </div>
                              <div className="text-[11px] text-gray-400">
                                ${((p.total_revenue_generated || 0)).toFixed(2)} facturados
                              </div>
                            </td>

                            <td className="px-6 py-4">
                              <div className={`font-extrabold ${p.balance > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-500"}`}>
                                ${p.balance.toFixed(2)} USD
                              </div>
                              <div className="text-[11px] text-gray-400">
                                Pagado: ${p.total_paid.toFixed(2)}
                              </div>
                            </td>

                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => openPayoutModal(p)}
                                disabled={p.balance <= 0}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-semibold text-xs transition-colors shadow-xs"
                              >
                                <RiMoneyDollarCircleLine size={14} />
                                <span>Liquidar</span>
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

            {/* InHubFlow Partners Callout */}
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
              <RiHandHeartLine className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={20} />
              <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
                <div className="font-bold text-gray-900 dark:text-white">
                  ¿Cómo funciona el Link de Descuento de Embajadores (?25-OFF=CODIGO)?
                </div>
                <div>
                  Cada Partner Oficial recibe un link como <code className="px-1.5 py-0.5 rounded bg-white dark:bg-gray-800 font-mono text-amber-700 dark:text-amber-400 font-bold">https://inhubflow.online?25-OFF=SE7GH</code>.
                  Cuando su cliente entra con ese link, el sistema guarda la atribución por 60 días y le acredita automáticamente el <strong>25% recurrente mes a mes</strong> cada vez que se renueva la suscripción en Lemon Squeezy.
                </div>
              </div>
            </div>
          </div>
        )}
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
                  onChange={(e) => setEditPlan(e.target.value as "starter" | "growth" | "business" | "scale" | "custom")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                >
                  <option value="starter">Starter (1 cuenta - $49/mes)</option>
                  <option value="growth">Growth (5 cuentas - $199/mes)</option>
                  <option value="business">Business (10 cuentas - $349/mes)</option>
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
                    onChange={(e) => setNewPlan(e.target.value as "starter" | "growth" | "business" | "scale" | "custom")}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                  >
                    <option value="starter">Starter (1)</option>
                    <option value="growth">Growth (5)</option>
                    <option value="business">Business (10)</option>
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

      {/* ── Modal: Crear Nuevo Partner Oficial ── */}
      {isCreatePartnerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <RiHandHeartLine size={20} />
                </span>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Nuevo Partner Oficial de InHubFlow
                </h3>
              </div>
              <button
                onClick={() => setIsCreatePartnerModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Registra una agencia o embajador para generar su Link de Descuento exclusivo y atribuirle el 25% de comisión mensual recurrente.
            </p>

            {partnerFormError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs">
                {partnerFormError}
              </div>
            )}

            <form onSubmit={handleCreatePartner} className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Nombre o Agencia *
                  </label>
                  <input
                    type="text"
                    required
                    value={newPartnerName}
                    onChange={(e) => setNewPartnerName(e.target.value)}
                    placeholder="Ej. Agencia Growth B2B"
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Email de Contacto *
                  </label>
                  <input
                    type="email"
                    required
                    value={newPartnerEmail}
                    onChange={(e) => setNewPartnerEmail(e.target.value)}
                    placeholder="partner@agencia.com"
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Teléfono / WhatsApp
                  </label>
                  <input
                    type="tel"
                    value={newPartnerPhone}
                    onChange={(e) => setNewPartnerPhone(e.target.value)}
                    placeholder="+56 9 1234 5678"
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Código Alfanumérico (Opcional)
                  </label>
                  <input
                    type="text"
                    value={newPartnerCustomCode}
                    onChange={(e) => setNewPartnerCustomCode(e.target.value.toUpperCase())}
                    placeholder="Ej. SE7GH (Auto si vacío)"
                    maxLength={10}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm uppercase font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Método de Liquidación
                  </label>
                  <select
                    value={newPartnerPayoutMethod}
                    onChange={(e) => setNewPartnerPayoutMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                  >
                    <option value="PayPal">PayPal</option>
                    <option value="Transferencia Bancaria">Transferencia Bancaria</option>
                    <option value="USDT / Crypto">USDT / Cripto</option>
                    <option value="Wise">Wise</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Comisión Recurrente (%)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={newPartnerCommission}
                    onChange={(e) => setNewPartnerCommission(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-bold text-center"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Cuenta / Datos de Pago (Email PayPal o Cuenta Bancaria)
                </label>
                <input
                  type="text"
                  value={newPartnerPayoutAccount}
                  onChange={(e) => setNewPartnerPayoutAccount(e.target.value)}
                  placeholder="ej: pagos@agencia.com o Banco BCI Cta Cte..."
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Notas Internas
                </label>
                <input
                  type="text"
                  value={newPartnerNotes}
                  onChange={(e) => setNewPartnerNotes(e.target.value)}
                  placeholder="Acuerdos específicos, canal de contacto, etc."
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreatePartnerModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-xs hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={partnerCreating}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <RiHandHeartLine size={16} />
                  <span>{partnerCreating ? "Guardando..." : "Guardar y Generar Link"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Registrar Liquidación de Comisiones ── */}
      {isPayoutModalOpen && selectedPartnerForPayout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <RiMoneyDollarCircleLine size={20} />
                </span>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Liquidar Comisiones
                </h3>
              </div>
              <button
                onClick={() => setIsPayoutModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/50 space-y-1">
              <div className="text-xs text-gray-500 dark:text-gray-400">Liquidando a:</div>
              <div className="font-bold text-gray-900 dark:text-white text-sm">
                {selectedPartnerForPayout.name} ({selectedPartnerForPayout.code})
              </div>
              <div className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold pt-1">
                Saldo acumulado actual: ${selectedPartnerForPayout.balance.toFixed(2)} USD
              </div>
              <div className="text-[11px] text-gray-500">
                Cobro vía: <strong>{selectedPartnerForPayout.payout_method}</strong> ({selectedPartnerForPayout.payout_account || "No especificada"})
              </div>
            </div>

            <form onSubmit={handleConfirmPayout} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Monto a Liquidar ($ USD) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  min={0.01}
                  max={selectedPartnerForPayout.balance}
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-base font-bold text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Referencia de Pago (ID Transacción / Voucher)
                </label>
                <input
                  type="text"
                  value={payoutRef}
                  onChange={(e) => setPayoutRef(e.target.value)}
                  placeholder="ej: PAYPAL-TXN-98428 o Transf 129384"
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Notas de Liquidación
                </label>
                <input
                  type="text"
                  value={payoutNotes}
                  onChange={(e) => setPayoutNotes(e.target.value)}
                  placeholder="Comisiones periodo marzo, etc."
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsPayoutModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-xs hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={payoutSaving || payoutAmount <= 0}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <RiCheckLine size={16} />
                  <span>{payoutSaving ? "Registrando..." : "Confirmar Pago"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
