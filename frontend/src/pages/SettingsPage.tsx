import { Building2, Code2, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';

const sections = [
  { name: 'General', description: 'Core product preferences will be configured here as settings are migrated.', icon: Settings2 },
  { name: 'Workspace', description: 'Workspace identity and membership settings will follow the authentication foundation.', icon: Building2 },
  { name: 'Developer', description: 'Developer defaults will be added alongside credential and webhook capabilities.', icon: Code2 },
];

export function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Manage EngageFlow preferences as production capabilities become available." />
      <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
        {sections.map((section) => <SettingsCard key={section.name} {...section} />)}
      </div>
      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold tracking-[-0.01em]">Foundation phase</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">Settings are intentionally read-only. User management, webhook verification, and provider credentials will only be introduced with their reviewed backend features.</p>
      </Card>
    </div>
  );
}

function SettingsCard({ name, description, icon: Icon }: { name: string; description: string; icon: LucideIcon }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="grid size-10 place-items-center rounded-xl border border-primary-border bg-primary-soft text-primary shadow-control"><Icon className="size-5" /></div>
      <h2 className="mt-4 text-base font-semibold tracking-[-0.01em]">{name}</h2>
      <p className="mt-1 text-sm leading-6 text-text-secondary">{description}</p>
      <span className="mt-4 inline-flex rounded-full border border-border/80 bg-background-subtle px-2.5 py-1 text-[11px] font-semibold text-text-muted">Migration pending</span>
    </Card>
  );
}
