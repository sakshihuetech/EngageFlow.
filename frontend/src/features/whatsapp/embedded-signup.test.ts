import { afterEach, describe, expect, it, vi } from 'vitest';
import { embeddedSignup, signupSession } from './embedded-signup';
afterEach(() => vi.unstubAllGlobals());
describe('Embedded Signup completion', () => {
  it('accepts only Meta origins and supported finish events', () => {
    const data = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '123', phone_number_id: '456' } };
    expect(signupSession({ origin: 'https://evil.test', data })).toBeNull();
    expect(signupSession({ origin: 'https://www.facebook.com', data })).toEqual({ wabaId: '123', phoneNumberId: '456', onboardingMode: 'STANDARD' });
    expect(signupSession({ origin: 'https://web.facebook.com', data: JSON.stringify({ ...data, event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '123' } }) })).toEqual({ wabaId: '123', onboardingMode: 'COEXISTENCE' });
    expect(() => signupSession({ origin: 'https://www.facebook.com', data: { ...data, data: {} } })).toThrow();
    expect(() => signupSession({ origin: 'https://www.facebook.com', data: { ...data, event: 'CANCEL' } })).toThrow(/cancelled/);
  });
  it('does not complete onboarding after a cancelled Meta login', async () => {
    const login = vi.fn((callback: (response: object) => void, options: Record<string, unknown>) => { void options; callback({}); });
    vi.stubGlobal('window', { FB: { init: vi.fn(), login }, addEventListener: vi.fn(), removeEventListener: vi.fn(), setTimeout, clearTimeout });
    await expect(embeddedSignup('public-app', 'public-config')).rejects.toThrow(/cancelled/);
    expect(login.mock.calls).toHaveLength(1);
    expect(login.mock.calls[0]?.[1]).toMatchObject({ config_id: 'public-config' });
    expect(login.mock.calls[0]?.[1]).not.toHaveProperty('extras');
  });
  it('requests Coexistence explicitly and rejects a Standard completion event', async () => {
    let listener: ((event: object) => void) | undefined;
    const login = vi.fn((callback: (response: object) => void, options: Record<string, unknown>) => { void options; callback({ authResponse: { code: 'mock-code' } }); });
    vi.stubGlobal('window', { FB: { init: vi.fn(), login }, addEventListener: vi.fn((_name: string, callback: (event: object) => void) => { listener = callback; }), removeEventListener: vi.fn(), setTimeout, clearTimeout });
    const result = embeddedSignup('public-app', 'public-config', undefined, 'COEXISTENCE');
    await Promise.resolve();
    listener?.({ origin: 'https://www.facebook.com', data: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '123', phone_number_id: '456' } } });
    await expect(result).rejects.toThrow(/different onboarding flow/);
    expect(login.mock.calls[0]?.[1]).toMatchObject({ extras: { featureType: 'whatsapp_business_app_onboarding' } });
  });
});
