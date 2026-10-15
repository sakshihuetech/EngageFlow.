interface MetaSdk {
  init(input: Record<string, unknown>): void;
  login(callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>): void;
}
declare global { interface Window { FB?: MetaSdk; fbAsyncInit?: () => void } }
let loading: Promise<void> | undefined;
function loadSdk(appId: string) {
  if (window.FB) { window.FB.init({ appId, version: 'v23.0', xfbml: false }); return Promise.resolve(); }
  loading ??= new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { loading = undefined; reject(new Error('Meta SDK did not load.')); }, 15000);
    window.fbAsyncInit = () => { window.clearTimeout(timeout); window.FB?.init({ appId, version: 'v23.0', xfbml: false }); resolve(); };
    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script'); script.id = 'facebook-jssdk'; script.src = 'https://connect.facebook.net/en_US/sdk.js'; script.async = true; document.head.append(script);
    }
  });
  return loading;
}
export function signupSession(event: { origin: string; data: unknown }) {
  if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return null;
  let message: { type?: string; event?: string; data?: Record<string, unknown> };
  try { message = (typeof event.data === 'string' ? JSON.parse(event.data) : event.data) as typeof message; } catch { return null; }
  if (!message || message.type !== 'WA_EMBEDDED_SIGNUP') return null;
  if (['CANCEL','ERROR'].includes(message.event ?? '')) throw new Error('Meta signup was cancelled or could not complete.');
  if (!['FINISH','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(message.event ?? '')) return null;
  const data = message.data ?? {}; const mode = message.event === 'FINISH' ? 'STANDARD' : 'COEXISTENCE';
  if (typeof data.waba_id !== 'string' || !/^\d+$/.test(data.waba_id) || (mode === 'STANDARD' && (typeof data.phone_number_id !== 'string' || !/^\d+$/.test(data.phone_number_id)))) throw new Error('Meta did not return the required account details.');
  return { wabaId: data.waba_id, ...(typeof data.phone_number_id === 'string' ? { phoneNumberId: data.phone_number_id } : {}), ...(typeof data.business_id === 'string' ? { businessId: data.business_id } : {}), onboardingMode: mode };
}
export async function embeddedSignup(appId: string, configId: string, signal?: AbortSignal, requestedMode: 'STANDARD' | 'COEXISTENCE' = 'STANDARD') {
  await loadSdk(appId);
  if (signal?.aborted) throw new Error('Meta signup was cancelled.');
  return new Promise<NonNullable<ReturnType<typeof signupSession>> & { code: string }>((resolve, reject) => {
    let code: string | undefined; let session: ReturnType<typeof signupSession>; let finished = false;
    const cleanup = () => { finished = true; window.removeEventListener('message', listener); window.clearTimeout(timeout); signal?.removeEventListener('abort', abort); code = undefined; session = null; };
    const abort = () => { cleanup(); reject(new Error('Meta signup was cancelled.')); };
    const complete = () => { if (!finished && code && session) { const result = { ...session, code }; cleanup(); resolve(result); } };
    const listener = (event: MessageEvent) => { try { const result = signupSession(event); if (result) { if (result.onboardingMode !== requestedMode) throw new Error('Meta completed a different onboarding flow. No local connection was changed.'); session = result; complete(); } } catch (error) { cleanup(); reject(error); } };
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('Meta signup timed out. Please try again.')); }, 180000);
    window.addEventListener('message', listener);
    signal?.addEventListener('abort', abort, { once: true });
    try { window.FB!.login(response => { if (finished) return; if (!response.authResponse?.code) { cleanup(); reject(new Error('Meta login was cancelled or did not return an authorization code.')); return; } code = response.authResponse.code; complete(); }, { config_id: configId, response_type: 'code', override_default_response_type: true, ...(requestedMode === 'COEXISTENCE' ? { extras: { featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' } } : {}) }); }
    catch (error) { cleanup(); reject(error); }
  });
}
