/**
 * Tetris-tile plugin manager: two pages (system / self-made), each a grid of
 * colored tiles. Click an empty tile to add a plugin from a GitHub URL, local
 * folder, or ZIP; drag a ZIP onto an empty tile to upload-install; drag tiles
 * to rearrange; drag a self-made tile onto the trash to uninstall. Disabled
 * tiles render gray with a bottom stub.
 *
 * The page is a single self-contained HTML document served at `/kmanager`,
 * driving the `/api/kmanager` JSON API.
 * @module @deepseek-ai/dsh-plugin-kmanager/page
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { KMGR_PAGE_PATH } from './http.ts'

const CATEGORY_COLORS: Record<string, string> = {
  core: '#64748b',
  ui: '#5686fe',
  host: '#14b8a6',
  gateway: '#a78bfa',
  llm: '#eab308',
  session: '#ec4899',
  exec: '#f25a5a',
  task: '#34d399',
  interaction: '#f97316',
  untagged: '#9ea4ad',
}

const CATEGORY_LABELS = {
  core: '核心',
  ui: '界面',
  host: '宿主',
  gateway: '网关',
  llm: '模型',
  session: '会话',
  exec: '执行',
  task: '任务',
  interaction: '交互',
  untagged: '未分类',
} as const

const PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>插件管理器</title>
<style>
  /* Self-contained token scale aligned with the harness design platform
     (ui-theme): bluish-neutral dark scale, deepseek brand, semantic aliases.
     The page renders outside the theme owner's DOM, so the scale is declared
     locally instead of consuming ui-theme's live variables. */
  :root {
    color-scheme: dark;
    --c-bg-base: #151517;
    --c-bg-layer-1: #232326;
    --c-bg-layer-2: #2c2c2e;
    --c-bg-layer-3: #35353a;
    --c-bg-mask: rgba(0, 0, 0, 0.55);
    --c-label-primary: #eef0f3;
    --c-label-secondary: #cfd3da;
    --c-label-tertiary: #9ea4ad;
    --c-label-dimmed: #6a6f76;
    --c-border-l1: rgba(255, 255, 255, 0.06);
    --c-border-l2: rgba(255, 255, 255, 0.12);
    --c-border-l3: rgba(255, 255, 255, 0.18);
    --c-interactive-hover: rgba(255, 255, 255, 0.08);
    --c-interactive-active: rgba(255, 255, 255, 0.14);
    --c-brand: #5686fe;
    --c-brand-hover: #4176e6;
    --c-success: #22c55e;
    --c-danger: #f25a5a;
    --c-warn: #f5a03b;
    --c-focus: rgba(86, 134, 254, 0.5);
    --c-shadow-lv2: 0 4px 12px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.22);
    --c-shadow-lv3: 0 8px 24px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.28);
    --c-ease: cubic-bezier(0.4, 0, 0.2, 1);
    --c-duration: 0.2s;
    --c-radius: 10px;
    --c-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
      'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--c-font);
    background: var(--c-bg-base); color: var(--c-label-primary);
    margin: 0; padding: 24px 28px; line-height: 1.5;
  }
  header {
    display: flex; align-items: center; gap: 16px; margin-bottom: 20px;
  }
  h1 { font-size: 20px; font-weight: 600; margin: 0; letter-spacing: 0.2px; }
  .spacer { flex: 1; }
  #sort-btns { display: inline-flex; gap: 4px; padding: 3px; }
  #sort-btns button {
    border: none; background: transparent; color: var(--c-label-tertiary);
    font-size: 12px; font-weight: 500; padding: 5px 12px; border-radius: 7px;
    cursor: pointer; transition: background var(--c-duration) var(--c-ease), color var(--c-duration) var(--c-ease);
  }
  #sort-btns button:hover { color: var(--c-label-primary); background: var(--c-interactive-hover); }
  #sort-btns button.active {
    background: var(--c-interactive-active); color: var(--c-label-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  #status { font-size: 13px; color: var(--c-label-tertiary); }
  #search {
    border: none; background: var(--c-bg-layer-1); color: var(--c-label-primary);
    font-family: inherit; font-size: 13px; padding: 7px 12px; border-radius: 9px;
    width: 200px; outline: none;
    transition: box-shadow var(--c-duration) var(--c-ease);
  }
  #search:focus { box-shadow: 0 0 0 2px var(--c-focus); }
  #search::placeholder { color: var(--c-label-tertiary); }
  #close-btn {
    border: none; background: transparent; color: var(--c-label-tertiary);
    cursor: pointer; font-size: 20px; line-height: 1; padding: 4px 8px;
    border-radius: 8px; margin-left: 4px;
    transition: background var(--c-duration) var(--c-ease), color var(--c-duration) var(--c-ease);
  }
  #close-btn:hover { color: var(--c-label-primary); background: var(--c-interactive-hover); }
  nav {
    display: flex; gap: 4px; margin-bottom: 20px; padding: 4px;
    width: fit-content;
  }
  nav button {
    border: none; background: transparent; color: var(--c-label-tertiary);
    font-size: 14px; font-weight: 500; padding: 8px 20px; border-radius: 9px;
    cursor: pointer; transition: background var(--c-duration) var(--c-ease),
      color var(--c-duration) var(--c-ease);
  }
  nav button:hover { color: var(--c-label-primary); background: var(--c-interactive-hover); }
  nav button.active {
    background: var(--c-interactive-active); color: var(--c-label-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .legend {
    display: flex; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 20px;
    font-size: 12px;
  }
  .legend span {
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--c-label-tertiary);
  }
  .swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  #grid {
    display: grid;
    grid-template-columns: repeat(var(--cols, 10), minmax(0, 1fr));
    gap: 8px; max-width: 1120px;
    container-type: inline-size;
  }
  /* Radius and tile text scale with the tile width (grid width / col count),
     so 20-col layouts and narrow windows keep proportional tiles. */
  .cell {
    aspect-ratio: 1; border-radius: calc(8cqw / var(--cols, 10));
    position: relative; overflow: hidden;
  }
  .cell.plugin {
    background: var(--c); color: #101114; cursor: grab;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-size: calc(11cqw / var(--cols, 10)); text-align: center;
    padding: 2px 4px; line-height: 1.2;
    box-shadow: var(--c-shadow-lv2);
    user-select: none;
    transition: transform var(--c-duration) var(--c-ease), opacity 120ms var(--c-ease);
  }
  .cell.plugin:hover { transform: translateY(-2px); }
  .tile-name {
    max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    font-weight: 600;
  }
  .tile-cat {
    font-size: 0.85em; font-weight: 400; opacity: 0.72;
    margin-top: 0.15em; max-width: 100%; overflow: hidden;
    white-space: nowrap; text-overflow: ellipsis;
  }
  .cell.plugin.off {
    background: var(--c-bg-layer-3); color: var(--c-label-dimmed);
    box-shadow: none;
  }
  .cell.plugin.off::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0;
    height: 6px; border-radius: 0 0 calc(8cqw / var(--cols, 10)) calc(8cqw / var(--cols, 10));
    background: var(--c);
  }
  .cell.plugin.dragging { opacity: 0.3; transform: scale(0.96); }
  .cell.plugin.over { outline: 2px dashed var(--c-label-primary); outline-offset: -4px; }
  .cell.empty {
    background: var(--c-bg-layer-1); color: var(--c-label-dimmed);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    background-image: radial-gradient(var(--c-label-dimmed) 1px, transparent 1px);
    background-size: calc(2cqw / var(--cols, 10)) calc(2cqw / var(--cols, 10));
    border: 1px solid var(--c-border-l1);
    transition: background var(--c-duration) var(--c-ease),
      outline-color var(--c-duration) var(--c-ease);
  }
  .cell.empty:hover {
    background-color: var(--c-interactive-hover);
    outline: 2px dashed var(--c-label-tertiary); outline-offset: -4px;
  }
  .cell.empty .plus {
    font-size: calc(14cqw / var(--cols, 10)); font-weight: 600; color: var(--c-label-tertiary);
    opacity: 0.85;
  }
  .cell.empty.drop-target {
    outline: 2px dashed var(--c-brand); outline-offset: -4px;
    background-color: rgba(86, 134, 254, 0.12);
  }
  #trash {
    margin-top: 24px; display: inline-flex; align-items: center; gap: 10px;
    padding: 12px 22px; border-radius: var(--c-radius);
    border: 1px dashed var(--c-border-l2); background: var(--c-bg-layer-1);
    color: var(--c-label-tertiary); font-size: 13px; user-select: none;
    transition: border-color var(--c-duration) var(--c-ease),
      color var(--c-duration) var(--c-ease), background var(--c-duration) var(--c-ease);
  }
  #preset-view { display: none; max-width: 1120px; }
  #preset-view.open { display: block; }
  .phead {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 12px; margin-bottom: 16px;
  }
  .act-btn {
    border: 1px solid var(--c-brand); background: var(--c-brand); color: #fff;
    font-size: 13px; font-weight: 600; padding: 9px 18px; border-radius: 9px;
    cursor: pointer; transition: background var(--c-duration) var(--c-ease);
  }
  .act-btn:hover { background: var(--c-brand-hover); }
  #preset-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
  .pcard {
    background: var(--c-bg-layer-1); border: 1px solid var(--c-border-l1);
    border-radius: 12px; padding: 14px 16px;
    transition: border-color var(--c-duration) var(--c-ease),
      background var(--c-duration) var(--c-ease);
  }
  .pcard:hover { border-color: var(--c-border-l2); background: var(--c-bg-layer-2); }
  .pcard .pname { font-size: 14px; font-weight: 600; margin-bottom: 4px; word-break: break-all; }
  .pcard .pdesc { font-size: 12px; color: var(--c-label-tertiary); }
  .pcard .pdir { font-size: 11px; color: var(--c-label-dimmed); margin-top: 8px; font-family: ui-monospace, Consolas, monospace; }
  .pcard.empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6px; min-height: 96px; color: var(--c-label-dimmed); cursor: pointer;
    border: 1px dashed var(--c-border-l2); background: transparent;
  }
  .pcard.empty:hover { border-color: var(--c-brand); color: var(--c-brand); background: rgba(86, 134, 254, 0.06); }
  .pcard.empty .plus { font-size: 22px; font-weight: 600; }
  #p-cands { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .pcan {
    display: flex; align-items: flex-start; gap: 8px;
    border: 1px solid var(--c-border-l1); border-radius: 9px; padding: 10px 12px;
    background: var(--c-bg-base); cursor: pointer;
    transition: border-color var(--c-duration) var(--c-ease), background var(--c-duration) var(--c-ease);
  }
  .pcan:hover { border-color: var(--c-brand); }
  .pcan input[type="radio"] { width: auto; flex: none; margin-top: 3px; accent-color: var(--c-brand); }
  .pcan label { margin: 0; font-size: 13px; color: var(--c-label-primary); cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
  .pcan .can-name { font-weight: 600; }
  .pcan .can-desc { font-size: 12px; color: var(--c-label-tertiary); }
  #trash.over {
    border-color: var(--c-danger); color: var(--c-danger);
    background: rgba(242, 90, 90, 0.12);
  }
  #trash.hidden { visibility: hidden; }
  #toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: var(--c-danger); color: #fff; padding: 10px 18px;
    border-radius: 10px; font-size: 13px; display: none; max-width: 80vw;
    z-index: 20; box-shadow: var(--c-shadow-lv3);  }
  #cat-menu {
    position: fixed; z-index: 40; display: none; min-width: 160px;
    background: var(--c-bg-layer-1); border: 1px solid var(--c-border-l2);
    border-radius: 10px; padding: 4px; box-shadow: var(--c-shadow-lv3);
  }
  #cat-menu.open { display: block; }
  #cat-menu .menu-title {
    padding: 6px 10px; font-size: 11px; color: var(--c-label-tertiary);
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 240px;
  }
  #cat-menu button {
    display: flex; align-items: center; gap: 8px; width: 100%;
    border: none; background: transparent; color: var(--c-label-primary);
    font-family: inherit; font-size: 13px; padding: 6px 10px; border-radius: 7px;
    cursor: pointer; text-align: left;
  }
  #cat-menu button:hover { background: var(--c-interactive-hover); }
  #cat-menu button .swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  #cat-menu button.active { background: var(--c-interactive-active); font-weight: 600; }
  #dialog {
    position: fixed; inset: 0; z-index: 30; display: none;
    align-items: center; justify-content: center;
    background: var(--c-bg-mask);
  }
  #dialog.open { display: flex; }
  #p-dialog {
    position: fixed; inset: 0; z-index: 30; display: none;
    align-items: center; justify-content: center;
    background: var(--c-bg-mask);
  }
  #p-dialog.open { display: flex; }
  .panel {
    width: min(520px, 92vw); background: var(--c-bg-layer-1);
    border: 1px solid var(--c-border-l2); border-radius: 14px;
    padding: 24px; box-shadow: var(--c-shadow-lv3);
    animation: panel-in 160ms var(--c-ease);
  }
  @keyframes panel-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
  }
  .panel h2 { margin: 0 0 18px; font-size: 16px; font-weight: 600; }
  .panel label { display: block; font-size: 13px; color: var(--c-label-tertiary); margin: 12px 0 6px; }
  .panel input, .panel select {
    width: 100%; padding: 10px 12px; border-radius: 9px;
    border: 1px solid var(--c-border-l2); background: var(--c-bg-base);
    color: var(--c-label-primary); font-size: 14px;
    transition: border-color var(--c-duration) var(--c-ease),
      box-shadow var(--c-duration) var(--c-ease);
  }
  .panel input:focus, .panel select:focus {
    outline: none; border-color: var(--c-brand); box-shadow: 0 0 0 3px var(--c-focus);
  }
  .row { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
  .row button {
    padding: 9px 18px; border-radius: 9px; border: 1px solid var(--c-border-l2);
    background: var(--c-bg-layer-3); color: var(--c-label-primary);
    cursor: pointer; font-size: 14px; transition: background var(--c-duration) var(--c-ease);
  }
  .row button:hover { background: var(--c-interactive-hover); }
  .row button.primary {
    background: var(--c-brand); border-color: var(--c-brand); color: #fff;
  }
  .row button.primary:hover { background: var(--c-brand-hover); }
  .drop-hint {
    border: 1px dashed var(--c-border-l2); border-radius: 9px; padding: 16px;
    text-align: center; color: var(--c-label-tertiary); font-size: 12px;
    margin-top: 14px; transition: border-color var(--c-duration) var(--c-ease),
      color var(--c-duration) var(--c-ease);
  }
  .drop-hint.over { border-color: var(--c-brand); color: var(--c-brand); }
  #progress {
    position: fixed; inset: 0; z-index: 40; display: none;
    align-items: center; justify-content: center; flex-direction: column; gap: 16px;
    background: var(--c-bg-mask);
  }
  #progress.open { display: flex; }
  #progress-text { font-size: 14px; color: var(--c-label-primary); }
  #progress-track { width: min(300px, 70vw); height: 6px; border-radius: 3px; background: var(--c-bg-layer-3); overflow: hidden; }
  #progress-fill { width: 0%; height: 100%; border-radius: 3px; background: var(--c-brand); transition: width 200ms var(--c-ease); }
  #progress-fill.indeterminate { width: 40%; animation: prog-slide 1.1s var(--c-ease) infinite; }
  @keyframes prog-slide {
    from { margin-left: -40%; }
    to { margin-left: 100%; }
  }
  button:focus-visible { outline: 2px solid var(--c-focus); outline-offset: 2px; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--c-scroll-thumb, rgba(255,255,255,.16));
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover { background: var(--c-scroll-thumb-hover, rgba(255,255,255,.3)); background-clip: padding-box; border: 2px solid transparent; }
  ::-webkit-scrollbar-corner { background: transparent; }
</style>
</head>
<body>
<header>
  <h1>插件管理器</h1>
  <span class="spacer"></span>
  <input id="search" type="search" placeholder="搜索插件…" aria-label="搜索插件"/>
  <div id="sort-btns">
    <button data-sort="cat">按颜色</button>
    <button data-sort="name">按名称</button>
  </div>
  <span id="status"></span>
  <button id="close-btn" type="button" aria-label="关闭插件管理" title="关闭">✕</button>
</header>
<nav>
  <button data-page="official" class="active">系统</button>
  <button data-page="custom">自制</button>
  <button data-page="preset">预设</button>
</nav>
<div class="legend" id="legend"></div>
<div id="grid"></div>
<div id="preset-view">
  <div class="phead">
    <div>
      <h2 style="margin:0;font-size:16px;font-weight:600">自定义预设</h2>
      <p style="margin:4px 0 0;font-size:12px;color:var(--c-label-tertiary)">位于 ~/.dsh/.agent-presets 的预设，可从 GitHub 仓库 / 本地文件夹 / ZIP 导入</p>
    </div>
    <button id="preset-add-btn" class="act-btn">导入预设</button>
  </div>
  <div id="preset-list"></div>
</div>
<div id="trash" class="hidden">🗑 拖入以卸载</div>
<div id="toast"></div>

<div id="cat-menu" role="menu" aria-label="设置分类"></div>

<div id="dialog">
  <div class="panel">
    <h2>添加插件</h2>
    <label>来源</label>
    <select id="add-kind">
      <option value="gitUrl">GitHub 项目地址</option>
      <option value="folderPath">本地文件夹路径</option>
      <option value="zipPath">本地 ZIP 路径</option>
    </select>
    <label id="add-label">项目地址（https://github.com/user/repo）</label>
    <input id="add-value" type="text" placeholder=""/>
    <div class="drop-hint" id="zip-drop">也可以直接把 .zip 安装包拖到这里，或拖到网格空白块</div>
    <div class="row">
      <button id="add-cancel">取消</button>
      <button id="add-ok" class="primary">添加</button>
    </div>
  </div>
</div>

<div id="p-dialog">
  <div class="panel">
    <h2>导入预设</h2>
    <label>来源</label>
    <select id="p-kind">
      <option value="gitUrl">GitHub 项目地址</option>
      <option value="folderPath">本地文件夹路径</option>
      <option value="zipPath">本地 ZIP 路径</option>
    </select>
    <label id="p-label">项目地址（https://github.com/user/repo）</label>
    <input id="p-value" type="text" placeholder=""/>
    <div id="p-cands"></div>
    <div class="row">
      <button id="p-cancel">取消</button>
      <button id="p-scan" class="primary">扫描</button>
    </div>
  </div>
</div>

<div id="progress">
  <div id="progress-text">正在操作…</div>
  <div id="progress-track"><div id="progress-fill"></div></div>
</div>

<script>
const api = '/api/kmanager';
const colors = ${JSON.stringify(CATEGORY_COLORS)};
const labels = ${JSON.stringify(CATEGORY_LABELS)};
let state = { official: [], custom: [], presets: [], layout: { official: [], custom: [] } };
let page = 'official';
let dragId = null;
let dragActive = false;
let sortMode = null;

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(() => el.style.display = 'none', 3000);
}
async function http(method, segment, body) {
  const opt = body ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { method };
  try {
    const res = await fetch(api + segment, opt);
    return await res.json().catch(() => ({ ok: false, message: '响应格式错误' }));
  } catch (e) { return { ok: false, message: String(e) }; }
}
// op-progress overlay: indeterminate for add/remove, determinate % for zips
const progEl = document.getElementById('progress');
const progText = document.getElementById('progress-text');
const progFill = document.getElementById('progress-fill');
function showProgress(text, determinate = false) {
  progText.textContent = text;
  progFill.classList.toggle('indeterminate', !determinate);
  if (!determinate) progFill.style.width = '';
  progEl.classList.add('open');
}
function setProgress(pct) { progFill.style.width = pct + '%'; }
function hideProgress() { progEl.classList.remove('open'); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function shortName(t) {
  const raw = t.moduleName || t.packageName || t.entryId;
  return raw.replace(/^@[^/]+[/]/, '').replace(/^include:/, '').replace(/^cordis:/, '');
}
// display order for the active page: persisted layout first, then new ones
function ordered(list) {
  if (sortMode === 'name') return [...list].sort((a, b) => shortName(a).localeCompare(shortName(b), 'zh'));
  if (sortMode === 'cat') return [...list].sort((a, b) => (a.category || 'untagged').localeCompare(b.category || 'untagged'));
  const key = page === 'official' ? 'official' : 'custom';
  const order = state.layout[key] || [];
  const items = [...list];
  items.sort((a, b) => {
    const ia = order.indexOf(a.entryId), ib = order.indexOf(b.entryId);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  });
  return items;
}
function buildGrid() {
  const grid = document.getElementById('grid');
  const isPreset = page === 'preset';
  grid.style.display = isPreset ? 'none' : '';
  document.getElementById('preset-view').classList.toggle('open', isPreset);
  document.getElementById('legend').style.display = isPreset ? 'none' : '';
  document.getElementById('sort-btns').style.display = isPreset ? 'none' : '';
  document.getElementById('search').style.display = isPreset ? 'none' : '';
  const trash = document.getElementById('trash');
  trash.classList.toggle('hidden', page !== 'custom');
  if (isPreset) { buildPreset(); return; }
  let list = page === 'official' ? state.official : state.custom;
  const q = document.getElementById('search').value.trim().toLowerCase();
  if (q) list = list.filter(t => (shortName(t) + ' ' + (t.moduleName || t.packageName || '')).toLowerCase().includes(q));
  const items = ordered(list);
  const cols = items.length > 100 ? 12 : 10;
  const rows = Math.max(1, Math.ceil((items.length + 1) / cols));
  // FLIP: snapshot old tile positions before rebuilding
  const prev = new Map();
  for (const c of grid.children) if (c.dataset.eid) prev.set(c.dataset.eid, c.getBoundingClientRect());
  grid.style.setProperty('--cols', cols);
  grid.innerHTML = '';
  for (let i = 0; i < rows * cols; i++) {
    const t = items[i];
    const cell = document.createElement('div');
    if (t) {
      const cat = t.category || 'untagged';
      cell.className = 'cell plugin' + (t.enabled ? '' : ' off');
      cell.dataset.eid = t.entryId;
      cell.style.setProperty('--c', colors[cat] || colors.untagged);
      cell.innerHTML = \`<span class="tile-name">\${escapeHtml(shortName(t))}</span><span class="tile-cat">\${escapeHtml(labels[cat] || cat)}</span>\`;
      cell.draggable = true;
      cell.title = \`\${t.moduleName || t.packageName || t.entryId} · \${t.enabled ? '运行中' : '已禁用'}（点击切换，拖拽排序，右键分类）\`;
      cell.addEventListener('click', () => toggle(t.entryId, t.enabled));
      cell.addEventListener('contextmenu', (e) => { e.preventDefault(); openCatMenu(e, t); });
      cell.addEventListener('dragstart', (e) => {
        dragId = t.entryId;
        dragActive = true;
        dragEl = cell;
        cell.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', t.entryId);
      });
      cell.addEventListener('dragend', () => {
        cell.classList.remove('dragging');
        document.querySelectorAll('.cell.plugin.over, .cell.empty.drop-target').forEach(c => c.classList.remove('over', 'drop-target'));
        dragId = null;
        dragActive = false;
      });
    } else {
      cell.className = 'cell empty';
      cell.innerHTML = '<span class="plus">＋</span>';
      cell.title = '点击添加插件';
      cell.addEventListener('click', () => openAddDialog());
      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dragActive) return;
        cell.classList.add('drop-target');
        if (hasZip(e)) e.dataTransfer.dropEffect = 'copy';
        else e.dataTransfer.dropEffect = 'move';
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drop-target');
        if (dragActive) return;
        const file = [...e.dataTransfer.files].find(f => /\.zip$/i.test(f.name));
        if (file) { uploadZip(file); return; }
        const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url && /^https?:[/][/]/.test(url)) add({ gitUrl: url.trim() });
      });
    }
    grid.appendChild(cell);
  }
  // FLIP: animate from old tile positions to new (transition on transform)
  requestAnimationFrame(() => {
    for (const c of grid.children) {
      const p = c.dataset.eid && prev.get(c.dataset.eid);
      if (!p) continue;
      const n = c.getBoundingClientRect();
      const dx = p.left - n.left, dy = p.top - n.top;
      if (!dx && !dy) continue;
      c.style.transition = 'none';
      c.style.transform = \`translate(\${dx}px, \${dy}px)\`;
      c.getBoundingClientRect(); // force reflow so the flip transform commits
      c.style.transition = '';
      c.style.transform = '';
    }
  });
}
function buildPreset() {
  const el = document.getElementById('preset-list');
  const presets = state.presets || [];
  el.innerHTML = presets.map(p => \`<div class="pcard"><div class="pname">\${escapeHtml(p.name)}</div>\${p.description ? '<div class="pdesc">' + escapeHtml(p.description) + '</div>' : ''}<div class="pdir">~/.dsh/.agent-presets/ \${escapeHtml(p.folderName)}</div></div>\`).join('')
    + '<div class="pcard empty" onclick="openPresetDialog()"><span class="plus">＋</span>导入预设</div>';
}
function hasZip(e) {
  return [...e.dataTransfer.items].some(i => i.kind === 'file' && /\.zip$/i.test(i.type || i.getAsFile()?.name || ''));
}
async function persistLayout(key) {
  await http('POST', '/set-layout', { page: key, order: state.layout[key] });
}
async function toggle(id, wasEnabled) {
  const r = await http('POST', '/set-enabled', { entryId: id, enabled: !wasEnabled });
  if (!r.ok) { toast(r.message || '操作失败'); return; }
  await load();
}
async function add(src) {
  showProgress('正在安装…');
  let r;
  try { r = await http('POST', '/add', src); } finally { hideProgress(); }
  if (!r.ok) { toast(r.message || '添加失败'); return; }
  const newId = r.data.folderName || r.data.entryId;
  const key = 'custom';
  const ids = [...(state.layout[key] || [])];
  ids.push(newId);
  state.layout[key] = ids;
  await persistLayout(key);
  page = 'custom';
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  await load();
  toast('已添加 ' + newId);
}
async function uploadZip(file) {
  const buf = await file.arrayBuffer();
  const xhr = new XMLHttpRequest();
  xhr.open('POST', api + '/add-zip');
  xhr.setRequestHeader('content-type', 'application/json');
  showProgress('正在上传 ' + file.name + '…', true);
  const r = await new Promise((resolve) => {
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => { hideProgress(); try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ ok: false, message: '响应格式错误' }); } };
    xhr.onerror = () => { hideProgress(); resolve({ ok: false, message: '上传失败' }); };
    xhr.send(JSON.stringify({ filename: file.name, data: Array.from(new Uint8Array(buf)) }));
  });
  if (!r.ok) { toast(r.message || '上传失败'); return; }
  const newId = r.data.folderName || r.data.entryId;
  const key = 'custom';
  const ids = [...(state.layout[key] || [])];
  ids.push(newId);
  state.layout[key] = ids;
  await persistLayout(key);
  page = 'custom';
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  await load();
  toast('已添加 ' + newId);
}
async function uninstall(id) {
  showProgress('正在卸载…');
  let r;
  try { r = await http('POST', '/remove', { entryId: id }); } finally { hideProgress(); }
  if (!r.ok) { toast(r.message || '卸载失败'); return; }
  const key = 'custom';
  state.layout[key] = (state.layout[key] || []).filter(x => x !== id);
  await persistLayout(key);
  await load();
  toast('已卸载');
}
function buildLegend() {
  const el = document.getElementById('legend');
  el.innerHTML = '';
  for (const [cat, label] of Object.entries(labels)) {
    const s = document.createElement('span');
    s.innerHTML = \`<span class="swatch" style="background:\${colors[cat]}"></span>\${label}\`;
    el.appendChild(s);
  }
}
async function load() {
  const r = await http('GET', '/list');
  if (!r.ok) { document.getElementById('status').textContent = '加载失败'; return; }
  state = r.data;
  if (Array.isArray(state.presets) === false) state.presets = [];
  const pr = await http('GET', '/preset-list');
  if (pr.ok) state.presets = pr.data;
  buildGrid();
  const items = page === 'preset' ? state.presets : (page === 'official' ? state.official : state.custom);
  const on = page === 'preset' ? items.length : items.filter(t => t.enabled).length;
  document.getElementById('status').textContent = page === 'preset'
    ? \`\${on} 个预设\`
    : \`\${on}/\${items.length} 插件\`;
}

// dialog
const dialog = document.getElementById('dialog');
const addKind = document.getElementById('add-kind');
const addValue = document.getElementById('add-value');
const addLabel = document.getElementById('add-label');
const zipDrop = document.getElementById('zip-drop');
function openAddDialog() {
  addValue.value = '';
  document.getElementById('add-label').textContent = addKind.value === 'gitUrl'
    ? '项目地址（https://github.com/user/repo）'
    : addKind.value === 'folderPath' ? '本地文件夹绝对路径' : '本地 ZIP 绝对路径';
  addValue.placeholder = addKind.value === 'gitUrl' ? 'https://github.com/user/repo' : '';
  zipDrop.style.display = addKind.value === 'zipPath' ? 'block' : 'none';
  dialog.classList.add('open');
  setTimeout(() => addValue.focus(), 50);
}
addKind.addEventListener('change', openAddDialog);
zipDrop.addEventListener('dragover', e => { e.preventDefault(); zipDrop.classList.add('over'); });
zipDrop.addEventListener('dragleave', () => zipDrop.classList.remove('over'));
zipDrop.addEventListener('drop', (e) => {
  e.preventDefault(); zipDrop.classList.remove('over');
  const file = [...e.dataTransfer.files].find(f => /\.zip$/i.test(f.name));
  if (!file) { toast('请拖入 .zip 安装包'); return; }
  uploadZip(file).then(() => dialog.classList.remove('open'));
});
document.getElementById('add-cancel').addEventListener('click', () => dialog.classList.remove('open'));
document.getElementById('add-ok').addEventListener('click', async () => {
  const val = addValue.value.trim();
  if (!val) { toast('请输入内容'); return; }
  const kind = addKind.value;
  const src = kind === 'gitUrl' ? { gitUrl: val } : kind === 'folderPath' ? { folderPath: val } : { zipPath: val };
  dialog.classList.remove('open');
  await add(src);
});

// preset dialog: scan a source, then install one candidate
const pDialog = document.getElementById('p-dialog');
const pKind = document.getElementById('p-kind');
const pValue = document.getElementById('p-value');
const pLabel = document.getElementById('p-label');
const pCands = document.getElementById('p-cands');
function openPresetDialog() {
  pValue.value = '';
  pCands.innerHTML = '';
  pLabel.textContent = pKind.value === 'gitUrl'
    ? '项目地址（https://github.com/user/repo）'
    : pKind.value === 'folderPath' ? '本地文件夹绝对路径' : '本地 ZIP 绝对路径';
  pDialog.classList.add('open');
  setTimeout(() => pValue.focus(), 50);
}
pKind.addEventListener('change', openPresetDialog);
document.getElementById('p-cancel').addEventListener('click', () => pDialog.classList.remove('open'));
document.getElementById('p-scan').addEventListener('click', async () => {
  const val = pValue.value.trim();
  if (!val) { toast('请输入内容'); return; }
  const kind = pKind.value;
  const src = kind === 'gitUrl' ? { gitUrl: val } : kind === 'folderPath' ? { folderPath: val } : { zipPath: val };
  showProgress('正在扫描…');
  let r;
  try { r = await http('POST', '/preset-scan', src); } finally { hideProgress(); }
  if (!r.ok || !r.data) { toast(r.message || '扫描失败'); return; }
  const cands = r.data.candidates || [];
  if (cands.length === 0) { toast('未找到预设'); return; }
  pCands.innerHTML = cands.map((c, i) => \`<div class="pcan"><input type="radio" name="pcan" id="pc-\${i}" value="\${escapeHtml(c.id)}"><label for="pc-\${i}"><span class="can-name">\${escapeHtml(c.name)}</span><span class="can-desc">\${escapeHtml(c.description || '')}</span></label></div>\`).join('')
    + '<div class="row"><button id="p-install-btn" class="primary">安装所选</button></div>';
  document.getElementById('p-install-btn').addEventListener('click', async () => {
    const sel = pCands.querySelector('input[name="pcan"]:checked');
    if (!sel) { toast('请先选择一个预设'); return; }
    pCands.innerHTML = '';
    showProgress('正在安装…');
    let resp;
    try { resp = await http('POST', '/preset-install', { id: sel.value }); } finally { hideProgress(); }
    if (!resp.ok) { toast(resp.message || '安装失败'); return; }
    pDialog.classList.remove('open');
    await load();
    toast('已安装 ' + (resp.data.folderName || resp.data.entryId));
  });
});
document.getElementById('preset-add-btn').addEventListener('click', openPresetDialog);

// trash
const trash = document.getElementById('trash');
trash.addEventListener('dragover', e => { e.preventDefault(); trash.classList.add('over'); });
trash.addEventListener('dragleave', () => trash.classList.remove('over'));
trash.addEventListener('drop', (e) => {
  e.preventDefault();
  trash.classList.remove('over');
  if (dragId) uninstall(dragId);
});

// grid drag-to-reorder: live-insert at the gap nearest the pointer.
// The dragged node itself is moved via insertBefore (it keeps its drag
// listeners); other tiles animate by FLIP.
let dragEl = null;
const gridEl = document.getElementById('grid');
gridEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!dragActive || !dragEl) return;
  const list = page === 'official' ? state.official : state.custom;
  const cols = list.length > 100 ? 12 : 10;
  const r = gridEl.getBoundingClientRect();
  const gap = 8;
  const cw = (r.width - gap * (cols - 1)) / cols;
  const col = Math.max(0, Math.min(cols - 1, Math.floor((e.clientX - r.left) / (cw + gap))));
  const row = Math.max(0, Math.floor((e.clientY - r.top) / (cw + gap)));
  const target = Math.min(row * cols + col, list.length);
  const cur = Array.from(gridEl.children).indexOf(dragEl);
  if (cur === target) return;
  const prev = new Map(Array.from(gridEl.children).filter(c => c.dataset.eid && c !== dragEl).map(c => [c.dataset.eid, c.getBoundingClientRect()]));
  const anchor = gridEl.children[target] || null;
  gridEl.insertBefore(dragEl, anchor);
  // FLIP the untouched tiles
  requestAnimationFrame(() => {
    for (const c of gridEl.children) {
      if (c === dragEl) continue;
      const p = c.dataset.eid && prev.get(c.dataset.eid);
      if (!p) continue;
      const n = c.getBoundingClientRect();
      const dx = p.left - n.left, dy = p.top - n.top;
      if (!dx && !dy) continue;
      c.style.transition = 'none';
      c.style.transform = \`translate(\${dx}px, \${dy}px)\`;
      c.getBoundingClientRect();
      c.style.transition = '';
      c.style.transform = '';
    }
  });
});
gridEl.addEventListener('drop', (e) => {
  e.preventDefault();
  if (dragEl) persistLayoutFromDom();
});
gridEl.addEventListener('dragend', () => {
  if (dragEl) persistLayoutFromDom();
  dragEl = null;
});
function persistLayoutFromDom() {
  const key = page === 'official' ? 'official' : 'custom';
  const ids = Array.from(gridEl.children).filter(c => c.dataset.eid).map(c => c.dataset.eid);
  state.layout[key] = ids;
  persistLayout(key);
}

// search
document.getElementById('search').addEventListener('input', buildGrid);

// sort toggles
document.querySelectorAll('#sort-btns button').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.sort;
  sortMode = sortMode === v ? null : v;
  document.querySelectorAll('#sort-btns button').forEach(x => x.classList.toggle('active', x.dataset.sort === sortMode));
  buildGrid();
}));

// category context menu
const catMenu = document.getElementById('cat-menu');
let catTarget = null;
function openCatMenu(e, t) {
  catTarget = t;
  const cur = t.category || 'untagged';
  catMenu.innerHTML = \`<div class="menu-title">\${escapeHtml(shortName(t))}</div>\`;
  for (const [cat, label] of Object.entries(labels)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.cat = cat;
    b.className = cat === cur ? 'active' : '';
    b.innerHTML = \`<span class="swatch" style="background:\${colors[cat]}"></span>\${label}\`;
    b.addEventListener('click', () => setCategory(t.entryId, cat));
    catMenu.appendChild(b);
  }
  const r = gridEl.getBoundingClientRect();
  const x = Math.min(e.clientX, r.right - catMenu.offsetWidth - 4);
  const y = Math.min(e.clientY, r.bottom - catMenu.offsetHeight - 4);
  catMenu.style.left = Math.max(4, x) + 'px';
  catMenu.style.top = Math.max(4, y) + 'px';
  catMenu.classList.add('open');
}
async function setCategory(entryId, cat) {
  catMenu.classList.remove('open');
  const r = await http('POST', '/set-category', { folderName: entryId, category: cat });
  if (!r.ok) { toast(r.message || '设置分类失败'); return; }
  await load();
}
document.addEventListener('click', (e) => {
  if (!catMenu.contains(e.target)) catMenu.classList.remove('open');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') catMenu.classList.remove('open'); });

// tabs
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  page = b.dataset.page;
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  load();
}));

buildLegend();
load();
// close button: inside the embedded modal, ask the shell to close; when the
// page is opened standalone, close the tab.
document.getElementById('close-btn').addEventListener('click', () => {
  parent.postMessage({ type: 'kmanager-close' }, '*');
  if (window.top === window.self) window.close();
});
</script>
</body>
</html>`

/**
 * Serve the tile-grid manager page.
 * @returns the exact route to register on the Host web server.
 */
export function createManagerPageRoute(): { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void } {
  return {
    kind: 'exact',
    path: KMGR_PAGE_PATH,
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE_HTML)
    },
  }
}
