window.activeProjectUrl = null;

// On load
document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
});

// ---- Tab Switching ----
window.switchTab = function(name, title) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
  
  document.getElementById('panel-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
  document.getElementById('page-title').innerText = title;

  if (name === 'competitors') loadCompetitorsUI();
  if (name === 'social-feed') loadFeedUI();
};

// ---- Projects ----
async function loadProjects() {
  try {
    const res = await fetch('/api/sites');
    const sites = await res.json();
    const select = document.getElementById('global-project');
    
    if (sites.length === 0) {
      select.innerHTML = '<option value="">No projects found</option>';
      return;
    }
    
    select.innerHTML = '<option value="">-- Select a Project --</option>' + 
      sites.map(s => `<option value="${s.url}">${s.name}</option>`).join('');
  } catch (err) {
    console.error("Failed to load projects:", err);
  }
}

window.selectProject = function(url) {
  window.activeProjectUrl = url;
  if (!url) {
    // Disable tabs
    document.querySelectorAll('.sidebar-nav .nav-item:not(#nav-analyse)').forEach(el => {
      el.classList.add('disabled');
      el.onclick = (e) => { e.preventDefault(); return false; };
    });
    switchTab('analyse', 'New Analysis');
    return;
  }

  // Enable tabs
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
    el.classList.remove('disabled');
  });

  // Re-bind onclick
  document.getElementById('nav-competitors').onclick = () => { switchTab('competitors', 'Competitor Intelligence'); return false; };
  document.getElementById('nav-smm').onclick = () => { switchTab('smm', 'SMM Generation'); return false; };
  document.getElementById('nav-seo').onclick = () => { switchTab('seo', 'Website & SEO'); return false; };
  document.getElementById('nav-social-feed').onclick = () => { switchTab('social-feed', 'Competitor Feed'); return false; };

  // Go to competitors by default when a project is selected
  switchTab('competitors', 'Competitor Intelligence');
};

// ---- Run Intelligence ----
window.runIntelligence = async function() {
  const form = document.getElementById('business-form');
  const url = document.getElementById('website-url').value;
  if (!url) return;

  document.getElementById('loading-overlay').style.display = 'flex';
  
  const formData = new FormData(form);
  try {
    const res = await fetch('/business-intelligence', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error('Failed to run intelligence');
    
    // Reload projects and select the new one
    await loadProjects();
    document.getElementById('global-project').value = url;
    window.selectProject(url);
  } catch (e) {
    alert("Error: " + e.message);
  } finally {
    document.getElementById('loading-overlay').style.display = 'none';
  }
};

// ---- Competitors ----
window.findCompetitors = async function() {
  if (!window.activeProjectUrl) return;
  const list = document.getElementById('competitor-list');
  list.innerHTML = '<div class="spinner" style="margin: 20px auto;"></div>';
  
  try {
    const res = await fetch('/api/competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: window.activeProjectUrl })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    // data.competitors should be an array of objects
    loadCompetitorsUI();
  } catch (e) {
    list.innerHTML = `<div class="empty-state" style="color:var(--required)">Error: ${e.message}</div>`;
  }
};

async function loadCompetitorsUI() {
  if (!window.activeProjectUrl) return;
  const list = document.getElementById('competitor-list');
  
  try {
    const res = await fetch(`/api/competitors?url=${encodeURIComponent(window.activeProjectUrl)}`);
    const data = await res.json();
    
    if (!data.competitors || data.competitors.length === 0) {
      list.innerHTML = '<div class="empty-state">No competitors mapped yet. Click "Find Competitors" above.</div>';
      return;
    }
    
    list.innerHTML = data.competitors.map(c => `
      <div class="competitor-card">
        <div class="comp-info">
          <h3>${c.name}</h3>
          <a href="${c.url}" target="_blank">${c.url}</a>
        </div>
        <div class="social-links">
          ${c.socials.instagram ? `<a href="${c.socials.instagram}" class="social-icon" target="_blank" title="Instagram">📸</a>` : ''}
          ${c.socials.facebook ? `<a href="${c.socials.facebook}" class="social-icon" target="_blank" title="Facebook">📘</a>` : ''}
          ${c.socials.twitter ? `<a href="${c.socials.twitter}" class="social-icon" target="_blank" title="X (Twitter)">𝕏</a>` : ''}
          ${c.socials.youtube ? `<a href="${c.socials.youtube}" class="social-icon" target="_blank" title="YouTube">▶️</a>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Failed to load competitors.</div>';
  }
}

// ---- SMM ----
window.generateSMM = async function() {
  if (!window.activeProjectUrl) return;
  
  const strategy = document.querySelector('input[name="smmStrategy"]:checked').value;
  const type = document.getElementById('smm-type').value;
  const lang = document.getElementById('smm-language').value;
  const total = document.getElementById('smm-total').value;
  
  const ansDiv = document.getElementById('smm-answer');
  const textDiv = document.getElementById('smm-text');
  
  ansDiv.style.display = 'block';
  textDiv.innerHTML = '<div class="spinner"></div><p style="margin-top:10px;color:var(--text-muted)">Generating elite content...</p>';
  
  try {
    const res = await fetch('/api/generate-smm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        websiteUrl: window.activeProjectUrl,
        type: type,
        language: lang,
        totalPosts: total,
        strategy: strategy
      })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    textDiv.innerHTML = data.posts.join('<br><br><hr style="border-top:1px solid var(--border);margin:20px 0;"><br>');
  } catch (e) {
    textDiv.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
  }
};

// ---- SEO ----
window.generateSEO = async function() {
  if (!window.activeProjectUrl) return;
  
  const ansDiv = document.getElementById('seo-answer');
  const textDiv = document.getElementById('seo-text');
  
  ansDiv.style.display = 'block';
  textDiv.innerHTML = '<div class="spinner"></div><p style="margin-top:10px;color:var(--text-muted)">Analyzing competitor SEO footprint...</p>';
  
  try {
    const res = await fetch('/api/seo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: window.activeProjectUrl })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    textDiv.innerHTML = data.report.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  } catch (e) {
    textDiv.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
  }
};

// ---- CRON FEED ----
window.triggerCron = async function() {
  const list = document.getElementById('feed-list');
  list.innerHTML = '<div class="spinner" style="margin: 20px auto;"></div><div style="text-align:center">Running deep social crawl across all competitors. This can take several minutes...</div>';
  
  try {
    const res = await fetch('/api/cron/run', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    loadFeedUI();
  } catch (e) {
    list.innerHTML = `<div class="empty-state" style="color:red">Error: ${e.message}</div>`;
  }
};

async function loadFeedUI() {
  if (!window.activeProjectUrl) return;
  const list = document.getElementById('feed-list');
  
  try {
    const res = await fetch(`/api/social-feed?url=${encodeURIComponent(window.activeProjectUrl)}`);
    const data = await res.json();
    
    if (!data.feed || data.feed.length === 0) {
      list.innerHTML = '<div class="empty-state">No competitor posts found yet.</div>';
      return;
    }
    
    list.innerHTML = data.feed.map(post => `
      <div class="feed-item">
        <div class="feed-avatar">${post.platformIcon}</div>
        <div class="feed-content">
          <div class="feed-header">
            <span class="feed-author">${post.competitorName} on ${post.platform}</span>
            <span class="feed-meta">${new Date(post.date).toLocaleDateString()}</span>
          </div>
          <div class="feed-text">${post.content}</div>
          ${post.link ? `<a href="${post.link}" target="_blank" style="display:inline-block;margin-top:10px;font-size:12px;font-weight:600;color:var(--primary);text-decoration:none;">View Original Post ↗</a>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Failed to load social feed.</div>';
  }
}
