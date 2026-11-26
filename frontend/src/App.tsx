import { useEffect, useState } from 'react';
import { NavTab, Sidebar } from './components/Sidebar';
import { api } from './lib/api';
import { socket } from './lib/socket';
import { CampaignsPage } from './pages/CampaignsPage';
import { ConversationsPage } from './pages/ConversationsPage';
import { DashboardPage } from './pages/DashboardPage';
import { RulesPage } from './pages/RulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { CampaignRuntimeState, Conversation, WhatsAppState } from './types';

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
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [waState, setWaState] = useState<WhatsAppState>(INITIAL_WA_STATE);
  const [campaignRuntime, setCampaignRuntime] =
    useState<CampaignRuntimeState>(INITIAL_RUNTIME);
  const [unreadTotal, setUnreadTotal] = useState(0);

  const refreshUnread = async () => {
    try {
      const convs = await api.get<Conversation[]>('/conversations');
      setUnreadTotal(convs.reduce((acc, c) => acc + (c.unreadCount || 0), 0));
    } catch {
      // ignora erro inicial caso backend ainda esteja subindo
    }
  };

  useEffect(() => {
    api
      .get<WhatsAppState>('/whatsapp/status')
      .then(setWaState)
      .catch(() => {});
    void refreshUnread();

    const onStatus = (state: WhatsAppState) => setWaState(state);
    const onQr = ({ qrDataUrl }: { qrDataUrl: string | null }) =>
      setWaState((prev) => ({ ...prev, qrDataUrl }));
    const onRuntime = (rt: CampaignRuntimeState) => setCampaignRuntime(rt);
    const onConvUpdated = () => void refreshUnread();

    socket.on('whatsapp:status', onStatus);
    socket.on('whatsapp:qr', onQr);
    socket.on('campaign:runtime', onRuntime);
    socket.on('conversation:updated', onConvUpdated);

    return () => {
      socket.off('whatsapp:status', onStatus);
      socket.off('whatsapp:qr', onQr);
      socket.off('campaign:runtime', onRuntime);
      socket.off('conversation:updated', onConvUpdated);
    };
  }, []);

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

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 lg:h-screen lg:flex-row lg:overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        waState={waState}
        unreadTotal={unreadTotal}
        onToggleGlobalPause={handleToggleGlobalPause}
      />

      <main className="flex-1 overflow-y-auto p-4 lg:p-6">
        {activeTab === 'dashboard' && (
          <DashboardPage
            waState={waState}
            campaignRuntime={campaignRuntime}
            onToggleGlobalPause={handleToggleGlobalPause}
            onGoToSettings={() => setActiveTab('settings')}
          />
        )}
        {activeTab === 'conversations' && (
          <ConversationsPage waState={waState} onUnreadChange={refreshUnread} />
        )}
        {activeTab === 'rules' && <RulesPage />}
        {activeTab === 'campaigns' && (
          <CampaignsPage
            waState={waState}
            campaignRuntime={campaignRuntime}
          />
        )}
        {activeTab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
