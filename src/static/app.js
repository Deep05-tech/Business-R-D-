// Business R&D Agent — Client UI Script
// Served as /static/app.js — no template literal escaping issues here

// ---- Tab switching ----
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'query') loadQuerySites();
  if (name === 'smm') loadSmmSites();
  if (name === 'competitor') loadCompetitorSites();
  if (name === 'analysis') loadAnalysisSites();
}

// ---- Analyse form ----
const AGENTS = [
  'Crawling website',
  'Cleaning semantics',
  'Web intelligence',
  'Social intelligence',
  'Business identity',
  'Offerings extraction',
  'Audience analysis',
  'Brand intelligence',
  'Digital maturity',
  'R&D insights',
  'Marketing Strategy',
  'QC validation'
];
let agentTimer = null;

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('business-form');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    e.stopPropagation();

    const btn      = document.getElementById('submit-button');
    const statusEl = document.getElementById('status');
    const pills    = document.getElementById('progress-pills');
    const qcRow    = document.getElementById('qc-row');
    const output   = document.getElementById('output');

    if (!btn || !statusEl || !pills || !qcRow || !output) return;

    btn.disabled = true;
    document.getElementById('btn-icon').textContent = '';
    qcRow.style.display = 'none';
    pills.style.display = 'flex';
    pills.innerHTML = '';

    // Build progress pills
    let step = 0;
    const pillEls = AGENTS.map(function (name, i) {
      const el = document.createElement('span');
      el.className = 'pill';
      el.textContent = name;
      el.id = 'pill-' + i;
      pills.appendChild(el);
      return el;
    });

    // No more fake setInterval!
    const socialUrlsRaw = document.getElementById('social-urls').value;
    const socialUrls = socialUrlsRaw
      .split(/[\n,]/)
      .map(function (v) { return v.trim(); })
      .filter(Boolean);

    try {
      const formData = new FormData(document.getElementById('business-form'));
      
      const res = await fetch('/api/analyze-stream', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        throw new Error("HTTP error " + res.status);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processData = (data) => {
        if (data.type === 'progress') {
          const stepIndex = AGENTS.indexOf(data.step);
          if (stepIndex !== -1) {
            for (let i = 0; i < stepIndex; i++) {
              pillEls[i].classList.add('done');
            }
            statusEl.className = 'status-bar running';
            statusEl.innerHTML = '<span class="spinner"></span> ' + AGENTS[stepIndex] + '...';
          }
        } else if (data.type === 'complete') {
          output.textContent = JSON.stringify(data.profile, null, 2);
          pillEls.forEach(function (p) { p.classList.add('done'); });
          
          statusEl.className = 'status-bar done';
          const agentCount = (data.profile.structuredJsonMemoryObject &&
            data.profile.structuredJsonMemoryObject.agentDiagnostics &&
            data.profile.structuredJsonMemoryObject.agentDiagnostics.length) || 0;
          statusEl.innerHTML = '\u2713 Analysis complete \u2014 ' + agentCount + ' agents ran successfully.';
          
          showQcBar(data.profile.qc);
          btn.disabled = false;
          document.getElementById('btn-icon').textContent = '\u26a1';
        } else if (data.type === 'error') {
          statusEl.className = 'status-bar error';
          statusEl.innerHTML = '\u2717 ' + (data.error || 'Request failed');
          if (data.qc) showQcBar(data.qc);
          btn.disabled = false;
          document.getElementById('btn-icon').textContent = '\u26a1';
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              processData(JSON.parse(line.substring(6)));
            } catch(e) {}
          }
        }
      }

    } catch (err) {
      statusEl.className = 'status-bar error';
      statusEl.innerHTML = '\u2717 Network error: ' + err.message;
      btn.disabled = false;
      document.getElementById('btn-icon').textContent = '\u26a1';
    }
  });

  // Allow Enter key in query field
  const queryText = document.getElementById('query-text');
  if (queryText) {
    queryText.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') runQuery();
    });
  }
});

// ---- QC score bar ----
function showQcBar(qc) {
  if (!qc) return;
  const row      = document.getElementById('qc-row');
  const scoreEl  = document.getElementById('qc-score');
  const fill     = document.getElementById('qc-fill');
  const statusEl = document.getElementById('qc-status');

  row.style.display = 'flex';
  const pct = Math.round((qc.confidenceScore || 0) * 100);
  scoreEl.textContent = pct + '%';

  const cls = pct >= 85 ? 'pass' : pct >= 60 ? 'pass-warn' : 'fail';
  scoreEl.className = 'qc-score ' + (pct >= 85 ? 'pass' : 'fail');
  fill.style.width = pct + '%';
  fill.className = 'progress-fill ' + cls;
  statusEl.textContent = qc.passed ? '\u2713 Passed' : '\u2717 Failed';
  statusEl.style.color = qc.passed ? 'var(--success)' : 'var(--error)';
}

// ---- Memory query ----
async function runQuery() {
  const site      = (document.getElementById('query-site').value || '').trim();
  const q         = (document.getElementById('query-text').value || '').trim();
  const answerDiv = document.getElementById('query-answer');
  const answerText = document.getElementById('answer-text');

  if (!site || !q) { alert('Please enter both a URL and a question.'); return; }

  answerDiv.className = 'query-answer visible';
  answerText.innerHTML = '<em style="color:var(--text-muted)">Searching memory...</em>';

  try {
    const params = new URLSearchParams({ site: site, q: q });
    const res  = await fetch('/memory/query?' + params.toString());
    const data = await res.json();
    const confCls = data.confidence === 'high' ? 'conf-high'
                  : data.confidence === 'medium' ? 'conf-medium' : 'conf-low';
    answerText.innerHTML = (data.answer || 'No answer found.') +
      '<span class="conf-badge ' + confCls + '">' + (data.confidence || 'none') + '</span>';
  } catch (err) {
    answerText.innerHTML = '<span style="color:var(--error)">Error: ' + err.message + '</span>';
  }
}

// ---- SMM Generation ----
async function loadSmmSites() {
  try {
    const res = await fetch('/api/sites');
    const sites = await res.json();
    const select = document.getElementById('smm-site');
    
    if (sites.length === 0) {
      select.innerHTML = '<option value="">No businesses analysed yet</option>';
      return;
    }
    
    select.innerHTML = sites.map(s => 
      '<option value="' + s.url + '">' + s.name + ' (' + s.url + ')</option>'
    ).join('');
  } catch (err) {
    console.error("Failed to load SMM sites:", err);
  }
}

async function generateSMM() {
  const site      = (document.getElementById('smm-site').value || '').trim();
  const type      = (document.getElementById('smm-type').value || 'video').trim();
  const language  = (document.getElementById('smm-language').value || 'English').trim();
  const total     = parseInt(document.getElementById('smm-total').value || '3', 10);
  
  const smmAnswer = document.getElementById('smm-answer');
  const smmText   = document.getElementById('smm-text');

  if (!site) { alert('Please select a business memory first. If none exist, run the intelligence pipeline.'); return; }

  smmAnswer.style.display = 'block';
  smmText.innerHTML = '<em style="color:var(--text-muted)">Generating ' + total + ' ' + type + ' concepts in ' + language + '... (this may take a minute)</em>';

  try {
    const res = await fetch('/api/generate-smm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: site, type: type, totalPosts: total, language: language })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    if (data.posts && data.posts.length > 0) {
      smmText.innerHTML = data.posts.join('<br><br>');
    } else {
      smmText.innerHTML = 'No content generated.';
    }
  } catch (err) {
    smmText.innerHTML = '<span style="color:var(--error)">Error: ' + err.message + '</span>';
  }
}

// ---- Competitor Intelligence ----
async function loadCompetitorSites() {
  try {
    const res = await fetch('/api/sites');
    const sites = await res.json();
    const select = document.getElementById('competitor-site');
    
    if (sites.length === 0) {
      select.innerHTML = '<option value="">No businesses analysed yet</option>';
      return;
    }
    
    select.innerHTML = sites.map(s => 
      '<option value="' + s.url + '">' + s.name + ' (' + s.url + ')</option>'
    ).join('');
  } catch (err) {
    console.error("Failed to load competitor sites:", err);
  }
}

async function findCompetitors() {
  const site = (document.getElementById('competitor-site').value || '').trim();
  const ansDiv = document.getElementById('competitor-answer');
  const textDiv = document.getElementById('competitor-text');

  if (!site) { alert('Please select a business memory first.'); return; }

  ansDiv.style.display = 'block';
  textDiv.innerHTML = '<em style="color:var(--text-muted)">Executing live market research... (this may take up to 30 seconds)</em>';

  try {
    const res = await fetch('/api/competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: site })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    // Markdown formatting helper to render bold text
    const formatMd = (text) => text.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
    textDiv.innerHTML = formatMd(data.report || 'No competitors found.');
  } catch (err) {
    textDiv.innerHTML = '<span style="color:var(--error)">Error: ' + err.message + '</span>';
  }
}

// ---- Index stats ----
async function loadStats() {
  try {
    const res  = await fetch('/memory/stats');
    const data = await res.json();
    document.getElementById('stat-sites').textContent  = data.totalSites  || 0;
    document.getElementById('stat-named').textContent  = data.sitesWithName || 0;

    const bd = document.getElementById('industry-breakdown');
    const industries = Object.entries(data.industries || {});
    if (industries.length === 0) {
      bd.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No sites analysed yet.</p>';
      return;
    }
    bd.innerHTML =
      '<p style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Industries</p>' +
      industries.map(function (entry) {
        return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">' +
          '<span style="color:var(--text)">' + entry[0] + '</span>' +
          '<span style="color:var(--accent);font-weight:700;">' + entry[1] + '</span></div>';
      }).join('');
  } catch (_) {}
}

// ---- Gap Analysis ----
async function loadAnalysisSites() {
  try {
    const res = await fetch('/api/sites');
    const sites = await res.json();
    const select = document.getElementById('analysis-site');
    
    if (sites.length === 0) {
      select.innerHTML = '<option value="">No businesses analysed yet</option>';
      return;
    }
    
    select.innerHTML = sites.map(s => 
      '<option value="' + s.url + '">' + s.name + ' (' + s.url + ')</option>'
    ).join('');
  } catch (err) {
    console.error("Failed to load analysis sites:", err);
  }
}

async function runAnalysis() {
  const site = (document.getElementById('analysis-site').value || '').trim();
  const ansDiv = document.getElementById('analysis-answer');
  const textDiv = document.getElementById('analysis-text');

  if (!site) { alert('Please select a business memory first.'); return; }

  ansDiv.style.display = 'block';
  textDiv.innerHTML = '<em style="color:var(--text-muted)">Invading competitors and generating strategic roadmap... (this will take 1-3 minutes)</em>';

  try {
    const res = await fetch('/api/gap-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: site })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    const formatMd = (text) => text.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
    textDiv.innerHTML = formatMd(data.report || 'No analysis generated.');
  } catch (err) {
    textDiv.innerHTML = '<span style="color:var(--error)">Error: ' + err.message + '</span>';
  }
}
