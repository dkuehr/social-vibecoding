'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../src/services/visual-evidence-plan');
const { intent, plan } = require('./fixtures/visual-evidence');

test('semantic intent accepts a bounded visible-change story and fills safe defaults', () => {
  const parsed = evidence.parseIntent(intent());
  assert.equal(parsed.version, 1);
  assert.equal(parsed.stories[0].intent.animation, 'steps');
  assert.equal(parsed.stories[0].intent.baseState, 'present');
  assert.deepEqual(parsed.stories[0].viewports[0], { name: 'desktop', width: 1280, height: 800 });
});

test('new UI may explicitly label base absence without treating missing media as proof', () => {
  const candidate = intent();
  candidate.stories[0].intent.baseState = 'not_present';
  assert.equal(evidence.parseIntent(candidate).stories[0].intent.baseState, 'not_present');
  candidate.stories[0].intent.baseState = 'missing_image_means_absent';
  assert.equal(evidence.safeParseIntent(candidate).ok, false);
});

test('no-impact intent carries a rationale but no manufactured story', () => {
  const parsed = evidence.parseIntent({
    version: 1, impact: 'none', rationale: 'Only server-side retry accounting changed.', stories: [],
  });
  assert.equal(parsed.impact, 'none');
  assert.deepEqual(parsed.stories, []);
  assert.throws(() => evidence.parseIntent(intent({ impact: 'none' })), /No stories are allowed/);
});

test('visible impact requires a story and stories/viewports are capped', () => {
  assert.throws(() => evidence.parseIntent(intent({ stories: [] })), /At least one evidence story/);
  assert.throws(() => evidence.parseIntent(intent({ stories: Array.from({ length: 4 }, (_, i) => ({
    ...intent().stories[0], id: `story-${i}`,
  })) })), /at most 3/i);
  assert.throws(() => evidence.parseIntent(intent({ stories: [{
    ...intent().stories[0],
    viewports: [
      { name: 'desktop', width: 1280, height: 800 },
      { name: 'mobile', width: 390, height: 844 },
      { name: 'tablet', width: 768, height: 1024 },
    ],
  }] })), /at most 2/i);
});

test('paths are relative and cannot smuggle an origin or credential', () => {
  for (const value of [
    'https://evil.example/x', '//evil.example/x', 'settings', '/\\evil', '/%2f%2fevil',
    '/settings?token=secret', '/settings?password=demo',
    `/open/${encodeURIComponent('eyJabcdefgh.abcdefgh.abcdefgh')}`,
    '/invite/person@company.com',
  ]) {
    const candidate = intent();
    candidate.stories[0].intent.startPath = value;
    assert.equal(evidence.safeParseIntent(candidate).ok, false, value);
  }
  assert.equal(evidence.validRelativePath('/settings?tab=profile#name'), true);
});

test('typed fixtures reject credentials and real email addresses', () => {
  for (const value of ['Bearer abcdefghijklmnop', 'ghp_abcdefghijklmnop', 'person@company.com']) {
    const candidate = plan();
    candidate.stories[0].replay.after.actions[2] = {
      ...candidate.stories[0].replay.after.actions[2], value,
    };
    assert.equal(evidence.safeParseReplayPlan(candidate).ok, false, value);
  }
  const fixture = plan();
  fixture.stories[0].replay.after.actions[2].value = 'reviewer@example.test';
  assert.equal(evidence.safeParseReplayPlan(fixture).ok, true);
});

test('replay plans reject arbitrary script, xpath, root focus and unsupported keys', () => {
  const script = plan();
  script.stories[0].replay.after.actions.push({ id: 'run-code', stage: 'code', type: 'evaluate', value: 'document.body' });
  assert.equal(evidence.safeParseReplayPlan(script).ok, false);

  const xpath = plan();
  xpath.stories[0].replay.checkpoint.focus.after = { by: 'xpath', value: '//dialog' };
  assert.equal(evidence.safeParseReplayPlan(xpath).ok, false);

  const root = plan();
  root.stories[0].replay.checkpoint.focus.after = { by: 'css', value: 'body' };
  assert.equal(evidence.safeParseReplayPlan(root).ok, false);

  const key = plan();
  key.stories[0].replay.after.actions.push({ id: 'key', stage: 'key', type: 'press', key: 'Control+L' });
  assert.equal(evidence.safeParseReplayPlan(key).ok, false);
});

test('invalid replay actions report safe, actionable fields rather than an opaque union error', () => {
  const candidate = plan();
  candidate.stories[0].replay.before.actions = [
    { id: 'open-menu', stage: 'menu', type: 'click', locator: { by: 'role', role: 'button' } },
    { id: 'open-help', stage: 'Open Help', type: 'click', target: { by: 'testId', value: 'help' } },
    { id: 'go', stage: 'go', type: 'tap', target: { by: 'testId', value: 'help' } },
  ];
  const result = evidence.safeParseReplayPlan(candidate);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors[0], {
    path: ['stories', '0', 'replay', 'before', 'actions', '0', 'target'],
    message: 'Required',
  });
  assert.match(result.errors[1].message, /Unexpected field/);
  assert.deepEqual(result.errors[2], {
    path: ['stories', '0', 'replay', 'before', 'actions', '1', 'stage'],
    message: 'Use a lowercase slug with letters, digits, hyphens or underscores',
  });
  assert.deepEqual(result.errors[3].path, ['stories', '0', 'replay', 'before', 'actions', '2', 'type']);
  assert.match(result.errors[3].message, /Expected one of: navigate, click/);
  assert.doesNotMatch(JSON.stringify(result.errors), /Invalid input|locator/);
});

test('hosted replay submission receives the same field-level action error', () => {
  const replay = structuredClone(plan().stories[0].replay);
  delete replay.before.actions[0].target;
  assert.throws(() => evidence.replayPlanFromIntent(intent(), [
    { id: 'invite-suggestions', replay },
  ]), (error) => {
    assert.equal(error.code, 'invalid_visual_evidence');
    assert.deepEqual(error.issues[0], {
      path: ['0', 'replay', 'before', 'actions', '0', 'target'],
      message: 'Required',
    });
    return true;
  });
});

test('validation diagnostics do not copy unrecognized submitted field names', () => {
  const candidate = plan();
  candidate.stories[0].replay.before.actions[0]['private-token'] = 'secret-value';
  const result = evidence.safeParseReplayPlan(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /Unexpected field/);
  assert.doesNotMatch(JSON.stringify(result.errors), /private-token|secret-value/);
});

test('waits, action counts, pointer ratios and scroll distances are bounded', () => {
  const wait = plan();
  wait.stories[0].replay.after.actions.push({
    id: 'wait', stage: 'wait', type: 'waitFor', quietNetwork: true, timeoutMs: evidence.MAX_WAIT_MS + 1,
  });
  assert.equal(evidence.safeParseReplayPlan(wait).ok, false);

  const pointer = plan();
  pointer.stories[0].replay.after.actions.push({
    id: 'point', stage: 'point', type: 'clickPoint', surface: { by: 'css', value: 'canvas.game' }, xRatio: 1.1, yRatio: 0.5,
  });
  assert.equal(evidence.safeParseReplayPlan(pointer).ok, false);

  const scroll = plan();
  scroll.stories[0].replay.after.actions.push({ id: 'scroll', stage: 'scroll', type: 'scrollBy', x: 0, y: 2001 });
  assert.equal(evidence.safeParseReplayPlan(scroll).ok, false);

  const tooMany = plan();
  tooMany.stories[0].replay.after.actions = Array.from({ length: evidence.MAX_ACTIONS_PER_SIDE + 1 }, (_, i) => ({
    id: `click-${i}`, stage: `stage-${i}`, type: 'click', target: { by: 'testId', value: `target-${i}` },
  }));
  assert.equal(evidence.safeParseReplayPlan(tooMany).ok, false);
});

test('target waits can wait for hidden state but other waits cannot claim a state', () => {
  const candidate = plan();
  candidate.stories[0].replay.after.actions.push({
    id: 'wait-until-settled', stage: 'settled', type: 'waitFor',
    target: { by: 'css', value: '.is-animating' }, state: 'hidden', timeoutMs: 3000,
  });
  const parsed = evidence.parseReplayPlan(candidate);
  assert.equal(parsed.stories[0].replay.after.actions.at(-1).state, 'hidden');

  candidate.stories[0].replay.after.actions.at(-1).state = 'gone';
  assert.equal(evidence.safeParseReplayPlan(candidate).ok, false);
  candidate.stories[0].replay.after.actions[candidate.stories[0].replay.after.actions.length - 1] = {
    id: 'wait-until-settled', stage: 'settled', type: 'waitFor',
    text: 'Ready', state: 'hidden',
  };
  assert.equal(evidence.safeParseReplayPlan(candidate).ok, false);
});

test('wait-only checkpoints cannot request a steps video', () => {
  const staticPlan = plan();
  const wait = { id: 'wait-ready', stage: 'ready', type: 'waitFor',
    target: { by: 'testId', value: 'evidence-focus' } };
  staticPlan.stories[0].replay.before.actions = [wait];
  staticPlan.stories[0].replay.after.actions = [wait];
  assert.throws(() => evidence.parseReplayPlan(staticPlan), /wait-only flows use screenshots/);
  staticPlan.stories[0].intent.animation = 'none';
  staticPlan.stories[0].replay.checkpoint.animation = 'none';
  assert.equal(evidence.parseReplayPlan(staticPlan).stories[0].intent.animation, 'none');
});

test('controlled API failure is authorized by intent and identical on both revisions', () => {
  const candidate = plan();
  const story = candidate.stories[0];
  const path = '/api/lists/demo?source=evidence';
  story.intent.controlledFailurePath = path;
  story.intent.steps.unshift(evidence.CONTROLLED_FAILURE_LABEL);
  const enable = { id: 'block-list', stage: 'failure', type: 'requestFailure', path, enabled: true };
  story.replay.before.actions = [enable, ...story.replay.before.actions];
  story.replay.after.actions = [enable, ...story.replay.after.actions];
  assert.equal(evidence.parseReplayPlan(candidate).stories[0].intent.controlledFailurePath, path);

  story.replay.after.actions[0] = { ...enable, enabled: false };
  assert.match(evidence.safeParseReplayPlan(candidate).errors[0].message, /same declared request failure/);
  story.replay.after.actions[0] = enable;
  story.replay.before.actions[0] = { ...enable, path: '/api/other' };
  assert.equal(evidence.safeParseReplayPlan(candidate).ok, false);
  story.replay.before.actions[0] = enable;
  delete story.intent.controlledFailurePath;
  assert.equal(evidence.safeParseReplayPlan(candidate).ok, false);
});

test('controlled failure paths are exact same-origin API GET paths', () => {
  for (const path of ['/outside', '/api/list#fragment', '/api/*',
    'https://example.test/api/list', '/api/list?token=secret']) {
    const candidate = intent();
    candidate.stories[0].intent.controlledFailurePath = path;
    assert.equal(evidence.safeParseIntent(candidate).ok, false, path);
  }
  const candidate = intent();
  candidate.stories[0].intent.controlledFailurePath = '/api/list?item=one';
  assert.equal(evidence.safeParseIntent(candidate).ok, false);
  candidate.stories[0].intent.steps.unshift(evidence.CONTROLLED_FAILURE_LABEL);
  assert.equal(evidence.safeParseIntent(candidate).ok, true);
});

test('the canonical plan hash is stable across object key order and changes with behavior', () => {
  const first = plan();
  const parsed = evidence.parseReplayPlan(first);
  const reordered = {
    stories: parsed.stories,
    rationale: parsed.rationale,
    impact: parsed.impact,
    version: parsed.version,
  };
  assert.equal(evidence.planHash(first), evidence.planHash(reordered));
  const changed = plan();
  changed.stories[0].replay.after.actions[2].value = 'max';
  assert.notEqual(evidence.planHash(first), evidence.planHash(changed));
  assert.match(evidence.planHash(first), /^[0-9a-f]{64}$/);
});

test('relative pointer provenance and semantic projection are derived from validated plans', () => {
  const pointer = plan();
  pointer.stories[0].replay.after.actions.push({
    id: 'canvas-click', stage: 'canvas', type: 'clickPoint',
    surface: { by: 'css', value: 'canvas.game' }, xRatio: 0.62, yRatio: 0.41,
  });
  assert.equal(evidence.containsRelativePointer(pointer), true);
  const semantic = evidence.semanticIntentFromPlan(pointer);
  assert.equal(Object.hasOwn(semantic.stories[0], 'replay'), false);
  assert.deepEqual(semantic, evidence.parseIntent(intent()));
});

test('hosted replays inherit every accepted semantic field and accepted story order', () => {
  const accepted = intent();
  accepted.stories.push({
    ...structuredClone(accepted.stories[0]),
    id: 'second-story',
    claim: 'A second claim stays word for word as accepted.',
  });
  const executable = plan().stories[0].replay;
  const assembled = evidence.replayPlanFromIntent(accepted, [
    { id: 'second-story', replay: executable },
    { id: 'invite-suggestions', replay: executable },
  ]);
  assert.deepEqual(assembled.stories.map((story) => story.id),
    ['invite-suggestions', 'second-story']);
  assert.deepEqual(evidence.semanticIntentFromPlan(assembled), evidence.parseIntent(accepted));
});

test('hosted replays reject missing, duplicate, unknown, or altered story metadata', () => {
  const accepted = intent();
  const replay = plan().stories[0].replay;
  assert.throws(() => evidence.replayPlanFromIntent(accepted, []), /at least 1/i);
  assert.throws(() => evidence.replayPlanFromIntent(accepted, [
    { id: 'unknown-story', replay },
  ]), /not in the accepted intent/);
  assert.throws(() => evidence.replayPlanFromIntent(accepted, [
    { id: 'invite-suggestions', replay },
    { id: 'invite-suggestions', replay },
  ]), /duplicated/);
  assert.throws(() => evidence.replayPlanFromIntent(accepted, [
    { id: 'invite-suggestions', claim: 'A changed claim', replay },
  ]), /Unexpected field/);
  const changedAnimation = structuredClone(replay);
  changedAnimation.checkpoint.animation = 'none';
  assert.throws(() => evidence.replayPlanFromIntent(accepted, [
    { id: 'invite-suggestions', replay: changedAnimation },
  ]), /animation must match the accepted intent/);
});

test('author plan handoff is bound to the accepted claims, hash, and exact PR revisions', () => {
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const submitted = { baseSha, headSha, planHash: evidence.planHash(plan()), plan: plan() };
  const accepted = evidence.parseAuthorPlanSubmission(submitted, intent(), { baseSha, headSha });
  assert.deepEqual(accepted, { ...submitted, plan: evidence.parseReplayPlan(submitted.plan) });
  assert.throws(() => evidence.parseAuthorPlanSubmission(submitted, intent(), {
    baseSha, headSha: 'c'.repeat(40),
  }), /imported pull request headSha/);
  assert.throws(() => evidence.parseAuthorPlanSubmission({ ...submitted, planHash: '0'.repeat(64) }, intent()),
    /Does not match the submitted plan/);
  const changedIntent = intent();
  changedIntent.stories[0].claim = 'A different visual claim.';
  assert.throws(() => evidence.parseAuthorPlanSubmission(submitted, changedIntent), /accepted visual evidence intent/);
  assert.throws(() => evidence.parseAuthorPlanSubmission({ ...submitted, locallyVerified: true }, intent()),
    /Expected exactly/);
});
