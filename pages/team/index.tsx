import Head from "next/head";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiTeamLine,
  RiUserAddLine,
  RiUserLine,
  RiUserFollowLine,
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
  RiCpuLine,
  RiMailSendLine,
  RiSearchLine,
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
  const { t, locale } = useTranslation();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [capacity, setCapacity] = useState<Capacity>({ totalSlots: 1, usedSlots: 1, availableSlots: 0 });

  // Navigation & Filter states (same format as admin / other pages)
  const [activeTab, setActiveTab] = useState<"members" | "invitations">("members");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "owner" | "admin" | "member">("all");

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
          toast.error(t("team.toastNoPermission"));
          router.push("/");
          return;
        }
        throw new Error(t("team.toastLoadError"));
      }
      const data = await res.json();
      setMembers(data.members || []);
      setInvitations(data.invitations || []);
      setAccounts(data.accounts || []);
      setCapacity(data.capacity || { totalSlots: 1, usedSlots: 1, availableSlots: 0 });
    } catch (err: any) {
      toast.error(err.message || t("team.toastLoadError"));
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
      toast.error(t("team.toastInvalidEmail"));
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
        throw new Error(data.error || t("team.toastInviteError"));
      }

      toast.success(t("team.toastInviteSuccess"));
      setGeneratedInviteUrl(data.invitation.invite_url);
      loadTeamData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (id: string, nameOrEmail: string) => {
    if (!confirm(t("team.toastRevokeConfirm", { name: nameOrEmail }))) {
      return;
    }

    try {
      const res = await fetch(`/api/team/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("team.toastRevokeError"));

      toast.success(data.message || t("team.toastRevokeSuccess"));
      loadTeamData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success(t("team.toastCopied"));
    setTimeout(() => setCopiedId(null), 3000);
  };

  const currentUser = session?.user as any;

  // Filtered members
  const filteredMembers = members.filter((m) => {
    const q = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !q ||
      m.name?.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q) ||
      m.account_name?.toLowerCase().includes(q);

    const matchesRole =
      roleFilter === "all" ||
      (roleFilter === "admin" && m.role === "admin") ||
      (roleFilter === "member" && m.role !== "admin");

    return matchesSearch && matchesRole;
  });

  const showOwnerRow =
    (roleFilter === "all" || roleFilter === "owner") &&
    (!searchTerm.trim() ||
      currentUser?.name?.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
      currentUser?.email?.toLowerCase().includes(searchTerm.toLowerCase().trim()));

  const filteredInvitations = invitations.filter((inv) => {
    const q = searchTerm.toLowerCase().trim();
    return (
      !q ||
      inv.email?.toLowerCase().includes(q) ||
      inv.invite_code?.toLowerCase().includes(q) ||
      inv.account_name?.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <Head>
        <title>{t("team.title")} — InHubFlow</title>
      </Head>

      <div className="space-y-6">
        {/* ── Top Header Banner (Exact match of Admin and Dashboard standard) ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
                <RiTeamLine size={24} />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                {t("team.title")}
              </h1>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t("team.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={loadTeamData}
              title={t("team.refresh")}
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors shadow-xs cursor-pointer"
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
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm shadow-xs transition-all ${
                capacity.availableSlots > 0
                  ? "bg-brand-600 hover:bg-brand-700 text-white cursor-pointer active:scale-98"
                  : "bg-gray-300 dark:bg-gray-800 text-gray-500 cursor-not-allowed"
              }`}
            >
              <RiUserAddLine size={18} />
              <span>{t("team.inviteRep")}</span>
            </button>
          </div>
        </div>

        {/* ── Section Switcher Tabs ── */}
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 pb-2">
          <button
            onClick={() => setActiveTab("members")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
              activeTab === "members"
                ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <RiUserFollowLine size={18} />
            <span>{t("team.tabMembers")}</span>
            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {members.length + 1}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("invitations")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
              activeTab === "invitations"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <RiMailSendLine size={18} />
            <span>{t("team.tabInvitations")}</span>
            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold">
              {invitations.length}
            </span>
          </button>
        </div>

        {/* ── KPI Stats Grid (Exact match of Admin style) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">{t("team.statContractedSlots")}</span>
              <span className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <RiCpuLine size={18} />
              </span>
            </div>
            <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
              {capacity.totalSlots}
            </div>
            <div className="text-xs text-gray-400 mt-1">{t("team.statContractedDesc")}</div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">{t("team.statAssignedSlots")}</span>
              <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <RiUserFollowLine size={18} />
              </span>
            </div>
            <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {capacity.usedSlots}
            </div>
            <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80 mt-1">{t("team.statAssignedDesc")}</div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">{t("team.statAvailableSlots")}</span>
              <span className="p-2 rounded-xl bg-indigo-500/10 text-brand-600 dark:text-brand-400">
                <RiUserAddLine size={18} />
              </span>
            </div>
            <div className="text-3xl font-extrabold text-brand-600 dark:text-brand-400">
              {capacity.availableSlots}
            </div>
            <div className="text-xs text-gray-400 mt-1">{t("team.statAvailableDesc")}</div>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">{t("team.statPendingInvites")}</span>
              <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <RiMailSendLine size={18} />
              </span>
            </div>
            <div className="text-3xl font-extrabold text-amber-600 dark:text-amber-400">
              {invitations.length}
            </div>
            <div className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-1">{t("team.statPendingDesc")}</div>
          </div>
        </div>

        {/* ── Filters and Search ── */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
          <div className="relative w-full sm:w-80">
            <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={activeTab === "members" ? t("team.searchPlaceholderMembers") : t("team.searchPlaceholderInvites")}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {activeTab === "members" && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-400 mr-1">{t("team.filter")}</span>
              <button
                onClick={() => setRoleFilter("all")}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  roleFilter === "all"
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {t("team.filterAll")}
              </button>
              <button
                onClick={() => setRoleFilter("owner")}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  roleFilter === "owner"
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {t("team.filterOwner")}
              </button>
              <button
                onClick={() => setRoleFilter("admin")}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  roleFilter === "admin"
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {t("team.filterAdmins")}
              </button>
              <button
                onClick={() => setRoleFilter("member")}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  roleFilter === "member"
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {t("team.filterMembers")}
              </button>
            </div>
          )}
        </div>

        {/* ── SECTION 1: ACTIVE MEMBERS ── */}
        {activeTab === "members" && (
          <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">
                  {t("team.activeMembersTitle")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("team.activeMembersDesc")}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    <th className="py-3 px-5">{t("team.colUser")}</th>
                    <th className="py-3 px-5">{t("team.colRole")}</th>
                    <th className="py-3 px-5">{t("team.colAccount")}</th>
                    <th className="py-3 px-5">{t("team.colDate")}</th>
                    <th className="py-3 px-5 text-right">{t("team.colActions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {/* Row for Workspace Owner */}
                  {showOwnerRow && (
                    <tr className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors">
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs shrink-0">
                            👑
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-white leading-tight">
                              {currentUser?.name || t("team.youOwner")}
                            </p>
                            <p className="text-xs text-gray-400">{currentUser?.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-5">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          <RiShieldUserLine size={13} />
                          {t("team.workspaceOwner")}
                        </span>
                      </td>
                      <td className="py-4 px-5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">{t("team.allAccountsAccess")}</span>
                      </td>
                      <td className="py-4 px-5 text-xs text-gray-400">-</td>
                      <td className="py-4 px-5 text-right">
                        <span className="text-xs text-gray-400 font-semibold italic">{t("team.primary")}</span>
                      </td>
                    </tr>
                  )}

                  {/* Team Members */}
                  {filteredMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors">
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 font-bold text-xs flex items-center justify-center border border-brand-500/20 shrink-0">
                            {m.name ? m.name[0].toUpperCase() : "V"}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-white leading-tight">{m.name || t("team.salesRep")}</p>
                            <p className="text-xs text-gray-400">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-5">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          m.role === "admin"
                            ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                            : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                        }`}>
                          <RiUserLine size={13} />
                          {m.role === "admin" ? t("team.coAdmin") : t("team.repRole")}
                        </span>
                      </td>
                      <td className="py-4 px-5">
                        {m.account_name ? (
                          <div className="flex items-center gap-1.5 text-xs text-gray-800 dark:text-gray-200">
                            <RiLinkedinBoxLine size={16} className="text-[#0A66C2] shrink-0" />
                            <span className="font-semibold">{m.account_name}</span>
                            {m.account_authenticated ? (
                              <span className="w-2 h-2 rounded-full bg-emerald-500" title={t("team.connected")} />
                            ) : (
                              <span className="w-2 h-2 rounded-full bg-amber-500" title={t("team.pendingAuth")} />
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-amber-500 font-medium">{t("team.noLinkedAccount")}</span>
                        )}
                      </td>
                      <td className="py-4 px-5 text-xs text-gray-400">
                        {m.created_at ? new Date(m.created_at).toLocaleDateString(locale) : "-"}
                      </td>
                      <td className="py-4 px-5 text-right">
                        <button
                          onClick={() => handleRevoke(m.id, m.name || m.email)}
                          className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-medium"
                          title={t("team.revokeTitle")}
                        >
                          <RiDeleteBinLine size={16} />
                          <span className="hidden sm:inline">{t("team.revoke")}</span>
                        </button>
                      </td>
                    </tr>
                  ))}

                  {!showOwnerRow && filteredMembers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-xs text-gray-400">
                        {t("team.noMembersFound")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── SECTION 2: PENDING INVITATIONS ── */}
        {activeTab === "invitations" && (
          <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">
                  {t("team.pendingInvitesTitle")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("team.pendingInvitesDesc")}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    <th className="py-3 px-5">{t("team.colInvitedEmail")}</th>
                    <th className="py-3 px-5">{t("team.colCodeLink")}</th>
                    <th className="py-3 px-5">{t("team.colAccount")}</th>
                    <th className="py-3 px-5">{t("team.colValidUntil")}</th>
                    <th className="py-3 px-5 text-right">{t("team.colActions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {filteredInvitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors">
                      <td className="py-4 px-5 font-semibold text-gray-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <RiMailLine size={16} className="text-gray-400 shrink-0" />
                          <span>{inv.email}</span>
                        </div>
                      </td>
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                            {inv.invite_code}
                          </code>
                          <button
                            onClick={() => copyToClipboard(inv.invite_url, inv.id)}
                            className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                            title={t("team.copyInviteLink")}
                          >
                            {copiedId === inv.id ? (
                              <RiCheckLine size={14} className="text-emerald-500" />
                            ) : (
                              <RiFileCopyLine size={14} />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-4 px-5 text-xs text-gray-500 dark:text-gray-400">
                        {inv.account_name ? (
                          <span className="font-semibold text-gray-800 dark:text-gray-200">{inv.account_name}</span>
                        ) : (
                          <span className="text-gray-400 italic">{t("team.unassigned")}</span>
                        )}
                      </td>
                      <td className="py-4 px-5 text-xs text-gray-400">
                        <div className="flex items-center gap-1.5">
                          <RiTimeLine size={14} className="shrink-0" />
                          <span>{new Date(inv.expires_at).toLocaleDateString(locale)}</span>
                        </div>
                      </td>
                      <td className="py-4 px-5 text-right">
                        <button
                          onClick={() => handleRevoke(inv.id, inv.email)}
                          className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors cursor-pointer inline-flex items-center gap-1 text-xs font-medium"
                          title={t("team.cancelInvite")}
                        >
                          <RiDeleteBinLine size={16} />
                          <span className="hidden sm:inline">{t("team.cancel")}</span>
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filteredInvitations.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-xs text-gray-400">
                        {t("team.noPendingInvites")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Bottom Info Banner (Matching Admin standard style) ── */}
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 text-xs text-blue-800 dark:text-blue-300">
          <RiInformationLine size={18} className="shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div className="leading-relaxed">
            {t("team.multiSeatBanner")}
          </div>
        </div>
      </div>

      {/* ── Invite Member Modal (Matching Standard Modal Design) ── */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
                  <RiUserAddLine size={18} />
                </span>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {t("team.inviteModalTitle")}
                </h3>
              </div>
              <button
                onClick={() => setIsInviteModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors cursor-pointer"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            {generatedInviteUrl ? (
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl space-y-3 animate-in fade-in">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
                  <RiCheckLine size={20} />
                  <span>{t("team.readyToSend")}</span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {t("team.shareLinkHelp")}
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
                    className="px-3 py-1.5 rounded-lg bg-brand-600 text-white font-bold text-xs hover:bg-brand-500 transition-all cursor-pointer shrink-0"
                  >
                    {copiedId === "modal" ? t("team.copied") : t("team.copy")}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="w-full py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
                >
                  {t("team.close")}
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateInvite} className="space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("team.inputEmailLabel")}
                  </label>
                  <input
                    type="email"
                    required
                    placeholder={t("team.inputEmailPlaceholder")}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("team.inputRoleLabel")}
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-gray-900 dark:text-white"
                  >
                    <option value="member">{t("team.roleOptionMember")}</option>
                    <option value="admin">{t("team.roleOptionAdmin")}</option>
                  </select>
                </div>

                {accounts.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t("team.inputAccountLabel")}
                    </label>
                    <select
                      value={inviteAccount}
                      onChange={(e) => setInviteAccount(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-gray-900 dark:text-white"
                    >
                      <option value="">{t("team.accountOptionNone")}</option>
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
                    {t("team.inviteExpiryNotice")}
                  </span>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsInviteModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-800 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                  >
                    {t("team.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs shadow-xs transition-all cursor-pointer active:scale-98 disabled:opacity-50"
                  >
                    {isSubmitting ? t("team.generating") : t("team.generateLinkBtn")}
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
