import { WhatsAppStatus } from '../types';

interface Props {
  status: WhatsAppStatus;
  compact?: boolean;
}

const STATUS_META: Record<
  WhatsAppStatus,
  { label: string; dotClass: string; badgeClass: string }
> = {
  CONNECTED: {
    label: 'Conectado',
    dotClass: 'bg-emerald-400',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  DISCONNECTED: {
    label: 'Desconectado',
    dotClass: 'bg-rose-400',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  AWAITING_QR: {
    label: 'Aguardando QR Code',
    dotClass: 'bg-amber-400 animate-pulse',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  CAMPAIGN_RUNNING: {
    label: 'Disparando Campanha',
    dotClass: 'bg-violet-400 animate-ping',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
};

export function StatusBadge({ status, compact }: Props) {
  const meta = STATUS_META[status] || STATUS_META.DISCONNECTED;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border font-medium ${
        compact ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-xs'
      } ${meta.badgeClass}`}
    >
      <span className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </span>
  );
}
