const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type'
};

export async function handleProxy(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // 只允许代理 AO3 域名
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  if (!targetUrl.hostname.endsWith('archiveofourown.org')) {
    return new Response(JSON.stringify({ error: 'Only AO3 URLs are allowed' }), {
      status: 403, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // 加上 view_adult=true 参数（配合 cookie 可访问限制内容）
  targetUrl.searchParams.set('view_adult', 'true');

  try {
    const resp = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      redirect: 'follow'
    });

    const contentType = resp.headers.get('Content-Type') || 'text/html';
    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: { ...CORS, 'Content-Type': contentType }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Proxy fetch failed', detail: e.message }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
}
