// 每日 23:00 UTC 触发 GitHub Actions 中央扫文 workflow
export async function handleCron(env) {
  const resp = await fetch(
    `https://api.github.com/repos/aquiloyang/ao3-scout/actions/workflows/daily-scan.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'AO3-Scout-Worker/1.0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main' })
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Cron dispatch failed: ${resp.status} ${text}`);
    // 写入告警（连续失败由外部监控处理）
    return;
  }

  console.log(`Daily scan dispatched at ${new Date().toISOString()}`);

  // 同步触发过期数据清理
  await fetch(`https://ao3scout.ao3scout.workers.dev/internal/cleanup`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.SCANNER_SERVICE_TOKEN}` }
  });
}
