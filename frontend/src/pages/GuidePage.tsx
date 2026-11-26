import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  HelpCircle,
  Info,
  Layers,
  Megaphone,
  MessageSquare,
  QrCode,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { useState } from 'react';
import { NavTab } from '../components/Sidebar';

interface Props {
  onNavigate: (tab: NavTab) => void;
}

type GuideSection = 'quickstart' | 'features' | 'examples' | 'faq' | 'about';

interface ExampleTemplate {
  id: string;
  badge: string;
  title: string;
  description: string;
  fields: Array<{ label: string; value: string }>;
  copyText: string;
}

const EXAMPLE_TEMPLATES: ExampleTemplate[] = [
  {
    id: 'vendas',
    badge: 'Grupo/Tag: Leads',
    title: 'Qualificação de Leads e Vendas',
    description:
      'Ideal para atender contatos que chegam de anúncios ou responderam a uma campanha comercial.',
    fields: [
      {
        label: 'Objetivo',
        value:
          'Dar boas-vindas, descobrir qual produto/serviço o lead procura, entender urgência e orçamento aproximado, e oferecer agendamento de uma demonstração.',
      },
      {
        label: 'Tom de Voz',
        value:
          'Consultivo, amigável, direto e natural como uma conversa de WhatsApp (mensagens curtas de até 3 linhas, fazendo 1 pergunta por vez).',
      },
      {
        label: 'Base de Conhecimento',
        value:
          'Plano Essencial: R$ 97/mês (até 1.000 contatos). Plano Pro: R$ 197/mês (contatos ilimitados + suporte prioritário). Teste grátis de 7 dias sem cartão. Horário comercial: Seg a Sex, 9h às 18h.',
      },
      {
        label: 'Condição de Parada',
        value:
          'Quando o lead pedir desconto personalizado, enviar comprovante de pagamento ou pedir explicitamente para falar com um consultor humano.',
      },
    ],
    copyText: `Objetivo: Dar boas-vindas, descobrir qual produto/serviço o lead procura, entender urgência e orçamento aproximado, e oferecer agendamento de uma demonstração.\nTom de Voz: Consultivo, amigável, direto e natural como uma conversa de WhatsApp (mensagens curtas de até 3 linhas, fazendo 1 pergunta por vez).\nBase de Conhecimento: Plano Essencial: R$ 97/mês (até 1.000 contatos). Plano Pro: R$ 197/mês (contatos ilimitados + suporte prioritário). Teste grátis de 7 dias sem cartão. Horário comercial: Seg a Sex, 9h às 18h.\nCondição de Parada: Quando o lead pedir desconto personalizado, enviar comprovante de pagamento ou pedir explicitamente para falar com um consultor humano.`,
  },
  {
    id: 'suporte',
    badge: 'Grupo/Tag: Suporte',
    title: 'Suporte ao Cliente & FAQ 24h',
    description:
      'Resolve dúvidas frequentes automaticamente e aciona um humano apenas em casos críticos.',
    fields: [
      {
        label: 'Objetivo',
        value:
          'Identificar a dúvida ou problema técnico do cliente, orientar o passo a passo de resolução com clareza e confirmar se foi resolvido.',
      },
      {
        label: 'Tom de Voz',
        value: 'Empático, paciente, calmo e objetivo.',
      },
      {
        label: 'Base de Conhecimento',
        value:
          'Redefinição de senha: clicar em "Esqueci minha senha" na tela de login. Segunda via de boleto: enviada pelo portal do cliente. Prazo de troca/garantia: até 30 dias após o recebimento.',
      },
      {
        label: 'Condição de Parada',
        value:
          'Se o cliente relatar cobrança indevida, solicitar estorno/cancelamento ou demonstrar irritação após 2 tentativas de solução.',
      },
    ],
    copyText: `Objetivo: Identificar a dúvida ou problema técnico do cliente, orientar o passo a passo de resolução com clareza e confirmar se foi resolvido.\nTom de Voz: Empático, paciente, calmo e objetivo.\nBase de Conhecimento: Redefinição de senha: clicar em "Esqueci minha senha" na tela de login. Segunda via de boleto: enviada pelo portal do cliente. Prazo de troca/garantia: até 30 dias após o recebimento.\nCondição de Parada: Se o cliente relatar cobrança indevida, solicitar estorno/cancelamento ou demonstrar irritação após 2 tentativas de solução.`,
  },
  {
    id: 'agendamento',
    badge: 'Global ou Individual',
    title: 'Agendamento de Consultas / Serviços',
    description:
      'Coleta preferência de dia/horário e serviço desejado antes de confirmar na agenda.',
    fields: [
      {
        label: 'Objetivo',
        value:
          'Acolher o cliente, perguntar qual serviço deseja agendar e coletar 2 opções de dia e período (manhã ou tarde).',
      },
      {
        label: 'Tom de Voz',
        value: 'Atencioso, acolhedor e organizado.',
      },
      {
        label: 'Base de Conhecimento',
        value:
          'Atendemos de segunda a sábado, das 8h às 19h. Endereço: Av. Paulista, 1000 — Sala 42. Aceitamos Pix, débito e crédito em até 3x.',
      },
      {
        label: 'Condição de Parada',
        value:
          'Assim que o cliente informar nome completo, serviço e horário preferido, transferir para a recepção confirmar a reserva.',
      },
    ],
    copyText: `Objetivo: Acolher o cliente, perguntar qual serviço deseja agendar e coletar 2 opções de dia e período (manhã ou tarde).\nTom de Voz: Atencioso, acolhedor e organizado.\nBase de Conhecimento: Atendemos de segunda a sábado, das 8h às 19h. Endereço: Av. Paulista, 1000 — Sala 42. Aceitamos Pix, débito e crédito em até 3x.\nCondição de Parada: Assim que o cliente informar nome completo, serviço e horário preferido, transferir para a recepção confirmar a reserva.`,
  },
  {
    id: 'campanha',
    badge: 'Disparador de Campanhas',
    title: 'Mensagem de Campanha + Lista CSV',
    description:
      'Exemplo de texto com variável {{primeiro_nome}} e lista pronta para colar na aba Campanhas.',
    fields: [
      {
        label: 'Template da Mensagem',
        value:
          'Olá {{primeiro_nome}}, tudo bem? Estamos liberando condições especiais esta semana para quem já demonstrou interesse. Posso te enviar os detalhes por aqui?',
      },
      {
        label: 'Lista de Contatos (Colar Texto ou CSV)',
        value:
          'João Silva, 11999998888\nMaria Oliveira, 21988887777\nCarlos Souza, 5531977776666',
      },
      {
        label: 'Configuração Recomendada',
        value:
          'Ative "Variar saudação/texto com IA" + "Ativar IA automaticamente quando responder" + intervalo 45s–120s e pausa de 5 min a cada 20 envios.',
      },
    ],
    copyText: `Olá {{primeiro_nome}}, tudo bem? Estamos liberando condições especiais esta semana para quem já demonstrou interesse. Posso te enviar os detalhes por aqui?`,
  },
];

const FAQ_ITEMS = [
  {
    q: 'Como consigo a chave gratuita da Google Gemini API?',
    a: 'Acesse https://aistudio.google.com/apikey com sua conta Google, clique em "Create API Key", copie a chave gerada e cole em Configurações IA → Gemini API Key. Depois clique em Salvar e em "Testar Conexão com IA". O plano gratuito do Gemini atende perfeitamente centenas de conversas.',
  },
  {
    q: 'Posso usar Ollama 100% gratuito na minha máquina?',
    a: 'Sim! Quando rodar o ZapFlow AI localmente, instale o Ollama (ollama.com), baixe um modelo como "ollama pull llama3.2" ou "ollama pull qwen2.5", vá em Configurações IA, escolha Ollama (Local) e mantenha a URL http://localhost:11434.',
  },
  {
    q: 'Outras pessoas com o link conseguem ver meu WhatsApp ou minha chave de IA?',
    a: 'Não. A aplicação é 100% multi-usuário com isolamento completo: cada conta (Google ou e-mail/senha) possui sua própria sessão criptografada, sua própria conexão Baileys do WhatsApp, sua própria chave de IA, conversas, contatos, regras e campanhas.',
  },
  {
    q: 'Como evitar bloqueio/banimento do número no WhatsApp?',
    a: 'Nunca envie dezenas de mensagens idênticas em segundos. Use sempre os padrões anti-ban do ZapFlow AI: intervalo aleatório entre 45 e 120 segundos, pausa em lote de 5 minutos a cada 20 disparos, simulação de "digitando..." (3–7s) e variação natural com IA. Em números novos, faça aquecimento começando com 20–30 disparos/dia; em números antigos, mantenha abaixo de 80–100/dia.',
  },
  {
    q: 'O que acontece quando eu respondo manualmente uma conversa pelo painel?',
    a: 'Se a opção "Assumir conversa automaticamente ao enviar mensagem manual" estiver ativa (padrão), o chat muda na hora de Modo Automático (IA) para Modo Manual (Humano) para que a IA não atrapalhe seu atendimento. Quando quiser devolver para a IA, basta clicar em "Modo Manual (Ativar IA)" no topo do chat.',
  },
  {
    q: 'Se o servidor reiniciar, preciso escanear o QR Code de novo?',
    a: 'Não! As credenciais da sua sessão do WhatsApp e o banco SQLite ficam gravados no volume persistente. Ao reiniciar, o servidor restaura sua conexão automaticamente.',
  },
];

export function GuidePage({ onNavigate }: Props) {
  const [section, setSection] = useState<GuideSection>('quickstart');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // fallback silencioso
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 p-6 sm:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              <BookOpen className="h-3.5 w-3.5" />
              Central de Ajuda, Guias &amp; Sobre o ZapFlow AI
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Manual Completo de Uso
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              Aprenda em poucos minutos a conectar seu WhatsApp sem custo de API oficial, configurar personas inteligentes com hierarquia de regras e executar campanhas seguras com proteção anti-ban.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={() => onNavigate('settings')}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              <Cpu className="h-4 w-4" />
              Configurar IA
            </button>
            <button
              onClick={() => onNavigate('dashboard')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              <QrCode className="h-4 w-4" />
              Conectar WhatsApp
            </button>
          </div>
        </div>

        {/* Sub-navegação */}
        <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-800/80 pt-5">
          {[
            { id: 'quickstart', label: 'Início Rápido', icon: Rocket },
            { id: 'features', label: 'Guia das Telas', icon: Layers },
            { id: 'examples', label: 'Exemplos Prontos', icon: Sparkles },
            { id: 'faq', label: 'Dúvidas Frequentes', icon: HelpCircle },
            { id: 'about', label: 'Sobre a Aplicação', icon: Info },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = section === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setSection(tab.id as GuideSection)}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                    : 'bg-slate-950/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* SEÇÃO 1: INÍCIO RÁPIDO */}
      {section === 'quickstart' && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                step: 'Passo 1',
                title: 'Configure seu Motor de IA Gratuito',
                desc: 'Acesse Configurações IA e cole sua chave gratuita do Google Gemini (aistudio.google.com/apikey) ou selecione Ollama Local. Clique em "Testar Conexão com IA" para confirmar que a IA está respondendo.',
                actionLabel: 'Ir para Configurações IA',
                target: 'settings' as NavTab,
                icon: Cpu,
              },
              {
                step: 'Passo 2',
                title: 'Conecte seu WhatsApp via QR Code',
                desc: 'No Painel de Controle, clique em "Conectar via QR Code". No celular, abra WhatsApp → Aparelhos Conectados → Conectar Aparelho e aponte a câmera. Sua sessão fica salva automaticamente.',
                actionLabel: 'Ir para Painel de Controle',
                target: 'dashboard' as NavTab,
                icon: QrCode,
              },
              {
                step: 'Passo 3',
                title: 'Personalize o Comportamento da IA',
                desc: 'Em Fluxos & Personas IA, edite a regra Global (padrão) com informações do seu negócio, tom de voz e quando transferir para humano. Crie regras específicas por Grupo/Tag ou por número Individual.',
                actionLabel: 'Ir para Fluxos & Personas IA',
                target: 'rules' as NavTab,
                icon: Layers,
              },
              {
                step: 'Passo 4',
                title: 'Acompanhe Chats ou Dispare Campanhas',
                desc: 'Use a aba Conversas para acompanhar respostas da IA em tempo real ou assumir qualquer chat manualmente. Em Campanhas, importe contatos por texto/CSV com proteção anti-ban já ativada.',
                actionLabel: 'Ir para Campanhas',
                target: 'campaigns' as NavTab,
                icon: Megaphone,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                        {item.step}
                      </span>
                      <Icon className="h-5 w-5 text-emerald-400" />
                    </div>
                    <h3 className="mt-3 text-base font-bold text-white">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">
                      {item.desc}
                    </p>
                  </div>
                  <button
                    onClick={() => onNavigate(item.target)}
                    className="mt-4 inline-flex items-center gap-1.5 self-start text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                  >
                    {item.actionLabel}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Card de boas práticas anti-ban */}
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-amber-300">
              <ShieldAlert className="h-4 w-4" />
              Regras de Ouro para Evitar Bloqueio no WhatsApp
            </h3>
            <div className="mt-3 grid gap-3 text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="font-semibold text-white">Intervalo Aleatório</p>
                <p className="mt-1 text-slate-400">
                  Mantenha entre <strong>45s e 120s</strong> entre envios (nunca tempos fixos idênticos).
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="font-semibold text-white">Pausa em Lotes</p>
                <p className="mt-1 text-slate-400">
                  A cada <strong>20 mensagens</strong>, o sistema pausa automaticamente por <strong>5 minutos</strong>.
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="font-semibold text-white">Aquecimento Diário</p>
                <p className="mt-1 text-slate-400">
                  Chip novo: <strong>20–30/dia</strong> na 1ª semana. Chip antigo: abaixo de <strong>80–100/dia</strong>.
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="font-semibold text-white">Variação com IA</p>
                <p className="mt-1 text-slate-400">
                  Ative a variação natural por IA nas campanhas + simulação automática de <em>digitando...</em> (3–7s).
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SEÇÃO 2: GUIA DAS FUNCIONALIDADES */}
      {section === 'features' && (
        <div className="space-y-4">
          {/* Diagrama Hierarquia de Regras */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h3 className="flex items-center gap-2 text-base font-bold text-white">
              <Layers className="h-5 w-5 text-emerald-400" />
              Como Funciona a Hierarquia de Regras da IA
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Quando uma mensagem chega no seu WhatsApp, a IA verifica qual persona aplicar seguindo esta ordem exata de prioridade:
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {[
                {
                  rank: '1º',
                  title: 'Individual (Contato)',
                  color: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                  desc: 'Regra vinculada a um número específico. Sempre vence todas as outras.',
                },
                {
                  rank: '2º',
                  title: 'Fluxo de Campanha',
                  color: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
                  desc: 'Fluxo escolhido na campanha quando o lead responde ao disparo.',
                },
                {
                  rank: '3º',
                  title: 'Grupo / Tag',
                  color: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
                  desc: 'Aplica-se a contatos marcados com tags como Leads, VIP ou Suporte.',
                },
                {
                  rank: '4º',
                  title: 'Global (Padrão)',
                  color: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                  desc: 'Usada automaticamente quando o contato não tem regra mais específica.',
                },
              ].map((lvl) => (
                <div
                  key={lvl.rank}
                  className={`rounded-xl border p-4 ${lvl.color}`}
                >
                  <span className="text-xs font-extrabold uppercase">
                    Prioridade {lvl.rank}
                  </span>
                  <p className="mt-1 text-sm font-bold text-white">{lvl.title}</p>
                  <p className="mt-1.5 text-xs text-slate-300">{lvl.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Detalhes por módulo */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h4 className="flex items-center gap-2 text-sm font-bold text-white">
                <MessageSquare className="h-4 w-4 text-emerald-400" />
                Conversas: Modo Automático vs. Manual
              </h4>
              <ul className="mt-3 space-y-2 text-xs text-slate-300">
                <li>
                  • <strong>Switch por chat:</strong> alterne qualquer conversa entre <em>IA Automática</em> e <em>Manual (Humano)</em> com 1 clique.
                </li>
                <li>
                  • <strong>Assumir automaticamente:</strong> ao enviar uma mensagem manual pelo painel, a IA pausa naquele chat sozinha (configurável).
                </li>
                <li>
                  • <strong>Transferência inteligente:</strong> quando a <em>Condição de Parada</em> da regra é atingida, a IA avisa o cliente e muda o chat para Manual automaticamente.
                </li>
                <li>
                  • <strong>Resumo IA:</strong> clique em <em>Resumo IA</em> em qualquer chat (ou no Dashboard para o dia inteiro) para gerar um resumo executivo.
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h4 className="flex items-center gap-2 text-sm font-bold text-white">
                <Megaphone className="h-4 w-4 text-emerald-400" />
                Campanhas &amp; Fila Sequencial
              </h4>
              <ul className="mt-3 space-y-2 text-xs text-slate-300">
                <li>
                  • <strong>3 formas de importar:</strong> colar lista (<code>Nome, Número</code>), subir arquivo <code>.csv</code> ou adicionar manualmente.
                </li>
                <li>
                  • <strong>Variáveis dinâmicas:</strong> use <code>{'{{nome}}'}</code> (nome completo) ou <code>{'{{primeiro_nome}}'}</code> na mensagem inicial.
                </li>
                <li>
                  • <strong>Pós-resposta inteligente:</strong> defina se a IA assume a conversa automaticamente assim que o cliente responder, usando um fluxo específico.
                </li>
                <li>
                  • <strong>Controle total:</strong> pause, retome ou cancele em tempo real com contagem regressiva ao vivo do intervalo anti-ban.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* SEÇÃO 3: EXEMPLOS PRONTOS */}
      {section === 'examples' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {EXAMPLE_TEMPLATES.map((tpl) => (
            <div
              key={tpl.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                      {tpl.badge}
                    </span>
                    <h3 className="mt-2 text-base font-bold text-white">
                      {tpl.title}
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      {tpl.description}
                    </p>
                  </div>
                  <button
                    onClick={() => handleCopy(tpl.id, tpl.copyText)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
                  >
                    {copiedId === tpl.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copiar
                      </>
                    )}
                  </button>
                </div>

                <div className="mt-4 space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs">
                  {tpl.fields.map((f) => (
                    <div key={f.label}>
                      <p className="font-semibold text-emerald-300">{f.label}:</p>
                      <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-slate-300">
                        {f.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() =>
                    onNavigate(tpl.id === 'campanha' ? 'campaigns' : 'rules')
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  {tpl.id === 'campanha'
                    ? 'Testar em Campanhas'
                    : 'Criar em Fluxos & Personas IA'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SEÇÃO 4: FAQ */}
      {section === 'faq' && (
        <div className="space-y-3">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={item.q}
                className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70"
              >
                <button
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-white hover:bg-slate-800/40"
                >
                  <span>{item.q}</span>
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  )}
                </button>
                {isOpen && (
                  <div className="border-t border-slate-800/80 px-5 py-4 text-xs leading-relaxed text-slate-300">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* SEÇÃO 5: SOBRE A APLICAÇÃO */}
      {section === 'about' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 lg:col-span-7">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
                <Bot className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Sobre o ZapFlow AI</h3>
                <p className="text-xs text-slate-400">
                  Automação e Atendimento Inteligente para WhatsApp — 100% Gratuito &amp; Open-Source
                </p>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-slate-300">
              O <strong>ZapFlow AI</strong> foi projetado para permitir que pequenas empresas, profissionais autônomos e equipes automatizem atendimentos e campanhas no WhatsApp sem depender de APIs oficiais pagas por mensagem nem de assinaturas caras de SaaS.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                  <UserCheck className="h-4 w-4" />
                  Privacidade Multi-Usuário
                </p>
                <p className="mt-1.5 text-xs text-slate-400">
                  Autenticação com Google OAuth e e-mail/senha. Cada conta tem seu próprio WhatsApp, banco lógico, regras, logs e chave de IA — zero compartilhamento entre usuários.
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                  <ShieldCheck className="h-4 w-4" />
                  Resiliência &amp; Anti-Ban
                </p>
                <p className="mt-1.5 text-xs text-slate-400">
                  Retry automático + fallback em picos do Gemini, reconexão automática do Baileys e fila sequencial em SQLite com jitter e pausa por lotes.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 lg:col-span-5">
            <h3 className="text-sm font-bold text-white">Stack Tecnológica</h3>
            <div className="space-y-2.5 text-xs">
              {[
                ['Frontend', 'React 19 + Vite + TypeScript + Tailwind CSS'],
                ['Backend', 'Node.js + TypeScript + Express + Socket.io'],
                ['WhatsApp', '@whiskeysockets/baileys (sessão local leve)'],
                ['Banco de Dados', 'SQLite + Prisma ORM (persistência em Volume)'],
                ['Inteligência Artificial', 'Google Gemini Free Tier & Ollama Local'],
                ['Autenticação', 'Google Identity Services + Cookie HttpOnly'],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/50 px-3.5 py-2.5"
                >
                  <span className="font-semibold text-slate-400">{k}</span>
                  <span className="text-right text-slate-200">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
