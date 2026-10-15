import { createBrowserRouter, Navigate } from 'react-router-dom';
import { App } from '../app/App';
import { AppLayout } from '../layouts/AppLayout';
import { CampaignsLayout } from '../layouts/CampaignsLayout';
import { ApiCampaignsPage } from '../pages/ApiCampaignsPage';
import { ApiCredentialsPage } from '../pages/ApiCredentialsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ExecutionLogsPage } from '../pages/ExecutionLogsPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SystemHealthPage } from '../pages/SystemHealthPage';
import { BroadcastCampaignsPage } from '../pages/BroadcastCampaignsPage';
import { NewBroadcastPage } from '../pages/NewBroadcastPage';
import { BroadcastDetailPage } from '../pages/BroadcastDetailPage';
import { WhatsAppSetupPage } from '../pages/WhatsAppSetupPage';
import { WhatsAppTemplatesPage } from '../pages/WhatsAppTemplatesPage';
import { MetaTemplateLibraryPage } from '../pages/MetaTemplateLibraryPage';
import { WhatsAppAudiencePage } from '../pages/WhatsAppAudiencePage';
import { WhatsAppInboxPage } from '../pages/WhatsAppInboxPage';
import { ApiCampaignDetailPage } from '../pages/ApiCampaignDetailPage';

export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'whatsapp/setup', element: <WhatsAppSetupPage /> },
          { path: 'whatsapp/templates', element: <WhatsAppTemplatesPage /> },
          { path: 'whatsapp/templates/library', element: <MetaTemplateLibraryPage /> },
          { path: 'whatsapp/audience', element: <WhatsAppAudiencePage /> },
          { path: 'whatsapp/inbox', element: <WhatsAppInboxPage /> },
          { element: <CampaignsLayout />, children: [
            { path: 'whatsapp/campaigns', element: <Navigate to="/whatsapp/campaigns/broadcast" replace /> },
            { path: 'whatsapp/campaigns/broadcast', element: <BroadcastCampaignsPage /> },
            { path: 'whatsapp/campaigns/broadcast/new', element: <NewBroadcastPage /> },
            { path: 'whatsapp/campaigns/broadcast/:id/edit', element: <NewBroadcastPage /> },
            { path: 'whatsapp/campaigns/broadcast/:id', element: <BroadcastDetailPage /> },
            { path: 'whatsapp/campaigns/api', element: <Navigate to="/whatsapp/campaigns/api/campaigns" replace /> },
            { path: 'whatsapp/campaigns/api/campaigns', element: <ApiCampaignsPage /> },
            { path: 'whatsapp/campaigns/api/campaigns/:id', element: <ApiCampaignDetailPage /> },
            { path: 'whatsapp/campaigns/api/credentials', element: <ApiCredentialsPage /> },
            { path: 'whatsapp/campaigns/api/executions', element: <ExecutionLogsPage /> },
            { path: 'whatsapp/broadcasts', element: <BroadcastCampaignsPage /> },
            { path: 'whatsapp/broadcasts/new', element: <NewBroadcastPage /> },
            { path: 'whatsapp/broadcasts/:id/edit', element: <NewBroadcastPage /> },
            { path: 'whatsapp/broadcasts/:id', element: <BroadcastDetailPage /> },
            { path: 'whatsapp/api-campaigns', element: <ApiCampaignsPage /> },
            { path: 'developer/api-campaigns', element: <ApiCampaignsPage /> },
            { path: 'developer/api-campaigns/:id', element: <ApiCampaignDetailPage /> },
            { path: 'developer/api-credentials', element: <ApiCredentialsPage /> },
            { path: 'developer/executions', element: <ExecutionLogsPage /> },
          ] },
          { path: 'system/health', element: <SystemHealthPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
