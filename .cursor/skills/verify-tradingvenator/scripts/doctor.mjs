#!/usr/bin/env node
/**
 * Read-only health check: is this TradingVenator instance worth driving?
 * HTTP + data + Clerk placeholder detection. Pass --ui to classify the auth surface.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACTS_DIR,
  OUTPUT_APP,
  REPO_ROOT,
  RUN_DIR,
  SITE_DATA,
  SITE_DIR,
  baseUrl,
  isLiveUrl,
  pidAlive,
  readRunState,
  writeJson,
} from './lib.mjs';

const args = new Set(process.argv.slice(2));
const wantUi = args.has('--ui');

function fail(report, message) {
  report.ok = false;
  report.error = message;
  console.error(`tv-verify doctor: FAIL ${message}`);
  console.log(JSON.stringify(report, null, 2));
  writeJson(path.join(ARTIFACTS_DIR, '.run', 'doctor.json'), report);
  process.exit(1);
}

async function fetchStatus(url) {
  const res = await fetch(url, { redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, headers: Object.fromEntries(res.headers) };
}

const report = {
  ok: false,
  url: baseUrl(),
  live: false,
  pid: null,
  pid_alive: false,
  index_status: null,
  meta_status: null,
  data_date: null,
  clerk: null,
  auth_surface: null,
  signed_in: null,
  bypass_required: false,
  site_data: SITE_DATA,
  output_app: OUTPUT_APP,
};

report.live = isLiveUrl(report.url);

if (!report.live) {
  const state = readRunState();
  report.pid = state.pid;
  report.pid_alive = pidAlive(state.pid);
  if (!state.pid) {
    fail(report, `no recorded pid at ${path.join(RUN_DIR, 'server.pid')}; run scripts/serve.sh first or set TV_VERIFY_URL`);
  }
  if (!report.pid_alive) {
    fail(report, `recorded pid ${state.pid} is not running; run scripts/serve.sh or scripts/cleanup.sh`);
  }
  if (!fs.existsSync(path.join(SITE_DIR, 'index.html'))) {
    fail(report, `missing ${path.join(SITE_DIR, 'index.html')}`);
  }
  if (!fs.existsSync(path.join(SITE_DATA, 'meta.json'))) {
    fail(report, `missing ${path.join(SITE_DATA, 'meta.json')}; serve.sh should have linked output/app`);
  }
}

try {
  const index = await fetchStatus(report.url);
  report.index_status = index.status;
  if (index.status !== 200) {
    fail(report, `GET ${report.url} -> ${index.status}`);
  }
  if (!index.text.includes('TradingVenator')) {
    fail(report, `GET ${report.url} 200 but body is not TradingVenator`);
  }

  const metaUrl = new URL('data/meta.json', report.url).href;
  const metaRes = await fetchStatus(metaUrl);
  report.meta_status = metaRes.status;
  if (metaRes.status === 200) {
    try {
      const meta = JSON.parse(metaRes.text);
      report.data_date = meta.data_date || null;
      report.market_label = meta.market && meta.market.label;
      report.counts = meta.counts || null;
    } catch {
      report.meta_parse = 'invalid json';
    }
  } else if (!report.live) {
    fail(report, `GET ${metaUrl} -> ${metaRes.status} (bundled data not reachable)`);
  } else {
    report.meta_note = 'live /data/meta.json not 200; signed-in app still loads ./data after Clerk';
  }

  const configUrl = new URL('js/config.js', report.url).href;
  const config = await fetchStatus(configUrl);
  if (config.status === 200) {
    if (config.text.includes('__CLERK_PUBLISHABLE_KEY__')) {
      report.clerk = 'placeholder';
      report.bypass_required = true;
      report.auth_hint =
        'Local static serve has no Clerk key. Unauthenticated proof: auth-gate "尚未設定 Clerk". Signed-in proof: drive.mjs --bypass-auth (harness-only; does not sign in).';
    } else if (/pk_(test|live)_/.test(config.text)) {
      report.clerk = 'configured';
      report.auth_hint =
        'Clerk JS will mount #sign-in. Signed-in flows need a real session (TV_VERIFY_STORAGE) or an already-signed-in browser. Do not bypass-auth on the live site.';
    } else {
      report.clerk = 'unknown';
    }
  }
} catch (err) {
  fail(report, `fetch failed: ${err.message}`);
}

if (wantUi) {
  try {
    const { classifyAuth } = await import('./drive.mjs');
    const ui = await classifyAuth({
      url: report.url,
      bypassAuth: false,
      headed: process.env.TV_VERIFY_HEADED === '1',
    });
    report.auth_surface = ui.surface;
    report.signed_in = ui.signedIn;
    report.ui = ui;
  } catch (err) {
    report.ui_error = err.message;
    report.auth_hint = `${report.auth_hint || ''} UI doctor skipped: ${err.message}`.trim();
  }
}

report.ok = true;
report.repo_root = REPO_ROOT;
console.log(JSON.stringify(report, null, 2));
writeJson(path.join(ARTIFACTS_DIR, '.run', 'doctor.json'), report);
if (report.clerk === 'placeholder') {
  console.error('tv-verify doctor: OK (Clerk placeholder — signed-in features need --bypass-auth)');
} else {
  console.error('tv-verify doctor: OK');
}
