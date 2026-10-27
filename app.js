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
  announced: 'Project announced; release not independently confirmed',
  unknown: 'Stage not confirmed',
  research: 'Early signal · under review',
  development: 'In development',
  testnet_announced: 'Testnet announced by the developer',
  launch_announced: 'Launch announced by the developer',
  live_confirmed: 'Live activity confirmed'
};
// Short stage names for the tag next to a project's name.
const stageTags = {
  announced: 'Announced',
  unknown: 'Stage not confirmed',
  research: 'Early signal', development: 'In development', testnet_announced: 'Testnet announced',
  launch_announced: 'Launch announced', live_confirmed: 'Live'
};
const linkLabels = {
  x: ['𝕏', 'X'], announcement: ['𝕏', 'Announcement'], website: ['◎', 'Website'],
  telegram: ['➤', 'Telegram'], github: ['⌘', 'Code'], docs: ['▤', 'Docs'], explorer: ['⌕', 'Explorer']
};
const categoryLabels = {defi: 'DeFi', dex: 'DEXs', game: 'Games', launchpad: 'Launchpads', nft: 'NFT', memecoin: 'Memecoins', tools: 'Tools', infrastructure: 'Infrastructure', token: 'Tokens', other: 'Other'};
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
  return (project.evidence || []).some(e => String(e.kind || '').startsWith('onchain') || e.kind === 'contract_interaction');
}

function namedProject(project) {
  return ['announced', 'development', 'testnet_announced', 'launch_announced', 'live_confirmed'].includes(project.stage) || Boolean(project.links?.website);
}

function evidenceLabel(project) {
  if (project.publication_origin === 'owner_approved') return 'Owner-reviewed listing · see sources';
  if (chainEvidence(project)) return 'On-chain evidence found';
  if (teamEvidence(project)) return 'Mentioned by the team · see source';
  return 'Public-source candidate · under review';
}

function projectLogo(project) {
  const logo = el('div', 'logo');
  if (project.publication_origin === 'owner_curated') logo.classList.add('curated');
  const initial = (project.name || '?').charAt(0).toLowerCase();
  if (!/^\/?logos\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(project.logo || '')) {
    logo.textContent = initial;
    logo.setAttribute('aria-label', 'No confirmed project logo yet');
    return logo;
  }
  const img = el('img');
  img.src = project.logo;
  img.alt = project.name + (project.publication_origin === 'owner_curated' ? ' announcement artwork' : ' logo');
  img.loading = 'lazy';
  img.addEventListener('error', () => {img.remove(); logo.textContent = initial;});
  logo.append(img);
  return logo;
}

function projectLinks(project) {
  const container = el('div', 'links');
  container.setAttribute('aria-label', 'Project links');
  const links = normalizedLinks(project);
  for (const kind of ['website', 'x', 'announcement', 'github', 'docs', 'telegram', 'explorer']) {
    const [, label] = linkLabels[kind];
    const a = external(links[kind], 'project-link');
    if (!a) continue;
    a.append(el('span', '', label));
    a.append(el('span', 'arrow', '↗'));
    a.setAttribute('aria-label', label + ' for ' + project.name + ' (opens in a new tab)');
    a.title = kind === 'announcement' ? 'Announcement on X' : label;
    container.append(a);
  }
  return container;
}

// The optional AI guide contains text and references to this record's own sources.
function aiReadingGuide(project) {
  const curated = project.publication_origin === 'owner_curated' && project.curated_text;
  const story = curated || project.checked_text;
  if (story?.version !== 1 || !Array.isArray(story.paragraphs) || !story.paragraphs.length || story.paragraphs.length > 2) return null;
  const allowed = new Set([...Object.values(normalizedLinks(project)), ...(project.evidence || []).map(e => e.url)].map(safeURL).filter(Boolean));
  const copy = el('div', 'verification-copy');
  let length = 0, citations = 0;
  for (const pieces of story.paragraphs) {
    if (!Array.isArray(pieces) || !pieces.length || pieces.length > 20) return null;
    const p = el('p');
    for (const piece of pieces) {
      if (!piece || typeof piece.text !== 'string') return null;
      length += piece.text.length;
      if (length > 950) return null;
      if (piece.url !== undefined) {
        const url = safeURL(piece.url);
        if (!url || !allowed.has(url)) return null;
        p.append(external(url, '', piece.text));
        citations++;
      } else p.append(document.createTextNode(piece.text));
    }
    copy.append(p);
  }
  if (!citations) return null;
  copy.dataset.origin = curated ? 'curated' : 'ai';
  return copy;
}

// Explain only the public record. Linked observations are not safety or usage proofs.
function projectDetails(project) {
  const details = el('details');
  details.append(el('summary', '', 'What we checked'));
  const body = el('div', 'details-body');
  const generated = aiReadingGuide(project);
  const copy = generated || el('div', 'verification-copy');
  const links = normalizedLinks(project);
  const sources = el('p');
  sources.append('Here’s the trail so far: ');
  const seen = new Set();
  const references = [];
  const labels = {team_mention: 'a public team post', github: 'a public repository reference',
    x_profile: 'the project’s public profile', onchain: 'an on-chain reference',
    contract_interaction: 'a contract interaction reference', website: 'a website reference'};
  for (const source of project.evidence || []) {
    const url = safeURL(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    references.push(external(url, '', labels[source.kind] || 'a linked public observation'));
  }
  for (const [kind, label] of [['website', 'the linked website'], ['github', 'the linked code repository'],
    ['announcement', 'the linked announcement'], ['x', 'the linked X profile'], ['docs', 'the linked documentation'], ['explorer', 'the linked explorer record']]) {
    const url = safeURL(links[kind]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    references.push(external(url, '', label));
  }
  if (references.length) {
    references.forEach((reference, index) => {
      if (index) sources.append(index === references.length - 1 ? ' and ' : ', ');
      sources.append(reference);
    });
    sources.append('. They give us a starting point, but don’t show the whole picture.');
  } else {
    sources.replaceChildren('We don’t have an independent public source to point to yet.');
  }
  if (!generated) copy.append(sources);
  if (!generated || generated.dataset.origin !== 'curated') {
  const identity = {resolved: 'The identifiers line up in the sources we have.',
    conflict: 'Some identifiers don’t line up yet, so this one needs another look.'};
  const connection = {confirmed: 'There’s evidence of a Squeekchain connection in the links above.',
    claimed: 'The project says it connects to Squeekchain; we still have limited independent evidence for that.'};
  copy.append(el('p', '', (identity[project.identity_status] || 'We haven’t pinned down the project’s identity from this record alone.') + ' ' +
    (connection[project.ecosystem_status] || 'These sources don’t yet establish a Squeekchain integration.')));
  const stage = stageLabels[project.lifecycle_stage || project.stage] || 'Stage not confirmed';
  let context = 'Where things stand: ' + stage.charAt(0).toLowerCase() + stage.slice(1) + '. ';
  if (project.builder) context += 'The announcement comes from @' + project.builder + ', which may be a builder’s personal account. ';
  if (project.first_seen) context += 'We first picked it up on ' + date(project.first_seen, true) + '. ';
  const contracts = project.contracts || [];
  context += contracts.length ? 'There’s a contract reference here: ' + contracts.map(c => c.address + ' (chain ' + c.chain_id + ')').join('; ') + '. That alone doesn’t tell us whether it’s deployed, active or safe.' :
    'We haven’t independently confirmed a project contract from this record.';
  copy.append(el('p', '', context));
  if (project.review_required) copy.append(el('p', '', 'The record is flagged for an additional identity review.'));
  }
  body.append(copy);
  if (generated && generated.dataset.origin === 'curated') body.append(el('p', 'evidence-note', 'Manually added from the linked public announcement.'));
  if (generated && generated.dataset.origin === 'ai') body.append(el('p', 'evidence-note', 'AI-written from the linked public record · not a new verification.'));
  body.append(el('p', 'evidence-note', 'A mention is not an endorsement. Source evidence does not establish that a project is safe.'));
  details.append(body);
  return details;
}

function card(project) {
  const article = el('article', 'project');
  article.id = 'project-' + project.id;
  const top = el('div', 'project-top');
  const info = el('div', 'project-info');
  const nameRow = el('div', 'name-row');
  nameRow.append(el('h2', '', project.name || 'Unnamed candidate'));
  const stage = el('span', 'stage-tag', stageTags[project.stage] || 'Stage not confirmed');
  stage.classList.toggle('confirmed', project.stage === 'live_confirmed');
  nameRow.append(stage);
  const description = project.description_en || 'A new ecosystem signal. More information is being gathered.';
  info.append(nameRow, el('p', 'description', description), projectLinks(project));
  top.append(projectLogo(project), info);
  article.append(top);
  if (project.description_origin === 'ai') article.append(el('p', 'evidence-note', 'AI-generated summary · verify with the linked sources.'));
  if (project.description_origin === 'x_profile') article.append(el('p', 'evidence-note', 'From the project\'s own X profile · not independently verified.'));
  article.append(projectDetails(project));
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
    const category = state.category === 'all' || (project.category || 'other') === state.category;
    const text = [project.name, project.description_en, project.builder, project.category].filter(Boolean).join(' ').toLowerCase();
    return matchesFilter(project) && category && (!query || text.includes(query));
  }).sort((a, b) => (Date.parse(b.first_seen) || 0) - (Date.parse(a.first_seen) || 0) || String(a.id).localeCompare(String(b.id)));
}

function renderCategoryChips() {
  const container = $('category-chips');
  const focused = document.activeElement?.closest('#category-chips button')?.dataset.category;
  const base = state.projects.filter(matchesFilter);
  const counts = new Map();
  for (const project of base) {
    const key = String(project.category || 'other');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (state.category !== 'all' && !counts.has(state.category)) state.category = 'all';
  const order = Object.keys(categoryLabels);
  const categories = [...counts.keys()].sort((a, b) => {
    const left = order.indexOf(a), right = order.indexOf(b);
    return (left < 0 ? order.length : left) - (right < 0 ? order.length : right) || a.localeCompare(b);
  });
  const buttons = [['all', 'ALL', base.length], ...categories.map(key => [key, categoryLabels[key] || key.replaceAll('_', ' '), counts.get(key)])]
    .map(([key, label, count]) => {
      const button = el('button', 'category-chip');
      button.type = 'button';
      button.dataset.category = key;
      button.classList.toggle('selected', state.category === key);
      button.setAttribute('aria-pressed', String(state.category === key));
      button.append(el('span', '', label), el('span', 'chip-count', String(count)));
      button.addEventListener('click', () => {state.category = key; $('category').value = key; render();});
      return button;
    });
  container.replaceChildren(...buttons);
  if (focused !== undefined) buttons.find(button => button.dataset.category === focused)?.focus();
}

function render() {
  renderCategoryChips();
  const projects = visibleProjects();
  const list = $('projects');
  const open = new Set([...list.querySelectorAll('article')].filter(a => a.querySelector('details[open]')).map(a => a.id));
  list.replaceChildren(...projects.map(card));
  for (const article of list.querySelectorAll('article')) {
    if (open.has(article.id)) article.querySelector('details').open = true;
  }
  $('project-count').textContent = String(state.projects.filter(namedProject).length);
  const shown = projects.length;
  $('embed-count').textContent = shown + (shown === 1 ? ' project' : ' projects');
  const timestamp = typeof state.updated === 'string' && !Number.isNaN(new Date(state.updated).getTime());
  $('published-at').textContent = timestamp ? 'FEED UPDATED ' + date(state.updated, true).toUpperCase() : 'AUTO-UPDATING DIRECTORY';
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
    // Public exports deliberately omit operational timestamps; do not invent a checked date.
    state.updated = data.generated_at || null;
    render();
    if (!data.public) renderCoverage(data);
    state.loadedAt = Date.now();
  } catch {
    $('coverage-label').textContent = 'Update unavailable';
    $('coverage-dot').classList.remove('good');
    $('last-scan').textContent = state.projects.length ? 'Showing the last loaded observations' : 'Please try again shortly';
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
  const themeLabel = () => {
    const dark = document.body.classList.contains('dark');
    $('theme').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    $('theme').setAttribute('aria-pressed', String(dark));
  };
  themeLabel();
  $('theme').addEventListener('click', () => {
    const dark = document.body.classList.toggle('dark');
    try {localStorage.setItem('radar-theme', dark ? 'dark' : 'light');} catch {}
    themeLabel();
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
