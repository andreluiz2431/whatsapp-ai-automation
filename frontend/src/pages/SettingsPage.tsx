import {
  CheckCircle2,
  Clock,
  Cpu,
  ExternalLink,
  Eye,
  FlaskConical,
  Image as ImageIcon,
  Mic,
  Moon,
  Plus,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
} from 'lucide-react';
import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import {
  EMOJI_STYLE_OPTIONS,
  RESPONSE_LENGTH_OPTIONS,
  RESPONSE_TONE_OPTIONS,
  TRAINING_FLEXIBILITY_OPTIONS,
} from '../lib/aiStyleOptions';
import { api } from '../lib/api';
import {
  AiHealth,
  AppSettings,
  AuthUser,
  BusinessHoursStatus,
  WeeklyBusinessHours,
} from '../types';

const DAY_LIST: Array<{ key: string; label: string; short: string }> = [
  { key: '1', label: 'Segunda-feira', short: 'Seg' },
  { key: '2', label: 'Terça-feira', short: 'Ter' },
  { key: '3', label: 'Quarta-feira', short: 'Qua' },
  { key: '4', label: 'Quinta-feira', short: 'Qui' },
  { key: '5', label: 'Sexta-feira', short: 'Sex' },
  { key: '6', label: 'Sábado', short: 'Sáb' },
  { key: '0', label: 'Domingo', short: 'Dom' },
];

const DEFAULT_SCHEDULE: WeeklyBusinessHours = {
  '0': { enabled: false, intervals: [] },
  '1': { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  '2': { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  '3': { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  '4': { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  '5': { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  '6': { enabled: false, intervals: [{ start: '09:00', end: '13:00' }] },
};

const TIMEZONE_OPTIONS = [
  { value: 'America/Sao_Paulo', label: 'Brasília / São Paulo (UTC-3)' },
  { value: 'America/Manaus', label: 'Manaus / Cuiabá (UTC-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco / Acre (UTC-5)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (UTC-2)' },
  { value: 'Europe/Lisbon', label: 'Lisboa / Portugal' },
  { value: 'UTC', label: 'UTC (Horário Universal)' },
];

const OFF_HOURS_TEMPLATES = [
  {
    label: 'Horário Comercial',
    text: 'Olá {{primeiro_nome}}! No momento estamos fora do nosso horário de atendimento (Seg a Sex, das 08h às 18h). Sua mensagem foi registrada e retornaremos assim que o expediente iniciar!',
  },
  {
    label: 'Plantão / NOC',
    text: 'Olá {{primeiro_nome}}! Nosso atendimento regular está encerrado neste horário. Para emergências ou incidentes críticos, acione nosso plantão NOC pelo telefone/WhatsApp (11) 99999-0000 ou e-mail noc@suaempresa.com. Assuntos comuns serão respondidos no próximo dia útil.',
  },
  {
    label: 'Pausa / Almoço',
    text: 'Olá {{primeiro_nome}}! Estamos em pausa temporária agora e voltamos em breve. Pode deixar sua dúvida aqui que já te respondemos assim que retornarmos!',
  },
];

function parseScheduleSafe(raw?: string | null): WeeklyBusinessHours {
  if (!raw) return structuredClone(DEFAULT_SCHEDULE);
  try {
    const parsed = JSON.parse(raw) as WeeklyBusinessHours;
    const out: WeeklyBusinessHours = {};
    for (const d of DAY_LIST) {
      const item = parsed[d.key];
      out[d.key] = item
        ? {
            enabled: Boolean(item.enabled),
            intervals: Array.isArray(item.intervals) ? item.intervals : [],
          }
        : structuredClone(DEFAULT_SCHEDULE[d.key]);
    }
    return out;
  } catch {
    return structuredClone(DEFAULT_SCHEDULE);
  }
}

interface Props {
  user?: AuthUser;
}

export function SettingsPage({ user }: Props) {
  const isAdmin = Boolean(user?.isOwner || user?.role === 'ADMIN');
  const canUseVision = isAdmin || user?.permissions?.vision !== false;
  const canUseAudio = isAdmin || user?.permissions?.audio !== false;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [aiHealth, setAiHealth] = useState<AiHealth | null>(null);
  const [businessHoursStatus, setBusinessHoursStatus] =
    useState<BusinessHoursStatus | null>(null);
  const [schedule, setSchedule] = useState<WeeklyBusinessHours>(() =>
    structuredClone(DEFAULT_SCHEDULE)
  );
  const [geminiModels, setGeminiModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    reply?: string;
    error?: string;
  } | null>(null);
  const [testingVision, setTestingVision] = useState(false);
  const [visionTestResult, setVisionTestResult] = useState<{
    ok: boolean;
    description?: string;
    modelUsed?: string;
    error?: string;
  } | null>(null);
  const [testingAudio, setTestingAudio] = useState(false);
  const [audioTestResult, setAudioTestResult] = useState<{
    ok: boolean;
    transcript?: string;
    modelUsed?: string;
    error?: string;
  } | null>(null);

  const loadSettings = async () => {
    try {
      const data = await api.get<{
        settings: AppSettings;
        aiHealth: AiHealth;
        businessHoursStatus?: BusinessHoursStatus;
      }>('/settings');
      setSettings(data.settings);
      setAiHealth(data.aiHealth);
      setBusinessHoursStatus(data.businessHoursStatus || null);
      setSchedule(parseScheduleSafe(data.settings.businessHoursScheduleJson));
    } catch {
      // ignora
    }
  };

  const loadGeminiModels = async () => {
    try {
      const r = await api.get<{ models: string[] }>('/settings/gemini-models');
      setGeminiModels(r.models || []);
    } catch {
      // ignora
    }
  };

  useEffect(() => {
    void loadSettings();
    void loadGeminiModels();
  }, []);

  const persistSettings = async (): Promise<boolean> => {
    if (!settings) return false;
    const payload: AppSettings = {
      ...settings,
      businessHoursScheduleJson: JSON.stringify(schedule),
    };
    const res = await api.put<{
      settings: AppSettings;
      aiHealth: AiHealth;
      businessHoursStatus?: BusinessHoursStatus;
    }>('/settings', payload);
    setSettings(res.settings);
    setAiHealth(res.aiHealth);
    setBusinessHoursStatus(res.businessHoursStatus || null);
    setSchedule(parseScheduleSafe(res.settings.businessHoursScheduleJson));
    void loadGeminiModels();
    return true;
  };

  const applySchedulePreset = (preset: 'commercial' | 'lunch' | 'saturday') => {
    const next: WeeklyBusinessHours = structuredClone(DEFAULT_SCHEDULE);
    const workDays =
      preset === 'saturday' ? ['1', '2', '3', '4', '5', '6'] : ['1', '2', '3', '4', '5'];
    for (const d of DAY_LIST) {
      if (workDays.includes(d.key)) {
        next[d.key] = {
          enabled: true,
          intervals:
            preset === 'lunch'
              ? [
                  { start: '08:00', end: '12:00' },
                  { start: '13:30', end: '18:00' },
                ]
              : preset === 'saturday' && d.key === '6'
                ? [{ start: '09:00', end: '13:00' }]
                : [{ start: '08:00', end: '18:00' }],
        };
      } else {
        next[d.key] = { enabled: false, intervals: [] };
      }
    }
    setSchedule(next);
  };

  const toggleDayEnabled = (dayKey: string) => {
    setSchedule((prev) => {
      const cur = prev[dayKey] || { enabled: false, intervals: [] };
      const nextEnabled = !cur.enabled;
      return {
        ...prev,
        [dayKey]: {
          enabled: nextEnabled,
          intervals:
            nextEnabled && cur.intervals.length === 0
              ? [{ start: '08:00', end: '18:00' }]
              : cur.intervals,
        },
      };
    });
  };

  const updateDayInterval = (
    dayKey: string,
    index: number,
    field: 'start' | 'end',
    value: string
  ) => {
    setSchedule((prev) => {
      const cur = prev[dayKey] || { enabled: true, intervals: [] };
      const nextIntervals = cur.intervals.map((iv, idx) =>
        idx === index ? { ...iv, [field]: value } : iv
      );
      return { ...prev, [dayKey]: { ...cur, intervals: nextIntervals } };
    });
  };

  const addDayInterval = (dayKey: string) => {
    setSchedule((prev) => {
      const cur = prev[dayKey] || { enabled: true, intervals: [] };
      if (cur.intervals.length >= 4) return prev;
      return {
        ...prev,
        [dayKey]: {
          enabled: true,
          intervals: [...cur.intervals, { start: '13:30', end: '18:00' }],
        },
      };
    });
  };

  const removeDayInterval = (dayKey: string, index: number) => {
    setSchedule((prev) => {
      const cur = prev[dayKey] || { enabled: true, intervals: [] };
      const nextIntervals = cur.intervals.filter((_, idx) => idx !== index);
      return {
        ...prev,
        [dayKey]: {
          enabled: nextIntervals.length > 0 ? cur.enabled : false,
          intervals: nextIntervals,
        },
      };
    });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setSavedBanner(false);
    try {
      await persistSettings();
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 3500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestAi = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Salva automaticamente as alterações (ex: chave recém-colada) antes de testar
      await persistSettings();
      const res = await api.post<{
        ok: boolean;
        reply?: string;
        error?: string;
      }>('/settings/test-ai');
      setTestResult(res);
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Erro ao testar IA.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleTestVision = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTestingVision(true);
    setVisionTestResult(null);
    const formData = new FormData();
    formData.append('image', file);
    try {
      await persistSettings();
      const res = await api.post<{
        ok: boolean;
        description?: string;
        modelUsed?: string;
        error?: string;
      }>('/settings/test-vision', formData);
      setVisionTestResult(res);
    } catch (err) {
      setVisionTestResult({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Erro ao testar leitura de imagem.',
      });
    } finally {
      setTestingVision(false);
      e.target.value = '';
    }
  };

  const handleTestAudio = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTestingAudio(true);
    setAudioTestResult(null);
    const formData = new FormData();
    formData.append('audio', file);
    try {
      await persistSettings();
      const res = await api.post<{
        ok: boolean;
        transcript?: string;
        modelUsed?: string;
        error?: string;
      }>('/settings/test-audio', formData);
      setAudioTestResult(res);
    } catch (err) {
      setAudioTestResult({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Erro ao testar transcrição de áudio.',
      });
    } finally {
      setTestingAudio(false);
      e.target.value = '';
    }
  };

  if (!settings) {
    return (
      <div className="p-8 text-center text-sm text-slate-400">
        Carregando configurações...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">
          Configurações de IA &amp; Automação
        </h2>
        <p className="text-sm text-slate-400">
          Escolha entre Google Gemini API (Free Tier) ou Ollama rodando localmente 100% grátis.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Provedor de IA */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-bold text-white">
              <Cpu className="h-5 w-5 text-emerald-400" />
              Provedor de Inteligência Artificial
            </h3>
            {aiHealth && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  aiHealth.ready
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                {aiHealth.ready ? 'Motor Pronto' : 'Atenção Necessária'}
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSettings({ ...settings, aiProvider: 'gemini' })}
              className={`rounded-xl border p-4 text-left transition ${
                settings.aiProvider === 'gemini'
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-white">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                Google Gemini API (Free Tier)
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Rápido, gratuito via Google AI Studio e não consome GPU/RAM da sua máquina.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setSettings({ ...settings, aiProvider: 'ollama' })}
              className={`rounded-xl border p-4 text-left transition ${
                settings.aiProvider === 'ollama'
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-white">
                <Terminal className="h-4 w-4 text-sky-400" />
                Ollama (100% Local)
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Roda modelos open-source (Llama 3.2, Qwen 2.5, Gemma 2) localmente com privacidade total.
              </p>
            </button>
          </div>

          {settings.aiProvider === 'gemini' ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-slate-400">
                    Gemini API Key (Google AI Studio)
                  </label>
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
                  >
                    Obter chave grátis
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <input
                  type="password"
                  value={settings.geminiApiKey}
                  onChange={(e) =>
                    setSettings({ ...settings, geminiApiKey: e.target.value })
                  }
                  placeholder="AIza..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Modelo Gemini
                </label>
                <input
                  list="gemini-models-list"
                  value={settings.geminiModel}
                  onChange={(e) =>
                    setSettings({ ...settings, geminiModel: e.target.value })
                  }
                  placeholder="gemini-3.8-flash"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white"
                />
                <datalist id="gemini-models-list">
                  {geminiModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {geminiModels.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {geminiModels
                      .filter((m) => m.includes('flash') || m.includes('lite'))
                      .slice(0, 4)
                      .map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() =>
                            setSettings({ ...settings, geminiModel: m })
                          }
                          className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                            settings.geminiModel === m
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  URL do Ollama Local
                </label>
                <input
                  value={settings.ollamaBaseUrl}
                  onChange={(e) =>
                    setSettings({ ...settings, ollamaBaseUrl: e.target.value })
                  }
                  placeholder="http://localhost:11434"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Modelo Instalado no Ollama
                </label>
                <input
                  value={settings.ollamaModel}
                  onChange={(e) =>
                    setSettings({ ...settings, ollamaModel: e.target.value })
                  }
                  placeholder="llama3.2"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white"
                />
              </div>
            </div>
          )}

          {aiHealth && (
            <p className="mt-3 text-xs text-slate-400">{aiHealth.details}</p>
          )}

          <div className="mt-4 max-w-xs">
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Limite Diário de Referência (barra lateral de uso da IA)
            </label>
            <input
              type="number"
              min={10}
              value={settings.dailyAiRequestLimit || 250}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  dailyAiRequestLimit: Number(e.target.value),
                })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleTestAi}
              disabled={testing}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              {testing ? 'Testando motor...' : 'Testar Conexão com IA'}
            </button>
            {testResult && (
              <span
                className={`text-xs ${
                  testResult.ok ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {testResult.ok
                  ? `✓ Resposta: "${testResult.reply}"`
                  : `✗ ${testResult.error}`}
              </span>
            )}
          </div>
        </div>

        {/* Estilo, Tonalidade e Flexibilidade das Respostas (Geral) */}
        <div className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-base font-bold text-white">
                <SlidersHorizontal className="h-5 w-5 text-emerald-400" />
                Estilo, Tonalidade e Flexibilidade das Respostas (Geral)
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Define o padrão de como a IA escreve e o quanto ela pode adaptar os exemplos de treinamento mantendo 100% da assertividade das informações.
              </p>
            </div>
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-300">
              Padrão Geral da Conta
            </span>
          </div>

          {/* Flexibilidade nos Exemplos de Treinamento */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300">
              Flexibilidade em relação aos exemplos de Treinamento IA
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              {TRAINING_FLEXIBILITY_OPTIONS.map((opt) => {
                const active =
                  (settings.trainingFlexibility || 'BALANCED') === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setSettings({ ...settings, trainingFlexibility: opt.value })
                    }
                    className={`rounded-xl border p-3.5 text-left transition ${
                      active
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">
                        {opt.label}
                      </span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          active
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {opt.badge}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                      {opt.shortDesc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tonalidade Padrão */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300">
              Tonalidade Geral das Respostas
            </label>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {RESPONSE_TONE_OPTIONS.map((opt) => {
                const active =
                  (settings.responseTone || 'CONSULTATIVE') === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setSettings({ ...settings, responseTone: opt.value })
                    }
                    className={`rounded-xl border p-3 text-left transition ${
                      active
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <p className="text-xs font-semibold text-white">{opt.label}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {opt.shortDesc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tamanho & Emojis */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                Tamanho das Mensagens
              </label>
              <div className="grid grid-cols-3 gap-2">
                {RESPONSE_LENGTH_OPTIONS.map((opt) => {
                  const active =
                    (settings.responseLength || 'MEDIUM') === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setSettings({ ...settings, responseLength: opt.value })
                      }
                      className={`rounded-xl border px-2.5 py-2 text-left transition ${
                        active
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                      }`}
                    >
                      <p className="text-xs font-semibold text-white">
                        {opt.label}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {opt.shortDesc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                Uso de Emojis
              </label>
              <div className="grid grid-cols-3 gap-2">
                {EMOJI_STYLE_OPTIONS.map((opt) => {
                  const active = (settings.emojiStyle || 'LIGHT') === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setSettings({ ...settings, emojiStyle: opt.value })
                      }
                      className={`rounded-xl border px-2.5 py-2 text-left transition ${
                        active
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                      }`}
                    >
                      <p className="text-xs font-semibold text-white">
                        {opt.label}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {opt.shortDesc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Diretriz Extra de Estilo */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Diretriz Extra de Estilo Global (opcional)
            </label>
            <textarea
              rows={2}
              value={settings.customStyleNote || ''}
              onChange={(e) =>
                setSettings({ ...settings, customStyleNote: e.target.value })
              }
              placeholder="Ex: Chame o cliente pelo primeiro nome, evite gírias e sempre finalize oferecendo ajuda com o próximo passo."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white"
            />
          </div>

          <p className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3.5 py-2.5 text-[11px] text-sky-200">
            <strong>Dica:</strong> Você pode sobrescrever a tonalidade, a flexibilidade de treinamento, o tamanho e os emojis individualmente por <strong>Tag, Fluxo ou Contato</strong> em <em>Fluxos &amp; Personas IA</em> (basta editar a regra desejada).
          </p>
        </div>

        {/* Comportamento da Automação */}
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <h3 className="text-base font-bold text-white">
            Comportamento do Atendimento
          </h3>

          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={settings.autoPauseOnManualSend}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  autoPauseOnManualSend: e.target.checked,
                })
              }
              className="mt-1 accent-emerald-500"
            />
            <div>
              <p className="font-medium text-white">
                Assumir conversa automaticamente ao enviar mensagem manual
              </p>
              <p className="text-xs text-slate-400">
                Quando você enviar uma mensagem pelo painel, o chat muda para Modo Manual para a IA não interromper seu atendimento.
              </p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={settings.autoSummarizeConversations}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  autoSummarizeConversations: e.target.checked,
                })
              }
              className="mt-1 accent-emerald-500"
            />
            <div>
              <p className="font-medium text-white">
                Resumo automático de conversas com IA
              </p>
              <p className="text-xs text-slate-400">
                Atualiza o resumo executivo da conversa automaticamente após cada resposta da IA (além do botão manual).
              </p>
            </div>
          </label>
        </div>

        {/* Horário de Trabalho & Atendimento Fora do Expediente */}
        <div className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-base font-bold text-white">
                <Clock className="h-5 w-5 text-emerald-400" />
                Horário de Trabalho &amp; Pausas Programadas
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Defina os dias e intervalos de expediente para não rodar 24/7 — escolha pausar silenciosamente, enviar aviso personalizado (ex: horário ou contato do NOC) ou ativar o modo de atendimento inverso.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                !settings.businessHoursEnabled
                  ? 'bg-slate-800 text-slate-300'
                  : businessHoursStatus?.aiAllowedNow
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-amber-500/15 text-amber-300'
              }`}
            >
              {!settings.businessHoursEnabled
                ? '24/7 (Sempre ativo)'
                : businessHoursStatus?.aiAllowedNow
                  ? 'IA Ativa agora'
                  : 'Fora do horário ativo'}
            </span>
          </div>

          {businessHoursStatus && settings.businessHoursEnabled && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-xs text-slate-300">
              <strong className="text-emerald-300">Status atual:</strong>{' '}
              {businessHoursStatus.summary}
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={Boolean(settings.businessHoursEnabled)}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  businessHoursEnabled: e.target.checked,
                })
              }
              className="mt-1 accent-emerald-500"
            />
            <div>
              <p className="font-medium text-white">
                Ativar controle de horário de trabalho (desativar funcionamento 24/7)
              </p>
              <p className="text-xs text-slate-400">
                Novas mensagens recebidas sempre continuam chegando e sendo registradas normalmente no painel em qualquer horário.
              </p>
            </div>
          </label>

          {settings.businessHoursEnabled && (
            <div className="space-y-5 border-t border-slate-800 pt-4">
              {/* Modo de Operação */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Modo de Funcionamento da IA
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSettings({
                        ...settings,
                        businessHoursMode: 'ACTIVE_DURING_HOURS',
                      })
                    }
                    className={`rounded-xl border p-3.5 text-left transition ${
                      (settings.businessHoursMode || 'ACTIVE_DURING_HOURS') ===
                      'ACTIVE_DURING_HOURS'
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <p className="flex items-center gap-1.5 text-xs font-bold text-white">
                      <Sun className="h-4 w-4 text-emerald-400" />
                      Horário Comercial (IA ativa DENTRO do expediente)
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                      A IA responde normalmente nos intervalos configurados abaixo. Fora deles (ex: almoço, noite, fim de semana), pausa ou envia o aviso configurado.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setSettings({
                        ...settings,
                        businessHoursMode: 'INVERSE_AFTER_HOURS',
                      })
                    }
                    className={`rounded-xl border p-3.5 text-left transition ${
                      settings.businessHoursMode === 'INVERSE_AFTER_HOURS'
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <p className="flex items-center gap-1.5 text-xs font-bold text-white">
                      <Moon className="h-4 w-4 text-violet-400" />
                      Atendimento Inverso (IA ativa FORA do expediente)
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                      Durante o expediente abaixo (quando sua equipe humana atende), a IA fica pausada ou envia aviso. À noite, almoço e fins de semana a IA assume automaticamente!
                    </p>
                  </button>
                </div>
              </div>

              {/* Fuso Horário + Presets */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-[240px] flex-1 sm:max-w-xs">
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    Fuso Horário
                  </label>
                  <select
                    value={settings.businessHoursTimezone || 'America/Sao_Paulo'}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        businessHoursTimezone: e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400">
                    Modelos rápidos:
                  </span>
                  <button
                    type="button"
                    onClick={() => applySchedulePreset('commercial')}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Seg–Sex 08h–18h
                  </button>
                  <button
                    type="button"
                    onClick={() => applySchedulePreset('lunch')}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Seg–Sex c/ pausa almoço
                  </button>
                  <button
                    type="button"
                    onClick={() => applySchedulePreset('saturday')}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Seg–Sáb (Sáb até 13h)
                  </button>
                </div>
              </div>

              {/* Grade Semanal com múltiplos intervalos */}
              <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="text-xs font-semibold text-slate-300">
                  {settings.businessHoursMode === 'INVERSE_AFTER_HOURS'
                    ? 'Grade do Expediente Humano (fora destes horários a IA atende automaticamente)'
                    : 'Grade de Funcionamento (nestes intervalos a IA atende automaticamente)'}
                </p>
                <div className="divide-y divide-slate-800/70">
                  {DAY_LIST.map((day) => {
                    const dayCfg = schedule[day.key] || {
                      enabled: false,
                      intervals: [],
                    };
                    return (
                      <div
                        key={day.key}
                        className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <label className="flex w-40 shrink-0 cursor-pointer items-center gap-2.5 text-xs">
                          <input
                            type="checkbox"
                            checked={dayCfg.enabled}
                            onChange={() => toggleDayEnabled(day.key)}
                            className="accent-emerald-500"
                          />
                          <span
                            className={
                              dayCfg.enabled
                                ? 'font-semibold text-white'
                                : 'text-slate-500'
                            }
                          >
                            {day.label}
                          </span>
                        </label>

                        {!dayCfg.enabled ? (
                          <span className="text-[11px] text-slate-500">
                            {settings.businessHoursMode === 'INVERSE_AFTER_HOURS'
                              ? 'Sem expediente humano (IA ativa o dia todo)'
                              : 'Sem atendimento (fora do horário o dia todo)'}
                          </span>
                        ) : (
                          <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
                            {dayCfg.intervals.map((iv, idx) => (
                              <div
                                key={`${day.key}-${idx}`}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs"
                              >
                                <input
                                  type="time"
                                  value={iv.start}
                                  onChange={(e) =>
                                    updateDayInterval(
                                      day.key,
                                      idx,
                                      'start',
                                      e.target.value
                                    )
                                  }
                                  className="bg-transparent text-xs text-white focus:outline-none"
                                />
                                <span className="text-slate-500">às</span>
                                <input
                                  type="time"
                                  value={iv.end}
                                  onChange={(e) =>
                                    updateDayInterval(
                                      day.key,
                                      idx,
                                      'end',
                                      e.target.value
                                    )
                                  }
                                  className="bg-transparent text-xs text-white focus:outline-none"
                                />
                                {dayCfg.intervals.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      removeDayInterval(day.key, idx)
                                    }
                                    title="Remover intervalo"
                                    className="ml-0.5 text-slate-500 hover:text-rose-400"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            ))}
                            {dayCfg.intervals.length < 4 && (
                              <button
                                type="button"
                                onClick={() => addDayInterval(day.key)}
                                title="Adicionar intervalo (ex: após pausa de almoço)"
                                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-700 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:border-emerald-500/50 hover:bg-emerald-500/10"
                              >
                                <Plus className="h-3 w-3" />
                                Intervalo
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ação quando fora do horário ativo da IA */}
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-300">
                  {settings.businessHoursMode === 'INVERSE_AFTER_HOURS'
                    ? 'Ação durante o expediente humano (quando a IA não está ativa)'
                    : 'Ação fora do horário de trabalho (ou durante pausas/intervalos)'}
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSettings({ ...settings, offHoursAction: 'PAUSE' })
                    }
                    className={`rounded-xl border p-3.5 text-left transition ${
                      (settings.offHoursAction || 'PAUSE') === 'PAUSE'
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <p className="text-xs font-bold text-white">
                      Pausar silenciosamente
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Recebe e exibe todas as conversas normalmente no painel, sem enviar nenhuma resposta automática.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setSettings({
                        ...settings,
                        offHoursAction: 'SEND_MESSAGE',
                      })
                    }
                    className={`rounded-xl border p-3.5 text-left transition ${
                      settings.offHoursAction === 'SEND_MESSAGE'
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <p className="text-xs font-bold text-white">
                      Enviar mensagem específica automática
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Informa horário de atendimento, contato do NOC/plantão ou orientação personalizada (com controle anti-repetição).
                    </p>
                  </button>
                </div>

                {settings.offHoursAction === 'SEND_MESSAGE' && (
                  <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-slate-300">
                        Mensagem específica (aceita{' '}
                        <code className="text-emerald-300">{'{{primeiro_nome}}'}</code>{' '}
                        e <code className="text-emerald-300">{'{{nome}}'}</code>)
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {OFF_HOURS_TEMPLATES.map((tpl) => (
                          <button
                            key={tpl.label}
                            type="button"
                            onClick={() =>
                              setSettings({
                                ...settings,
                                offHoursMessage: tpl.text,
                              })
                            }
                            className="rounded-lg bg-slate-800 px-2.5 py-1 text-[10px] font-semibold text-emerald-300 hover:bg-slate-700"
                          >
                            Modelo: {tpl.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <textarea
                      rows={3}
                      value={settings.offHoursMessage || ''}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          offHoursMessage: e.target.value,
                        })
                      }
                      placeholder="Ex: Olá {{primeiro_nome}}! Nosso horário é de Seg a Sex das 08h às 18h. Em caso de urgência, contate nosso NOC em..."
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white"
                    />

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-xs text-slate-400">
                        Não repetir este aviso para o mesmo contato por (minutos):
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={settings.offHoursCooldownMin || 60}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            offHoursCooldownMin: Number(e.target.value),
                          })
                        }
                        className="w-24 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Módulo de Leitura de Imagens (Visão IA) */}
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-bold text-white">
              <Eye className="h-5 w-5 text-emerald-400" />
              Módulo de Leitura de Imagens (Visão IA)
            </h3>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                settings.enableImageReading
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {settings.enableImageReading ? 'Ativado' : 'Desativado'}
            </span>
          </div>

          {!canUseVision && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
              Este módulo está bloqueado pelo administrador para a sua conta. Solicite liberação em seu plano.
            </p>
          )}

          <label className={`flex items-start gap-3 text-sm ${canUseVision ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input
              type="checkbox"
              disabled={!canUseVision}
              checked={canUseVision && settings.enableImageReading}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  enableImageReading: e.target.checked,
                })
              }
              className="mt-1 accent-emerald-500"
            />
            <div>
              <p className="font-medium text-white">
                Ativar leitura automática de imagens enviadas nas conversas
              </p>
              <p className="text-xs text-slate-400">
                Quando um cliente enviar foto (comprovante Pix, print de erro, foto de produto), a IA analisa a imagem e usa o conteúdo extraído para responder com precisão.
              </p>
            </div>
          </label>

          {settings.aiProvider === 'gemini' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Modelo Gemini para Leitura de Imagens (opcional — deixe vazio para usar o modelo principal)
              </label>
              <input
                list="gemini-vision-models-list"
                value={settings.geminiVisionModel || ''}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    geminiVisionModel: e.target.value,
                  })
                }
                placeholder="Ex: gemini-2.5-flash-lite ou deixe vazio (usa o principal)"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
              <datalist id="gemini-vision-models-list">
                {geminiModels
                  .filter(
                    (m) =>
                      (m.includes('lite') || m.includes('flash')) &&
                      !m.includes('tts') &&
                      !m.includes('audio')
                  )
                  .map((m) => (
                    <option key={m} value={m} />
                  ))}
              </datalist>
              {geminiModels.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {geminiModels
                    .filter(
                      (m) =>
                        (m.includes('lite') || m.includes('flash')) &&
                        !m.includes('tts') &&
                        !m.includes('audio')
                    )
                    .slice(0, 4)
                    .map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() =>
                          setSettings({ ...settings, geminiVisionModel: m })
                        }
                        className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                          settings.geminiVisionModel === m
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-slate-400">
                Dica de custo: modelos <strong>Flash-Lite</strong> e <strong>Flash</strong> do Gemini são nativamente multimodais (leem imagens direto no <strong>Free Tier</strong> com o menor consumo de tokens).
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Instrução de Leitura de Imagem
            </label>
            <textarea
              rows={2}
              value={settings.imageAnalysisPrompt || ''}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  imageAnalysisPrompt: e.target.value,
                })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
              <ImageIcon className="h-3.5 w-3.5 text-emerald-400" />
              {testingVision ? 'Analisando imagem...' : 'Testar Leitura com uma Imagem'}
              <input
                type="file"
                accept="image/*"
                onChange={handleTestVision}
                disabled={testingVision}
                className="hidden"
              />
            </label>
            <span className="text-[11px] text-slate-500">
              Salve as configurações antes de testar um modelo novo.
            </span>
          </div>

          {visionTestResult && (
            <div
              className={`rounded-xl border p-3.5 text-xs ${
                visionTestResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
              }`}
            >
              {visionTestResult.ok ? (
                <>
                  <p className="font-semibold text-emerald-300">
                    ✓ Imagem lida com sucesso ({visionTestResult.modelUsed}):
                  </p>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                    {visionTestResult.description}
                  </p>
                </>
              ) : (
                <p>✗ {visionTestResult.error}</p>
              )}
            </div>
          )}
        </div>

        {/* Módulo de Transcrição de Áudios (Áudio IA) */}
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-bold text-white">
              <Mic className="h-5 w-5 text-emerald-400" />
              Módulo de Transcrição de Áudios (Áudio IA)
            </h3>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                settings.enableAudioTranscription
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {settings.enableAudioTranscription ? 'Ativado' : 'Desativado'}
            </span>
          </div>

          {!canUseAudio && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
              Este módulo está bloqueado pelo administrador para a sua conta. Solicite liberação em seu plano.
            </p>
          )}

          <label className={`flex items-start gap-3 text-sm ${canUseAudio ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input
              type="checkbox"
              disabled={!canUseAudio}
              checked={canUseAudio && settings.enableAudioTranscription}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  enableAudioTranscription: e.target.checked,
                })
              }
              className="mt-1 accent-emerald-500"
            />
            <div>
              <p className="font-medium text-white">
                Ativar transcrição e interpretação automática de áudios recebidos no WhatsApp
              </p>
              <p className="text-xs text-slate-400">
                Quando um cliente enviar uma mensagem de voz (OGG/Opus, MP3, M4A), a IA transcreve automaticamente, exibe o texto na conversa e responde entendendo tudo o que foi falado.
              </p>
            </div>
          </label>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Modelo Gemini para Áudio (opcional — deixe vazio para usar o modelo principal)
            </label>
            <input
              list="gemini-audio-models-list"
              value={settings.geminiAudioModel || ''}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  geminiAudioModel: e.target.value,
                })
              }
              placeholder="Ex: gemini-2.5-flash-lite ou deixe vazio (usa o principal)"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
            />
            <datalist id="gemini-audio-models-list">
              {geminiModels
                .filter(
                  (m) =>
                    (m.includes('lite') || m.includes('flash')) &&
                    !m.includes('tts') &&
                    !m.includes('image')
                )
                .map((m) => (
                  <option key={m} value={m} />
                ))}
            </datalist>
            {geminiModels.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {geminiModels
                  .filter(
                    (m) =>
                      (m.includes('lite') || m.includes('flash')) &&
                      !m.includes('tts') &&
                      !m.includes('image')
                  )
                  .slice(0, 4)
                  .map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        setSettings({ ...settings, geminiAudioModel: m })
                      }
                      className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                        settings.geminiAudioModel === m
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
              </div>
            )}
            <p className="mt-1.5 text-[11px] text-slate-400">
              Os modelos <strong>Gemini Flash / Flash-Lite</strong> entendem áudios nativamente no <strong>Free Tier</strong> (sem Whisper pago nem FFmpeg). Suporta áudios de até 10MB (~15–20 min).
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Instrução de Transcrição / Interpretação
            </label>
            <textarea
              rows={2}
              value={settings.audioTranscriptionPrompt || ''}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  audioTranscriptionPrompt: e.target.value,
                })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
              <Mic className="h-3.5 w-3.5 text-emerald-400" />
              {testingAudio ? 'Transcrevendo áudio...' : 'Testar Transcrição com um Áudio'}
              <input
                type="file"
                accept="audio/*,.ogg,.opus,.mp3,.wav,.m4a,.webm"
                onChange={handleTestAudio}
                disabled={testingAudio}
                className="hidden"
              />
            </label>
            <span className="text-[11px] text-slate-500">
              Aceita .ogg (WhatsApp), .mp3, .m4a, .wav ou .webm.
            </span>
          </div>

          {audioTestResult && (
            <div
              className={`rounded-xl border p-3.5 text-xs ${
                audioTestResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
              }`}
            >
              {audioTestResult.ok ? (
                <>
                  <p className="font-semibold text-emerald-300">
                    ✓ Áudio transcrito com sucesso ({audioTestResult.modelUsed}):
                  </p>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                    {audioTestResult.transcript}
                  </p>
                </>
              ) : (
                <p>✗ {audioTestResult.error}</p>
              )}
            </div>
          )}
        </div>

        {/* Padrões Anti-Ban */}
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <h3 className="flex items-center gap-2 text-base font-bold text-white">
            <ShieldAlert className="h-5 w-5 text-amber-400" />
            Padrões Anti-Bloqueio para Novas Campanhas
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Mínimo (seg)
              </label>
              <input
                type="number"
                min={5}
                value={settings.defaultMinDelaySec}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    defaultMinDelaySec: Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Máximo (seg)
              </label>
              <input
                type="number"
                min={5}
                value={settings.defaultMaxDelaySec}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    defaultMaxDelaySec: Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Mensagens por lote
              </label>
              <input
                type="number"
                min={1}
                value={settings.defaultBatchSize}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    defaultBatchSize: Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Pausa do lote (min)
              </label>
              <input
                type="number"
                min={1}
                value={settings.defaultBatchPauseMin}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    defaultBatchPauseMin: Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
          </div>

          <ul className="space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-slate-300">
            <li>• <strong>Intervalo aleatório:</strong> Recomendado entre 45s e 120s (nunca um tempo fixo idêntico).</li>
            <li>• <strong>Pausa em lotes:</strong> Pausa automática de 5 a 10 minutos a cada 15–20 mensagens.</li>
            <li>• <strong>Aquecimento diário:</strong> Número novo: 20–30 disparos/dia na 1ª semana; número antigo: até 80–100/dia.</li>
            <li>• <strong>Variação natural:</strong> Ative a variação com IA nas campanhas para evitar textos idênticos.</li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-3">
          {savedBanner && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Configurações salvas!
            </span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </form>
    </div>
  );
}
