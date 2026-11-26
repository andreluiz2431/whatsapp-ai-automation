import {
  BookOpen,
  Bot,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { AuthUser, WhatsAppState } from '../types';
import { StatusBadge } from './StatusBadge';

export type NavTab =
  | 'dashboard'
  | 'conversations'
  | 'rules'
  | 'campaigns'
  | 'settings'
  | 'guide';

interface Props {
  user: AuthUser;
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  waState: WhatsAppState;
  unreadTotal: number;
  onToggleGlobalPause: () => void;
  onLogout: () => void;
}

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Painel de Controle', icon: LayoutDashboard },
  { id: 'conversations', label: 'Conversas', icon: MessageSquare },
  { id: 'rules', label: 'Fluxos & Personas IA', icon: SlidersHorizontal },
  { id: 'campaigns', label: 'Campanhas & Disparos', icon: Megaphone },
  { id: 'settings', label: 'Configurações IA', icon: Settings },
  { id: 'guide', label: 'Manual & Sobre', icon: BookOpen },
];

export function Sidebar({
  user,
  activeTab,
  onSelectTab,
  waState,
  unreadTotal,
  onToggleGlobalPause,
  onLogout,
}: Props) {
  return (
    <aside className="flex w-full flex-col border-b border-slate-800 bg-slate-900/90 lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">ZapFlow AI</h1>
            <p className="text-[11px] text-slate-400">WhatsApp 100% Gratuito</p>
          </div>
        </div>
        <div className="flex items-center gap-2 lg:hidden">
          <StatusBadge status={waState.status} compact />
          <button
            onClick={onLogout}
            title="Sair"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-300"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto p-3 lg:flex-1 lg:flex-col lg:overflow-visible">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`flex shrink-0 items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                active
                  ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
              {item.id === 'conversations' && unreadTotal > 0 && (
                <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-slate-950">
                  {unreadTotal}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="hidden space-y-3 border-t border-slate-800 p-4 lg:block">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Seu WhatsApp
            </span>
          </div>
          <StatusBadge status={waState.status} />
          {waState.connectedPhone && (
            <p className="mt-2 truncate text-xs text-slate-400">
              +{waState.connectedPhone}
            </p>
          )}
        </div>

        <button
          onClick={onToggleGlobalPause}
          className={`flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition ${
            waState.globalAutomationPaused
              ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40 hover:bg-amber-500/30'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          {waState.globalAutomationPaused ? (
            <>
              <PlayCircle className="h-4 w-4" />
              Retomar Automação Global
            </>
          ) : (
            <>
              <PauseCircle className="h-4 w-4" />
              Pausar Automação Global
            </>
          )}
        </button>

        {/* Perfil do Usuário + Logout */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                referrerPolicy="no-referrer"
                className="h-8 w-8 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-300">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">
                {user.name}
              </p>
              <p className="truncate text-[10px] text-slate-400">{user.email}</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Sair da conta"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-300"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
