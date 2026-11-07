// Login con Discord: solo entran miembros del servidor con alguno de los roles permitidos.

const enc = new TextEncoder();
const SESSION_HOURS = 12;

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}
export async function verify(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body));
  if (!ok) return null;
  const data = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  if (data.exp && Date.now() > data.exp) return null;
  return data;
}

function cookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}
function setCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function currentUser(req, env) {
  if (env.DEV_NO_AUTH === '1') return { id: 'dev', name: 'Dev local' };
  return verify(cookie(req, 'fb_session'), env.SESSION_SECRET);
}

function redirectUri(req) {
  return `${new URL(req.url).origin}/auth/callback`;
}

export async function login(req, env) {
  const state = crypto.randomUUID();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('scope', 'identify guilds.members.read');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'none');
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), 'Set-Cookie': setCookie('fb_state', state, 600) },
  });
}

export async function callback(req, env) {
  const u = new URL(req.url);
  const code = u.searchParams.get('code');
  if (!code || u.searchParams.get('state') !== cookie(req, 'fb_state')) return page("Couldn't sign you in. Please try again.", 400);

  const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(req),
    }),
  });
  if (!tokenRes.ok) return page('Discord rejected the sign-in. Check the Redirect URL in the Discord developer portal.', 400);
  const { access_token } = await tokenRes.json();

  const memberRes = await fetch(`https://discord.com/api/v10/users/@me/guilds/${env.GUILD_ID}/member`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!memberRes.ok) return page("This Discord account isn't in the DUNK server.", 403);
  const member = await memberRes.json();
  const allowed = String(env.ALLOWED_ROLE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!member.roles?.some((r) => allowed.includes(r))) return page("Your account doesn't have the role needed to see this.", 403);

  const user = member.user;
  const session = await sign(
    {
      id: user.id,
      name: member.nick || user.global_name || user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null,
      exp: Date.now() + SESSION_HOURS * 3600 * 1000,
    },
    env.SESSION_SECRET,
  );
  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie', setCookie('fb_session', session, SESSION_HOURS * 3600));
  headers.append('Set-Cookie', setCookie('fb_state', '', 0));
  return new Response(null, { status: 302, headers });
}

export function logout() {
  return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': setCookie('fb_session', '', 0) } });
}

export function page(msg, status = 200) {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>DUNK Feedback</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--text:#1b1b1a;--muted:#6b6a65;--line:#e4e2dc}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--card:#1a1a19;--text:#f0efec;--muted:#a3a29b;--line:#2c2c2a}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px 28px;max-width:360px;margin:16px;text-align:center}
h1{font-size:22px;margin:0 0 6px}h1 b{color:#eb6834}p{color:var(--muted);margin:0 0 20px}
a{display:inline-flex;gap:8px;align-items:center;background:#5865f2;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:600}
</style>
<div class="card"><h1><b>DUNK</b> Feedback</h1><p>${msg}</p><a href="/auth/login">Sign in with Discord</a></div>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
}
