import {
  CheckCircle2,
  Cpu,
  Eye,
  FlaskConical,
  Image as ImageIcon,
  Save,
  ShieldAlert,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AiHealth, AppSettings } from '../types';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [aiHealth, setAiHealth] = useState<AiHealth | null>(null);
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

  const loadSettings = async () => {
    try {
      const data = await api.get<{ settings: AppSettings; aiHealth: AiHealth }>(
        '/settings'
      );
      setSettings(data.settings);
      setAiHealth(data.aiHealth);
    } catch {
      // ignora
    }
  };

  useEffect(() => {
    void loadSettings();
    api
      .get<{ models: string[] }>('/settings/gemini-models')
      .then((r) => setGeminiModels(r.models || []))
      .catch(() => {});
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setSavedBanner(false);
    try {
      const res = await api.put<{ settings: AppSettings; aiHealth: AiHealth }>(
        '/settings',
        settings
      );
      setSettings(res.settings);
      setAiHealth(res.aiHealth);
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
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Gemini API Key (Google AI Studio)
                </label>
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

          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={settings.enableImageReading}
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
