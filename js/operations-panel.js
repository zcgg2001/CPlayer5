import { t, initI18n, formatNumber, formatTime } from './i18n.js';
initI18n();
const $ = id => document.getElementById(id), el = (tag, text, className) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (className) n.className = className; return n; };
let snapshot, draft, busy = false, dirty = false;
async function api(path, options) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(t(({ login_required: 'loginRequired', admin_required: 'adminRequired', config_conflict: 'conflict', password_change_required: 'passwordRequired', wrong_password: 'passwordWrong', invalid_password: 'passwordInvalid', fresh_login_required: 'passwordFresh' })[data.error?.code] || 'unavailable')), { status: response.status, code: data.error?.code });
  return data;
}
const percent = value => value == null ? '—' : formatNumber(value, { style: 'percent', maximumFractionDigits: 1 });
function setStatus(text, error = false, target = 'opsStatus') { $(target).textContent = text; $(target).classList.toggle('is-error', error); }
function changed() { dirty = true; setStatus(t('dirty'), false, 'saveStatus'); }
function renderMetrics() {
  const { settings, metrics, states, events } = snapshot;
  const count = metrics.reduce((n, row) => n + row.requests, 0), failures = metrics.reduce((n, row) => n + row.failures, 0);
  $('metrics').replaceChildren(...[[t('enabledSources'), Object.values(settings.sources).filter(s => s.enabled).length], [t('requests'), formatNumber(count)], [t('availability'), percent(count ? (count - failures) / count : null)], [t('coolingSources'), states.filter(s => s.openUntil).length]].map(([label, value]) => { const card = el('div', null, 'metric'); card.append(el('span', label), el('strong', value)); return card; }));
  const rows = [];
  for (const [id, source] of Object.entries(settings.sources)) for (const operation of [$('healthOperation').value]) {
    const metric = metrics.find(row => row.source === id && row.operation === operation), state = states.find(row => row.source === id && row.operation === operation);
    const status = !source.enabled ? 'disabled' : state?.openUntil > snapshot.at ? 'cooling' : state?.openUntil ? 'probing' : metric ? 'healthy' : 'unknown';
    const row = el('tr'), cell = el('td'); cell.append(el('span', t(status), `pill ${status === 'healthy' ? 'ok' : ['cooling', 'probing'].includes(status) ? 'warn' : ''}`));
    row.append(el('td', `${id} / ${t(operation)}`), cell, el('td', metric ? formatNumber(metric.requests) : '—'), el('td', percent(metric?.availability)), el('td', percent(metric?.failureRate)), el('td', metric ? `${formatNumber(metric.avgLatency)} ms` : '—')); rows.push(row);
  }
  $('healthRows').replaceChildren(...rows);
  $('alertStatus').textContent = t(snapshot.alertConfigured ? 'alertOn' : 'alertOff');
  $('events').replaceChildren(...(events.length ? events.slice(0, 30).map(item => { const row = el('li'); row.append(el('span', `${item.source} · ${item.code} × ${item.count}`), el('time', formatTime(item.createdAt))); return row; }) : [el('li', t('emptyEvents'))]));
  $('audit').replaceChildren(...snapshot.audit.map(item => { const row = el('li'); row.append(el('span', `v${item.revision}`), el('time', formatTime(item.createdAt))); return row; }));
  $('revision').textContent = `v${settings.revision}`;
}
function renderForm() {
  $('sourceSettings').replaceChildren(...Object.entries(draft.sources).map(([id, item]) => {
    const row = el('div', null, 'source-setting'), label = el('label'), check = el('input'); check.type = 'checkbox'; check.checked = item.enabled; check.addEventListener('change', () => { item.enabled = check.checked; changed(); }); label.append(check, el('span', id));
    const priority = el('input'); priority.type = 'number'; priority.min = 0; priority.max = 100; priority.value = item.priority; priority.setAttribute('aria-label', `${id} ${t('sourceConfig')}`); priority.addEventListener('input', () => { item.priority = Number(priority.value); changed(); }); row.append(label, priority); return row;
  }));
  renderModules(); renderPages(); $('charts').value = draft.charts.join(','); $('words').value = draft.sensitiveWords.join('\n');
}
function button(text, action) { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action); return b; }
function renderModules() {
  const all = [...draft.modules, ...['daily', 'radio', 'history', 'recommendations', 'news', 'scenes'].filter(id => !draft.modules.includes(id))];
  $('moduleSettings').replaceChildren(...all.map(id => {
    const row = el('div', null, 'module-row'), label = el('label'), check = el('input'); check.type = 'checkbox'; check.checked = draft.modules.includes(id);
    check.addEventListener('change', () => { draft.modules = check.checked ? [...draft.modules, id] : draft.modules.filter(value => value !== id); changed(); renderModules(); }); label.append(check, document.createTextNode(` ${t(id)}`)); row.append(label);
    for (const direction of [-1, 1]) { const b = button(direction === -1 ? '↑' : '↓', () => { const index = draft.modules.indexOf(id), next = index + direction; [draft.modules[index], draft.modules[next]] = [draft.modules[next], draft.modules[index]]; changed(); renderModules(); }); b.setAttribute('aria-label', `${t(id)} ${t(direction === -1 ? 'movedUp' : 'movedDown')}`); b.disabled = !check.checked || draft.modules.indexOf(id) + direction < 0 || draft.modules.indexOf(id) + direction >= draft.modules.length; row.append(b); }
    return row;
  }));
}
function renderPages() {
  $('pageSettings').replaceChildren(...draft.pages.map(page => {
    const row = el('div', null, 'page-row'), link = el(page.status === 'published' ? 'a' : 'span', `${t(page.type)} · ${page.id}`);
    if (page.status === 'published') { link.href = `/${page.type}/${page.id}`; link.target = '_blank'; link.rel = 'noopener'; }
    const select = el('select'); select.setAttribute('aria-label', `${page.id} ${t('status')}`); ['draft', 'published', 'rejected'].forEach(status => { const option = el('option', t(status)); option.value = status; select.append(option); }); select.value = page.status; select.addEventListener('change', () => { page.status = select.value; changed(); renderPages(); });
    row.append(link, select, button(t('remove'), () => { draft.pages = draft.pages.filter(p => p !== page); changed(); renderPages(); })); return row;
  }));
}
async function refresh(reset = false) {
  if (busy) return; busy = true; $('refresh').disabled = true;
  try { snapshot = await api('/api/admin/dashboard'); $('opsContent').hidden = false; $('adminAccess').hidden = $('adminPasswordSetup').hidden = true; renderMetrics(); if (!draft || reset) { draft = structuredClone(snapshot.settings); dirty = false; renderForm(); } setStatus(t('updated', { time: formatTime(snapshot.at) })); }
  catch (error) { setStatus(error.message, true); if ([401,403].includes(error.status)) { $('opsContent').hidden = true; snapshot = draft = null; dirty = false; $('adminPasswordSetup').hidden = error.code !== 'password_change_required'; $('adminAccess').hidden = error.code === 'password_change_required'; } }
  finally { busy = false; $('refresh').disabled = false; }
}
$('healthOperation').addEventListener('change', () => { if (snapshot) renderMetrics(); });
$('discardConfig').addEventListener('click', () => refresh(true));
$('refresh').addEventListener('click', () => refresh(!dirty));
$('charts').addEventListener('input', () => { draft.charts = $('charts').value.split(/[,，\s]+/).filter(Boolean); changed(); });
$('words').addEventListener('input', () => { draft.sensitiveWords = $('words').value.split('\n').map(s => s.trim()).filter(Boolean); changed(); });
$('addPage').addEventListener('click', () => { const id = $('pageId').value.trim(), type = $('pageType').value; if (!/^\d{1,20}$/.test(id) || draft.pages.some(p => p.id === id && p.type === type)) return setStatus(t('badPage'), true, 'saveStatus'); draft.pages.push({ type, id, status: 'draft' }); $('pageId').value = ''; changed(); renderPages(); });
$('configForm').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; $('saveConfig').disabled = true; setStatus(t('saving'), false, 'saveStatus');
  try { const result = await api('/api/admin/config', { method: 'PUT', body: JSON.stringify(draft) }); draft.revision = result.revision; dirty = false; setStatus(t('saved'), false, 'saveStatus'); }
  catch (error) { setStatus(error.message, true, 'saveStatus'); }
  finally { busy = false; $('saveConfig').disabled = false; if (!dirty) void refresh(true); }
});
window.addEventListener('cplayer:locale', () => { if (snapshot) renderMetrics(); if (draft) renderForm(); });
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
setInterval(() => { if (!document.hidden && $('autoRefresh').checked) void refresh(); }, 30000);
void refresh();

$('adminLoginForm').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; $('adminLoginSubmit').disabled = true; setStatus(t('signingIn'));
  try {
    const response = await fetch('/api/auth/sign-in/username', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: $('adminUsername').value.trim().toLowerCase(), password: $('adminPassword').value }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(response.status === 429 ? t('clientRate') : t('passwordWrong'));
    await response.body?.cancel(); busy = false; await refresh(true);
  } catch (error) { setStatus(error.message, true); }
  finally { busy = false; $('adminLoginSubmit').disabled = false; $('adminPassword').value = ''; }
});
$('adminPasswordForm').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; $('adminPasswordSubmit').disabled = true;
  try {
    await api('/api/admin/password', { method: 'POST', body: JSON.stringify({ currentPassword: $('adminCurrentPassword').value, newPassword: $('adminNewPassword').value, confirmPassword: $('adminConfirmPassword').value }) });
    $('adminPasswordSetup').hidden = true; $('adminAccess').hidden = false; setStatus(t('passwordChanged'));
  } catch (error) { setStatus(error.message, true); }
  finally { busy = false; $('adminPasswordSubmit').disabled = false; $('adminPasswordForm').reset(); }
});
