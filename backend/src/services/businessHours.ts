import { UserSettings } from '@prisma/client';

export interface TimeInterval {
  start: string; // HH:MM
  end: string;   // HH:MM
}

export interface DaySchedule {
  enabled: boolean;
  intervals: TimeInterval[];
}

export type WeeklySchedule = Record<string, DaySchedule>;
export type BusinessHoursMode = 'ACTIVE_DURING_HOURS' | 'INVERSE_AFTER_HOURS';
export type OffHoursAction = 'PAUSE' | 'SEND_MESSAGE';

export interface BusinessHoursEvaluation {
  enabled: boolean;
  aiAllowedNow: boolean;
  isInsideConfiguredIntervals: boolean;
  mode: BusinessHoursMode;
  offHoursAction: OffHoursAction;
  offHoursMessage: string;
  offHoursCooldownMin: number;
  currentLocalTime: string;
  dayLabel: string;
  summary: string;
}

const DAY_LABELS: Record<number, string> = {
  0: 'Domingo',
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
};

const WEEKDAY_SHORT_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export const DEFAULT_WEEKLY_SCHEDULE: WeeklySchedule = {
  '0': { enabled: false, intervals: [] },
  '1': { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  '2': { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  '3': { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  '4': { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  '5': { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  '6': { enabled: false, intervals: [{ start: '09:00', end: '13:00' }] },
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTimeToMinutes(value: string): number | null {
  const m = String(value || '').trim().match(TIME_RE);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function sanitizeWeeklySchedule(raw: unknown): WeeklySchedule {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return structuredClone(DEFAULT_WEEKLY_SCHEDULE);
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  } else {
    return structuredClone(DEFAULT_WEEKLY_SCHEDULE);
  }

  const result: WeeklySchedule = {};
  for (let d = 0; d <= 6; d++) {
    const key = String(d);
    const dayRaw = obj[key] as Partial<DaySchedule> | undefined;
    const fallback = DEFAULT_WEEKLY_SCHEDULE[key];

    if (!dayRaw || typeof dayRaw !== 'object') {
      result[key] = structuredClone(fallback);
      continue;
    }

    const enabled = Boolean(dayRaw.enabled);
    const rawIntervals = Array.isArray(dayRaw.intervals)
      ? dayRaw.intervals
      : fallback.intervals;

    const cleanIntervals: TimeInterval[] = [];
    for (const iv of rawIntervals.slice(0, 6)) {
      if (!iv || typeof iv !== 'object') continue;
      const start = String((iv as TimeInterval).start || '').trim();
      const end = String((iv as TimeInterval).end || '').trim();
      if (parseTimeToMinutes(start) !== null && parseTimeToMinutes(end) !== null) {
        cleanIntervals.push({ start, end });
      }
    }

    result[key] = {
      enabled,
      intervals: cleanIntervals,
    };
  }
  return result;
}

function getLocalClock(timezone: string, now: Date): {
  dayIndex: number;
  minutesNow: number;
  timeText: string;
} {
  let tz = (timezone || 'America/Sao_Paulo').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(now);
  } catch {
    tz = 'America/Sao_Paulo';
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const weekdayStr = (
    parts.find((p) => p.type === 'weekday')?.value || 'Mon'
  )
    .slice(0, 3)
    .toLowerCase();
  const rawHour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');

  const dayIndex = WEEKDAY_SHORT_TO_INDEX[weekdayStr] ?? now.getUTCDay();
  const timeText = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return {
    dayIndex,
    minutesNow: hour * 60 + minute,
    timeText,
  };
}

function isMinuteInsideIntervals(
  minutesNow: number,
  intervals: TimeInterval[],
  prevDayIntervals: TimeInterval[]
): boolean {
  for (const iv of intervals) {
    const start = parseTimeToMinutes(iv.start);
    const end = parseTimeToMinutes(iv.end);
    if (start === null || end === null || start === end) continue;

    if (start < end) {
      // Intervalo normal no mesmo dia (ex: 08:00 - 18:00)
      if (minutesNow >= start && minutesNow < end) return true;
    } else {
      // Intervalo que vira a noite (ex: 22:00 - 06:00) — parte antes da meia-noite
      if (minutesNow >= start) return true;
    }
  }

  // Verifica se algum intervalo de ontem virou a noite e ainda está ativo hoje (ex: 22:00 - 06:00)
  for (const iv of prevDayIntervals) {
    const start = parseTimeToMinutes(iv.start);
    const end = parseTimeToMinutes(iv.end);
    if (start === null || end === null || start === end) continue;
    if (start > end && minutesNow < end) {
      return true;
    }
  }

  return false;
}

export function evaluateBusinessHours(
  settings: Pick<
    UserSettings,
    | 'businessHoursEnabled'
    | 'businessHoursTimezone'
    | 'businessHoursMode'
    | 'businessHoursScheduleJson'
    | 'offHoursAction'
    | 'offHoursMessage'
    | 'offHoursCooldownMin'
  > | null,
  now = new Date()
): BusinessHoursEvaluation {
  const tz = settings?.businessHoursTimezone || 'America/Sao_Paulo';
  const clock = getLocalClock(tz, now);
  const dayLabel = DAY_LABELS[clock.dayIndex] || 'Hoje';
  const mode: BusinessHoursMode =
    settings?.businessHoursMode === 'INVERSE_AFTER_HOURS'
      ? 'INVERSE_AFTER_HOURS'
      : 'ACTIVE_DURING_HOURS';
  const offHoursAction: OffHoursAction =
    settings?.offHoursAction === 'SEND_MESSAGE' ? 'SEND_MESSAGE' : 'PAUSE';
  const offHoursMessage =
    settings?.offHoursMessage ||
    'Olá {{primeiro_nome}}! No momento estamos fora do nosso horário de atendimento. Retornaremos assim que possível!';
  const offHoursCooldownMin = Math.max(
    1,
    Number(settings?.offHoursCooldownMin || 60)
  );

  if (!settings || !settings.businessHoursEnabled) {
    return {
      enabled: false,
      aiAllowedNow: true,
      isInsideConfiguredIntervals: true,
      mode,
      offHoursAction,
      offHoursMessage,
      offHoursCooldownMin,
      currentLocalTime: clock.timeText,
      dayLabel,
      summary: 'Funcionamento 24/7 (controle de horário desativado)',
    };
  }

  const schedule = sanitizeWeeklySchedule(settings.businessHoursScheduleJson);
  const todayCfg = schedule[String(clock.dayIndex)];
  const prevDayIdx = (clock.dayIndex + 6) % 7;
  const prevDayCfg = schedule[String(prevDayIdx)];

  const isInsideConfiguredIntervals = isMinuteInsideIntervals(
    clock.minutesNow,
    todayCfg?.enabled ? todayCfg.intervals : [],
    prevDayCfg?.enabled ? prevDayCfg.intervals : []
  );

  const aiAllowedNow =
    mode === 'INVERSE_AFTER_HOURS'
      ? !isInsideConfiguredIntervals
      : isInsideConfiguredIntervals;

  let summary: string;
  if (aiAllowedNow) {
    summary =
      mode === 'INVERSE_AFTER_HOURS'
        ? `Atendimento Inverso ATIVO agora (${dayLabel}, ${clock.timeText}) — fora do expediente humano, IA respondendo.`
        : `Dentro do horário de trabalho (${dayLabel}, ${clock.timeText}) — IA ativa normalmente.`;
  } else {
    const actionLabel =
      offHoursAction === 'SEND_MESSAGE'
        ? 'enviando mensagem específica'
        : 'IA pausada silenciosamente';
    summary =
      mode === 'INVERSE_AFTER_HOURS'
        ? `Expediente humano em andamento (${dayLabel}, ${clock.timeText}) — ${actionLabel}.`
        : `Fora do horário de trabalho (${dayLabel}, ${clock.timeText}) — ${actionLabel}.`;
  }

  return {
    enabled: true,
    aiAllowedNow,
    isInsideConfiguredIntervals,
    mode,
    offHoursAction,
    offHoursMessage,
    offHoursCooldownMin,
    currentLocalTime: clock.timeText,
    dayLabel,
    summary,
  };
}

export function renderOffHoursMessage(
  template: string,
  contactName: string | null | undefined
): string {
  const fullName = (contactName || '').trim() || 'tudo bem';
  const firstName = (contactName || '').trim().split(/\s+/)[0] || '';
  return template
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, firstName)
    .replace(/\{\{\s*nome\s*\}\}/gi, fullName)
    .replace(/\s+([,!?.])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
