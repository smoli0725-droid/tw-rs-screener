import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
export const REPO_ROOT = path.resolve(SKILL_DIR, '../../..');
export const SITE_DIR = path.join(REPO_ROOT, 'site');
export const OUTPUT_APP = path.join(REPO_ROOT, 'output', 'app');
export const SITE_DATA = path.join(SITE_DIR, 'data');
export const ARTIFACTS_DIR = path.join(SKILL_DIR, 'artifacts');
export const RUN_DIR = path.join(ARTIFACTS_DIR, '.run');

export function host() {
  return process.env.TV_VERIFY_HOST || '127.0.0.1';
}

export function port() {
  const raw = process.env.TV_VERIFY_PORT || '4173';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`TV_VERIFY_PORT must be an integer 1–65535, got ${raw}`);
  }
  return n;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

export function readRunState() {
  const pidRaw = readText(path.join(RUN_DIR, 'server.pid'));
  const pid = pidRaw && /^\d+$/.test(pidRaw) ? Number(pidRaw) : null;
  return {
    pid,
    port: readText(path.join(RUN_DIR, 'port')),
    url: readText(path.join(RUN_DIR, 'url')),
    log: path.join(RUN_DIR, 'server.log'),
  };
}

export function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function baseUrl() {
  if (process.env.TV_VERIFY_URL) {
    return process.env.TV_VERIFY_URL.replace(/\/$/, '') + '/';
  }
  const state = readRunState();
  if (state.url) return state.url.endsWith('/') ? state.url : `${state.url}/`;
  return `http://${host()}:${port()}/`;
}

export function isLiveUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.endsWith('pages.dev') || u.hostname === 'tradingvenator.pages.dev';
  } catch {
    return false;
  }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
