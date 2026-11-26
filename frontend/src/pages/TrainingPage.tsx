import {
  BookCheck,
  Bot,
  Check,
  Edit3,
  GraduationCap,
  History,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  ThumbsUp,
  Trash2,
  User,
  Wand2,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { AiTrainingExample, TrainingExtractionResult } from '../types';

interface RuleSummary {
  id: string;
  name: string;
  scope: string;
  isActive: boolean;
  objective: string;
  knowledgeBase: string;
}

interface ConvSummary {
  id: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  contact: { id: string; name: string | null; phone: string };
  _count: { messages: number };
}

interface SimMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  savedAsExample?: boolean;
}

type TrainingTab = 'simulator' | 'history' | 'examples';

export function TrainingPage() {
  const [tab, setTab] = useState<TrainingTab>('simulator');
  const [examples, setExamples] = useState<AiTrainingExample[]>([]);
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');

  // Simulador ao vivo
  const [simMessages, setSimMessages] = useState<SimMessage[]>([]);
  const [simInput, setSimInput] = useState('');
  const [simLoading, setSimLoading] = useState(false);
  const [simFeedback, setSimFeedback] = useState('');
  const [analyzingSim, setAnalyzingSim] = useState(false);
  const [simExtraction, setSimExtraction] =
    useState<TrainingExtractionResult | null>(null);
  const [correctingIndex, setCorrectingIndex] = useState<number | null>(null);
  const [correctionIdeal, setCorrectionIdeal] = useState('');
  const [correctionNote, setCorrectionNote] = useState('');
  const simEndRef = useRef<HTMLDivElement>(null);

  // Análise de conversa real
  const [selectedConvId, setSelectedConvId] = useState('');
  const [historyFeedback, setHistoryFeedback] = useState('');
  const [analyzingConv, setAnalyzingConv] = useState(false);
  const [convExtraction, setConvExtraction] =
    useState<TrainingExtractionResult | null>(null);
  const [savedSuggestionKeys, setSavedSuggestionKeys] = useState<string[]>([]);
  const [appliedKnowledgeMsg, setAppliedKnowledgeMsg] = useState<string | null>(
    null
  );

  // Form exemplo manual
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCustomerMsg, setNewCustomerMsg] = useState('');
  const [newIdealResp, setNewIdealResp] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newRuleId, setNewRuleId] = useState('');

  const loadOverview = async () => {
    try {
      const data = await api.get<{
        examples: AiTrainingExample[];
        rules: RuleSummary[];
        conversations: ConvSummary[];
      }>('/training/overview');
      setExamples(data.examples);
      setRules(data.rules);
      setConversations(data.conversations);
      if (!selectedRuleId && data.rules.length > 0) {
        const globalRule =
          data.rules.find((r) => r.scope === 'GLOBAL') || data.rules[0];
        setSelectedRuleId(globalRule.id);
      }
      if (!selectedConvId && data.conversations.length > 0) {
        setSelectedConvId(data.conversations[0].id);
      }
    } catch {
      // ignora erro temporário
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    simEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [simMessages]);

  const handleSimSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!simInput.trim() || simLoading) return;

    const userMsg: SimMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: simInput.trim(),
    };
    const nextHistory = [...simMessages, userMsg];
    setSimMessages(nextHistory);
    setSimInput('');
    setSimLoading(true);

    try {
      const res = await api.post<{
        reply: string;
        ruleName: string;
        shouldTransferToHuman: boolean;
      }>('/training/simulate', {
        ruleId: selectedRuleId || null,
        messages: nextHistory.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
      setSimMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.shouldTransferToHuman
            ? `${res.reply}\n\n[Transferência automática para humano acionada]`
            : res.reply,
        },
      ]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao simular IA.');
    } finally {
      setSimLoading(false);
    }
  };

  const getPreviousCustomerMessage = (assistantIdx: number): string => {
    for (let i = assistantIdx - 1; i >= 0; i--) {
      if (simMessages[i].role === 'user') return simMessages[i].content;
    }
    return '';
  };

  const handleApproveSimReply = async (assistantIdx: number) => {
    const customerMessage = getPreviousCustomerMessage(assistantIdx);
    const idealResponse = simMessages[assistantIdx].content;
    if (!customerMessage) return;

    try {
      await api.post('/training/examples', {
        ruleId: selectedRuleId || null,
        customerMessage,
        idealResponse,
        feedbackNote: 'Resposta aprovada no simulador de treinamento.',
        source: 'SIMULATOR',
      });
      setSimMessages((prev) =>
        prev.map((m, i) =>
          i === assistantIdx ? { ...m, savedAsExample: true } : m
        )
      );
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao aprovar exemplo.');
    }
  };

  const handleSaveCorrection = async (e: FormEvent, assistantIdx: number) => {
    e.preventDefault();
    const customerMessage = getPreviousCustomerMessage(assistantIdx);
    if (!customerMessage || !correctionIdeal.trim()) return;

    try {
      await api.post('/training/examples', {
        ruleId: selectedRuleId || null,
        customerMessage,
        idealResponse: correctionIdeal.trim(),
        feedbackNote:
          correctionNote.trim() || 'Correção manual feita no simulador.',
        source: 'SIMULATOR',
      });
      setSimMessages((prev) =>
        prev.map((m, i) =>
          i === assistantIdx
            ? {
                ...m,
                content: correctionIdeal.trim(),
                savedAsExample: true,
              }
            : m
        )
      );
      setCorrectingIndex(null);
      setCorrectionIdeal('');
      setCorrectionNote('');
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar correção.');
    }
  };

  const handleAnalyzeSimulator = async () => {
    if (simMessages.length === 0) return;
    setAnalyzingSim(true);
    setSimExtraction(null);
    setSavedSuggestionKeys([]);
    setAppliedKnowledgeMsg(null);
    try {
      const res = await api.post<TrainingExtractionResult>(
        '/training/analyze-simulator',
        {
          ruleId: selectedRuleId || null,
          feedback: simFeedback,
          messages: simMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }
      );
      setSimExtraction(res);
    } catch (err) {
      alert(
        err instanceof Error ? err.message : 'Erro ao analisar sessão de treino.'
      );
    } finally {
      setAnalyzingSim(false);
    }
  };

  const handleAnalyzeConversation = async () => {
    if (!selectedConvId) return;
    setAnalyzingConv(true);
    setConvExtraction(null);
    setSavedSuggestionKeys([]);
    setAppliedKnowledgeMsg(null);
    try {
      const res = await api.post<TrainingExtractionResult>(
        '/training/analyze-conversation',
        {
          conversationId: selectedConvId,
          ruleId: selectedRuleId || null,
          feedback: historyFeedback,
        }
      );
      setConvExtraction(res);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : 'Erro ao analisar conversa do WhatsApp.'
      );
    } finally {
      setAnalyzingConv(false);
    }
  };

  const handleSaveSuggestedExample = async (
    key: string,
    ex: { customerMessage: string; idealResponse: string; feedbackNote: string },
    source: 'SIMULATOR' | 'CONVERSATION'
  ) => {
    try {
      await api.post('/training/examples', {
        ruleId: selectedRuleId || null,
        customerMessage: ex.customerMessage,
        idealResponse: ex.idealResponse,
        feedbackNote: ex.feedbackNote,
        source,
      });
      setSavedSuggestionKeys((prev) => [...prev, key]);
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar sugestão.');
    }
  };

  const handleApplyKnowledge = async (knowledgeAddition: string) => {
    if (!selectedRuleId) {
      alert('Selecione uma regra de destino no topo da tela.');
      return;
    }
    try {
      await api.post('/training/apply-knowledge', {
        ruleId: selectedRuleId,
        knowledgeAddition,
      });
      setAppliedKnowledgeMsg(
        'Conhecimento incorporado automaticamente na Base de Conhecimento da regra selecionada!'
      );
      await loadOverview();
    } catch (err) {
      alert(
        err instanceof Error ? err.message : 'Erro ao aplicar conhecimento.'
      );
    }
  };

  const handleAddManualExample = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/training/examples', {
        ruleId: newRuleId || null,
        customerMessage: newCustomerMsg,
        idealResponse: newIdealResp,
        feedbackNote: newNote,
        source: 'MANUAL',
      });
      setNewCustomerMsg('');
      setNewIdealResp('');
      setNewNote('');
      setShowAddForm(false);
      await loadOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar exemplo.');
    }
  };

  const handleToggleExample = async (ex: AiTrainingExample) => {
    await api.put(`/training/examples/${ex.id}`, { isActive: !ex.isActive });
    await loadOverview();
  };

  const handleDeleteExample = async (id: string) => {
    if (!confirm('Excluir este exemplo de treinamento?')) return;
    await api.del(`/training/examples/${id}`);
    await loadOverview();
  };

  const renderExtractionPanel = (
    extraction: TrainingExtractionResult,
    source: 'SIMULATOR' | 'CONVERSATION'
  ) => (
    <div className="space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
      <h4 className="flex items-center gap-2 text-sm font-bold text-emerald-300">
        <Sparkles className="h-4 w-4" />
        Aprendizados Extraídos pela IA
      </h4>

      {extraction.promptTips && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs">
          <p className="font-semibold text-white">Diagnóstico &amp; Dicas:</p>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-300">
            {extraction.promptTips}
          </p>
        </div>
      )}

      {extraction.knowledgeAdditions && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-amber-300">
              Sugestão para Base de Conhecimento:
            </p>
            <button
              type="button"
              onClick={() => handleApplyKnowledge(extraction.knowledgeAdditions)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 hover:bg-emerald-400"
            >
              <BookCheck className="h-3.5 w-3.5" />
              Incorporar na Regra Selecionada
            </button>
          </div>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed text-slate-300">
            {extraction.knowledgeAdditions}
          </p>
          {appliedKnowledgeMsg && (
            <p className="mt-2 font-semibold text-emerald-400">
              ✓ {appliedKnowledgeMsg}
            </p>
          )}
        </div>
      )}

      {extraction.suggestedExamples.length > 0 && (
        <div className="space-y-2.5">
          <p className="text-xs font-semibold text-slate-300">
            Exemplos Sugeridos ({extraction.suggestedExamples.length}):
          </p>
          {extraction.suggestedExamples.map((ex, idx) => {
            const key = `${source}-${idx}`;
            const saved = savedSuggestionKeys.includes(key);
            return (
              <div
                key={key}
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <p>
                      <span className="font-semibold text-slate-400">
                        Cliente:{' '}
                      </span>
                      <span className="text-slate-200">{ex.customerMessage}</span>
                    </p>
                    <p>
                      <span className="font-semibold text-emerald-300">
                        Resposta ideal:{' '}
                      </span>
                      <span className="text-white">{ex.idealResponse}</span>
                    </p>
                    {ex.feedbackNote && (
                      <p className="text-[11px] text-slate-400">
                        Obs: {ex.feedbackNote}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={saved}
                    onClick={() => handleSaveSuggestedExample(key, ex, source)}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                      saved
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-white hover:bg-emerald-500 hover:text-slate-950'
                    }`}
                  >
                    {saved ? '✓ Salvo' : 'Salvar Exemplo'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const activeCount = examples.filter((e) => e.isActive).length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-white">
            <GraduationCap className="h-6 w-6 text-emerald-400" />
            Treinamento da IA
          </h2>
          <p className="text-sm text-slate-400">
            Converse com sua IA no simulador, corrija respostas ou analise conversas reais do WhatsApp para evoluir o atendimento automaticamente.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-400">
            Regra / Persona alvo:
          </label>
          <select
            value={selectedRuleId}
            onChange={(e) => setSelectedRuleId(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
          >
            <option value="">Global (Aplicar a todas)</option>
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                [{r.scope}] {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Abas */}
      <div className="flex flex-wrap gap-2">
        {[
          {
            id: 'simulator',
            label: 'Simulador & Treino ao Vivo',
            icon: Bot,
          },
          {
            id: 'history',
            label: 'Aprender de Conversas Reais',
            icon: History,
          },
          {
            id: 'examples',
            label: `Exemplos Treinados (${activeCount} ativo${activeCount === 1 ? '' : 's'})`,
            icon: BookCheck,
          },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id as TrainingTab)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
                active
                  ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                  : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ABA 1: SIMULADOR AO VIVO */}
      {tab === 'simulator' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="flex h-[580px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 lg:col-span-7">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Chat Simulador de Atendimento
                </h3>
                <p className="text-[11px] text-slate-400">
                  Teste perguntas difíceis como se fosse um cliente e aprove ou corrija cada resposta da IA.
                </p>
              </div>
              <button
                onClick={() => {
                  setSimMessages([]);
                  setSimExtraction(null);
                  setCorrectingIndex(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Limpar
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {simMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
                  <MessageSquare className="mb-2 h-10 w-10 text-slate-700" />
                  <p className="text-sm font-medium text-slate-300">
                    Envie uma mensagem simulando um cliente
                  </p>
                  <p className="mt-1 max-w-sm text-xs">
                    A IA responderá usando a regra selecionada e todos os exemplos já treinados. Nada será enviado para o WhatsApp real.
                  </p>
                </div>
              ) : (
                simMessages.map((msg, idx) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                        msg.role === 'user'
                          ? 'rounded-tr-sm border border-sky-500/30 bg-sky-500/15 text-sky-50'
                          : 'rounded-tl-sm border border-emerald-500/30 bg-slate-950/90 text-slate-100'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase opacity-70">
                        {msg.role === 'user' ? (
                          <>
                            <User className="h-3 w-3 text-sky-400" /> Você (simulando cliente)
                          </>
                        ) : (
                          <>
                            <Bot className="h-3 w-3 text-emerald-400" /> IA
                          </>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                      </p>

                      {msg.role === 'assistant' && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
                          {msg.savedAsExample ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                              <Check className="h-3.5 w-3.5" />
                              Aprendizado salvo na IA!
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleApproveSimReply(idx)}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25"
                              >
                                <ThumbsUp className="h-3 w-3" />
                                Aprovar resposta
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCorrectingIndex(idx);
                                  setCorrectionIdeal(msg.content);
                                  setCorrectionNote('');
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25"
                              >
                                <Edit3 className="h-3 w-3" />
                                Corrigir resposta
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {correctingIndex === idx && (
                      <form
                        onSubmit={(e) => handleSaveCorrection(e, idx)}
                        className="mt-2 w-full max-w-[85%] space-y-2 rounded-xl border border-amber-500/40 bg-slate-950 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-amber-300">
                            Como a IA deveria ter respondido?
                          </span>
                          <button
                            type="button"
                            onClick={() => setCorrectingIndex(null)}
                            className="text-slate-400 hover:text-white"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <textarea
                          required
                          rows={3}
                          value={correctionIdeal}
                          onChange={(e) => setCorrectionIdeal(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-white"
                        />
                        <input
                          value={correctionNote}
                          onChange={(e) => setCorrectionNote(e.target.value)}
                          placeholder="Motivo da correção (opcional, ex: sempre informar link do catálogo)"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                        />
                        <button
                          type="submit"
                          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                        >
                          Salvar Correção no Treinamento
                        </button>
                      </form>
                    )}
                  </div>
                ))
              )}
              <div ref={simEndRef} />
            </div>

            <form
              onSubmit={handleSimSend}
              className="flex items-center gap-2 border-t border-slate-800 bg-slate-950/60 p-3"
            >
              <input
                value={simInput}
                onChange={(e) => setSimInput(e.target.value)}
                placeholder="Digite como se fosse um cliente no WhatsApp..."
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={simLoading || !simInput.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {simLoading ? '...' : 'Enviar'}
              </button>
            </form>
          </div>

          {/* Lateral: Consolidação com IA */}
          <div className="space-y-4 lg:col-span-5">
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <Wand2 className="h-4 w-4 text-emerald-400" />
                Consolidar Aprendizados da Sessão
              </h3>
              <p className="text-xs text-slate-400">
                Após conversar no simulador, explique o que gostaria de melhorar e peça para a IA extrair automaticamente exemplos e atualizações para sua Base de Conhecimento.
              </p>
              <textarea
                rows={3}
                value={simFeedback}
                onChange={(e) => setSimFeedback(e.target.value)}
                placeholder="Ex: A IA foi muito formal; quero que seja mais objetiva e sempre pergunte o nome do cliente."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
              <button
                type="button"
                disabled={analyzingSim || simMessages.length === 0}
                onClick={handleAnalyzeSimulator}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500/15 py-2.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {analyzingSim
                  ? 'Analisando histórico de treino...'
                  : 'Extrair Aprendizados com IA'}
              </button>
            </div>

            {simExtraction && renderExtractionPanel(simExtraction, 'SIMULATOR')}
          </div>
        </div>
      )}

      {/* ABA 2: APRENDER DE CONVERSAS REAIS */}
      {tab === 'history' && (
        <div className="space-y-5">
          <div className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 md:grid-cols-12">
            <div className="space-y-3 md:col-span-6">
              <label className="block text-xs font-semibold text-slate-300">
                Selecione uma Conversa Real do WhatsApp
              </label>
              <select
                value={selectedConvId}
                onChange={(e) => setSelectedConvId(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white"
              >
                {conversations.length === 0 && (
                  <option value="">Nenhuma conversa real disponível ainda</option>
                )}
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contact.name || c.contact.phone} (+{c.contact.phone}) —{' '}
                    {c._count.messages} msg(s)
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400">
                A IA analisa tanto as perguntas dos clientes quanto as respostas humanas que você enviou para aprender seu estilo real de atendimento.
              </p>
            </div>

            <div className="space-y-3 md:col-span-6">
              <label className="block text-xs font-semibold text-slate-300">
                Orientação para a Análise (opcional)
              </label>
              <textarea
                rows={2}
                value={historyFeedback}
                onChange={(e) => setHistoryFeedback(e.target.value)}
                placeholder="Ex: Priorize extrair como respondi sobre prazos de entrega e formas de pagamento."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white"
              />
              <button
                type="button"
                disabled={analyzingConv || !selectedConvId}
                onClick={handleAnalyzeConversation}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {analyzingConv
                  ? 'Analisando conversa...'
                  : 'Analisar Histórico Real com IA'}
              </button>
            </div>
          </div>

          {convExtraction &&
            renderExtractionPanel(convExtraction, 'CONVERSATION')}
        </div>
      )}

      {/* ABA 3: BASE DE EXEMPLOS TREINADOS */}
      {tab === 'examples' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              Todos os exemplos ativos abaixo são injetados automaticamente no contexto da IA (Few-Shot Learning) antes de responder no WhatsApp.
            </p>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              <Plus className="h-4 w-4" />
              Novo Exemplo Manual
            </button>
          </div>

          {showAddForm && (
            <form
              onSubmit={handleAddManualExample}
              className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-5"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    Quando o cliente perguntar / disser:
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={newCustomerMsg}
                    onChange={(e) => setNewCustomerMsg(e.target.value)}
                    placeholder="Ex: Vocês parcelam no cartão ou aceitam Pix?"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-emerald-300">
                    Resposta ideal da IA:
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={newIdealResp}
                    onChange={(e) => setNewIdealResp(e.target.value)}
                    placeholder="Ex: Aceitamos Pix com 5% de desconto ou cartão de crédito em até 6x sem juros!"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Observação / regra extra (opcional)"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
                <select
                  value={newRuleId}
                  onChange={(e) => setNewRuleId(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="">Global (aplicar em todas as regras)</option>
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      Somente na regra: [{r.scope}] {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="rounded-xl border border-slate-700 px-3.5 py-2 text-xs text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Salvar Exemplo
                </button>
              </div>
            </form>
          )}

          {examples.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center text-sm text-slate-500">
              Nenhum exemplo de treinamento salvo ainda. Use o Simulador ao Vivo ou analise uma conversa real!
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {examples.map((ex) => (
                <div
                  key={ex.id}
                  className={`rounded-2xl border p-4 transition ${
                    ex.isActive
                      ? 'border-slate-800 bg-slate-900/70'
                      : 'border-slate-800/50 bg-slate-900/30 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                        {ex.rule ? ex.rule.name : 'Global'}
                      </span>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                        {ex.source}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleToggleExample(ex)}
                        className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${
                          ex.isActive
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {ex.isActive ? 'Ativo' : 'Pausado'}
                      </button>
                      <button
                        onClick={() => handleDeleteExample(ex.id)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="rounded-xl bg-slate-950/70 p-2.5">
                      <span className="font-semibold text-slate-400">
                        Cliente:{' '}
                      </span>
                      <span className="text-slate-200">{ex.customerMessage}</span>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                      <span className="font-semibold text-emerald-300">
                        Resposta Ideal:{' '}
                      </span>
                      <span className="text-white">{ex.idealResponse}</span>
                    </div>
                    {ex.feedbackNote && (
                      <p className="text-[11px] text-slate-400">
                        Obs: {ex.feedbackNote}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
