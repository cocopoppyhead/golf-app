import { describe, it, expect, beforeEach } from 'vitest';
import { getPlan, savePlan, addCoachNote, setFocus, forgetSwing } from '../../src/coach/profile.js';

const fresh = () => savePlan({ focus: null, done: [], notes: [], updatedAt: 0 });

describe('coach profile forgets a deleted swing', () => {
  beforeEach(() => { localStorage.clear(); fresh(); });
  it('drops the notes, drills and focus that came from that swing', () => {
    addCoachNote('keep: older review', 'sw1');
    addCoachNote('drop: review of sw2', 'sw2');
    const plan = setFocus('address:Ball position'); plan.focus.setBy = 'AI coach'; plan.focus.swingId = 'sw2'; plan.drills = ['fix-x']; plan.drillsSwing = 'sw2'; savePlan(plan);
    forgetSwing('sw2', Date.now(), []);
    const p = getPlan();
    expect(p.notes.map((n) => n.note)).toEqual(['keep: older review']);
    expect(p.drills).toBeUndefined();
    expect(p.focus).toBeNull();
  });
  it('leaves a focus the golfer set themselves, and notes from other swings', () => {
    addCoachNote('from sw1', 'sw1');
    setFocus('top:Head'); // setBy 'you'
    forgetSwing('sw9', Date.now(), []);
    expect(getPlan().focus.key).toBe('top:Head');
    expect(getPlan().notes.length).toBe(1);
  });
  it('untagged notes written around the swing\'s time go too', () => {
    const t = Date.now() - 30 * 60e3;
    const plan = getPlan(); plan.notes = [{ date: t, note: 'same session' }, { date: t - 5 * 3600e3, note: 'earlier day' }]; savePlan(plan);
    forgetSwing('swX', t + 60e3, []);
    expect(getPlan().notes.map((n) => n.note)).toEqual(['earlier day']);
  });
});
