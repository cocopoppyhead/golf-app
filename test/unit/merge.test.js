import { describe, it, expect } from 'vitest';
import { planMerge, planSettings } from '../../src/cloud/merge.js';

const iso = (t) => new Date(t).toISOString();
const T0 = Date.parse('2026-11-01T10:00:00Z'), T1 = T0 + 3600e3, T2 = T0 + 7200e3;

describe('sync merge', () => {
  it('pushes what is new or newer locally, pulls what is newer remotely', () => {
    const local = [{ id: 'a', updatedAt: T1, x: 1, _stats: { s: 1 } }, { id: 'b', updatedAt: T0, x: 2 }, { id: 'c', updatedAt: T0, x: 3 }];
    const remote = [{ id: 'a', data: { id: 'a', x: 0 }, deleted: false, updated_at: iso(T0) }, { id: 'b', data: { id: 'b', x: 22 }, deleted: false, updated_at: iso(T2) }, { id: 'c', data: { id: 'c', x: 3 }, deleted: false, updated_at: iso(T0) }, { id: 'd', data: { id: 'd', x: 4 }, deleted: false, updated_at: iso(T1) }];
    const p = planMerge('round', local, remote);
    expect(p.up.map((u) => u.id)).toEqual(['a']);
    expect(p.up[0].data._stats).toBeUndefined(); // derived stats never leave the phone
    expect(p.puts.map((r) => r.id)).toEqual(['b', 'd']);
    expect(p.puts[0]).toMatchObject({ x: 22, updatedAt: T2 });
    expect(p.dels).toEqual([]);
  });
  it('a remote tombstone deletes a local copy that is not newer; a newer local copy survives and is pushed', () => {
    const local = [{ id: 'old', updatedAt: T0 }, { id: 'edited', updatedAt: T2 }];
    const remote = [{ id: 'old', data: {}, deleted: true, updated_at: iso(T1) }, { id: 'edited', data: {}, deleted: true, updated_at: iso(T1) }];
    const p = planMerge('swing', local, remote);
    expect(p.dels).toEqual(['old']);
    expect(p.up.map((u) => u.id)).toEqual(['edited']);
  });
  it('a record deleted on this phone is not pulled back even if the remote is newer', () => {
    const remote = [{ id: 'gone', data: { id: 'gone' }, deleted: false, updated_at: iso(T2) }];
    const p = planMerge('shot', [], remote, new Set(['shot:gone']));
    expect(p.puts).toEqual([]);
  });
  it('records without updatedAt fall back to their date', () => {
    const p = planMerge('round', [{ id: 'r', date: T2 }], [{ id: 'r', data: { id: 'r' }, deleted: false, updated_at: iso(T1) }]);
    expect(p.up.length).toBe(1); expect(p.up[0].t).toBe(T2); expect(p.puts).toEqual([]);
  });
  it('settings: remote newer → pull merged; local newer → push only the synced keys', () => {
    const keys = ['name', 'bag'];
    const pull = planSettings({ name: 'C', bag: [], apiKey: 'secret', updatedAt: T0 }, { data: { name: 'Conor', bag: [{ club: 'Driver' }] }, updated_at: iso(T1) }, keys);
    expect(pull.pull).toMatchObject({ name: 'Conor', apiKey: 'secret', updatedAt: T1 });
    const push = planSettings({ name: 'C', bag: [], apiKey: 'secret', updatedAt: T2 }, { data: {}, updated_at: iso(T1) }, keys);
    expect(push.push.data).toEqual({ name: 'C', bag: [] }); // the API key never goes up
    expect(planSettings({ updatedAt: T1 }, { data: {}, updated_at: iso(T1) }, keys)).toEqual({});
  });
});
