# ZapFlow AI — Sistema de Automação e Atendimento Inteligente para WhatsApp (100% Gratuito)

Aplicação web full-stack 100% gratuita e open-source para automação de conversas, atendimento inteligente com IA e disparos em campanha com proteção anti-ban no WhatsApp (sem depender da API oficial paga da Meta).

## Stack Tecnológica
- **Backend:** Node.js + TypeScript + Express + Socket.io
- **WhatsApp:** `@whiskeysockets/baileys` (via QR Code / Aparelhos Conectados, com sessão local persistida)
- **Banco de Dados:** SQLite + Prisma ORM (zero custo de infraestrutura)
- **Inteligência Artificial (agnóstico):**
  - **Google Gemini API (Free Tier)** — ex: `gemini-2.5-flash`
  - **Ollama (Local)** — ex: `llama3.2`, `qwen2.5`, `gemma2`
- **Frontend:** React + Vite + TypeScript + Tailwind CSS + Lucide Icons

## Funcionalidades
- **Conexão via QR Code em tempo real** via WebSocket, persistência de sessão (`backend/auth_session`), reconexão automática e pausa global da IA.
- **Dashboard em tempo real:** métricas de conversas ativas, mensagens enviadas/recebidas hoje, fila pendente, status da IA, resumo executivo diário com IA e log de atividades ao vivo.
- **Gestão de Conversas:** alternância por chat entre **Modo Automático (IA)** e **Modo Manual (Humano)**, opção de assumir conversa automaticamente ao enviar mensagem manual, resumo individual com IA e atribuição de tags/fluxos.
- **Hierarquia de Regras e Personas da IA (3 níveis):**
  1. **Individual (por contato/número)** — prioridade máxima
  2. **Grupo / Tag** (Leads, Clientes VIP, Suporte, etc.)
  3. **Global (padrão)**
  - Cada regra define *Objetivo*, *Tom de voz*, *Base de conhecimento* e *Condição de parada* (transferência automática para humano).
- **Campanhas & Disparador Anti-Ban:**
  - Importação por colagem (`Nome, Número`), upload de CSV ou inserção manual.
  - Variáveis `{{nome}}` e `{{primeiro_nome}}` + variação natural por IA opcional.
  - Intervalo aleatório (jitter) padrão **45s–120s**, pausa em lote de **5 min a cada 20 mensagens**, simulação de `"digitando..."` por **3 a 7 segundos** e fila sequencial estrita em SQLite.
  - Opção de ativar a IA automaticamente quando o contato responder à campanha usando um fluxo específico.

## Como Rodar Localmente

1. **Instale as dependências** (na raiz do projeto):
```bash
npm run install:all
```

2. **Configure as variáveis de ambiente:**
Copie `.env.example` para `backend/.env` (ou configure diretamente pelo painel em **Configurações IA**):
```bash
cp .env.example backend/.env
```
- Para usar **Google Gemini Free Tier**, gere uma chave gratuita em https://aistudio.google.com/apikey e preencha `GEMINI_API_KEY`.
- Para usar **Ollama Local**, instale em https://ollama.com, baixe um modelo (`ollama pull llama3.2`) e selecione **Ollama** em Configurações.

3. **Crie/atualize o banco SQLite:**
```bash
npm run db:setup
```

4. **Inicie o Backend e o Frontend** (em dois terminais separados):
```bash
# Terminal 1 — Backend (porta 3001)
npm run dev:backend

# Terminal 2 — Frontend (porta 5173)
npm run dev:frontend
```

5. Acesse `http://localhost:5173`, clique em **Conectar via QR Code** e escaneie pelo WhatsApp em **Aparelhos Conectados**.
