export interface ParsedChatMessage {
  sender: string;
  body: string;
  timestamp: string | null;
}

export interface ParsedChatResult {
  messages: ParsedChatMessage[];
  speakers: string[];
}

const SYSTEM_MESSAGE_PATTERNS = [
  /as mensagens e (as )?chamadas são protegidas com criptografia/i,
  /messages and calls are end-to-end encrypted/i,
  /você criou o grupo/i,
  /mudou o código de segurança/i,
  /security code changed/i,
];

function parseDateParts(
  d1: number,
  d2: number,
  yearRaw: number,
  hoursRaw: number,
  minutes: number,
  seconds: number,
  ampm?: string
): string | null {
  let year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  let day = d1;
  let month = d2;

  // Se o segundo número > 12, formato era MM/DD/YYYY
  if (d2 > 12 && d1 <= 12) {
    month = d1;
    day = d2;
  }

  let hours = hoursRaw;
  if (ampm) {
    const upper = ampm.toUpperCase();
    if (upper === 'PM' && hours < 12) hours += 12;
    if (upper === 'AM' && hours === 12) hours = 0;
  }

  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Faz o parse de exportações oficiais do WhatsApp (Android e iOS, PT-BR e EN)
 * e também de conversas coladas manualmente no formato "Nome: mensagem".
 */
export function parseWhatsAppExport(rawInput: string): ParsedChatResult {
  // Remove BOM e marcadores invisíveis LTR/RTL que o WhatsApp insere no iOS/Android
  const cleaned = rawInput
    .replace(/^\uFEFF/, '')
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '');

  const lines = cleaned.split(/\r?\n/);

  // Android: "25/11/2026 14:32 - João: Olá" ou "25/11/2026, 14:32 - João: Olá"
  const androidRegex =
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?\s*[-–]\s*([^:]+?):\s*(.*)$/;

  // iOS: "[25/11/2026, 14:32:10] João: Olá" ou "[25/11/2026 14:32] João: Olá"
  const iosRegex =
    /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?\]\s*([^:]+?):\s*(.*)$/;

  // Linha de aviso do sistema com data mas sem "Remetente:"
  const systemTimestampRegex =
    /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?\]?\s*[-–]?\s*([^:]+)$/;

  // Formato simples colado: "João: Olá" ou "Cliente: Quanto custa?"
  const simpleSpeakerRegex = /^([A-Za-zÀ-ÿ0-9 _().+-]{1,40}):\s+(.+)$/;

  const messages: ParsedChatMessage[] = [];
  let hasTimestamps = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const mAndroid = line.match(androidRegex);
    const mIos = !mAndroid ? line.match(iosRegex) : null;
    const match = mAndroid || mIos;

    if (match) {
      hasTimestamps = true;
      const [, d1, d2, yr, hr, min, sec, ampm, senderRaw, bodyRaw] = match;
      const sender = senderRaw.trim();
      const body = bodyRaw.trim();

      if (SYSTEM_MESSAGE_PATTERNS.some((p) => p.test(body))) {
        continue;
      }

      const timestamp = parseDateParts(
        Number(d1),
        Number(d2),
        Number(yr),
        Number(hr),
        Number(min),
        sec ? Number(sec) : 0,
        ampm
      );

      messages.push({ sender, body, timestamp });
      continue;
    }

    if (hasTimestamps && systemTimestampRegex.test(line)) {
      // Aviso do sistema com data (ex: criptografia / mudou número)
      continue;
    }

    if (!hasTimestamps) {
      const mSimple = line.match(simpleSpeakerRegex);
      if (mSimple) {
        const sender = mSimple[1].trim();
        const body = mSimple[2].trim();
        if (!SYSTEM_MESSAGE_PATTERNS.some((p) => p.test(body))) {
          messages.push({ sender, body, timestamp: null });
        }
        continue;
      }
    }

    // Continuação de mensagem multilinha
    if (messages.length > 0) {
      messages[messages.length - 1].body += `\n${line}`;
    }
  }

  const speakerCounts = new Map<string, number>();
  for (const m of messages) {
    speakerCounts.set(m.sender, (speakerCounts.get(m.sender) || 0) + 1);
  }

  const speakers = Array.from(speakerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  return { messages, speakers };
}
