import { signJWT } from './crypto.js';

export async function handleAuth(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/auth/github') {
    // client=tampermonkey 时回调到 AO3；否则回调到 Pages
    const client = url.searchParams.get('client') || 'pages';
    const state = `${crypto.randomUUID()}:${client}`;
    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    authUrl.searchParams.set('scope', 'read:user');
    authUrl.searchParams.set('state', state);
    return Response.redirect(authUrl.toString(), 302);
  }

  if (url.pathname === '/auth/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') || '';
    if (!code) return jsonError('Missing code', 400);

    const [, client] = state.split(':');

    // 用 code 换 access token
    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code
      })
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) return jsonError('OAuth failed', 400);

    // 获取 GitHub 用户信息
    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'AO3-Scout/1.0'
      }
    });
    const ghUser = await userResp.json();

    // 写入或更新用户表
    await env.DB.prepare(`
      INSERT INTO users (github_id, github_login, last_active)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(github_id) DO UPDATE SET
        github_login = excluded.github_login,
        last_active  = datetime('now')
    `).bind(String(ghUser.id), ghUser.login).run();

    // 新用户初始化 preferences / stats 行
    await env.DB.prepare(`
      INSERT OR IGNORE INTO preferences (user_id)
      SELECT id FROM users WHERE github_id = ?
    `).bind(String(ghUser.id)).run();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO stats (user_id)
      SELECT id FROM users WHERE github_id = ?
    `).bind(String(ghUser.id)).run();

    const user = await env.DB.prepare(
      'SELECT id FROM users WHERE github_id = ?'
    ).bind(String(ghUser.id)).first();

    const jwt = await signJWT(
      { sub: user.id, github_id: String(ghUser.id), login: ghUser.login },
      env.JWT_SECRET
    );

    // Tampermonkey 流：带 token 跳回 AO3 首页
    if (client === 'tampermonkey') {
      const redirect = new URL('https://archiveofourown.org/');
      redirect.searchParams.set('ao3scout_token', jwt);
      return Response.redirect(redirect.toString(), 302);
    }

    // Pages 流：带 token 跳回手机端网页
    const redirect = new URL(env.PAGES_URL);
    redirect.searchParams.set('token', jwt);
    return Response.redirect(redirect.toString(), 302);
  }

  return jsonError('Not found', 404);
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
