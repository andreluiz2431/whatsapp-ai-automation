import {
  Ban,
  Calendar,
  CheckCircle2,
  Cpu,
  Edit3,
  Eye,
  GraduationCap,
  KeyRound,
  Megaphone,
  MessageSquare,
  Mic,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  AdminOverviewResponse,
  AdminSystemConfig,
  AdminUserRecord,
  AuthUser,
  LicenseStatus,
  UserAccountStatus,
  UserModulePermissions,
  UserPlan,
  UserRole,
} from '../types';

interface Props {
  currentUser: AuthUser;
}

const MODULE_META: Array<{
  key: keyof UserModulePermissions;
  label: string;
  desc: string;
  icon: typeof MessageSquare;
}> = [
  {
    key: 'conversations',
    label: 'Conversas & Atendimento IA',
    desc: 'Chat ao vivo, fila de respostas e importação .txt',
    icon: MessageSquare,
  },
  {
    key: 'rules',
    label: 'Fluxos & Personas IA',
    desc: 'Regras por contato, tag e global',
    icon: SlidersHorizontal,
  },
  {
    key: 'training',
    label: 'Treinamento IA',
    desc: 'Simulador, import/export e caracterizador IA',
    icon: GraduationCap,
  },
  {
    key: 'campaigns',
    label: 'Campanhas & Disparos',
    desc: 'Disparador sequencial anti-ban',
    icon: Megaphone,
  },
  {
    key: 'vision',
    label: 'Visão IA (Imagens)',
    desc: 'Leitura automática de fotos e comprovantes',
    icon: Eye,
  },
  {
    key: 'audio',
    label: 'Áudio IA (Transcrição)',
    desc: 'Transcrição de mensagens de voz',
    icon: Mic,
  },
];

const DEFAULT_PERMS: UserModulePermissions = {
  conversations: true,
  rules: true,
  training: true,
  campaigns: true,
  vision: true,
  audio: true,
};

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function addDaysIsoDate(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function AdminPage({ currentUser }: Props) {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<
    'ALL' | 'ACTIVE' | 'PENDING' | 'BLOCKED' | 'ADMIN' | 'WA_ONLINE'
  >('ALL');

  // Política global de novos cadastros e licenças padrão
  const [showPolicyPanel, setShowPolicyPanel] = useState(false);
  const [policyForm, setPolicyForm] = useState<AdminSystemConfig>({
    requireAdminApproval: false,
    defaultNewUserPlan: 'FREE',
    defaultTrialDays: 0,
    defaultPermissions: { ...DEFAULT_PERMS },
  });
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policySaved, setPolicySaved] = useState(false);

  // Modal Criar Usuário
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'USER' as UserRole,
    status: 'ACTIVE' as UserAccountStatus,
    plan: 'FREE' as UserPlan,
    licenseStatus: 'ACTIVE' as LicenseStatus,
    licenseExpiresAt: '',
    dailyAiRequestLimit: 250,
    adminNotes: '',
    permissions: { ...DEFAULT_PERMS },
  });
  const [creating, setCreating] = useState(false);

  // Modal Editar Usuário (Permissões, Acesso & Licença)
  const [editingUser, setEditingUser] = useState<AdminUserRecord | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    role: 'USER' as UserRole,
    status: 'ACTIVE' as UserAccountStatus,
    plan: 'FREE' as UserPlan,
    licenseStatus: 'ACTIVE' as LicenseStatus,
    licenseExpiresAt: '',
    dailyAiRequestLimit: 250,
    adminNotes: '',
    newPassword: '',
    permissions: { ...DEFAULT_PERMS },
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const loadOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<AdminOverviewResponse>('/admin/overview');
      setData(res);
      setPolicyForm(res.systemConfig);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao carregar painel administrativo.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  const handleSavePolicy = async (e: FormEvent) => {
    e.preventDefault();
    setSavingPolicy(true);
    setPolicySaved(false);
    try {
      await api.put('/admin/system-config', policyForm);
      setPolicySaved(true);
      await loadOverview();
      setTimeout(() => setPolicySaved(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar política.');
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/admin/users', {
        ...createForm,
        licenseExpiresAt: createForm.licenseExpiresAt
          ? new Date(`${createForm.licenseExpiresAt}T23:59:59`).toISOString()
          : null,
      });
      setShowCreateModal(false);
      setCreateForm({
        name: '',
        email: '',
        password: '',
        role: 'USER',
        status: 'ACTIVE',
        plan: 'FREE',
        licenseStatus: 'ACTIVE',
        licenseExpiresAt: '',
        dailyAiRequestLimit: 250,
        adminNotes: '',
        permissions: { ...DEFAULT_PERMS },
      });
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao criar usuário.');
    } finally {
      setCreating(false);
    }
  };

  const openEditUser = (u: AdminUserRecord) => {
    setEditingUser(u);
    setEditForm({
      name: u.name,
      role: u.role,
      status: u.status,
      plan: u.plan,
      licenseStatus: u.licenseStatus,
      licenseExpiresAt: toDateInputValue(u.licenseExpiresAt),
      dailyAiRequestLimit: u.dailyAiRequestLimit || 250,
      adminNotes: u.adminNotes || '',
      newPassword: '',
      permissions: { ...u.permissions },
    });
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      await api.patch(`/admin/users/${editingUser.id}`, {
        name: editForm.name,
        role: editForm.role,
        status: editForm.status,
        plan: editForm.plan,
        licenseStatus: editForm.licenseStatus,
        licenseExpiresAt: editForm.licenseExpiresAt
          ? new Date(`${editForm.licenseExpiresAt}T23:59:59`).toISOString()
          : null,
        dailyAiRequestLimit: editForm.dailyAiRequestLimit,
        adminNotes: editForm.adminNotes,
        permissions: editForm.permissions,
        ...(editForm.newPassword.trim()
          ? { newPassword: editForm.newPassword.trim() }
          : {}),
      });
      setEditingUser(null);
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao atualizar usuário.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleQuickStatus = async (
    u: AdminUserRecord,
    nextStatus: UserAccountStatus
  ) => {
    const label =
      nextStatus === 'SUSPENDED'
        ? `Suspender o acesso de ${u.name} (${u.email})? O WhatsApp dele será desconectado imediatamente.`
        : `Ativar o acesso de ${u.name} (${u.email})?`;
    if (!confirm(label)) return;
    try {
      await api.patch(`/admin/users/${u.id}`, {
        status: nextStatus,
        ...(nextStatus === 'ACTIVE' && u.licenseStatus === 'SUSPENDED'
          ? { licenseStatus: 'ACTIVE' }
          : {}),
      });
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao alterar status.');
    }
  };

  const handleDeleteUser = async (u: AdminUserRecord) => {
    if (
      !confirm(
        `Excluir PERMANENTEMENTE a conta ${u.name} (${u.email}) e todos os dados/sessões dela? Esta ação não pode ser desfeita.`
      )
    ) {
      return;
    }
    try {
      await api.del(`/admin/users/${u.id}`);
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao excluir usuário.');
    }
  };

  if (loading && !data) {
    return (
      <div className="p-8 text-center text-sm text-slate-400">
        Carregando painel administrativo...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">
        {error}
      </div>
    );
  }

  const summary = data!.summary;
  const users = data!.users;

  const filteredUsers = users.filter((u) => {
    const isExpired =
      u.role !== 'ADMIN' &&
      (u.licenseStatus === 'EXPIRED' ||
        u.licenseStatus === 'SUSPENDED' ||
        (u.licenseExpiresAt &&
          new Date(u.licenseExpiresAt).getTime() < Date.now()));

    if (filter === 'ACTIVE' && u.status !== 'ACTIVE') return false;
    if (filter === 'PENDING' && u.status !== 'PENDING') return false;
    if (filter === 'BLOCKED' && u.status !== 'SUSPENDED' && !isExpired)
      return false;
    if (filter === 'ADMIN' && u.role !== 'ADMIN') return false;
    if (
      filter === 'WA_ONLINE' &&
      u.whatsappStatus !== 'CONNECTED' &&
      u.whatsappStatus !== 'CAMPAIGN_RUNNING'
    ) {
      return false;
    }

    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.plan.toLowerCase().includes(q) ||
      (u.connectedPhone || '').includes(q) ||
      (u.adminNotes || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-white">
            <Shield className="h-6 w-6 text-emerald-400" />
            Administração &amp; Licenças
          </h2>
          <p className="text-sm text-slate-400">
            Gerencie usuários, permissões por módulo, indicadores globais e licenças de uso da plataforma.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPolicyPanel((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
              showPolicyPanel
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
            Política de Novos Cadastros
          </button>
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4" />
            Novo Usuário
          </button>
        </div>
      </div>

      {/* KPIs Consolidados da Plataforma */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Usuários Cadastrados</span>
            <Users className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-white">
            {summary.totalUsers}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {summary.activeUsers} ativos • {summary.suspendedUsers} suspensos
            {summary.pendingUsers > 0 ? ` • ${summary.pendingUsers} pendentes` : ''}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">WhatsApps Conectados</span>
            <Wifi className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-white">
            {summary.connectedWhatsApps}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {summary.totalConversations} conversas no banco •{' '}
            {summary.expiredLicenses} licença(s) vencida(s)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Mensagens na Plataforma</span>
            <MessageSquare className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-white">
            {summary.messagesToday}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            hoje • {summary.messagesMonth.toLocaleString('pt-BR')} no mês
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Consumo Global de IA</span>
            <Cpu className="h-4 w-4 text-violet-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-white">
            {summary.aiRequestsToday}{' '}
            <span className="text-sm font-semibold text-slate-400">req</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {formatCompact(summary.aiTokensToday)} tokens hoje • Mês:{' '}
            {summary.aiRequestsMonth} req ({formatCompact(summary.aiTokensMonth)})
          </p>
        </div>
      </div>

      {/* Painel Retrátil: Política Global de Novos Cadastros e Licenças */}
      {showPolicyPanel && (
        <form
          onSubmit={handleSavePolicy}
          className="space-y-4 rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <KeyRound className="h-4 w-4 text-emerald-400" />
              Política Padrão para Novos Usuários (Cadastro pela Landing Page)
            </h3>
            <button
              type="button"
              onClick={() => setShowPolicyPanel(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs">
              <input
                type="checkbox"
                checked={policyForm.requireAdminApproval}
                onChange={(e) =>
                  setPolicyForm({
                    ...policyForm,
                    requireAdminApproval: e.target.checked,
                  })
                }
                className="mt-0.5 accent-emerald-500"
              />
              <div>
                <p className="font-semibold text-white">
                  Exigir aprovação manual do Admin
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Desmarcado (padrão): novas contas já entram ativas imediatamente.
                </p>
              </div>
            </label>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Plano inicial de novos usuários
              </label>
              <select
                value={policyForm.defaultNewUserPlan}
                onChange={(e) =>
                  setPolicyForm({
                    ...policyForm,
                    defaultNewUserPlan: e.target.value as UserPlan,
                  })
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              >
                <option value="FREE">FREE (Gratuito)</option>
                <option value="TRIAL">TRIAL (Avaliação)</option>
                <option value="PRO">PRO</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Validade padrão em dias (0 = sem expiração)
              </label>
              <input
                type="number"
                min={0}
                value={policyForm.defaultTrialDays}
                onChange={(e) =>
                  setPolicyForm({
                    ...policyForm,
                    defaultTrialDays: Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-slate-300">
              Módulos liberados por padrão para novas contas:
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MODULE_META.map((m) => (
                <label
                  key={m.key}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={policyForm.defaultPermissions[m.key]}
                    onChange={(e) =>
                      setPolicyForm({
                        ...policyForm,
                        defaultPermissions: {
                          ...policyForm.defaultPermissions,
                          [m.key]: e.target.checked,
                        },
                      })
                    }
                    className="accent-emerald-500"
                  />
                  <span className="font-medium text-slate-200">{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            {policySaved && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Política salva!
              </span>
            )}
            <button
              type="submit"
              disabled={savingPolicy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {savingPolicy ? 'Salvando...' : 'Salvar Política Padrão'}
            </button>
          </div>
        </form>
      )}

      {/* Filtros + Busca */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'ALL', label: `Todos (${users.length})` },
            { id: 'ACTIVE', label: `Ativos (${summary.activeUsers})` },
            ...(summary.pendingUsers > 0
              ? [{ id: 'PENDING', label: `Pendentes (${summary.pendingUsers})` }]
              : []),
            {
              id: 'BLOCKED',
              label: `Suspensos / Vencidos (${summary.suspendedUsers + summary.expiredLicenses})`,
            },
            { id: 'WA_ONLINE', label: `WhatsApp Online (${summary.connectedWhatsApps})` },
            { id: 'ADMIN', label: `Admins (${summary.adminUsers})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as typeof filter)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                filter === tab.id
                  ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome, e-mail, plano ou número..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pr-3 pl-9 text-xs text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Lista de Usuários */}
      <div className="space-y-3">
        {filteredUsers.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center text-xs text-slate-500">
            Nenhum usuário encontrado com esse filtro.
          </div>
        ) : (
          filteredUsers.map((u) => {
            const waOnline =
              u.whatsappStatus === 'CONNECTED' ||
              u.whatsappStatus === 'CAMPAIGN_RUNNING';
            const expDate = u.licenseExpiresAt
              ? new Date(u.licenseExpiresAt)
              : null;
            const isExpiredDate =
              expDate && expDate.getTime() < Date.now() && u.role !== 'ADMIN';
            const enabledModulesCount = Object.values(u.permissions).filter(
              Boolean
            ).length;

            return (
              <div
                key={u.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-slate-700"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  {/* Info Principal */}
                  <div className="flex items-start gap-3">
                    {u.avatarUrl ? (
                      <img
                        src={u.avatarUrl}
                        alt={u.name}
                        referrerPolicy="no-referrer"
                        className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-700"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                        {u.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-white">
                          {u.name}
                        </span>
                        {u.isOwner && (
                          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/40">
                            OWNER
                          </span>
                        )}
                        {u.role === 'ADMIN' && !u.isOwner && (
                          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                            ADMIN
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            u.status === 'ACTIVE'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : u.status === 'PENDING'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {u.status === 'ACTIVE'
                            ? 'Ativo'
                            : u.status === 'PENDING'
                              ? 'Pendente'
                              : 'Suspenso'}
                        </span>
                        <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                          Plano: {u.plan}
                        </span>
                        {expDate && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              isExpiredDate
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            <Calendar className="h-2.5 w-2.5" />
                            {isExpiredDate ? 'Venceu ' : 'Até '}
                            {expDate.toLocaleDateString('pt-BR')}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-400">
                        {u.email}
                        {u.lastLoginAt && (
                          <span className="ml-2 text-[11px] text-slate-500">
                            • Último acesso:{' '}
                            {new Date(u.lastLoginAt).toLocaleString('pt-BR')}
                          </span>
                        )}
                      </p>

                      {/* Mini-badges de WhatsApp + Módulos */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px]">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold ${
                            waOnline
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          <Wifi className="h-3 w-3" />
                          {waOnline
                            ? `WA +${u.connectedPhone || 'ativo'}`
                            : 'WA Offline'}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 font-semibold ${
                            u.hasGeminiKey || u.aiProvider === 'ollama'
                              ? 'bg-slate-800 text-slate-200'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {u.aiProvider === 'ollama'
                            ? 'Ollama'
                            : u.hasGeminiKey
                              ? `Gemini (${u.geminiModel || 'ativo'})`
                              : 'Sem API Key'}
                        </span>
                        <span className="rounded-md bg-slate-800/80 px-2 py-0.5 text-slate-300">
                          Módulos: {enabledModulesCount}/6
                        </span>
                        {u.adminNotes && (
                          <span className="max-w-xs truncate rounded-md bg-slate-950 px-2 py-0.5 text-slate-400">
                            Nota: {u.adminNotes}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Indicadores + Ações */}
                  <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
                    <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-center text-[10px]">
                      <div>
                        <p className="font-bold text-white">
                          {u.stats.conversationsCount}
                        </p>
                        <p className="text-slate-500">Chats</p>
                      </div>
                      <div>
                        <p className="font-bold text-sky-300">
                          {u.stats.messagesToday}
                        </p>
                        <p className="text-slate-500">Msgs hoje</p>
                      </div>
                      <div>
                        <p className="font-bold text-violet-300">
                          {u.stats.aiRequestsToday}/{u.dailyAiRequestLimit}
                        </p>
                        <p className="text-slate-500">IA hoje</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditUser(u)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Gerenciar
                      </button>

                      {!u.isOwner && u.id !== currentUser.id && (
                        <>
                          {u.status === 'ACTIVE' ? (
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(u, 'SUSPENDED')}
                              title="Suspender conta"
                              className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-1.5 text-amber-300 transition hover:bg-amber-500/20"
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(u, 'ACTIVE')}
                              title="Ativar / Aprovar conta"
                              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-300 transition hover:bg-emerald-500/20"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u)}
                            title="Excluir usuário"
                            className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-300 transition hover:bg-rose-500/20"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal Criar Novo Usuário */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleCreateUser}
            className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-white">
                <Plus className="h-5 w-5 text-emerald-400" />
                Criar Novo Usuário
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Nome Completo
                </label>
                <input
                  required
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, name: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  E-mail
                </label>
                <input
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, email: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Senha Inicial (mín. 6 caracteres)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, password: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Perfil de Acesso
                </label>
                <select
                  value={createForm.role}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      role: e.target.value as UserRole,
                    })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="USER">Usuário Comum</option>
                  <option value="ADMIN">Administrador</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Plano / Licença
                </label>
                <select
                  value={createForm.plan}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      plan: e.target.value as UserPlan,
                    })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="FREE">FREE</option>
                  <option value="TRIAL">TRIAL</option>
                  <option value="PRO">PRO</option>
                  <option value="ENTERPRISE">ENTERPRISE</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Validade da Licença (opcional)
                </label>
                <input
                  type="date"
                  value={createForm.licenseExpiresAt}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      licenseExpiresAt: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-slate-300">
                Permissões de Módulos:
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODULE_META.map((m) => (
                  <label
                    key={m.key}
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={createForm.permissions[m.key]}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          permissions: {
                            ...createForm.permissions,
                            [m.key]: e.target.checked,
                          },
                        })
                      }
                      className="mt-0.5 accent-emerald-500"
                    />
                    <div>
                      <p className="font-semibold text-white">{m.label}</p>
                      <p className="text-[10px] text-slate-400">{m.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-xl bg-emerald-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {creating ? 'Criando...' : 'Criar Conta'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Gerenciar Usuário (Acesso, Permissões & Licença) */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="max-h-[92vh] w-full max-w-2xl space-y-5 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-white">
                  <Shield className="h-5 w-5 text-emerald-400" />
                  Gerenciar Usuário — {editingUser.name}
                </h3>
                <p className="text-xs text-slate-400">{editingUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Acesso e Perfil */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Nome
                </label>
                <input
                  required
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Papel
                </label>
                <select
                  disabled={editingUser.isOwner}
                  value={editForm.role}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      role: e.target.value as UserRole,
                    })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white disabled:opacity-50"
                >
                  <option value="USER">Usuário</option>
                  <option value="ADMIN">Administrador</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Status da Conta
                </label>
                <select
                  disabled={
                    editingUser.isOwner || editingUser.id === currentUser.id
                  }
                  value={editForm.status}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      status: e.target.value as UserAccountStatus,
                    })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white disabled:opacity-50"
                >
                  <option value="ACTIVE">Ativo</option>
                  <option value="PENDING">Pendente</option>
                  <option value="SUSPENDED">Suspenso (Bloqueado)</option>
                </select>
              </div>
            </div>

            {/* Gestão de Licença */}
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" />
                Gestão de Licença &amp; Limites
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    Plano
                  </label>
                  <select
                    value={editForm.plan}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        plan: e.target.value as UserPlan,
                      })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    <option value="FREE">FREE</option>
                    <option value="TRIAL">TRIAL</option>
                    <option value="PRO">PRO</option>
                    <option value="ENTERPRISE">ENTERPRISE</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    Status da Licença
                  </label>
                  <select
                    value={editForm.licenseStatus}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        licenseStatus: e.target.value as LicenseStatus,
                      })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    <option value="ACTIVE">Ativa</option>
                    <option value="TRIAL">Trial</option>
                    <option value="EXPIRED">Expirada (Bloqueia acesso)</option>
                    <option value="SUSPENDED">Suspensa</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    Limite Diário de IA (ref.)
                  </label>
                  <input
                    type="number"
                    min={10}
                    value={editForm.dailyAiRequestLimit}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        dailyAiRequestLimit: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-slate-400">
                  Validade da Licença (vazio = sem validade / vitalício)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={editForm.licenseExpiresAt}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        licenseExpiresAt: e.target.value,
                      })
                    }
                    className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                  />
                  {[
                    { label: '+30 dias', days: 30 },
                    { label: '+90 dias', days: 90 },
                    { label: '+1 ano', days: 365 },
                  ].map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      onClick={() =>
                        setEditForm({
                          ...editForm,
                          licenseStatus: 'ACTIVE',
                          licenseExpiresAt: addDaysIsoDate(b.days),
                        })
                      }
                      className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                    >
                      {b.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setEditForm({
                        ...editForm,
                        licenseStatus: 'ACTIVE',
                        licenseExpiresAt: '',
                      })
                    }
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
                  >
                    Sem validade
                  </button>
                </div>
              </div>
            </div>

            {/* Permissões de Módulos */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-white">
                  Permissões de Acesso aos Módulos
                </p>
                {editForm.role === 'ADMIN' && (
                  <span className="text-[11px] text-violet-300">
                    Administradores têm acesso total a todos os módulos
                  </span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODULE_META.map((m) => {
                  const Icon = m.icon;
                  const checked =
                    editForm.role === 'ADMIN'
                      ? true
                      : editForm.permissions[m.key];
                  return (
                    <label
                      key={m.key}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs transition ${
                        checked
                          ? 'border-emerald-500/35 bg-emerald-500/10'
                          : 'border-slate-800 bg-slate-950/60 opacity-75'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={editForm.role === 'ADMIN'}
                        checked={checked}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            permissions: {
                              ...editForm.permissions,
                              [m.key]: e.target.checked,
                            },
                          })
                        }
                        className="mt-0.5 accent-emerald-500"
                      />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 font-semibold text-white">
                          <Icon className="h-3.5 w-3.5 text-emerald-400" />
                          {m.label}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {m.desc}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Redefinir senha + Notas */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Redefinir Senha (opcional — deixe vazio p/ manter)
                </label>
                <input
                  type="password"
                  minLength={6}
                  value={editForm.newPassword}
                  onChange={(e) =>
                    setEditForm({ ...editForm, newPassword: e.target.value })
                  }
                  placeholder="Nova senha (mín. 6 caracteres)"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Observações Internas (visível só p/ Admin)
                </label>
                <input
                  value={editForm.adminNotes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, adminNotes: e.target.value })
                  }
                  placeholder="Ex: Cliente parceiro, licença paga via Pix..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
