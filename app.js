'use strict';

const $ = id => document.getElementById(id);
const viewParams = new URLSearchParams(location.search);
const selectedProject = viewParams.get('project');
const publicFeed = document.body.dataset.publicFeed;
const embedMode = Boolean(publicFeed) || location.pathname === '/embed' || viewParams.get('embed') === '1';
const refreshInterval = 60000;
const state = {projects: [], filter: 'all', query: '', category: 'all', sort: 'newest', updated: null, loadedAt: 0};
let refreshing = false;

const stageLabels = {
  announced: 'Project announced; release not independently confirmed',
  unknown: 'Squeekchain testnet; this project’s deployment has not been independently confirmed',
  research: 'Early signal · under review',
  development: 'In development',
  testnet_announced: 'Testnet announced by the developer',
  launch_announced: 'Launch announced by the developer',
  testnet: 'Contract on the Sepolia testnet, linked to the project',
  mainnet: 'Contract on Ethereum mainnet, linked to the project',
  live_confirmed: 'Live activity confirmed'
};
// Short stage names for the tag next to a project's name.
const stageTags = {
  announced: 'Announced',
  unknown: 'Testnet',
  research: 'Early signal', development: 'In development', testnet_announced: 'Testnet announced',
  launch_announced: 'Launch announced', testnet: 'Testnet contract', mainnet: 'Mainnet contract', live_confirmed: 'Live'
};
const linkLabels = {
  x: ['𝕏', 'X'], announcement: ['𝕏', 'Announcement'], website: ['◎', 'Website'],
  telegram: ['➤', 'Telegram'], github: ['⌘', 'Code'], docs: ['▤', 'Docs'], explorer: ['⌕', 'Explorer']
};
// Singular category names for the badge on a project's card.
const categoryTags = {defi: 'DeFi', dex: 'DEX', game: 'Game', prediction: 'Prediction market', analytics: 'Dashboard', streaming: 'Stream overlay', art: 'Art & music', launchpad: 'Launchpad', nft: 'NFT', memecoin: 'Memecoin', tools: 'Tools', infrastructure: 'Infrastructure', other: 'Other'};
const categoryLabels = {defi: 'DeFi', dex: 'DEXs', game: 'Games', prediction: 'Prediction markets', analytics: 'Dashboards & analytics', streaming: 'Stream overlays', art: 'Art & music', launchpad: 'Launchpads', nft: 'NFT', memecoin: 'Memecoins', tools: 'Tools', infrastructure: 'Infrastructure', other: 'Other'};
const sourceLabels = {
  deployment: 'Official deployment record',
  x: 'Team posts, quotes & conversations', github: 'Public GitHub discovery', onchain: 'On-chain discovery',
  linkage: 'Website / contract linkage', agent: 'AI candidate review',
  websites: 'Project websites', showcase: 'Squeekchain Genesis board', maintenance: 'Data maintenance'
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
  if (!/^\/?logos\/[a-f0-9]{64}\.(png|jpg|webp|svg)$/.test(project.logo || '')) {
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

function isNetworkDocumentation(value) {
  const url = safeURL(value);
  if (!url) return false;
  const parsed = new URL(url), host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  return host === 'docs.squeekchain.com' || host.endsWith('.docs.squeekchain.com') ||
    (['squeekchain.com', 'www.squeekchain.com'].includes(host) && /^\/(docs|documentation|developers)(\/|$)/.test(parsed.pathname));
}

function projectDocsURL(project) {
  const docs = safeURL(project.links?.docs);
  if (!docs) return null;
  const host = new URL(docs).hostname.toLowerCase();
  // Network reference material is not the individual project's documentation.
  if (host === 'squeekchain.com' || host.endsWith('.squeekchain.com')) return null;
  const site = safeURL(project.links?.website);
  if (site) {
    const own = new URL(site).hostname.toLowerCase().replace(/^www\./, '');
    if (host === own || host.endsWith('.' + own)) return docs;
  }
  const repoURL = safeURL(project.links?.github);
  if (repoURL) {
    const repo = new URL(repoURL);
    const parts = repo.pathname.split('/').filter(Boolean).slice(0, 2);
    const target = new URL(docs);
    if (repo.hostname === 'github.com' && parts.length === 2) {
      const prefix = '/' + parts.join('/');
      if (host === 'github.com' && (target.pathname === prefix || target.pathname.startsWith(prefix + '/'))) return docs;
      if (host === parts[0].toLowerCase() + '.github.io' && (target.pathname === '/' + parts[1] || target.pathname.startsWith('/' + parts[1] + '/'))) return docs;
    }
  }
  return null; // Ambiguous external documents stay in What we checked.
}

// README excerpts keep their Markdown. Links render only to the record's own sources
// or the network site; any other target keeps its text, and emphasis markers are dropped.
function projectDescription(project) {
  const p = el('p', 'description');
  const text = project.description_en || 'A new ecosystem signal. More information is being gathered.';
  const allowed = new Set([...Object.values(normalizedLinks(project)), 'https://squeekchain.com/'].map(safeURL).filter(Boolean));
  const plain = value => value.replace(/\*\*|__/g, '');
  const pattern = /\[([^\]\n]{1,120})\]\((https:\/\/[^\s)]{1,300})\)|https:\/\/[^\s)<>\]]{1,300}/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    p.append(plain(text.slice(last, match.index)));
    let [whole, label, target] = match, tail = '';
    if (!target) {
      tail = whole.match(/[.,;:!?]*$/)[0];
      target = label = whole.slice(0, whole.length - tail.length);
    }
    const url = safeURL(target);
    p.append(url && allowed.has(url) ? external(url, '', plain(label)) : plain(label), tail);
    last = match.index + whole.length;
  }
  p.append(plain(text.slice(last)));
  return p;
}

// Code repositories are listed under What we checked, not in the card's link row.
function projectLinks(project) {
  const container = el('div', 'links');
  container.setAttribute('aria-label', 'Project links');
  const links = normalizedLinks(project);
  for (const kind of ['website', 'x', 'announcement', 'docs', 'telegram']) {
    if (kind === 'announcement' && links.x) continue;
    const [, label] = linkLabels[kind];
    const a = external(kind === 'docs' ? projectDocsURL(project) : links[kind], 'project-link');
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
  const allowed = new Set([...Object.values(normalizedLinks(project)), ...(project.evidence || []).map(e => e.url)].map(safeURL).filter(url => url && !isNetworkDocumentation(url)));
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

// A listing is a source fact, separate from genre, integration or safety.
function showcaseInfo(project) {
  const info = project.verified_by_squeek;
  if (!info || info.version !== 1 || typeof info.stale !== 'boolean') return null;
  const url = safeURL(info.source_url);
  if (!url || !/^https:\/\/squeekchain\.com\/genesis\/(?:code|i\/[A-Za-z0-9_-]{1,64})\/?$/.test(url)) return null;
  if (!Number.isFinite(Date.parse(info.verified_at)) || !Number.isFinite(Date.parse(info.last_checked))) return null;
  return {...info, source_url: url};
}

function showcaseTitle(info) {
  const text = "Listed on Squeekchain’s Genesis board after team review; not a security audit.";
  return text + (info.stale ? ' Last checked ' + date(info.last_checked, true) + '; the listing awaits a fresh confirmation.' : '');
}

// Other public cards whose IMD builds were paid from the same wallet; each name opens that card here.
function sameWalletLinks(project) {
  const known = new Map(state.projects.map(p => [p.id, p]));
  const others = (Array.isArray(project.same_wallet) ? project.same_wallet : []).filter(o => o && known.has(o.id) && o.id !== project.id);
  if (!others.length) return null;
  const line = el('p', 'same-wallet');
  line.append('The same IMD wallet also published ');
  others.forEach((other, index) => {
    if (index) line.append(index === others.length - 1 ? ' and ' : ', ');
    const a = el('a', '', known.get(other.id).name || 'another project');
    if (selectedProject) {
      const params = new URLSearchParams(viewParams);
      params.set('project', other.id);
      a.href = '?' + params.toString();
    } else {
      a.href = '#project-' + other.id;
      a.addEventListener('click', event => {event.preventDefault(); openProject(other.id);});
    }
    line.append(a);
  });
  line.append('.');
  return line;
}

// Sites of other versions the owner merged into this card; they no longer have cards of their own.
function otherVersions(project) {
  const versions = (Array.isArray(project.other_versions) ? project.other_versions : []).filter(v => v && safeURL(v.url));
  if (!versions.length) return null;
  const line = el('p', 'other-versions');
  line.append(versions.length === 1 ? 'The same wallet also published another version of this project: ' : 'The same wallet also published other versions of this project: ');
  versions.forEach((version, index) => {
    if (index) line.append(', ');
    line.append(external(version.url, '', version.name || 'its site'));
  });
  line.append('.');
  return line;
}

// Bring a card into view, clearing filters that hide it, and open its details.
function openProject(id) {
  if (!visibleProjects().some(p => p.id === id)) {
    state.query = '';
    $('search').value = '';
    state.category = 'all';
    $('category').value = 'all';
    if (!embedMode) {
      state.filter = 'all';
      document.querySelectorAll('[data-filter]').forEach(tab => {
        tab.classList.toggle('selected', tab.dataset.filter === 'all');
        tab.setAttribute('aria-pressed', String(tab.dataset.filter === 'all'));
      });
    }
    render();
  }
  const article = $('project-' + id);
  if (!article) return;
  const details = article.querySelector('details');
  if (details) details.open = true;
  article.scrollIntoView({behavior: 'smooth', block: 'start'});
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
    contract_interaction: 'a contract interaction reference', website: 'a website reference',
    imd_publication: 'the public IMD build job', imd_site: 'the earlier IMD-hosted address',
    owner_lead: 'the public post that led us here'};
  for (const source of project.evidence || []) {
    const url = safeURL(source.url);
    if (!url || isNetworkDocumentation(url) || seen.has(url)) continue;
    seen.add(url);
    references.push(external(url, '', labels[source.kind] || 'a linked public observation'));
  }
  for (const [kind, label] of [['website', 'the linked website'], ['github', 'the linked code repository'],
    ['announcement', 'the linked announcement'], ['x', 'the linked X profile'], ['docs', projectDocsURL(project) ? 'the project documentation' : 'a documentation reference'], ['explorer', 'the linked explorer record']]) {
    const url = safeURL(links[kind]);
    if (!url || isNetworkDocumentation(url) || seen.has(url)) continue;
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
  else {
    const cited = url => [...copy.querySelectorAll('a')].some(a => a.href === url);
    const repo = safeURL(links.github);
    if (repo && !cited(repo)) {
      const reference = el('p');
      reference.append('The code is in ', external(repo, '', 'a public repository'), '. Published code alone does not verify deployment, usage or safety.');
      copy.append(reference);
    }
    if (safeURL(links.explorer) && !cited(safeURL(links.explorer))) {
      const reference = el('p');
      reference.append('There’s also ', external(links.explorer, '', 'an explorer reference'), '. A link alone does not verify deployment, usage or safety.');
      copy.append(reference);
    }
  }
  if (!generated || generated.dataset.origin !== 'curated') {
  const identity = {resolved: 'The identifiers line up in the sources we have.',
    conflict: 'Some identifiers don’t line up yet, so this one needs another look.'};
  const connection = {confirmed: 'There’s evidence of a Squeekchain connection in the links above.',
    claimed: 'The project says it connects to Squeekchain; we still have limited independent evidence for that.'};
  copy.append(el('p', '', (identity[project.identity_status] || 'We haven’t pinned down the project’s identity from this record alone.') + ' ' +
    (connection[project.ecosystem_status] || 'These sources don’t yet establish a Squeekchain integration.')));
  const stage = stageLabels[project.lifecycle_stage || project.stage] || stageLabels.unknown;
  const where = el('p', '', 'Where things stand: ' + stage.charAt(0).toLowerCase() + stage.slice(1) + '. ');
  if (project.builder) {
    // The handle itself opens the profile.
    const handle = /^[A-Za-z0-9_]{1,15}$/.test(project.builder) && external('https://x.com/' + project.builder, '', '@' + project.builder);
    where.append('The announcement comes from ', handle || '@' + project.builder, ', which may be a builder’s personal account. ');
  }
  let context = '';
  if (project.first_seen) context += 'We first picked it up on ' + date(project.first_seen, true) + '. ';
  const contracts = project.contracts || [];
  context += contracts.length ? 'There’s a contract reference here: ' + contracts.map(c => c.address + ' (chain ' + c.chain_id + ')').join('; ') + '. That alone doesn’t tell us whether it’s deployed, active or safe.' :
    'We haven’t independently confirmed a project contract from this record.';
  where.append(context);
  copy.append(where);
  if (project.review_required) copy.append(el('p', '', 'The record is flagged for an additional identity review.'));
  }
  for (const builder of (Array.isArray(project.builder_links) ? project.builder_links : []).slice(0, 3)) {
    const url = safeURL(builder.url);
    if (!url || !/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?$/.test(url)) continue;
    const credit = el('p');
    const post = builder.kind === 'post' && safeURL(builder.source);
    if (builder.kind === 'board') continue; // named with the Genesis board line below
    const teamPost = builder.kind === 'team_post' && safeURL(builder.source);
    if (teamPost) credit.append('The Squeekchain team named ', external(url, '', builder.label || 'its builder'), ' as its builder in ', external(teamPost, '', 'a post on X'), '.');
    else if (post) credit.append(external(url, '', builder.label || 'Its builder'), ' presented this project as their build in ', external(post, '', 'a post on X'), '.');
    else credit.append('The site credits ', external(url, '', builder.label || 'its builder'), ' as its builder.');
    copy.append(credit);
  }
  for (const line of [sameWalletLinks(project), otherVersions(project)]) if (line) copy.append(line);
  const verified = showcaseInfo(project);
  if (verified) {
    const source = el('p', 'showcase-source');
    source.append('This project was listed on ', external(verified.source_url, '', 'Squeekchain’s Genesis board'),
      ' (verified ' + date(verified.verified_at, true) + ')');
    const submitter = (Array.isArray(project.builder_links) ? project.builder_links : []).find(b => b && b.kind === 'board');
    const handle = submitter && safeURL(submitter.url);
    if (handle && /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/.test(handle)) source.append(', submitted by ', external(handle, '', submitter.label || 'its builder'));
    source.append('.');
    source.title = showcaseTitle(verified);
    copy.append(source);
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
  const stage = el('span', 'stage-tag', stageTags[project.stage] || 'Testnet');
  if (project.id === '34d98d6c0dd3f8d8') stage.textContent = 'Mainnet contract & Testnet';
  if (!stageTags[project.stage] || project.stage === 'unknown') stage.title = 'Squeekchain testnet · project deployment not independently confirmed';
  else if (['testnet', 'mainnet'].includes(project.stage)) stage.title = stageLabels[project.stage];
  stage.classList.toggle('confirmed', project.stage === 'live_confirmed');
  nameRow.append(stage);
  info.append(nameRow);
  const badges = el('div', 'badges');
  const key = String(project.category || 'other');
  const category = el('span', 'category-badge', categoryTags[key] || key.replaceAll('_', ' '));
  category.title = 'Category: ' + (categoryLabels[key] || key.replaceAll('_', ' '));
  badges.append(category);
  const verified = showcaseInfo(project);
  if (verified) {
    const badge = el('span', 'showcase-badge', 'Verified by Squeek');
    badge.title = showcaseTitle(verified);
    badges.append(badge);
  }
  info.append(badges);
  info.append(projectDescription(project), projectLinks(project));
  top.append(projectLogo(project), info);
  article.append(top);
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

// What a reader can search by: the name, description, category, builders and the card's own addresses.
function searchText(project) {
  const links = project.links || {};
  const addresses = ['website', 'x', 'github'].map(kind => safeURL(links[kind])).filter(Boolean).map(href => {
    const url = new URL(href);
    return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '');
  });
  const builders = (Array.isArray(project.builder_links) ? project.builder_links : []).map(builder => builder && builder.label);
  const category = project.category || 'other';
  return [project.name, project.description_en, project.builder, categoryLabels[category] || category, ...addresses, ...builders]
    .filter(value => typeof value === 'string').join(' ').toLowerCase();
}

function visibleProjects() {
  // Every word must appear somewhere on the card, in any order.
  const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  return state.projects.filter(project => {
    const category = state.category === 'all' || (state.category === '__squeek_verified' ? Boolean(showcaseInfo(project)) : (project.category || 'other') === state.category);
    if (!matchesFilter(project) || !category) return false;
    const text = words.length ? searchText(project) : '';
    return words.every(word => text.includes(word));
  }).sort((a, b) => {
    const left = Date.parse(a.first_seen), right = Date.parse(b.first_seen);
    if (!Number.isFinite(left) && Number.isFinite(right)) return 1;
    if (Number.isFinite(left) && !Number.isFinite(right)) return -1;
    return (Number.isFinite(left) && Number.isFinite(right) ? (state.sort === 'newest' ? right - left : left - right) : 0) || String(a.id).localeCompare(String(b.id));
  });
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
  const verifiedCount = base.filter(project => showcaseInfo(project)).length;
  if (state.category === '__squeek_verified' ? !verifiedCount : state.category !== 'all' && !counts.has(state.category)) {
    state.category = 'all';
    $('category').value = 'all';
  }
  const order = Object.keys(categoryLabels);
  const categories = [...counts.keys()].sort((a, b) => {
    const left = order.indexOf(a), right = order.indexOf(b);
    return (left < 0 ? order.length : left) - (right < 0 ? order.length : right) || a.localeCompare(b);
  });
  const buttons = [['all', 'ALL', base.length], ...(verifiedCount ? [['__squeek_verified', 'Verified by Squeek', verifiedCount]] : []), ...categories.map(key => [key, categoryLabels[key] || key.replaceAll('_', ' '), counts.get(key)])]
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
  const nextSort = state.sort === 'newest' ? 'Show oldest discoveries first' : 'Show newest discoveries first';
  $('sort-toggle').setAttribute('aria-label', nextSort);
  $('sort-toggle').setAttribute('aria-pressed', String(state.sort === 'oldest'));
  $('sort-toggle').title = nextSort;
  $('sort-toggle').firstElementChild.textContent = state.sort === 'newest' ? '↓' : '↑';
  $('sort-hint').textContent = nextSort;
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
  $('message').textContent = state.query.trim() && state.projects.length ? 'No projects match “' + state.query.trim() + '”. Try another word or clear the search.' :
    embedMode ? 'New ecosystem projects will appear here as they are identified.' :
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
  $('sort-toggle').addEventListener('click', () => {state.sort = state.sort === 'newest' ? 'oldest' : 'newest'; render();});
  $('search').addEventListener('input', event => {state.query = event.target.value; render();});
  $('search').addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.target.value) {event.target.value = ''; state.query = ''; render();}
  });
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
