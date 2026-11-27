import { useCallback, useEffect, useState } from 'react';
import { OnboardingWizard } from './components/OnboardingWizard';
import { NavTab, Sidebar } from './components/Sidebar';
import { api } from './lib/api';
import { socket } from './lib/socket';
import { AuthPage } from './pages/AuthPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { ConversationsPage } from './pages/ConversationsPage';
import { DashboardPage } from './pages/DashboardPage';
import { GuidePage } from './pages/GuidePage';
import { LandingPage } from './pages/LandingPage';
import { RulesPage } from './pages/RulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TrainingPage } from './pages/TrainingPage';
import {
  AiHealth,
  AiUsageSummary,
  AuthUser,
  CampaignRuntimeState,
  Conversation,
  WhatsAppState,
} from './types';

const INITIAL_WA_STATE: WhatsAppState = {
  status: 'DISCONNECTED',
  connectedPhone: null,
  connectedName: null,
  qrDataUrl: null,
  globalAutomationPaused: false,
  hasSavedSession: false,
  lastError: null,
};

const INITIAL_RUNTIME: CampaignRuntimeState = {
  activeCampaignId: null,
  activeCampaignName: null,
  phase: 'IDLE',
  nextSendAt: null,
  currentContactName: null,
  batchSentCounter: 0,
};

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [publicView, setPublicView] = useState<'landing' | 'auth'>('landing');
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>(
    'login'
  );
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [waState, setWaState] = useState<WhatsAppState>(INITIAL_WA_STATE);
  const [campaignRuntime, setCampaignRuntime] =
    useState<CampaignRuntimeState>(INITIAL_RUNTIME);
  const [aiUsage, setAiUsage] = useState<AiUsageSummary | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [focusConversationId, setFocusConversationId] = useState<string | null>(
    null
  );

  const refreshUnread = useCallback(async () => {
    try {
      const convs = await api.get<Conversation[]>('/conversations');
      setUnreadTotal(convs.reduce((acc, c) => acc + (c.unreadCount || 0), 0));
    } catch {
      // ignora erro temporário
    }
  }, []);

  useEffect(() => {
    api
      .get<{ user: AuthUser | null }>('/auth/me')
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!user) {
      socket.disconnect();
      setWaState(INITIAL_WA_STATE);
      setCampaignRuntime(INITIAL_RUNTIME);
      setAiUsage(null);
      setAiReady(false);
      setShowOnboarding(false);
      setUnreadTotal(0);
      return;
    }

    socket.connect();

    Promise.all([
      api.get<WhatsAppState>('/whatsapp/status').catch(() => INITIAL_WA_STATE),
      api
        .get<{ aiHealth: AiHealth }>('/settings')
        .then((r) => Boolean(r.aiHealth?.ready))
        .catch(() => false),
    ]).then(([statusData, isAiReady]) => {
      setWaState(statusData);
      setAiReady(isAiReady);

      const doneKey = `zapflow_onboarding_done_${user.id}`;
      const alreadyDismissed = localStorage.getItem(doneKey) === '1';
      const waNotReady =
        statusData.status === 'DISCONNECTED' && !statusData.hasSavedSession;
      if (!alreadyDismissed && (!isAiReady || waNotReady)) {
        setShowOnboarding(true);
      }
    });

    api
      .get<AiUsageSummary>('/dashboard/ai-usage')
      .then(setAiUsage)
      .catch(() => {});
    void refreshUnread();

    const onStatus = (state: WhatsAppState) => setWaState(state);
    const onQr = ({ qrDataUrl }: { qrDataUrl: string | null }) =>
      setWaState((prev) => ({ ...prev, qrDataUrl }));
    const onRuntime = (rt: CampaignRuntimeState) => setCampaignRuntime(rt);
    const onAiUsage = (usage: AiUsageSummary) => setAiUsage(usage);
    const onConvUpdated = () => void refreshUnread();

    socket.on('whatsapp:status', onStatus);
    socket.on('whatsapp:qr', onQr);
    socket.on('campaign:runtime', onRuntime);
    socket.on('ai:usage', onAiUsage);
    socket.on('conversation:updated', onConvUpdated);

    return () => {
      socket.off('whatsapp:status', onStatus);
      socket.off('whatsapp:qr', onQr);
      socket.off('campaign:runtime', onRuntime);
      socket.off('ai:usage', onAiUsage);
      socket.off('conversation:updated', onConvUpdated);
      socket.disconnect();
    };
  }, [user, refreshUnread]);

  const handleToggleGlobalPause = async () => {
    try {
      const res = await api.post<{ state: WhatsAppState }>(
        '/whatsapp/pause-global',
        { paused: !waState.globalAutomationPaused }
      );
      setWaState(res.state);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao alternar pausa global');
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignora
    }
    socket.disconnect();
    setUser(null);
    setPublicView('landing');
    setActiveTab('dashboard');
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Verificando sessão...
      </div>
    );
  }

  if (!user) {
    if (publicView === 'landing') {
      return (
        <LandingPage
          onGoToAuth={(mode) => {
            setAuthInitialMode(mode);
            setPublicView('auth');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      );
    }
    return (
      <AuthPage
        initialMode={authInitialMode}
        onAuthenticated={setUser}
        onBackToLanding={() => {
          setPublicView('landing');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 lg:h-screen lg:flex-row lg:overflow-hidden">
      <Sidebar
        user={user}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        waState={waState}
        aiUsage={aiUsage}
        unreadTotal={unreadTotal}
        onToggleGlobalPause={handleToggleGlobalPause}
        onLogout={handleLogout}
      />

      <main className="flex-1 overflow-y-auto p-4 lg:p-6">
        {activeTab === 'dashboard' && (
          <DashboardPage
            waState={waState}
            campaignRuntime={campaignRuntime}
            onToggleGlobalPause={handleToggleGlobalPause}
            onGoToSettings={() => setActiveTab('settings')}
            onOpenOnboarding={() => setShowOnboarding(true)}
            onOpenConversation={(convId) => {
              setFocusConversationId(convId);
              setActiveTab('conversations');
            }}
          />
        )}
        {activeTab === 'conversations' && (
          <ConversationsPage
            waState={waState}
            onUnreadChange={refreshUnread}
            initialConversationId={focusConversationId}
            onConsumedInitialConversation={() => setFocusConversationId(null)}
          />
        )}
        {activeTab === 'rules' && <RulesPage />}
        {activeTab === 'training' && <TrainingPage />}
        {activeTab === 'campaigns' && (
          <CampaignsPage
            waState={waState}
            campaignRuntime={campaignRuntime}
          />
        )}
        {activeTab === 'settings' && <SettingsPage />}
        {activeTab === 'guide' && (
          <GuidePage
            onNavigate={setActiveTab}
            onOpenOnboarding={() => setShowOnboarding(true)}
          />
        )}
      </main>

      {showOnboarding && (
        <OnboardingWizard
          userName={user.name}
          waState={waState}
          aiReady={aiReady}
          onAiConfigured={() => setAiReady(true)}
          onFinish={(targetTab) => {
            localStorage.setItem(`zapflow_onboarding_done_${user.id}`, '1');
            setShowOnboarding(false);
            if (targetTab) {
              setActiveTab(targetTab);
            }
          }}
        />
      )}
    </div>
  );
}
