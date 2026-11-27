import {
  AlertTriangle,
  BellRing,
  Bot,
  CheckCircle2,
  CheckSquare,
  Clock,
  Eye,
  FileText,
  Loader2,
  Megaphone,
  MessageSquarePlus,
  Mic,
  Search,
  Send,
  Sparkles,
  Square,
  Tag as TagIcon,
  Upload,
  User,
  X,
} from 'lucide-react';
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { socket } from '../lib/socket';
import {
  AiReplyQueueItem,
  AiRule,
  Conversation,
  Message,
  Tag,
  WhatsAppState,
} from '../types';

interface Props {
  waState: WhatsAppState;
  onUnreadChange: () => void;
  initialConversationId?: string | null;
  onConsumedInitialConversation?: () => void;
}

export function ConversationsPage({
  waState,
  onUnreadChange,
  initialConversationId,
  onConsumedInitialConversation,
}: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyQueue, setReplyQueue] = useState<AiReplyQueueItem[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [allRules, setAllRules] = useState<AiRule[]>([]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [aiReplying, setAiReplying] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showTagsPanel, setShowTagsPanel] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newFirstMsg, setNewFirstMsg] = useState('');

  // Modal Importar Conversa Antiga
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPhone, setImportPhone] = useState('');
  const [importContactName, setImportContactName] = useState('');
  const [importRawText, setImportRawText] = useState('');
  const [importSpeakers, setImportSpeakers] = useState<string[]>([]);
  const [importMySender, setImportMySender] = useState('');
  const [importParsedMessages, setImportParsedMessages] = useState<
    Array<{ sender: string; body: string; timestamp: string | null }>
  >([]);
  const [importMode, setImportMode] = useState<'MANUAL' | 'AUTO'>('MANUAL');
  const [importAutoSummarize, setImportAutoSummarize] = useState(true);
  const [importing, setImporting] = useState(false);
  const [parsingImport, setParsingImport] = useState(false);

  // Seleção em massa (ativar modo IA ou Manual em várias conversas)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);
  const [applyingBulk, setApplyingBulk] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedConv =
    conversations.find((c) => c.id === selectedId) || null;

  const loadConversations = async () => {
    try {
      const data = await api.get<Conversation[]>('/conversations');
      setConversations(data);
      onUnreadChange();
    } catch {
      // ignora
    }
  };

  const loadMeta = async () => {
    try {
      const data = await api.get<{ rules: AiRule[]; tags: Tag[] }>('/rules');
      setAllTags(data.tags);
      setAllRules(data.rules);
    } catch {
      // ignora
    }
  };

  const loadReplyQueue = async () => {
    try {
      const data = await api.get<{ items: AiReplyQueueItem[] }>(
        '/conversations/reply-queue'
      );
      setReplyQueue(data.items || []);
    } catch {
      // ignora
    }
  };

  useEffect(() => {
    void loadConversations();
    void loadMeta();
    void loadReplyQueue();
  }, []);

  useEffect(() => {
    if (initialConversationId) {
      setSelectedId(initialConversationId);
      setShowTagsPanel(false);
      onConsumedInitialConversation?.();
    }
  }, [initialConversationId, onConsumedInitialConversation]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    api
      .get<Message[]>(`/conversations/${selectedId}/messages`)
      .then((msgs) => {
        setMessages(msgs);
        setConversations((prev) =>
          prev.map((c) => (c.id === selectedId ? { ...c, unreadCount: 0 } : c))
        );
        onUnreadChange();
      })
      .catch(() => {});
  }, [selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const onNewMessage = (msg: Message) => {
      if (msg.conversationId === selectedId) {
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
        );
      }
    };
    const onConvUpdated = () => {
      void loadConversations();
    };
    const onReplyQueue = (items: AiReplyQueueItem[]) => {
      setReplyQueue(Array.isArray(items) ? items : []);
    };

    socket.on('message:new', onNewMessage);
    socket.on('conversation:updated', onConvUpdated);
    socket.on('ai:reply-queue', onReplyQueue);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('conversation:updated', onConvUpdated);
      socket.off('ai:reply-queue', onReplyQueue);
    };
  }, [selectedId]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedId || !draft.trim() || sending) return;
    setSending(true);
    try {
      await api.post(`/conversations/${selectedId}/send`, {
        body: draft.trim(),
      });
      setDraft('');
      await loadConversations();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao enviar mensagem.');
    } finally {
      setSending(false);
    }
  };

  const handleToggleMode = async () => {
    if (!selectedConv) return;
    const nextMode = selectedConv.mode === 'AUTO' ? 'MANUAL' : 'AUTO';
    try {
      const updated = await api.patch<Conversation>(
        `/conversations/${selectedConv.id}/mode`,
        { mode: nextMode }
      );
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao alternar modo.');
    }
  };

  const handleAssignRule = async (ruleId: string) => {
    if (!selectedConv) return;
    try {
      const updated = await api.patch<Conversation>(
        `/conversations/${selectedConv.id}/mode`,
        { mode: selectedConv.mode, activeRuleId: ruleId || null }
      );
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao vincular fluxo.');
    }
  };

  const handleAiReplyNow = async () => {
    if (!selectedConv || aiReplying) return;
    setAiReplying(true);
    try {
      await api.post(`/conversations/${selectedConv.id}/ai-reply`);
      await loadConversations();
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : 'Erro ao acionar resposta da IA agora.'
      );
    } finally {
      setAiReplying(false);
    }
  };

  const handleSummarize = async () => {
    if (!selectedConv) return;
    setSummarizing(true);
    setShowSummary(true);
    try {
      const res = await api.post<{ summary: string; updatedAt: string }>(
        `/conversations/${selectedConv.id}/summary`
      );
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedConv.id
            ? { ...c, aiSummary: res.summary, aiSummaryUpdatedAt: res.updatedAt }
            : c
        )
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao gerar resumo.');
    } finally {
      setSummarizing(false);
    }
  };

  const handleToggleTag = async (tagId: string) => {
    if (!selectedConv) return;
    const currentTagIds = (selectedConv.contact.tags || []).map((t) => t.tag.id);
    const nextTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id) => id !== tagId)
      : [...currentTagIds, tagId];

    try {
      const updated = await api.patch<Conversation>(
        `/conversations/${selectedConv.id}/contact`,
        { tagIds: nextTagIds }
      );
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao atualizar tags.');
    }
  };

  const handleStartConversation = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const conv = await api.post<Conversation>('/conversations/start', {
        phone: newPhone,
        name: newName,
        message: newFirstMsg,
      });
      await loadConversations();
      setSelectedId(conv.id);
      setShowNewModal(false);
      setNewPhone('');
      setNewName('');
      setNewFirstMsg('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao iniciar conversa.');
    }
  };

  const applyImportPreview = (res: {
    speakers: string[];
    messages: Array<{ sender: string; body: string; timestamp: string | null }>;
  }) => {
    setImportSpeakers(res.speakers);
    setImportParsedMessages(res.messages);
    if (res.speakers.length > 0 && !res.speakers.includes(importMySender)) {
      const guessedMe = res.speakers[0];
      setImportMySender(guessedMe);
      const other = res.speakers.find((s) => s !== guessedMe);
      if (other && !importContactName) {
        setImportContactName(other);
      }
    }
  };

  const handleImportFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsingImport(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post<{
        speakers: string[];
        messages: Array<{ sender: string; body: string; timestamp: string | null }>;
      }>('/conversations/import-preview', formData);
      applyImportPreview(res);
    } catch (err) {
      alert(
        err instanceof Error ? err.message : 'Erro ao ler arquivo exportado.'
      );
    } finally {
      setParsingImport(false);
      e.target.value = '';
    }
  };

  const handleParseImportText = async () => {
    if (!importRawText.trim()) return;
    setParsingImport(true);
    try {
      const res = await api.post<{
        speakers: string[];
        messages: Array<{ sender: string; body: string; timestamp: string | null }>;
      }>('/conversations/import-preview', { text: importRawText });
      applyImportPreview(res);
    } catch (err) {
      alert(
        err instanceof Error ? err.message : 'Erro ao interpretar conversa.'
      );
    } finally {
      setParsingImport(false);
    }
  };

  const handleConfirmImport = async (e: FormEvent) => {
    e.preventDefault();
    if (importParsedMessages.length === 0 && !importRawText.trim()) {
      alert('Envie um arquivo .txt do WhatsApp ou cole o texto da conversa.');
      return;
    }
    setImporting(true);
    try {
      const res = await api.post<{
        conversation: Conversation;
        importedCount: number;
      }>('/conversations/import', {
        phone: importPhone,
        contactName: importContactName,
        mySenderName: importMySender,
        mode: importMode,
        autoSummarize: importAutoSummarize,
        rawText: importParsedMessages.length === 0 ? importRawText : undefined,
        messages: importParsedMessages.length > 0 ? importParsedMessages : undefined,
      });
      await loadConversations();
      if (res.conversation?.id) {
        setSelectedId(res.conversation.id);
      }
      setShowImportModal(false);
      setImportPhone('');
      setImportContactName('');
      setImportRawText('');
      setImportSpeakers([]);
      setImportMySender('');
      setImportParsedMessages([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao importar conversa.');
    } finally {
      setImporting(false);
    }
  };

  const toggleBulkSelect = (convId: string) => {
    setSelectedBulkIds((prev) =>
      prev.includes(convId)
        ? prev.filter((id) => id !== convId)
        : [...prev, convId]
    );
  };

  const handleBulkMode = async (mode: 'AUTO' | 'MANUAL') => {
    if (selectedBulkIds.length === 0 || applyingBulk) return;
    setApplyingBulk(true);
    try {
      await api.patch('/conversations/bulk-mode', {
        conversationIds: selectedBulkIds,
        mode,
      });
      await loadConversations();
      setSelectedBulkIds([]);
      setSelectionMode(false);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : 'Erro ao atualizar modo das conversas selecionadas.'
      );
    } finally {
      setApplyingBulk(false);
    }
  };

  const handleClearCompletedQueue = async () => {
    try {
      const res = await api.post<{ items: AiReplyQueueItem[] }>(
        '/conversations/reply-queue/clear'
      );
      setReplyQueue(res.items || []);
    } catch {
      // ignora
    }
  };

  const handleResolveAttention = async (conversationId: string) => {
    try {
      const updated = await api.post<Conversation>(
        `/conversations/${conversationId}/resolve-attention`
      );
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
      );
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : 'Erro ao marcar atenção humana como resolvida.'
      );
    }
  };

  const queuedOrProcessingCount = replyQueue.filter(
    (i) => i.status === 'RECEIVED_QUEUED' || i.status === 'PROCESSING'
  ).length;
  const respondingCount = replyQueue.filter(
    (i) => i.status === 'RESPONDING'
  ).length;
  const respondedCount = replyQueue.filter(
    (i) => i.status === 'RESPONDED'
  ).length;
  const failedCount = replyQueue.filter((i) => i.status === 'FAILED').length;

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.contact.name || '').toLowerCase().includes(q) ||
      c.contact.phone.includes(q) ||
      (c.lastMessagePreview || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-7xl flex-col gap-3 lg:h-[calc(100vh-3rem)]">
      {/* Bloco Superior: Fila de Pendência de Respostas da IA em Tempo Real */}
      <div className="shrink-0 rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white">
              <Clock className="h-3.5 w-3.5 text-emerald-400" />
              Fila de Pendência de Respostas (IA)
            </span>
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
              Processando: {queuedOrProcessingCount}
            </span>
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
              Respondendo: {respondingCount}
            </span>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
              Respondidos: {respondedCount}
            </span>
            {failedCount > 0 && (
              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                Erros: {failedCount}
              </span>
            )}
          </div>

          {(respondedCount > 0 || failedCount > 0) && (
            <button
              type="button"
              onClick={handleClearCompletedQueue}
              className="text-[11px] font-medium text-slate-400 transition hover:text-white"
            >
              Limpar concluídos
            </button>
          )}
        </div>

        {replyQueue.length === 0 ? (
          <p className="mt-2 text-[11px] text-slate-500">
            Nenhuma mensagem em processamento no momento. Quando um cliente enviar mensagem com a IA ativa, o status (Na fila → Processando → Respondendo → Respondido) aparecerá aqui ao vivo.
          </p>
        ) : (
          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
            {replyQueue.map((item) => {
              const badgeMeta =
                item.status === 'RECEIVED_QUEUED'
                  ? {
                      label: 'Na fila',
                      cls: 'border-amber-500/35 bg-amber-500/10 text-amber-200',
                      icon: <Clock className="h-3 w-3 text-amber-300" />,
                    }
                  : item.status === 'PROCESSING'
                    ? {
                        label: 'Processando IA',
                        cls: 'border-violet-500/40 bg-violet-500/15 text-violet-200',
                        icon: (
                          <Loader2 className="h-3 w-3 animate-spin text-violet-300" />
                        ),
                      }
                    : item.status === 'RESPONDING'
                      ? {
                          label: 'Respondendo...',
                          cls: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
                          icon: (
                            <span className="h-2 w-2 animate-ping rounded-full bg-sky-400" />
                          ),
                        }
                      : item.status === 'RESPONDED'
                        ? {
                            label: 'Respondido',
                            cls: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200',
                            icon: (
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            ),
                          }
                        : {
                            label: 'Falha',
                            cls: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
                            icon: (
                              <AlertTriangle className="h-3 w-3 text-rose-400" />
                            ),
                          };

              return (
                <button
                  key={item.conversationId}
                  type="button"
                  title={item.detail || item.lastIncomingPreview}
                  onClick={() => {
                    setSelectionMode(false);
                    setSelectedId(item.conversationId);
                  }}
                  className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-left transition hover:brightness-110 ${badgeMeta.cls}`}
                >
                  {badgeMeta.icon}
                  <div className="max-w-[180px]">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] font-bold text-white">
                        {item.contactName}
                      </span>
                      <span className="text-[10px] font-semibold opacity-90">
                        • {badgeMeta.label}
                      </span>
                    </div>
                    <p className="truncate text-[10px] opacity-75">
                      {item.detail || item.lastIncomingPreview}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 lg:flex-row">
      {/* Coluna Esquerda: Lista de Conversas */}
      <div className="flex w-full flex-col border-b border-slate-800 lg:w-80 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="space-y-3 border-b border-slate-800 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-white">Conversas</h2>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowImportModal(true)}
                title="Importar conversa antiga (.txt do WhatsApp ou texto)"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                <Upload className="h-3.5 w-3.5 text-emerald-400" />
                Importar
              </button>
              <button
                onClick={() => setShowNewModal(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                Novo
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar contato ou mensagem..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2 pr-3 pl-9 text-xs text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Controle de Seleção em Massa */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectionMode((prev) => {
                  if (prev) setSelectedBulkIds([]);
                  return !prev;
                });
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                selectionMode
                  ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                  : 'border border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {selectionMode ? 'Sair da Seleção' : 'Selecionar Conversas'}
            </button>

            {selectionMode && filtered.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const filteredIds = filtered.map((c) => c.id);
                  const allSelected = filteredIds.every((id) =>
                    selectedBulkIds.includes(id)
                  );
                  setSelectedBulkIds(allSelected ? [] : filteredIds);
                }}
                className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
              >
                {filtered.every((c) => selectedBulkIds.includes(c.id))
                  ? 'Desmarcar todas'
                  : `Selecionar todas (${filtered.length})`}
              </button>
            )}
          </div>

          {selectionMode && (
            <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-slate-950/90 p-2.5">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>
                  <strong>{selectedBulkIds.length}</strong> conversa(s) selecionada(s)
                </span>
                {selectedBulkIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedBulkIds([])}
                    className="text-slate-400 hover:text-white"
                  >
                    Limpar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={selectedBulkIds.length === 0 || applyingBulk}
                  onClick={() => handleBulkMode('AUTO')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40"
                >
                  <Bot className="h-3.5 w-3.5" />
                  Ativar IA
                </button>
                <button
                  type="button"
                  disabled={selectedBulkIds.length === 0 || applyingBulk}
                  onClick={() => handleBulkMode('MANUAL')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-40"
                >
                  <User className="h-3.5 w-3.5" />
                  Modo Manual
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Nenhuma conversa encontrada. Conecte o WhatsApp ou inicie um novo chat.
            </div>
          ) : (
            filtered.map((conv) => {
              const isSelected = conv.id === selectedId;
              const isChecked = selectedBulkIds.includes(conv.id);
              const label = conv.contact.name || conv.contact.phone;
              return (
                <button
                  key={conv.id}
                  onClick={() => {
                    if (selectionMode) {
                      toggleBulkSelect(conv.id);
                      return;
                    }
                    setSelectedId(conv.id);
                    setShowTagsPanel(false);
                  }}
                  className={`flex w-full items-start gap-3 p-3.5 text-left transition ${
                    selectionMode && isChecked
                      ? 'bg-emerald-500/15'
                      : isSelected
                        ? 'bg-emerald-500/10'
                        : conv.needsHumanAttention
                          ? 'bg-amber-500/10 hover:bg-amber-500/15'
                          : 'hover:bg-slate-800/40'
                  }`}
                >
                  {selectionMode && (
                    <span className="mt-2.5 shrink-0 text-emerald-400">
                      {isChecked ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4 text-slate-500" />
                      )}
                    </span>
                  )}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-emerald-300">
                    {label.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-white">
                        {label}
                      </p>
                      <span className="shrink-0 text-[10px] text-slate-500">
                        {new Date(conv.lastMessageAt).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {conv.lastMessagePreview || 'Sem mensagens ainda'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          conv.mode === 'AUTO'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-sky-500/15 text-sky-300'
                        }`}
                      >
                        {conv.mode === 'AUTO' ? (
                          <>
                            <Bot className="h-3 w-3" /> IA Auto
                          </>
                        ) : (
                          <>
                            <User className="h-3 w-3" /> Manual
                          </>
                        )}
                      </span>
                      {conv.needsHumanAttention && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/40">
                          <BellRing className="h-2.5 w-2.5" /> Atenção Humana
                        </span>
                      )}
                      {(conv.contact.tags || []).slice(0, 2).map(({ tag }) => (
                        <span
                          key={tag.id}
                          className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300"
                        >
                          {tag.name}
                        </span>
                      ))}
                      {conv.unreadCount > 0 && (
                        <span className="ml-auto rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-slate-950">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Coluna Direita: Janela do Chat */}
      <div className="flex flex-1 flex-col bg-slate-950/40">
        {!selectedConv ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-slate-500">
            <Bot className="mb-3 h-12 w-12 text-slate-700" />
            <p className="text-sm font-semibold text-slate-300">
              Selecione uma conversa
            </p>
            <p className="mt-1 max-w-sm text-xs">
              Alterne entre Modo Automático (IA) e Manual (Humano), envie mensagens diretas ou gere resumos com IA.
            </p>
          </div>
        ) : (
          <>
            {/* Header da conversa */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/80 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-bold text-white">
                  {selectedConv.contact.name || selectedConv.contact.phone}
                </h3>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span>+{selectedConv.contact.phone}</span>
                  {selectedConv.resolvedRule && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-300">
                      Regra ({selectedConv.resolvedRule.levelLabel}):{' '}
                      {selectedConv.resolvedRule.name}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowTagsPanel((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  <TagIcon className="h-3.5 w-3.5" />
                  Tags / Fluxo
                </button>

                <button
                  onClick={handleAiReplyNow}
                  disabled={aiReplying || waState.status === 'DISCONNECTED'}
                  title="Gera e envia imediatamente uma resposta da IA para a última mensagem deste chat"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
                >
                  <Bot className="h-3.5 w-3.5" />
                  {aiReplying ? 'IA respondendo...' : 'Responder com IA'}
                </button>

                <button
                  onClick={handleSummarize}
                  disabled={summarizing}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {summarizing ? 'Resumindo...' : 'Resumo IA'}
                </button>

                {/* Switch Automático vs Manual */}
                <button
                  onClick={handleToggleMode}
                  className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                    selectedConv.mode === 'AUTO'
                      ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                      : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                  }`}
                >
                  {selectedConv.mode === 'AUTO' ? (
                    <>
                      <Bot className="h-3.5 w-3.5" />
                      Modo Automático (Assumir Chat)
                    </>
                  ) : (
                    <>
                      <User className="h-3.5 w-3.5" />
                      Modo Manual (Ativar IA)
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Alerta Amarelo dentro do Chat quando transferido para Humano */}
            {selectedConv.needsHumanAttention && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/40 bg-amber-500/15 px-5 py-2.5 text-xs">
                <div className="flex items-center gap-2 text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  <span>
                    <strong>Atenção Humana solicitada:</strong>{' '}
                    {selectedConv.humanAttentionReason ||
                      'Conversa redirecionada para um atendente humano.'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleResolveAttention(selectedConv.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1 text-[11px] font-bold text-slate-950 transition hover:bg-amber-300"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Marcar como atendido
                </button>
              </div>
            )}

            {/* Painel retrátil de Tags & Fluxo */}
            {showTagsPanel && (
              <div className="border-b border-slate-800 bg-slate-900/60 px-5 py-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-400">Tags do contato:</span>
                    {allTags.map((tag) => {
                      const active = (selectedConv.contact.tags || []).some(
                        (t) => t.tag.id === tag.id
                      );
                      return (
                        <button
                          key={tag.id}
                          onClick={() => handleToggleTag(tag.id)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                            active
                              ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200'
                              : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {active ? '✓ ' : '+ '}
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-400">Fluxo específico:</span>
                    <select
                      value={selectedConv.activeRuleId || ''}
                      onChange={(e) => handleAssignRule(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200"
                    >
                      <option value="">Usar hierarquia padrão (Individual → Tag → Global)</option>
                      {allRules.map((r) => (
                        <option key={r.id} value={r.id}>
                          [{r.scope}] {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Painel de Resumo IA da Conversa */}
            {(showSummary || selectedConv.aiSummary) && showSummary && (
              <div className="border-b border-emerald-500/20 bg-emerald-500/5 px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                      <Sparkles className="h-3.5 w-3.5" />
                      Resumo Executivo da Conversa
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-200">
                      {summarizing
                        ? 'Gerando resumo com a IA...'
                        : selectedConv.aiSummary || 'Clique em Resumo IA para gerar.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowSummary(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Lista de Mensagens */}
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {messages.map((msg) => {
                const isOutbound = msg.direction === 'OUTBOUND';
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                        !isOutbound
                          ? 'rounded-tl-sm border border-slate-800 bg-slate-900 text-slate-100'
                          : msg.senderType === 'AI'
                            ? 'rounded-tr-sm border border-emerald-500/30 bg-emerald-500/15 text-emerald-50'
                            : msg.senderType === 'CAMPAIGN'
                              ? 'rounded-tr-sm border border-violet-500/30 bg-violet-500/15 text-violet-50'
                              : 'rounded-tr-sm border border-sky-500/30 bg-sky-500/15 text-sky-50'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-75">
                        {msg.senderType === 'AI' && (
                          <>
                            <Bot className="h-3 w-3 text-emerald-400" /> IA Automática
                          </>
                        )}
                        {msg.senderType === 'HUMAN' && (
                          <>
                            <User className="h-3 w-3 text-sky-400" /> Você (Manual)
                          </>
                        )}
                        {msg.senderType === 'CAMPAIGN' && (
                          <>
                            <Megaphone className="h-3 w-3 text-violet-400" /> Campanha
                          </>
                        )}
                        {msg.senderType === 'CONTACT' && <span>Cliente</span>}
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                      {msg.imageAnalysis && (
                        <div className="mt-2 rounded-xl border border-emerald-500/25 bg-slate-950/70 p-2.5 text-xs text-slate-200">
                          <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                            <Eye className="h-3 w-3" />
                            Leitura da Imagem (IA)
                          </p>
                          <p className="whitespace-pre-wrap leading-relaxed text-slate-300">
                            {msg.imageAnalysis}
                          </p>
                        </div>
                      )}
                      {msg.audioTranscript && (
                        <div className="mt-2 rounded-xl border border-sky-500/25 bg-slate-950/70 p-2.5 text-xs text-slate-200">
                          <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-sky-300">
                            <Mic className="h-3 w-3" />
                            Transcrição do Áudio (IA)
                          </p>
                          <p className="whitespace-pre-wrap leading-relaxed text-slate-300">
                            {msg.audioTranscript}
                          </p>
                        </div>
                      )}
                      <p className="mt-1 text-right text-[10px] opacity-60">
                        {new Date(msg.createdAt).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input de Envio Manual */}
            <form
              onSubmit={handleSend}
              className="border-t border-slate-800 bg-slate-900/80 p-3.5"
            >
              {waState.status === 'DISCONNECTED' && (
                <p className="mb-2 text-xs text-amber-300">
                  WhatsApp desconectado — conecte no Painel de Controle para enviar mensagens.
                </p>
              )}
              <div className="flex items-center gap-2.5">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Digite uma mensagem manual (se configurado, a IA pausa neste chat automaticamente)..."
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  Enviar
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {/* Modal Importar Conversa Antiga */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleConfirmImport}
            className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-white">
                  <Upload className="h-5 w-5 text-emerald-400" />
                  Importar Conversa Antiga do WhatsApp
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Traga o histórico anterior para a IA ter contexto completo quando esse cliente responder novamente.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  WhatsApp do Contato (com DDD) *
                </label>
                <input
                  required
                  value={importPhone}
                  onChange={(e) => setImportPhone(e.target.value)}
                  placeholder="Ex: 5511999998888 ou 11999998888"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Nome do Contato (opcional)
                </label>
                <input
                  value={importContactName}
                  onChange={(e) => setImportContactName(e.target.value)}
                  placeholder="Detectado automaticamente se vazio"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
                />
              </div>
            </div>

            {/* Upload .txt ou Colar Texto */}
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <FileText className="h-4 w-4 text-emerald-400" />
                  1. Envie o arquivo .txt do WhatsApp ou cole o texto
                </span>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25">
                  <Upload className="h-3.5 w-3.5" />
                  {parsingImport ? 'Lendo...' : 'Selecionar arquivo .txt'}
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    onChange={handleImportFileChange}
                    className="hidden"
                  />
                </label>
              </div>
              <p className="text-[11px] text-slate-500">
                No WhatsApp: abra a conversa → menu (⋮) → Mais → Exportar conversa → <strong>Sem mídia</strong>.
              </p>

              <textarea
                rows={4}
                value={importRawText}
                onChange={(e) => setImportRawText(e.target.value)}
                placeholder={`Ou cole aqui no formato exportado pelo WhatsApp ou "Nome: mensagem":\n25/11/2026 14:30 - João: Olá, qual o valor?\n25/11/2026 14:31 - André: Olá João! Custa R$ 97.`}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs text-white"
              />
              {importRawText.trim() && (
                <button
                  type="button"
                  onClick={handleParseImportText}
                  disabled={parsingImport}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  {parsingImport ? 'Interpretando...' : 'Analisar Texto Colado'}
                </button>
              )}
            </div>

            {/* Seleção de quem é você + Preview */}
            {importParsedMessages.length > 0 && (
              <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-300">
                    ✓ {importParsedMessages.length} mensagem(ns) reconhecida(s)
                  </span>
                  <span className="text-slate-400">
                    {importSpeakers.length} participante(s)
                  </span>
                </div>

                {importSpeakers.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-white">
                      2. Qual destes nomes representa VOCÊ (suas mensagens enviadas)?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {importSpeakers.map((sp) => (
                        <button
                          key={sp}
                          type="button"
                          onClick={() => {
                            setImportMySender(sp);
                            const other = importSpeakers.find((s) => s !== sp);
                            if (other) setImportContactName(other);
                          }}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                            importMySender === sp
                              ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                              : 'border-slate-700 bg-slate-900 text-slate-300 hover:text-white'
                          }`}
                        >
                          {importMySender === sp ? '✓ Sou eu: ' : ''}
                          {sp}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-slate-950/70 p-2.5 text-[11px]">
                  {importParsedMessages.slice(0, 5).map((m, i) => (
                    <p key={i} className="truncate text-slate-300">
                      <span
                        className={
                          m.sender === importMySender
                            ? 'font-semibold text-sky-300'
                            : 'font-semibold text-emerald-300'
                        }
                      >
                        [{m.sender === importMySender ? 'Você' : m.sender}]:
                      </span>{' '}
                      {m.body}
                    </p>
                  ))}
                  {importParsedMessages.length > 5 && (
                    <p className="text-slate-500">
                      ... e mais {importParsedMessages.length - 5} mensagem(ns)
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Modo Inicial Após Importar
                </label>
                <select
                  value={importMode}
                  onChange={(e) =>
                    setImportMode(e.target.value as 'MANUAL' | 'AUTO')
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="MANUAL">Manual (você revisa antes de ativar IA)</option>
                  <option value="AUTO">Automático (IA já responde próximas msgs)</option>
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 pt-5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={importAutoSummarize}
                  onChange={(e) => setImportAutoSummarize(e.target.checked)}
                  className="accent-emerald-500"
                />
                Gerar resumo executivo com IA ao importar
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={importing}
                className="rounded-xl bg-emerald-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {importing ? 'Importando...' : 'Importar Conversa'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Iniciar Nova Conversa */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={handleStartConversation}
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                Iniciar Nova Conversa
              </h3>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                WhatsApp (com DDD)
              </label>
              <input
                required
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Ex: 5511999998888 ou 11999998888"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Nome do Contato (opcional)
              </label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: João Silva"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Primeira Mensagem (opcional)
              </label>
              <textarea
                rows={3}
                value={newFirstMsg}
                onChange={(e) => setNewFirstMsg(e.target.value)}
                placeholder="Olá João, tudo bem?"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Criar / Enviar
              </button>
            </div>
          </form>
        </div>
      )}
      </div>
    </div>
  );
}
