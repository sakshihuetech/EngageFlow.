import { describe, expect, it } from 'vitest';
import { displayNameStatusLabel, isDisplayNameApprovalFailure, WHATSAPP_MANAGER_URL } from './display-name-status';

describe('display name status', () => {
  it.each([
    ['APPROVED', 'Approved'],
    ['AVAILABLE_WITHOUT_REVIEW', 'Available without review'],
    ['PENDING_REVIEW', 'Pending review'],
    ['DECLINED', 'Declined'],
  ])('renders %s', (status, label) => expect(displayNameStatusLabel(status)).toBe(label));
  it('shows approval guidance only for provider 131037', () => {
    expect(isDisplayNameApprovalFailure({ failureCode: '131037' })).toBe(true);
    expect(isDisplayNameApprovalFailure({ failureCode: '131042' })).toBe(false);
    expect(isDisplayNameApprovalFailure()).toBe(false);
  });
  it('never adds credentials to WhatsApp Manager URL', () => {
    expect(new URL(WHATSAPP_MANAGER_URL).search).toBe('');
  });
});
