export type WhatsAppConnectionStatus =
  | 'DISCONNECTED'
  | 'AWAITING_QR'
  | 'CONNECTED'
  | 'CAMPAIGN_RUNNING';

export type LogLevel = 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
export type LogCategory = 'WHATSAPP' | 'AI' | 'CAMPAIGN' | 'SYSTEM';

export interface WhatsAppStatePayload {
  status: WhatsAppConnectionStatus;
  connectedPhone: string | null;
  connectedName: string | null;
  qrDataUrl: string | null;
  globalAutomationPaused: boolean;
  hasSavedSession: boolean;
  lastError: string | null;
}

export interface CampaignRuntimeState {
  activeCampaignId: string | null;
  activeCampaignName: string | null;
  phase: 'IDLE' | 'SENDING' | 'JITTER_DELAY' | 'BATCH_PAUSE' | 'WAITING_CONNECTION';
  nextSendAt: string | null;
  currentContactName: string | null;
  batchSentCounter: number;
}
