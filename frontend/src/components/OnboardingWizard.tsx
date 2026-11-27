import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cpu,
  ExternalLink,
  GraduationCap,
  KeyRound,
  Loader2,
  QrCode,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Wifi,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AiHealth, AppSettings, WhatsAppState } from '../types';
import { NavTab } from './Sidebar';

interface Props {
  userName: string;
  waState: WhatsAppState;
  aiReady: boolean;
  onAiConfigured: () => void;
  onFinish: (targetTab?: NavTab) => void;
}

export function OnboardingWizard({
  userName,
  waState,
  aiReady,
  onAiConfigured,
  onFinish,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [connectingWa, setConnectingWa] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);

  const firstName = userName.trim().split(/\s+/)[0] || 'por aqui';
  const isWaConnected =
    waState.status === 'CONNECTED' || waState.status === 'CAMPAIGN_RUNNING';
  const effectiveAiReady = aiReady || Boolean(keyStatus?.ok);

  useEffect(() => {
    api
      .get<{ settings: AppSettings; aiHealth: AiHealth }>('/settings')
      .then((res) => {
        if (res.settings?.geminiApiKey) {
          setApiKey(res.settings.geminiApiKey);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveAndTestKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setKeyStatus({
        ok: false,
        message: 'Cole sua chave API do Google AI Studio (começa com AIza...).',
      });
      return;
    }

    setSavingKey(true);
    setKeyStatus(null);
    try {
      await api.put('/settings', {
        aiProvider: 'gemini',
        geminiApiKey: trimmed,
      });
      const test = await api.post<{
        ok: boolean;
        reply?: string;
        error?: string;
      }>('/settings/test-ai');
      if (test.ok) {
        setKeyStatus({
          ok: true,
          message: `Chave validada com sucesso! Resposta de teste: "${test.reply}"`,
        });
        onAiConfigured();
      } else {
        setKeyStatus({
          ok: false,
          message:
            test.error ||
            'Não foi possível validar a chave. Verifique se ela foi copiada por completo.',
        });
      }
    } catch (err) {
      setKeyStatus({
        ok: false,
        message:
          err instanceof Error ? err.message : 'Erro ao salvar/testar a chave.',
      });
    } finally {
      setSavingKey(false);
    }
  };

  const handleConnectWhatsApp = async () => {
    setConnectingWa(true);
    setWaError(null);
    try {
      await api.post('/whatsapp/connect');
    } catch (err) {
      setWaError(
        err instanceof Error
          ? err.message
          : 'Erro ao solicitar QR Code do WhatsApp.'
      );
    } finally {
      setConnectingWa(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Cabeçalho do Wizard */}
        <div className="border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/50 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <img
                src="/favicon.svg"
                alt="ZapFlow AI"
                className="h-10 w-10 rounded-xl shadow-md"
              />
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  <Rocket className="h-3 w-3" />
                  Guia Teleguiado de Início Rápido
                </div>
                <h2 className="mt-1 text-lg font-bold text-white sm:text-xl">
                  Bem-vindo(a), {firstName}! Vamos deixar tudo pronto em 2 minutos.
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onFinish()}
              title="Fechar guia"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Barra de etapas clicável */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              {
                num: 1 as const,
                title: '1. Chave Google IA',
                done: effectiveAiReady,
              },
              {
                num: 2 as const,
                title: '2. Conectar WhatsApp',
                done: isWaConnected,
              },
              {
                num: 3 as const,
                title: '3. Pronto p/ Usar',
                done: effectiveAiReady && isWaConnected,
              },
            ].map((item) => {
              const active = step === item.num;
              return (
                <button
                  key={item.num}
                  type="button"
                  onClick={() => setStep(item.num)}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                    active
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
                      : item.done
                        ? 'border-emerald-500/30 bg-slate-950/60 text-emerald-300/90 hover:border-emerald-500/50'
                        : 'border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <span className="truncate">{item.title}</span>
                  {item.done && (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Conteúdo da etapa atual */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Passo 1: Obter sua API Key gratuita do Google Gemini
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    O ZapFlow AI usa o plano gratuito (<strong>Free Tier</strong>) do Google AI Studio na sua própria conta — sem precisar cadastrar cartão de crédito.
                  </p>
                </div>
              </div>

              {/* Tutorial passo a passo com link direto */}
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                    Como gerar sua chave em 30 segundos:
                  </p>
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
                  >
                    Abrir Google AI Studio
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>

                <ol className="space-y-2 text-xs text-slate-300">
                  <li className="flex items-start gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-emerald-300">
                      1
                    </span>
                    <span>
                      Clique no botão <strong>Abrir Google AI Studio</strong> acima e entre com qualquer conta Google (Gmail).
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-emerald-300">
                      2
                    </span>
                    <span>
                      Clique em <strong>&quot;Create API key&quot;</strong> (Criar chave de API). Se pedir para escolher um projeto, selecione ou crie um projeto padrão gratuito.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-emerald-300">
                      3
                    </span>
                    <span>
                      Copie a chave gerada (começa com <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-300">AIza...</code>) e cole no campo abaixo para validar agora mesmo:
                    </span>
                  </li>
                </ol>
              </div>

              {/* Campo interativo para colar e testar direto no guia */}
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <label className="block text-xs font-semibold text-slate-300">
                  Cole sua Gemini API Key aqui:
                </label>
                <div className="flex flex-col gap-2.5 sm:flex-row">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveAndTestKey}
                    disabled={savingKey}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {savingKey ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Salvar e Testar IA
                      </>
                    )}
                  </button>
                </div>

                {keyStatus && (
                  <div
                    className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                      keyStatus.ok
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                    }`}
                  >
                    {keyStatus.ok ? '✓ ' : '✗ '}
                    {keyStatus.message}
                  </div>
                )}

                {effectiveAiReady && !keyStatus && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    Sua conta já possui um motor de IA configurado e pronto para uso!
                  </div>
                )}

                <p className="text-[11px] text-slate-500">
                  Prefere IA 100% offline na sua máquina? Você também pode usar <strong>Ollama</strong> depois em <em>Configurações IA</em>.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Passo 2: Conectar seu celular no WhatsApp via QR Code
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    Funciona exatamente como o WhatsApp Web oficial: seu celular continua funcionando normalmente e sua sessão fica isolada apenas na sua conta.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Instruções Android & iPhone */}
                <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs">
                  <p className="font-bold uppercase tracking-wider text-emerald-300">
                    No seu celular:
                  </p>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                    <p className="font-bold text-white">Android</p>
                    <p className="mt-1 leading-relaxed text-slate-300">
                      1. Abra o <strong>WhatsApp</strong>
                      <br />
                      2. Toque nos <strong>3 pontinhos (⋮)</strong> no topo direito
                      <br />
                      3. Toque em <strong>Dispositivos conectados</strong> →{' '}
                      <strong>Conectar dispositivo</strong>
                      <br />
                      4. Aponte a câmera para o QR Code ao lado
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                    <p className="font-bold text-white">iPhone (iOS)</p>
                    <p className="mt-1 leading-relaxed text-slate-300">
                      1. Abra o <strong>WhatsApp</strong>
                      <br />
                      2. Toque em <strong>Configurações (⚙️)</strong> no canto inferior direito
                      <br />
                      3. Toque em <strong>Dispositivos conectados</strong> →{' '}
                      <strong>Conectar dispositivo</strong>
                      <br />
                      4. Aponte a câmera para o QR Code ao lado
                    </p>
                  </div>
                  <div className="flex items-start gap-2 text-[11px] text-slate-400">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>
                      A conexão é 100% gratuita e privada para a sua conta. Você pode desconectar quando quiser pelo celular ou pelo painel.
                    </span>
                  </div>
                </div>

                {/* Área interativa do QR Code ao vivo */}
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-5 text-center">
                  {isWaConnected ? (
                    <div className="space-y-2 py-4">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40">
                        <CheckCircle2 className="h-8 w-8" />
                      </div>
                      <p className="text-base font-bold text-emerald-300">
                        WhatsApp Conectado!
                      </p>
                      <p className="text-xs text-white">
                        {waState.connectedName || 'Dispositivo ativo'}
                      </p>
                      {waState.connectedPhone && (
                        <p className="text-xs font-mono text-emerald-400">
                          +{waState.connectedPhone}
                        </p>
                      )}
                      <p className="pt-1 text-[11px] text-slate-400">
                        Tudo certo! Você já pode avançar para o último passo.
                      </p>
                    </div>
                  ) : waState.status === 'AWAITING_QR' && waState.qrDataUrl ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl bg-white p-2.5 shadow-lg">
                        <img
                          src={waState.qrDataUrl}
                          alt="QR Code WhatsApp"
                          className="h-48 w-48"
                        />
                      </div>
                      <p className="text-xs font-semibold text-amber-300">
                        Escaneie agora com o WhatsApp do seu celular
                      </p>
                      <p className="text-[11px] text-slate-400">
                        O QR Code atualiza automaticamente se expirar.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3 py-4">
                      <QrCode className="mx-auto h-12 w-12 text-slate-600" />
                      <div>
                        <p className="text-sm font-semibold text-white">
                          Pronto para parear seu celular
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Clique no botão abaixo para gerar seu QR Code ao vivo aqui mesmo.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleConnectWhatsApp}
                        disabled={connectingWa}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                      >
                        {connectingWa ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Gerando QR Code...
                          </>
                        ) : (
                          <>
                            <Wifi className="h-4 w-4" />
                            Gerar QR Code Agora
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {(waError || waState.lastError) && (
                    <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                      {waError || waState.lastError}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
                  <Rocket className="h-7 w-7" />
                </div>
                <h3 className="mt-3 text-lg font-bold text-white">
                  Tudo pronto para começar com o ZapFlow AI!
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Veja o resumo da sua configuração inicial e escolha por onde deseja começar:
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div
                  className={`flex items-center gap-3 rounded-2xl border p-4 ${
                    effectiveAiReady
                      ? 'border-emerald-500/30 bg-emerald-500/10'
                      : 'border-amber-500/30 bg-amber-500/10'
                  }`}
                >
                  <Cpu
                    className={`h-5 w-5 shrink-0 ${
                      effectiveAiReady ? 'text-emerald-400' : 'text-amber-300'
                    }`}
                  />
                  <div>
                    <p className="text-xs font-bold text-white">
                      Motor de IA (Gemini)
                    </p>
                    <p
                      className={`text-[11px] ${
                        effectiveAiReady ? 'text-emerald-300' : 'text-amber-200'
                      }`}
                    >
                      {effectiveAiReady
                        ? 'Configurado e validado'
                        : 'Pendente — configure no Passo 1 ou em Configurações IA'}
                    </p>
                  </div>
                </div>

                <div
                  className={`flex items-center gap-3 rounded-2xl border p-4 ${
                    isWaConnected
                      ? 'border-emerald-500/30 bg-emerald-500/10'
                      : 'border-amber-500/30 bg-amber-500/10'
                  }`}
                >
                  <Smartphone
                    className={`h-5 w-5 shrink-0 ${
                      isWaConnected ? 'text-emerald-400' : 'text-amber-300'
                    }`}
                  />
                  <div>
                    <p className="text-xs font-bold text-white">
                      WhatsApp Conectado
                    </p>
                    <p
                      className={`text-[11px] ${
                        isWaConnected ? 'text-emerald-300' : 'text-amber-200'
                      }`}
                    >
                      {isWaConnected
                        ? `Conectado (+${waState.connectedPhone || 'ativo'})`
                        : 'Pendente — escaneie o QR Code no Passo 2 ou no Painel'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => onFinish('rules')}
                  className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-emerald-500/40 hover:bg-slate-800/50"
                >
                  <SlidersHorizontal className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                  <div>
                    <p className="text-xs font-bold text-white">
                      Personalizar Fluxos &amp; Personas
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Defina objetivo, tonalidade, base de conhecimento e condição de parada para transferir p/ humano.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onFinish('training')}
                  className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-emerald-500/40 hover:bg-slate-800/50"
                >
                  <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                  <div>
                    <p className="text-xs font-bold text-white">
                      Treinar no Simulador ao Vivo
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Teste respostas da IA antes de atender clientes reais e aprove ou corrija com 1 clique.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé de navegação do Wizard */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/70 px-6 py-4">
          <button
            type="button"
            onClick={() => onFinish()}
            className="text-xs font-medium text-slate-400 transition hover:text-white"
          >
            Pular guia por enquanto
          </button>

          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar
              </button>
            )}

            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
              >
                Próximo Passo
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onFinish('dashboard')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
              >
                Concluir e Ir ao Painel
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
