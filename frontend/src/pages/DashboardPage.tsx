import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BellRing,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Power,
  QrCode,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  Trash2,
  Wifi,
} from 'lucide-react';
import { MouseEvent, useEffect, useState } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import { socket } from '../lib/socket';
import {
  ActivityLogEntry,
  CampaignRuntimeState,
  DashboardOverview,
  WhatsAppState,
} from '../types';

interface Props {
  waState: WhatsAppState;
  campaignRuntime: CampaignRuntimeState;
  onToggleGlobalPause: () => void;
  onGoToSettings: () => void;
  onOpenOnboarding: () => void;
  onOpenConversation: (conversationId: string) => void;
}

const LOG_LEVEL_STYLE: Record<ActivityLogEntry['level'], string> = {
  INFO: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
  SUCCESS: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  WARN: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  ERROR: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
};

export function DashboardPage({
  waState,
  campaignRuntime,
  onToggleGlobalPause,
  onGoToSettings,
  onOpenOnboarding,
  onOpenConversation,
}: Props) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [loadingAction, setLoadingAction] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const loadOverview = async () => {
    try {
      const data = await api.get<DashboardOverview>('/dashboard/overview');
      setOverview(data);
      setLogs(data.logs);
    } catch {
      // ignora erro temporário
    }
  };

  useEffect(() => {
    void loadOverview();

    const onLog = (entry: ActivityLogEntry) => {
      setLogs((prev) => [entry, ...prev].slice(0, 80));
    };
    const onRefresh = () => void loadOverview();

    socket.on('activity:log', onLog);
    socket.on('dashboard:refresh', onRefresh);
    return () => {
      socket.off('activity:log', onLog);
      socket.off('dashboard:refresh', onRefresh);
    };
  }, []);

  useEffect(() => {
    if (!campaignRuntime.nextSendAt) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [campaignRuntime.nextSendAt]);

  const handleConnect = async () => {
    setLoadingAction(true);
    try {
      await api.post('/whatsapp/connect');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao iniciar conexão');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleDisconnect = async (clearSession: boolean) => {
    if (
      clearSession &&
      !confirm(
        'Limpar a sessão exigirá escanear o QR Code novamente no WhatsApp. Deseja continuar?'
      )
    ) {
      return;
    }
    setLoadingAction(true);
    try {
      await api.post('/whatsapp/disconnect', { clearSession });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao desconectar');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleDailySummary = async () => {
    setSummarizing(true);
    setSummaryError(null);
    try {
      const res = await api.post<{ summary: string; updatedAt: string }>(
        '/dashboard/daily-summary'
      );
      setOverview((prev) =>
        prev
          ? {
              ...prev,
              dailySummary: { text: res.summary, updatedAt: res.updatedAt },
            }
          : prev
      );
    } catch (err) {
      setSummaryError(
        err instanceof Error ? err.message : 'Erro ao gerar resumo.'
      );
    } finally {
      setSummarizing(false);
    }
  };

  const handleResolveAttention = async (
    e: MouseEvent,
    conversationId: string
  ) => {
    e.stopPropagation();
    try {
      await api.post(`/conversations/${conversationId}/resolve-attention`);
      await loadOverview();
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : 'Erro ao marcar alerta como atendido.'
      );
    }
  };

  const humanAlerts = overview?.humanAttentionAlerts || [];

  const countdownSec = campaignRuntime.nextSendAt
    ? Math.max(
        0,
        Math.ceil((new Date(campaignRuntime.nextSendAt).getTime() - nowMs) / 1000)
      )
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Painel de Controle
          </h2>
          <p className="text-sm text-slate-400">
            Monitore a conexão do WhatsApp, métricas em tempo real e o motor de IA gratuito.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <button
            onClick={onOpenOnboarding}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              !overview?.aiHealth.ready || waState.status === 'DISCONNECTED'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30'
                : 'border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Rocket className="h-3.5 w-3.5" />
            Guia Teleguiado
          </button>
          <button
            onClick={() => void loadOverview()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </button>
        </div>
      </div>

      {/* Alerta Visual Amarelo: Conversas Redirecionadas para Atendimento Humano */}
      {humanAlerts.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-400/70 bg-amber-500/15 p-5 shadow-lg shadow-amber-500/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/40">
                <BellRing className="h-5 w-5 animate-pulse" />
              </span>
              <div>
                <h3 className="flex items-center gap-2 text-sm font-extrabold text-amber-200 sm:text-base">
                  Atenção de Atendente Humano Necessária
                  <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-extrabold text-slate-950">
                    {humanAlerts.length}
                  </span>
                </h3>
                <p className="text-xs text-amber-100/80">
                  Clique em qualquer alerta abaixo para abrir a conversa diretamente e assumir o atendimento.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2.5 md:grid-cols-2">
            {humanAlerts.map((alert) => (
              <div
                key={alert.conversationId}
                role="button"
                tabIndex={0}
                onClick={() => onOpenConversation(alert.conversationId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenConversation(alert.conversationId);
                  }
                }}
                className="group flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-amber-400/40 bg-slate-950/75 p-3.5 text-left transition hover:border-amber-300 hover:bg-amber-500/10"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                    <span className="truncate text-sm font-bold text-white">
                      {alert.contactName}
                    </span>
                    <span className="text-[11px] text-amber-200/80">
                      +{alert.contactPhone}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      •{' '}
                      {new Date(alert.since).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-amber-200">
                    {alert.reason}
                  </p>
                  {alert.lastMessagePreview && (
                    <p className="mt-1 truncate text-[11px] text-slate-300">
                      Última msg: &quot;{alert.lastMessagePreview}&quot;
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-slate-950 transition group-hover:bg-amber-300">
                    Abrir Chat
                    <ArrowRight className="h-3 w-3" />
                  </span>
                  <button
                    type="button"
                    onClick={(e) =>
                      handleResolveAttention(e, alert.conversationId)
                    }
                    className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-amber-200/80 hover:bg-slate-800 hover:text-white"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Marcar atendido
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Conversas Ativas</span>
            <MessageSquare className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-white">
            {overview?.metrics.activeConversations ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {overview?.metrics.autoConversations ?? 0} em modo Automático (IA)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Mensagens Enviadas Hoje</span>
            <Send className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-white">
            {overview?.metrics.messagesSentToday ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {overview?.metrics.messagesReceivedToday ?? 0} recebidas hoje
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Fila de Disparo Pendente</span>
            <Clock className="h-4 w-4 text-violet-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-white">
            {overview?.metrics.pendingQueueCount ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {campaignRuntime.activeCampaignName
              ? `Ativa: ${campaignRuntime.activeCampaignName}`
              : 'Nenhuma campanha disparando'}
          </p>
        </div>

        <div
          onClick={onGoToSettings}
          className="cursor-pointer rounded-2xl border border-slate-800 bg-slate-900/70 p-5 transition hover:border-slate-700"
        >
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Motor de IA</span>
            <Cpu
              className={`h-4 w-4 ${
                overview?.aiHealth.ready ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
          </div>
          <p className="mt-2 text-lg font-bold text-white">
            {overview?.aiHealth.provider === 'ollama'
              ? 'Ollama (Local)'
              : 'Google Gemini'}
          </p>
          <p
            className={`mt-1 truncate text-xs ${
              overview?.aiHealth.ready ? 'text-emerald-400' : 'text-amber-300'
            }`}
            title={overview?.aiHealth.details}
          >
            {overview?.aiHealth.ready
              ? `Pronto • ${overview.aiHealth.model}`
              : overview?.aiHealth.details || 'Verificando...'}
          </p>
        </div>
      </div>

      {/* Conexão WhatsApp + Resumo IA */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Card Conexão / QR Code */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Wifi className="h-5 w-5 text-emerald-400" />
              <h3 className="text-base font-semibold text-white">
                Conexão WhatsApp Web
              </h3>
            </div>
            <StatusBadge status={waState.status} />
          </div>

          <div className="mt-5 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 p-6 text-center">
            {waState.status === 'AWAITING_QR' && waState.qrDataUrl ? (
              <>
                <div className="rounded-2xl bg-white p-3 shadow-lg">
                  <img
                    src={waState.qrDataUrl}
                    alt="QR Code WhatsApp"
                    className="h-52 w-52"
                  />
                </div>
                <p className="mt-3 text-xs font-medium text-amber-300">
                  Abra o WhatsApp no celular → Aparelhos Conectados → Conectar Aparelho
                </p>
              </>
            ) : waState.status === 'CONNECTED' ||
              waState.status === 'CAMPAIGN_RUNNING' ? (
              <div className="py-4">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
                  <Bot className="h-7 w-7" />
                </div>
                <p className="mt-3 text-base font-semibold text-white">
                  {waState.connectedName || 'WhatsApp Conectado'}
                </p>
                {waState.connectedPhone && (
                  <p className="mt-0.5 text-sm text-emerald-400">
                    +{waState.connectedPhone}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  Sessão salva localmente — reconecta automaticamente ao reiniciar.
                </p>
                {campaignRuntime.phase !== 'IDLE' && (
                  <div className="mt-4 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-xs text-violet-200">
                    {campaignRuntime.phase === 'SENDING' &&
                      `Enviando para ${campaignRuntime.currentContactName}...`}
                    {campaignRuntime.phase === 'JITTER_DELAY' &&
                      `Aguardando intervalo anti-ban (${countdownSec ?? 0}s)...`}
                    {campaignRuntime.phase === 'BATCH_PAUSE' &&
                      `Pausa em lote anti-ban (${countdownSec ?? 0}s restantes)...`}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-6">
                <QrCode className="mx-auto h-12 w-12 text-slate-600" />
                <p className="mt-3 text-sm font-medium text-slate-300">
                  Dispositivo desconectado
                </p>
                <p className="mt-1 max-w-xs text-xs text-slate-500">
                  Clique em Conectar para gerar o QR Code via Baileys (100% gratuito e sem navegador headless).
                </p>
              </div>
            )}

            {waState.lastError && (
              <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {waState.lastError}
              </p>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            {waState.status === 'DISCONNECTED' ? (
              <button
                onClick={handleConnect}
                disabled={loadingAction}
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                <Power className="h-4 w-4" />
                {waState.hasSavedSession
                  ? 'Conectar (Sessão Salva)'
                  : 'Conectar via QR Code'}
              </button>
            ) : (
              <button
                onClick={() => handleDisconnect(false)}
                disabled={loadingAction}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
              >
                <Power className="h-4 w-4" />
                Desconectar
              </button>
            )}

            <button
              onClick={onToggleGlobalPause}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition ${
                waState.status === 'DISCONNECTED' ? '' : ''
              } ${
                waState.globalAutomationPaused
                  ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40 hover:bg-amber-500/30'
                  : 'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {waState.globalAutomationPaused ? (
                <>
                  <PlayCircle className="h-4 w-4" />
                  Retomar IA Global
                </>
              ) : (
                <>
                  <PauseCircle className="h-4 w-4" />
                  Pausar IA Global
                </>
              )}
            </button>

            <button
              onClick={() => handleDisconnect(true)}
              disabled={loadingAction}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
            >
              <Trash2 className="h-4 w-4" />
              Limpar Sessão
            </button>
          </div>
        </div>

        {/* Card Resumo Executivo com IA */}
        <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-5 w-5 text-emerald-400" />
              <div>
                <h3 className="text-base font-semibold text-white">
                  Resumo Executivo do Dia (IA)
                </h3>
                {overview?.dailySummary.updatedAt && (
                  <p className="text-[11px] text-slate-400">
                    Atualizado em{' '}
                    {new Date(overview.dailySummary.updatedAt).toLocaleString('pt-BR')}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={handleDailySummary}
              disabled={summarizing}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {summarizing ? 'Analisando dia...' : 'Gerar Resumo do Dia'}
            </button>
          </div>

          {summaryError && (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              {summaryError}
            </div>
          )}

          <div className="mt-4 flex-1 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            {overview?.dailySummary.text ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                {overview.dailySummary.text}
              </div>
            ) : (
              <div className="flex h-full min-h-[160px] flex-col items-center justify-center text-center text-slate-500">
                <Sparkles className="mb-2 h-8 w-8 text-slate-700" />
                <p className="text-sm font-medium text-slate-400">
                  Nenhum resumo gerado hoje ainda
                </p>
                <p className="mt-1 max-w-sm text-xs">
                  Clique em &quot;Gerar Resumo do Dia&quot; para a IA consolidar atendimentos, temas dos clientes e progresso das campanhas.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Log de Atividades em Tempo Real */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Activity className="h-5 w-5 text-emerald-400" />
            <h3 className="text-base font-semibold text-white">
              Log de Atividades em Tempo Real
            </h3>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            WebSocket Ao Vivo
          </span>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {logs.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              Aguardando eventos do sistema...
            </p>
          ) : (
            logs.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-800/80 bg-slate-950/50 px-3.5 py-2.5 text-xs"
              >
                <span className="font-mono text-[11px] text-slate-500">
                  {new Date(entry.createdAt).toLocaleTimeString('pt-BR')}
                </span>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                    LOG_LEVEL_STYLE[entry.level] || LOG_LEVEL_STYLE.INFO
                  }`}
                >
                  {entry.category}
                </span>
                <span className="flex-1 text-slate-200">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
