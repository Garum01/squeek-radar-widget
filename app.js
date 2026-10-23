'use strict';

const $ = id => document.getElementById(id);
const viewParams = new URLSearchParams(location.search);
const selectedProject = viewParams.get('project');
const publicFeed = document.body.dataset.publicFeed;
const embedMode = Boolean(publicFeed) || location.pathname === '/embed' || viewParams.get('embed') === '1';
const refreshInterval = 60000;
const state = {projects: [], filter: 'all', query: '', category: 'all', updated: null, loadedAt: 0};
let refreshing = false;

const stageLabels = {
  unknown: 'Stage not confirmed',
  research: 'Early signal · under review',
  development: 'In development',
  testnet_announced: 'Testnet announced by the developer',
  launch_announced: 'Launch announced by the developer',
  live_confirmed: 'Live activity confirmed'
};
// Short stage names for the tag next to a project's name.
const stageTags = {
  unknown: 'Stage not confirmed',
  research: 'Early signal', development: 'In development', testnet_announced: 'Testnet announced',
  launch_announced: 'Launch announced', live_confirmed: 'Live'
};
const linkLabels = {
  x: ['𝕏', 'X'], announcement: ['𝕏', 'Announcement'], website: ['◎', 'Website'],
  telegram: ['➤', 'Telegram'], github: ['⌘', 'GitHub'], docs: ['▤', 'Docs'], explorer: ['⌕', 'Explorer']
};
const sourceLabels = {
  deployment: 'Official deployment record',
  x: 'Team posts, quotes & conversations', github: 'Public GitHub discovery', onchain: 'On-chain discovery',
  linkage: 'Website / contract linkage', agent: 'AI candidate review',
  websites: 'Project websites', maintenance: 'Data maintenance'
};

if (embedMode) {
  document.body.classList.add('embed');
  document.documentElement.classList.add('embed-document');
  const shell = document.querySelector('.page-shell');
  shell.tabIndex = 0;
  shell.setAttribute('role', 'region');
  shell.setAttribute('aria-label', 'Project directory');
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function date(value, long = false) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Not recorded';
  return d.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', ...(long ? {year: 'numeric'} : {})});
}

function safeURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') ? url.href : null;
  } catch {
    return null;
  }
}

function external(url, cls, label) {
  const href = safeURL(url);
  if (!href) return null;
  const a = el('a', cls, label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function normalizedLinks(project) {
  const links = {...project.links};
  const post = links.x && safeURL(links.x) ? new URL(links.x) : null;
  if (post && /^(www\.)?(x|twitter)\.com$/.test(post.hostname) && /^\/[^/]+\/status\/\d+\/?$/.test(post.pathname)) {
    links.announcement ||= links.x;
    delete links.x;
  }
  return links;
}

function teamEvidence(project) {
  return (project.evidence || []).some(e => e.kind === 'team_mention');
}

function chainEvidence(project) {
  return (project.evidence || []).some(e => e.kind.startsWith('onchain') || e.kind === 'contract_interaction');
}

function namedProject(project) {
  return ['development', 'testnet_announced', 'launch_announced', 'live_confirmed'].includes(project.stage) || Boolean(project.links?.website);
}

function evidenceLabel(project) {
  if (project.publication_origin === 'owner_approved') return 'Owner-reviewed listing · see sources';
  if (chainEvidence(project)) return 'On-chain evidence found';
  if (teamEvidence(project)) return 'Mentioned by the team · see source';
  return 'Public-source candidate · under review';
}

function paragraph(parent, label, value) {
  parent.append(el('p', 'details-label', label), el('p', 'details-value', value));
}

function projectLogo(project) {
  const logo = el('div', 'logo');
  const initial = (project.name || '?').charAt(0).toLowerCase();
  if (!/^\/?logos\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(project.logo || '')) {
    logo.textContent = initial;
    logo.setAttribute('aria-label', 'No confirmed project logo yet');
    return logo;
  }
  const img = el('img');
  img.src = project.logo;
  img.alt = project.name + ' logo';
  img.loading = 'lazy';
  img.addEventListener('error', () => {img.remove(); logo.textContent = initial;});
  logo.append(img);
  return logo;
}

function projectLinks(project) {
  const container = el('div', 'links');
  container.setAttribute('aria-label', 'Project links');
  const links = normalizedLinks(project);
  // X links (profile or announcement post) come first and show only the X mark.
  for (const kind of ['x', 'announcement', 'website', 'telegram', 'github', 'docs', 'explorer']) {
    const [icon, label] = linkLabels[kind];
    const a = external(links[kind], 'project-link');
    if (!a) continue;
    a.append(el('span', 'link-icon', icon));
    if (kind !== 'x' && kind !== 'announcement') a.append(el('span', '', label));
    a.append(el('span', 'arrow', '↗'));
    a.setAttribute('aria-label', label + ' for ' + project.name + ' (opens in a new tab)');
    a.title = kind === 'announcement' ? 'Announcement on X' : label;
    container.append(a);
  }
  return container;
}

function projectFacts(project) {
  const facts = el('div');
  paragraph(facts, 'Project stage', stageLabels[project.stage] || 'Stage not confirmed');
  if (project.builder) {
    paragraph(facts, 'Announcement author / builder', '@' + project.builder + ' · personal account, not necessarily a project account');
  }
  paragraph(facts, 'First observed', date(project.first_seen, true));
  // Public artifacts omit operational timestamps; do not present that as a failed check.
  if (!embedMode) paragraph(facts, 'Last website check', project.last_checked ? date(project.last_checked, true) : 'Not yet confirmed');
  const contracts = (project.contracts || []).map(c => c.address + ' · chain ' + c.chain_id).join('\n');
  paragraph(facts, 'Contracts', contracts || 'No project contract independently confirmed.');
  if (project.review_required) paragraph(facts, 'Identity review', 'Some identifiers conflict. This project needs a closer look.');
  return facts;
}

function projectEvidence(project) {
  const evidence = el('div');
  evidence.append(el('p', 'details-label', 'Why it is here'));
  const list = el('ul', 'evidence-list');
  for (const source of project.evidence || []) {
    const label = source.kind === 'team_mention' ? 'Team post / quoted announcement ↗' : source.kind === 'github' ? 'Repository evidence ↗' : 'View source ↗';
    const li = el('li');
    const a = external(source.url, '', label);
    if (a) li.append(a);
    li.append(el('p', 'evidence-note', source.note || 'Public-source observation.'));
    list.append(li);
  }
  evidence.append(list, el('p', 'evidence-note', 'A mention is not an endorsement. Source evidence does not establish that a project is safe.'));
  return evidence;
}

function projectDetails(project) {
  const details = el('details');
  details.append(el('summary', '', 'Details & sources'));
  const body = el('div', 'details-body');
  const grid = el('div', 'details-grid');
  grid.append(projectFacts(project), projectEvidence(project));
  body.append(grid);
  details.append(body);
  return details;
}

function card(project) {
  const article = el('article', 'project');
  article.id = 'project-' + project.id;
  const top = el('div', 'project-top');
  const info = el('div', 'project-info');
  const nameRow = el('div', 'name-row');
  nameRow.append(el('h2', '', project.name), el('span', 'category', (project.category || 'other').replaceAll('_', ' ')));
  if (stageTags[project.stage]) nameRow.append(el('span', 'category stage', stageTags[project.stage]));
  info.append(nameRow, projectLinks(project));
  top.append(projectLogo(project), info);
  const description = project.description_en || 'A new ecosystem signal. More information is being gathered.';
  article.append(top, el('p', 'description', description));
  if (project.description_origin === 'ai') article.append(el('p', 'evidence-note', 'AI-generated summary · verify with the linked sources.'));
  if (project.description_origin === 'x_profile') article.append(el('p', 'evidence-note', 'From the project\'s own X profile · not independently verified.'));
  const meta = el('div', 'card-meta');
  meta.append(el('span', 'evidence-tag', evidenceLabel(project)), el('span', 'first-seen', 'FOUND ' + date(project.first_seen).toUpperCase()));
  article.append(meta, projectDetails(project));
  return article;
}

function matchesFilter(project) {
  if (selectedProject) return project.id === selectedProject;
  if (embedMode) return true; // The server/export applies the publication policy.
  if (state.filter === 'all') return namedProject(project);
  if (state.filter === 'early') return !namedProject(project);
  if (state.filter === 'team') return teamEvidence(project);
  if (state.filter === 'chain') return chainEvidence(project);
  return false;
}

function visibleProjects() {
  const query = state.query.toLowerCase();
  return state.projects.filter(project => {
    const category = state.category === 'all' || project.category === state.category;
    const text = [project.name, project.description_en, project.builder, project.category].filter(Boolean).join(' ').toLowerCase();
    return matchesFilter(project) && category && (!query || text.includes(query));
  }).sort((a, b) => Number(teamEvidence(b)) - Number(teamEvidence(a)) ||
    Number(Boolean(b.links?.website)) - Number(Boolean(a.links?.website)) ||
    String(b.first_seen).localeCompare(String(a.first_seen)));
}

function render() {
  const projects = visibleProjects();
  const list = $('projects');
  const open = new Set([...list.querySelectorAll('article')].filter(a => a.querySelector('details[open]')).map(a => a.id));
  list.replaceChildren(...projects.map(card));
  for (const article of list.querySelectorAll('article')) {
    if (open.has(article.id)) article.querySelector('details').open = true;
  }
  $('project-count').textContent = String(state.projects.filter(namedProject).length);
  // Describes how often the list is republished, not how fast a project is found.
  const shown = projects.length;
  $('embed-count').textContent = 'Squeek Radar · ' + shown + (shown === 1 ? ' project' : ' projects') + ' · list republished every hour';
  $('message').hidden = projects.length > 0;
  if (projects.length) return;
  $('message').textContent = embedMode ? 'New ecosystem projects will appear here as they are identified.' :
    state.projects.length ? 'No projects match these filters. Try another filter or look under Early signals.' :
    'No projects have been confirmed for the directory yet. New observations will appear here.';
}

function renderSources(sources) {
  const container = $('sources');
  container.replaceChildren();
  for (const source of sources.filter(s => s.name !== 'maintenance')) {
    const row = el('div', 'source-row');
    const label = source.status === 'ok' ? 'Checked' : source.status === 'pending' ? 'Awaiting setup' : 'Temporarily unavailable';
    row.append(el('span', '', sourceLabels[source.name] || source.name),
      el('span', 'source-state', label + (source.last_success ? ' · ' + date(source.last_success) : '')));
    container.append(row);
  }
}

function renderCoverage(data) {
  renderSources(data.sources);
  const relevant = data.sources.filter(s => !['maintenance', 'websites'].includes(s.name));
  const limited = !relevant.length || relevant.some(s => s.status !== 'ok' ||
    (s.name === 'x' && /recent_window_only|pending|bounded_history|cursor_stalled|unavailable/.test(s.detail || '')));
  $('coverage-label').textContent = limited ? 'Limited source coverage' : 'Sources checked';
  $('coverage-dot').classList.toggle('good', !limited);
  $('last-scan').textContent = data.last_scan ? 'Last cycle ' + new Date(data.last_scan).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'}) + ' · your local time' : 'First scan in progress';
}

function feedURL() {
  const url = new URL(publicFeed || (embedMode ? '/api/public-projects' : '/api/projects'), location.href);
  if (publicFeed) url.searchParams.set('v', String(Math.floor(Date.now() / refreshInterval)));
  return url;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch(feedURL(), {cache: 'no-store'});
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (!Array.isArray(data.projects) || (!data.public && !Array.isArray(data.sources))) throw new Error('invalid');
    state.projects = data.projects;
    render();
    if (!data.public) renderCoverage(data);
    state.updated = data.generated_at || new Date().toISOString();
    state.loadedAt = Date.now();
  } catch {
    $('coverage-label').textContent = 'Update unavailable';
    $('coverage-dot').classList.remove('good');
    $('last-scan').textContent = state.updated ? 'Showing the last loaded observations' : 'Please try again shortly';
    if (!state.projects.length) {
      $('message').hidden = false;
      $('message').textContent = 'The directory is temporarily unavailable. Please try again shortly.';
    }
  } finally {
    refreshing = false;
  }
}

function bindControls() {
  $('search').addEventListener('input', event => {state.query = event.target.value; render();});
  $('category').addEventListener('change', event => {state.category = event.target.value; render();});
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(tab => {
      tab.classList.toggle('selected', tab === button);
      tab.setAttribute('aria-pressed', String(tab === button));
    });
    render();
  }));
  $('source-toggle').addEventListener('click', () => {
    const open = $('sources').hidden;
    $('sources').hidden = !open;
    $('source-toggle').setAttribute('aria-expanded', String(open));
  });
  // The Moni widget is always light; the catalog's saved theme must not leak into it.
  if (!embedMode) {
    try {document.body.classList.toggle('dark', localStorage.getItem('radar-theme') === 'dark');} catch {}
  }
  $('theme').addEventListener('click', () => {
    const dark = document.body.classList.toggle('dark');
    try {localStorage.setItem('radar-theme', dark ? 'dark' : 'light');} catch {}
  });
}

function bindMoniResize() {
  if (!embedMode || window.parent === window) return;
  const root = document.querySelector('.page-shell');
  const content = root.querySelector('main');
  let previous = 0;
  const report = (force = false) => {
    // Measure natural content, not the viewport-sized scrolling shell. This avoids
    // resize feedback and still allows shrinking if the host enables our origin.
    const style = getComputedStyle(root);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const height = Math.max(1, Math.ceil(content.getBoundingClientRect().height + padding));
    if (!force && height === previous) return;
    previous = height;
    window.parent.postMessage({type: 'moni-widget:resize', height}, 'https://research.moni.ai');
  };
  new ResizeObserver(() => report()).observe(content);
  window.addEventListener('load', () => report(true), {once: true});
  window.addEventListener('message', event => {
    if (event.source === window.parent && event.origin === 'https://research.moni.ai' && event.data?.type === 'moni-widget:request-resize') report(true);
  });
}

bindControls();
bindMoniResize();
refresh();
setInterval(() => {if (!document.hidden) refresh();}, refreshInterval);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - state.loadedAt >= refreshInterval) refresh();
});
