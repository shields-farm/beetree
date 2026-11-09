#!/usr/bin/env node
/**
 * BeeTree Slack bridge — Socket Mode, no public URL, no dependencies.
 *
 * Slack Event → this bridge → BeeTree /api/chat → reply in thread.
 *
 * Why Socket Mode: BeeTree runs on the Mac Studio behind Tailscale, so an
 * inbound HTTPS webhook would mean exposing the box to the internet. Socket Mode
 * opens an outbound WebSocket instead — nothing is reachable from outside.
 *
 * WHO CAN TALK TO IT: whoever can post in a channel the bot has been invited to.
 * There is no allowlist here on purpose — Mark's ask was "let anyone in
 * bee-ai-research talk to BeeTree", and the channel's own membership is the
 * access control. Remove the bot from a channel to revoke it.
 *
 * Env:
 *   SLACK_APP_TOKEN   xapp-...   (Basic Information → App-Level Tokens, scope connections:write)
 *   SLACK_BOT_TOKEN   xoxb-...   (Install App → Bot User OAuth Token)
 *   BEETREE_URL       default http://127.0.0.1:3001
 *   BEETREE_API_KEY   the server's BEETREE_API_KEY from server/.env
 *   SLACK_CHANNELS    optional comma-separated channel IDs to restrict to;
 *                     unset = any channel the bot is in
 */

const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN ?? '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? '';
const BEETREE_URL = (process.env.BEETREE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const BEETREE_API_KEY = process.env.BEETREE_API_KEY ?? '';
const CHANNEL_ALLOW = (process.env.SLACK_CHANNELS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!process.argv.includes('--selftest')) {
  if (!SLACK_APP_TOKEN.startsWith('xapp-')) {
    console.error('SLACK_APP_TOKEN missing or not an xapp- token (Basic Information → App-Level Tokens, scope connections:write)');
    process.exit(2);
  }
  if (!SLACK_BOT_TOKEN.startsWith('xoxb-')) {
    console.error('SLACK_BOT_TOKEN missing or not an xoxb- token (Install App → Bot User OAuth Token)');
    process.exit(2);
  }
}
if (!BEETREE_API_KEY) {
  console.error('BEETREE_API_KEY missing (copy it from beetree/server/.env)');
  process.exit(2);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// `node bridge.mjs --selftest` exercises only the BeeTree side: proves the bot's
// HTTP contract (auth, payload, answer shape) without needing Slack tokens.
if (process.argv.includes('--selftest')) {
  const q = process.argv[process.argv.indexOf('--selftest') + 1] ?? 'anything urgent right now?';
  askBeeTree(q).then((r) => {
    if (r.error) { console.error('FAIL', r.error); process.exit(1); }
    console.log('OK  BeeTree answered:', r.content.slice(0, 160));
    process.exit(0);
  }).catch((e) => { console.error('FAIL', e.message); process.exit(1); });
}


// ─── BeeTree ────────────────────────────────────────────────────────────────
// The web app talks to /api/chat with stream:true and reads an SSE `data:` line.
// Non-streaming is the simpler contract for a bot that only needs the final text.
async function askBeeTree(text, history = []) {
  const res = await fetch(`${BEETREE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BEETREE_API_KEY}`,
    },
    body: JSON.stringify({
      messages: [...history, { role: 'user', content: text }],
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { return { error: `BeeTree returned ${res.status}: ${raw.slice(0, 200)}` }; }

  if (!res.ok || data.error) {
    return { error: data.error || `BeeTree returned ${res.status}`, code: data.code };
  }
  const content = (data.content ?? '').trim();
  if (!content) return { error: 'BeeTree returned an empty answer.' };
  return { content, followUps: data.followUps ?? [] };
}

// ─── Slack ──────────────────────────────────────────────────────────────────
async function slack(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.error}`);
  return data;
}

async function reply(channel, threadTs, text) {
  // Slack's 40k char limit is generous, but the API rejects empty text.
  const body = text.length > 39_000 ? text.slice(0, 39_000) + '\n\n…(truncated)' : text;
  await slack('chat.postMessage', { channel, thread_ts: threadTs, text: body, unfurl_links: false });
}

async function react(channel, ts, emoji) {
  try { await slack('reactions.add', { channel, name: emoji, timestamp: ts }); } catch { /* non-fatal */ }
}

async function history(channel, limit = 6) {
  // Minimal context: BeeTree keeps its own sessions, and a Slack thread is not
  // authoritative. Six turns is enough for "and what about the other hive?".
  try {
    const data = await slack('conversations.history', { channel, limit });
    return (data.messages ?? [])
      .filter(m => typeof m.text === 'string' && m.text.trim() && !m.bot_id)
      .reverse()
      .map(m => ({ role: 'user', content: m.text.replace(/<@[^>]+>/g, '').trim() }))
      .filter(m => m.content);
  } catch {
    return [];
  }
}

// Strip the bot mention and Slack's link wrapper so BeeTree sees clean prose.
function cleanText(text, botUserId) {
  return (text ?? '')
    .replace(new RegExp(`<@${botUserId}>`, 'g'), '')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .trim();
}

// ─── Event handling ─────────────────────────────────────────────────────────
const BOT_USER_ID = { value: null };

async function handleEvent(envelope) {
  const event = envelope.event ?? {};
  const type = event.type;

  if (type === 'app_mention') return handleMessage(event, true);
  if (type === 'message' && !event.subtype && !event.bot_id) {
    // message.channels / message.groups arrive for every message in a channel the
    // bot is in; only answer when addressed. message.im is always addressed.
    const isDM = event.channel_type === 'im';
    if (isDM) return handleMessage(event, false);
    const mentioned = BOT_USER_ID.value && (event.text ?? '').includes(`<@${BOT_USER_ID.value}>`);
    if (mentioned) return handleMessage(event, true);
  }
}

async function handleMessage(event, wasMention) {
  if (event.bot_id || event.subtype) return;
  if (CHANNEL_ALLOW.length && !CHANNEL_ALLOW.includes(event.channel)) return;

  const text = cleanText(event.text, BOT_USER_ID.value);
  if (!text) return;

  const threadTs = event.thread_ts ?? event.ts;
  log(`question in ${event.channel}: ${text.slice(0, 80)}`);

  await react(event.channel, event.ts, 'eyes');
  const prior = event.thread_ts ? await history(event.channel, 8) : [];

  const started = Date.now();
  const answer = await askBeeTree(text, prior);
  log(`answered in ${Date.now() - started}ms${answer.error ? ' (error)' : ''}`);

  if (answer.error) {
    await reply(event.channel, threadTs, answer.error);
    await react(event.channel, event.ts, 'warning');
    return;
  }

  let body = answer.content;
  if (answer.followUps?.length) {
    body += '\n\n' + answer.followUps.map(f => `• ${f}`).join('\n');
  }
  await reply(event.channel, threadTs, body);
  await react(event.channel, event.ts, 'white_check_mark');
}

// ─── Socket Mode loop ───────────────────────────────────────────────────────
let ws = null;
let backoff = 1000;

async function connect() {
  if (!BOT_USER_ID.value) {
    try {
      const res = await fetch('https://slack.com/api/auth.test', {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      });
      const data = await res.json();
      if (data.ok) BOT_USER_ID.value = data.user_id;
      log(`connected as ${data.user ?? '?'} (${data.team ?? '?'}) bot=${BOT_USER_ID.value}`);
    } catch (e) {
      log('auth.test failed:', e.message);
    }
  }

  const res = await fetch('https://slack.com/api/apps.connections.open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${SLACK_APP_TOKEN}`,
    },
  });
  const data = await res.json();
  if (!data.ok) {
    // invalid_auth here almost always means the app-level token lacks connections:write
    throw new Error(`apps.connections.open: ${data.error}`);
  }

  ws = new WebSocket(data.url);

  ws.addEventListener('open', () => {
    backoff = 1000;
    log('socket open');
  });

  ws.addEventListener('message', async (msg) => {
    let envelope;
    try { envelope = JSON.parse(msg.data); } catch { return; }

    if (envelope.type === 'hello') { log('hello'); return; }

    if (envelope.type === 'events_api') {
      // Ack before doing any work: Slack revokes the connection after 3s.
      ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
      try {
        await handleEvent(envelope.payload ?? envelope);
      } catch (e) {
        log('handler error:', e.message);
      }
      return;
    }

    if (envelope.type === 'disconnect') {
      log(`slack asked to reconnect (${envelope.reason}); refreshing socket`);
      try { ws.close(); } catch {}
      return;
    }
  });

  ws.addEventListener('close', () => {
    const wait = backoff;
    backoff = Math.min(backoff * 2, 60_000);
    log(`socket closed; reconnecting in ${wait}ms`);
    setTimeout(() => connect().catch(e => log('reconnect failed:', e.message)), wait);
  });

  ws.addEventListener('error', (e) => log('socket error:', e.message ?? 'unknown'));
}

process.on('SIGTERM', () => { try { ws?.close(); } catch {} process.exit(0); });
process.on('SIGINT', () => { try { ws?.close(); } catch {} process.exit(0); });

if (process.argv.includes('--selftest')) {
  const q = process.argv[process.argv.indexOf('--selftest') + 1] ?? 'anything urgent right now?';
  askBeeTree(q).then((r) => {
    if (r.error) { console.error('FAIL', r.error); process.exit(1); }
    console.log('OK  BeeTree answered:', r.content.slice(0, 160));
    process.exit(0);
  }).catch((e) => { console.error('FAIL', e.message); process.exit(1); });
} else {
  connect().catch((e) => { log('fatal:', e.message); process.exit(1); });
}
