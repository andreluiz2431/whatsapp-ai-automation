export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isOwner: boolean;
}

export type WhatsAppStatus =
  | 'DISCONNECTED'
  | 'AWAITING_QR'
  | 'CONNECTED'
  | 'CAMPAIGN_RUNNING';

export interface WhatsAppState {
  status: WhatsAppStatus;
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

export interface AiHealth {
  provider: 'gemini' | 'ollama';
  model: string;
  ready: boolean;
  details: string;
}

export interface AiUsageSummary {
  requestsToday: number;
  dailyRequestLimit: number;
  inputTokensToday: number;
  outputTokensToday: number;
  totalTokensToday: number;
  visionToday: number;
  audioToday: number;
  requestsMonth: number;
  totalTokensMonth: number;
  provider: 'gemini' | 'ollama';
  model: string;
}

export interface ActivityLogEntry {
  id: string;
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  category: 'WHATSAPP' | 'AI' | 'CAMPAIGN' | 'SYSTEM';
  message: string;
  metadata?: string | null;
  createdAt: string;
}

export interface DashboardOverview {
  metrics: {
    activeConversations: number;
    autoConversations: number;
    messagesSentToday: number;
    messagesReceivedToday: number;
    pendingQueueCount: number;
  };
  aiHealth: AiHealth;
  campaignRuntime: CampaignRuntimeState;
  dailySummary: {
    text: string | null;
    updatedAt: string | null;
  };
  logs: ActivityLogEntry[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  _count?: { contacts: number };
}

export interface Contact {
  id: string;
  phone: string;
  jid: string;
  name: string | null;
  notes: string | null;
  tags?: Array<{ tag: Tag }>;
}

export interface AiRule {
  id: string;
  name: string;
  scope: 'GLOBAL' | 'TAG' | 'CONTACT';
  isActive: boolean;
  tagId: string | null;
  tag?: Tag | null;
  contactId: string | null;
  contact?: Contact | null;
  objective: string;
  toneOfVoice: string;
  knowledgeBase: string;
  stopCondition: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  contactId: string;
  contact: Contact;
  mode: 'AUTO' | 'MANUAL';
  activeRuleId: string | null;
  activeRule?: AiRule | null;
  resolvedRule?: {
    id: string;
    name: string;
    scope: string;
    levelLabel: string;
  } | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
  aiSummary: string | null;
  aiSummaryUpdatedAt: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CONTACT' | 'AI' | 'HUMAN' | 'CAMPAIGN';
  body: string;
  mediaType?: string | null;
  imageAnalysis?: string | null;
  audioTranscript?: string | null;
  status: string;
  createdAt: string;
}

export interface AiTrainingExample {
  id: string;
  ruleId: string | null;
  rule?: { id: string; name: string; scope: string } | null;
  customerMessage: string;
  idealResponse: string;
  feedbackNote: string | null;
  source: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingExtractionResult {
  suggestedExamples: Array<{
    customerMessage: string;
    idealResponse: string;
    feedbackNote: string;
  }>;
  knowledgeAdditions: string;
  promptTips: string;
}

export interface CampaignItem {
  id: string;
  name: string;
  phone: string;
  resolvedMessage: string | null;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  errorMessage: string | null;
  sentAt: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  messageTemplate: string;
  useAiVariation: boolean;
  autoEnableAiOnReply: boolean;
  aiRuleId: string | null;
  aiRule?: { id: string; name: string; scope: string } | null;
  minDelaySec: number;
  maxDelaySec: number;
  batchSize: number;
  batchPauseMin: number;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  totalCount: number;
  sentCount: number;
  failedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  items?: CampaignItem[];
}

export interface AppSettings {
  id: string;
  userId?: string;
  aiProvider: 'gemini' | 'ollama';
  geminiApiKey: string;
  geminiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  globalAutomationPaused: boolean;
  autoPauseOnManualSend: boolean;
  autoSummarizeConversations: boolean;
  enableImageReading: boolean;
  geminiVisionModel: string;
  imageAnalysisPrompt: string;
  enableAudioTranscription: boolean;
  geminiAudioModel: string;
  audioTranscriptionPrompt: string;
  dailyAiRequestLimit: number;
  defaultMinDelaySec: number;
  defaultMaxDelaySec: number;
  defaultBatchSize: number;
  defaultBatchPauseMin: number;
}
