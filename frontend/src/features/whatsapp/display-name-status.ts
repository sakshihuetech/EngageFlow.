export const WHATSAPP_MANAGER_URL = 'https://business.facebook.com/wa/manage/phone-numbers/';

export function displayNameStatusLabel(status?: string) {
  switch (status) {
    case 'APPROVED': return 'Approved';
    case 'AVAILABLE_WITHOUT_REVIEW': return 'Available without review';
    case 'PENDING_REVIEW': return 'Pending review';
    case 'DECLINED': return 'Declined';
    case 'EXPIRED': return 'Expired';
    case 'NONE': return 'None';
    default: return status ? 'Unknown' : 'Not available';
  }
}

export function isDisplayNameApprovalFailure(failure?: { failureCode?: string }) {
  return failure?.failureCode === '131037';
}
