import { authenticate, encrypt, decrypt } from './crypto.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function err(msg, status = 400) {
  return json({ error: msg, code: `E${status}` }, status);
}

function enableFK(env) {
  return env.DB.prepare('PRAGMA foreign_keys = ON').run();
}

// ─── 路由分发 ────────────────────────────────────────────────────────────────

export async function handleAPI(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const path = url.pathname;

  // 内部端点（Scanner 服务调用）
  if (path.startsWith('/internal/')) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (token !== env.SCANNER_SERVICE_TOKEN) return err('Unauthorized', 401);
    return handleInternal(request, env, path);
  }

  // 用户端点（JWT 认证）
  const user = await authenticate(request, env);
  if (!user && path.startsWith('/api/')) return err('Unauthorized', 401);

  if (path === '/api/preferences') {
    if (request.method === 'GET') return getPreferences(env, user);
    if (request.method === 'PUT') return putPreferences(request, env, user);
  }
  if (path === '/api/recommendations') return getRecommendations(request, env, user);
  if (path === '/api/journal') {
    if (request.method === 'GET') return getJournal(request, env, user);
    if (request.method === 'POST') return postJournal(request, env, user);
  }
  if (path === '/api/reading-list') {
    if (request.method === 'GET') return getReadingList(env, user);
    if (request.method === 'POST') return postReadingList(request, env, user);
  }
  if (path.startsWith('/api/reading-list/') && request.method === 'DELETE') {
    const workId = path.split('/').pop();
    return deleteReadingList(workId, env, user);
  }
  if (path === '/api/feedback') return postFeedback(request, env, user);
  if (path === '/api/analyze') return postAnalyze(request, env, user);
  if (path === '/api/user/ao3-credentials') return putAO3Credentials(request, env, user);
  if (path === '/api/user/aihubmix-key') return putAihubmixKey(request, env, user);
  if (path === '/api/journal/stats') return getJournalStats(env, user);
  if (path === '/health') return json({ ok: true, ts: Date.now() });

  return err('Not found', 404);
}

// ─── 用户端点实现 ─────────────────────────────────────────────────────────────

async function getPreferences(env, user) {
  await enableFK(env);
  const row = await env.DB.prepare(
    'SELECT * FROM preferences WHERE user_id = ?'
  ).bind(user.sub).first();
  if (!row) return json({});
  return json({
    fandoms: JSON.parse(row.fandoms || '[]'),
    taste_profile: JSON.parse(row.taste_profile || '{}'),
    taste_profile_history: JSON.parse(row.taste_profile_history || '[]'),
    content_warning_blacklist: JSON.parse(row.content_warning_blacklist || '[]'),
    work_blacklist: JSON.parse(row.work_blacklist || '[]'),
    author_kudos_list: JSON.parse(row.author_kudos_list || '[]')
  });
}

async function putPreferences(request, env, user) {
  await enableFK(env);
  const body = await request.json();
  await env.DB.prepare(`
    UPDATE preferences SET
      fandoms = ?,
      taste_profile = ?,
      content_warning_blacklist = ?,
      work_blacklist = ?,
      author_kudos_list = ?,
      updated_at = datetime('now')
    WHERE user_id = ?
  `).bind(
    JSON.stringify(body.fandoms ?? []),
    JSON.stringify(body.taste_profile ?? {}),
    JSON.stringify(body.content_warning_blacklist ?? []),
    JSON.stringify(body.work_blacklist ?? []),
    JSON.stringify(body.author_kudos_list ?? []),
    user.sub
  ).run();
  return json({ ok: true });
}

async function getRecommendations(request, env, user) {
  await enableFK(env);
  const url = new URL(request.url);
  const date = url.searchParams.get('date') === 'today'
    ? new Date().toISOString().slice(0, 10)
    : url.searchParams.get('date');
  const row = await env.DB.prepare(
    'SELECT fics FROM recommendations WHERE user_id = ? AND date = ?'
  ).bind(user.sub, date).first();
  return json({ date, fics: JSON.parse(row?.fics || '[]') });
}

async function getJournal(request, env, user) {
  await enableFK(env);
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  const status = url.searchParams.get('status') || '';
  const limit = parseInt(url.searchParams.get('limit') || '200');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = 'SELECT * FROM journal WHERE user_id = ?';
  const params = [user.sub];
  if (status) { query += ' AND read_result = ?'; params.push(status); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...params).all();

  // 客户端 includes() 搜索，服务端只做基础过滤后返回
  const filtered = q
    ? results.filter(e =>
        e.title?.includes(q) || e.fandom?.includes(q) ||
        e.ship?.includes(q) || e.comment_text?.includes(q)
      )
    : results;

  return json({ entries: filtered, total: filtered.length });
}

async function postJournal(request, env, user) {
  await enableFK(env);
  const b = await request.json();
  await env.DB.prepare(`
    INSERT INTO journal
      (user_id, work_id, title, fandom, ship, word_count, overall_score,
       comment_text, comment_type, read_result, ao3_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    user.sub, b.work_id, b.title, b.fandom, b.ship,
    b.word_count, b.overall_score, b.comment_text,
    b.comment_type, b.read_result, b.ao3_url
  ).run();

  // 弃文自动加入黑名单
  if (b.read_result === 'dropped' && b.work_id) {
    const pref = await env.DB.prepare(
      'SELECT work_blacklist FROM preferences WHERE user_id = ?'
    ).bind(user.sub).first();
    const blacklist = JSON.parse(pref?.work_blacklist || '[]');
    if (!blacklist.includes(b.work_id)) {
      blacklist.push(b.work_id);
      await env.DB.prepare(
        'UPDATE preferences SET work_blacklist = ? WHERE user_id = ?'
      ).bind(JSON.stringify(blacklist), user.sub).run();
    }
  }
  return json({ ok: true });
}

async function getJournalStats(env, user) {
  await enableFK(env);
  const { results } = await env.DB.prepare(`
    SELECT read_result, COUNT(*) as cnt FROM journal
    WHERE user_id = ? GROUP BY read_result
  `).bind(user.sub).all();
  const stats = { total: 0, completed: 0, dropped: 0, ongoing: 0 };
  for (const r of results) {
    stats[r.read_result] = r.cnt;
    stats.total += r.cnt;
  }
  return json(stats);
}

async function getReadingList(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT work_id, title, ao3_url, cached_score, added_at FROM reading_list WHERE user_id = ? ORDER BY added_at DESC'
  ).bind(user.sub).all();
  return json({ items: results });
}

async function deleteReadingList(workId, env, user) {
  await env.DB.prepare(
    'DELETE FROM reading_list WHERE user_id = ? AND work_id = ?'
  ).bind(user.sub, workId).run();
  return json({ ok: true });
}

async function postReadingList(request, env, user) {
  await enableFK(env);
  const b = await request.json();
  if (b.action === 'remove') {
    await env.DB.prepare(
      'DELETE FROM reading_list WHERE user_id = ? AND work_id = ?'
    ).bind(user.sub, b.work_id).run();
    return json({ ok: true });
  }
  // 检查上限
  const { count } = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM reading_list WHERE user_id = ?'
  ).bind(user.sub).first();
  if (count >= 50) return err('稍后看列表已满（50篇），请先清理', 400);

  await env.DB.prepare(`
    INSERT OR IGNORE INTO reading_list (user_id, work_id, title, ao3_url, cached_score)
    VALUES (?, ?, ?, ?, ?)
  `).bind(user.sub, b.work_id, b.title, b.ao3_url, b.cached_score).run();
  return json({ ok: true });
}

async function postFeedback(request, env, user) {
  await enableFK(env);
  const b = await request.json();
  await env.DB.prepare(`
    INSERT INTO feedback (user_id, work_id, ai_score, user_rating)
    VALUES (?, ?, ?, ?)
  `).bind(user.sub, b.work_id, b.ai_score, b.user_rating).run();
  return json({ ok: true });
}

async function postAnalyze(request, env, user) {
  await enableFK(env);
  const b = await request.json();
  const { work_id, content, model = 'deepseek-v3.2', is_complete = false } = b;

  // 检查缓存
  const cached = await env.DB.prepare(`
    SELECT result FROM analysis_cache
    WHERE user_id = ? AND work_id = ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).bind(user.sub, work_id).first();
  if (cached) {
    await updateStats(env, user.sub, model, 0, true);
    return json({ ...JSON.parse(cached.result), from_cache: true });
  }

  // 取出用户 AIHubMix Key
  const userRow = await env.DB.prepare(
    'SELECT aihubmix_key FROM users WHERE id = ?'
  ).bind(user.sub).first();
  if (!userRow?.aihubmix_key) return err('请先在设置中填写 AIHubMix API Key', 400);
  const apiKey = await decrypt(userRow.aihubmix_key, env.MASTER_KEY);

  // 读取用户偏好
  const pref = await env.DB.prepare(
    'SELECT taste_profile, content_warning_blacklist FROM preferences WHERE user_id = ?'
  ).bind(user.sub).first();
  const tasteProfile = JSON.parse(pref?.taste_profile || '{}');
  const warnBlacklist = JSON.parse(pref?.content_warning_blacklist || '[]');

  const prompt = buildAnalyzePrompt(content, tasteProfile, warnBlacklist);

  // 调用 AIHubMix
  const aiResp = await fetch('https://api.aihubmix.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7
    })
  });

  if (!aiResp.ok) {
    const errData = await aiResp.json().catch(() => ({}));
    if (aiResp.status === 401) return err('AIHubMix API Key 无效', 400);
    if (aiResp.status === 429) return err('请求过频，请稍后重试', 429);
    if (aiResp.status === 402) return err('AIHubMix 余额不足，请充值', 400);
    return err(`AI 服务错误: ${errData.error?.message || aiResp.status}`, 500);
  }

  const aiData = await aiResp.json();
  const rawContent = aiData.choices?.[0]?.message?.content || '';
  const result = parseAIResult(rawContent);

  // 计算费用（deepseek-v3.2 约 ¥0.034/次）
  const inputTokens = aiData.usage?.prompt_tokens || 0;
  const outputTokens = aiData.usage?.completion_tokens || 0;
  const cost = calcCost(model, inputTokens, outputTokens);

  // 写入缓存
  const expiresAt = is_complete ? null : `datetime('now', '+7 days')`;
  await env.DB.prepare(`
    INSERT INTO analysis_cache (user_id, work_id, result, is_complete, expires_at)
    VALUES (?, ?, ?, ?, ${is_complete ? 'NULL' : "datetime('now', '+7 days')"})
    ON CONFLICT(user_id, work_id) DO UPDATE SET
      result = excluded.result,
      is_complete = excluded.is_complete,
      expires_at = excluded.expires_at,
      cached_at = datetime('now')
  `).bind(user.sub, work_id, JSON.stringify(result), is_complete ? 1 : 0).run();

  await updateStats(env, user.sub, model, cost, false);

  return json({ ...result, cost_cny: cost, from_cache: false });
}

async function putAihubmixKey(request, env, user) {
  const { key } = await request.json();
  if (!key) return err('Key 不能为空');
  const encrypted = await encrypt(key, env.MASTER_KEY);
  await env.DB.prepare(
    'UPDATE users SET aihubmix_key = ? WHERE id = ?'
  ).bind(encrypted, user.sub).run();
  return json({ ok: true });
}

async function putAO3Credentials(request, env, user) {
  const { username, password } = await request.json();
  const encUser = username ? await encrypt(username, env.MASTER_KEY) : null;
  const encPass = password ? await encrypt(password, env.MASTER_KEY) : null;
  await env.DB.prepare(
    'UPDATE users SET ao3_username = ?, ao3_password = ? WHERE id = ?'
  ).bind(encUser, encPass, user.sub).run();
  return json({ ok: true });
}

// ─── 内部端点（Scanner 调用）────────────────────────────────────────────────

async function handleInternal(request, env, path) {
  await enableFK(env);

  if (path === '/internal/users' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT u.id, u.github_login, p.fandoms, p.taste_profile,
             p.content_warning_blacklist, p.work_blacklist
      FROM users u
      JOIN preferences p ON p.user_id = u.id
      WHERE u.aihubmix_key IS NOT NULL
    `).all();
    return json(results.map(r => ({
      ...r,
      fandoms: JSON.parse(r.fandoms || '[]'),
      taste_profile: JSON.parse(r.taste_profile || '{}'),
      content_warning_blacklist: JSON.parse(r.content_warning_blacklist || '[]'),
      work_blacklist: JSON.parse(r.work_blacklist || '[]')
    })));
  }

  const credMatch = path.match(/^\/internal\/user-credentials\/(\d+)$/);
  if (credMatch && request.method === 'GET') {
    const userId = credMatch[1];
    const row = await env.DB.prepare(
      'SELECT aihubmix_key, ao3_username, ao3_password FROM users WHERE id = ?'
    ).bind(userId).first();
    if (!row) return err('User not found', 404);
    return json({
      aihubmix_key: row.aihubmix_key ? await decrypt(row.aihubmix_key, env.MASTER_KEY) : null,
      ao3_username: row.ao3_username ? await decrypt(row.ao3_username, env.MASTER_KEY) : null,
      ao3_password: row.ao3_password ? await decrypt(row.ao3_password, env.MASTER_KEY) : null
    });
  }

  if (path === '/internal/recommendations' && request.method === 'POST') {
    const { user_id, date, fics } = await request.json();
    await env.DB.prepare(`
      INSERT INTO recommendations (user_id, date, fics)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET fics = excluded.fics, generated_at = datetime('now')
    `).bind(user_id, date, JSON.stringify(fics)).run();
    return json({ ok: true });
  }

  if (path === '/internal/analysis-cache' && request.method === 'POST') {
    const { user_id, work_id, result, is_complete } = await request.json();
    await env.DB.prepare(`
      INSERT INTO analysis_cache (user_id, work_id, result, is_complete, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, work_id) DO UPDATE SET
        result = excluded.result, is_complete = excluded.is_complete,
        expires_at = excluded.expires_at, cached_at = datetime('now')
    `).bind(
      user_id, work_id, JSON.stringify(result), is_complete ? 1 : 0,
      is_complete ? null : new Date(Date.now() + 7 * 86400000).toISOString()
    ).run();
    return json({ ok: true });
  }

  if (path === '/internal/cleanup' && request.method === 'POST') {
    await env.DB.prepare(`
      DELETE FROM analysis_cache
      WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
    `).run();
    await env.DB.prepare(`
      DELETE FROM recommendations WHERE date < date('now', '-7 days')
    `).run();
    return json({ ok: true });
  }

  return err('Not found', 404);
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function buildAnalyzePrompt(content, tasteProfile, warnBlacklist) {
  const tasteSummary = tasteProfile.taste_summary || '综合质量评估，注重逻辑、人物、节奏、情感';
  const warnList = warnBlacklist.length ? warnBlacklist.join('、') : '无';

  return `你是专业的 AO3 同人文质量分析专家，擅长中文同人文的文学评价。请严格按照以下评分标尺打分，不要保守，不要集中在 6-8 分段。

【评分标尺（必须参照）】
- 1-3分：文笔幼稚、逻辑混乱、角色严重 OOC、大量错别字或病句，几乎不可读
- 4-5分：有明显不足，文笔平平，情节推进生硬，但尚可阅读
- 6分：中等水平，没有明显亮点也没有明显硬伤，AO3 大多数作品在此区间
- 7分：有一定质量，文笔流畅或情感到位，局部有亮点
- 8分：质量较高，文笔/人物/节奏至少两项出色，少数硬伤
- 9分：优秀，整体完成度高，有记忆点，瑕疵极少
- 10分：顶级水准，文笔、人物、情感、节奏全面在线，圈内公认佳作级别

【用户阅读偏好】：${tasteSummary}
【内容警告黑名单】：${warnList}

【待分析正文】：
${content}

请对以上文本进行严格的写作质量分析。打分时必须横向比较：如果这篇文在同类作品中属于中等，综合分应在 6 分左右，不要因为"没有明显问题"就给到 7-8。输出以下 JSON 格式（仅输出纯 JSON，不含 markdown 代码块）：
{
  "overall_score": <1-10整数，请参照上方标尺，不要集中在6-8>,
  "work_meta": {
    "fandom": "作品所属fandom",
    "ship": "CP/配对",
    "characters": ["角色1", "角色2"],
    "additional_tags": ["tag1", "tag2"],
    "rating": "评级",
    "is_series": false,
    "series_info": null,
    "work_type": "原创文或翻译文"
  },
  "dimensions": {
    "logic_structure":   { "score": <1-10，参照标尺>, "comment": "评价+原文引用佐证，格式：[评价]。原文：「不超过30字的原文片段」" },
    "character_voice":   { "score": <1-10>, "comment": "评价+原文引用佐证，格式：[评价]。原文：「不超过30字的原文片段」" },
    "narrative_rhythm":  { "score": <1-10>, "comment": "评价+原文引用佐证，格式：[评价]。原文：「不超过30字的原文片段」" },
    "emotional_tension": { "score": <1-10>, "comment": "评价+原文引用佐证，格式：[评价]。原文：「不超过30字的原文片段」" },
    "originality":       { "score": <1-10>, "comment": "评价+原文引用佐证，格式：[评价]。原文：「不超过30字的原文片段」" }
  },
  "red_flags": [
    { "type": "问题类型", "excerpt": "原文片段不超过50字", "reason": "问题说明" }
  ],
  "content_warnings_check": {
    "declared_warnings": ["已声明警告"],
    "detected_issues": [],
    "warnings_accurate": true
  },
  "one_liner": "一句话总结，不超过30字，需体现这篇文的具体特点",
  "best_excerpt": "最能体现文笔风格的原文段落，不超过80字，禁止选取人物死亡、感情告白、重要矛盾化解、结局揭示等情节节点"
}`;
}

function parseAIResult(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  const parsed = JSON.parse(match[0]);
  return {
    overall_score: parsed.overall_score ?? 5,
    work_meta: parsed.work_meta ?? {},
    dimensions: parsed.dimensions ?? {},
    red_flags: parsed.red_flags ?? [],
    content_warnings_check: parsed.content_warnings_check ?? {},
    one_liner: parsed.one_liner ?? '分析结果不完整',
    best_excerpt: parsed.best_excerpt ?? '',
    ...parsed
  };
}

function calcCost(model, inputTokens, outputTokens) {
  const pricing = {
    'deepseek-v3.2':       { input: 0.302, output: 0.453 },
    'gemini-2.5-flash':    { input: 0.10,  output: 0.40  },
    'gemini-2.5-pro':      { input: 1.25,  output: 10.0  }
  };
  const p = pricing[model] || pricing['deepseek-v3.2'];
  return parseFloat(
    ((inputTokens / 1e6 * p.input + outputTokens / 1e6 * p.output) * 7.2).toFixed(4)
  );
}

async function updateStats(env, userId, model, cost, fromCache) {
  await env.DB.prepare(`
    INSERT INTO stats (user_id, total_cny, analyses_total, analyses_cached, by_model)
    VALUES (?, ?, 1, ?, '{}')
    ON CONFLICT(user_id) DO UPDATE SET
      total_cny = total_cny + ?,
      analyses_total = analyses_total + 1,
      analyses_cached = analyses_cached + ?,
      updated_at = datetime('now')
  `).bind(userId, cost, fromCache ? 1 : 0, cost, fromCache ? 1 : 0).run();
}
