'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AppView = require('../public/js/app-view.js');

const id = (char) => char.repeat(32);
const url = (char) => `/api/apps/demo/proposals/42/evidence/${id(char)}`;

function evidence(overrides = {}) {
  return {
    state: 'verified',
    required: true,
    claims: [{
      id: 'dialog',
      claim: 'Typing shows <matching> users & keeps "Invite" visible.',
      persona: 'member',
      viewports: ['desktop'],
      steps: ['Open <Members>', 'Type ma'],
      baseState: 'present',
      animation: 'steps',
    }],
    baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), planHash: 'c'.repeat(64),
    replayCount: 2, repairCount: 1, relativePointer: true,
    verifiedReason: null,
    artifacts: [
      { id: id('1'), storyId: 'dialog', viewport: 'desktop', side: 'base', variant: 'focus', media: 'png', url: url('1') },
      { id: id('2'), storyId: 'dialog', viewport: 'desktop', side: 'head', variant: 'focus', media: 'png', url: url('2') },
      { id: id('3'), storyId: 'dialog', viewport: 'desktop', side: 'base', variant: 'context', media: 'png', url: url('3') },
      { id: id('4'), storyId: 'dialog', viewport: 'desktop', side: 'head', variant: 'context', media: 'png', url: url('4') },
      { id: id('5'), storyId: 'dialog', viewport: 'desktop', side: 'paired', variant: 'animation', media: 'webm', url: url('5') },
      // A server bug or injected object cannot turn an absolute URL into media.
      { id: id('6'), storyId: 'dialog', viewport: 'desktop', side: 'head', variant: 'focus', media: 'png', url: 'https://evil.example/x.png' },
    ],
    ...overrides,
  };
}

test('verified cards are claim-first, escaped, authenticated, and never autoplay', () => {
  const html = AppView.visualEvidenceHtml(evidence(), { sessionId: 42 });
  assert.match(html, /Typing shows &lt;matching&gt; users &amp; keeps &quot;Invite&quot; visible/);
  assert.doesNotMatch(html, /<matching>|evil\.example|\/visuals\//);
  assert.ok(html.indexOf('Typing shows') < html.indexOf('<img src='), 'claim precedes screenshots');
  assert.match(html, /<video[^>]* controls[^>]*preload="none"[^>]* muted[^>]*playsinline/);
  assert.doesNotMatch(html, /<video[^>]*\bautoplay\b/);
  assert.match(html, /base <code>aaaaaaaa<\/code>/);
  assert.match(html, /head <code>bbbbbbbb<\/code>/);
  assert.match(html, /plan <code>cccccccccccc<\/code>/);
  assert.match(html, /2 clean replays/);
  assert.match(html, /1 bounded repair/);
  assert.match(html, /relative-pointer flow/);
  assert.match(html, /Captured/);
  assert.match(html, /Review the images and video to decide/);
  assert.match(html, /Play interaction/);
  assert.doesNotMatch(html, /Verified visual change preview/);
});

test('motion evidence labels its recording as an animation', () => {
  const value = evidence();
  value.claims[0].animation = 'motion';
  const html = AppView.visualEvidenceHtml(value, { sessionId: 42 });
  assert.match(html, /Play animation/);
  assert.doesNotMatch(html, /Play interaction/);
});

test('a static verified claim shows before and after PNGs without suggesting a video', () => {
  const value = evidence();
  value.claims[0].animation = 'none';
  value.artifacts = value.artifacts.filter((artifact) => artifact.variant !== 'animation');
  const html = AppView.visualEvidenceHtml(value, { sessionId: 42 });
  assert.match(html, /Review the before-and-after images/);
  assert.match(html, /<img src=/);
  assert.doesNotMatch(html, /<video|Play interaction|Play animation|images and video/);
});

test('absence is labelled only when the author explicitly declared a new base state', () => {
  const withoutBase = evidence({ artifacts: evidence().artifacts.filter((a) => a.side !== 'base') });
  const ordinary = AppView.visualEvidenceHtml(withoutBase, { sessionId: 42 });
  assert.match(ordinary, /Preview image unavailable/);
  assert.doesNotMatch(ordinary, /Not present in base/);

  withoutBase.claims = [{ ...withoutBase.claims[0], baseState: 'not_present' }];
  const absent = AppView.visualEvidenceHtml(withoutBase, { sessionId: 42 });
  assert.match(absent, /Not present in base/);
});

test('pending or failed v2 evidence shows claims and status but no media or legacy fallback', () => {
  for (const state of ['planned', 'failed', 'stale']) {
    const html = AppView.visualEvidenceHtml(evidence({
      state,
      failureReason: state === 'failed' ? 'The dialog could not be reached.' : null,
      repairAvailable: state === 'failed',
    }), { sessionId: 42 });
    assert.match(html, new RegExp(`data-evidence-state="${state}"`));
    assert.doesNotMatch(html, /<img|<video|\/visuals\//);
  }
  assert.equal(AppView._workshopVisuals({ after: { png: id('a') } }, evidence({ state: 'failed' })), null);
});

test('a failed preview can be manually retried after its automatic repair is spent', () => {
  const html = AppView.visualEvidenceHtml(evidence({
    state: 'failed', repairAvailable: false, repairCount: 1,
    failureCode: 'evidence_run_interrupted',
  }), { sessionId: 42, canManage: true });
  assert.match(html, /onclick="AppView\.rerunVisualEvidence\(42, this\)">Retry visual change preview<\/button>/);

  const readerHtml = AppView.visualEvidenceHtml(evidence({
    state: 'failed', repairAvailable: false, repairCount: 1,
    failureCode: 'evidence_run_interrupted',
  }), { sessionId: 42, canManage: false });
  assert.doesNotMatch(readerHtml, /Retry visual change preview/);

  const noStory = AppView.visualEvidenceHtml(evidence({
    state: 'failed', repairAvailable: false, claims: [],
    failureCode: 'missing_evidence_replay',
  }), { sessionId: 42 });
  assert.doesNotMatch(noStory, /Retry visual change preview/);

  const stale = AppView.visualEvidenceHtml(evidence({
    state: 'stale', repairAvailable: false,
  }), { sessionId: 42 });
  assert.doesNotMatch(stale, /Retry visual change preview/);
});

test('the workshop summary uses protected focus URLs only after verification', () => {
  const summary = AppView._workshopVisuals(null, evidence());
  assert.equal(summary.protected, true);
  assert.equal(summary.before, url('1'));
  assert.equal(summary.after, url('2'));
  assert.equal(summary.claim, evidence().claims[0].claim);
});

test('a running preview offers Stop, and a stopped one reads stopped with Retry', () => {
  const running = AppView.visualEvidenceHtml(evidence({ state: 'exploring', artifacts: [] }), { sessionId: 42, canManage: true });
  assert.match(running, /data-evidence-stop="1"[^>]*onclick="AppView\.stopVisualEvidence\(42, this\)">Stop</);
  const readerRunning = AppView.visualEvidenceHtml(evidence({ state: 'exploring', artifacts: [] }), { sessionId: 42, canManage: false });
  assert.doesNotMatch(readerRunning, /data-evidence-stop=/);
  const notStarted = AppView.visualEvidenceHtml(evidence({ state: 'planned', artifacts: [] }), { sessionId: 42 });
  assert.doesNotMatch(notStarted, /data-evidence-stop/, 'nothing is running to stop');

  const stopped = AppView.visualEvidenceHtml(evidence({
    state: 'failed', artifacts: [], failureCode: 'evidence_stopped', repairAvailable: false,
    failureReason: 'Stopped before it finished.',
  }), { sessionId: 42, canManage: true });
  assert.match(stopped, /Visual change preview stopped/);
  assert.doesNotMatch(stopped, /bg-red-500\/10/, 'a stop is not a failure');
  assert.match(stopped, /Retry visual change preview/);
  assert.doesNotMatch(stopped, /data-evidence-stop/);
});
