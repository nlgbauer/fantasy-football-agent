import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { teamMemberMap } from '../src/awards.js';

const root = process.cwd();
const mapping = teamMemberMap(root);
for (const { memberId, manager } of mapping.values()) {
  const dir = resolve(root, 'media', 'members', memberId);
  mkdirSync(dir, { recursive: true });
  const manifest = resolve(dir, 'manifest.json');
  try { readFileSync(manifest); } catch {
    writeFileSync(manifest, JSON.stringify({ memberId, displayName: manager, photos: [] }, null, 2) + '\n');
  }
}
mkdirSync(resolve(root, 'media', 'branding'), { recursive: true });
console.log(`Prepared private photo folders for ${mapping.size} members.`);



