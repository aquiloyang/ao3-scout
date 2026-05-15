import { handleAuth } from './auth.js';
import { handleAPI } from './api.js';
import { handleProxy } from './proxy.js';
import { handleCron } from './cron.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // OPTIONS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type'
        }
      });
    }

    try {
      // 认证路由
      if (url.pathname.startsWith('/auth/')) {
        return handleAuth(request, env);
      }

      // AO3 CORS 代理
      if (url.pathname === '/proxy') {
        return handleProxy(request);
      }

      // 健康检查
      if (url.pathname === '/health') {
        return new Response(
          JSON.stringify({ ok: true, version: '0.1.0', ts: Date.now() }),
          { headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
      }

      // API 路由（用户端点 + 内部端点）
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/')) {
        return handleAPI(request, env);
      }

      return new Response(
        JSON.stringify({ error: 'Not found' }),
        { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    } catch (e) {
      console.error('Unhandled error:', e);
      return new Response(
        JSON.stringify({ error: 'Internal server error', detail: e.message }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }
  },

  // Cron Trigger：每日 23:00 UTC
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  }
};
