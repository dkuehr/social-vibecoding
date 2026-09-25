// The change page as the Workshop's Needs-you item (task 497).
//
// A proposal's page used to read: the board card at full width; "About this
// change" (the summary folded to a line, the issues); "Where it stands" (the
// ledger); "More about this change" (the technical half and the testing
// steps, as accordion rows); the Discussion. It reads now the way a Needs-you
// item does — the hero: the eyebrow, the title, who proposed it, the tags as
// chips in the card's colours, the band with Vote first, the summary as a
// paragraph, the issue as a chip, the picture or the line that says it is
// coming — then the card's merge-requirements strip expanded into a steps
// sheet, then the Discussion. The technical half is a sheet the ⋯ menu opens;
// the testing steps live beside the preview and are not on the page.
//
// app-view.js builds the two view models (`_topicHeroView`, `_topicStepsView`)
// off the card model and the ledger rows the existing builders make;
// topic/topic-head.tsx draws them. These tests compose the two halves the way
// the store does at runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadTsx, renderToHtml, createElement } = require('./lib/render-tsx');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function context(user = { id: 42, username: 'Builder' }) {
  const c = { console, App: { user, currentApp: 'example', currentTab: 'dev', _appUrl: (slug, tab, ref) => `#app/${slug}/${tab}/issues/${ref?.id}` },
    relTime: () => 'just now',
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
    localStorage: { getItem: () => null }, addEventListener() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: { search: '', hash: '' }, URLSearchParams };
  c.window = c;
  vm.createContext(c);
  for (const p of ['public/js/merge-status.js', 'public/js/app-view.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, p), 'utf8'), c);
  }
  vm.runInContext('globalThis.av = AppView', c);
  c.av.appData = { slug: 'example', can_collaborate: true };
  c.av._proposalsCtx = { majority: 2, activeUsers: 5, locked: false };
  c.av._ghIssues = [{ number: 1993, title: 'Wait for authentication before opening previews' }];
  return c.av;
}

// Somebody else's proposal, up for a vote, with the gate's whole ordered list
// recorded — the shape the /promoted route serves (services/merge-requirements.js).
const gates = (over = {}) => [
  { key: 'approvals', label: 'Enough approvals', actor: 'group', state: 'waiting', detail: { note: '1 of 2' } },
  { key: 'integration', label: 'Merges cleanly with main', actor: 'auto', state: 'done', detail: { note: 'level with main, merges cleanly' } },
  { key: 'checks', label: 'Checks pass', actor: 'author', state: 'done', detail: null },
  { key: 'main_healthy', label: 'Main is healthy', actor: 'admin', state: 'done', detail: null },
  { key: 'github', label: 'GitHub accepts the merge', actor: 'auto', state: 'pending', detail: null },
].map((g) => ({ ...g, ...(over[g.key] || {}) }));

const PR = {
  id: 4090, user_id: 7, username: 'maya', status: 'promoted', source: 'native',
  pr_number: 12, pr_url: 'https://github.com/example/app/pull/12', pr_title: 'Authenticate previews',
  pr_summary_md: 'Previews wait for sign-in.', pr_body: 'The PR body: **technical prose**.',
  linked_issues: [1993], yes_count: 1, no_count: 0, votes_required: 2,
  created_at: '2026-09-11T12:00:00Z', staging_url: 'https://preview.example', check_state: 'passing',
  checks_checked_at: '2026-09-18T12:00:00Z',
  test_results: [{ name: 'Home loads', path: '/', status: 'pass' }],
  freshness: { mergeability: 'clean', behindBy: 0, checkedAt: '2026-09-18T12:00:00Z' },
  mergeRequirements: { measuredAt: '2026-09-18T12:00:00Z', gates: gates(), evaluated: true, provisional: false },
};

const plain = (o) => JSON.parse(JSON.stringify(o));
const render = (av, item, kind = 'proposal') => {
  const { ChangeDetail } = loadTsx('frontend/src/features/dev-board/topic/topic-head.tsx');
  const v = av._topicViewFor(kind, item);
  return { v, html: renderToHtml(createElement(ChangeDetail, { card: v.card, body: v.body, item, conversation: true })) };
};

test('the page is the hero, the steps sheet and the Discussion, in that order, and nothing the old shape had', () => {
  const av = context();
  const { html } = render(av, PR);
  const at = (s) => { const i = html.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('class="dev-topic-sheet dev-topic-hero"') < at('class="dev-topic-sheet dev-topic-steps"'));
  assert.ok(at('dev-topic-steps') < at('data-change-conversation="4090"'));
  for (const gone of ['dev-topic-card"', 'dev-topic-about"', 'dev-topic-ledger', 'dev-topic-more', 'About this change',
    'What changes for you', 'Where it stands', 'More about this change', 'Testing instructions', 'dev-topic-fold']) {
    assert.ok(!html.includes(gone), `${gone} is not on the page`);
  }
});

test('the hero: the eyebrow with the pull request and its state, the age, the title, the by-line, the tags as chips', () => {
  const av = context();
  const { v, html } = render(av, PR);
  const hero = plain(v.body.hero);
  assert.deepEqual(hero, {
    kind: 'Proposal', ref: { s: 'PR#12', href: 'https://github.com/example/app/pull/12' }, status: 'In review',
    age: hero.age, author: 'maya', verb: 'proposed', provenance: null, tint: 'b',
  });
  assert.ok(v.body.hero.age && v.body.hero.age.s, 'the age is the card meta line’s own part');
  assert.match(html, /<span class="dev-ws-eyebrow dev-topic-hero-eyebrow">Proposal · <a href="https:\/\/github\.com\/example\/app\/pull\/12" target="_blank" rel="noopener">PR#12<\/a><span> · In review<\/span><\/span><span class="dev-ws-item-of"[^>]*>/);
  assert.match(html, /<h2 class="dev-ws-item-title dev-topic-hero-title">Authenticate previews<\/h2>/);
  assert.match(html, /<p class="dev-ws-item-by dev-topic-hero-by"><span class="dev-ws-item-avatar" style="background:#[0-9a-f]{6}" aria-hidden="true">M<\/span><span><b>maya<\/b><span> · proposed /);
  // The chips are the card's own tag specs (their tints ride along), and
  // the linkage; the state tags stay off the hero, the steps say it.
  const chips = html.slice(html.indexOf('dev-topic-hero-chips'), html.indexOf('dev-topic-hero-actions'));
  assert.match(chips, /data-attr-chip="" data-attr-field="priority"/);
  assert.match(chips, /data-issue-chip="1993"[^>]*>Closes #1993</);
  assert.doesNotMatch(chips, /data-status-tag/);
  assert.doesNotMatch(html, /data-status-tag/, 'no state tag anywhere on the page');
  // The summary is a paragraph, not a fold.
  assert.match(html, /<div class="dev-topic-hero-summary dev-topic-about-body" data-topic-part="summary">[\s\S]{0,120}Previews wait for sign-in\./);
});

test('the band is the card’s, Vote first, with Preview and the ⋯ at its right end', () => {
  const av = context();
  const { html } = render(av, PR);
  const band = html.slice(html.indexOf('<div class="dev-card-topic dev-topic-hero-actions">'), html.indexOf('<div class="dev-topic-hero-summary'));
  assert.match(band, /<div class="gc-card-actions"><button type="button" class="dev-vote-btn"/, 'Vote opens the band');
  const order = ['dev-vote-btn', 'gc-explore-chat-btn', '>Share<', 'gc-vote-btn-preview', 'data-card-menu="detail:proposal:4090"'].map((s) => band.indexOf(s));
  assert.ok(order.every((i) => i >= 0), `every control is on the band: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'in that order');
  assert.match(band, /data-card-menu="detail:proposal:4090"[^>]*>[\s\S]*<\/button><\/div><\/div>$/, 'the ⋯ closes the band');
});

test('the ⋯ menu carries Technical details as a row of its own, which opens the sheet', () => {
  const av = context();
  const { v, html } = render(av, PR);
  const menu = av._cardMenuItems(v.card.rail.menuKey);
  assert.equal(menu[0].label, 'Technical details');
  assert.equal(menu[0].icon, 'details');
  assert.ok(av.MENU_ICONS.details, 'the glyph resolves');
  assert.ok(menu.some((a) => a.label === 'Open on GitHub'));
  // Closed until asked: the sheet renders nothing on the page itself.
  assert.ok(!html.includes('technical prose'));
  assert.ok(!html.includes('dev-details-card'));
  const src = read('public/js/app-view.js');
  assert.match(src, /openTechnicalDetails\(id\) \{\n\s+window\.dispatchEvent\(new CustomEvent\('change-details-open', \{ detail: Number\(id\) \}\)\);/);
  const tsx = read('frontend/src/features/dev-board/topic/topic-head.tsx');
  assert.match(tsx, /window\.addEventListener\('change-details-open', onOpen\)/);
  assert.match(tsx, /createPortal\(\n\s+<div className="dev-details-scrim"/, 'body-mounted: a frosted sheet would contain a fixed box');
  // No row without a technical half to open.
  const bare = av._topicViewFor('proposal', { ...PR, pr_body: null, pr_summary_md: null, spec_md: null });
  assert.ok(!av._cardMenuItems(bare.card.rail.menuKey).some((a) => a.label === 'Technical details'));
});

test('the steps sheet is the strip expanded: its headline and count, one row per gate in the gate’s order, each saying what its ledger row said', () => {
  const av = context();
  const { v, html } = render(av, PR);
  const s = plain(v.body.steps);
  assert.equal(s.headline, 'Waiting on your vote');
  assert.deepEqual([s.done, s.total], [3, 5]);
  assert.deepEqual(s.rows.map((r) => [r.gate, r.key, r.state, r.label, r.actor]), [
    ['approvals', 'votes', 'waiting', 'Vote', 'the group'],
    ['integration', 'integration', 'done', 'Merges cleanly with main', 'automatic'],
    ['checks', 'checks', 'done', 'Checks pass', 'the author'],
    ['main_healthy', 'main_healthy', 'done', 'Main is healthy', 'an admin'],
    ['github', 'github', 'pending', 'GitHub accepts the merge', 'automatic'],
  ]);
  // The vote step: the same counts the pill reads, the roster line, the help.
  assert.deepEqual(s.rows[0].vote && [s.rows[0].vote.yes, s.rows[0].vote.no, s.rows[0].vote.majority], [1, 0, 2]);
  assert.ok(s.rows[0].vote.pill && s.rows[0].vote.pill.label, 'the card’s pill state rides along');
  assert.equal(s.rows[0].row.key, 'votes');
  // A quiet ledger row yields to the gate's own words; the checks keep theirs.
  assert.equal(s.rows[1].row, null);
  assert.equal(s.rows[1].note, 'level with main, merges cleanly');
  assert.equal(s.rows[2].row.key, 'checks');
  assert.match(html, /<div class="dev-steps-head"><span class="dev-steps-headline">Waiting on your vote<\/span><span class="dev-steps-detail">· 1 of 2<\/span><span class="dev-steps-count">3\/5<\/span><\/div>/);
  assert.match(html, /<li class="dev-step dev-step-waiting" data-note="votes" data-req-gate="approvals" data-req-state="waiting"><span class="dev-step-mark dev-step-mark-waiting" aria-hidden="true">!<\/span><span class="dev-step-label">Vote<\/span><span class="dev-step-actor">the group<\/span><div class="dev-step-body"><div class="dev-step-vote"><span class="dev-step-vote-bar" aria-hidden="true"><i style="width:50%"><\/i><\/span><span class="gc-vote-count /);
  assert.match(html, /<span class="dev-step-vote-tally">Yes 1 · No 0<\/span>/);
  assert.match(html, /data-note="votes"[\s\S]*?<span class="dev-ledger-review-line"><span class="dev-ledger-roster">Loading votes…<\/span><span class="dev-ledger-help voting-help-hint">/);
  assert.match(html, /<li class="dev-step dev-step-done" data-note="checks" data-req-gate="checks" data-req-state="done"><span class="dev-step-mark dev-step-mark-done" aria-hidden="true">✓<\/span>[\s\S]*?<span class="dev-ledger-lead dev-ledger-lead-ok">Passing\.<\/span> The one check passed on this build\.<span class="dev-step-when"> Last run [^<]+<\/span>/);
  assert.match(html, /<li class="dev-step dev-step-pending" data-note="github" data-req-gate="github" data-req-state="pending"><span class="dev-step-mark dev-step-mark-pending" aria-hidden="true">·<\/span><span class="dev-step-label">GitHub accepts the merge<\/span><span class="dev-step-actor">automatic<\/span><\/li>/);
});

test('a failing check sits under the blocked Checks step with its door, and the sync row keeps its sentence under the merge step', () => {
  const av = context();
  const item = {
    ...PR, check_state: 'failing',
    test_results: [{ name: 'Home loads', path: '/', status: 'fail', failureReason: 'Expected app, received login' }],
    freshness: { mergeability: 'conflict', behindBy: 8, mergeabilityFiles: ['a.js', 'b.js'], checkedAt: '2026-09-18T12:00:00Z' },
    mergeRequirements: { gates: gates({ checks: { state: 'blocked', detail: { note: 'some checks are failing' } }, integration: { state: 'active', detail: { note: 'resolving a conflict with main (2 files)' } } }), evaluated: true, provisional: false },
  };
  const { v, html } = render(av, item);
  const s = plain(v.body.steps);
  assert.equal(s.headline, 'Waiting on your vote', 'the strip names the first outstanding step: the vote comes before the sync');
  const sync = s.rows.find((r) => r.gate === 'integration');
  assert.equal(sync.key, 'mergeability', 'the ledger row’s key is the data-note, so the declared checks still find it');
  assert.equal(sync.state, 'active');
  assert.match(html, /data-note="mergeability" data-req-gate="integration" data-req-state="active"><span class="dev-step-mark dev-step-mark-active" aria-hidden="true"><span class="dc-status-icon dc-status-spinner-arc"/);
  assert.match(html, /Main has moved 8 commits ahead, and 2 files changed on both sides/);
  const checks = s.rows.find((r) => r.gate === 'checks');
  assert.equal(checks.state, 'blocked');
  assert.match(html, /data-note="checks" data-req-gate="checks" data-req-state="blocked">[\s\S]*?<ul class="dev-ledger-fails"><li class="dev-ledger-check dev-ledger-check-why"><details class="dev-ledger-why"><summary class="dev-ledger-check-line">/);
  assert.match(html, /Expected app, received login/);
});

// #2588 retired the tail this test used to end on. The sheet's rows are the
// merge gates and the states of the change — a failed preview, console
// errors — and nothing else: the provenance notes that used to draw after
// them said where the change came from, which the hero line above the card
// says, and inside an x/y progress indicator that read as a step nobody
// could ever clear. The hero's own words are asserted here unchanged.
test('rows no gate claims draw after the gates in the same shape: a failed preview beside the checks, and no provenance note after them', () => {
  const av = context();
  const item = { ...PR, source: 'imported', imported_pr_author: 'octo', staging_url: null, staging_error: 'container never came up', check_state: 'error' };
  const { v } = render(av, item);
  const s = plain(v.body.steps);
  const keys = s.rows.map((r) => `${r.key}:${r.state}`);
  const i = (k) => keys.findIndex((x) => x.startsWith(`${k}:`));
  assert.ok(i('preview') > i('checks') && i('preview') < i('main_healthy'), `the failed preview sits beside the checks: ${keys}`);
  assert.equal(i('imported'), -1, `no imported row on the sheet: ${keys}`);
  assert.equal(i('agent'), -1, `no built-with row either: ${keys}`);
  assert.equal(keys[keys.length - 1], 'github:pending', `the last row is a gate, as every row now is: ${keys}`);
  assert.equal(v.body.hero.verb, 'imported');
  assert.equal(v.body.hero.provenance, 'imported from GitHub (octo)');
});

test('before review the page is the same shape: the change’s own status in the eyebrow, and the ledger as the steps with no gates yet', () => {
  const av = context();
  const mine = { ...PR, user_id: 42, status: 'active', pr_number: null, pr_url: null, mergeRequirements: undefined, shared_at: null, spec_md: '# Spec' };
  const { v, html } = render(av, mine, 'session');
  assert.equal(v.body.hero.kind, 'Change');
  assert.equal(v.body.hero.ref, null);
  assert.equal(v.body.hero.status, 'Private change');
  assert.equal(v.body.hero.verb, 'started');
  assert.match(html, /<span class="dev-ws-eyebrow dev-topic-hero-eyebrow">Change · Private change<\/span>/);
  const s = plain(v.body.steps);
  assert.equal(s.headline, 'Where it stands');
  assert.equal(s.total, null);
  assert.ok(s.rows.every((r) => !r.gate), 'no gates before review: every row is the ledger’s');
  assert.ok(s.rows.some((r) => r.key === 'review'), 'the submission state is one of them');
  assert.match(html, />Submit for review</);
  assert.match(html, />Continue building</);
  // The spec stands in for the technical half, behind the ⋯ row.
  assert.ok(av._cardMenuItems(v.card.rail.menuKey).some((a) => a.label === 'Technical details'));
});

test('the picture: verified evidence keeps its card, a run under way spins, and a failed claim can be retried from the change page', () => {
  const av = context();
  const claim = { claim: 'The preview waits for sign-in', viewports: ['desktop'], steps: ['Open a preview'] };
  const building = render(av, { ...PR, visualEvidence: { state: 'exploring', claims: [claim], artifacts: [] } }).html;
  assert.match(building, /<p class="dev-topic-hero-evidence" data-evidence-state="exploring"><span class="dc-status-spinner-arc" aria-hidden="true"><\/span><span>Building before\/after photos<\/span><\/p>/);
  assert.ok(!building.includes('data-visual-evidence="1"'), 'no panel for a run still going');
  const failed = render(av, { ...PR, visualEvidence: { state: 'failed', failureReason: 'The dialog never opened.', repairAvailable: false, claims: [claim], artifacts: [] } }).html;
  assert.match(failed, /<div class="dev-topic-evidence flex-wrap" data-evidence-state="failed"><span class="dev-badge bg-red-500\/10 text-red-700 dark:text-red-400">Visual change preview failed<\/span>/);
  assert.match(failed, /aria-label="Retry visual change preview"[^>]*>Retry preview<\/button>/);
  const withoutClaim = render(av, { ...PR, visualEvidence: { state: 'failed', claims: [], artifacts: [] } }).html;
  assert.doesNotMatch(withoutClaim, /aria-label="Retry visual change preview"/);
  const conflicting = render(av, { ...PR, visualEvidence: { state: 'failed', failureCode: 'visual_evidence_intent_conflict', claims: [claim], artifacts: [] } }).html;
  assert.doesNotMatch(conflicting, /aria-label="Retry visual change preview"/);
  const verified = render(av, { ...PR, visualEvidence: { state: 'verified', claims: [claim], artifacts: [], baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) } }).html;
  assert.match(verified, /<div class="dev-topic-visuals" data-visuals-scope="1"><div class="usn-visuals-body">/);
  assert.ok(!verified.includes('dev-topic-hero-evidence'));
});

test('an issue page keeps the card and the sections under it', () => {
  const av = context();
  const issue = { number: 1993, title: 'Wait for authentication before opening previews', body: 'The preview opens on the login page.', state: 'open', user: { login: 'maya' }, created_at: '2026-09-11T12:00:00Z' };
  const { v, html } = render(av, issue, 'issue');
  assert.equal(v.body.hero, undefined);
  assert.equal(v.body.steps, undefined);
  assert.match(html, /class="dev-topic-sheet dev-topic-card" data-topic-sheet="card"/);
  assert.ok(!html.includes('dev-topic-hero'));
});

test('the band is one component for the card and the hero, and the card’s pinned lines still hold', () => {
  const card = read('frontend/src/features/dev-board/card/dev-card.tsx');
  assert.match(card, /export function ActionBand\(\{ actions, menuKey, preview, lead, actionEnd, dense \}/);
  assert.match(card, /<ActionBand\n\s+actions=\{bandActions\}\n\s+menuKey=\{m\.rail\.menuKey \|\| ''\}\n\s+preview=\{m\.actionPreview \|\| m\.rail\.preview \|\| null\}\n\s+actionEnd=\{actionEnd\}\n\s+dense=\{dense\}\n\s+\/>/, 'DevCard draws its band through it');
  assert.match(card, /if \(!hasActions && !lead\) return dense \? <div className="gc-card-actions"><\/div> : null;/, 'a lead (the hero’s Vote) is a band on its own');
  assert.match(card, /<div className="gc-card-actions" ref=\{folded\.ref\} data-band-measured=\{folded\.measured \? '1' : undefined\}>\n\s+\{lead\}\n/, 'the lead is a fixed child before the pills');
  const tsx = read('frontend/src/features/dev-board/topic/topic-head.tsx');
  assert.match(tsx, /<div className="dev-card-topic dev-topic-hero-actions">\n\s+<ActionBand actions=\{pills\} menuKey=\{card\.rail\.menuKey \|\| ''\} preview=\{card\.actionPreview \|\| card\.rail\.preview \|\| null\} lead=\{vote\} dense=\{false\} \/>/);
  const css = read('public/css/app.css');
  assert.match(css, /\.dev-topic-hero > div\.dev-topic-hero-actions\.dev-card-topic \{[^}]*box-shadow: none;[^}]*--dev-edge-w: 0px;/, 'the card’s box comes off the hero’s band');
  assert.match(css, /\.dev-topic-hero > \.dev-topic-hero-chips \{[^}]*justify-content: flex-start;/, 'the chips sit under the by-line, not at the item’s right');
  assert.match(css, /\.dev-topic-hero > \.dev-topic-hero-title \{[^}]*-webkit-line-clamp: unset;/, 'the title is not clamped');
});

test('the hero\'s band is as tall as its Vote button, so neither is cut flat (QA 2026-09-24 Q26)', () => {
  // The band reserves and clips ONE row (`max-height` + `overflow: hidden`),
  // sized for the 28px pills. The hero also carries the 30px Vote button, so
  // on a phone the Vote pill and the round menu button lost their bottoms.
  const css = read('public/css/app.css');
  const vote = /\n\.dev-vote-btn \{([^}]*)\}/.exec(css);
  const voteH = Number(/height: (\d+)px;/.exec(vote[1])[1]);
  const hero = /\.dev-topic-hero \.gc-card-actions \{([^}]*)\}/.exec(css);
  assert.ok(hero, 'the hero sizes its own band');
  assert.equal(Number(/max-height: (\d+)px;/.exec(hero[1])[1]), voteH, 'the clip window fits the Vote button');
  assert.equal(Number(/min-height: (\d+)px;/.exec(hero[1])[1]), voteH);
  // It still clips one row: the second starts a 6px gap below the first.
  const card = /:is\(\.dev-card-dense, \.dev-card-topic\) \.gc-card-actions \{([^}]*)\}/.exec(css);
  assert.match(card[1], /overflow: hidden;/);
  assert.match(card[1], /gap: 6px;/);
  assert.ok(css.indexOf('.dev-topic-hero .gc-card-actions {') > css.indexOf(':is(.dev-card-dense, .dev-card-topic) .gc-card-actions {'),
    'and it comes later than the card rule of equal specificity, so it wins');
});

test('no bare whitespace expression, no em dash in copy, no computed Tailwind class', () => {
  const tsx = read('frontend/src/features/dev-board/topic/topic-head.tsx');
  assert.doesNotMatch(tsx, /\{' '\}/);
  // Every utility the steps panel wears is the strip's own complete literal.
  assert.match(tsx, /className="dev-steps rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800\/50"/);
  assert.match(tsx, /className="dev-steps-list border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"/);
});

// ── #2601/#2558: "planned" is two different things ───────────────────────
//
// `recordIntent` writes 'planned' onto a proposal the moment it declares a
// claim, and only a scheduled run moves it on. So the same state covers a
// run minted seconds ago and one nothing ever picked up — and every surface
// spun on both. Five minutes of an untouched 'planned' is the product
// owner's line between them.
const IDLE = 5 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const CLAIM = { claim: 'The preview waits for sign-in', viewports: ['desktop'], steps: ['Open a preview'] };

test('a fresh planned run is in progress, and says so in the words the state uses', () => {
  const av = context();
  const evidence = { state: 'planned', updatedAt: ago(30 * 1000), claims: [CLAIM], artifacts: [] };
  assert.equal(av._evidenceNotStarted(evidence), false);
  const v = av._evidenceView(evidence);
  assert.equal(v.label, 'Visual preview in progress');
  assert.equal(v.notStarted, false);
  // It is still a run under way, so the page keeps the quiet spinner line
  // rather than a panel that reads as a verdict.
  const { html } = render(av, { ...PR, visualEvidence: evidence });
  assert.match(html, /<p class="dev-topic-hero-evidence" data-evidence-state="planned"><span class="dc-status-spinner-arc" aria-hidden="true"><\/span><span>Building before\/after photos<\/span><\/p>/);
});

test('a planned run untouched past five minutes has not started: no spinner, the reason, and the retry', () => {
  const av = context();
  const evidence = {
    state: 'planned',
    updatedAt: ago(IDLE + 60 * 1000),
    notStartedReason: 'Visual change previews are not being run on this deployment.',
    claims: [CLAIM],
    artifacts: [],
  };
  assert.equal(av._evidenceNotStarted(evidence), true);
  const v = av._evidenceView(evidence);
  assert.equal(v.label, 'Visual preview not started');
  assert.equal(v.notStarted, true);
  assert.match(v.sentence, /not being run on this deployment/);
  assert.ok(!/Homeroom records before-and-after captures/.test(v.sentence),
    'a run that never started is not promising captures are being taken');

  const { html } = render(av, { ...PR, visualEvidence: evidence });
  assert.ok(!html.includes('dc-status-spinner-arc'), 'nothing spins on a run that is not moving');
  assert.ok(!html.includes('Building before/after photos'));
  // The panel, not the one-line strip: this is the pending state with
  // something for the reader to do.
  assert.match(html, /data-visual-evidence="1" data-evidence-state="planned"/);
  assert.match(html, /Visual preview not started/);
  assert.match(html, /Visual change previews are not being run on this deployment\./);
  assert.match(html, /onclick="AppView\.rerunVisualEvidence\(4090, this\)">Retry visual change preview<\/button>/);
});

test('with no reason recorded the not-started state still stands on its own', () => {
  const av = context();
  const evidence = { state: 'planned', updatedAt: ago(IDLE + 1000), claims: [CLAIM], artifacts: [] };
  const v = av._evidenceView(evidence);
  assert.equal(v.label, 'Visual preview not started');
  assert.match(v.sentence, /nothing has picked this preview up yet/i);
});

test('an unknown or missing timestamp reads as still starting, never as stuck', () => {
  const av = context();
  for (const updatedAt of [undefined, null, '', 'not a date']) {
    assert.equal(av._evidenceNotStarted({ state: 'planned', updatedAt }), false,
      `a ${JSON.stringify(updatedAt)} timestamp must not be read as an idle run`);
  }
  // And the threshold itself is the five minutes that was asked for.
  assert.equal(av.EVIDENCE_IDLE_MS, 5 * 60 * 1000);
  assert.equal(av._evidenceNotStarted({ state: 'planned', updatedAt: ago(IDLE - 30 * 1000) }), false);
  // Only 'planned' is ever read this way: the other pending states are
  // written by a run that is demonstrably executing.
  for (const state of ['provisioning', 'exploring', 'replaying', 'reviewing', 'failed', 'verified']) {
    assert.equal(av._evidenceNotStarted({ state, updatedAt: ago(IDLE * 10) }), false, state);
  }
});

test('the card tag follows the same split, and only the moving one spins', () => {
  const av = context();
  const reasons = (evidence) => av.blockReasons({ ...PR, visualEvidence: evidence })
    .find((r) => r.key === 'visual_evidence');

  const moving = reasons({ state: 'planned', updatedAt: ago(10 * 1000), required: true });
  assert.equal(moving.label, 'Visual preview in progress');
  assert.equal(moving.running, true);

  const stuck = reasons({
    state: 'planned', updatedAt: ago(IDLE + 1000), required: true,
    notStartedReason: 'No staging preview was built for this commit.',
  });
  assert.equal(stuck.label, 'Visual preview not started');
  assert.equal(stuck.running, false, 'the neutral in-flight tone is what read as "any moment now"');
  assert.equal(stuck.detail, 'No staging preview was built for this commit.');

  // #2604's noun stands everywhere else: only the two in-flight states
  // were renamed.
  const failed = reasons({ state: 'failed', updatedAt: ago(IDLE * 2), required: true, failureReason: 'The dialog never opened.' });
  assert.equal(failed.label, 'Visual change preview failed');
  assert.equal(failed.running, false);
  const exploring = reasons({ state: 'exploring', updatedAt: ago(IDLE * 2), required: true });
  assert.equal(exploring.label, 'Visual preview in progress');
  assert.equal(exploring.running, true);
});

test('the settled states keep #2604’s wording word for word', () => {
  const av = context();
  const copy = (evidence) => av._evidenceStateCopy(evidence);
  const at = copy({ state: 'planned', updatedAt: ago(10 * 1000) });
  assert.equal(at.failed[0], 'Visual change preview failed');
  assert.equal(at.stale[0], 'Visual change preview is stale');
  assert.equal(at.cancelled[0], 'Visual change preview cancelled');
  assert.equal(at.not_required[0], 'No visual change preview required');
  assert.equal(at.overridden[0], 'Preview requirement overridden');
});
