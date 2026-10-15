import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { maskPhone } from './safety.js';

export interface ConsentEnvironment {
  nodeEnv: 'development' | 'test' | 'production';
  bypassEnabled: boolean;
}

export function canBypassCampaignConsent(input: ConsentEnvironment = {
  nodeEnv: env.NODE_ENV,
  bypassEnabled: env.CAMPAIGN_TEST_BYPASS_CONSENT === 'true',
}): boolean {
  return input.nodeEnv !== 'production' && input.bypassEnabled;
}

export function logConsentBypass(campaignId: string, phone: string, phase: string) {
  logger.warn('Development campaign consent bypass used', {
    campaignId,
    recipient: maskPhone(phone),
    phase,
  });
}
