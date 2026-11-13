// Every setting the app saves must be classified in src/datamap.js (account, device or secret), secrets must
// never sync or export, and sync/backup must use the same list. A new setting that isn't listed fails here,
// so nothing quietly stays on one phone, or leaves it when it shouldn't.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNT_SETTINGS, DEVICE_SETTINGS, SECRET_SETTINGS, RECORD_KINDS, LOCAL_KEYS, accountPart } from '../../src/datamap.js';

const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });
const SRC = files('src').map((p) => ({ p, s: readFileSync(p, 'utf8') }));
const known = new Set([...ACCOUNT_SETTINGS, ...DEVICE_SETTINGS, ...SECRET_SETTINGS, 'updatedAt', 'units']);

describe('data map', () => {
  it('lists each setting once', () => {
    const all = [...ACCOUNT_SETTINGS, ...DEVICE_SETTINGS, ...SECRET_SETTINGS];
    expect(new Set(all).size).toBe(all.length);
  });

  it('never syncs or exports a secret', () => {
    for (const k of SECRET_SETTINGS) expect(ACCOUNT_SETTINGS).not.toContain(k);
    expect(accountPart({ apiKey: 'x', openaiKey: 'y', geminiKey: 'z', name: 'n' })).toEqual({ name: 'n' });
  });

  it('sync and backup read their lists from the data map', () => {
    const sync = readFileSync('src/cloud/sync.js', 'utf8'), backup = readFileSync('src/backup.js', 'utf8');
    expect(sync).toMatch(/SETTINGS_KEYS = ACCOUNT_SETTINGS/);
    expect(backup).toMatch(/KEEP = ACCOUNT_SETTINGS/);
  });

  it('classifies every setting the app saves', () => {
    const found = new Set();
    for (const { s } of SRC) {
      for (const line of s.split('\n')) {
        if (!/saveSettings\(|saveSetting\(/.test(line)) continue;
        // s.key = …, st.key = …, settings.key = …, api.settings.key = …
        for (const m of line.matchAll(/\b(?:s|st|s2|settings|api\.settings)\.([a-zA-Z]+)\s*=(?!=)/g)) found.add(m[1]);
        // { ...api.settings, key: …, key: … }
        for (const m of line.matchAll(/\{\s*\.\.\.(?:api\.settings|s|st)\s*,([^}]*)\}/g)) for (const k of m[1].matchAll(/(?:^|,)\s*\[?([a-zA-Z]+)\]?\s*:/g)) found.add(k[1]);
      }
      // onboarding: Object.assign(s2, { key: …, … })
      for (const m of s.matchAll(/Object\.assign\(s2?,\s*\{([^}]*)\}/g)) for (const k of m[1].matchAll(/(?:^|,)\s*([a-zA-Z]+)\s*:/g)) found.add(k[1]);
    }
    found.delete('modelField'); // a computed key: [P.modelField] is one of the *Model device settings
    const unknown = [...found].filter((k) => !known.has(k));
    expect(found.size).toBeGreaterThan(20);
    expect(unknown).toEqual([]);
  });

  it('documents every record kind and local key in docs/DATA.md', () => {
    const doc = readFileSync('docs/DATA.md', 'utf8');
    for (const k of Object.keys(RECORD_KINDS)) expect(doc).toContain(`\`${k}\``);
    for (const v of Object.values(RECORD_KINDS).flatMap((r) => r.views)) expect(doc).toContain(v);
    for (const k of Object.keys(LOCAL_KEYS)) expect(doc).toContain(k);
    for (const k of ACCOUNT_SETTINGS) expect(doc).toContain(`\`${k}\``);
  });

  it('every analytics view in the SQL is in the dictionary', () => {
    const sql = readFileSync('supabase/analytics.sql', 'utf8'), doc = readFileSync('docs/DATA.md', 'utf8');
    const views = [...sql.matchAll(/create or replace view public\.(\w+)/g)].map((m) => m[1]);
    expect(views.length).toBeGreaterThanOrEqual(15);
    for (const v of views) expect(doc).toContain(v);
  });

  it('the schema accepts every record kind', () => {
    const schema = readFileSync('supabase/schema.sql', 'utf8');
    const last = [...schema.matchAll(/check \(kind in \(([^)]*)\)\)/g)].pop()[1];
    for (const k of Object.keys(RECORD_KINDS)) expect(last).toContain(`'${k}'`);
  });
});
