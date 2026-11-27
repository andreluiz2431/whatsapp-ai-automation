import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  ExternalLink,
  Eye,
  GraduationCap,
  KeyRound,
  Layers,
  Lock,
  Megaphone,
  MessageSquare,
  Mic,
  QrCode,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { useState } from 'react';

interface Props {
  onGoToAuth: (mode: 'login' | 'register') => void;
}

interface UseCaseScenario {
  id: string;
  segment: string;
  title: string;
  tag: string;
  tone: string;
  highlightFeature: string;
  summary: string;
  chat: Array<{
    from: 'client' | 'ai' | 'system';
    label: string;
    text: string;
    meta?: string;
  }>;
  results: string[];
}

const USE_CASES: UseCaseScenario[] = [
  {
    id: 'vendas',
    segment: 'Vendas & Leads',
    title: 'Qualificação Comercial & Campanhas Anti-Ban',
    tag: 'Tag: Leads',
    tone: 'Comercial & Persuasivo • Flexível',
    highlightFeature: 'Campanhas com variação IA + pós-resposta automático',
    summary:
      'Envie mensagens personalizadas com {{primeiro_nome}} em fila segura (45–120s) e deixe a IA qualificar automaticamente quem responder, transferindo apenas leads prontos para fechar.',
    chat: [
      {
        from: 'ai',
        label: 'Campanha (Variação IA)',
        text: 'Oi Mariana, tudo certo? Liberamos uma condição especial essa semana para quem pediu orçamento do Plano Pro. Posso te mandar os detalhes?',
      },
      {
        from: 'client',
        label: 'Mariana (Lead)',
        text: 'Oi! Pode sim, quero saber o valor e se dá pra testar antes.',
      },
      {
        from: 'ai',
        label: 'ZapFlow AI • Regra Leads',
        text: 'O Plano Pro sai por R$ 197/mês com contatos ilimitados e suporte prioritário — e você tem 7 dias de teste grátis sem cartão. Quantas pessoas atendem hoje no seu time?',
        meta: 'Sem saudação repetida • Contexto dos últimos 20 min',
      },
      {
        from: 'client',
        label: 'Mariana (Lead)',
        text: 'Somos 5 pessoas! Consegue um desconto para fechar anual agora?',
      },
      {
        from: 'system',
        label: 'Condição de Parada Acionada',
        text: 'Chat transferido para Manual + Alerta amarelo clicável exibido no Painel de Controle para negociação especial.',
      },
    ],
    results: [
      'Qualificação instantânea 24h sem perder leads fora do horário comercial',
      'Disparos seguros com jitter aleatório, pausa em lotes e simulação de "digitando..."',
      'Consultor humano só entra na hora de fechar a proposta',
    ],
  },
  {
    id: 'ecommerce',
    segment: 'Loja & Pix',
    title: 'E-commerce com Leitura de Comprovantes & Fotos',
    tag: 'Tag: Pedidos',
    tone: 'Descontraído & Amigável • Equilibrado',
    highlightFeature: 'Módulo Visão IA (lê fotos e comprovantes no Free Tier)',
    summary:
      'Quando o cliente envia foto de um produto ou comprovante Pix, a IA extrai valor, data e dados automaticamente e responde de forma natural sem depender de triagem manual.',
    chat: [
      {
        from: 'client',
        label: 'Carlos (Cliente)',
        text: '[Imagem enviada] Acabei de fazer o Pix do pedido #4821, confirma pra mim?',
        meta: 'Leitura da Imagem (IA): Comprovante Pix R$ 249,90 • 27/11 às 14:12 • Pago para Loja Exemplo',
      },
      {
        from: 'ai',
        label: 'ZapFlow AI • Visão IA',
        text: 'Recebi seu comprovante Pix de R$ 249,90 referente ao pedido #4821, Carlos! Já marquei aqui para conferência final da expedição e assim que o código de rastreio sair te aviso por aqui.',
      },
      {
        from: 'client',
        label: 'Carlos (Cliente)',
        text: 'Show, chega em quantos dias para SP capital?',
      },
      {
        from: 'ai',
        label: 'ZapFlow AI • Base de Conhecimento',
        text: 'Para São Paulo capital o prazo de entrega é de 1 a 2 dias úteis após a postagem.',
        meta: 'Flexível e natural • 100% fiel aos prazos da base',
      },
    ],
    results: [
      'Extração automática de valores, datas e textos em fotos e prints de erro',
      'Zero custo adicional de API usando Gemini Flash / Flash-Lite no Free Tier',
      'Histórico organizado com resumo executivo de cada atendimento em 1 clique',
    ],
  },
  {
    id: 'clinica',
    segment: 'Clínicas & Serviços',
    title: 'Agendamentos com Transcrição Automática de Áudios',
    tag: 'Tag: Agendamento',
    tone: 'Empático & Acolhedor • Curto',
    highlightFeature: 'Módulo Áudio IA (entende mensagens de voz do WhatsApp)',
    summary:
      'Clientes adoram mandar áudio no WhatsApp. O ZapFlow AI transcreve mensagens de voz nativamente, exibe o texto no chat e responde exatamente o que foi falado.',
    chat: [
      {
        from: 'client',
        label: 'Fernanda (Paciente)',
        text: '[Mensagem de voz (18s)]',
        meta: 'Transcrição (IA): "Oi, vocês aceitam convênio Unimed para consulta dermatológica e tem horário na quinta à tarde?"',
      },
      {
        from: 'ai',
        label: 'ZapFlow AI • Áudio IA',
        text: 'Olá Fernanda! Aceitamos Unimed sim. Para dermatologia temos agenda disponível na quinta-feira às 14h30 e às 16h. Qual horário fica melhor para você?',
      },
      {
        from: 'client',
        label: 'Fernanda (Paciente)',
        text: 'Quinta às 16h! Preciso levar algum exame?',
      },
      {
        from: 'ai',
        label: 'ZapFlow AI • Regra Agendamento',
        text: 'Combinado para quinta às 16h! Basta trazer documento com foto, carteirinha do convênio e exames recentes caso tenha. Pode me confirmar seu nome completo?',
      },
    ],
    results: [
      'Transcreve áudios OGG/Opus do WhatsApp sem Whisper pago e sem FFmpeg',
      'Equipe lê rapidamente o que o cliente falou em texto direto no painel',
      'Respostas empáticas, curtas e sem repetir saudações na mesma conversa',
    ],
  },
  {
    id: 'suporte',
    segment: 'Suporte 24h',
    title: 'Suporte Técnico com Roteiros Treinados & Escalonamento',
    tag: 'Tag: Suporte',
    tone: 'Direto & Objetivo • Fiel aos exemplos',
    highlightFeature: 'Treinamento em lote (CSV/JSON) + Caracterizador IA',
    summary:
      'Importe sua planilha de perguntas frequentes, deixe a IA categorizar por assunto e teste tudo no Simulador ao Vivo antes de atender seus clientes reais.',
    chat: [
      {
        from: 'client',
        label: 'Lucas (Cliente)',
        text: 'Esqueci minha senha e o link de recuperação não chegou no meu e-mail.',
      },
      {
        from: 'ai',
        label: 'ZapFlow AI • Roteiro Suporte',
        text: 'Verifique primeiro a pasta de Spam ou Lixo Eletrônico pelo remetente "noreply@suaempresa.com". Se não estiver lá, me confirme o e-mail cadastrado que verifico para você.',
        meta: 'Assunto treinado: Acesso e Senha',
      },
      {
        from: 'client',
        label: 'Lucas (Cliente)',
        text: 'Olhei no spam e também apareceu cobrança duplicada na fatura!',
      },
      {
        from: 'system',
        label: 'Alerta Amarelo no Painel de Controle',
        text: 'Cobrança duplicada detectada → Chat alterado para Manual e destacado no topo do Painel para o financeiro assumir com 1 clique.',
      },
    ],
    results: [
      'Resolva 80% das dúvidas repetitivas com exemplos importados via Excel/CSV ou JSON',
      'Caracterizador com IA agrupa exemplos por assunto e #palavras-chave',
      'Escalonamento automático com alerta visual amarelo quando envolve cobrança ou urgência',
    ],
  },
];

const FEATURES = [
  {
    icon: QrCode,
    title: 'WhatsApp via QR Code (Sem API Paga)',
    desc: 'Conecte como no WhatsApp Web usando Baileys nativo. Zero custo por mensagem, sem taxa da Meta e reconexão automática.',
  },
  {
    icon: Sparkles,
    title: 'IA Contextual com Memória de 20 min',
    desc: 'Analisa o andamento real da conversa antes de responder, evita repetir "Olá" no mesmo dia e adapta tonalidade e flexibilidade por Tag/Fluxo.',
  },
  {
    icon: Eye,
    title: 'Visão IA & Transcrição de Áudios',
    desc: 'Lê comprovantes Pix, fotos de produtos, prints de erro e transcreve mensagens de voz do WhatsApp nativamente no Gemini Free Tier.',
  },
  {
    icon: GraduationCap,
    title: 'Treinamento Contínuo + Caracterizador IA',
    desc: 'Simulador ao vivo, aprendizado direto de chats reais/.txt, importação/exportação em lote (CSV/JSON) e categorização automática por assunto.',
  },
  {
    icon: BellRing,
    title: 'Fila ao Vivo & Alerta Amarelo p/ Humano',
    desc: 'Acompanhe em tempo real o status da fila de respostas e receba alertas amarelos clicáveis no Painel quando um cliente precisa de atendente.',
  },
  {
    icon: Megaphone,
    title: 'Campanhas Seguras com Anti-Ban',
    desc: 'Fila sequencial com intervalos aleatórios (45–120s), pausa em lotes, variação natural de texto com IA e simulação de "digitando...".',
  },
];

export function LandingPage({ onGoToAuth }: Props) {
  const [activeCaseId, setActiveCaseId] = useState<string>(USE_CASES[0].id);
  const currentCase =
    USE_CASES.find((c) => c.id === activeCaseId) || USE_CASES[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Navbar fixa */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <a href="#topo" className="flex items-center gap-2.5">
            <img
              src="/favicon.svg"
              alt="ZapFlow AI"
              className="h-9 w-9 rounded-xl shadow-md"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-white">
                  ZapFlow AI
                </span>
                <span className="hidden rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300 sm:inline-block">
                  100% Gratuito
                </span>
              </div>
              <p className="hidden text-[11px] text-slate-400 sm:block">
                Automação &amp; Atendimento Inteligente no WhatsApp
              </p>
            </div>
          </a>

          <nav className="hidden items-center gap-6 text-xs font-medium text-slate-300 md:flex">
            <a href="#recursos" className="transition hover:text-emerald-300">
              Recursos
            </a>
            <a href="#exemplos" className="transition hover:text-emerald-300">
              Exemplos de Uso
            </a>
            <a
              href="#como-funciona"
              className="transition hover:text-emerald-300"
            >
              Como Funciona
            </a>
            <a href="#seguranca" className="transition hover:text-emerald-300">
              Privacidade
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onGoToAuth('login')}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => onGoToAuth('register')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
            >
              Começar Grátis
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* HERO SECTION */}
      <section
        id="topo"
        className="relative overflow-hidden border-b border-slate-800/70"
      >
        {/* Brilho sutil de fundo */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-96 w-[720px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:py-20">
          <div className="space-y-6 lg:col-span-6">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              Sem API paga da Meta • Gemini Free Tier ou Ollama Local
            </div>

            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
              Automatize seu WhatsApp com{' '}
              <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                Inteligência Artificial
              </span>{' '}
              no seu controle.
            </h1>

            <p className="max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
              Conecte seu número via QR Code em segundos, responda clientes com
              naturalidade (inclusive lendo <strong>fotos</strong> e{' '}
              <strong>áudios</strong>), treine sua IA com seus próprios roteiros
              e assuma qualquer chat manualmente quando precisar.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onGoToAuth('register')}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
              >
                <Rocket className="h-4 w-4" />
                Criar Conta Grátis
              </button>
              <button
                type="button"
                onClick={() => onGoToAuth('login')}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-5 py-3.5 text-sm font-semibold text-white transition hover:border-slate-600 hover:bg-slate-800"
              >
                Ir para Login
                <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href="#exemplos"
                className="inline-flex items-center gap-1.5 px-2 py-2 text-xs font-semibold text-emerald-400 transition hover:text-emerald-300"
              >
                Ver exemplos reais ↓
              </a>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-3 sm:max-w-lg">
              {[
                ['R$ 0', 'Sem mensalidade nem taxa por msg'],
                ['Multi-usuário', 'WhatsApp e chave IA 100% isolados'],
                ['2 min', 'Guia teleguiado pronto ao entrar'],
              ].map(([metric, label]) => (
                <div
                  key={metric}
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3"
                >
                  <p className="text-base font-extrabold text-emerald-400 sm:text-lg">
                    {metric}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Preview Visual do Sistema */}
          <div className="lg:col-span-6">
            <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/90 shadow-2xl">
              {/* Barra superior simulada */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/80 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span className="text-xs font-bold text-white">
                    ZapFlow AI • Painel ao Vivo
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                    WhatsApp Conectado
                  </span>
                  <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-300">
                    Fila IA: Respondido ✓
                  </span>
                </div>
              </div>

              {/* Alerta amarelo simulado */}
              <div className="flex items-center justify-between gap-2 border-b border-amber-400/30 bg-amber-500/15 px-4 py-2.5 text-[11px]">
                <div className="flex items-center gap-2 text-amber-200">
                  <BellRing className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span>
                    <strong>Atenção Humana:</strong> 1 conversa redirecionada
                    para fechamento
                  </span>
                </div>
                <span className="shrink-0 rounded-md bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-slate-950">
                  Abrir Chat →
                </span>
              </div>

              {/* Chat simulado */}
              <div className="space-y-3 p-4 sm:p-5">
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                      <Mic className="h-3 w-3 text-emerald-400" />
                      Cliente • Áudio (14s)
                    </div>
                    <p className="text-slate-200">
                      &quot;Oi! Vi o anúncio de vocês, funciona no meu WhatsApp
                      normal e consigo testar hoje ainda?&quot;
                    </p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-emerald-500/30 bg-emerald-500/15 px-3.5 py-2.5 text-xs">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-emerald-300">
                      <Bot className="h-3 w-3" />
                      ZapFlow AI • Regra Leads (Tom Consultivo)
                    </div>
                    <p className="text-emerald-50">
                      Funciona sim no seu WhatsApp normal ou Business! Você
                      conecta por QR Code em menos de 1 minuto e já pode testar
                      hoje gratuitamente. Quer que eu te envie o passo a passo?
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 text-center text-[10px]">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2">
                    <Eye className="mx-auto mb-1 h-3.5 w-3.5 text-emerald-400" />
                    <span className="font-semibold text-slate-300">
                      Lê Imagens &amp; Pix
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2">
                    <Mic className="mx-auto mb-1 h-3.5 w-3.5 text-sky-400" />
                    <span className="font-semibold text-slate-300">
                      Transcreve Áudios
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2">
                    <SlidersHorizontal className="mx-auto mb-1 h-3.5 w-3.5 text-violet-400" />
                    <span className="font-semibold text-slate-300">
                      Tom &amp; Flexibilidade
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* RECURSOS */}
      <section id="recursos" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
            Recursos Completos
          </span>
          <h2 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">
            Tudo o que sua operação no WhatsApp precisa em um só lugar
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Projetado para autônomos, pequenas empresas e equipes de atendimento
            que querem automação inteligente sem mensalidades caras.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feat) => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-emerald-500/30 hover:bg-slate-900"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-bold text-white">
                  {feat.title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {feat.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* EXEMPLOS DE USO INTERATIVOS */}
      <section
        id="exemplos"
        className="border-y border-slate-800/80 bg-slate-900/35 py-16"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
              Exemplos Reais de Uso
            </span>
            <h2 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">
              Veja como o ZapFlow AI atua em diferentes negócios
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Clique em um cenário abaixo para explorar como a IA combina
              regras por Tag, leitura de mídia, treinamento e transferência para
              humano.
            </p>
          </div>

          {/* Seletor de cenários */}
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {USE_CASES.map((uc) => {
              const active = uc.id === currentCase.id;
              return (
                <button
                  key={uc.id}
                  type="button"
                  onClick={() => setActiveCaseId(uc.id)}
                  className={`rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                    active
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                      : 'border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  {uc.segment}
                </button>
              );
            })}
          </div>

          {/* Painel do cenário ativo */}
          <div className="mt-8 grid gap-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 lg:grid-cols-12 lg:p-8">
            <div className="flex flex-col justify-between space-y-5 lg:col-span-5">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-300">
                    {currentCase.tag}
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-[11px] text-slate-300">
                    {currentCase.tone}
                  </span>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-white">
                    {currentCase.title}
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300 sm:text-sm">
                    {currentCase.summary}
                  </p>
                </div>

                <div className="rounded-2xl border border-violet-500/25 bg-violet-500/10 px-3.5 py-2.5 text-xs text-violet-200">
                  <strong>Destaque usado:</strong>{' '}
                  {currentCase.highlightFeature}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Benefícios na prática:
                  </p>
                  {currentCase.results.map((r) => (
                    <div
                      key={r}
                      className="flex items-start gap-2 text-xs text-slate-200"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onGoToAuth('register')}
                className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
              >
                Usar este modelo na minha conta
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Simulação da conversa */}
            <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/75 p-4 sm:p-5 lg:col-span-7">
              <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-3 text-xs">
                <span className="flex items-center gap-2 font-bold text-white">
                  <MessageSquare className="h-4 w-4 text-emerald-400" />
                  Simulação de Atendimento Real
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                  <Clock className="h-3 w-3 text-emerald-400" />
                  Tempo real via WebSocket
                </span>
              </div>

              <div className="space-y-3">
                {currentCase.chat.map((msg, i) => {
                  if (msg.from === 'system') {
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 rounded-xl border border-amber-400/40 bg-amber-500/15 p-3 text-xs text-amber-100"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <div>
                          <p className="font-bold text-amber-300">
                            {msg.label}
                          </p>
                          <p className="mt-0.5 text-amber-100/90">{msg.text}</p>
                        </div>
                      </div>
                    );
                  }
                  const isAi = msg.from === 'ai';
                  return (
                    <div
                      key={i}
                      className={`flex ${isAi ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs ${
                          isAi
                            ? 'rounded-tr-sm border border-emerald-500/30 bg-emerald-500/15 text-emerald-50'
                            : 'rounded-tl-sm border border-slate-800 bg-slate-900 text-slate-100'
                        }`}
                      >
                        <p
                          className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${
                            isAi ? 'text-emerald-300' : 'text-slate-400'
                          }`}
                        >
                          {msg.label}
                        </p>
                        <p className="leading-relaxed">{msg.text}</p>
                        {msg.meta && (
                          <p className="mt-2 rounded-lg border border-slate-700/80 bg-slate-950/70 px-2.5 py-1.5 text-[10px] text-slate-300">
                            {msg.meta}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA EM 3 PASSOS */}
      <section
        id="como-funciona"
        className="mx-auto max-w-7xl px-4 py-16 sm:px-6"
      >
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
            Início Rápido
          </span>
          <h2 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">
            Do zero ao atendimento automático em 3 passos
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Assim que você entra pela primeira vez, nosso{' '}
            <strong className="text-slate-200">Guia Teleguiado</strong> conduz
            toda a configuração na tela.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
                Passo 1
              </span>
              <UserCheck className="h-5 w-5 text-emerald-400" />
            </div>
            <h3 className="mt-4 text-base font-bold text-white">
              Crie sua conta isolada
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Entre com sua conta Google em 1 clique ou cadastre-se com e-mail e
              senha. Seu ambiente nasce pronto com tags e regra inicial.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
                Passo 2
              </span>
              <KeyRound className="h-5 w-5 text-emerald-400" />
            </div>
            <h3 className="mt-4 text-base font-bold text-white">
              Gere sua API Key gratuita (Google Gemini)
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Pegue sua chave gratuita no Google AI Studio sem cartão de crédito
              (ou conecte um servidor Ollama local) e valide direto no guia.
            </p>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
            >
              Abrir Google AI Studio
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
                Passo 3
              </span>
              <QrCode className="h-5 w-5 text-emerald-400" />
            </div>
            <h3 className="mt-4 text-base font-bold text-white">
              Escaneie o QR Code no WhatsApp
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Abra <em>Dispositivos conectados</em> no celular (Android ou
              iPhone), escaneie o QR Code ao vivo e pronto — sua IA já pode
              atender!
            </p>
          </div>
        </div>
      </section>

      {/* PRIVACIDADE & ARQUITETURA */}
      <section
        id="seguranca"
        className="mx-auto max-w-7xl px-4 pb-16 sm:px-6"
      >
        <div className="grid gap-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-6 sm:p-8 lg:grid-cols-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-white">
                Isolamento Multi-Usuário Real
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Cada conta possui sessão WhatsApp própria, chave de IA própria,
                salas privadas de WebSocket e conversas totalmente separadas.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-white">
                Sessões Seguras &amp; Controle Humano
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Autenticação com cookie <code>HttpOnly</code>, pausa global em 1
                clique, alternância em massa entre IA/Manual e pausa automática
                quando você responde.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Layers className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-white">
                Hierarquia Inteligente de Regras
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Defina personas diferentes por <strong>Contato Individual</strong>
                , <strong>Campanha</strong>, <strong>Grupo/Tag</strong> ou{' '}
                <strong>Global</strong>, com tom e flexibilidade próprios.
              </p>
            </div>
          </div>
        </div>

        {/* CTA Final */}
        <div className="mt-10 overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-slate-900 via-emerald-950/40 to-slate-900 p-8 text-center sm:p-12">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40">
            <Cpu className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-2xl font-extrabold text-white sm:text-3xl">
            Pronto para colocar IA atendendo no seu WhatsApp?
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-300">
            Crie sua conta gratuita agora ou faça login para acessar seu painel,
            configurar sua chave do Google Gemini e conectar seu número.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onGoToAuth('register')}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
            >
              <Rocket className="h-4 w-4" />
              Criar Conta Grátis
            </button>
            <button
              type="button"
              onClick={() => onGoToAuth('login')}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Já tenho conta — Entrar
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Rodapé */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <img
              src="/favicon.svg"
              alt="ZapFlow AI"
              className="h-5 w-5 rounded"
            />
            <span className="font-semibold text-slate-300">ZapFlow AI</span>
            <span>• Automação de WhatsApp com IA (100% Gratuito)</span>
          </div>
          <button
            type="button"
            onClick={() => onGoToAuth('login')}
            className="font-semibold text-emerald-400 hover:text-emerald-300"
          >
            Acessar Painel →
          </button>
        </div>
      </footer>
    </div>
  );
}
