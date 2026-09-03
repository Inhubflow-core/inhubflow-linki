import Head from "next/head";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import {
  RiTeamLine,
  RiUserAddLine,
  RiUserLine,
  RiCheckLine,
  RiFileCopyLine,
  RiDeleteBinLine,
  RiShieldUserLine,
  RiRefreshLine,
  RiTimeLine,
  RiLinkedinBoxLine,
  RiMailLine,
  RiCloseLine,
  RiInformationLine,
} from "react-icons/ri";

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  assigned_account_id: string | null;
  account_name: string | null;
  account_email: string | null;
  account_authenticated: number | null;
  created_at: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  invite_code: string;
  status: string;
  expires_at: string;
  created_at: string;
  invite_url: string;
  account_name: string | null;
}

interface Account {
  id: string;
  name: string;
  email: string;
  is_authenticated: number;
}

interface Capacity {
  totalSlots: number;
  usedSlots: number;
  availableSlots: number;
}

export default function TeamManagementPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [capacity, setCapacity] = useState<Capacity>({ totalSlots: 1, usedSlots: 1, availableSlots: 0 });

  // Modal State
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteAccount, setInviteAccount] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  const loadTeamData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/team");
      if (!res.ok) {
        if (res.status === 403) {
          toast.error("No tienes permisos para ver esta sección.");
          router.push("/");
          return;
        }
        throw new Error("Error al consultar datos de equipo.");
      }
      const data = await res.json();
      setMembers(data.members || []);
      setInvitations(data.invitations || []);
      setAccounts(data.accounts || []);
      setCapacity(data.capacity || { totalSlots: 1, usedSlots: 1, availableSlots: 0 });
    } catch (err: any) {
      toast.error(err.message || "Error al cargar miembros de equipo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      loadTeamData();
    }
  }, [session]);

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) {
      toast.error("Por favor ingresa un correo electrónico válido.");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          assigned_account_id: inviteAccount || null,
          role: inviteRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo crear la invitación.");
      }

      toast.success("¡Invitación creada exitosamente!");
      setGeneratedInviteUrl(data.invitation.invite_url);
      loadTeamData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (id: string, nameOrEmail: string) => {
    if (!confirm(`¿Estás seguro de que deseas revocar el acceso de ${nameOrEmail}? El slot quedará libre de inmediato.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/team/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al revocar.");

      toast.success(data.message || "Acceso revocado.");
      loadTeamData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Enlace de invitación copiado al portapapeles.");
    setTimeout(() => setCopiedId(null), 3000);
  };

  const currentUser = session?.user as any;

  return (
    <>
      <Head>
        <title>Mi Equipo & Vendedores | InHubFlow</title>
      </Head>

      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header Banner */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <RiTeamLine size={24} />
                  </span>
                  <span className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                    Multi-Seat Team Management
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                  Equipo Comercial & Embajadores
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
                  Asigna slots dedicados de LinkedIn a tus vendedores o promotores oficiales. Cada miembro tiene su propia bandeja de entrada privada y únicamente ve sus conversaciones asignadas.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={loadTeamData}
                  className="p-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors"
                  title="Refrescar"
                >
                  <RiRefreshLine className={loading ? "animate-spin" : ""} size={18} />
                </button>

                <button
                  onClick={() => {
                    setInviteEmail("");
                    setInviteAccount("");
                    setGeneratedInviteUrl(null);
                    setIsInviteModalOpen(true);
                  }}
                  disabled={capacity.availableSlots <= 0}
                  className={`inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm shadow-md transition-all cursor-pointer ${
                    capacity.availableSlots > 0
                      ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/20 active:scale-98"
                      : "bg-gray-300 dark:bg-gray-800 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  <RiUserAddLine size={18} />
                  <span>+ Invitar Vendedor</span>
                </button>
              </div>
            </div>

            {/* Capacity KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-gray-100 dark:border-gray-800">
              <div className="bg-gray-50 dark:bg-gray-800/40 rounded-2xl p-4 border border-gray-100 dark:border-gray-800">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Slots Contratados</span>
                <p className="text-2xl font-black text-gray-900 dark:text-white mt-1">{capacity.totalSlots}</p>
                <span className="text-[11px] text-gray-400">Capacidad total</span>
              </div>

              <div className="bg-emerald-50/50 dark:bg-emerald-950/20 rounded-2xl p-4 border border-emerald-100 dark:border-emerald-900/30">
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Slots Asignados</span>
                <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{capacity.usedSlots}</p>
                <span className="text-[11px] text-emerald-600/70">En uso activo</span>
              </div>

              <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-2xl p-4 border border-blue-100 dark:border-blue-900/30">
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Slots Disponibles</span>
                <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">{capacity.availableSlots}</p>
                <span className="text-[11px] text-blue-600/70">Para invitar</span>
              </div>

              <div className="bg-amber-50/50 dark:bg-amber-950/20 rounded-2xl p-4 border border-amber-100 dark:border-amber-900/30">
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Invitaciones Pendientes</span>
                <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{invitations.length}</p>
                <span className="text-[11px] text-amber-600/70">Por registrarse</span>
              </div>
            </div>
          </div>

          {/* Active Team Members Section */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Miembros del Equipo Activos</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Usuarios que tienen acceso a sus slots de prospección.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-bold text-gray-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Usuario / Vendedor</th>
                    <th className="py-3 px-4">Rol</th>
                    <th className="py-3 px-4">Cuenta de LinkedIn Asignada</th>
                    <th className="py-3 px-4">Fecha de Alta</th>
                    <th className="py-3 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {/* Row for Workspace Owner */}
                  <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                          👑
                        </div>
                        <div>
                          <p className="font-bold text-gray-900 dark:text-white leading-tight">
                            {currentUser?.name || "Tú (Administrador Master)"}
                          </p>
                          <p className="text-xs text-gray-400">{currentUser?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        <RiShieldUserLine size={13} />
                        Workspace Owner
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Acceso a todas las cuentas</span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-400">-</td>
                    <td className="py-3.5 px-4 text-right">
                      <span className="text-xs text-gray-400 font-semibold italic">Principal</span>
                    </td>
                  </tr>

                  {/* Team Members */}
                  {members.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center justify-center border border-emerald-500/20">
                            {m.name ? m.name[0].toUpperCase() : "V"}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-white leading-tight">{m.name || "Vendedor"}</p>
                            <p className="text-xs text-gray-400">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                          <RiUserLine size={13} />
                          {m.role === "admin" ? "Co-Admin" : "Vendedor / SDR"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        {m.account_name ? (
                          <div className="flex items-center gap-1.5 text-xs text-gray-800 dark:text-gray-200">
                            <RiLinkedinBoxLine size={16} className="text-[#0A66C2]" />
                            <span className="font-semibold">{m.account_name}</span>
                            {m.account_authenticated ? (
                              <span className="w-2 h-2 rounded-full bg-emerald-500" title="Conectado" />
                            ) : (
                              <span className="w-2 h-2 rounded-full bg-amber-500" title="Pendiente autenticar" />
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-amber-500 font-medium">Sin cuenta vinculada</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-gray-400">
                        {m.created_at ? new Date(m.created_at).toLocaleDateString() : "-"}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleRevoke(m.id, m.name || m.email)}
                          className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors cursor-pointer"
                          title="Revocar acceso y liberar slot"
                        >
                          <RiDeleteBinLine size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {members.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-xs text-gray-400">
                        Aún no tienes vendedores o miembros secundarios en tu equipo. ¡Haz clic en "+ Invitar Vendedor" para agregar uno!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pending Invitations Section */}
          {invitations.length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Invitaciones Pendientes</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Enlaces de activación enviados que aún no han sido completados.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <th className="py-3 px-4">Correo Invitado</th>
                      <th className="py-3 px-4">Código / Enlace</th>
                      <th className="py-3 px-4">Válido Hasta</th>
                      <th className="py-3 px-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                    {invitations.map((inv) => (
                      <tr key={inv.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-gray-900 dark:text-white">
                          <div className="flex items-center gap-2">
                            <RiMailLine size={16} className="text-gray-400" />
                            <span>{inv.email}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                              {inv.invite_code}
                            </code>
                            <button
                              onClick={() => copyToClipboard(inv.invite_url, inv.id)}
                              className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                              title="Copiar enlace de invitación"
                            >
                              {copiedId === inv.id ? (
                                <RiCheckLine size={14} className="text-emerald-500" />
                              ) : (
                                <RiFileCopyLine size={14} />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-gray-400">
                          <div className="flex items-center gap-1.5">
                            <RiTimeLine size={14} />
                            <span>{new Date(inv.expires_at).toLocaleDateString()}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => handleRevoke(inv.id, inv.email)}
                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors cursor-pointer"
                            title="Cancelar invitación"
                          >
                            <RiDeleteBinLine size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invite Member Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative space-y-5">
            <button
              onClick={() => setIsInviteModalOpen(false)}
              className="absolute top-6 right-6 p-2 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            >
              <RiCloseLine size={20} />
            </button>

            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 mb-2 inline-block">
                Nuevo Acceso a Slot
              </span>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Invitar Vendedor o Embajador</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Se generará un enlace único para que tu colaborador active su cuenta y conecte su perfil de LinkedIn.
              </p>
            </div>

            {generatedInviteUrl ? (
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl space-y-3 animate-in fade-in">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
                  <RiCheckLine size={20} />
                  <span>¡Invitación lista para enviar!</span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  Comparte este enlace con tu vendedor para que cree su contraseña e inicie sesión en su slot:
                </p>
                <div className="flex items-center gap-2 bg-white dark:bg-gray-900 p-2.5 rounded-xl border border-emerald-300 dark:border-emerald-800">
                  <input
                    type="text"
                    readOnly
                    value={generatedInviteUrl}
                    className="w-full text-xs font-mono bg-transparent text-gray-800 dark:text-gray-200 outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(generatedInviteUrl, "modal")}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-500 transition-all cursor-pointer shrink-0"
                  >
                    {copiedId === "modal" ? "¡Copiado!" : "Copiar"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="w-full py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 transition-colors"
                >
                  Cerrar
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateInvite} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    Correo Electrónico del Vendedor / Embajador *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="vendedor@tuempresa.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    Rol en el Workspace
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="member">Vendedor / SDR (Solo ve su cuenta e inbox)</option>
                    <option value="admin">Co-Administrador (Puede ver todas las cuentas)</option>
                  </select>
                </div>

                {accounts.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                      Vincular a Cuenta de LinkedIn Existente (Opcional)
                    </label>
                    <select
                      value={inviteAccount}
                      onChange={(e) => setInviteAccount(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">Dejar que el vendedor conecte su propia cuenta</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({acc.email})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 rounded-xl flex items-start gap-2 text-xs text-blue-700 dark:text-blue-300">
                  <RiInformationLine size={16} className="shrink-0 mt-0.5" />
                  <span>
                    El vendedor recibirá un link seguro válido por 7 días para definir su contraseña e ingresar directamente a su espacio individual.
                  </span>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsInviteModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 text-xs font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer active:scale-98 disabled:opacity-50"
                  >
                    {isSubmitting ? "Generando..." : "Generar Enlace de Invitación"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
