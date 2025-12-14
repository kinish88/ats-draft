const BASE = (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

export const TEAM_LOGO_BASE = BASE;

export function getTeamLogoUrl(short?: string | null): string | null {
  if (!short) return null;
  const trimmed = short.trim();
  if (!trimmed) return null;
  return TEAM_LOGO_BASE ? `${TEAM_LOGO_BASE}/${trimmed.toUpperCase()}.png` : `/teams/${trimmed.toUpperCase()}.png`;
}

export const NFL_LOGO_URL = getTeamLogoUrl('NFL');
