// ==UserScript==
// @name         AO3 Scout
// @namespace    https://github.com/aquiloyang/ao3-scout
// @version      1.0.4
// @description  AI 驱动的 AO3 同人文质量分析工具
// @author       aquiloyang
// @match        https://archiveofourown.org/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      ao3scout.ao3scout.workers.dev
// @updateURL    https://raw.githubusercontent.com/aquiloyang/ao3-scout/main/tampermonkey/ao3-ai-scout.user.js
// @downloadURL  https://raw.githubusercontent.com/aquiloyang/ao3-scout/main/tampermonkey/ao3-ai-scout.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ─── 常量 ──────────────────────────────────────────────────────────────────
  const WORKER = 'https://ao3scout.ao3scout.workers.dev';
  const VERSION = '1.0.4';

  // ─── 状态 ──────────────────────────────────────────────────────────────────
  let _jwt = GM_getValue('session_token', null);
  let _analyzing = false;
  let _panelOpen = false;

  // ─── CSS 注入 ──────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --ao3s-primary: #E06C75;
      --ao3s-surface: #1E1E2E;
      --ao3s-surface-2: #2A2A3C;
      --ao3s-on-surface: #CDD6F4;
      --ao3s-muted: #6C7086;
      --ao3s-error: #F38BA8;
      --ao3s-success: #A6E3A1;
      --ao3s-overlay: rgba(0,0,0,0.5);
      --ao3s-warn: #FAB387;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --ao3s-primary: #C0392B;
        --ao3s-surface: #FFFFFF;
        --ao3s-surface-2: #F5F5F5;
        --ao3s-on-surface: #1A1A2E;
        --ao3s-muted: #9CA3AF;
        --ao3s-error: #DC2626;
        --ao3s-success: #16A34A;
        --ao3s-overlay: rgba(0,0,0,0.3);
        --ao3s-warn: #D97706;
      }
    }

    /* FAB */
    .ao3s-fab {
      position: fixed; bottom: 24px; right: 24px;
      width: 56px; height: 56px; border-radius: 50%;
      background: var(--ao3s-primary); color: #fff;
      border: none; cursor: pointer; font-size: 22px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 9000; display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s ease;
    }
    .ao3s-fab:hover { transform: scale(1.08); }
    .ao3s-fab.open { transform: rotate(45deg); }
    .ao3s-fab-badge {
      position: absolute; top: 4px; right: 4px;
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--ao3s-success); border: 2px solid var(--ao3s-primary);
    }

    /* Speed Dial 子按钮 */
    .ao3s-dial-item {
      position: fixed; right: 24px;
      width: 48px; height: 48px; border-radius: 50%;
      background: var(--ao3s-surface-2); color: var(--ao3s-on-surface);
      border: none; cursor: pointer; font-size: 18px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      z-index: 9000; display: flex; align-items: center; justify-content: center;
      transition: transform 0.15s ease, opacity 0.15s ease;
      transform: scale(0); opacity: 0;
    }
    .ao3s-dial-item.visible { transform: scale(1); opacity: 1; }
    .ao3s-dial-label {
      position: fixed; right: 84px;
      background: var(--ao3s-surface-2); color: var(--ao3s-on-surface);
      padding: 4px 10px; border-radius: 6px; font-size: 13px;
      z-index: 9000; opacity: 0; pointer-events: none;
      transition: opacity 0.15s; white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    .ao3s-dial-item:hover + .ao3s-dial-label,
    .ao3s-dial-item:hover ~ .ao3s-dial-label { opacity: 1; }

    /* 遮罩：纯视觉，不拦截任何点击 */
    .ao3s-overlay {
      position: fixed; inset: 0;
      background: var(--ao3s-overlay);
      z-index: 9200; opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    }
    .ao3s-overlay.show { opacity: 1; }

    /* 侧滑面板 */
    .ao3s-panel {
      position: fixed; top: 0; right: -380px; width: 360px; height: 100%;
      background: var(--ao3s-surface); color: var(--ao3s-on-surface);
      z-index: 9300; overflow-y: auto;
      transition: right 0.28s cubic-bezier(0.2,0,0,1);
      box-shadow: -4px 0 24px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .ao3s-panel.open { right: 0; }
    .ao3s-panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid var(--ao3s-surface-2);
      position: sticky; top: 0; background: var(--ao3s-surface); z-index: 1;
    }
    .ao3s-panel-title { font-size: 16px; font-weight: 600; }
    .ao3s-close-btn {
      background: none; border: none; color: var(--ao3s-muted);
      font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 4px;
    }
    .ao3s-close-btn:hover { color: var(--ao3s-on-surface); }

    /* 评分区 */
    .ao3s-score-section {
      display: flex; align-items: center; gap: 16px;
      padding: 20px 16px;
    }
    .ao3s-score-ring {
      position: relative; width: 80px; height: 80px; flex-shrink: 0;
    }
    .ao3s-score-ring svg { transform: rotate(-90deg); }
    .ao3s-score-ring circle {
      fill: none; stroke: var(--ao3s-surface-2); stroke-width: 6;
    }
    .ao3s-score-ring .progress {
      stroke: var(--ao3s-primary); stroke-linecap: round;
      transition: stroke-dashoffset 0.8s ease-out;
    }
    .ao3s-score-number {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 700; color: var(--ao3s-on-surface);
    }
    .ao3s-score-right { flex: 1; }
    .ao3s-score-big { font-size: 28px; font-weight: 700; }
    .ao3s-one-liner { font-size: 13px; color: var(--ao3s-muted); margin-top: 6px; font-style: italic; }

    /* 维度进度条 */
    .ao3s-dims { padding: 0 16px 16px; }
    .ao3s-dim-row { margin-bottom: 10px; }
    .ao3s-dim-label {
      display: flex; justify-content: space-between;
      font-size: 13px; margin-bottom: 4px; color: var(--ao3s-on-surface);
    }
    .ao3s-dim-score { font-weight: 600; }
    .ao3s-dim-bar {
      height: 6px; background: var(--ao3s-surface-2); border-radius: 3px; overflow: hidden;
    }
    .ao3s-dim-fill {
      height: 100%; border-radius: 3px;
      background: var(--ao3s-primary);
      transition: width 0.6s ease-out;
    }
    .ao3s-dim-fill.low { background: var(--ao3s-warn); }
    .ao3s-dim-comment { font-size: 12px; color: var(--ao3s-on-surface); margin-top: 6px; line-height: 1.6; }
    .ao3s-dim-quote {
      display: block; margin-top: 4px; padding: 4px 10px;
      border-left: 2px solid var(--ao3s-primary); border-radius: 0 4px 4px 0;
      background: var(--ao3s-surface-2); font-size: 12px; font-style: italic;
      color: var(--ao3s-muted); line-height: 1.6;
    }

    /* 雷点区 */
    .ao3s-redflag-section {
      margin: 0 16px 16px;
      background: rgba(243,139,168,0.1);
      border: 1px solid var(--ao3s-error);
      border-radius: 8px; overflow: hidden;
    }
    .ao3s-redflag-header {
      padding: 10px 14px; font-size: 13px; font-weight: 600;
      color: var(--ao3s-error); display: flex; align-items: center; gap: 6px;
    }
    .ao3s-redflag-item {
      padding: 8px 14px; border-top: 1px solid rgba(243,139,168,0.2);
      font-size: 12px;
    }
    .ao3s-redflag-type { font-weight: 600; color: var(--ao3s-error); }
    .ao3s-redflag-excerpt {
      color: var(--ao3s-muted); margin: 4px 0;
      font-style: italic; font-size: 11px;
    }

    /* 最佳片段 */
    .ao3s-excerpt-section {
      margin: 0 16px 16px; padding: 12px 14px;
      background: var(--ao3s-surface-2); border-radius: 8px;
      font-size: 13px; color: var(--ao3s-on-surface);
      line-height: 1.6; font-style: italic;
    }

    /* 页脚操作栏 */
    .ao3s-panel-footer {
      padding: 12px 16px; border-top: 1px solid var(--ao3s-surface-2);
      position: sticky; bottom: 0; background: var(--ao3s-surface);
    }
    .ao3s-footer-actions {
      display: flex; gap: 8px; margin-bottom: 8px;
    }
    .ao3s-btn {
      flex: 1; padding: 11px 20px; border-radius: 12px; border: none;
      cursor: pointer; font-size: 14px; font-weight: 600; line-height: 1;
      background: var(--ao3s-surface-2); color: var(--ao3s-on-surface);
      transition: opacity 0.15s, transform 0.1s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans SC', sans-serif;
      white-space: nowrap; box-sizing: border-box;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    }
    .ao3s-btn:hover { opacity: 0.82; }
    .ao3s-btn:active { transform: scale(0.97); }
    .ao3s-btn.primary {
      background: var(--ao3s-primary); color: #fff;
      box-shadow: 0 4px 16px rgba(192,57,43,0.4);
    }
    .ao3s-footer-meta {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 12px; color: var(--ao3s-muted);
    }
    .ao3s-feedback-btns { display: flex; gap: 8px; }
    .ao3s-feedback-btns button {
      background: none; border: 1px solid var(--ao3s-surface-2);
      color: var(--ao3s-muted); padding: 2px 8px; border-radius: 4px;
      cursor: pointer; font-size: 12px;
    }
    .ao3s-feedback-btns button:hover { color: var(--ao3s-on-surface); }

    /* 加载状态 */
    .ao3s-loading { padding: 32px 16px; text-align: center; }
    .ao3s-spinner {
      width: 36px; height: 36px; border-radius: 50%;
      border: 3px solid var(--ao3s-surface-2);
      border-top-color: var(--ao3s-primary);
      animation: ao3s-spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes ao3s-spin { to { transform: rotate(360deg); } }
    .ao3s-loading-text { font-size: 14px; color: var(--ao3s-muted); }
    .ao3s-progress-bar {
      height: 3px; background: var(--ao3s-surface-2); border-radius: 2px;
      margin: 16px 0; overflow: hidden;
    }
    .ao3s-progress-fill {
      height: 100%; background: var(--ao3s-primary); border-radius: 2px;
      animation: ao3s-progress 2s ease-in-out infinite;
    }
    @keyframes ao3s-progress {
      0% { width: 0%; margin-left: 0; }
      50% { width: 60%; margin-left: 20%; }
      100% { width: 0%; margin-left: 100%; }
    }

    /* Toast */
    .ao3s-toast {
      position: fixed; bottom: 96px; left: 50%; transform: translateX(-50%);
      background: var(--ao3s-surface-2); color: var(--ao3s-on-surface);
      padding: 10px 20px; border-radius: 24px; font-size: 14px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3); z-index: 9600;
      animation: ao3s-toast-in 0.3s ease, ao3s-toast-out 0.3s ease 2.7s forwards;
    }
    .ao3s-toast.error { background: var(--ao3s-error); color: #fff; }
    .ao3s-toast.success { background: var(--ao3s-success); color: #1A1A2E; }
    @keyframes ao3s-toast-in { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
    @keyframes ao3s-toast-out { from { opacity:1; } to { opacity:0; } }

    /* 弹窗（onboarding / 设置）*/
    .ao3s-modal-wrap {
      position: fixed; inset: 0; z-index: 9500;
      background: var(--ao3s-overlay);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
    }
    .ao3s-modal {
      background: var(--ao3s-surface); color: var(--ao3s-on-surface);
      border-radius: 24px; padding: 32px; width: 440px; max-width: 100%;
      max-height: 88vh; overflow-y: auto;
      box-shadow: 0 32px 80px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans SC', sans-serif;
    }
    .ao3s-modal h2 {
      margin: 0 0 8px; padding: 0; font-size: 24px; font-weight: 700;
      letter-spacing: -0.5px; line-height: 1.3; color: var(--ao3s-on-surface);
    }
    .ao3s-modal p.ao3s-modal-desc {
      margin: 0 0 24px; font-size: 14px; color: var(--ao3s-muted);
      line-height: 1.75;
    }
    .ao3s-modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 32px; }

    /* 标签云 */
    .ao3s-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .ao3s-tag {
      padding: 8px 16px; border-radius: 100px; font-size: 13px; font-weight: 500;
      border: 1.5px solid var(--ao3s-surface-2); cursor: pointer;
      background: transparent; color: var(--ao3s-on-surface);
      transition: background 0.15s, border-color 0.15s, color 0.15s; user-select: none;
      line-height: 1.2;
    }
    .ao3s-tag:hover { border-color: var(--ao3s-primary); color: var(--ao3s-primary); }
    .ao3s-tag.selected {
      background: var(--ao3s-primary); color: #fff;
      border-color: var(--ao3s-primary); box-shadow: 0 2px 8px rgba(192,57,43,0.3);
    }

    /* 输入框 */
    .ao3s-input {
      width: 100%; padding: 12px 16px; border-radius: 12px; font-size: 14px;
      border: 1.5px solid var(--ao3s-surface-2);
      background: var(--ao3s-surface-2); color: var(--ao3s-on-surface);
      box-sizing: border-box; outline: none; transition: border-color 0.15s, background 0.15s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans SC', sans-serif;
    }
    .ao3s-input:focus { border-color: var(--ao3s-primary); background: var(--ao3s-surface); }
    .ao3s-label {
      font-size: 11px; font-weight: 700; color: var(--ao3s-muted);
      margin-bottom: 8px; display: block; text-transform: uppercase; letter-spacing: 0.8px;
    }
    .ao3s-field { margin-bottom: 16px; }
    .ao3s-pref-group { margin-bottom: 24px; }

    /* 步骤指示器 */
    .ao3s-steps {
      display: flex; justify-content: center; gap: 6px; margin-bottom: 32px;
    }
    .ao3s-step-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--ao3s-surface-2); transition: all 0.25s cubic-bezier(0.2,0,0,1);
    }
    .ao3s-step-dot.active {
      background: var(--ao3s-primary); width: 24px; border-radius: 3px;
    }

    /* 推荐横幅 */
    .ao3s-banner {
      position: fixed; top: -160px; left: 0; right: 0;
      background: var(--ao3s-surface); border-bottom: 1px solid var(--ao3s-surface-2);
      z-index: 9100; padding: 12px 20px;
      transition: top 0.25s ease-out;
      box-shadow: 0 2px 12px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .ao3s-banner.show { top: 0; }
    .ao3s-banner-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px;
    }
    .ao3s-banner-title { font-size: 13px; font-weight: 600; color: var(--ao3s-on-surface); }
    .ao3s-banner-close {
      background: none; border: none; color: var(--ao3s-muted);
      cursor: pointer; font-size: 16px; padding: 0 4px;
    }
    .ao3s-banner-cards {
      display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px;
    }
    .ao3s-banner-card {
      min-width: 260px; background: var(--ao3s-surface-2);
      border-radius: 10px; padding: 12px; cursor: pointer;
      transition: opacity 0.15s; flex-shrink: 0;
    }
    .ao3s-banner-card:hover { opacity: 0.85; }
    .ao3s-banner-card-top {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;
    }
    .ao3s-banner-card-title {
      font-size: 13px; font-weight: 600; color: var(--ao3s-on-surface);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;
    }
    .ao3s-banner-score {
      font-size: 13px; font-weight: 700; color: var(--ao3s-primary); flex-shrink: 0;
    }
    .ao3s-banner-meta { font-size: 11px; color: var(--ao3s-muted); margin: 4px 0; }
    .ao3s-banner-excerpt {
      font-size: 12px; color: var(--ao3s-on-surface); line-height: 1.5;
      font-style: italic; margin-top: 6px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .ao3s-banner-liner { font-size: 11px; color: var(--ao3s-muted); margin-top: 6px; }

    /* 置信度提示 */
    .ao3s-confidence {
      font-size: 11px; color: var(--ao3s-muted);
      padding: 8px 16px; border-top: 1px solid var(--ao3s-surface-2);
      line-height: 1.5;
    }

    /* 分隔线 */
    .ao3s-divider {
      height: 1px; background: var(--ao3s-surface-2); margin: 0 16px;
    }

    /* 稍后看抽屉列表项 */
    .ao3s-rl-item {
      padding: 12px 0; border-bottom: 1px solid var(--ao3s-surface-2);
      display: flex; flex-direction: column; gap: 4px;
    }
    .ao3s-rl-item:last-child { border-bottom: none; }
    .ao3s-rl-title {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 14px; font-weight: 500; gap: 8px;
    }
    .ao3s-rl-score {
      background: var(--ao3s-primary); color: #fff;
      font-size: 12px; font-weight: 700; padding: 2px 7px;
      border-radius: 10px; flex-shrink: 0;
    }
    .ao3s-rl-meta { font-size: 12px; color: var(--ao3s-muted); }
    .ao3s-rl-remove {
      align-self: flex-start; background: none; border: 1px solid var(--ao3s-surface-2);
      color: var(--ao3s-muted); font-size: 12px; padding: 2px 8px;
      border-radius: 4px; cursor: pointer; margin-top: 2px;
    }
    .ao3s-rl-remove:hover { border-color: var(--ao3s-error); color: var(--ao3s-error); }

    /* 搜索页 AI 预览按钮 */
    .ao3s-preview-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 20px; border: 1.5px solid var(--ao3s-primary);
      background: transparent; color: var(--ao3s-primary);
      font-size: 12px; font-weight: 600; cursor: pointer;
      transition: background 0.15s, color 0.15s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      vertical-align: middle; margin-left: 8px;
    }
    .ao3s-preview-btn:hover { background: var(--ao3s-primary); color: #fff; }
    .ao3s-preview-btn:disabled { opacity: 0.5; cursor: default; }
  `;
  document.head.appendChild(style);

  // ─── 工具函数 ──────────────────────────────────────────────────────────────
  function showToast(msg, type = 'default') {
    const t = document.createElement('div');
    t.className = `ao3s-toast ${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function apiCall(method, path, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: `${WORKER}${path}`,
        headers: {
          'Authorization': `Bearer ${_jwt}`,
          'Content-Type': 'application/json'
        },
        data: data ? JSON.stringify(data) : undefined,
        onload: (r) => {
          try {
            const parsed = JSON.parse(r.responseText);
            if (r.status === 401) {
              GM_setValue('session_token', null);
              GM_setValue('onboarding_done', false);
              _jwt = null;
              showToast('登录已过期，点击右下角按钮重新授权', 'error');
              reject(parsed);
              return;
            }
            if (r.status >= 400) reject(parsed);
            else resolve(parsed);
          } catch { reject({ error: r.responseText }); }
        },
        onerror: () => reject({ error: '网络错误' })
      });
    });
  }

  function getWorkId() {
    const m = location.pathname.match(/\/works\/(\d+)/);
    return m ? m[1] : null;
  }

  function isWorkPage() {
    return /\/works\/\d+/.test(location.pathname) && !/\/works\/\d+\/collections/.test(location.pathname);
  }

  function isSearchPage() {
    return location.pathname.includes('/works') && !isWorkPage();
  }

  function isHomePage() {
    return location.pathname === '/' || location.pathname === '';
  }

  // ─── OAuth 回调检测 ────────────────────────────────────────────────────────
  function checkOAuthCallback() {
    const params = new URLSearchParams(location.search);
    const token = params.get('ao3scout_token');
    if (!token) return;
    GM_setValue('session_token', token);
    _jwt = token;
    GM_setValue('onboarding_done', true); // 已登录即视为通过第一步
    // 清理 URL
    params.delete('ao3scout_token');
    const newUrl = location.pathname + (params.toString() ? '?' + params.toString() : '');
    history.replaceState(null, '', newUrl);
    showToast('GitHub 授权成功！', 'success');
    // 继续 onboarding（偏好 + APIKey）
    setTimeout(() => checkOnboarding(), 500);
  }

  // ─── 登录状态 ──────────────────────────────────────────────────────────────
  function isLoggedIn() {
    if (_jwt) return true;
    // 另一个标签页可能已完成 OAuth，从 GM storage 补读
    _jwt = GM_getValue('session_token', null);
    return !!_jwt;
  }

  function startOAuth() {
    window.open(`${WORKER}/auth/github?client=tampermonkey`, '_blank');
    showToast('已打开 GitHub 授权页面，授权完成后将自动返回');
  }

  // ─── Onboarding 引导弹窗 ──────────────────────────────────────────────────
  function checkOnboarding() {
    const done = GM_getValue('onboarding_done', false);
    const hasKey = GM_getValue('setup_key_done', false);
    // 已登录时不重复弹 GitHub 登录步骤；只在缺少 APIKey 时提示
    if (isLoggedIn()) {
      if (!hasKey) showOnboarding();
    } else {
      if (!done) showOnboarding();
    }
  }

  function showOnboarding() {
    if (document.querySelector('.ao3s-modal-wrap')) return;

    let step = isLoggedIn() ? 1 : 0;
    const wrap = document.createElement('div');
    wrap.className = 'ao3s-modal-wrap';
    document.body.appendChild(wrap);

    // Shared preference state lives outside render() so it persists across re-renders
    const selected = { prose: [], emotion: [], pace: [], flags: [] };

    function el(tag, attrs = {}) {
      const e = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'cls') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else e.setAttribute(k, v);
      });
      return e;
    }

    function makeSteps() {
      const steps = el('div', { cls: 'ao3s-steps' });
      for (let i = 0; i < 3; i++) {
        steps.appendChild(el('div', { cls: `ao3s-step-dot ${i === step ? 'active' : ''}` }));
      }
      return steps;
    }

    function makeTagGroup(labelText, items, key) {
      const group = el('div', { cls: 'ao3s-pref-group' });
      group.appendChild(el('div', { cls: 'ao3s-label', text: labelText }));
      const tags = el('div', { cls: 'ao3s-tags' });
      items.forEach(item => {
        const tag = el('div', { cls: `ao3s-tag${selected[key].includes(item) ? ' selected' : ''}`, text: item });
        tag.onclick = () => {
          if (selected[key].includes(item)) {
            selected[key] = selected[key].filter(x => x !== item);
            tag.classList.remove('selected');
          } else {
            selected[key].push(item);
            tag.classList.add('selected');
          }
        };
        tags.appendChild(tag);
      });
      group.appendChild(tags);
      return group;
    }

    function render() {
      wrap.innerHTML = '';
      const modal = el('div', { cls: 'ao3s-modal' });
      modal.appendChild(makeSteps());

      if (step === 0) {
        modal.appendChild(el('h2', { text: '欢迎使用 AO3 Scout' }));
        const desc = el('p', { cls: 'ao3s-modal-desc', text: 'AI 驱动的同人文质量分析工具，帮你在 30 秒内判断一篇文是否值得读。首先用 GitHub 账号完成身份认证（免费，仅读取用户名）。' });
        modal.appendChild(desc);

        const btn = el('button', { cls: 'ao3s-btn primary', text: '🐙  用 GitHub 登录' });
        btn.style.cssText = 'width:100%;padding:14px;font-size:15px;margin-top:8px;';
        btn.onclick = () => {
          startOAuth();
          btn.disabled = true;
          btn.textContent = '等待授权…';
          // 轮询：另一个标签页完成 OAuth 后自动继续
          const poll = setInterval(() => {
            const t = GM_getValue('session_token', null);
            if (t) {
              clearInterval(poll);
              _jwt = t;
              wrap.remove();
              setTimeout(checkOnboarding, 300);
            }
          }, 1000);
          setTimeout(() => clearInterval(poll), 300000); // 5分钟后放弃
        };
        modal.appendChild(btn);

        const skip = el('p', { cls: 'ao3s-modal-desc', text: '稍后再说' });
        skip.style.cssText = 'text-align:center;margin-top:16px;margin-bottom:0;cursor:pointer;font-size:13px;';
        skip.onclick = () => { GM_setValue('onboarding_done', true); wrap.remove(); };
        modal.appendChild(skip);

      } else if (step === 1) {
        modal.appendChild(el('h2', { text: '你喜欢什么风格的文？' }));
        modal.appendChild(el('p', { cls: 'ao3s-modal-desc', text: '选择后 AI 会据此为你量身评分，可多选，也可以跳过直接下一步。' }));

        modal.appendChild(makeTagGroup('文笔偏好', ['细腻流畅', '简洁有力', '诗意意境', '白描写实'], 'prose'));
        modal.appendChild(makeTagGroup('情感偏好', ['情感克制', '情感浓烈', '慢热甜', '张力虐'], 'emotion'));
        modal.appendChild(makeTagGroup('节奏偏好', ['快节奏爽文', '慢热深情', '张弛有度'], 'pace'));
        modal.appendChild(makeTagGroup('硬性雷点（踩到即不推荐）', ['OOC', '逻辑硬伤', '大量心理独白', '文风稚嫩', '玛丽苏/杰克苏', '为虐而虐', '俗套 trope 堆砌'], 'flags'));

        const cpGroup = el('div', { cls: 'ao3s-pref-group' });
        cpGroup.appendChild(el('div', { cls: 'ao3s-label', text: '最喜欢的 CP（可选）' }));
        const cpInput = el('input', { cls: 'ao3s-input', id: 'ao3s-cp-input', placeholder: '例：Getou Suguru / Gojo Satoru' });
        cpInput.value = 'Getou Suguru/Gojo Satoru';
        cpGroup.appendChild(cpInput);
        modal.appendChild(cpGroup);

        const footer = el('div', { cls: 'ao3s-modal-footer' });
        const skipBtn = el('button', { cls: 'ao3s-btn', text: '跳过' });
        skipBtn.onclick = () => { step = 2; render(); };
        const nextBtn = el('button', { cls: 'ao3s-btn primary', text: '下一步 →' });
        nextBtn.onclick = async () => {
          const cp = document.getElementById('ao3s-cp-input')?.value || '';
          const tasteSummary = buildTasteSummary(selected, cp);
          try {
            await apiCall('PUT', '/api/preferences', {
              fandoms: [{ name: '呪術廻戦 | Jujutsu Kaisen', ao3_tag_id: '呪術廻戦%20%7C%20Jujutsu%20Kaisen%20(Anime%20*a*%20Manga)' }],
              taste_profile: {
                taste_summary: tasteSummary,
                preferred_prose_style: selected.prose.join('、'),
                preferred_pacing: selected.pace.join('、'),
                preferred_emotion_handling: selected.emotion.join('、'),
                anti_patterns: selected.flags
              },
              content_warning_blacklist: [],
              work_blacklist: [],
              author_kudos_list: []
            });
          } catch (e) { console.warn('保存偏好失败', e); }
          step = 2; render();
        };
        footer.appendChild(skipBtn);
        footer.appendChild(nextBtn);
        modal.appendChild(footer);

      } else if (step === 2) {
        modal.appendChild(el('h2', { text: '填写 AIHubMix Key' }));
        modal.appendChild(el('p', { cls: 'ao3s-modal-desc', text: 'AI 分析费用由你自己的 Key 承担，约 ¥0.028 / 次。Key 加密存储在服务器，脚本本身不持有。' }));

        const keyField = el('div', { cls: 'ao3s-field' });
        keyField.appendChild(el('label', { cls: 'ao3s-label', text: 'AIHubMix API Key' }));
        keyField.appendChild(el('input', { cls: 'ao3s-input', id: 'ao3s-key-input', type: 'password', placeholder: 'sk-...' }));
        modal.appendChild(keyField);

        const ao3Section = el('div', { cls: 'ao3s-field' });
        ao3Section.appendChild(el('label', { cls: 'ao3s-label', text: 'AO3 账号（可选，用于分析 M/E 级内容）' }));
        const ao3user = el('input', { cls: 'ao3s-input', id: 'ao3s-ao3user-input', placeholder: 'AO3 用户名' });
        ao3user.style.marginBottom = '8px';
        ao3Section.appendChild(ao3user);
        ao3Section.appendChild(el('input', { cls: 'ao3s-input', id: 'ao3s-ao3pass-input', type: 'password', placeholder: 'AO3 密码' }));
        modal.appendChild(ao3Section);

        const footer = el('div', { cls: 'ao3s-modal-footer' });
        const skipBtn = el('button', { cls: 'ao3s-btn', text: '稍后填写' });
        skipBtn.onclick = () => wrap.remove();
        const saveBtn = el('button', { cls: 'ao3s-btn primary', text: '保存并开始' });
        saveBtn.onclick = async () => {
          const key = document.getElementById('ao3s-key-input')?.value?.trim();
          const user = document.getElementById('ao3s-ao3user-input')?.value?.trim();
          const pass = document.getElementById('ao3s-ao3pass-input')?.value?.trim();
          if (!key) { showToast('请填写 API Key', 'error'); return; }
          try {
            await apiCall('PUT', '/api/user/aihubmix-key', { key });
            if (user && pass) await apiCall('PUT', '/api/user/ao3-credentials', { username: user, password: pass });
            GM_setValue('onboarding_done', true);
            GM_setValue('setup_key_done', true);
            showToast('设置完成！', 'success');
            wrap.remove();
          } catch (e) { showToast('保存失败：' + (e.error || '请重试'), 'error'); }
        };
        footer.appendChild(skipBtn);
        footer.appendChild(saveBtn);
        modal.appendChild(footer);
      }

      wrap.appendChild(modal);
    }

    render();
  }

  function buildTasteSummary(selected, cp) {
    const parts = [];
    if (selected.prose.length) parts.push(`偏好${selected.prose.join('、')}的文笔`);
    if (selected.emotion.length) parts.push(`情感风格喜欢${selected.emotion.join('或')}`);
    if (selected.pace.length) parts.push(`节奏偏好${selected.pace.join('、')}`);
    if (cp) parts.push(`最喜欢的 CP 是 ${cp}`);
    if (selected.flags.length) parts.push(`硬性雷点：${selected.flags.join('、')}`);
    return parts.join('；') + '。';
  }

  // ─── Speed Dial FAB ────────────────────────────────────────────────────────
  let dialOpen = false;
  let dialItems = [];

  function createFAB() {
    if (document.querySelector('.ao3s-fab')) return;

    const fab = document.createElement('button');
    fab.className = 'ao3s-fab';
    fab.innerHTML = isWorkPage() ? '✦' : '✦';
    fab.title = isWorkPage() ? 'AI 预览' : 'AO3 Scout';
    document.body.appendChild(fab);

    // 创建 Speed Dial 子按钮
    const items = [
      { icon: '⚙', label: '设置', bottom: 24 + 56 + 4*64, action: showSettings },
      { icon: '📚', label: '日志', bottom: 24 + 56 + 3*64, action: () => showToast('日志功能即将上线') },
      { icon: '🕒', label: '历史推荐', bottom: 24 + 56 + 2*64, action: () => showToast('历史推荐功能即将上线') },
      { icon: '📋', label: '稍后看', bottom: 24 + 56 + 1*64, action: showReadingList }
    ];

    dialItems = items.map(item => {
      const btn = document.createElement('button');
      btn.className = 'ao3s-dial-item';
      btn.innerHTML = item.icon;
      btn.style.bottom = item.bottom + 'px';
      btn.title = item.label;
      btn.onclick = (e) => { e.stopPropagation(); closeDial(); item.action(); };
      document.body.appendChild(btn);

      const lbl = document.createElement('div');
      lbl.className = 'ao3s-dial-label';
      lbl.textContent = item.label;
      lbl.style.bottom = (item.bottom + 14) + 'px';
      document.body.appendChild(lbl);

      return btn;
    });

    // 文章页：单击触发分析；其他页：单击展开/收起 Speed Dial
    fab.onclick = (e) => {
      e.stopPropagation();
      if (isWorkPage()) { triggerAnalysis(); return; }
      dialOpen ? closeDial() : openDial();
    };

    // hover 展开 Speed Dial（所有页面通用）
    let hoverTimer;
    const fabArea = document.createElement('div');
    fabArea.style.cssText = 'position:fixed;bottom:16px;right:16px;width:72px;height:72px;z-index:8999;';
    document.body.appendChild(fabArea);

    fabArea.addEventListener('mouseenter', () => {
      hoverTimer = setTimeout(() => openDial(), 200);
    });
    fabArea.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
      setTimeout(() => {
        const overDial = dialItems.some(b => b.matches(':hover'));
        if (!overDial) closeDial();
      }, 300);
    });
    dialItems.forEach(btn => {
      btn.addEventListener('mouseleave', () => {
        setTimeout(() => {
          const overFab = fab.matches(':hover') || fabArea.matches(':hover');
          const overAny = dialItems.some(b => b.matches(':hover'));
          if (!overFab && !overAny) closeDial();
        }, 300);
      });
    });

    // 检查缓存状态，显示绿点
    if (isWorkPage()) refreshCacheBadge(fab);
  }

  function openDial() {
    dialOpen = true;
    document.querySelector('.ao3s-fab')?.classList.add('open');
    dialItems.forEach((btn, i) => {
      setTimeout(() => btn.classList.add('visible'), i * 30);
    });
  }

  function closeDial() {
    dialOpen = false;
    document.querySelector('.ao3s-fab')?.classList.remove('open');
    dialItems.forEach(btn => btn.classList.remove('visible'));
  }

  async function refreshCacheBadge(fab) {
    const workId = getWorkId();
    if (!workId || !_jwt) return;
    try {
      // 静默检查缓存（不发起分析请求）
      const existing = GM_getValue(`cache_${workId}`, null);
      if (existing) {
        const badge = document.createElement('div');
        badge.className = 'ao3s-fab-badge';
        fab.appendChild(badge);
      }
    } catch {}
  }

  // ─── DOM 抽样 ──────────────────────────────────────────────────────────────
  function extractBodyFromDoc(doc) {
    for (const el of doc.querySelectorAll('.notes, .preface, .end.notes')) el.remove();
    const body = doc.querySelector('#chapters .userstuff.module, .userstuff.module');
    return body ? body.innerText.trim() : '';
  }

  function fetchAO3Page(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (r) => {
          const parser = new DOMParser();
          resolve(parser.parseFromString(r.responseText, 'text/html'));
        },
        onerror: reject
      });
    });
  }

  async function sampleWorkContent(workId) {
    // 获取章节列表
    const navDoc = await fetchAO3Page(
      `https://archiveofourown.org/works/${workId}/navigate`
    );
    const chapterLinks = [...navDoc.querySelectorAll('#main ol.chapter.index li a')];
    const chapterIds = chapterLinks.map(a => a.href.match(/chapters\/(\d+)/)?.[1]).filter(Boolean);

    if (chapterIds.length === 0) {
      // 单章文：直接读当前页
      const text = extractBodyFromDoc(document);
      return { text: text.slice(0, 8000), chapters: 1 };
    }

    if (chapterIds.length === 1) {
      const doc = await fetchAO3Page(
        `https://archiveofourown.org/works/${workId}/chapters/${chapterIds[0]}?view_adult=true`
      );
      return { text: extractBodyFromDoc(doc).slice(0, 8000), chapters: 1 };
    }

    // 多章文抽样
    const toFetch = [];
    toFetch.push({ id: chapterIds[0], limit: 2000 });                              // 首章
    if (chapterIds.length >= 4) {
      const mid = Math.floor(chapterIds.length / 2);
      toFetch.push({ id: chapterIds[mid], limit: 1000 });                          // 中间章
    }
    if (chapterIds.length >= 6) {
      const mid2 = Math.floor(chapterIds.length * 0.75);
      toFetch.push({ id: chapterIds[mid2], limit: 1000 });                         // 3/4 处
    }
    toFetch.push({ id: chapterIds[chapterIds.length - 2] || chapterIds[chapterIds.length - 1], limit: 1000 }); // 倒数第二章

    const parts = await Promise.all(toFetch.map(async ({ id, limit }) => {
      const doc = await fetchAO3Page(
        `https://archiveofourown.org/works/${workId}/chapters/${id}?view_adult=true`
      );
      return extractBodyFromDoc(doc).slice(0, limit);
    }));

    return {
      text: parts.join('\n\n【---章节分隔---】\n\n'),
      chapters: chapterIds.length
    };
  }

  // ─── 分析触发 ──────────────────────────────────────────────────────────────
  async function triggerAnalysis() {
    if (!isLoggedIn()) { showOnboarding(); return; }
    if (_analyzing) return;
    _analyzing = true;

    const workId = getWorkId();
    if (!workId) { showToast('无法识别作品 ID', 'error'); _analyzing = false; return; }

    // 获取作品标题
    const title = document.querySelector('.title.heading')?.textContent?.trim()
      || document.querySelector('h2.title')?.textContent?.trim() || '未知作品';

    openPanel();
    showPanelLoading('正在抽取章节内容…');

    try {
      // 抽样
      const { text, chapters } = await sampleWorkContent(workId);
      showPanelLoading('AI 分析中，请稍候…');

      // 判断是否完结
      // AO3 章节格式：完结="14/14"，连载="5/?"
      const chaptersText = document.querySelector('dl.stats dd.chapters')?.textContent || '';
      const isComplete = chaptersText.includes('/') && !chaptersText.includes('?');

      // 获取 tags 作为上下文
      const tags = [...document.querySelectorAll('.tags .tag')].map(t => t.textContent).join(', ');
      const fandom = document.querySelector('.fandom.tags .tag')?.textContent || '';
      const ship = document.querySelector('.relationship.tags .tag')?.textContent || '';
      const rating = document.querySelector('.rating.tags .tag')?.textContent || '';
      const wordCount = document.querySelector('dd.words')?.textContent || '';

      const context = `【作品基本信息】\nFandom: ${fandom}\nRelationship: ${ship}\nRating: ${rating}\nTags: ${tags}\n字数: ${wordCount}\n章节数: ${chapters}\n\n【正文节选】\n${text}`;

      showPanelLoading('正在生成报告…');

      const result = await apiCall('POST', '/api/analyze', {
        work_id: workId,
        content: context,
        model: GM_getValue('model', 'deepseek-v3.2'),
        is_complete: isComplete
      });

      // 本地记录缓存标志
      GM_setValue(`cache_${workId}`, true);
      showPanelResult(result, title, workId, chapters);

    } catch (e) {
      const msg = e.error || '分析失败，请重试';
      if (msg.includes('API Key 无效')) showToast('AIHubMix API Key 无效，请在设置中检查', 'error');
      else if (msg.includes('余额不足')) showToast('AIHubMix 余额不足，请充值', 'error');
      else if (msg.includes('API Key')) showToast('请先在设置中填写 AIHubMix API Key', 'error');
      else showToast(msg, 'error');
      closePanel();
    } finally {
      _analyzing = false;
    }
  }

  // ─── 侧滑面板 ──────────────────────────────────────────────────────────────
  let _overlay, _panel;

  function openPanel() {
    if (!_overlay) {
      _overlay = document.createElement('div');
      _overlay.className = 'ao3s-overlay';
      document.body.appendChild(_overlay);
    }
    if (!_panel) {
      _panel = document.createElement('div');
      _panel.className = 'ao3s-panel';
      document.body.appendChild(_panel);
    }
    setTimeout(() => { _overlay.classList.add('show'); _panel.classList.add('open'); }, 10);
    _panelOpen = true;
  }

  function closePanel() {
    _overlay?.classList.remove('show');
    _panel?.classList.remove('open');
    _panelOpen = false;
  }

  function showPanelLoading(msg) {
    if (!_panel) return;
    _panel.innerHTML = `
      <div class="ao3s-panel-header">
        <span class="ao3s-panel-title">AO3 Scout</span>
        <button class="ao3s-close-btn" onclick="this.closest('.ao3s-panel').classList.remove('open')">×</button>
      </div>
      <div class="ao3s-loading">
        <div class="ao3s-spinner"></div>
        <div class="ao3s-progress-bar"><div class="ao3s-progress-fill"></div></div>
        <div class="ao3s-loading-text">${msg}</div>
      </div>
    `;
    _panel.querySelector('.ao3s-close-btn').onclick = closePanel;
  }

  function showPanelResult(result, title, workId, chapters) {
    if (!_panel) return;
    const score = result.overall_score || 0;
    const circumference = 2 * Math.PI * 34;
    const offset = circumference * (1 - score / 10);

    const dimLabels = {
      logic_structure: '逻辑严密度',
      character_voice: '人物塑造',
      narrative_rhythm: '叙事节奏',
      emotional_tension: '情感张力',
      originality: '原创性'
    };

    const dimsHtml = Object.entries(dimLabels).map(([key, label]) => {
      const d = result.dimensions?.[key];
      if (!d) return '';
      const isLow = d.score < 6;
      const raw = d.comment || '';
      const quoteMatch = raw.match(/原文[：:]\s*「([^」]+)」/);
      const evalText = raw.replace(/原文[：:]\s*「[^」]+」/, '').trim();
      const quoteHtml = quoteMatch
        ? `<span class="ao3s-dim-quote">「${quoteMatch[1]}」</span>` : '';
      return `
        <div class="ao3s-dim-row">
          <div class="ao3s-dim-label">
            <span>${label}</span>
            <span class="ao3s-dim-score" style="color:${isLow ? 'var(--ao3s-warn)' : 'var(--ao3s-on-surface)'}">${d.score}</span>
          </div>
          <div class="ao3s-dim-bar">
            <div class="ao3s-dim-fill ${isLow ? 'low' : ''}" style="width:${d.score * 10}%"></div>
          </div>
          <div class="ao3s-dim-comment">${evalText}${quoteHtml}</div>
        </div>
      `;
    }).join('');

    const redFlagsHtml = result.red_flags?.length ? `
      <div class="ao3s-redflag-section">
        <div class="ao3s-redflag-header">⚠ 雷点警告 (${result.red_flags.length})</div>
        ${result.red_flags.map(f => `
          <div class="ao3s-redflag-item">
            <div class="ao3s-redflag-type">${f.type}</div>
            ${f.excerpt ? `<div class="ao3s-redflag-excerpt">「${f.excerpt}」</div>` : ''}
            <div style="font-size:12px;color:var(--ao3s-on-surface)">${f.reason}</div>
          </div>
        `).join('')}
      </div>
    ` : '';

    const excerptHtml = result.best_excerpt ? `
      <div class="ao3s-excerpt-section">「${result.best_excerpt}」</div>
    ` : '';

    const costText = result.cost_cny
      ? `¥${result.cost_cny.toFixed(3)}`
      : (result.from_cache ? '缓存' : '-');

    _panel.innerHTML = `
      <div class="ao3s-panel-header">
        <span class="ao3s-panel-title" title="${title}">AO3 Scout</span>
        <button class="ao3s-close-btn">×</button>
      </div>

      <div class="ao3s-score-section">
        <div class="ao3s-score-ring">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34"/>
            <circle class="progress" cx="40" cy="40" r="34"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${offset}"/>
          </svg>
          <div class="ao3s-score-number">${score}</div>
        </div>
        <div class="ao3s-score-right">
          <div class="ao3s-score-big">${score} <span style="font-size:16px;color:var(--ao3s-muted)">/10</span></div>
          <div class="ao3s-one-liner">${result.one_liner || ''}</div>
        </div>
      </div>

      <div class="ao3s-divider"></div>
      <div class="ao3s-dims">${dimsHtml}</div>

      ${redFlagsHtml}
      ${excerptHtml}

      <div class="ao3s-confidence">
        基于${chapters > 1 ? `首章 + 中间章节 + 尾章，共约 ${chapters} 章抽样` : '全文'}分析
        ${chapters > 3 ? '· 长篇作品中段质量可能与抽样片段有差异' : ''}
      </div>

      <div class="ao3s-panel-footer">
        <div class="ao3s-footer-actions">
          <button class="ao3s-btn" id="ao3s-btn-later">📋 稍后看</button>
          <button class="ao3s-btn" id="ao3s-btn-note">📝 写笔记</button>
        </div>
        <div class="ao3s-footer-meta">
          <span>${result.from_cache ? '📦 缓存' : costText}</span>
          <div class="ao3s-feedback-btns">
            <button id="ao3s-feedback-acc">准确 ✓</button>
            <button id="ao3s-feedback-inacc">不准 ✗</button>
          </div>
        </div>
      </div>
    `;

    _panel.querySelector('.ao3s-close-btn').onclick = closePanel;

    _panel.querySelector('#ao3s-btn-later').onclick = async () => {
      try {
        await apiCall('POST', '/api/reading-list', {
          work_id: workId, title,
          ao3_url: location.href,
          cached_score: score
        });
        showToast('已加入稍后看');
      } catch (e) { showToast(e.error || '添加失败', 'error'); }
    };

    _panel.querySelector('#ao3s-btn-note').onclick = () => showNoteModal(workId, title, score);

    _panel.querySelector('#ao3s-feedback-acc').onclick = async () => {
      await apiCall('POST', '/api/feedback', { work_id: workId, ai_score: score, user_rating: 'accurate' });
      showToast('感谢反馈！', 'success');
    };
    _panel.querySelector('#ao3s-feedback-inacc').onclick = async () => {
      await apiCall('POST', '/api/feedback', { work_id: workId, ai_score: score, user_rating: 'inaccurate' });
      showToast('感谢反馈，AI 会持续改进');
    };
  }

  // ─── 笔记弹窗 ──────────────────────────────────────────────────────────────
  function showNoteModal(workId, title, score) {
    const wrap = document.createElement('div');
    wrap.className = 'ao3s-modal-wrap';
    wrap.style.zIndex = '9500';
    wrap.innerHTML = `
      <div class="ao3s-modal">
        <h2>📝 为《${title.slice(0, 20)}${title.length > 20 ? '…' : ''}》写笔记</h2>
        <div class="ao3s-field">
          <label class="ao3s-label">读后状态</label>
          <div class="ao3s-tags">
            <div class="ao3s-tag selected" data-val="completed">✅ 读完</div>
            <div class="ao3s-tag" data-val="dropped">❌ 弃文</div>
            <div class="ao3s-tag" data-val="ongoing">⏳ 在读</div>
          </div>
        </div>
        <div class="ao3s-field">
          <label class="ao3s-label">笔记（只有你自己能看到）</label>
          <textarea class="ao3s-input" id="ao3s-note-text" rows="4" placeholder="随便写几句…" style="resize:vertical"></textarea>
        </div>
        <div class="ao3s-modal-footer">
          <button class="ao3s-btn" id="ao3s-note-cancel">取消</button>
          <button class="ao3s-btn primary" id="ao3s-note-save">保存</button>
        </div>
      </div>
    `;

    let readResult = 'completed';
    wrap.querySelectorAll('[data-val]').forEach(tag => {
      tag.onclick = () => {
        wrap.querySelectorAll('[data-val]').forEach(t => t.classList.remove('selected'));
        tag.classList.add('selected');
        readResult = tag.dataset.val;
      };
    });

    wrap.querySelector('#ao3s-note-cancel').onclick = () => wrap.remove();
    wrap.querySelector('#ao3s-note-save').onclick = async () => {
      const text = wrap.querySelector('#ao3s-note-text').value.trim();
      const fandom = document.querySelector('.fandom.tags .tag')?.textContent || '';
      const ship = document.querySelector('.relationship.tags .tag')?.textContent || '';
      try {
        await apiCall('POST', '/api/journal', {
          work_id: workId, title, fandom, ship,
          overall_score: score,
          comment_text: text,
          comment_type: 'tool_private',
          read_result: readResult,
          ao3_url: location.href
        });
        showToast('笔记已保存', 'success');
        wrap.remove();
      } catch (e) { showToast(e.error || '保存失败', 'error'); }
    };

    document.body.appendChild(wrap);
  }

  // ─── 设置面板 ──────────────────────────────────────────────────────────────
  function showSettings() {
    const wrap = document.createElement('div');
    wrap.className = 'ao3s-modal-wrap';
    wrap.style.zIndex = '9400';
    wrap.innerHTML = `
      <div class="ao3s-modal">
        <h2>⚙ 设置</h2>
        <div class="ao3s-field">
          <label class="ao3s-label">AIHubMix API Key</label>
          <input class="ao3s-input" id="ao3s-set-key" type="password" placeholder="重新填写以更新">
        </div>
        <div class="ao3s-field">
          <label class="ao3s-label">分析模型档位</label>
          <div class="ao3s-tags">
            <div class="ao3s-tag" data-model="gemini-2.5-pro">🚀 高品质 ¥0.128/次</div>
            <div class="ao3s-tag selected" data-model="deepseek-v3.2">⚖ 均衡 ¥0.028/次</div>
            <div class="ao3s-tag" data-model="gemini-2.5-flash">💰 省钱 ¥0.010/次</div>
          </div>
        </div>
        <div class="ao3s-field">
          <label class="ao3s-label">AO3 账号（用于分析 M/E 内容，可选）</label>
          <input class="ao3s-input" id="ao3s-set-ao3user" placeholder="AO3 用户名" style="margin-bottom:8px">
          <input class="ao3s-input" id="ao3s-set-ao3pass" type="password" placeholder="AO3 密码">
        </div>
        <div class="ao3s-field">
          <label class="ao3s-label">账号状态</label>
          <div style="font-size:13px;color:var(--ao3s-muted)" id="ao3s-login-status">
            ${isLoggedIn() ? '✅ 已登录 GitHub' : '❌ 未登录'}
          </div>
          ${!isLoggedIn() ? '<button class="ao3s-btn" style="margin-top:8px;width:100%" id="ao3s-relogin">重新授权 GitHub</button>' : ''}
        </div>
        <div class="ao3s-modal-footer">
          <button class="ao3s-btn" id="ao3s-set-cancel">取消</button>
          <button class="ao3s-btn primary" id="ao3s-set-save">保存</button>
        </div>
      </div>
    `;

    let selectedModel = GM_getValue('model', 'deepseek-v3.2');
    wrap.querySelectorAll('[data-model]').forEach(tag => {
      if (tag.dataset.model === selectedModel) tag.classList.add('selected');
      else tag.classList.remove('selected');
      tag.onclick = () => {
        wrap.querySelectorAll('[data-model]').forEach(t => t.classList.remove('selected'));
        tag.classList.add('selected');
        selectedModel = tag.dataset.model;
      };
    });

    wrap.querySelector('#ao3s-set-cancel').onclick = () => wrap.remove();
    wrap.querySelector('#ao3s-relogin')?.addEventListener('click', startOAuth);
    wrap.querySelector('#ao3s-set-save').onclick = async () => {
      const key = wrap.querySelector('#ao3s-set-key').value.trim();
      const ao3user = wrap.querySelector('#ao3s-set-ao3user').value.trim();
      const ao3pass = wrap.querySelector('#ao3s-set-ao3pass').value.trim();
      GM_setValue('model', selectedModel);
      try {
        if (key) await apiCall('PUT', '/api/user/aihubmix-key', { key });
        if (ao3user && ao3pass) {
          await apiCall('PUT', '/api/user/ao3-credentials', { username: ao3user, password: ao3pass });
        }
        showToast('设置已保存', 'success');
        wrap.remove();
      } catch (e) { showToast(e.error || '保存失败', 'error'); }
    };

    document.body.appendChild(wrap);
  }

  // ─── 推荐横幅（仅 AO3 首页）──────────────────────────────────────────────
  async function showRecommendationBanner() {
    if (!isLoggedIn()) return;
    const todayKey = 'banner_closed_' + new Date().toISOString().slice(0, 10);
    if (GM_getValue(todayKey, false)) return;

    let data;
    try {
      data = await apiCall('GET', '/api/recommendations?date=today');
    } catch { return; }

    if (!data?.fics?.length) {
      // 今日无推荐
      const bar = document.createElement('div');
      bar.style.cssText = `
        background: var(--ao3s-surface); color: var(--ao3s-muted);
        text-align: center; padding: 8px; font-size: 13px;
        border-bottom: 1px solid var(--ao3s-surface-2);
        font-family: -apple-system, sans-serif;
      `;
      bar.textContent = '⏳ AO3 Scout 今日推荐尚未生成，稍后再看';
      document.body.prepend(bar);
      return;
    }

    const banner = document.createElement('div');
    banner.className = 'ao3s-banner';
    banner.innerHTML = `
      <div class="ao3s-banner-header">
        <span class="ao3s-banner-title">✦ 今日为你精选 ${data.fics.length} 篇</span>
        <button class="ao3s-banner-close">×</button>
      </div>
      <div class="ao3s-banner-cards">
        ${data.fics.map(f => `
          <div class="ao3s-banner-card" data-url="${f.ao3_url || '#'}">
            <div class="ao3s-banner-card-top">
              <div class="ao3s-banner-card-title">${f.title || '未知标题'}</div>
              <div class="ao3s-banner-score">★ ${f.score || '?'}</div>
            </div>
            <div class="ao3s-banner-meta">${f.fandom || ''} · ${f.word_count ? Math.round(f.word_count/1000)+'K字' : ''}</div>
            ${f.best_excerpt ? `<div class="ao3s-banner-excerpt">「${f.best_excerpt}」</div>` : ''}
            <div class="ao3s-banner-liner">${f.one_liner || ''}</div>
          </div>
        `).join('')}
      </div>
    `;

    document.body.prepend(banner);
    setTimeout(() => banner.classList.add('show'), 500);

    banner.querySelector('.ao3s-banner-close').onclick = () => {
      banner.classList.remove('show');
      GM_setValue(todayKey, true);
      setTimeout(() => banner.remove(), 300);
    };

    banner.querySelectorAll('.ao3s-banner-card').forEach(card => {
      card.onclick = () => {
        const url = card.dataset.url;
        if (url && url !== '#') window.open(url, '_blank');
      };
    });
  }

  // ─── ESC 快捷键 ───────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _panelOpen) closePanel();
    if (e.key === '/' && isWorkPage() && !_panelOpen &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      triggerAnalysis();
    }
  });

  // ─── AO3 评论自动捕获 ──────────────────────────────────────────────────────
  function setupCommentCapture() {
    const form = document.querySelector('form.new_comment');
    if (!form || !isWorkPage()) return;
    form.addEventListener('submit', async () => {
      const text = document.querySelector('#comment_content')?.value;
      const workId = getWorkId();
      const title = document.querySelector('.title.heading')?.textContent?.trim();
      if (text && workId && _jwt) {
        try {
          await apiCall('POST', '/api/journal', {
            work_id: workId, title,
            comment_text: text,
            comment_type: 'ao3_public',
            ao3_url: location.href
          });
        } catch {}
      }
    });
  }

  // ─── 版本检查 ──────────────────────────────────────────────────────────────
  async function checkVersion() {
    try {
      const resp = await new Promise(resolve => GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://api.github.com/repos/aquiloyang/ao3-scout/releases/latest',
        headers: { 'User-Agent': 'AO3-Scout' },
        onload: resolve, onerror: resolve
      }));
      const data = JSON.parse(resp.responseText);
      const latest = data.tag_name?.replace('v', '');
      if (latest && latest > VERSION) {
        const bar = document.createElement('div');
        bar.style.cssText = `
          background: var(--ao3s-warn); color: #1A1A2E;
          text-align: center; padding: 6px; font-size: 13px; cursor: pointer;
          font-family: -apple-system, sans-serif; z-index: 9100; position: relative;
        `;
        bar.innerHTML = `🔔 AO3 Scout 有新版本 v${latest} 可用，点击查看`;
        bar.onclick = () => window.open(`https://github.com/aquiloyang/ao3-scout/releases/latest`, '_blank');
        document.body.prepend(bar);
      }
    } catch {}
  }

  // ─── 稍后看抽屉 ───────────────────────────────────────────────────────────
  function showReadingList() {
    if (document.querySelector('.ao3s-drawer')) return;

    const drawer = document.createElement('div');
    drawer.className = 'ao3s-panel ao3s-drawer';
    drawer.innerHTML = `
      <div class="ao3s-panel-header">
        <span class="ao3s-panel-title">📋 稍后看</span>
        <button class="ao3s-close-btn" id="ao3s-drawer-close">×</button>
      </div>
      <div id="ao3s-rl-body" style="padding:16px">
        <div class="ao3s-loading"><div class="ao3s-spinner"></div></div>
      </div>
    `;
    document.body.appendChild(drawer);
    drawer.querySelector('#ao3s-drawer-close').onclick = () => {
      drawer.classList.remove('open');
      setTimeout(() => drawer.remove(), 300);
    };
    setTimeout(() => drawer.classList.add('open'), 10);

    apiCall('GET', '/api/reading-list').then(data => {
      const items = data.items || [];
      const body = drawer.querySelector('#ao3s-rl-body');
      if (!items.length) {
        body.innerHTML = `<div style="text-align:center;color:var(--ao3s-muted);padding:32px 0;font-size:14px">还没有加入稍后看的文章</div>`;
        return;
      }
      body.innerHTML = items.map(item => `
        <div class="ao3s-rl-item" data-id="${item.work_id}">
          <div class="ao3s-rl-title">
            <a href="${item.ao3_url}" target="_blank" style="color:var(--ao3s-on-surface);text-decoration:none">${item.title}</a>
            ${item.cached_score ? `<span class="ao3s-rl-score">${item.cached_score}</span>` : ''}
          </div>
          <div class="ao3s-rl-meta">${item.added_at ? new Date(item.added_at).toLocaleDateString('zh-CN') : ''}</div>
          <button class="ao3s-rl-remove" data-id="${item.work_id}">移除</button>
        </div>
      `).join('');

      body.querySelectorAll('.ao3s-rl-remove').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          try {
            await apiCall('DELETE', `/api/reading-list/${id}`);
            btn.closest('.ao3s-rl-item').remove();
            if (!body.querySelector('.ao3s-rl-item')) {
              body.innerHTML = `<div style="text-align:center;color:var(--ao3s-muted);padding:32px 0;font-size:14px">还没有加入稍后看的文章</div>`;
            }
          } catch { showToast('移除失败', 'error'); }
        };
      });
    }).catch(() => {
      drawer.querySelector('#ao3s-rl-body').innerHTML =
        `<div style="text-align:center;color:var(--ao3s-error);padding:32px 0;font-size:14px">加载失败，请重试</div>`;
    });
  }

  // ─── 搜索页 AI 按钮 ────────────────────────────────────────────────────────
  function injectSearchButtons() {
    document.querySelectorAll('li.work.blurb').forEach(li => {
      if (li.querySelector('.ao3s-preview-btn')) return; // 已注入

      // AO3 work ID 在 id="work_12345" 里
      const workId = li.id?.replace('work_', '');
      if (!workId) return;

      const titleEl = li.querySelector('h4 a');
      const title = titleEl?.textContent?.trim() || '未知作品';

      const btn = document.createElement('button');
      btn.className = 'ao3s-preview-btn';
      btn.textContent = '✦ AI 预览';
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isLoggedIn()) { showOnboarding(); return; }
        if (btn.disabled) return;

        btn.disabled = true;
        btn.textContent = '分析中…';
        openPanel();
        showPanelLoading('AI 分析中，请稍候…');

        try {
          // 从 blurb 提取可见元数据
          const fandom  = [...li.querySelectorAll('.fandoms .tag')].map(t => t.textContent).join(', ');
          const ship    = [...li.querySelectorAll('.relationships .tag')].map(t => t.textContent).join(', ');
          const tags    = [...li.querySelectorAll('.freeforms .tag')].map(t => t.textContent).join(', ');
          const rating  = li.querySelector('.rating .tag')?.textContent || '';
          const words   = li.querySelector('dd.words')?.textContent || '';
          const chapters = li.querySelector('dd.chapters')?.textContent || '';
          const summary = li.querySelector('blockquote.userstuff')?.innerText?.trim()
                       || li.querySelector('.summary.module')?.innerText?.trim() || '';

          const content = [
            `【作品标题】${title}`,
            `【Fandom】${fandom}`,
            `【CP/Relationship】${ship}`,
            `【Rating】${rating}`,
            `【字数】${words}　【章节】${chapters}`,
            `【Tags】${tags}`,
            summary ? `【简介】\n${summary}` : ''
          ].filter(Boolean).join('\n');

          const result = await apiCall('POST', '/api/analyze', {
            work_id: workId,
            content,
            model: GM_getValue('model', 'deepseek-v3.2'),
            is_complete: false,
            is_preview: true
          });
          GM_setValue(`cache_${workId}`, true);
          showPanelResult(result, title, workId, 0);
          btn.textContent = '✦ 已分析';
        } catch (e) {
          closePanel();
          showToast(e.error || '分析失败', 'error');
          btn.disabled = false;
          btn.textContent = '✦ AI 预览';
        }
      };

      // 插入到 ul.actions 或标题行后
      const actions = li.querySelector('ul.actions');
      if (actions) {
        const item = document.createElement('li');
        item.appendChild(btn);
        actions.appendChild(item);
      } else {
        li.querySelector('h4')?.appendChild(btn);
      }
    });
  }

  // ─── 初始化 ───────────────────────────────────────────────────────────────
  function init() {
    checkOAuthCallback();
    createFAB();
    setupCommentCapture();

    if (isSearchPage()) {
      injectSearchButtons();
    }

    if (isHomePage()) {
      setTimeout(showRecommendationBanner, 500);
    }

    if (!isLoggedIn()) {
      setTimeout(checkOnboarding, 1500);
    } else {
      const keyDone = GM_getValue('setup_key_done', false);
      if (!keyDone) setTimeout(checkOnboarding, 1000);
    }

    checkVersion();
  }

  // 菜单命令
  GM_registerMenuCommand('⚙ AO3 Scout 设置', showSettings);
  GM_registerMenuCommand('🔄 重新授权 GitHub', startOAuth);

  init();
})();
