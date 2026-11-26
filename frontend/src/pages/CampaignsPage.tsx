import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { socket } from '../lib/socket';
import {
  AiRule,
  AppSettings,
  Campaign,
  CampaignRuntimeState,
  WhatsAppState,
} from '../types';

interface Props {
  waState: WhatsAppState;
  campaignRuntime: CampaignRuntimeState;
}

interface RecipientDraft {
  name: string;
  phone: string;
}

const STATUS_BADGE: Record<Campaign['status'], string> = {
  DRAFT: 'bg-slate-700/60 text-slate-300',
  RUNNING: 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40',
  PAUSED: 'bg-amber-500/20 text-amber-300',
  COMPLETED: 'bg-emerald-500/20 text-emerald-300',
  CANCELLED: 'bg-rose-500/20 text-rose-300',
};

export function CampaignsPage({ waState, campaignRuntime }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [rules, setRules] = useState<AiRule[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<Campaign | null>(null);
  const [showBuilder, setShowBuilder] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());

  // Form nova campanha
  const [name, setName] = useState('');
  const [messageTemplate, setMessageTemplate] = useState(
    'Olá {{nome}}, tudo bem? Passando para apresentar uma novidade especial!'
  );
  const [useAiVariation, setUseAiVariation] = useState(true);
  const [autoEnableAiOnReply, setAutoEnableAiOnReply] = useState(true);
  const [aiRuleId, setAiRuleId] = useState('');
  const [minDelaySec, setMinDelaySec] = useState(45);
  const [maxDelaySec, setMaxDelaySec] = useState(120);
  const [batchSize, setBatchSize] = useState(20);
  const [batchPauseMin, setBatchPauseMin] = useState(5);

  // Importação de contatos
  const [importMode, setImportMode] = useState<'paste' | 'csv' | 'manual'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [recipients, setRecipients] = useState<RecipientDraft[]>([]);
  const [creating, setCreating] = useState(false);

  const loadCampaigns = async () => {
    try {
      const res = await api.get<{ campaigns: Campaign[] }>('/campaigns');
      setCampaigns(res.campaigns);
      if (expandedId) {
        const detail = await api.get<Campaign>(`/campaigns/${expandedId}`);
        setExpandedDetail(detail);
      }
    } catch {
      // ignora
    }
  };

  useEffect(() => {
    void loadCampaigns();
    api
      .get<{ rules: AiRule[] }>('/rules')
      .then((r) => setRules(r.rules))
      .catch(() => {});
    api
      .get<{ settings: AppSettings }>('/settings')
      .then((s) => {
        if (s.settings) {
          setMinDelaySec(s.settings.defaultMinDelaySec);
          setMaxDelaySec(s.settings.defaultMaxDelaySec);
          setBatchSize(s.settings.defaultBatchSize);
          setBatchPauseMin(s.settings.defaultBatchPauseMin);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onProgress = () => void loadCampaigns();
    socket.on('campaign:progress', onProgress);
    return () => {
      socket.off('campaign:progress', onProgress);
    };
  }, [expandedId]);

  useEffect(() => {
    if (!campaignRuntime.nextSendAt) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [campaignRuntime.nextSendAt]);

  const mergeRecipients = (incoming: RecipientDraft[]) => {
    setRecipients((prev) => {
      const map = new Map(prev.map((r) => [r.phone, r]));
      for (const item of incoming) {
        map.set(item.phone, item);
      }
      return Array.from(map.values());
    });
  };

  const handleParseText = async () => {
    if (!pasteText.trim()) return;
    try {
      const res = await api.post<{ recipients: RecipientDraft[] }>(
        '/campaigns/parse-contacts',
        { text: pasteText }
      );
      mergeRecipients(res.recipients);
      setPasteText('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao importar texto.');
    }
  };

  const handleCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post<{ recipients: RecipientDraft[] }>(
        '/campaigns/parse-contacts',
        formData
      );
      mergeRecipients(res.recipients);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao ler arquivo CSV.');
    } finally {
      e.target.value = '';
    }
  };

  const handleAddManual = () => {
    const digits = manualPhone.replace(/\D/g, '');
    if (digits.length < 8) {
      alert('Digite um número válido com DDD.');
      return;
    }
    const normalized =
      (digits.length === 10 || digits.length === 11) && !digits.startsWith('55')
        ? `55${digits}`
        : digits;
    mergeRecipients([
      { name: manualName.trim() || 'Contato', phone: normalized },
    ]);
    setManualName('');
    setManualPhone('');
  };

  const handleCreateCampaign = async (
    e: FormEvent,
    startImmediately: boolean
  ) => {
    e.preventDefault();
    if (recipients.length === 0) {
      alert('Adicione ao menos 1 contato à lista antes de criar a campanha.');
      return;
    }
    setCreating(true);
    try {
      await api.post('/campaigns', {
        name,
        messageTemplate,
        useAiVariation,
        autoEnableAiOnReply,
        aiRuleId: aiRuleId || null,
        minDelaySec,
        maxDelaySec,
        batchSize,
        batchPauseMin,
        recipients,
        startImmediately,
      });
      setName('');
      setRecipients([]);
      await loadCampaigns();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao criar campanha.');
    } finally {
      setCreating(false);
    }
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    const detail = await api.get<Campaign>(`/campaigns/${id}`);
    setExpandedDetail(detail);
  };

  const handleAction = async (
    id: string,
    action: 'start' | 'pause' | 'cancel' | 'delete'
  ) => {
    try {
      if (action === 'delete') {
        if (!confirm('Excluir esta campanha do histórico?')) return;
        await api.del(`/campaigns/${id}`);
      } else {
        await api.post(`/campaigns/${id}/${action}`);
      }
      await loadCampaigns();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro na ação da campanha.');
    }
  };

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
            Campanhas &amp; Disparador Anti-Ban
          </h2>
          <p className="text-sm text-slate-400">
            Importe listas por texto ou CSV, personalize com {'{{nome}}'} e controle rigorosamente os intervalos de disparo.
          </p>
        </div>
        <button
          onClick={() => setShowBuilder((v) => !v)}
          className="inline-flex items-center gap-2 self-start rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
        >
          <Plus className="h-4 w-4" />
          {showBuilder ? 'Ocultar Formulário' : 'Nova Campanha'}
        </button>
      </div>

      {/* Formulário Nova Campanha */}
      {showBuilder && (
        <form
          onSubmit={(e) => handleCreateCampaign(e, false)}
          className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6"
        >
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Esquerda: Mensagem + IA + Anti-Ban */}
            <div className="space-y-4 lg:col-span-7">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">
                  Nome da Campanha
                </label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Reativação de Leads — Novembro"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">
                    Mensagem Inicial
                  </label>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setMessageTemplate((prev) => `${prev} {{nome}}`)
                      }
                      className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-emerald-300 hover:bg-slate-700"
                    >
                      + {'{{nome}}'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setMessageTemplate((prev) => `${prev} {{primeiro_nome}}`)
                      }
                      className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-emerald-300 hover:bg-slate-700"
                    >
                      + {'{{primeiro_nome}}'}
                    </button>
                  </div>
                </div>
                <textarea
                  required
                  rows={4}
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white"
                />
              </div>

              {/* Opções de IA */}
              <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                  <input
                    type="checkbox"
                    checked={useAiVariation}
                    onChange={(e) => setUseAiVariation(e.target.checked)}
                    className="mt-0.5 rounded border-slate-600 accent-emerald-500"
                  />
                  <span>
                    <strong className="flex items-center gap-1 text-emerald-300">
                      <Sparkles className="h-3.5 w-3.5" />
                      Variar saudação/texto com IA (Recomendado Anti-Ban)
                    </strong>
                    <span className="text-slate-400">
                      Gera pequenas variações naturais em cada disparo para não enviar textos 100% idênticos.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                  <input
                    type="checkbox"
                    checked={autoEnableAiOnReply}
                    onChange={(e) => setAutoEnableAiOnReply(e.target.checked)}
                    className="mt-0.5 rounded border-slate-600 accent-emerald-500"
                  />
                  <span>
                    <strong className="flex items-center gap-1 text-white">
                      <Bot className="h-3.5 w-3.5 text-emerald-400" />
                      Ativar IA automaticamente quando o contato responder
                    </strong>
                    <span className="text-slate-400">
                      A IA assume a conversa usando o fluxo escolhido abaixo (ou a hierarquia padrão).
                    </span>
                  </span>
                </label>

                {autoEnableAiOnReply && (
                  <div className="pt-1 pl-6">
                    <label className="mb-1 block text-[11px] font-medium text-slate-400">
                      Fluxo / Persona da IA para respostas desta campanha
                    </label>
                    <select
                      value={aiRuleId}
                      onChange={(e) => setAiRuleId(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                    >
                      <option value="">Usar hierarquia padrão (Individual → Tag → Global)</option>
                      {rules.map((r) => (
                        <option key={r.id} value={r.id}>
                          [{r.scope}] {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Controle Anti-Bloqueio */}
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-bold text-amber-300">
                  <ShieldCheck className="h-4 w-4" />
                  Controle Anti-Bloqueio (Padrão Recomendado Pré-Configurado)
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Mínimo (seg)
                    </label>
                    <input
                      type="number"
                      min={5}
                      value={minDelaySec}
                      onChange={(e) => setMinDelaySec(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Máximo (seg)
                    </label>
                    <input
                      type="number"
                      min={minDelaySec}
                      value={maxDelaySec}
                      onChange={(e) => setMaxDelaySec(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Lote (msgs)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={batchSize}
                      onChange={(e) => setBatchSize(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Pausa lote (min)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={batchPauseMin}
                      onChange={(e) => setBatchPauseMin(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>
                <p className="mt-2.5 text-[11px] text-slate-400">
                  Inclui simulação automática de <strong>&quot;digitando...&quot; (3 a 7s)</strong> antes de cada envio e fila sequencial estrita (nunca envia 2 mensagens simultâneas). Números novos: máximo 20–30/dia; antigos: &lt;80–100/dia.
                </p>
              </div>
            </div>

            {/* Direita: Importação de Contatos */}
            <div className="flex flex-col space-y-3 lg:col-span-5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                  <Users className="h-4 w-4 text-emerald-400" />
                  Lista de Contatos ({recipients.length})
                </label>
                <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
                  {[
                    { id: 'paste', label: 'Colar Texto' },
                    { id: 'csv', label: 'CSV' },
                    { id: 'manual', label: 'Manual' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setImportMode(m.id as typeof importMode)}
                      className={`rounded-md px-2.5 py-1 font-medium ${
                        importMode === m.id
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {importMode === 'paste' && (
                <div className="space-y-2">
                  <textarea
                    rows={4}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={`Cole uma linha por contato (Nome, Número):\nJoão Silva, 11999998888\nMaria Oliveira, 5521988887777`}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={handleParseText}
                    className="w-full rounded-xl bg-slate-800 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Importar Contatos do Texto
                  </button>
                </div>
              )}

              {importMode === 'csv' && (
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/60 p-6 text-center hover:border-emerald-500/50">
                  <Upload className="h-6 w-6 text-emerald-400" />
                  <span className="mt-2 text-xs font-medium text-slate-200">
                    Clique para enviar arquivo CSV (colunas: Nome, Telefone)
                  </span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleCsvUpload}
                    className="hidden"
                  />
                </label>
              )}

              {importMode === 'manual' && (
                <div className="flex gap-2">
                  <input
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Nome"
                    className="w-1/2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                  <input
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder="WhatsApp (DDD+Nº)"
                    className="w-1/2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddManual}
                    className="rounded-xl bg-emerald-500/20 px-3 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30"
                  >
                    +
                  </button>
                </div>
              )}

              {/* Preview da Lista */}
              <div className="flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-2 max-h-60">
                {recipients.length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-500">
                    Nenhum contato adicionado ainda.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {recipients.map((r) => (
                      <div
                        key={r.phone}
                        className="flex items-center justify-between rounded-lg bg-slate-900/80 px-3 py-1.5 text-xs"
                      >
                        <div>
                          <span className="font-medium text-slate-200">{r.name}</span>
                          <span className="ml-2 font-mono text-[11px] text-slate-400">
                            +{r.phone}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setRecipients((prev) =>
                              prev.filter((item) => item.phone !== r.phone)
                            )
                          }
                          className="text-slate-500 hover:text-rose-400"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  Salvar como Rascunho
                </button>
                <button
                  type="button"
                  disabled={creating || waState.status === 'DISCONNECTED'}
                  onClick={(e) => handleCreateCampaign(e, true)}
                  className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  Criar e Iniciar Disparos
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Lista de Campanhas e Progresso */}
      <div className="space-y-4">
        <h3 className="text-base font-bold text-white">
          Campanhas e Fila de Disparo ({campaigns.length})
        </h3>

        {campaigns.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center text-sm text-slate-500">
            Nenhuma campanha criada ainda.
          </div>
        ) : (
          campaigns.map((camp) => {
            const processed = camp.sentCount + camp.failedCount;
            const pending = Math.max(0, camp.totalCount - processed);
            const pct =
              camp.totalCount > 0
                ? Math.round((processed / camp.totalCount) * 100)
                : 0;
            const isRuntimeActive =
              campaignRuntime.activeCampaignId === camp.id;

            return (
              <div
                key={camp.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-bold text-white">
                        {camp.name}
                      </h4>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          STATUS_BADGE[camp.status]
                        }`}
                      >
                        {camp.status}
                      </span>
                      {camp.autoEnableAiOnReply && (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                          IA Pós-Resposta{camp.aiRule ? `: ${camp.aiRule.name}` : ''}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Anti-ban: {camp.minDelaySec}s–{camp.maxDelaySec}s • Pausa de{' '}
                      {camp.batchPauseMin}min a cada {camp.batchSize} msgs
                      {camp.useAiVariation ? ' • Variação IA ativa' : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {(camp.status === 'DRAFT' || camp.status === 'PAUSED') && (
                      <button
                        onClick={() => handleAction(camp.id, 'start')}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                      >
                        <Play className="h-3.5 w-3.5" />
                        {camp.status === 'PAUSED' ? 'Retomar' : 'Iniciar'}
                      </button>
                    )}
                    {camp.status === 'RUNNING' && (
                      <button
                        onClick={() => handleAction(camp.id, 'pause')}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/20 px-3.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/30"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        Pausar
                      </button>
                    )}
                    {(camp.status === 'RUNNING' || camp.status === 'PAUSED') && (
                      <button
                        onClick={() => handleAction(camp.id, 'cancel')}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                      >
                        <StopCircle className="h-3.5 w-3.5" />
                        Cancelar
                      </button>
                    )}
                    {camp.status !== 'RUNNING' && (
                      <button
                        onClick={() => handleAction(camp.id, 'delete')}
                        className="rounded-xl p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleExpand(camp.id)}
                      className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700"
                    >
                      {expandedId === camp.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Barra de Progresso + Contadores */}
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <div className="flex flex-wrap gap-4">
                      <span className="inline-flex items-center gap-1 text-slate-300">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        Pendentes: <strong>{pending}</strong>
                      </span>
                      <span className="inline-flex items-center gap-1 text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Enviados: <strong>{camp.sentCount}</strong>
                      </span>
                      <span className="inline-flex items-center gap-1 text-rose-300">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Erros: <strong>{camp.failedCount}</strong>
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-white">
                      {pct}% ({processed}/{camp.totalCount})
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Status Anti-Ban ao Vivo */}
                {isRuntimeActive && campaignRuntime.phase !== 'IDLE' && (
                  <div className="mt-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-xs text-violet-200">
                    {campaignRuntime.phase === 'SENDING' &&
                      `Simulando digitação e enviando para ${campaignRuntime.currentContactName}...`}
                    {campaignRuntime.phase === 'JITTER_DELAY' &&
                      `Intervalo anti-ban ativo — próximo disparo em ${countdownSec ?? 0}s`}
                    {campaignRuntime.phase === 'BATCH_PAUSE' &&
                      `Pausa em lote anti-ban ativa — retomando em ${countdownSec ?? 0}s`}
                  </div>
                )}

                {/* Detalhe dos Contatos da Campanha */}
                {expandedId === camp.id && expandedDetail?.items && (
                  <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-800 text-[11px] text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Contato</th>
                          <th className="px-3 py-2">Telefone</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Detalhe / Mensagem</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {expandedDetail.items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2 font-medium text-slate-200">
                              {item.name}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-400">
                              +{item.phone}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                                  item.status === 'SENT'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : item.status === 'FAILED'
                                      ? 'bg-rose-500/15 text-rose-300'
                                      : item.status === 'SENDING'
                                        ? 'bg-violet-500/15 text-violet-300'
                                        : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td className="max-w-xs truncate px-3 py-2 text-slate-400">
                              {item.errorMessage || item.resolvedMessage || 'Na fila'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
