import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const allowedHost = host => host.endsWith('.espn.com') || host.endsWith('.espncdn.com') || host === '66.media.tumblr.com';
const initials = name => String(name || 'Team').split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('') || 'T';

async function fallback(path, name) {
  const label = initials(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" rx="90" fill="#1b3a63"/><circle cx="90" cy="90" r="82" fill="none" stroke="#d8c9a7" stroke-width="6"/><text x="90" y="108" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="58" fill="#fff">${label}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path);
}

async function download(path, url, env) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !allowedHost(parsed.hostname)) throw new Error('Unapproved ESPN logo host');
  const headers = parsed.hostname === 'mystique-api.fantasy.espn.com' && env?.ESPN_S2 && env?.SWID ? { Cookie: `espn_s2=${env.ESPN_S2}; SWID=${env.SWID}` } : {};
  const response = await fetch(parsed, { headers, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/')) throw new Error(`Logo fetch failed (${response.status})`);
  if (!allowedHost(new URL(response.url).hostname)) throw new Error('Logo redirected to an unapproved host');
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 5_000_000) throw new Error('Logo exceeds size limit');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_000_000) throw new Error('Logo exceeds size limit');
  await sharp(bytes, { animated: false, density: 180 }).resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toFile(path);
}

export async function prepareTeamLogos(root, snapshot, env=process.env) {
  const cache = resolve(root, 'var', 'media-cache');
  mkdirSync(cache, { recursive: true });
  const teams = [...new Map(snapshot.matchups.flatMap(matchup => [matchup.home, matchup.away]).map(team => [team.teamId, team])).values()];
  const logos = [];
  for (const team of teams) {
    const key = sha256(`v2:${team.teamId}:${team.logo || 'fallback'}:${team.name}`).slice(0, 16);
    const path = resolve(cache, `team-${team.teamId}-${key}.png`);
    let source = team.logo ? 'espn' : 'fallback';
    if (!existsSync(path)) {
      try { if (team.logo) await download(path, team.logo, env); else await fallback(path, team.name); }
      catch { source = 'fallback'; await fallback(path, team.name); }
    }
    const bytes = readFileSync(path);
    logos.push({ teamId: team.teamId, team: team.name.trim(), path, file: `team-${team.teamId}.png`, cid: `chatpdt-team-${team.teamId}`, sha256: sha256(bytes), source });
  }
  return logos;
}



