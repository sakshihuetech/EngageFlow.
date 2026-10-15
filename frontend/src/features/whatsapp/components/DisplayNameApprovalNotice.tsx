import { Link } from 'react-router-dom';
import { displayNameStatusLabel, isDisplayNameApprovalFailure, WHATSAPP_MANAGER_URL } from '../display-name-status';

export function DisplayNameApprovalNotice({ failure, phone, compact = false }: {
  failure?: { failureCode?: string };
  phone?: { displayPhoneNumber?: string; nameStatus?: string };
  compact?: boolean;
}) {
  if (!isDisplayNameApprovalFailure(failure)) return null;
  if (compact) return <p className="mt-2 text-xs leading-5 text-warning"><span className="font-semibold">Display name approval required.</span> Meta blocked this send. Check the sending phone in <Link className="font-semibold underline underline-offset-2" to="/whatsapp/setup">WhatsApp Setup</Link>.</p>;
  return <div className="mt-3 rounded-xl border border-warning/25 bg-warning-soft p-4 text-sm">
    <p className="font-semibold text-warning">Display name approval required</p>
    <p className="mt-1 text-text-secondary">Meta blocked this WhatsApp-provided number because its display name is not currently approved for this send.</p>
    <p className="mt-2 text-xs text-text-secondary">Sending phone: {phone?.displayPhoneNumber ?? 'See WhatsApp Setup'} · Current Meta status: {displayNameStatusLabel(phone?.nameStatus)}. If this says Approved or Available without review, the provider error and current status disagree; check the phone in WhatsApp Manager before changing its name.</p>
    <a className="mt-3 inline-flex text-xs font-semibold text-primary underline underline-offset-2" href={WHATSAPP_MANAGER_URL} target="_blank" rel="noopener noreferrer">Open WhatsApp Manager</a>
    <p className="mt-2 text-xs text-text-secondary">If pending review, wait for Meta. If declined, correct and resubmit the name in WhatsApp Manager. Use Refresh Meta Assets in Setup to update this status.</p>
  </div>;
}
