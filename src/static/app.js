window.activeProjectUrl = null;

window.getYouTubeId = function(link) {
  if (!link || typeof link !== 'string') return null;
  var match = link.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
};

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
document.addEventListener('DOMContentLoaded', async () => {
  // Check and apply theme on load
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = '☀️';
  }

  await loadProjects();
  window.restoreActiveTab();
  setTimeout(initializeCustomSelects, 100);
});

function initializeCustomSelects() {
  const SEARCH_THRESHOLD = 8;

  const selects = document.querySelectorAll('select:not(.replaced)');
  selects.forEach(select => {
    if (select.nextElementSibling && select.nextElementSibling.classList.contains('custom-select-wrapper')) return;
    
    select.classList.add('replaced');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    
    const trigger = document.createElement('div');
    trigger.className = 'custom-select-trigger';
    
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-select-options';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'custom-select-search';
    searchInput.placeholder = 'Search...';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;
    searchInput.addEventListener('click', (e) => e.stopPropagation());
    searchInput.addEventListener('keydown', (e) => e.stopPropagation());

    let filterText = '';
    
    const applyFilter = () => {
      const options = optionsContainer.querySelectorAll('.custom-option');
      let visibleCount = 0;
      options.forEach(opt => {
        const match = !filterText || (opt.textContent || '').toLowerCase().includes(filterText);
        opt.style.display = match ? '' : 'none';
        if (match) visibleCount++;
      });
      const empty = optionsContainer.querySelector('.custom-select-empty');
      if (empty) empty.style.display = visibleCount === 0 ? '' : 'none';
    };

    searchInput.addEventListener('input', () => {
      filterText = searchInput.value.trim().toLowerCase();
      applyFilter();
    });

    const optionCount = () => Array.from(select.options).filter(opt => opt.style.display !== 'none').length;

    const updateOptions = () => {
       optionsContainer.innerHTML = '';
       filterText = '';
       let activeVal = select.value || window.activeProjectUrl;
       let selectedOpt = Array.from(select.options).find(o => o.value === activeVal) ||
         (select.options.length > 0 && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null);
       let selectedText = selectedOpt ? selectedOpt.text : 'Select...';
       trigger.innerHTML = `<span>${selectedText}</span> <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

       const total = optionCount();
       if (total > SEARCH_THRESHOLD) {
         optionsContainer.appendChild(searchInput);
       }

       Array.from(select.options).forEach(opt => {
          if (opt.style.display === 'none') return;
          const optionDiv = document.createElement('div');
          optionDiv.className = 'custom-option';
          if (opt.value === activeVal || opt.selected) optionDiv.classList.add('selected');
          optionDiv.textContent = opt.text;
          optionDiv.addEventListener('click', (e) => {
             e.stopPropagation();
             select.value = opt.value;
             if (select.id === 'global-project' || select.id === 'project-select') {
               window.selectProject(opt.value, true);
             }
             select.dispatchEvent(new Event('change', { bubbles: true }));
             wrapper.classList.remove('open');
             updateOptions();
          });
          optionsContainer.appendChild(optionDiv);
       });

       if (total > SEARCH_THRESHOLD) {
         const empty = document.createElement('div');
         empty.className = 'custom-select-empty';
         empty.textContent = 'No matching options';
         empty.style.display = 'none';
         optionsContainer.appendChild(empty);
       }
    };
    
    updateOptions();
    
    const positionDropdown = () => {
      wrapper.classList.remove('open-up');
      if (!wrapper.classList.contains('open')) return;
      const rect = wrapper.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const height = Math.min(250, optionsContainer.scrollHeight || 250);
      if (spaceBelow < height + 8) wrapper.classList.add('open-up');
    };

    trigger.addEventListener('click', (e) => {
       e.stopPropagation();
       document.querySelectorAll('.custom-select-wrapper').forEach(w => {
          if (w !== wrapper) w.classList.remove('open');
       });
       wrapper.classList.toggle('open');
       if (wrapper.classList.contains('open')) {
         setTimeout(() => { searchInput.value = ''; filterText = ''; applyFilter(); }, 0);
         positionDropdown();
       }
    });
    
    wrapper.appendChild(trigger);
    wrapper.appendChild(optionsContainer);
    select.parentNode.insertBefore(wrapper, select.nextSibling);
    
    select.addEventListener('change', () => updateOptions());
    select.addEventListener('optionsUpdated', () => updateOptions());
    select.addEventListener('focus', () => { wrapper.classList.add('open'); positionDropdown(); });
    
    const observer = new MutationObserver(() => {
      updateOptions();
      positionDropdown();
    });
    observer.observe(select, { childList: true, attributes: true, subtree: true });

    window.addEventListener('resize', positionDropdown);
  });
  
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select-wrapper')) {
       document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
    }
  });
}

// Theme Toggle
window.toggleTheme = () => {
  document.body.classList.toggle('dark-theme');
  const isDark = document.body.classList.contains('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
};

const TAB_TITLES = {
  'analyse': 'New Analysis',
  'details': 'Project Details & Review',
  'competitors': 'Competitor Intelligence',
  'smm': 'SMM Generation',
  'seo': 'Website & SEO',
  'social-feed': 'Competitor Feed'
};

window.restoreActiveTab = function() {
  const hash = window.location.hash ? window.location.hash.replace('#', '') : null;
  const savedTab = hash || localStorage.getItem('activeTab') || 'analyse';
  const savedTitle = localStorage.getItem('activeTabTitle') || TAB_TITLES[savedTab] || 'New Analysis';

  const navEl = document.getElementById('nav-' + savedTab);
  if (!navEl || (savedTab !== 'analyse' && navEl.classList.contains('disabled'))) {
    window.switchTab('analyse', 'New Analysis');
  } else {
    window.switchTab(savedTab, savedTitle);
  }
};

// ---- Tab Switching ----
window.switchTab = function(name, title) {
  const navEl = document.getElementById('nav-' + name);
  if (navEl && navEl.classList.contains('disabled')) return;

  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
  
  const panelEl = document.getElementById('panel-' + name);
  if (panelEl) panelEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.innerText = title;

  localStorage.setItem('activeTab', name);
  localStorage.setItem('activeTabTitle', title);
  if (window.location.hash !== '#' + name) {
    history.replaceState(null, '', '#' + name);
  }

  if (name === 'details') loadProjectDetails();
  if (name === 'competitors') loadCompetitorsUI();
  if (name === 'social-feed') loadFeedUI();
  if (name === 'smm') { if (window.loadSmmUI) window.loadSmmUI(); }
};

// ---- Projects ----
window.addOrUpdateProjectInSidebar = function(url, name) {
  if (!url) return;
  const select = document.getElementById('global-project');
  if (!select) return;

  const currentOptions = Array.from(select.options);
  let existing = currentOptions.find(o => o.value === url || o.value.replace(/\/$/, '') === url.replace(/\/$/, ''));
  
  if (existing) {
    if (name && name !== url && existing.text !== name) {
      existing.text = name;
      select.dispatchEvent(new CustomEvent('optionsUpdated'));
    }
  } else {
    if (select.options.length === 1 && select.options[0].disabled) {
      select.innerHTML = '<option value="">-- Select a Project --</option>';
    }
    const opt = document.createElement('option');
    opt.value = url;
    opt.text = name || url;
    select.appendChild(opt);
    select.dispatchEvent(new CustomEvent('optionsUpdated'));
  }

  if (select.value !== url) {
    select.value = url;
  }
  window.selectProject(url, false);
};

window.loadProjects = async function(isSilent = false) {
  try {
    const res = await fetch('/api/sites');
    const sites = await res.json();
    const select = document.getElementById('global-project');
    if (!select) return;

    const currentVal = window.activeProjectUrl || localStorage.getItem('activeProjectUrl') || select.value;

    const siteMap = new Map();
    sites.forEach(s => siteMap.set(s.url, s.name));

    if (currentVal && !siteMap.has(currentVal)) {
      const activeOpt = Array.from(select.options).find(o => o.value === currentVal);
      siteMap.set(currentVal, activeOpt ? activeOpt.text : currentVal);
    }

    const existingOptions = Array.from(select.options).filter(o => o.value !== "");
    const isSameList = existingOptions.length === siteMap.size &&
      existingOptions.every(o => siteMap.has(o.value) && siteMap.get(o.value) === o.text);

    if (!isSameList) {
      const frag = document.createDocumentFragment();
      const defaultOpt = document.createElement('option');
      defaultOpt.value = "";
      defaultOpt.text = siteMap.size === 0 ? "No projects found" : "-- Select a Project --";
      if (siteMap.size === 0) defaultOpt.disabled = true;
      frag.appendChild(defaultOpt);

      siteMap.forEach((name, u) => {
        const opt = document.createElement('option');
        opt.value = u;
        opt.text = name;
        if (u === currentVal) opt.selected = true;
        frag.appendChild(opt);
      });

      const oldOnChange = select.onchange;
      select.onchange = null;
      select.innerHTML = '';
      select.appendChild(frag);
      select.value = currentVal || "";
      select.onchange = oldOnChange;

      select.dispatchEvent(new CustomEvent('optionsUpdated'));
    } else {
      if (currentVal && select.value !== currentVal) {
        select.value = currentVal;
      }
    }

    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
      if (!isSilent) {
        window.selectProject(currentVal, false);
      }
    }
  } catch (err) {
    console.error("Failed to load projects:", err);
  }
};

window.selectProject = function(url, autoSwitchTab = false) {
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

  if (autoSwitchTab) {
    switchTab('details', 'Project Details & Review');
  }
};

// ---- Live Synchronization Engine ----
let _liveSyncInterval = null;
function startLiveSync() {
  if (_liveSyncInterval) clearInterval(_liveSyncInterval);
  _liveSyncInterval = setInterval(async () => {
    // Keep sidebar projects dropdown synced live
    await window.loadProjects(true);

    if (!window.activeProjectUrl) return;
    try {
      const res = await fetch(`/api/memory?url=${encodeURIComponent(window.activeProjectUrl)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.memory) return;
      
      const newMem = data.memory;
      const oldMem = window.projectMemory;
      
      const compCountChanged = (newMem.competitors?.length || 0) !== (oldMem?.competitors?.length || 0);
      const feedCountChanged = (newMem.socialFeed?.length || 0) !== (oldMem?.socialFeed?.length || 0);
      
      window.projectMemory = newMem;
      
      const activeTab = localStorage.getItem('activeTab');
      if (compCountChanged && activeTab === 'competitors' && !window._isFindingCompetitors) {
        loadCompetitorsUI();
      }
      if (feedCountChanged && activeTab === 'social-feed') {
        loadFeedUI();
      }
    } catch (e) {
      console.debug("Live sync ping error:", e);
    }
  }, 5000);
}

// ---- Project Details & Review ----
document.addEventListener('DOMContentLoaded', () => {
  startLiveSync();

  const smmThemeSelect = document.getElementById('smm-theme');
  if (smmThemeSelect) {
    smmThemeSelect.addEventListener('change', () => {
      if (window.updateSmmSuboptions) window.updateSmmSuboptions();
    });
  }

  // Strategy Radio Listeners
  const strategyRadios = document.querySelectorAll('input[name="smmStrategy"]');
  const newOpts = document.getElementById('smm-new-options-container');
  const mirrorOpts = document.getElementById('smm-mirror-container');
  const indOpts = document.getElementById('smm-industry-options-container');
  
  strategyRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const val = e.target.value;
      
      if (newOpts) newOpts.style.display = (val === 'new') ? 'flex' : 'none';
      if (mirrorOpts) mirrorOpts.style.display = (val === 'mirror') ? 'flex' : 'none';
      if (indOpts) indOpts.style.display = (val === 'industry') ? 'flex' : 'none';
      
      if (val === 'mirror' && window.populateMirrorCompetitors) window.populateMirrorCompetitors();
    });
  });

  const mirrorCompetitorSelect = document.getElementById('smm-mirror-competitor');
  if (mirrorCompetitorSelect) {
    mirrorCompetitorSelect.addEventListener('change', (e) => {
      if (window.populateMirrorPosts) window.populateMirrorPosts(e.target.value);
    });
  }

  const smmTypeSelect = document.getElementById('smm-type');
  const smmTotalContainer = document.getElementById('smm-total-container');
  if (smmTypeSelect && smmTotalContainer) {
    // Initial state (default is image)
    if (smmTypeSelect.value === 'image') {
      smmTotalContainer.style.display = 'none';
    }
    smmTypeSelect.addEventListener('change', (e) => {
      smmTotalContainer.style.display = e.target.value === 'video' ? 'block' : 'none';
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
    window.projectMemory = mem; // Save globally for UI updates
    
    document.getElementById('edit-name').value = mem.businessIdentity?.officialName || '';
    document.getElementById('edit-industry').value = mem.businessIdentity?.industry || '';
    document.getElementById('edit-subindustry').value = mem.businessIdentity?.subIndustry || '';
    document.getElementById('edit-location').value = mem.businessIdentity?.location || '';
    document.getElementById('edit-vision').value = mem.businessIdentity?.vision || '';
    document.getElementById('edit-description').value = mem.businessIdentity?.description || '';
    
    document.getElementById('edit-products').value = (mem.offerings?.products || []).map(p => typeof p === 'string' ? p : p.name).join(', ');
    document.getElementById('edit-services').value = (mem.offerings?.services || []).map(s => typeof s === 'string' ? s : s.name).join(', ');
    document.getElementById('edit-audience').value = (mem.audience?.buyerPersonas || []).join(', ');
    
    // Initialize Dynamic SMM UI
    if (window.updateSmmSuboptions) window.updateSmmSuboptions();
    
    // If Mirror Strategy is selected by default, populate competitors
    const activeStrategy = document.querySelector('input[name="smmStrategy"]:checked');
    if (activeStrategy && activeStrategy.value === 'mirror') {
      if (window.populateMirrorCompetitors) window.populateMirrorCompetitors();
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

  // Immediately register and select new project in sidebar dropdown
  window.addOrUpdateProjectInSidebar(url, url);

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
      
      let lines = buffer.split('\n\n');
      buffer = lines.pop(); // Keep incomplete chunk
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'error') {
              throw new Error(data.error || 'Analysis failed');
            }
            if (data.type === 'progress') {
              const statusEl = document.getElementById('agent-status');
              if (statusEl) {
                statusEl.innerText = data.step || data.message || 'Processing...';
                // Trigger a quick pulse animation to show it updated
                statusEl.style.animation = 'none';
                void statusEl.offsetWidth; // trigger reflow
                statusEl.style.animation = 'pulse 1s ease';
              }
              if (data.partial) {
                if (data.partial.businessIdentity) {
                  const id = data.partial.businessIdentity;
                  if (id.officialName) {
                    window.addOrUpdateProjectInSidebar(url, id.officialName);
                  }
                  if (document.getElementById('edit-name')) document.getElementById('edit-name').value = id.officialName || '';
                  if (document.getElementById('edit-industry')) document.getElementById('edit-industry').value = id.industry || '';
                  if (document.getElementById('edit-subindustry')) document.getElementById('edit-subindustry').value = id.subIndustry || '';
                  if (document.getElementById('edit-location')) document.getElementById('edit-location').value = id.location || '';
                  if (document.getElementById('edit-vision')) document.getElementById('edit-vision').value = id.vision || '';
                  if (document.getElementById('edit-description')) document.getElementById('edit-description').value = id.description || '';
                }
                if (data.partial.offerings) {
                  const off = data.partial.offerings;
                  if (document.getElementById('edit-products') && off.products) {
                    document.getElementById('edit-products').value = off.products.map(p => typeof p === 'string' ? p : p.name).join(', ');
                  }
                  if (document.getElementById('edit-services') && off.services) {
                    document.getElementById('edit-services').value = off.services.map(s => typeof s === 'string' ? s : s.name).join(', ');
                  }
                }
                if (data.partial.audience) {
                  const aud = data.partial.audience;
                  if (document.getElementById('edit-audience') && aud.buyerPersonas) {
                    document.getElementById('edit-audience').value = aud.buyerPersonas.join(', ');
                  }
                }
              }
            }
            if (data.type === 'complete') {
              window.showSuccess("Business intelligence fully analyzed!");
              
              // The backend normalizes the URL (e.g. adding https://). We must use the normalized one.
              const finalUrl = (data.profile && data.profile.input && data.profile.input.websiteUrl) ? data.profile.input.websiteUrl : url;
              
              // Reload projects and select the new one
              await loadProjects();
              document.getElementById('global-project').value = finalUrl;
              window.selectProject(finalUrl, false);
              switchTab('details', 'Project Details & Review');
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
    // Refresh the list visually without changing tabs
    loadCompetitorsUI();
  } catch (e) {
    alert("Error deleting competitor: " + e.message);
  }
};

window.findCompetitors = async function(force = false) {
  if (!window.activeProjectUrl) return;
  
  if (force) {
    if (!confirm("Are you sure you want to run a new deep crawl? This will overwrite your existing competitor list.")) return;
  }

  window._isFindingCompetitors = true;
  
  const list = document.getElementById('competitor-list');
  list.innerHTML = `
    <div id="live-comp-header" style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; text-align: center; background: var(--surface); border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 20px;">
      <div class="spinner" style="width: 48px; height: 48px; border-width: 4px; margin-bottom: 16px;"></div>
      <h3 style="font-size: 1.3rem; margin-bottom: 12px; color: var(--text);">Live Scanning Competitor Footprint...</h3>
      <div id="comp-agent-status" style="color: var(--primary); font-size: 14px; font-weight: 600; background: rgba(99, 102, 241, 0.1); padding: 8px 24px; border-radius: 20px;">Initializing live search protocols...</div>
    </div>
    <div id="live-comp-cards" style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 16px;"></div>
  `;
  
  // Hide buttons while loading
  document.getElementById('btn-find-comp').style.display = 'none';
  document.getElementById('btn-regen-comp').style.display = 'none';
  
  const scope = document.getElementById('comp-scope').value;

  try {
    const res = await fetch('/api/competitors-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: window.activeProjectUrl, scope })
    });

    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      
      let lines = buffer.split('\n\n');
      buffer = lines.pop(); // Keep incomplete chunk
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'error') {
              throw new Error(data.error || 'Competitor stream failed');
            }
            if (data.type === 'progress') {
              const statusEl = document.getElementById('comp-agent-status');
              if (statusEl && data.status) statusEl.innerText = data.status;
            }
            if (data.type === 'competitor' && data.competitor) {
              const statusEl = document.getElementById('comp-agent-status');
              if (statusEl) statusEl.innerText = data.status || `Found competitor: ${data.competitor.name}`;
              await loadCompetitorsUI(true);
            }
            if (data.type === 'complete') {
              window.showSuccess("Competitors successfully extracted!");
              window._isFindingCompetitors = false;
              await loadCompetitorsUI(false);
              return;
            }
          } catch(err) {
            console.error("Competitor SSE parse error", err);
          }
        }
      }
    }
  } catch (e) {
    list.innerHTML = `<div class="empty-state" style="color:var(--required)">Error: ${e.message}</div>`;
    document.getElementById('btn-find-comp').style.display = 'inline-block';
  } finally {
    window._isFindingCompetitors = false;
  }
};

window.backfillCompetitorSocials = async function() {
  if (!window.activeProjectUrl) return;
  const list = document.getElementById('competitor-list');
  const btn = document.getElementById('btn-backfill-socials');
  if (btn) { btn.disabled = true; btn.innerText = 'Fixing...'; }

  try {
    const res = await fetch('/api/competitors/backfill-socials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: window.activeProjectUrl })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    window.showSuccess("Competitor social links updated!");
    loadCompetitorsUI();
  } catch (e) {
    alert("Error updating socials: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = 'Fix Missing Socials'; }
  }
};

async function loadCompetitorsUI(isLivePartial = false) {
  if (!window.activeProjectUrl) return;
  const list = document.getElementById('competitor-list');
  
  try {
    const res = await fetch(`/api/competitors?url=${encodeURIComponent(window.activeProjectUrl)}`);
    const data = await res.json();
    
    if (!data.competitors || data.competitors.length === 0) {
      if (window._isFindingCompetitors || isLivePartial) {
        return;
      }
      list.innerHTML = '<div class="empty-state">No competitors mapped yet. Click "Find Competitors" above.</div>';
      document.getElementById('btn-find-comp').style.display = 'inline-block';
      document.getElementById('btn-regen-comp').style.display = 'none';
      document.getElementById('btn-backfill-socials').style.display = 'none';
      return;
    }
    
    document.getElementById('btn-find-comp').style.display = 'none';
    document.getElementById('btn-regen-comp').style.display = 'inline-block';
    document.getElementById('btn-backfill-socials').style.display = 'inline-block';
    
    const localComps = data.competitors.filter(c => c.type === 'local');
    const regionalComps = data.competitors.filter(c => c.type === 'regional');
    const globalComps = data.competitors.filter(c => c.type === 'global');
    
    const extractCommonProducts = (c) => {
      let rawList = [];
      if (Array.isArray(c.commonProducts) && c.commonProducts.length > 0) rawList = c.commonProducts;
      else if (Array.isArray(c.products) && c.products.length > 0) rawList = c.products;
      else if (c.whyCompetitor) {
        const match = c.whyCompetitor.match(/\b\d+\s+common products:\s*\[([^\]]+)\]/i);
        if (match && match[1]) {
          rawList = match[1].split(',').map(s => s.trim().replace(/\.\.\.$/, '')).filter(Boolean);
        }
      }
      const invalid = new Set(["industries", "industries served", "engineering", "national", "international", "global", "manufacturing", "technology", "solutions", "services", "overview", "company", "home", "about", "contact", "careers", "news", "media", "blog", "general", "n/a", "none", "rating", "phone"]);
      const seen = new Set();
      const clean = [];
      for (const item of rawList) {
        if (!item || typeof item !== 'string') continue;
        const trimmed = item.trim();
        const lower = trimmed.toLowerCase();
        if (invalid.has(lower) || trimmed.length < 3) continue;
        const norm = lower.replace(/[^\w\s]/g, '').replace(/s$/i, '').trim();
        if (!seen.has(norm)) {
          seen.add(norm);
          clean.push(trimmed);
        }
      }
      return clean;
    };

    const renderCard = (c) => {
      let href = c.url || '#';
      if (href !== '#' && !href.startsWith('http')) href = 'https://' + href;
      const commonProds = extractCommonProducts(c);

      return `
      <div class="competitor-card" style="${c.isDeadAccount ? 'opacity: 0.7; filter: grayscale(0.5);' : ''} padding: 24px; background: var(--surface); border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); transition: transform 0.2s ease, box-shadow 0.2s ease; margin-bottom: 16px; display: flex; flex-direction: column; gap: 16px;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 10px 15px -3px rgba(0, 0, 0, 0.2)'" onmouseout="this.style.transform='none'; this.style.boxShadow='0 4px 6px -1px rgba(0, 0, 0, 0.1)'">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <h3 style="margin: 0; font-size: 1.25rem;">
            <a href="${href}" target="_blank" style="color:var(--text); text-decoration: none; font-weight: 700;">${c.name}</a> 
            <span style="font-size:0.75rem; padding:4px 8px; border-radius:20px; background:var(--background); border:1px solid var(--border); margin-left:12px; display:inline-block; vertical-align:middle; color: var(--text-muted);">📍 ${c.location}</span>
            ${c.isDeadAccount ? `<span style="font-size:0.7rem; padding:4px 8px; border-radius:20px; background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); color:#ef4444; margin-left:8px; display:inline-block; vertical-align:middle; font-weight: bold; letter-spacing: 0.05em;">DEAD ACCOUNT</span>` : ''}
          </h3>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="social-links" style="display: flex; gap: 8px; margin: 0;">
              ${c.socials?.linkedin ? `<a href="${c.socials.linkedin}" target="_blank" title="LinkedIn" style="display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:rgba(10, 102, 194, 0.1); color:#0a66c2; text-decoration:none; font-size:14px; transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">💼</a>` : ''}
              ${c.socials?.instagram ? `<a href="${c.socials.instagram}" target="_blank" title="Instagram" style="display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:rgba(225, 48, 108, 0.1); color:#e1306c; text-decoration:none; font-size:14px; transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">📸</a>` : ''}
              ${c.socials?.facebook ? `<a href="${c.socials.facebook}" target="_blank" title="Facebook" style="display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:rgba(24, 119, 242, 0.1); color:#1877f2; text-decoration:none; font-size:14px; transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">📘</a>` : ''}
              ${c.socials?.twitter ? `<a href="${c.socials.twitter}" target="_blank" title="X (Twitter)" style="display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:rgba(255, 255, 255, 0.1); color:#fff; text-decoration:none; font-size:14px; transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">𝕏</a>` : ''}
              ${c.socials?.youtube ? `<a href="${c.socials.youtube}" target="_blank" title="YouTube" style="display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:rgba(255, 0, 0, 0.1); color:#ff0000; text-decoration:none; font-size:14px; transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">▶️</a>` : ''}
            </div>
            <button onclick="window.deleteSingleCompetitor('${c.url}')" title="Remove competitor" style="background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239,68,68,0.2); color:#ef4444; cursor:pointer; padding:6px; border-radius:8px; display:flex; align-items:center; justify-content:center; transition: all 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.15)'" onmouseout="this.style.background='rgba(239,68,68,0.05)'">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,0.15); padding: 14px 16px; border-radius: 12px; border: 1px solid var(--border);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <span style="color: #818cf8; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
              📦 Common Products (${commonProds.length})
            </span>
            ${(c.evidenceUrls && c.evidenceUrls.length > 0) ? `
              <div style="font-size: 12px; display: flex; align-items: center; gap: 6px;">
                <select class="replaced" onchange="if(this.value) window.open(this.value, '_blank')" style="padding: 4px 8px; font-size: 11px; border-radius: 6px; border: 1px solid var(--border); background: var(--background); color: var(--text); outline: none; cursor: pointer;">
                  <option value="">Product Pages...</option>
                  ${c.evidenceUrls.filter(u => u.url).map(u => `<option value="${u.url.startsWith('http') ? u.url : 'https://' + u.url}">${u.title}</option>`).join('')}
                </select>
              </div>
            ` : ''}
          </div>

          <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;">
            ${commonProds.length > 0 
              ? commonProds.map(p => `<span style="background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.3); color: #a5b4fc; padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">🏷️ ${p}</span>`).join('') 
              : `<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">No specific product matches recorded</span>`
            }
          </div>
        </div>

        ${c.whyCompetitor ? `
        <div style="font-size: 13px; color: var(--text-muted); background: var(--background); padding: 14px 16px; border-radius: 12px; border: 1px solid var(--border); line-height: 1.6; margin: 0;">
          <strong style="color: var(--primary); text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; display: block; margin-bottom: 6px;">Strategic Intelligence</strong> 
          ${c.whyCompetitor}
        </div>
        ` : ''}
      </div>
    `;
    };
    
    let html = '';
    if (localComps.length > 0) {
      html += `<div style="grid-column: 1 / -1; margin-top:10px; margin-bottom:5px;"><h3 style="color:var(--text); font-weight:600; border-bottom:1px solid var(--border); padding-bottom:5px;">🌍 Local Competitors</h3></div>`;
      html += localComps.map(renderCard).join('');
    }
    if (regionalComps.length > 0) {
      html += `<div style="grid-column: 1 / -1; margin-top:20px; margin-bottom:5px;"><h3 style="color:var(--text); font-weight:600; border-bottom:1px solid var(--border); padding-bottom:5px;">🏭 Regional & National Competitors</h3></div>`;
      html += regionalComps.map(renderCard).join('');
    }
    if (globalComps.length > 0) {
      html += `<div style="grid-column: 1 / -1; margin-top:20px; margin-bottom:5px;"><h3 style="color:var(--text); font-weight:600; border-bottom:1px solid var(--border); padding-bottom:5px;">🌐 Global Leaders</h3></div>`;
      html += globalComps.map(renderCard).join('');
    }
    
    if (window._isFindingCompetitors || isLivePartial) {
      const liveCardsContainer = document.getElementById('live-comp-cards');
      if (liveCardsContainer) {
        liveCardsContainer.innerHTML = html;
        return;
      }
    }

    list.innerHTML = html;
  } catch (e) {
    if (!window._isFindingCompetitors) {
      list.innerHTML = '<div class="empty-state">Failed to load competitors.</div>';
      document.getElementById('btn-find-comp').style.display = 'inline-block';
      document.getElementById('btn-regen-comp').style.display = 'none';
    }
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

window.loadSmmUI = async function() {
  if (!window.activeProjectUrl) return;
  
  // Try restoring from localStorage first
  const savedResult = localStorage.getItem('smmLastResult');
  const savedProjectUrl = localStorage.getItem('smmLastProjectUrl');
  if (savedResult && window.renderSmmResults && savedProjectUrl === window.activeProjectUrl) {
    try {
      const parsed = JSON.parse(savedResult);
      if (parsed && parsed.posts) {
        window.renderSmmResults(parsed.posts, parsed.type);
      }
    } catch(e) {
      console.error("Failed to restore SMM results:", e);
    }
  }
  
  try {
    const res = await fetch(`/api/memory?url=${encodeURIComponent(window.activeProjectUrl)}`);
    const data = await res.json();
    if (data.memory) {
      window.projectMemory = data.memory;
      if (window.updateSmmSuboptions) window.updateSmmSuboptions();
      
      const activeStrategy = document.querySelector('input[name="smmStrategy"]:checked');
      if (activeStrategy && activeStrategy.value === 'mirror') {
        if (window.populateMirrorCompetitors) window.populateMirrorCompetitors();
      }
    }
  } catch (e) {
    console.error("Failed to load memory for SMM:", e);
  }
};

window.updateSmmSuboptions = function() {
  const mem = window.projectMemory;
  const themeSelect = document.getElementById('smm-theme');
  const container = document.getElementById('smm-suboption-container');
  const label = document.getElementById('smm-suboption-label');
  const select = document.getElementById('smm-suboption');
  
  if (!mem || !themeSelect || !container || !select) return;
  
  const theme = themeSelect.value;
  select.innerHTML = '<option value="">Select...</option>';
  
  let options = [];
  
  if (theme === 'product') {
    label.innerText = 'Target Product';
    options = (mem.offerings?.products || []).map(p => typeof p === 'string' ? p : p.name);
  } else if (theme === 'technical') {
    label.innerText = 'Target Capability/Service';
    options = (mem.offerings?.services || []).map(s => typeof s === 'string' ? s : s.name);
  } else if (theme === 'brand') {
    label.innerText = 'Brand Focus';
    options = ['Core Vision & Mission', 'Company History & Scale', 'Trust & Quality Assurance', 'Global Reach'];
  } else if (theme === 'educative') {
    label.innerText = 'Educative Topic';
    options = ['Manufacturing Process', 'Maintenance & Selection', 'Industry Standards', 'Technical Deep Dive'];
  } else if (theme === 'ugc') {
    label.innerText = 'UGC Focus';
    options = ['Behind the Scenes (Factory)', 'Employee Spotlight', 'Customer Delivery / Logistics'];
  }
  
  if (options.length > 0) {
    container.style.display = 'block';
    options.forEach(opt => {
      if (!opt) return;
      const el = document.createElement('option');
      el.value = opt;
      el.textContent = opt;
      select.appendChild(el);
    });
  } else {
    container.style.display = 'none';
  }
  select.dispatchEvent(new Event('optionsUpdated'));
};

window.populateMirrorCompetitors = function() {
  const mem = window.projectMemory;
  const select = document.getElementById('smm-mirror-competitor');
  if (!mem || !select) return;
  
  select.innerHTML = '<option value="">Select a competitor...</option>';
  
  const feed = mem.socialFeed || [];
  const competitors = [...new Set(feed.map(p => p.competitorName))].filter(Boolean);
  
  competitors.forEach(c => {
    const el = document.createElement('option');
    el.value = c;
    el.textContent = c;
    select.appendChild(el);
  });
  select.dispatchEvent(new Event('optionsUpdated'));
};

window.populateMirrorPosts = function(competitorName) {
  const mem = window.projectMemory;
  const select = document.getElementById('smm-mirror-post');
  if (!mem || !select) return;
  
  select.innerHTML = '<option value="">Select a post...</option>';
  if (!competitorName) return;
  
  const feed = mem.socialFeed || [];
  const posts = feed.filter(p => p.competitorName === competitorName);
  
  posts.forEach((p, idx) => {
    const el = document.createElement('option');
    el.value = String(idx);
    el.dataset.postJson = JSON.stringify(p);
    
    let text = `${p.platform} - ${p.date || 'Unknown'}`;
    if (p.content) {
      let snippet = p.content.substring(0, 40).replace(/\n/g, ' ');
      text += ` - ${snippet}...`;
    }
    
    el.textContent = text;
    select.appendChild(el);
  });
  select.dispatchEvent(new Event('optionsUpdated'));
};

window.selectedTrendingTopic = null;
window.lastTrendingTopic = null;

window.fetchTrendingTopics = async function() {
  if (!window.activeProjectUrl) {
    window.showError && window.showError("Please select a project first.");
    return;
  }

  const container = document.getElementById('smm-trending-topics');
  const btn = document.getElementById('smm-trending-btn');
  if (!container) return;

  container.style.display = 'block';
  container.innerHTML = '<div class="spinner"></div><p style="margin-top:10px;color:var(--text-muted)">Searching for trending topics in this industry...</p>';
  if (btn) { btn.disabled = true; btn.innerText = 'Loading...'; }

  try {
    const res = await fetch('/api/trending-topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: window.activeProjectUrl })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    window.selectedTrendingTopic = null;

    if (!data.topics || data.topics.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);">No trending topics could be found right now. Try again later.</p>';
      return;
    }

    let html = '<div style="display:flex; flex-direction:column; gap:10px;">';
    html += '<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap:10px;">';

    data.topics.forEach((topic, idx) => {
      html += `
      <div class="trending-topic-card" data-idx="${idx}" style="cursor:pointer; padding:12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; transition:0.2s; display:flex; flex-direction:column; gap:6px;">
        <strong style="color:var(--text-light); font-size:0.95em; line-height:1.3;">${topic.title}</strong>
        ${topic.relatedProduct ? `<span style="font-size:0.75em; font-weight:600; color:var(--success-color, #34d399); line-height:1.4;">✓ Matches your product: ${topic.relatedProduct}</span>` : ''}
        <span style="font-size:0.8em; color:var(--text-muted); line-height:1.4;">${topic.description || ''}</span>
        <span style="font-size:0.75em; color:var(--primary-color); line-height:1.4;">${topic.relevance || ''}</span>
        ${topic.sources && topic.sources.length ? `<span style="font-size:0.7em; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Sources: ${topic.sources.join(', ')}</span>` : ''}
      </div>`;
    });

    html += '</div>';
    html += '<p id="smm-trending-selected-hint" style="margin:0; font-size:0.85em; color:var(--text-muted); display:none;">Selected topic will be used as the focus of generated content.</p>';
    html += '</div>';

    container.innerHTML = html;

    const cards = container.querySelectorAll('.trending-topic-card');
    const hint = container.querySelector('#smm-trending-selected-hint');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => { c.style.border = '1px solid rgba(255,255,255,0.1)'; c.style.background = 'rgba(255,255,255,0.05)'; });
        card.style.border = '1px solid var(--primary-color)';
        card.style.background = 'rgba(77,171,247,0.08)';
        window.selectedTrendingTopic = data.topics[parseInt(card.getAttribute('data-idx'), 10)];
        if (hint) hint.style.display = 'block';
        window.showSuccess && window.showSuccess(`Trending topic selected: ${window.selectedTrendingTopic.title}`);
      });
    });
  } catch (e) {
    container.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = 'Load Trending Topics'; }
  }
};

window.generateSMM = async function() {
  if (!window.activeProjectUrl) return;
  
  const strategy = document.querySelector('input[name="smmStrategy"]:checked').value;
  const theme = document.getElementById('smm-theme').value;
  
  // Now using generic suboption instead of just product
  const suboptionEl = document.getElementById('smm-suboption');
  const subTheme = suboptionEl && suboptionEl.parentElement.style.display !== 'none' ? suboptionEl.value : null;
  
  const mirrorCompetitorEl = document.getElementById('smm-mirror-competitor');
  const mirrorCompetitor = mirrorCompetitorEl ? mirrorCompetitorEl.value : null;
  
  const mirrorPostEl = document.getElementById('smm-mirror-post');
  let mirrorPost = null;
  if (mirrorPostEl && mirrorPostEl.selectedIndex >= 0) {
    const selectedOpt = mirrorPostEl.options[mirrorPostEl.selectedIndex];
    if (selectedOpt && selectedOpt.dataset.postJson) {
      try { mirrorPost = JSON.parse(selectedOpt.dataset.postJson); } catch (e) {}
    } else if (mirrorPostEl.value) {
      try { mirrorPost = JSON.parse(mirrorPostEl.value); } catch (e) {}
    }
  }
  
  const indFocusEl = document.getElementById('smm-industry-focus');
  const industryFocus = indFocusEl ? indFocusEl.value : 'all';
  
  const customGoalEl = document.getElementById('smm-custom-goal');
  const customGoal = customGoalEl ? customGoalEl.value.trim() : '';
  
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
        subTheme: subTheme,
        mirrorCompetitor: mirrorCompetitor,
        mirrorPost: mirrorPost,
        industryFocus: industryFocus,
        customGoal: customGoal,
        trendingTopic: window.selectedTrendingTopic
      })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    window.showSuccess("SMM content generated successfully!");
    window.lastTrendingTopic = window.selectedTrendingTopic;
    
    localStorage.setItem('smmLastResult', JSON.stringify({ posts: data.posts, type: type }));
    localStorage.setItem('smmLastProjectUrl', window.activeProjectUrl);
    if (window.renderSmmResults) {
      window.renderSmmResults(data.posts, type);
    }
  } catch (e) {
    textDiv.innerHTML = `<span style="color:red">Error: ${e.message}</span>`;
  }
};

window.renderSmmResults = function(postsData, type) {
    const ansDiv = document.getElementById('smm-answer');
    const textDiv = document.getElementById('smm-text');
    if (!ansDiv || !textDiv) return;
    
    ansDiv.style.display = 'block';
    
    if (type === 'image') {
      const parsedPosts = postsData.map(p => {
        try { return JSON.parse(p); } catch(e) { return null; }
      }).filter(Boolean);
      
      const trendingBadge = window.lastTrendingTopic && window.lastTrendingTopic.title
        ? `<div style="margin-bottom:12px; padding:10px 14px; background:rgba(77,171,247,0.1); border:1px solid rgba(77,171,247,0.4); border-radius:8px; font-size:0.9em;">
             <strong style="color:var(--primary-color);">Trending Topic:</strong> <span style="color:var(--text-light);">${window.lastTrendingTopic.title}</span>
             ${window.lastTrendingTopic.sources && window.lastTrendingTopic.sources.length ? `<div style="font-size:0.75em; color:var(--text-muted); margin-top:4px;">${window.lastTrendingTopic.sources.join(' · ')}</div>` : ''}
           </div>`
        : '';

      let html = '<div style="display:flex; flex-direction:column; gap:10px;">';
      html += trendingBadge;
      html += '<h4 style="margin: 0; color: var(--primary-color);">Select a Visual Idea</h4>';
      html += '<div id="smm-idea-cards" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap:15px; margin-top: 10px;">';
      
      parsedPosts.forEach((post, idx) => {
         html += `
         <div class="idea-card" data-idx="${idx}" style="padding:15px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; cursor:pointer; transition: 0.2s; display: flex; flex-direction: column;">
           <strong style="margin-bottom: 8px; color: var(--text-light); font-size: 1.1em;">Option ${idx + 1}</strong>
           <span style="font-size: 0.9em; line-height: 1.4; color: var(--text-muted);">${post.visualIdea}</span>
         </div>`;
      });
      html += '</div>';
      
      html += '<div id="smm-post-details" style="margin-top:20px; display:none; padding:15px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; white-space: normal;"></div>';
      html += '</div>';
      
      textDiv.innerHTML = html;
      
      const cards = textDiv.querySelectorAll('.idea-card');
      const detailsDiv = textDiv.querySelector('#smm-post-details');
      
      cards.forEach(card => {
        card.addEventListener('click', () => {
           cards.forEach(c => c.style.border = '1px solid rgba(255,255,255,0.1)');
           card.style.border = '1px solid var(--primary-color)';
           
           const idx = parseInt(card.getAttribute('data-idx'), 10);
           const p = parsedPosts[idx];
           detailsDiv.style.display = 'block';
           if (p._editedHtml) {
             detailsDiv.innerHTML = p._editedHtml;
           } else {
             detailsDiv.innerHTML = `
               <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:15px;">
                 <h3 style="margin:0; color:var(--text-light); flex:1;">${p.heading || 'No Heading'}</h3>
                 <button class="btn btn-secondary edit-btn" style="padding:4px 10px; font-size:12px; margin-left:10px;">Edit Content</button>
               </div>
               <div class="editable-content">
                 ${p.subText ? `<h5 style="color:var(--text-muted); margin-bottom:15px;">${p.subText}</h5>` : ''}
                 <div style="margin-bottom:15px;">
                   <strong style="color:var(--primary-color);">Caption Context:</strong>
                   <p style="margin-top:5px;">${p.content || ''}</p>
                 </div>
                 <div style="margin-bottom:15px; padding:15px; background:rgba(255,255,255,0.05); border-radius:6px;">
                   <strong style="color:var(--primary-color);">Body:</strong>
                   <div style="margin-top:10px;">${window.marked ? window.marked.parse(p.body || '') : p.body}</div>
                 </div>
                 <div style="margin-bottom:10px;">
                   <strong style="color:var(--primary-color);">Design Elements:</strong>
                   <p style="margin-top:5px;">${p.elements || ''}</p>
                 </div>
                 <div>
                   <strong style="color:var(--primary-color);">Hashtags:</strong>
                   <p style="margin-top:5px; color:#4dabf7;">${p.hashtags || ''}</p>
                 </div>
               </div>
             `;
           }
           
           const editBtn = detailsDiv.querySelector('.edit-btn');
           const contentDiv = detailsDiv.querySelector('.editable-content');
           
           if (editBtn && contentDiv) {
             editBtn.onclick = () => {
               const isEditing = contentDiv.contentEditable === 'true';
               if (isEditing) {
                 contentDiv.contentEditable = 'false';
                 contentDiv.style.border = 'none';
                 contentDiv.style.padding = '0';
                 editBtn.innerText = 'Edit Content';
                 editBtn.classList.remove('btn-primary');
                 editBtn.classList.add('btn-secondary');
                 
                 // Save state
                 p._editedHtml = detailsDiv.innerHTML;
                 const newPosts = parsedPosts.map(pp => JSON.stringify(pp));
                 localStorage.setItem('smmLastResult', JSON.stringify({ posts: newPosts, type: 'image' }));
               } else {
                 contentDiv.contentEditable = 'true';
                 contentDiv.style.border = '1px dashed var(--primary-color)';
                 contentDiv.style.padding = '10px';
                 contentDiv.style.borderRadius = '4px';
                 contentDiv.focus();
                 editBtn.innerText = 'Save Changes';
                 editBtn.classList.remove('btn-secondary');
                 editBtn.classList.add('btn-primary');
               }
             };
           }
        });
      });
    } else {
      let rawHtml = '';
      if (type === 'video_edited') {
        rawHtml = postsData[0];
      } else {
        const joined = postsData.join('\\n\\n---\\n\\n');
        rawHtml = window.marked ? window.marked.parse(joined) : joined;
      }
      
      const trendingBadge = window.lastTrendingTopic && window.lastTrendingTopic.title
        ? `<div style="margin-bottom:12px; padding:10px 14px; background:rgba(77,171,247,0.1); border:1px solid rgba(77,171,247,0.4); border-radius:8px; font-size:0.9em;">
             <strong style="color:var(--primary-color);">Trending Topic:</strong> <span style="color:var(--text-light);">${window.lastTrendingTopic.title}</span>
             ${window.lastTrendingTopic.sources && window.lastTrendingTopic.sources.length ? `<div style="font-size:0.75em; color:var(--text-muted); margin-top:4px;">${window.lastTrendingTopic.sources.join(' · ')}</div>` : ''}
           </div>`
        : '';

      textDiv.innerHTML = `
        ${trendingBadge}
        <div style="display:flex; justify-content:flex-end; margin-bottom:10px;">
          <button class="btn btn-secondary edit-btn" style="padding:4px 10px; font-size:12px;">Edit Content</button>
        </div>
        <div class="editable-content">
          ${rawHtml}
        </div>
      `;
      
      const editBtn = textDiv.querySelector('.edit-btn');
      const contentDiv = textDiv.querySelector('.editable-content');
      
      editBtn.onclick = () => {
         const isEditing = contentDiv.contentEditable === 'true';
         if (isEditing) {
           contentDiv.contentEditable = 'false';
           contentDiv.style.border = 'none';
           contentDiv.style.padding = '0';
           editBtn.innerText = 'Edit Content';
           editBtn.classList.remove('btn-primary');
           editBtn.classList.add('btn-secondary');
           
           const newHtml = contentDiv.innerHTML;
           localStorage.setItem('smmLastResult', JSON.stringify({ posts: [newHtml], type: 'video_edited' }));
         } else {
           contentDiv.contentEditable = 'true';
           contentDiv.style.border = '1px dashed var(--primary-color)';
           contentDiv.style.padding = '10px';
           contentDiv.style.borderRadius = '4px';
           contentDiv.focus();
           editBtn.innerText = 'Save Changes';
           editBtn.classList.remove('btn-secondary');
           editBtn.classList.add('btn-primary');
         }
      };
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
    
    const feed = data.feed || [];
    
    if (feed.length === 0) {
      list.innerHTML = '<div class="empty-state">No recent competitor posts found yet. Click "Sync Feed Live" above to trigger a social crawl.</div>';
      return;
    }
    
    // Group posts by platform
    const grouped = {};
    feed.forEach(post => {
      let pName = String(post.platform || 'Social Feed').trim();
      let key = pName.charAt(0).toUpperCase() + pName.slice(1);
      if (key.toLowerCase().includes('instagram')) key = 'Instagram';
      else if (key.toLowerCase().includes('linkedin')) key = 'LinkedIn';
      else if (key.toLowerCase().includes('youtube')) key = 'YouTube';
      else if (key.toLowerCase().includes('facebook')) key = 'Facebook';
      else if (key.toLowerCase().includes('twitter') || key.toLowerCase().includes('x')) key = 'Twitter';
      else key = 'News & Press';
      
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(post);
    });

    const platformOrder = ['YouTube', 'LinkedIn', 'Facebook', 'Instagram', 'Twitter', 'News & Press'];
    const sortedPlatforms = Object.keys(grouped).sort((a, b) => {
      let idxA = platformOrder.indexOf(a);
      let idxB = platformOrder.indexOf(b);
      if (idxA === -1) idxA = 99;
      if (idxB === -1) idxB = 99;
      return idxA - idxB;
    });

    const platformMeta = {
      'Instagram': { icon: '📸', color: '#e1306c', bg: 'linear-gradient(135deg, #405de6, #833ab4, #e1306c)' },
      'LinkedIn': { icon: '💼', color: '#0a66c2', bg: 'linear-gradient(135deg, #0a66c2, #004182)' },
      'YouTube': { icon: '▶️', color: '#ff0000', bg: 'linear-gradient(135deg, #3f0909, #1a0303)' },
      'Facebook': { icon: '📘', color: '#1877f2', bg: 'linear-gradient(135deg, #1877f2, #0d47a1)' },
      'Twitter': { icon: '𝕏', color: '#1da1f2', bg: 'linear-gradient(135deg, #1da1f2, #0f1419)' },
      'News & Press': { icon: '📰', color: '#10b981', bg: 'linear-gradient(135deg, #059669, #044e36)' }
    };

    let html = `
      <style>
        .responsive-feed-container {
           display: flex; flex-direction: row; align-items: flex-start; gap: 32px; width: 100%; min-width: 0;
        }
        .responsive-feed-label {
           flex: 0 0 140px; padding-top: 8px;
        }
        .responsive-feed-cards {
           flex: 1; display: flex; flex-direction: row; gap: 20px; overflow-x: auto; min-width: 0; max-width: 100%; padding-bottom: 24px; scroll-behavior: smooth;
        }
        .responsive-feed-cards::-webkit-scrollbar { height: 8px; }
        .responsive-feed-cards::-webkit-scrollbar-track { background: transparent; }
        .responsive-feed-cards::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .responsive-feed-cards::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        .feed-text::-webkit-scrollbar { width: 6px; }
        .feed-text::-webkit-scrollbar-track { background: transparent; }
        .feed-text::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        .feed-text::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        
        @media (max-width: 1400px) {
           .responsive-feed-container { flex-direction: column !important; gap: 16px !important; }
           .responsive-feed-label { flex: 0 0 auto !important; width: 100% !important; padding-top: 0 !important; }
           .responsive-feed-cards { width: 100% !important; }
        }
      </style>
      <div style="display: flex; flex-direction: column; gap: 40px; padding-bottom: 24px; width: 100%; min-width: 0; max-width: 100%; overflow: hidden;">
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
      
      window.openLightbox = function(url, isVideo, postLink, platform, mediaType, encodedContent, encodedAuthor, dateStr, platformColor) {
        const lb = document.getElementById('media-lightbox');
        const content = document.getElementById('media-lightbox-content');
        
        window.instaVideoFallback = function(link) {
          const media = document.getElementById('media-lightbox-media');
          if (!media) return;
          media.innerHTML = `
            <div style="background: white; border-radius: 12px; overflow: hidden; max-width: 400px; display: flex; flex-direction: column; align-items: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
              <div style="width:100%; height:260px; background: linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888); display:flex; align-items:center; justify-content:center; color:white; font-size:64px;">&#9654;</div>
              <div style="padding: 20px; text-align: center;">
                <p style="margin: 0 0 15px 0; color: #333; font-weight: 500;">Watch this post directly on ${platform || 'platform'}.</p>
                <a href="${link}" target="_blank" style="background: ${platformColor || '#e1306c'}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Watch Post</a>
              </div>
            </div>`;
        };
        
        window.gridVideoFailed = function(el, platform, icon, encodedBg) {
          if (!el) return;
          const container = el.parentElement;
          if (container) {
            container.style.background = 'linear-gradient(135deg, #1e293b, #0f172a)';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.style.color = 'white';
            container.style.padding = '12px';
            container.innerHTML = `
              <div style="font-size:32px; margin-bottom: 6px;">${icon || '🌐'}</div>
              <span style="font-size:12px; font-weight:700; color: rgba(255,255,255,0.9); text-align: center;">View on ${platform || 'Platform'} ↗</span>
            `;
          }
        };
        
        window.getYouTubeId = function(link) {
          if (!link || typeof link !== 'string') return null;
          var match = link.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/)|vi\/)([\w-]{11})/i);
          return match ? match[1] : null;
        };

        let mediaHtml = '';
        const ytId = window.getYouTubeId(url) || window.getYouTubeId(postLink);
        
        const isDirectVideo = (url && (url.match(/\.(mp4|webm|ogg)(\?|$)/i) || url.includes('.mp4'))) ||
                              (postLink && (postLink.includes('/reel/') || postLink.includes('/watch') || postLink.includes('/videos/')));
        const isVideoMedia = isDirectVideo || (isVideo && (url.includes('.mp4') || mediaType === 'Video'));

        if (platform === 'YouTube' || ytId) {
          if (ytId) {
            mediaHtml = `
              <div style="width: 850px; max-width: 90vw; height: 480px; max-height: 80vh; background: #000; border-radius: 12px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                <iframe src="https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0" 
                  style="width: 100%; height: 100%; border: 0;" 
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                  allowfullscreen></iframe>
              </div>`;
          } else {
            mediaHtml = `
              <div style="background: var(--surface); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; overflow: hidden; max-width: 400px; padding: 32px 24px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                <div style="font-size: 48px; margin-bottom: 12px;">▶️</div>
                <p style="margin: 0 0 16px 0; color: var(--text); font-weight: 600;">Watch video on YouTube</p>
                <a href="${postLink || url}" target="_blank" style="background: #ff0000; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Play Video ↗</a>
              </div>`;
          }
        } else if (isVideoMedia) {
          let videoSrc = url || postLink;
          if (videoSrc.startsWith('http://') || videoSrc.startsWith('https://')) {
              videoSrc = `/api/proxy-media?url=${encodeURIComponent(videoSrc)}`;
          }
          mediaHtml = `<video src="${videoSrc}" controls autoplay onerror="window.instaVideoFallback('${postLink}')" style="max-height:100%; max-width:100%; border-radius:12px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); object-fit: contain; background: #000;"></video>`;
        } else if (url || postLink) {
          let mediaTarget = url || postLink;
          let imgSrc = mediaTarget;
          if (imgSrc.startsWith('http://') || imgSrc.startsWith('https://')) {
              imgSrc = `/api/proxy-media?url=${encodeURIComponent(imgSrc)}`;
          }
          mediaHtml = `<img src="${imgSrc}" referrerpolicy="no-referrer" style="max-height:100%; max-width:100%; border-radius:12px; object-fit:contain; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);" onerror="window.instaVideoFallback('${postLink}')" />`;
        } else {
          const platformIcons = { Facebook: '📘', Instagram: '📸', LinkedIn: '💼', YouTube: '▶️', News: '📰' };
          const icon = platformIcons[platform] || '🌐';
          const authorName = encodedAuthor ? decodeURIComponent(encodedAuthor) : platform;
          mediaHtml = `
            <div style="background: var(--surface); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; overflow: hidden; max-width: 440px; width: 100%; padding: 40px 28px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); display: flex; flex-direction: column; align-items: center; justify-content: center;">
              <div style="width: 72px; height: 72px; border-radius: 50%; background: ${platformColor || '#6366f1'}22; border: 1px solid ${platformColor || '#6366f1'}44; display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 20px;">
                ${icon}
              </div>
              <h4 style="font-size: 1.2rem; font-weight: 700; color: var(--text); margin: 0 0 8px 0;">${authorName}</h4>
              <p style="font-size: 0.88rem; color: var(--text-muted); margin: 0 0 24px 0; line-height: 1.5;">Official ${platform} Post</p>
              ${postLink ? `<a href="${postLink}" target="_blank" rel="noopener noreferrer" style="background: ${platformColor || '#6366f1'}; color: white; padding: 12px 28px; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 0.95rem; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px ${platformColor || '#6366f1'}66;">
                <span>View Original Post</span> ↗
              </a>` : ''}
            </div>`;
        }

        let captionHtml = '';
        if (encodedContent) {
           let rawText = decodeURIComponent(encodedContent);
           let author = encodedAuthor ? decodeURIComponent(encodedAuthor) : '';
           let displayDate = dateStr && dateStr !== 'undefined' && dateStr !== 'null' ? dateStr : 'Recent';
           captionHtml = `
           <div style="width: 400px; min-width: 320px; background: var(--surface); border-radius: 12px; margin-left: 24px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); height: 100%; max-height: 85vh;">
              <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: flex-start;">
                 <div>
                    <div style="font-weight: 700; color: var(--text); font-size: 1.1rem;">${author}</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">${displayDate}</div>
                 </div>
                 <span style="font-size: 0.65rem; font-weight: 800; padding: 4px 8px; border-radius: 20px; background: ${platformColor || '#6366f1'}; color: #ffffff; text-transform: uppercase;">${platform || 'POST'}</span>
              </div>
              <div class="feed-text" style="padding: 20px; overflow-y: auto; color: var(--text-muted); font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap; flex: 1;">${rawText}</div>
              ${postLink ? `<div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.05);"><a href="${postLink}" target="_blank" style="display: block; padding: 12px; background: rgba(99,102,241,0.1); border-radius: 8px; text-align: center; font-size: 13px; font-weight: 600; color: ${platformColor || '#6366f1'}; text-decoration: none; transition: background 0.2s;">View Original Post ↗</a></div>` : ''}
           </div>
           `;
        }

        content.innerHTML = `
           <div style="display: flex; flex-direction: row; height: 85vh; max-width: 90vw; align-items: center; justify-content: center;">
               <div id="media-lightbox-media" style="flex: 1; display: flex; justify-content: center; align-items: center; overflow: hidden; height: 100%; min-width: 0;">
                   ${mediaHtml}
               </div>
               ${captionHtml}
           </div>
        `;
        
        lb.style.display = 'flex';
      };
    }

    for (const platform of sortedPlatforms) {
      const posts = grouped[platform];
      const meta = platformMeta[platform] || { icon: '🌐', color: '#6366f1', bg: 'linear-gradient(135deg, #1e293b, #0f172a)' };
      const platformColor = meta.color;
      const platformIcon = meta.icon;

      html += `
        <div class="responsive-feed-container">
          
          <div class="responsive-feed-label">
            <h3 style="font-size: 1.4rem; font-weight: 700; color: var(--text); margin: 0; display:flex; align-items:center; gap:8px;">
               <span>${platformIcon}</span> ${platform}
            </h3>
          </div>
          
          <div class="responsive-feed-cards">
            ${posts.map(post => {
              let dateStr = post.date;
              if (!dateStr || dateStr === 'undefined' || dateStr === 'null') {
                dateStr = 'Recent';
              } else {
                try {
                  let d = new Date(post.date);
                  if (!isNaN(d.getTime())) {
                    const diffDays = Math.floor((new Date().getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
                    if (diffDays === 0) dateStr = 'Today';
                    else if (diffDays === 1) dateStr = '1 day ago';
                    else if (diffDays > 1 && diffDays < 7) dateStr = diffDays + ' days ago';
                    else dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
                  }
                } catch(e) {}
              }
              if (!dateStr || dateStr === 'undefined' || dateStr === 'null') dateStr = 'Recent';

              let safeContent = encodeURIComponent(post.content || '').replace(/'/g, "%27");
              let safeAuthor = encodeURIComponent(post.competitorName || '').replace(/'/g, "%27");

              let cardThumbHtml = '';
              const ytVidId = window.getYouTubeId(post.link || '') || window.getYouTubeId(post.mediaUrl || '');

              if (ytVidId) {
                const ytThumb = `https://img.youtube.com/vi/${ytVidId}/hqdefault.jpg`;
                cardThumbHtml = `
                  <div style="margin: 0 0 12px 0; width: 100%; height: 180px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: #000; flex-shrink: 0; position: relative;">
                    <img src="${ytThumb}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.onerror=null; this.src='https://img.youtube.com/vi/${ytVidId}/0.jpg'; window.gridVideoFailed(this, 'YouTube', '▶️');" />
                    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:52px;height:52px;background:rgba(255,0,0,0.85);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:24px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.4);">▶</div>
                  </div>`;
              } else if ((post.mediaUrl && !post.mediaUrl.startsWith('data:')) || (post.link && !post.link.startsWith('data:'))) {
                let mediaTarget = post.mediaUrl || post.link || '';
                let urls = mediaTarget.split(',');
                let gridThumb = urls[0].trim();
                let isMediaVid = post.mediaType === 'Video' || gridThumb.match(/\.(mp4|webm|ogg)$/i) || gridThumb.includes('mp4') || gridThumb.includes('/reel/') || gridThumb.includes('/watch');
                
                let proxiedThumb = gridThumb;
                if (gridThumb.startsWith('http://') || gridThumb.startsWith('https://')) {
                    proxiedThumb = '/api/proxy-media?url=' + encodeURIComponent(gridThumb);
                }
                
                cardThumbHtml = `
                  <div style="margin: 0 0 12px 0; width: 100%; height: 180px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: var(--background); flex-shrink: 0; position: relative;">
                    <img src="${proxiedThumb}" referrerpolicy="no-referrer" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="window.gridVideoFailed(this, '${platform}', '${platformIcon}', '${encodeURIComponent(meta.bg)}');" />
                    ${isMediaVid ? '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:48px;height:48px;background:rgba(0,0,0,0.6);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:24px;pointer-events:none;border:2px solid rgba(255,255,255,0.8);">▶</div>' : ''}
                  </div>`;
              } else {
                cardThumbHtml = `
                  <div style="margin: 0 0 12px 0; width: 100%; height: 180px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: ${meta.bg}; flex-shrink: 0; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white;">
                    <span style="font-size:36px;">${platformIcon}</span>
                    <span style="font-size:12px; font-weight:700; margin-top:6px;">View on ${platform} ↗</span>
                  </div>`;
              }

              let displayContent = (post.content || '').trim();
              if (!displayContent || displayContent === 'No caption' || displayContent === 'No caption.') {
                displayContent = `Official ${platform} post from ${post.competitorName}. Click box to preview full post.`;
              }

              let mediaToOpen = post.mediaUrl || post.link || '';
              let isMediaVidFlag = post.mediaType === 'Video' || (post.mediaUrl && (post.mediaUrl.includes('mp4') || post.mediaUrl.includes('webm')));

              return `
              <div class="feed-item" onclick="window.openLightbox('${mediaToOpen}', ${isMediaVidFlag ? true : false}, '${post.link || ''}', '${platform}', '${post.mediaType || ''}', '${safeContent}', '${safeAuthor}', '${dateStr}', '${platformColor}')" style="background: var(--surface); padding: 20px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); width: 340px; flex-shrink: 0; display: flex; flex-direction: column; height: 580px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 10px 15px -3px rgba(0, 0, 0, 0.2)'" onmouseout="this.style.transform='none'; this.style.boxShadow='0 4px 6px -1px rgba(0, 0, 0, 0.1)'">
                <div class="feed-header" style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                  <div>
                    <span class="feed-author" style="font-weight: 700; color: var(--text); display: block; font-size: 1.05rem; line-height: 1.2;">${post.competitorName || 'Competitor'}</span>
                    <span class="feed-meta" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; display: block;">${dateStr}</span>
                  </div>
                  <span style="font-size: 0.65rem; font-weight: 800; padding: 4px 8px; border-radius: 20px; background: ${platformColor}; color: #ffffff; text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0;">${platform}</span>
                </div>
                ${cardThumbHtml}
                <div class="feed-text" style="white-space: pre-wrap; font-size: 0.95rem; line-height: 1.5; color: var(--text-muted); overflow-y: auto; flex: 1; margin-bottom: 16px;">${displayContent}</div>
                ${post.link ? `<a href="${post.link}" onclick="event.stopPropagation(); window.open(this.href, '_blank'); window.focus(); return false;" style="display: block; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; text-align: center; font-size: 13px; font-weight: 600; color: ${platformColor}; text-decoration: none; flex-shrink: 0; margin-top: auto; transition: background 0.2s;">View Original Post ↗</a>` : ''}
              </div>
            `;
            }).join('')}
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
