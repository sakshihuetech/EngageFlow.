import {
  Activity,
  Gauge,
  Settings,
  RadioTower,
  PlugZap,
  Files,
  Users,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react';

export interface NavigationItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface NavigationGroup {
  label?: string;
  items: NavigationItem[];
}

export const navigationGroups: NavigationGroup[] = [
  { items: [{ label: 'Dashboard', path: '/', icon: Gauge }] },
  { label: 'WhatsApp', items: [
    { label: 'Setup', path: '/whatsapp/setup', icon: PlugZap },
    { label: 'Templates', path: '/whatsapp/templates', icon: Files },
    { label: 'Audience', path: '/whatsapp/audience', icon: Users },
    { label: 'Campaigns', path: '/whatsapp/campaigns', icon: RadioTower },
    { label: 'Inbox', path: '/whatsapp/inbox', icon: MessageSquareText },
  ] },
  { label: 'System', items: [{ label: 'System Health', path: '/system/health', icon: Activity }] },
  { items: [{ label: 'Settings', path: '/settings', icon: Settings }] },
];

export const routeLabels: Record<string, string> = Object.fromEntries(
  navigationGroups.flatMap((group) => group.items.map((item) => [item.path, item.label])),
);

export function isCampaignRoute(pathname: string) {
  return [
    '/whatsapp/campaigns', '/whatsapp/broadcasts', '/whatsapp/api-campaigns',
    '/developer/api-campaigns', '/developer/api-credentials', '/developer/executions',
  ].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
