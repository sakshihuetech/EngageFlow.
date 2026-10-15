export function campaignArea(pathname: string) {
  const api = pathname.startsWith('/whatsapp/campaigns/api')
    || pathname.startsWith('/whatsapp/api-campaigns')
    || pathname.startsWith('/developer/');
  const section = pathname.includes('api-credentials') || pathname.endsWith('/credentials') ? 'Credentials'
    : pathname.includes('/executions') ? 'Execution Logs' : 'Overview';
  return { api, section };
}
