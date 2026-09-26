import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, resolve, sep } from 'node:path';
import { prepareTeamLogos } from './team-logos.js';

const imageExtensions = new Set(['.jpg', '.jpeg', '.png']);
const fileHash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export function weeklyAwards(snapshot, previousRecipientTeamIds = []) {
  const teams = snapshot.matchups.flatMap(matchup => [matchup.home, matchup.away]);
  if (!teams.length || teams.some(team => !Number.isFinite(team.score))) throw new Error('Award selection requires numeric weekly scores');
  const blocked = new Set(previousRecipientTeamIds.map(Number));
  const eligible = teams.filter(team => !blocked.has(Number(team.teamId)));
  if (eligible.length < 2) throw new Error('Award rotation left too few eligible teams');
  const high = Math.max(...eligible.map(team => team.score));
  const low = Math.min(...eligible.map(team => team.score));
  return {
    phi: { label: high === low || eligible.filter(team => team.score === high).length > 1 ? 'Co-Phi of the Week' : 'Phi of the Week', score: high, teams: eligible.filter(team => team.score === high) },
    maloney: { label: high === low || eligible.filter(team => team.score === low).length > 1 ? 'Co-Maloney of the Week' : 'Maloney of the Week', score: low, teams: eligible.filter(team => team.score === low) }
  };
}

export function teamMemberMap(root) {
  const text = readFileSync(resolve(root, 'knowledge', 'league', 'team_mappings.md'), 'utf8');
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\|\s*members\/(member-\d+)\.md\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*(\d+)\s*\|$/);
    if (match) map.set(Number(match[4]), { memberId: match[1], manager: match[2].trim(), team: match[3].trim() });
  }
  return map;
}

function approvedPhotos(root, memberId) {
  const dir = resolve(root, 'media', 'members', memberId);
  const manifestPath = resolve(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return (manifest.photos || []).filter(photo => photo.approvedForNewsletter === true).map(photo => {
    const file = basename(String(photo.file || ''));
    const path = resolve(dir, file);
    if (!file || !imageExtensions.has(extname(file).toLowerCase()) || !path.startsWith(dir + sep) || !existsSync(path)) return null;
    return { path, file, caption: String(photo.caption || '').trim(), approximateYear: String(photo.approximateYear || '').trim(), sha256: fileHash(path) };
  }).filter(Boolean).sort((a, b) => a.file.localeCompare(b.file));
}

function brandAsset(root, stem) {
  const dir = resolve(root, 'media', 'branding');
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find(name => imageExtensions.has(extname(name).toLowerCase()) && name.slice(0, -extname(name).length).toLowerCase() === stem);
  if (!file) return null;
  const path = resolve(dir, file);
  return { path, file, sha256: fileHash(path) };
}

export async function buildWeeklyVisuals(root, snapshot, previousPublications = [], env=process.env) {
  const mapping = teamMemberMap(root);
  const used = new Set(previousPublications.filter(publication=>publication.status==='published').flatMap(publication => publication.visuals?.awards || []).flatMap(award => award.recipients || []).flatMap(recipient => recipient.photos || []).map(photo => `${recipientKey(photo)}:${photo.file}`));
  const previousWeek = previousPublications.filter(publication=>publication.season===snapshot.season&&publication.week===snapshot.week-1&&publication.status==='published').sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
  const previousRecipients = (previousWeek?.visuals?.awards||[]).flatMap(award=>award.recipients||[]).map(recipient=>recipient.teamId);
  const selected = weeklyAwards(snapshot,previousRecipients);
  const teamLogos = await prepareTeamLogos(root, snapshot, env);
  const awards = Object.entries(selected).map(([kind, award]) => ({
    kind,
    label: award.label,
    score: award.score,
    recipients: award.teams.map(team => {
      const identity = mapping.get(team.teamId) || { memberId: null, manager: 'Unmapped manager', team: team.name };
      const available = identity.memberId ? approvedPhotos(root, identity.memberId) : [];
      const fresh = available.filter(photo => !used.has(`${identity.memberId}:${photo.file}`));
      const photos = [...fresh, ...available.filter(photo => !fresh.includes(photo))].slice(0, 2).map((photo, index) => ({ ...photo, cid: `chatpdt-${kind}-${identity.memberId || team.teamId}-${index + 1}`, memberId: identity.memberId }));
      return { teamId: team.teamId, team: team.name.trim(), manager: identity.manager, memberId: identity.memberId, score: team.score, photos };
    })
  }));
  return {
    title: 'Phi & Maloney of the Week',
    awards,
    teamLogos,
    scoreboard: snapshot.matchups.map(matchup=>({id:matchup.id,home:{teamId:matchup.home.teamId,name:matchup.home.name.trim(),score:matchup.home.score},away:{teamId:matchup.away.teamId,name:matchup.away.name.trim(),score:matchup.away.score},winner:matchup.winner})),
    standings: (snapshot.standings||[]).map(team=>({teamId:team.teamId,name:team.name.trim(),wins:team.wins,losses:team.losses,pointsFor:team.pointsFor??null})).sort((a,b)=>(b.wins??-1)-(a.wins??-1)||(a.losses??999)-(b.losses??999)||(b.pointsFor??-1)-(a.pointsFor??-1)),
    branding: {
      creightonHeader: brandAsset(root, 'creighton-header'),
      phiDeltLogo: brandAsset(root, 'phi-delta-theta-logo'),
      chatpdtTitleLogo: brandAsset(root, 'chatpdt-title-logo'),
      chatpdtSignatureLogo: brandAsset(root, 'chatpdt-signature-logo')
    }
  };
}

function recipientKey(photo) { return photo.memberId || 'unknown'; }

export function inlineImages(visuals) {
  const items = [];
  if (visuals?.branding?.creightonHeader) items.push({ ...visuals.branding.creightonHeader, cid: 'chatpdt-creighton-header', role: 'creighton-header' });
  if (visuals?.branding?.phiDeltLogo) items.push({ ...visuals.branding.phiDeltLogo, cid: 'chatpdt-phi-delt-logo', role: 'phi-delt-logo' });
  if (visuals?.branding?.chatpdtTitleLogo) items.push({ ...visuals.branding.chatpdtTitleLogo, cid: 'chatpdt-title-logo', role: 'chatpdt-title-logo' });
  if (visuals?.branding?.chatpdtSignatureLogo) items.push({ ...visuals.branding.chatpdtSignatureLogo, cid: 'chatpdt-signature-logo', role: 'chatpdt-signature-logo' });
  for (const logo of visuals?.teamLogos || []) items.push({ ...logo, role: 'team-logo' });
  for (const award of visuals?.awards || []) for (const recipient of award.recipients || []) for (const photo of recipient.photos || []) items.push({ ...photo, role: award.kind });
  return items;
}



