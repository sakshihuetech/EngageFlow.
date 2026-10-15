import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

export function NotFoundPage() {
  return (
    <Card className="mx-auto max-w-xl p-8 text-center sm:p-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">404</p>
      <h1 className="mt-3 text-2xl font-bold tracking-[-0.02em]">Page not found</h1>
      <p className="mt-2 text-sm text-text-secondary">The requested EngageFlow page does not exist or has not been migrated.</p>
      <Link to="/" className="mt-6 inline-block"><Button variant="secondary"><ArrowLeft className="size-4" />Back to dashboard</Button></Link>
    </Card>
  );
}
