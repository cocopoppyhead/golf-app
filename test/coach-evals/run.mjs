#!/usr/bin/env node
/* global process, console */
// Runs the coach evals against a real model and grades each reply two ways: fixed checks (must /
// must-not phrases, word limit, at most one question) and a second model call that judges the reply
// against what a good coach should do. Prints a table; exits 1 if anything fails.
//
//   ANTHROPIC_API_KEY=sk-ant-… node test/coach-evals/run.mjs [scenario-id …]
//   (optional) MODEL=claude-sonnet-5-5
//
// Your key stays in your terminal. Nothing personal is sent: every round in scenarios.mjs is made up.
import { SCENARIOS } from './scenarios.mjs';
import { mindContext } from '../../src/coach/mind.js';
import { systemPrompt } from '../../src/coach/playbook.js';
import { chatLLM } from '../../src/coach/ai.js';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('Set ANTHROPIC_API_KEY first (in your terminal, not in a file).'); process.exit(2); }
const model = process.env.MODEL || 'claude-sonnet-5-5';
const only = process.argv.slice(2);
const settings = { handicap: 6, routine: { swingThought: 'left heel' } };

const words = (t) => t.trim().split(/\s+/).length;
const questions = (t) => (t.match(/\?/g) || []).length;

async function judge(sc, reply) {
  const { text } = await chatLLM({ provider: 'claude', apiKey, model, maxTokens: 300,
    system: 'You grade a golf mental coach. Reply with JSON only: {"pass": true|false, "why": "<one sentence>"}.',
    messages: [{ role: 'user', text: `What a good reply does: ${sc.judge}\n\nThe golfer asked: ${sc.ask}\n\nThe coach replied:\n${reply}` }] });
  try { return JSON.parse(text.replace(/^```json|```$/g, '').trim()); } catch { return { pass: false, why: `judge said: ${text.slice(0, 120)}` }; }
}

let failed = 0;
for (const sc of SCENARIOS.filter((s) => !only.length || only.includes(s.id))) {
  const t0 = Date.now();
  const system = `${systemPrompt(sc.mode || 'open')}\n\n${mindContext({ rounds: sc.rounds, settings })}`;
  const messages = [...(sc.history || []), { role: 'user', text: sc.ask }];
  let reply = '';
  try { ({ text: reply } = await chatLLM({ provider: 'claude', apiKey, model, system, messages })); } catch (e) { reply = `ERROR ${e.message}`; }
  const ms = Date.now() - t0;
  const problems = [];
  (sc.must || []).forEach((re) => { if (!re.test(reply)) problems.push(`missing ${re}`); });
  (sc.mustNot || []).forEach((re) => { if (re.test(reply)) problems.push(`has ${re}`); });
  if (words(reply) > (sc.maxWords || 150)) problems.push(`${words(reply)} words`);
  if (questions(reply) > 1) problems.push(`${questions(reply)} questions`);
  const j = await judge(sc, reply).catch((e) => ({ pass: false, why: e.message }));
  if (!j.pass) problems.push(`judge: ${j.why}`);
  if (problems.length) failed++;
  console.log(`\n${problems.length ? 'FAIL' : 'PASS'}  ${sc.id}  (${(ms / 1000).toFixed(1)}s, ${words(reply)} words)  ${sc.title}`);
  console.log(`  Q: ${sc.ask}`);
  console.log(`  A: ${reply.replace(/\n+/g, ' ')}`);
  problems.forEach((p) => console.log(`  - ${p}`));
}
console.log(`\n${failed ? `${failed} failed` : 'All passed'}`);
process.exit(failed ? 1 : 0);
