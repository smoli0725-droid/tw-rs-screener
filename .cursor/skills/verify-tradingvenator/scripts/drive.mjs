#!/usr/bin/env node
/**
 * Playwright harness for TradingVenator site/.
 * Prefer ids and data-* from site/index.html over coordinates.
 *
 *   node scripts/drive.mjs --feature recommend
 *   node scripts/drive.mjs --feature auth-gate
 *   node scripts/drive.mjs --feature recommend --bypass-auth
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACTS_DIR,
  SKILL_DIR,
  baseUrl,
  ensureDir,
  isLiveUrl,
  writeJson,
} from './lib.mjs';

const FEATURES = [
  'auth-gate',
  'recommend',
  'patterns',
  'trade-tracking',
  'portfolio',
  'settings',
  'teaching',
];

function parseArgs(argv) {
  const out = {
    feature: 'recommend',
    bypassAuth: process.env.TV_VERIFY_BYPASS_AUTH === '1',
    headed: process.env.TV_VERIFY_HEADED === '1',
    url: null,
    storage: process.env.TV_VERIFY_STORAGE || null,
    list: false,
    classifyOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--feature') out.feature = argv[++i];
    else if (a === '--bypass-auth') out.bypassAuth = true;
    else if (a === '--no-bypass-auth') out.bypassAuth = false;
    else if (a === '--headed') out.headed = true;
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--storage') out.storage = argv[++i];
    else if (a === '--list') out.list = true;
    else if (a === '--classify-only') out.classifyOnly = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function chromeLaunchOptions(headed) {
  const executablePath = process.env.CHROME_PATH || process.env.TV_VERIFY_CHROME || '';
  const opts = {
    headless: !headed,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  };
  if (executablePath && fs.existsSync(executablePath)) {
    opts.executablePath = executablePath;
  } else {
    opts.channel = 'chrome';
  }
  return opts;
}

async function launchBrowser(headed) {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch(chromeLaunchOptions(headed));
  } catch (err) {
    const fallback = '/usr/local/bin/google-chrome';
    if (fs.existsSync(fallback)) {
      return chromium.launch({
        executablePath: fallback,
        headless: !headed,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    }
    throw err;
  }
}

async function openPage(browser, opts) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'zh-TW',
    storageState: opts.storage || undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  return { context, page };
}

async function readAuth(page) {
  return page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { present: false, hidden: true, text: '' };
      const cs = getComputedStyle(el);
      const hidden =
        el.hidden ||
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        Number(cs.opacity) === 0;
      return { present: true, hidden, text: (el.innerText || '').trim().slice(0, 1500) };
    };
    const signedIn = document.body.classList.contains('signed-in');
    const setup = vis('#auth-setup');
    const signIn = vis('#sign-in');
    const gate = vis('#auth-gate');
    let surface = 'unknown';
    if (signedIn) surface = 'app';
    else if (!setup.hidden && /尚未設定 Clerk|Clerk 載入失敗/.test(setup.text)) surface = 'setup';
    else if (!signIn.hidden || /登入後才能查看/.test(gate.text)) surface = 'sign-in';
    return {
      title: document.title,
      bodyClass: document.body.className,
      signedIn,
      surface,
      setup,
      signIn,
      gate,
      metaLine: (document.querySelector('#metaLine') || {}).textContent || '',
    };
  });
}

async function bypassAuth(page) {
  await page.waitForFunction(
    () => window.RS_APP && typeof window.RS_APP.start === 'function',
    null,
    { timeout: 15000 }
  );
  await page.evaluate(async () => {
    document.body.classList.remove('signed-out');
    document.body.classList.add('signed-in');
    const gate = document.getElementById('auth-gate');
    if (gate) {
      gate.hidden = true;
      gate.style.display = 'none';
    }
    await window.RS_APP.start();
  });
  await page.waitForFunction(() => {
    const el = document.getElementById('metaLine');
    return el && el.textContent && !el.textContent.includes('載入資料中');
  });
}

async function waitLoaded(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('metaLine');
    return el && el.textContent && !el.textContent.includes('載入資料中');
  });
}

async function snapshotDom(page) {
  return page.evaluate(() => {
    const pack = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const view = el.closest('.view');
      const hidden =
        el.hidden ||
        cs.display === 'none' ||
        (view != null && !view.classList.contains('active'));
      return {
        hidden,
        text: (el.innerText || '').trim().slice(0, 2500),
      };
    };
    const items = (sel) =>
      [...document.querySelectorAll(`${sel} article.item`)].slice(0, 8).map((el) => ({
        title: (el.querySelector('.item-title') || {}).innerText || el.innerText.slice(0, 120),
        badge: (el.querySelector('.badge') || {}).innerText || '',
      }));
    return {
      title: document.title,
      bodyClass: document.body.className,
      activeNav: document.querySelector('.nav-item.active')?.getAttribute('data-view') || null,
      activeTab: document.querySelector('#view-recommend .tab.active')?.getAttribute('data-sub') || null,
      metaLine: pack('#metaLine'),
      marketCard: pack('#marketCard'),
      rs85List: pack('#rs85List'),
      rs85Items: items('#rs85List'),
      patternCount: pack('#patternCount'),
      patternList: pack('#patternList'),
      patternItems: items('#patternList'),
      tradeCount: pack('#tradeCount'),
      tradeList: pack('#tradeList'),
      tradeItems: items('#tradeList'),
      tradeChipsActive: [...document.querySelectorAll('#tradeChips .chip.active')].map((c) => c.getAttribute('data-trade')),
      statusChipsActive: [...document.querySelectorAll('#statusChips .chip.active')].map((c) => c.getAttribute('data-status')),
      positionList: pack('#positionList'),
      totalMv: pack('#totalMv'),
      dataBaseUrl: document.querySelector('#dataBaseUrl')?.value || null,
      dataStatusBody: pack('#dataStatusBody'),
      accountBody: pack('#accountBody'),
      teachingList: pack('#teachingList'),
      teachingListPane: pack('#teachingListPane'),
      teachingDetailPane: pack('#teachingDetailPane'),
      teachingDetail: pack('#teachingDetail'),
      teachingPosts: [...document.querySelectorAll('#teachingList article.post')].slice(0, 8).map((el) => ({
        id: el.getAttribute('data-lesson-id') || '',
        title: (el.querySelector('.post-title') || {}).innerText || '',
        excerpt: (el.querySelector('.post-excerpt') || {}).innerText || '',
      })),
      teachingOwnerBarHidden: (() => {
        const el = document.querySelector('#teachingOwnerBar');
        if (!el) return true;
        return el.hidden || getComputedStyle(el).display === 'none';
      })(),
      teachingBody: (document.querySelector('#teachingDetail .post-body') || {}).innerText || '',
      teachingTitle: (document.querySelector('#teachingDetail .post-title') || {}).innerText || '',
    };
  });
}

async function ariaSnapshot(page) {
  try {
    return await page.locator('body').ariaSnapshot();
  } catch (err) {
    return `# ariaSnapshot unavailable: ${err.message}\n`;
  }
}

async function saveEvidence(outDir, name, page, extra) {
  ensureDir(outDir);
  const png = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: png, fullPage: false });
  const snap = await snapshotDom(page);
  const aria = await ariaSnapshot(page);
  fs.writeFileSync(path.join(outDir, `${name}.aria.yml`), aria);
  writeJson(path.join(outDir, `${name}.snapshot.json`), { ...snap, extra: extra || null });
  return { png, snap };
}

async function clickNav(page, view) {
  await page.locator(`button.nav-item[data-view="${view}"]`).click();
  await page.waitForFunction((v) => {
    const el = document.querySelector(`#view-${v}`);
    return el && el.classList.contains('active');
  }, view);
}

async function clickTab(page, sub) {
  await page.locator(`#view-recommend button.tab[data-sub="${sub}"]`).click();
  await page.waitForFunction((s) => {
    const el = document.querySelector(`#sub-${s}`);
    return el && el.classList.contains('active');
  }, sub);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function driveAuthGate(page, outDir) {
  const auth = await readAuth(page);
  const shot = await saveEvidence(outDir, '01-gate', page, { auth });
  const appHidden = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    if (!shell) return true;
    return getComputedStyle(shell).display === 'none';
  });
  assert(appHidden, 'app-shell should stay hidden while signed out');
  assert(
    auth.surface === 'setup' || auth.surface === 'sign-in',
    `expected setup or sign-in gate, got ${auth.surface}`
  );
  const gateText = `${auth.gate.text}\n${auth.setup.text}`;
  assert(
    /尚未設定 Clerk|登入後才能查看|Sign in|Continue/i.test(gateText) || auth.surface === 'sign-in',
    `gate text missing Clerk/login copy: ${gateText.slice(0, 200)}`
  );
  return {
    ok: true,
    feature: 'auth-gate',
    surface: auth.surface,
    proof: ['01-gate.png', '01-gate.aria.yml'],
    notes: shot.snap.metaLine,
  };
}

async function ensureSignedInView(page, opts, url) {
  const auth = await readAuth(page);
  if (auth.signedIn) {
    await waitLoaded(page);
    return { ...auth, bypassed: false };
  }
  if (opts.bypassAuth) {
    if (isLiveUrl(url)) {
      throw new Error('refusing --bypass-auth on the live site; use TV_VERIFY_STORAGE or a signed-in test account');
    }
    await bypassAuth(page);
    return { ...(await readAuth(page)), bypassed: true };
  }
  throw new Error(
    `not signed in (surface=${auth.surface}). For local Clerk placeholder re-run with --bypass-auth. For live, pass --storage <playwright-storage.json> from a disposable test account.`
  );
}

async function driveRecommend(page, outDir) {
  await saveEvidence(outDir, '01-before-nav', page);
  await clickNav(page, 'recommend');
  await page.locator('#marketCard').waitFor({ state: 'visible' });
  await page.locator('#rs85List').waitFor({ state: 'visible' });
  const after = await saveEvidence(outDir, '02-recommend', page);
  const card = after.snap.marketCard?.text || '';
  assert(/市況/.test(card), `#marketCard should mention 市況, got: ${card.slice(0, 180)}`);
  assert(after.snap.activeNav === 'recommend', 'nav 推薦 should be active');
  assert(after.snap.activeTab === 'rs85', 'default tab should be RS≥85');
  const listText = after.snap.rs85List?.text || '';
  assert(
    after.snap.rs85Items.length > 0 || /沒有符合的股票/.test(listText),
    `#rs85List empty without empty-state copy: ${listText.slice(0, 180)}`
  );
  const meta = after.snap.metaLine?.text || '';
  assert(/資料/.test(meta), `#metaLine should show 資料 date, got: ${meta}`);
  return {
    ok: true,
    feature: 'recommend',
    market: card.split('\n')[0],
    meta,
    rs85_sample: after.snap.rs85Items.slice(0, 3),
    proof: ['01-before-nav.png', '02-recommend.png', '02-recommend.aria.yml', '02-recommend.snapshot.json'],
  };
}

async function drivePatterns(page, outDir) {
  await clickNav(page, 'recommend');
  await clickTab(page, 'patterns');
  await page.locator('#patternList').waitFor({ state: 'visible' });
  const before = await saveEvidence(outDir, '01-default-status', page);
  await page.locator('#statusChips .chip[data-status="整理中"]').click();
  await page.waitForTimeout(200);
  const after = await saveEvidence(outDir, '02-include-consolidating', page);
  assert(after.snap.activeTab === 'patterns', '型態／突破 tab should be active');
  assert(
    (after.snap.statusChipsActive || []).includes('整理中'),
    '整理中 chip should be active after click'
  );
  return {
    ok: true,
    feature: 'patterns',
    default_count: before.snap.patternCount?.text,
    with_consolidating: after.snap.patternCount?.text,
    sample: after.snap.patternItems.slice(0, 3),
    proof: ['01-default-status.png', '02-include-consolidating.png'],
  };
}

async function driveTrades(page, outDir) {
  await clickNav(page, 'recommend');
  await clickTab(page, 'breakouts');
  await page.locator('#tradeList').waitFor({ state: 'visible' });
  const allOn = await saveEvidence(outDir, '01-all-chips', page);
  const chips = ['active', 'success', 'recovered'];
  for (const key of chips) {
    await page.locator(`#tradeChips .chip[data-trade="${key}"]`).click();
  }
  await page.waitForTimeout(200);
  const onlyFailed = await saveEvidence(outDir, '02-failed-only', page);
  assert(onlyFailed.snap.activeTab === 'breakouts', '交易追蹤 tab should be active');
  const active = onlyFailed.snap.tradeChipsActive || [];
  assert(active.includes('failed') && active.length === 1, `expected only 失敗 chip, got ${active}`);
  const badges = (onlyFailed.snap.tradeItems || []).map((i) => i.badge);
  const unexpected = badges.filter((b) => b && !b.includes('失敗'));
  assert(unexpected.length === 0, `失敗 filter leaked other badges: ${JSON.stringify(badges)}`);
  return {
    ok: true,
    feature: 'trade-tracking',
    all_count: allOn.snap.tradeCount?.text,
    failed_only_count: onlyFailed.snap.tradeCount?.text,
    failed_sample: onlyFailed.snap.tradeItems.slice(0, 3),
    note: 'Filter uses trade.status (失敗), not outcome. recovered rows with outcome=failed stay hidden. reentered rows are not listed.',
    proof: ['01-all-chips.png', '02-failed-only.png'],
  };
}

async function drivePortfolio(page, outDir) {
  await clickNav(page, 'portfolio');
  await page.locator('#positionList').waitFor({ state: 'visible' });
  const shot = await saveEvidence(outDir, '01-holdings', page);
  const text = shot.snap.positionList?.text || '';
  assert(
    /尚未有持股|損益/.test(`${text}\n${shot.snap.totalMv?.text || ''}`) || shot.snap.positionList,
    'portfolio view missing list or summary'
  );
  assert(shot.snap.activeNav === 'portfolio', 'nav 持股 should be active');
  return {
    ok: true,
    feature: 'portfolio',
    empty_or_rows: text.slice(0, 240),
    totalMv: shot.snap.totalMv?.text,
    proof: ['01-holdings.png'],
    note: 'Read-only. Do not submit 新增持股 / 賣出 / 刪除 on the live site without a dedicated test account.',
  };
}

async function driveSettings(page, outDir) {
  await clickNav(page, 'settings');
  await page.locator('#dataBaseUrl').waitFor({ state: 'visible' });
  const shot = await saveEvidence(outDir, '01-settings', page);
  const url = shot.snap.dataBaseUrl;
  assert(url != null, '#dataBaseUrl missing');
  return {
    ok: true,
    feature: 'settings',
    dataBaseUrl: url,
    dataStatus: shot.snap.dataStatusBody?.text,
    proof: ['01-settings.png'],
    note: 'Read-only by default. Saving a new URL mutates localStorage (and D1 when signed in).',
  };
}

async function driveTeaching(page, outDir) {
  await clickNav(page, 'teaching');
  await page.locator('#teachingList').waitFor({ state: 'visible' });
  const listShot = await saveEvidence(outDir, '01-list', page);
  assert(listShot.snap.activeNav === 'teaching', 'nav 教學 should be active');
  const posts = listShot.snap.teachingPosts || [];
  assert(posts.length > 0, 'teaching list should have seeded posts');
  const titles = posts.map((p) => p.title).join('\n');
  assert(!/Course\s*\d|課程\s*\d/.test(titles), `posts should not be numbered like Course 1: ${titles}`);
  assert(posts[0].excerpt && posts[0].excerpt.length > 10, 'list should show a passage excerpt');
  assert(listShot.snap.teachingOwnerBarHidden, 'owner composer should stay hidden without a Clerk owner session');
  await page.locator('#teachingList article.post').first().click();
  await page.locator('#teachingDetailPane').waitFor({ state: 'visible' });
  const detailShot = await saveEvidence(outDir, '02-detail', page);
  const body = detailShot.snap.teachingBody || '';
  assert(body.length > (posts[0].excerpt || '').length, 'detail should show the full passage, not only the excerpt');
  assert(/返回/.test(await page.locator('#teachingBackBtn').innerText()), 'detail needs 返回');
  await page.locator('#teachingBackBtn').click();
  await page.locator('#teachingListPane').waitFor({ state: 'visible' });
  const backShot = await saveEvidence(outDir, '03-back', page);
  assert(!backShot.snap.teachingListPane?.hidden, 'list should be visible after 返回');
  return {
    ok: true,
    feature: 'teaching',
    posts: posts.slice(0, 3),
    detail_title: detailShot.snap.teachingTitle,
    proof: ['01-list.png', '02-detail.png', '03-back.png'],
    note: 'Owner create/edit is hidden under --bypass-auth (no Clerk user).',
  };
}

const DRIVERS = {
  'auth-gate': driveAuthGate,
  recommend: driveRecommend,
  patterns: drivePatterns,
  'trade-tracking': driveTrades,
  portfolio: drivePortfolio,
  settings: driveSettings,
  teaching: driveTeaching,
};

export async function classifyAuth(opts) {
  const browser = await launchBrowser(opts.headed);
  try {
    const { context, page } = await openPage(browser, opts);
    await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const auth = await readAuth(page);
    await context.close();
    return auth;
  } finally {
    await browser.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage: node drive.mjs --feature <${FEATURES.join('|')}> [--bypass-auth] [--url URL] [--storage FILE]
Env: TV_VERIFY_URL TV_VERIFY_PORT TV_VERIFY_BYPASS_AUTH=1 TV_VERIFY_STORAGE TV_VERIFY_HEADED=1 CHROME_PATH`);
    process.exit(0);
  }
  if (opts.list) {
    console.log(FEATURES.join('\n'));
    process.exit(0);
  }
  const url = (opts.url || baseUrl()).replace(/\/?$/, '/');
  if (opts.classifyOnly) {
    const auth = await classifyAuth({ url, storage: opts.storage, headed: opts.headed });
    console.log(JSON.stringify(auth, null, 2));
    return;
  }
  if (!FEATURES.includes(opts.feature)) {
    throw new Error(`unknown feature ${opts.feature}; expected ${FEATURES.join(', ')}`);
  }

  const outDir = path.join(ARTIFACTS_DIR, opts.feature);
  ensureDir(outDir);
  const browser = await launchBrowser(opts.headed);
  const result = {
    ok: false,
    feature: opts.feature,
    url,
    bypassAuth: opts.bypassAuth,
    outDir: path.relative(path.resolve(SKILL_DIR, '../../..'), outDir),
    startedAt: new Date().toISOString(),
  };
  try {
    const { context, page } = await openPage(browser, opts);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#auth-gate, .app-shell', { timeout: 15000 });
    await page.waitForTimeout(600);

    if (opts.feature === 'auth-gate') {
      Object.assign(result, await driveAuthGate(page, outDir));
    } else {
      result.auth = await ensureSignedInView(page, opts, url);
      Object.assign(result, await DRIVERS[opts.feature](page, outDir));
    }
    result.finishedAt = new Date().toISOString();
    writeJson(path.join(outDir, 'result.json'), result);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    await context.close();
  } catch (err) {
    result.ok = false;
    result.error = err.message;
    result.finishedAt = new Date().toISOString();
    writeJson(path.join(outDir, 'result.json'), result);
    console.error(`tv-verify drive: FAIL ${err.message}`);
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  } finally {
    await browser.close();
  }
}

const invoked = process.argv[1] && path.normalize(process.argv[1]).endsWith('drive.mjs');
if (invoked) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
