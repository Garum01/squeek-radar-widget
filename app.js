'use strict';
const state = {projects: [], filter: 'all', query: '', category: 'all', updated: null};
const $ = id => document.getElementById(id);
const viewParams = new URLSearchParams(location.search);
const selectedProject = viewParams.get('project');
const publicFeed = document.body.dataset.publicFeed;
const embedMode = Boolean(publicFeed)||location.pathname==='/embed'||viewParams.get('embed')==='1';
if(embedMode)document.body.classList.add('embed');
const stageLabels = {research: 'Early signal · under review', development: 'In development', testnet_announced: 'Testnet announced by the developer', launch_announced: 'Launch announced by the developer', live_confirmed: 'Live activity confirmed'};
const linkLabels = {x: ['𝕏', 'X'], website: ['◎', 'Website'], telegram: ['➤', 'Telegram'], github: ['⌘', 'GitHub'], docs: ['▤', 'Docs'], explorer: ['⌕', 'Explorer']};
function el(tag, cls, text) {const node = document.createElement(tag); if(cls) node.className = cls; if(text !== undefined) node.textContent = text; return node;}
function date(value, long=false) {const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Not recorded' : d.toLocaleDateString('en-GB', {day:'numeric', month:'short', ...(long ? {year:'numeric'} : {})});}
function safeURL(value) {try {const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port==='443') ? u.href : null;} catch {return null;}}
function external(url, cls, label) {const a = el('a',cls,label); const safe = safeURL(url); if(!safe) return null; a.href=safe; a.target='_blank'; a.rel='noopener noreferrer'; return a;}
function teamEvidence(p) {return (p.evidence||[]).some(e=>e.kind==='team_mention');}
function chainEvidence(p) {return (p.evidence||[]).some(e=>e.kind.startsWith('onchain')||e.kind==='contract_interaction');}
function namedProject(p) {return p.stage!=='research'||Boolean(p.links?.website);}
function evidenceLabel(p) {if(chainEvidence(p)) return 'On-chain evidence found'; if(teamEvidence(p)) return 'Mentioned by the team · see source'; return 'Public-source candidate · under review';}
function paragraph(parent, label, value) {parent.append(el('p','details-label',label),el('p','details-value',value));}
function card(p) {
 const article=el('article','project'); article.id='project-'+p.id;
 const top=el('div','project-top'), logo=el('div','logo');
 if(/^\/?logos\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(p.logo||'')) {const img=el('img');img.src=p.logo;img.alt=p.name+' logo';img.loading='lazy';img.addEventListener('error',()=>{img.remove();logo.textContent=(p.name||'?').charAt(0).toLowerCase();});logo.append(img);} else {logo.textContent=(p.name||'?').charAt(0).toLowerCase();logo.setAttribute('aria-label','No confirmed project logo yet');}
 const info=el('div','project-info'), nameRow=el('div','name-row');nameRow.append(el('h2','',p.name),el('span','category',(p.category||'other').replaceAll('_',' '))); info.append(nameRow);
 const links=el('div','links'); links.setAttribute('aria-label','Project links');
 for(const kind of ['x','website','telegram','github','docs','explorer']) {const url=p.links?.[kind];if(!url)continue;const [icon,label]=linkLabels[kind];const a=external(url,'project-link');if(!a)continue;a.append(el('span','link-icon',icon));if(kind!=='x')a.append(el('span','',label));a.append(el('span','arrow','↗'));a.setAttribute('aria-label',label+' for '+p.name+' (opens in a new tab)');links.append(a);}
 info.append(links);top.append(logo,info);article.append(top,el('p','description',p.description_en||'A new ecosystem signal. More information is being gathered.'));
 const meta=el('div','card-meta');meta.append(el('span','evidence-tag',evidenceLabel(p)),el('span','first-seen','FOUND '+date(p.first_seen).toUpperCase()));article.append(meta);
 const details=el('details');const summary=el('summary','','Details & sources');details.append(summary);const body=el('div','details-body'), grid=el('div','details-grid'), facts=el('div'), evidence=el('div');
 paragraph(facts,'Project stage',stageLabels[p.stage]||'Stage not confirmed');
 if(p.builder)paragraph(facts,'Announcement author / builder','@'+p.builder+' · personal account, not necessarily a project account');
 paragraph(facts,'First observed',date(p.first_seen,true));
 paragraph(facts,'Last website check',p.last_checked?date(p.last_checked,true):'Not yet confirmed');
 paragraph(facts,'Contracts',(p.contracts||[]).length ? p.contracts.map(c=>c.address+' · chain '+c.chain_id).join('\n') : 'No project contract independently confirmed.');
 if(p.review_required)paragraph(facts,'Identity review','Some identifiers conflict. This project needs a closer look.');
 evidence.append(el('p','details-label','Why it is here'));const list=el('ul','evidence-list');
 for(const e of p.evidence||[]) {const li=el('li'),a=external(e.url,'',e.kind==='team_mention'?'Team post / quoted announcement ↗':e.kind==='github'?'Repository evidence ↗':'View source ↗');if(a)li.append(a);li.append(el('p','evidence-note',e.note||'Public-source observation.'));list.append(li);}
 evidence.append(list,el('p','evidence-note','A mention is not an endorsement. Source evidence does not establish that a project is safe.'));grid.append(facts,evidence);body.append(grid);details.append(body);article.append(details);return article;
}
function render(){const query=state.query.toLowerCase();const rows=state.projects.filter(p=>(!selectedProject||p.id===selectedProject)&&((selectedProject||document.body.classList.contains('embed'))||(state.filter==='all'&&namedProject(p))||(state.filter==='early'&&!namedProject(p))||(state.filter==='team'&&teamEvidence(p))||(state.filter==='chain'&&chainEvidence(p)))&&(state.category==='all'||p.category===state.category)&&(!query||[p.name,p.description_en,p.builder,p.category].filter(Boolean).join(' ').toLowerCase().includes(query))).sort((a,b)=>Number(teamEvidence(b))-Number(teamEvidence(a))||Number(Boolean(b.links?.website))-Number(Boolean(a.links?.website))||String(b.first_seen).localeCompare(String(a.first_seen)));const list=$('projects');const open=new Set([...list.querySelectorAll('article')].filter(a=>a.querySelector('details[open]')).map(a=>a.id));list.replaceChildren(...rows.map(card));for(const a of list.querySelectorAll('article'))if(open.has(a.id))a.querySelector('details').open=true;$('project-count').textContent=String(state.projects.filter(namedProject).length);$('message').hidden=rows.length>0;if(!rows.length)$('message').textContent=embedMode?'New ecosystem projects will appear here as they are identified.':state.projects.length?'No projects match these filters. Try another filter or look under Early signals.':'No projects have been confirmed for the directory yet. New observations will appear here.';}
function renderSources(sources){const container=$('sources');container.replaceChildren();const labels={deployment:'Official deployment record',announcement:'Known project announcement',x:'Team posts & quotes',github:'Public GitHub discovery',onchain:'On-chain discovery',websites:'Project websites',maintenance:'Data maintenance'};for(const source of sources.filter(s=>s.name!=='maintenance')){const row=el('div','source-row');row.append(el('span','',labels[source.name]||source.name));let label=source.status==='ok'?'Checked':source.status==='pending'?'Awaiting setup':'Temporarily unavailable';row.append(el('span','source-state',label+(source.last_success?' · '+date(source.last_success):'')));container.append(row);}}
async function refresh(){try{const endpoint=publicFeed?new URL(publicFeed,location.href):new URL(embedMode?'/api/public-projects':'/api/projects',location.href);if(publicFeed)endpoint.searchParams.set('v',String(Math.floor(Date.now()/60000)));const response=await fetch(endpoint,{cache:'no-store'});if(!response.ok)throw new Error('unavailable');const data=await response.json();if(!Array.isArray(data.projects)||(!data.public&&!Array.isArray(data.sources)))throw new Error('invalid');state.projects=data.projects;render();if(data.public){state.updated=new Date().toISOString();return;}renderSources(data.sources);const relevant=data.sources.filter(s=>!['maintenance','websites'].includes(s.name));const limited=!relevant.length||relevant.some(s=>s.status!=='ok');$('coverage-label').textContent=limited?'Limited source coverage':'Sources checked';$('coverage-dot').classList.toggle('good',!limited);$('last-scan').textContent=data.last_scan?'Last cycle '+new Date(data.last_scan).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})+' · your local time':'First scan in progress';state.updated=data.generated_at;}catch{$('coverage-label').textContent='Update unavailable';$('coverage-dot').classList.remove('good');$('last-scan').textContent=state.updated?'Showing the last loaded observations':'Please try again shortly';if(!state.projects.length){$('message').hidden=false;$('message').textContent='The directory is temporarily unavailable. Please try again shortly.';}}}
$('search').addEventListener('input',e=>{state.query=e.target.value;render();});$('category').addEventListener('change',e=>{state.category=e.target.value;render();});document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{state.filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});render();}));$('source-toggle').addEventListener('click',()=>{const next=$('sources').hidden;$('sources').hidden=!next;$('source-toggle').setAttribute('aria-expanded',String(next));});
try{document.body.classList.toggle('dark',localStorage.getItem('radar-theme')==='dark');}catch{}
$('theme').addEventListener('click',()=>{const dark=document.body.classList.toggle('dark');try{localStorage.setItem('radar-theme',dark?'dark':'light');}catch{}});
refresh();setInterval(()=>{if(!document.hidden)refresh();},60000);

// Moni's host protocol. Content height is measured independently of iframe height.
if(embedMode && window.parent!==window){
 const root=document.querySelector('.page-shell');let previous=0;
 const reportHeight=(force=false)=>{const height=Math.max(1,Math.ceil(root.getBoundingClientRect().height));if(!force&&height===previous)return;previous=height;window.parent.postMessage({type:'moni-widget:resize',height},'https://research.moni.ai');};
 new ResizeObserver(()=>reportHeight()).observe(root);
 window.addEventListener('load',()=>reportHeight(true),{once:true});
 window.addEventListener('message',event=>{if(event.source===window.parent&&event.origin==='https://research.moni.ai'&&event.data?.type==='moni-widget:request-resize')reportHeight(true);});
}
