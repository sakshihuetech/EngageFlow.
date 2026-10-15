export function safeApiCampaignFailureText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return Array.from(value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]')
    .replace(/(api[_-]?key|client_secret|password|pin)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/https?:\/\/\S+/gi, '[url redacted]'), (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? ' ' : character;
  }).join('').trim().slice(0, max);
}
