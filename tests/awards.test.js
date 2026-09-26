import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildWeeklyVisuals, weeklyAwards } from '../src/awards.js';
import { html } from '../src/render.js';

const snapshot = scores => ({ matchups: scores.map((pair, index) => ({
  home: { teamId: index * 2 + 1, name: `Home ${index}`, score: pair[0] },
  away: { teamId: index * 2 + 2, name: `Away ${index}`, score: pair[1] }
})) });

test('Phi and Maloney awards use exact weekly high and low scores and preserve ties', () => {
  const ordinary = weeklyAwards(snapshot([[100, 110], [80, 95]]));
  assert.equal(ordinary.phi.label, 'Phi of the Week');
  assert.equal(ordinary.phi.teams[0].teamId, 2);
  assert.equal(ordinary.maloney.label, 'Maloney of the Week');
  assert.equal(ordinary.maloney.teams[0].teamId, 3);
  const tied = weeklyAwards(snapshot([[110, 110], [80, 80]]));
  assert.equal(tied.phi.label, 'Co-Phi of the Week');
  assert.equal(tied.phi.teams.length, 2);
  assert.equal(tied.maloney.label, 'Co-Maloney of the Week');
  assert.equal(tied.maloney.teams.length, 2);
});

test('Phi and Maloney exclude every recipient from the immediately previous week',()=>{
  const awards=weeklyAwards(snapshot([[140,130],[80,70]]),[1,4]);
  assert.equal(awards.phi.teams[0].teamId,2);
  assert.equal(awards.maloney.teams[0].teamId,3);
});

test('weekly visuals map award winners to approved member photos and rotate unused files', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'chatpdt-awards-'));
  mkdirSync(resolve(root, 'knowledge', 'league'), { recursive: true });
  mkdirSync(resolve(root, 'media', 'members', 'member-01'), { recursive: true });
  mkdirSync(resolve(root, 'media', 'members', 'member-02'), { recursive: true });
  mkdirSync(resolve(root, 'media', 'branding'), { recursive: true });
  writeFileSync(resolve(root, 'knowledge', 'league', 'team_mappings.md'), '| members/member-01.md | Jordan | High Team | 1 |\n| members/member-02.md | Casey | Low Team | 2 |\n');
  for (const file of ['one.jpg', 'two.jpg', 'three.jpg']) writeFileSync(resolve(root, 'media', 'members', 'member-01', file), `image-${file}`);
  writeFileSync(resolve(root, 'media', 'members', 'member-02', 'low.png'), 'image-low');
  writeFileSync(resolve(root, 'media', 'members', 'member-01', 'manifest.json'), JSON.stringify({ photos: [
    { file: 'one.jpg', approvedForNewsletter: true },
    { file: 'two.jpg', approvedForNewsletter: true, caption: '<old photo>' },
    { file: 'three.jpg', approvedForNewsletter: true }
  ] }));
  writeFileSync(resolve(root, 'media', 'members', 'member-02', 'manifest.json'), JSON.stringify({ photos: [{ file: 'low.png', approvedForNewsletter: true }] }));
  const current = snapshot([[200, 50]]);
  current.standings = [{ teamId: 1, name: 'High Team', wins: 1, losses: 0, pointsFor: 200 }, { teamId: 2, name: 'Low Team', wins: 0, losses: 1, pointsFor: 50 }];
  const previous = [{ status:'published',visuals: { awards: [{ recipients: [{ photos: [{ memberId: 'member-01', file: 'one.jpg' }] }] }] } }];
  const visuals = await buildWeeklyVisuals(root, current, previous);
  assert.deepEqual(visuals.awards[0].recipients[0].photos.map(photo => photo.file), ['three.jpg', 'two.jpg']);
  assert.equal(visuals.awards[1].recipients[0].photos[0].file, 'low.png');
  const output = html('Week', 'Recap', visuals);
  assert.match(output, /Phi &amp; Maloney of the Week/);
  assert.match(output, /ESPN Matchup Board/);
  assert.match(output, /League Table/);
  assert.match(output, /cid:chatpdt-team-1/);
  assert.match(output, /cid:chatpdt-phi-member-01-1/);
  assert.ok(!output.includes('<old photo>'));
  assert.match(output, /&lt;old photo&gt;/);
});



