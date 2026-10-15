export function hasSenderConsent(consent: { status?: string | null; accountId?: unknown; source?: string | null; evidence?: string | null } | null | undefined, accountId: unknown) {
  return consent?.status === 'OPTED_IN'
    && String(consent.accountId ?? '') === String(accountId)
    && Boolean(consent.source?.trim())
    && Boolean(consent.evidence?.trim());
}
