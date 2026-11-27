# ZapFlow AI — Sistema de Automação e Atendimento Inteligente para WhatsApp (100% Gratuito)

Aplicação web full-stack **multi-usuário**, **100% gratuita e open-source**, para automação de conversas no WhatsApp com Inteligência Artificial, leitura de imagens, treinamento contínuo por histórico e disparos em campanha com proteção anti-ban — **sem depender da API oficial paga da Meta**.

---

## Stack Tecnológica

| Camada | Tecnologias |
|---|---|
| **Frontend** | React 19, Vite, TypeScript, Tailwind CSS v4, Lucide Icons, Socket.io Client |
| **Backend** | Node.js, TypeScript, Express, Socket.io, Multer |
| **Conexão WhatsApp** | `@whiskeysockets/baileys` (QR Code / Aparelhos Conectados, leve, sem navegador headless) |
| **Banco de Dados** | SQLite + Prisma ORM (persistência local ou em Volume no Railway, custo zero) |
| **Inteligência Artificial** | Provedor agnóstico: **Google Gemini API (Free Tier)** (`gemini-3.8-flash` / `*-flash-lite` com retry + fallback) e **Ollama (Local)** |
| **Autenticação** | **Google Identity Services (OAuth 2.0)** + **E-mail/Senha** (`scrypt` com salt) + Cookie `HttpOnly` HMAC-SHA256 |
| **Deploy / Produção** | Docker multi-stage (`Dockerfile` + `railway.json`) servindo Backend + Frontend + WebSocket em um único serviço |

---

## Funcionalidades Implementadas

### 1. Landing Page Inicial, Autenticação e Isolamento Multi-Usuário
- **Landing Page inicial (`LandingPage.tsx`):** tela de apresentação pública para visitantes não logados com visão geral da aplicação, simulação interativa de **4 exemplos reais de uso** (*Vendas & Leads*, *E-commerce & Pix*, *Clínicas & Áudios* e *Suporte 24h*), passo a passo de início rápido e botões diretos para **Entrar** ou **Criar Conta Grátis**.
- Login com **Google (OAuth)** e **E-mail/Senha** (com criação de conta).
- Sessões assinadas em cookie `HttpOnly` (`SameSite=Lax`, `Secure` em produção).
- Middleware `requireAuth` em todas as rotas `/api/*` e autenticação no handshake do **Socket.io** com salas privadas por usuário (`user:<userId>`).
- **Isolamento total por conta:** cada usuário possui sua própria sessão do WhatsApp (`auth_session/<userId>`), sua própria chave de IA (`UserSettings`), contatos, tags, conversas, regras/personas, exemplos de treinamento, campanhas, métricas de consumo e logs.
- **Guia Teleguiado de Primeiro Acesso (`OnboardingWizard` + tela de Login):** na tela de login já exibe um guia rápido com link direto para gerar a API Key gratuita no Google AI Studio e instruções de conexão do WhatsApp (Android/iPhone); ao entrar pela primeira vez sem IA ou WhatsApp configurados, abre automaticamente um assistente interativo em 3 etapas onde o usuário cola/testa sua chave Gemini e escaneia o QR Code ao vivo (reabrível a qualquer momento pelo botão *Guia Teleguiado*).
- **Migração automática de legado:** caso exista um backup single-tenant (`dev.db.legacy.bak`) e sessão antiga na raiz de `auth_session/`, o serviço `legacyMigration.ts` importa tudo automaticamente para a conta definida em `OWNER_EMAIL`.

### 2. Conexão WhatsApp & Painel de Controle (Dashboard)
- Geração e exibição do **QR Code em tempo real** via WebSocket.
- Persistência de sessão local por usuário e reconexão automática com backoff em quedas de rede.
- Controles de **Conectar**, **Pausar/Retomar Automação Global**, **Desconectar** e **Limpar Sessão**.
- Indicador visual de status: `Conectado`, `Desconectado`, `Aguardando QR Code`, `Disparando Campanha`.
- Métricas ao vivo (conversas ativas, enviadas/recebidas hoje, fila pendente, saúde do motor de IA), **Resumo Executivo do Dia com IA** e **Log de Atividades em Tempo Real**.

### 3. Gestão de Conversas + Importação de Histórico Antigo
- Interface estilo chat em tempo real com alternância por conversa entre **Modo Automático (IA)** e **Modo Manual (Humano)**, além de **botão Responder com IA** em 1 clique e **Fila de Pendência de Respostas da IA** acima das conversas exibindo ao vivo os estados `Na fila → Processando IA → Respondendo → Respondido`.
- **Continuidade inteligente (últimos 20 min) e bloqueio de saudações repetidas no mesmo dia:** antes de responder, a IA analisa todo o andamento dos últimos 20 minutos (com horários de Brasília) e identifica automaticamente se já foi enviada mensagem no dia — evitando repetir *"Olá / Bom dia"* a cada interação.
- **Alertas visuais amarelos clicáveis no Painel de Controle:** quando a condição de parada redireciona um cliente para atendimento humano (`needsHumanAttention`), o Painel exibe um banner amarelo destacado e clicável que abre diretamente a conversa (resolvido automaticamente ao responder ou pelo botão *Marcar atendido*).
- Envio manual direto pelo painel com opção configurável de **Assumir Conversa automaticamente** (pausa a IA naquele chat ao enviar uma resposta humana).
- **Resumo individual com IA**, atribuição de Tags/Grupos e seleção de fluxo específico por chat.
- **Importação de conversas anteriores (botão Importar):** suporta upload de arquivo `.txt` exportado oficialmente do WhatsApp (Android e iOS, PT-BR e EN) ou texto colado (`Nome: mensagem`), com detecção automática de participantes para identificar quem é o atendente e preservação de datas/horários originais.

### 4. Fluxos e Personas da IA (Hierarquia em 4 Níveis)
1. **Individual (por contato/número)** — sobrescreve todas as demais regras.
2. **Fluxo de Campanha** — atribuído automaticamente quando o lead responde a um disparo.
3. **Grupo / Tag de Contatos** — ex.: *Leads*, *Clientes VIP*, *Suporte*.
4. **Global (Padrão)** — aplicado quando não há regra mais específica.
- Cada regra define: *Objetivo da conversa*, *Tom de voz*, *Base de conhecimento*, *Condição de parada* (ao ser atingida, a IA retorna o marcador interno `[TRANSFERIR_HUMANO]`, que é removido da mensagem, transfere o chat para modo **Manual** e registra alerta no log) e sobrescritas opcionais de **Tonalidade, Flexibilidade de Treinamento, Tamanho e Emojis** por Tag/Fluxo/Contato (ou herança automática das Configurações de IA).
- **Horário de Trabalho, Pausas Programadas & Atendimento Inverso (`businessHours.ts`):** em **Configurações IA**, cada usuário pode desativar o funcionamento 24/7 e configurar grade semanal com múltiplos intervalos por dia (ex: pausa de almoço), fuso horário (`America/Sao_Paulo` padrão), modo **Horário Comercial** (IA ativa dentro do expediente) ou **Atendimento Inverso / Plantão** (IA ativa fora do expediente humano), escolhendo entre **pausar silenciosamente** ou **enviar mensagem específica** (com `{{primeiro_nome}}`, modelos de Horário/NOC e cooldown anti-repetição).
- **Estilo, Tonalidade e Flexibilidade das Respostas (Geral e por Tag/Fluxo):** em **Configurações IA**, o usuário define o padrão geral da conta — 6 tonalidades (*Consultivo, Descontraído, Formal, Direto, Empático, Comercial/Persuasivo*), 3 níveis de **Flexibilidade nos Exemplos de Treinamento** (*Fiel aos exemplos*, *Equilibrado* e *Flexível e natural*, ajustando instruções e `temperature` para variar a redação mantendo 100% da assertividade das informações), tamanho da mensagem, uso de emojis e diretriz global extra — com sobrescrita opcional em cada regra de Tag/Fluxo/Contato.

### 5. Módulos Multimodais: Leitura de Imagens e Transcrição de Áudios (Ativáveis por Usuário)
- **Leitura de Imagens (Visão IA):** ativação opcional em **Configurações IA**. Usa modelos multimodais **Gemini (Flash / Flash-Lite)** no Free Tier ou **Ollama multimodal** (`llama3.2-vision`, `gemma3`, `llava`), com prompt customizável e testador por upload. Ao receber foto (até 6MB), exibe o card **"Leitura da Imagem (IA)"** na bolha do chat e passa o conteúdo para a IA responder.
- **Transcrição e Interpretação de Áudios (Áudio IA):** ativação opcional em **Configurações IA**. Baixa mensagens de voz/áudios do WhatsApp (`audio/ogg` Opus, MP3, M4A, WAV até 10MB) via Baileys e transcreve nativamente com **Gemini Flash / Flash-Lite** no Free Tier (sem Whisper externo nem FFmpeg), exibindo o card **"Transcrição do Áudio (IA)"** no chat e alimentando automaticamente respostas da IA, resumos e treinamentos.
- **Seleção em Massa nas Conversas:** botão **Selecionar Conversas** (`PATCH /api/conversations/bulk-mode`) para aplicar **Ativar IA** ou **Modo Manual** em múltiplas conversas de uma vez.

### 6. Tela Dedicada de Treinamento da IA (`Treinamento IA`)
- **Simulador & Treino ao Vivo:** converse diretamente com a persona escolhida sem enviar nada para o WhatsApp real; aprove respostas corretas ou corrija respostas da IA com 1 clique.
- **Aprender de Conversas Reais (ou `.txt` importados):** a IA analisa históricos reais (incluindo respostas humanas) e extrai automaticamente sugestões de exemplos (*Few-Shot*) e adições para a Base de Conhecimento da regra (incorporáveis com 1 clique).
- **Base de Exemplos Treinados (Importação/Exportação em Lote + Caracterizador IA):** gerenciamento completo (criar manual, ativar/pausar, excluir), download de **modelo pronto (CSV para Excel e JSON)**, **exportação dos roteiros existentes** (`.csv` e `.json`), **importação em massa** (`/api/training/examples/import`) com opção de **Manter existentes** ou **Sobrescrever todos os exemplos**, e **Caracterizador automático com IA** (`/api/training/examples/categorize`) que classifica os roteiros em assuntos padronizados e `#palavras-chave` para busca e filtragem instantânea por tema. Todos os exemplos ativos são injetados automaticamente no prompt antes de cada resposta real.

### 7. Disparador para Lista de Contatos (Campanhas Anti-Ban)
- Importação de contatos via **colagem (`Nome, Número`)**, **upload de CSV** ou **inserção manual**.
- Variáveis `{{nome}}` e `{{primeiro_nome}}` + **variação natural por IA** opcional para evitar textos idênticos.
- Opção para a **IA assumir automaticamente** quando o contato responder, usando um fluxo específico.
- **Proteção Anti-Bloqueio integrada (fila sequencial estrita em SQLite):**
  - Intervalo aleatório (jitter) configurável — padrão recomendado: **45s a 120s**.
  - Pausa automática em lotes — padrão recomendado: **5 minutos a cada 20 mensagens**.
  - Simulação de status `"digitando..."` (`composing`) por **3 a 7 segundos** antes de cada envio.
  - Barra de progresso, contadores (pendentes, enviados, erros) e contagem regressiva ao vivo.

### 8. Medidor de Uso da IA em Tempo Real & Responsividade
- Registro real de requisições e tokens (`AiUsageLog`) a partir do `usageMetadata` (Gemini) e `prompt_eval_count`/`eval_count` (Ollama).
- Barra de **Uso da IA (Hoje / Mês)** em tempo real via WebSocket acima do perfil no menu lateral (com limite diário configurável em Configurações IA).
- Menu lateral com rolagem vertical em zoom elevado, cabeçalho responsivo com **avatar clicável + dropdown da conta** em celular/zoom > 125%, **ícone/favicon oficial SVG** (`ZapFlow AI`) e tela completa de **Manual & Sobre** com templates prontos para copiar e FAQ.

### 9. Painel Administrativo, Permissões por Módulo & Gestão de Licenças (`Administração`)
- Disponível exclusivamente para contas `ADMIN` / `isOwner` (definida automaticamente via `OWNER_EMAIL`).
- **Controle de Usuários:** criar, editar, promover/rebaixar Admin, aprovar, suspender (desconectando o WhatsApp imediatamente) ou excluir contas, além de redefinir senha e registrar observações internas.
- **Permissões Granulares por Módulo (Front + Back protegidos por `requireModule`):** libera ou bloqueia individualmente *Conversas*, *Fluxos & Personas*, *Treinamento IA*, *Campanhas*, *Visão IA (Imagens)* e *Áudio IA (Transcrição)*.
- **Indicadores Globais:** usuários ativos/suspensos/vencidos, WhatsApps conectados ao vivo, mensagens hoje/mês e consumo real de requisições e tokens de IA por usuário.
- **Licenças & Política Global (`SystemConfig`):** gestão de **Plano** (`FREE`, `TRIAL`, `PRO`, `ENTERPRISE`), **Status da Licença** (`ACTIVE`, `TRIAL`, `EXPIRED`, `SUSPENDED`), **Validade** (atalhos `+30d`, `+90d`, `+1 ano`, `Sem validade`), limite diário de IA e opção de novos cadastros entrarem já ativos (padrão) ou aguardando aprovação.

---

## Estrutura do Projeto (Monorepo)

```text
whatsapp-ai-automation/
├── .env.example                 # Variáveis de ambiente documentadas
├── Dockerfile                   # Build multi-stage (Frontend + Backend + Prisma + SQLite)
├── railway.json                 # Configuração de deploy e healthcheck (/api/health) no Railway
├── package.json                 # Scripts unificados do monorepo
├── backend/
│   ├── prisma/schema.prisma     # User, UserSettings, Contact, Tag, Conversation, Message, AiRule, AiTrainingExample, Campaign, CampaignItem, ActivityLog, AiUsageLog
│   └── src/
│       ├── index.ts             # Express + Socket.io autenticado + static frontend em produção
│       ├── config.ts            # Leitura de variáveis de ambiente
│       ├── db.ts                # PrismaClient + recovery + provisionamento por usuário
│       ├── services/
│       │   ├── authService.ts       # Google OAuth ID Token, scrypt, cookies HttpOnly, middleware requireAuth
│       │   ├── whatsappService.ts   # WhatsAppManager multi-usuário (@whiskeysockets/baileys + mídia/visão)
│       │   ├── aiService.ts         # Gemini (retry/fallback/visão) + Ollama + hierarquia + treinamento + uso real
│       │   ├── campaignQueue.ts     # CampaignQueueManager sequencial anti-ban por usuário
│       │   ├── chatImportParser.ts  # Parser de exportação WhatsApp (.txt Android/iOS e texto colado)
│       │   ├── legacyMigration.ts   # Migração automática de backup single-tenant -> conta owner
│       │   └── activityLog.ts       # Logs persistidos e emitidos por sala privada Socket.io
│       └── routes/
│           ├── auth.ts              # /api/auth/* (config, me, register, login, google, logout)
│           ├── whatsapp.ts          # /api/whatsapp/* (status, connect, disconnect, pause-global)
│           ├── dashboard.ts         # /api/dashboard/* (overview, logs, daily-summary, ai-usage)
│           ├── conversations.ts     # /api/conversations/* (CRUD, send, mode, summary, import-preview, import)
│           ├── rules.ts             # /api/rules/* (Regras 3 níveis + Tags)
│           ├── training.ts          # /api/training/* (exemplos, simulador, análise real/.txt, apply-knowledge)
│           ├── campaigns.ts         # /api/campaigns/* (parse CSV/texto, CRUD, start/pause/cancel)
│           └── settings.ts          # /api/settings/* (config IA/Visão/Anti-Ban, test-ai, test-vision, gemini-models)
└── frontend/
    ├── public/favicon.svg       # Ícone vetorial oficial ZapFlow AI
    ├── index.html
    └── src/
        ├── App.tsx              # Controle de sessão, Socket.io pós-login e roteamento das telas
        ├── components/          # Sidebar (scroll, barra uso IA, avatar dropdown mobile), StatusBadge
        └── pages/               # LandingPage, AuthPage, DashboardPage, ConversationsPage, RulesPage, TrainingPage, CampaignsPage, SettingsPage, GuidePage
```

---

## Como Rodar Localmente

1. **Instale as dependências (na raiz):**
```bash
npm run install:all
```

2. **Configure as variáveis de ambiente:**
Copie `.env.example` para `backend/.env`:
```bash
cp .env.example backend/.env
```
- **Google Gemini (Free Tier):** gere sua chave gratuita em https://aistudio.google.com/apikey e configure em `GEMINI_API_KEY` (ou direto na tela **Configurações IA**).
- **Google Login (opcional):** crie um ID do Cliente OAuth Web no Google Cloud Console (adicionando `http://localhost:5173` em origens JS autorizadas) e informe `GOOGLE_CLIENT_ID`. Sem ele, o login por **E-mail e Senha** já funciona normalmente.
- **Ollama Local (opcional):** instale em https://ollama.com, baixe um modelo (`ollama pull llama3.2`) e selecione **Ollama** em Configurações IA.

3. **Crie/sincronize o banco SQLite:**
```bash
npm run db:setup
```

4. **Execute Backend e Frontend (em 2 terminais):**
```bash
# Terminal 1 — Backend (http://localhost:3001)
npm run dev:backend

# Terminal 2 — Frontend (http://localhost:5173)
npm run dev:frontend
```

5. Acesse `http://localhost:5173`, crie sua conta (ou entre com Google), configure sua IA e conecte seu WhatsApp via QR Code.

---

## Deploy no Railway (Serviço Único com Volume Persistente)

O projeto já inclui `Dockerfile` multi-stage e `railway.json` prontos para deploy automático a partir do GitHub:

1. Conecte o repositório no Railway — ele detectará `railway.json` e `Dockerfile`, compilando frontend + backend em um único serviço com healthcheck em `/api/health`.
2. **Adicione um Volume Persistente** montado em `/app/data` (essencial para manter `dev.db`, `.session_secret` e `auth_session/<userId>` entre redeploys).
3. Configure as variáveis de ambiente no serviço:
   - `NODE_ENV=production`
   - `PORT=3001`
   - `DATABASE_URL=file:/app/data/dev.db`
   - `WHATSAPP_SESSION_DIR=/app/data/auth_session`
   - `GOOGLE_CLIENT_ID=<seu-client-id-oauth-web>` *(adicione seu domínio `https://...up.railway.app` nas Origens JS Autorizadas do Google Cloud)*
   - `OWNER_EMAIL=<seu-email>` *(opcional: herda `GEMINI_API_KEY` inicial)*
   - `GEMINI_API_KEY=<sua-chave>` *(opcional: demais usuários configuram a própria chave no painel)*
   - `GEMINI_MODEL=gemini-3.8-flash`
4. Gere o domínio público no Railway (`Settings → Networking → Generate Domain`, porta `3001`).

---

## Recomendações Anti-Bloqueio no WhatsApp
- **Intervalo aleatório (jitter):** sempre entre **45s e 120s** (nunca fixo).
- **Pausa em lotes:** **5 a 10 minutos** a cada **15–20 disparos**.
- **Aquecimento diário:** chips novos **20–30 disparos/dia** na 1ª semana; chips antigos abaixo de **80–100 disparos/dia**.
- **Variação natural:** mantenha ativa a variação por IA nas campanhas e a simulação de `"digitando..."` (3–7s).
