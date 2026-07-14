window.activeProjectUrl = null;

window.showSuccess = function(message) {
  const toast = document.getElementById('global-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => toast.style.opacity = '1', 10);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.style.display = 'none', 300);
  }, 3000);
};

// On load
document.addEventListener('DOMContentLoaded', () => {
  // Check and apply theme on load
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = '☀️';
  }

  loadProjects();
});

// Theme Toggle
window.toggleTheme = () => {
  document.body.classList.toggle('dark-theme');
  const isDark = document.body.classList.contains('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
};

// ---- Tab Switching ----
window.switchTab = function(name, title) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
  
  document.getElementById('panel-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
  document.getElementById('page-title').innerText = title;

  localStorage.setItem('activeTab', name);
  localStorage.setItem('activeTabTitle', title);

  if (name === 'details') loadProjectDetails();
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
      
    const savedUrl = localStorage.getItem('activeProjectUrl');
    if (savedUrl && Array.from(select.options).some(o => o.value === savedUrl)) {
      select.value = savedUrl;
      window.selectProject(savedUrl, true);
      const savedTab = localStorage.getItem('activeTab') || 'details';
      const savedTitle = localStorage.getItem('activeTabTitle') || 'Project Details & Review';
      switchTab(savedTab, savedTitle);
    }
  } catch (err) {
    console.error("Failed to load projects:", err);
  }
}

window.selectProject = function(url, isInitialLoad = false) {
  window.activeProjectUrl = url;
  if (url) localStorage.setItem('activeProjectUrl', url);
  else localStorage.removeItem('activeProjectUrl');
  
  const deleteBtn = document.getElementById('btn-global-delete');

  if (!url) {
    if (deleteBtn) deleteBtn.style.display = 'none';
    // Disable tabs
    document.querySelectorAll('.sidebar-nav .nav-item:not(#nav-analyse)').forEach(el => {
      el.classList.add('disabled');
      el.onclick = (e) => { e.preventDefault(); return false; };
    });
    switchTab('analyse', 'New Analysis');
    return;
  }

  if (deleteBtn) deleteBtn.style.display = 'block';

  // Enable tabs
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
    el.classList.remove('disabled');
  });

  // Re-bind onclick
  document.getElementById('nav-details').onclick = () => { switchTab('details', 'Project Details & Review'); return false; };
  document.getElementById('nav-competitors').onclick = () => { switchTab('competitors', 'Competitor Intelligence'); return false; };
  document.getElementById('nav-smm').onclick = () => { switchTab('smm', 'SMM Generation'); return false; };
  document.getElementById('nav-seo').onclick = () => { switchTab('seo', 'Website & SEO'); return false; };
  document.getElementById('nav-social-feed').onclick = () => { switchTab('social-feed', 'Competitor Feed'); return false; };

  if (!isInitialLoad) {
    switchTab('details', 'Project Details & Review');
  }
};

// ---- Project Details & Review ----
document.addEventListener('DOMContentLoaded', () => {
  const smmThemeSelect = document.getElementById('smm-theme');
  const smmProductContainer = document.getElementById('smm-product-container');
  if (smmThemeSelect && smmProductContainer) {
    smmThemeSelect.addEventListener('change', (e) => {
      const theme = e.target.value;
      if (theme === 'product' || theme === 'technical') {
        smmProductContainer.style.display = 'block';
      } else {
        smmProductContainer.style.display = 'none';
      }
    });
  }
});

async function loadProjectDetails() {
  if (!window.activeProjectUrl) return;
  try {
    const res = await fetch(`/api/memory?url=${encodeURIComponent(window.activeProjectUrl)}`);
    const data = await res.json();
    if (!data.memory) return;
    
    const mem = data.memory;
    document.getElementById('edit-name').value = mem.businessIdentity?.officialName || '';
    document.getElementById('edit-industry').value = mem.businessIdentity?.industry || '';
    document.getElementById('edit-subindustry').value = mem.businessIdentity?.subIndustry || '';
    document.getElementById('edit-location').value = mem.businessIdentity?.location || '';
    document.getElementById('edit-vision').value = mem.businessIdentity?.vision || '';
    document.getElementById('edit-description').value = mem.businessIdentity?.description || '';
    
    document.getElementById('edit-products').value = (mem.offerings?.products || []).map(p => typeof p === 'string' ? p : p.name).join(', ');
    document.getElementById('edit-services').value = (mem.offerings?.services || []).map(s => typeof s === 'string' ? s : s.name).join(', ');
    document.getElementById('edit-audience').value = (mem.audience?.buyerPersonas || []).join(', ');
    
    // Populate SMM Products Dropdown
    const smmProductSelect = document.getElementById('smm-product');
    if (smmProductSelect) {
      smmProductSelect.innerHTML = '<option value="">Select a product...</option>';
      (mem.offerings?.products || []).forEach(p => {
        const pName = typeof p === 'string' ? p : p.name;
        if (pName) {
          const opt = document.createElement('option');
          opt.value = pName;
          opt.textContent = pName;
          smmProductSelect.appendChild(opt);
        }
      });
    }

    document.getElementById('details-toast').style.display = 'none';
  } catch (e) {
    console.error("Failed to load details:", e);
  }
}

window.saveProjectDetails = async function() {
  if (!window.activeProjectUrl) return;
  
  const updates = {
    businessIdentity: {
      officialName: document.getElementById('edit-name').value,
      industry: document.getElementById('edit-industry').value,
      subIndustry: document.getElementById('edit-subindustry').value,
      location: document.getElementById('edit-location').value,
      vision: document.getElementById('edit-vision').value,
      description: document.getElementById('edit-description').value
    },
    offerings: {
      products: document.getElementById('edit-products').value.split(',').map(s => s.trim()).filter(Boolean),
      services: document.getElementById('edit-services').value.split(',').map(s => s.trim()).filter(Boolean)
    },
    audience: {
      buyerPersonas: document.getElementById('edit-audience').value.split(',').map(s => s.trim()).filter(Boolean)
    }
  };

  try {
    const res = await fetch('/api/memory/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: window.activeProjectUrl, updates })
    });
    
    if (res.ok) {
      window.showSuccess("Memory successfully updated and saved!");
      const toast = document.getElementById('details-toast');
      if (toast) toast.style.display = 'none';
    }
  } catch (e) {
    console.error("Failed to save details:", e);
  }
};

window.deleteProjectDetails = async function() {
  if (!window.activeProjectUrl) return;
  if (!confirm("Are you sure you want to permanently delete this business analysis? This cannot be undone.")) return;

  try {
    const res = await fetch(`/api/memory?url=${encodeURIComponent(window.activeProjectUrl)}`, {
      method: 'DELETE'
    });
    
    if (res.ok) {
      window.showSuccess("Project deleted successfully!");
      window.activeProjectUrl = null;
      setTimeout(() => window.location.reload(), 1500); // Reload to fetch fresh project list
    } else {
      alert("Failed to delete project.");
    }
  } catch (e) {
    console.error("Failed to delete details:", e);
    alert("Error deleting project.");
  }
};

// ---- Run Intelligence ----
window.runIntelligence = async function() {
  const form = document.getElementById('business-form');
  const url = document.getElementById('website-url').value;
  if (!url) return;

  document.getElementById('loading-overlay').style.display = 'flex';
  
  const formData = new FormData(form);
  try {
    const res = await fetch('/api/analyze-stream', {
      method: 'POST',
      body: formData
    });
    
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      
      let lines = buffer.split('\\n\\n');
      buffer = lines.pop(); // Keep incomplete chunk
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'error') {
              throw new Error(data.error || 'Analysis failed');
            }
            if (data.type === 'complete') {
              window.showSuccess("Business intelligence fully analyzed!");
              
              // The backend normalizes the URL (e.g. adding https://). We must use the normalized one.
              const finalUrl = (data.profile && data.profile.input && data.profile.input.websiteUrl) ? data.profile.input.websiteUrl : url;
              
              // Reload projects and select the new one
              await loadProjects();
              document.getElementById('global-project').value = finalUrl;
              window.selectProject(finalUrl);
              return;
            }
          } catch(err) {
            console.error("SSE parse error", err);
          }
        }
      }
    }
  } catch (e) {
    alert("Error: " + e.message);
  } finally {
    document.getElementById('loading-overlay').style.display = 'none';
  }
};

// ---- Competitors ----
window.deleteSingleCompetitor = async function(compUrl) {
  if (!window.activeProjectUrl) return;
  if (!confirm("Remove this competitor from the list?")) return;

  try {
    const res = await fetch('/api/competitors/single', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: window.activeProjectUrl, compUrl })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    window.showSuccess("Competitor successfully removed!");
    // Refresh the list visually
    window.selectProject(window.activeProjectUrl);
  } catch (e) {
    alert("Error deleting competitor: " + e.message);
  }
};

window.findCompetitors = async function(force = false) {
  if (!window.activeProjectUrl) return;
  
  if (force) {
    if (!confirm("Are you sure you want to run a new deep crawl? This will overwrite your existing competitor list.")) return;
  }
  
  const list = document.getElementById('competitor-list');
  list.innerHTML = '<div class="spinner" style="margin: 20px auto;"></div><div style="text-align:center">Crawling competitor footprint... this will take 1-2 minutes.</div>';
  
  // Hide buttons while loading
  document.getElementById('btn-find-comp').style.display = 'none';
  document.getElementById('btn-regen-comp').style.display = 'none';
  
  const scope = document.getElementById('comp-scope').value;

  try {
    const res = await fetch('/api/competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: window.activeProjectUrl, scope })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    window.showSuccess("Competitors successfully extracted!");
    // data.competitors should be an array of objects
    loadCompetitorsUI();
  } catch (e) {
    list.innerHTML = `<div class="empty-state" style="color:var(--required)">Error: ${e.message}</div>`;
    document.getElementById('btn-find-comp').style.display = 'inline-block';
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
      document.getElementById('btn-find-comp').style.display = 'inline-block';
      document.getElementById('btn-regen-comp').style.display = 'none';
      return;
    }
    
    document.getElementById('btn-find-comp').style.display = 'none';
    document.getElementById('btn-regen-comp').style.display = 'inline-block';
    
    const localComps = data.competitors.filter(c => c.type === 'local');
    const globalComps = data.competitors.filter(c => c.type === 'global');
    
    const renderCard = (c) => {
      let href = c.url || '#';
      if (href !== '#' && !href.startsWith('http')) href = 'https://' + href;
      return `
      <div class="competitor-card">
        <div class="comp-info">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3><a href="${href}" target="_blank" style="color:var(--text);">${c.name}</a> <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:var(--surface); border:1px solid var(--border); margin-left:8px;">📍 ${c.location}</span></h3>
            <button onclick="window.deleteSingleCompetitor('${c.url}')" title="Remove competitor" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:16px;">🗑️</button>
          </div>
          ${(c.evidenceUrls && c.evidenceUrls.length > 0) ? `
          <div style="margin-top: 6px; font-size: 12px; display: flex; align-items: center; gap: 8px;">
            <span style="color: var(--text-muted);">🔗 Products:</span>
            <select onchange="if(this.value) window.open(this.value, '_blank')" style="flex: 1; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text);">
              <option value="">-- Select Product Page --</option>
              ${c.evidenceUrls.map(u => `<option value="${u.url.startsWith('http') ? u.url : 'https://' + u.url}">${u.title}</option>`).join('')}
            </select>
          </div>
          ` : ''}
          ${c.whyCompetitor ? `
          <div style="margin-top: 8px; font-size: 11.5px; color: var(--text-muted); background: var(--surface-hover); padding: 8px; border-radius: 6px; border: 1px solid var(--border); line-height: 1.4;">
            <strong style="color: var(--text);">Why a competitor:</strong> ${c.whyCompetitor}
          </div>
          ` : ''}
        </div>
        <div class="social-links">
          ${c.socials.linkedin ? `<a href="${c.socials.linkedin}" class="social-icon" target="_blank" title="LinkedIn">💼</a>` : ''}
          ${c.socials.instagram ? `<a href="${c.socials.instagram}" class="social-icon" target="_blank" title="Instagram">📸</a>` : ''}
          ${c.socials.facebook ? `<a href="${c.socials.facebook}" class="social-icon" target="_blank" title="Facebook">📘</a>` : ''}
          ${c.socials.twitter ? `<a href="${c.socials.twitter}" class="social-icon" target="_blank" title="X (Twitter)">𝕏</a>` : ''}
          ${c.socials.youtube ? `<a href="${c.socials.youtube}" class="social-icon" target="_blank" title="YouTube">▶️</a>` : ''}
        </div>
      </div>
    `;
    };
    
    let html = '';
    if (localComps.length > 0) {
      html += `<div style="grid-column: 1 / -1; margin-top:10px; margin-bottom:5px;"><h3 style="color:var(--text); font-weight:600; border-bottom:1px solid var(--border); padding-bottom:5px;">🌍 Local Competitors</h3></div>`;
      html += localComps.map(renderCard).join('');
    }
    if (globalComps.length > 0) {
      html += `<div style="grid-column: 1 / -1; margin-top:20px; margin-bottom:5px;"><h3 style="color:var(--text); font-weight:600; border-bottom:1px solid var(--border); padding-bottom:5px;">🌐 Global Leaders</h3></div>`;
      html += globalComps.map(renderCard).join('');
    }
    
    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Failed to load competitors.</div>';
    document.getElementById('btn-find-comp').style.display = 'inline-block';
    document.getElementById('btn-regen-comp').style.display = 'none';
  }
}

// ---- SMM ----
window.addManualCompetitor = async function() {
  if (!window.activeProjectUrl) return;
  
  const nameInput = document.getElementById('add-comp-name');
  const urlInput = document.getElementById('add-comp-url');
  
  const name = nameInput.value.trim();
  let url = urlInput.value.trim();
  
  if (!name || !url) {
    alert('Please provide both a Name and URL.');
    return;
  }
  
  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }
  
  const btn = document.getElementById('btn-add-comp');
  btn.disabled = true;
  btn.innerText = 'Scraping...';
  
  try {
    const res = await fetch('/api/competitors/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        websiteUrl: window.activeProjectUrl,
        compName: name,
        compUrl: url
      })
    });
    
    if (res.ok) {
      nameInput.value = '';
      urlInput.value = '';
      window.showSuccess('Competitor added and socials scraped!');
      loadCompetitorsUI();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to add competitor');
    }
  } catch (error) {
    alert('Failed to add competitor');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Add';
  }
};

window.generateSMM = async function() {
  if (!window.activeProjectUrl) return;
  
  const strategy = document.querySelector('input[name="smmStrategy"]:checked').value;
  const theme = document.getElementById('smm-theme').value;
  const targetProduct = document.getElementById('smm-product').value;
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
        strategy: strategy,
        theme: theme,
        targetProduct: targetProduct
      })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    window.showSuccess("SMM content generated successfully!");
    // Use marked for markdown formatting if available
    const joined = data.posts.join('\\n\\n---\\n\\n');
    textDiv.innerHTML = window.marked ? window.marked.parse(joined) : joined;
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
    
    window.showSuccess("SEO strategy generated successfully!");
    textDiv.innerHTML = window.marked ? window.marked.parse(data.report) : data.report.replace(/\n/g, '<br>');
  } catch (e) {
    textDiv.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
  }
};

// ---- CRON FEED ----
window.triggerCron = async function() {
  if (!window.activeProjectUrl) return;
  const list = document.getElementById('feed-list');
  list.innerHTML = '<div class="spinner" style="margin: 20px auto;"></div><div style="text-align:center">Running deep social crawl across competitors. This can take several minutes...</div>';
  
  try {
    const res = await fetch(`/api/cron/run?url=${encodeURIComponent(window.activeProjectUrl)}`, { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    window.showSuccess("Tracker completed successfully!");
    // Display a clear success message for 1.5 seconds before rendering the final feed
    list.innerHTML = '<div style="text-align:center; padding: 40px; color: #4ade80; font-size: 1.2rem; font-weight: 500;">✅ Tracker completed successfully! Loading dashboard...</div>';
    
    setTimeout(() => {
        loadFeedUI();
    }, 1500);
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
      list.innerHTML = '<div class="empty-state">No recent posts found. These competitors may not be very active on social media.</div>';
      return;
    }
    
    // Group posts by platform
    const grouped = {};
    for (const post of data.feed) {
      const platformKey = (post.platform === 'Facebook' || post.platform === 'Instagram') ? 'FB/Insta' : post.platform;
      if (!grouped[platformKey]) grouped[platformKey] = [];
      grouped[platformKey].push(post);
    }
    
    // Sort platforms by custom order: YouTube, FB/Insta, LinkedIn
    const orderPriority = { 'YouTube': 1, 'FB/Insta': 2, 'LinkedIn': 3 };
    const sortedPlatforms = Object.keys(grouped).sort((a, b) => {
       const orderA = orderPriority[a] || 99;
       const orderB = orderPriority[b] || 99;
       return orderA - orderB;
    });

    let html = `
      <style>
        .responsive-feed-container {
           display: flex; flex-direction: row; align-items: flex-start; gap: 24px; width: 100%; min-width: 0;
        }
        .responsive-feed-label {
           flex: 0 0 150px; padding-top: 24px;
        }
        .responsive-feed-cards {
           flex: 1; border: 2px solid var(--border); border-radius: var(--radius-xl); padding: 24px; background: var(--surface-hover); display: flex; flex-direction: row; gap: 16px; overflow-x: auto; min-width: 0; max-width: 100%;
        }
        @media (max-width: 1400px) {
           .responsive-feed-container {
              flex-direction: column !important;
              gap: 12px !important;
           }
           .responsive-feed-label {
              flex: 0 0 auto !important;
              width: 100% !important;
              padding-top: 0 !important;
           }
           .responsive-feed-cards {
              width: 100% !important;
           }
        }
      </style>
      <div style="display: flex; flex-direction: column; gap: 32px; padding-bottom: 24px; width: 100%; min-width: 0; max-width: 100%; overflow: hidden;">
    `;
    
    if (!document.getElementById('media-lightbox')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="media-lightbox" onclick="if(event.target === this) this.style.display='none'" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15, 23, 42, 0.95); z-index:999999; justify-content:center; align-items:center; flex-direction:column; backdrop-filter: blur(4px);">
          <div style="position:absolute; top:20px; right:30px; color:white; font-size:36px; cursor:pointer; font-weight: 300; line-height: 1;" onclick="document.getElementById('media-lightbox').style.display='none'">&times;</div>
          <div id="media-lightbox-content" style="max-width:90%; max-height:90%; display:flex; justify-content:center; align-items:center;"></div>
        </div>
      `);
      
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          const lb = document.getElementById('media-lightbox');
          if (lb && lb.style.display === 'flex') lb.style.display = 'none';
        }
      });
      
      window.openLightbox = function(url, isVideo, postLink, platform, mediaType) {
        const lb = document.getElementById('media-lightbox');
        const content = document.getElementById('media-lightbox-content');
        
        if (platform === 'Instagram' && mediaType === 'Video' && postLink) {
            let embedLink = postLink.split('?')[0];
            if (!embedLink.endsWith('/')) embedLink += '/';
            embedLink += 'embed';
            content.innerHTML = `<iframe src="${embedLink}" width="400" height="500" frameborder="0" scrolling="no" allowtransparency="true" style="border-radius:12px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); background: white;"></iframe>`;
        } else if (platform === 'Facebook' && mediaType === 'Video' && postLink) {
            let embedLink = "https://www.facebook.com/plugins/video.php?href=" + encodeURIComponent(postLink) + "&show_text=false&width=400";
            content.innerHTML = `<iframe src="${embedLink}" width="400" height="500" style="border:none;overflow:hidden;border-radius:12px;box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); background: white;" scrolling="no" frameborder="0" allowfullscreen="true" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"></iframe>`;
        } else if (isVideo) {
          content.innerHTML = `<video src="${url}" controls autoplay style="max-width:100vw; max-height:85vh; border-radius:12px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);"></video>`;
        } else {
          content.innerHTML = `<img src="${url}" style="max-width:100vw; max-height:85vh; border-radius:12px; object-fit:contain; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);" />`;
        }
        lb.style.display = 'flex';
      };
    }

    
    for (const platform of sortedPlatforms) {
      const posts = grouped[platform];
      html += `
        <div class="responsive-feed-container">
          
          <div class="responsive-feed-label">
            <h3 style="font-size: 1.4rem; font-weight: 700; color: var(--text); margin: 0;">${platform}</h3>
          </div>
          
          <div class="responsive-feed-cards">
            ${posts.map(post => `
              <div class="feed-item" style="background: var(--surface); padding: 16px; border-radius: var(--radius-md); border: 1px solid var(--border); width: 300px; flex-shrink: 0; display: flex; flex-direction: column; max-height: 400px;">
                <div class="feed-header" style="margin-bottom: 12px;">
                  <span class="feed-author" style="font-weight: 600; color: var(--text); display: block;">${post.competitorName}</span>
                  <span class="feed-meta" style="font-size: 0.85rem; color: var(--text-muted);">${post.date}</span>
                </div>
                ${(post.platform === 'YouTube' && post.link && post.link.match(/v=([^&]+)/)) ? `
                <div style="margin: 0 0 12px 0; width: 100%; height: 180px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: var(--background); flex-shrink: 0;">
                  <iframe width="100%" height="100%" src="https://www.youtube.com/embed/${post.link.match(/v=([^&]+)/)[1]}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                </div>
                ` : (post.mediaUrl && !post.mediaUrl.startsWith('data:') ? `
                <div onclick="window.openLightbox('${post.mediaUrl.split(',')[0].trim()}', ${post.mediaUrl.includes('mp4') || post.mediaUrl.includes('webm')}, '${post.link}', '${post.platform}', '${post.mediaType}')" style="margin: 0 0 12px 0; width: 100%; height: 180px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: var(--background); flex-shrink: 0; position: relative; cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='var(--shadow-md)'" onmouseout="this.style.transform='none'; this.style.boxShadow='none'">
                  ${post.mediaUrl.includes('mp4') || post.mediaUrl.includes('webm') ? `
                  <video src="${post.mediaUrl.split(',')[0].trim()}" controls style="width: 100%; height: 100%; object-fit: cover; display: block;"></video>
                  ` : `
                  <img src="${post.mediaUrl.split(',')[0].trim()}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none'; this.parentElement.style.display='none';" />
                  ${post.mediaType === 'Video' ? '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:48px;height:48px;background:rgba(0,0,0,0.6);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:24px;pointer-events:none;border:2px solid rgba(255,255,255,0.8);">▶</div>' : ''}
                  `}
                </div>
                ` : '')}
                <div class="feed-text" style="white-space: pre-wrap; font-size: 0.95rem; overflow-y: auto; flex: 1;">${post.content}</div>
                ${post.link ? `<a href="${post.link}" onclick="window.open(this.href, '_blank'); window.focus(); return false;" style="display:inline-block;margin-top:12px;font-size:12px;font-weight:600;color:var(--primary);text-decoration:none; flex-shrink: 0;">View Original Post ↗</a>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    html += '</div>';
    
    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Failed to load social feed.</div>';
  }
}
