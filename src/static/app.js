window.activeProjectUrl = null;
window.currentUser = null;

// Keep existing dashboard calls unchanged while attaching the session to every
// protected same-origin request.
const nativeFetch = window.fetch.bind(window);
window.fetch = function(resource, options = {}) {
  const url = typeof resource === 'string' ? resource : resource?.url || '';
  const isProtectedPath = /^\/(?:api(?!\/auth(?:\/|$))|memory|business-intelligence)/.test(url);
  const token = localStorage.getItem('dashboardToken');
  if (!isProtectedPath || !token) return nativeFetch(resource, options);
  const headers = new Headers(options.headers || (typeof resource !== 'string' ? resource.headers : undefined));
  headers.set('Authorization', `Bearer ${token}`);
  return nativeFetch(resource, { ...options, headers });
};

window.applyCurrentUser = function(user) {
  window.currentUser = user || null;
  const isAdmin = user?.role === 'admin';
  const name = document.getElementById('admin-user-name');
  const role = document.getElementById('admin-user-role');
  const returnToAdmin = document.getElementById('return-admin-center');
  const deleteProject = document.getElementById('btn-global-delete');
  if (name) name.textContent = user?.username || 'Guest';
  if (role) role.textContent = isAdmin ? 'Administrator' : 'SMM';
  if (returnToAdmin) returnToAdmin.style.display = isAdmin ? 'inline-flex' : 'none';
  if (deleteProject && !isAdmin) deleteProject.style.display = 'none';
};

window.showRoleHome = async function() {
  const isAdmin = window.currentUser?.role === 'admin';
  const adminCenter = document.getElementById('admin-control-center');
  const dashboard = document.getElementById('dashboard-shell');
  if (adminCenter) adminCenter.style.display = isAdmin ? 'block' : 'none';
  if (dashboard) dashboard.style.display = isAdmin ? 'none' : '';
  if (isAdmin) {
    await Promise.all([window.loadDashboardUsers(), window.loadAdminProjects()]);
  } else {
    window.restoreActiveTab();
  }
};

window.openDashboardWorkspace = function() {
  if (window.currentUser?.role !== 'admin') return;
  const adminCenter = document.getElementById('admin-control-center');
  const dashboard = document.getElementById('dashboard-shell');
  if (adminCenter) adminCenter.style.display = 'none';
  if (dashboard) dashboard.style.display = '';
  window.switchTab('projects', 'Projects Directory');
};

window.returnToAdminCenter = function() { window.showRoleHome(); };

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
  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-theme');
  window.updateThemeControls();

  const authenticated = await window.checkAuthStatus();
  if (authenticated) {
    await loadProjects();
    if (window.currentUser?.role !== 'admin') await renderProjectsDirectoryUI();
  }
  if (authenticated) await window.showRoleHome();
  setTimeout(initializeCustomSelects, 100);
});

window.handleAdminLogin = async function() {
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorDiv = document.getElementById('login-error');
  const btn = document.getElementById('login-submit-btn');

  if (!usernameInput || !passwordInput) return;
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  btn.disabled = true;
  btn.innerText = 'Verifying...';
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      localStorage.setItem('dashboardToken', data.token);
      localStorage.removeItem('adminToken');
      window.applyCurrentUser(data.user);
      const overlay = document.getElementById('login-overlay');
      if (overlay) overlay.style.display = 'none';
      if (typeof window.showSuccess === 'function') window.showSuccess(`Welcome, ${data.user.username}!`);
      try {
        if (typeof window.loadProjects === 'function') await window.loadProjects();
        if (data.user.role !== 'admin' && typeof window.renderProjectsDirectoryUI === 'function') await window.renderProjectsDirectoryUI();
        await window.showRoleHome();
      } catch (postLoginErr) {
        console.warn('[LOGIN] Post-login UI load warning:', postLoginErr);
      }
    } else {
      if (errorDiv) {
        errorDiv.textContent = data.error || 'Invalid credentials';
        errorDiv.style.display = 'block';
      }
    }
  } catch (e) {
    if (errorDiv) {
      errorDiv.textContent = 'Server connection error';
      errorDiv.style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    btn.innerText = 'Sign In to Workspace';
  }
};

window.checkAuthStatus = async function() {
  const token = localStorage.getItem('dashboardToken') || localStorage.getItem('adminToken');
  const overlay = document.getElementById('login-overlay');
  if (!token) {
    if (overlay) overlay.style.display = 'flex';
    return false;
  }
  try {
    const res = await fetch(`/api/auth/status?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.authenticated) {
      if (token && !localStorage.getItem('dashboardToken')) localStorage.setItem('dashboardToken', token);
      window.applyCurrentUser(data.user);
      if (overlay) overlay.style.display = 'none';
      return true;
    } else {
      localStorage.removeItem('dashboardToken');
      localStorage.removeItem('adminToken');
      window.applyCurrentUser(null);
      if (overlay) overlay.style.display = 'flex';
      return false;
    }
  } catch (e) {
    if (overlay) overlay.style.display = 'flex';
    return false;
  }
};

window.handleLogout = async function() {
  const token = localStorage.getItem('dashboardToken');
  if (token) await nativeFetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  localStorage.removeItem('dashboardToken');
  localStorage.removeItem('adminToken');
  window.applyCurrentUser(null);
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'flex';
  window.showSuccess('Logged out successfully');
};

window.escapeHtml = function(value) {
  const node = document.createElement('div');
  node.textContent = String(value ?? '');
  return node.innerHTML;
};

window.loadDashboardUsers = async function() {
  if (window.currentUser?.role !== 'admin') return;
  const list = document.getElementById('admin-user-list');
  const count = document.getElementById('admin-user-count');
  if (!list) return;
  list.innerHTML = '<div class="empty-state">Loading workspace users…</div>';
  try {
    const response = await fetch('/api/admin/users');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load users.');
    const users = data.users || [];
    if (count) count.textContent = users.length;
    const overviewCount = document.getElementById('admin-overview-user-count');
    if (overviewCount) overviewCount.textContent = users.length;
    list.innerHTML = users.map(user => `
      <article class="admin-user-row">
        <div class="admin-user-avatar">${window.escapeHtml(user.username).slice(0, 1).toUpperCase()}</div>
        <div class="admin-user-identity">
          <strong>${window.escapeHtml(user.username)}</strong>
          <span>${user.role === 'admin' ? 'Administrator' : 'Dashboard user'} · Added ${new Date(user.createdAt).toLocaleDateString()}</span>
        </div>
        <span class="admin-role-badge ${user.role}">${user.role === 'admin' ? 'Admin' : 'User'}</span>
        ${user.username.toLowerCase() === window.currentUser.username.toLowerCase() ? '<span class="admin-current-user">Current</span>' : `<button class="admin-delete-user" type="button" onclick="window.deleteDashboardUser('${encodeURIComponent(user.username)}')" aria-label="Remove ${window.escapeHtml(user.username)}">Remove</button>`}
      </article>`).join('') || '<div class="empty-state">No user accounts found.</div>';
  } catch (error) {
    list.innerHTML = `<div class="empty-state">${window.escapeHtml(error.message || 'Unable to load users.')}</div>`;
  }
};

window.createDashboardUser = async function() {
  const username = document.getElementById('new-user-username')?.value.trim();
  const password = document.getElementById('new-user-password')?.value || '';
  const role = document.getElementById('new-user-role')?.value || 'user';
  const message = document.getElementById('admin-user-error');
  if (message) message.textContent = '';
  try {
    const response = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to add user.');
    document.getElementById('admin-user-form')?.reset();
    window.showSuccess(`User ${data.user.username} added.`);
    await window.loadDashboardUsers();
  } catch (error) {
    if (message) message.textContent = error.message || 'Unable to add user.';
  }
};

window.deleteDashboardUser = async function(encodedUsername) {
  const username = decodeURIComponent(encodedUsername);
  if (!window.confirm(`Remove ${username}'s dashboard access?`)) return;
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to remove user.');
    window.showSuccess(`User ${username} removed.`);
    await window.loadDashboardUsers();
  } catch (error) { window.showSuccess(error.message || 'Unable to remove user.'); }
};

window.loadAdminProjects = async function() {
  if (window.currentUser?.role !== 'admin') return;
  const list = document.getElementById('admin-project-list');
  const count = document.getElementById('admin-overview-project-count');
  if (!list) return;
  list.innerHTML = '<div class="empty-state">Loading projects…</div>';
  try {
    const [projectResponse, userResponse] = await Promise.all([fetch('/api/projects'), fetch('/api/admin/users')]);
    const data = await projectResponse.json();
    const userData = await userResponse.json();
    if (!projectResponse.ok) throw new Error(data.error || 'Unable to load projects.');
    if (!userResponse.ok) throw new Error(userData.error || 'Unable to load users.');
    const projects = data.allProjects || [];
    const assignableUsers = (userData.users || []).filter(user => user.role === 'user');
    if (count) count.textContent = projects.length;
    list.innerHTML = projects.length ? projects.map(project => `
      <article class="admin-project-row">
        <div class="admin-project-icon">⚡</div>
        <div class="admin-project-details"><strong>${window.escapeHtml(project.name)}</strong><span>${window.escapeHtml(project.industry || 'Business intelligence')} · ${project.competitorCount || 0} competitors · ${project.postCount || 0} posts</span>${project.assignedTo?.length ? `<div class="project-assignees">${project.assignedTo.map(username => `<span class="project-assignee">${window.escapeHtml(username)} <button type="button" onclick="window.unassignProject('${encodeURIComponent(username)}','${encodeURIComponent(project.url)}')" aria-label="Unassign ${window.escapeHtml(username)}">×</button></span>`).join('')}</div>` : '<span class="project-unassigned">Not assigned to a user</span>'}</div>
        <div class="admin-project-actions"><div class="project-assignment-control"><select id="project-assignee-${project.id}" aria-label="Assign ${window.escapeHtml(project.name)}">${assignableUsers.length ? `<option value="">Assign to user…</option>${assignableUsers.map(user => `<option value="${window.escapeHtml(user.username)}">${window.escapeHtml(user.username)}</option>`).join('')}` : '<option value="">Create a dashboard user first</option>'}</select><button class="btn btn-secondary" type="button" ${assignableUsers.length ? '' : 'disabled'} onclick="window.assignProject('${encodeURIComponent(project.url)}','project-assignee-${project.id}')">Assign</button></div><button class="btn btn-secondary" type="button" onclick="window.openAdminProject('${encodeURIComponent(project.url)}')">Open</button><button class="admin-delete-user" type="button" onclick="window.deleteAdminProject('${encodeURIComponent(project.url)}')">Remove</button></div>
      </article>`).join('') : '<div class="empty-state">No saved projects found.</div>';
  } catch (error) {
    list.innerHTML = `<div class="empty-state">${window.escapeHtml(error.message || 'Unable to load projects.')}</div>`;
  }
};

window.assignProject = async function(encodedUrl, selectId) {
  const username = document.getElementById(selectId)?.value;
  if (!username) return window.showSuccess('Select a dashboard user first.');
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}/projects`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectUrl: decodeURIComponent(encodedUrl) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to assign project.');
    window.showSuccess(`Project assigned to ${username}.`);
    await window.loadAdminProjects();
  } catch (error) { window.showSuccess(error.message || 'Unable to assign project.'); }
};

window.unassignProject = async function(encodedUsername, encodedUrl) {
  const username = decodeURIComponent(encodedUsername);
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}/projects?projectUrl=${encodeURIComponent(decodeURIComponent(encodedUrl))}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to unassign project.');
    window.showSuccess(`Project unassigned from ${username}.`);
    await window.loadAdminProjects();
  } catch (error) { window.showSuccess(error.message || 'Unable to unassign project.'); }
};

window.openAdminProject = async function(encodedUrl) {
  const url = decodeURIComponent(encodedUrl);
  await window.selectProject(url, true);
  window.openDashboardWorkspace();
  window.switchTab('details', 'Project Details & Review');
};

window.deleteAdminProject = async function(encodedUrl) {
  const url = decodeURIComponent(encodedUrl);
  if (!window.confirm('Permanently remove this project and its saved intelligence?')) return;
  try {
    const response = await fetch(`/api/memory?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to remove project.');
    if (window.activeProjectUrl === url) window.activeProjectUrl = null;
    window.showSuccess('Project removed.');
    await Promise.all([window.loadAdminProjects(), window.renderProjectsDirectoryUI()]);
  } catch (error) { window.showSuccess(error.message || 'Unable to remove project.'); }
};

window.renderProjectsDirectoryUI = async function() {
  const yourGrid = document.getElementById('your-projects-grid');
  const allGrid = document.getElementById('all-projects-grid');
  const yourCount = document.getElementById('your-projects-count');
  const allCount = document.getElementById('all-projects-count');
  
  if (!yourGrid || !allGrid) return;
  
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    const projects = data.allProjects || [];
    const assignedProjects = projects.filter(project => project.assigned);
    const otherProjects = projects.filter(project => !project.assigned);
    
    if (projects.length === 0) {
      yourGrid.innerHTML = '<div class="empty-state">No active projects found. Click "Start New Analysis" above to analyze a website.</div>';
      allGrid.innerHTML = '<div class="empty-state">No historical projects found.</div>';
      if (yourCount) yourCount.textContent = '0';
      if (allCount) allCount.textContent = '0';
      return;
    }
    
    if (yourCount) yourCount.textContent = assignedProjects.length;
    if (allCount) allCount.textContent = otherProjects.length;
    
    const renderProjectCards = (items, emptyMessage) => {
      if (!items.length) return `<div class="empty-state">${emptyMessage}</div>`;
      return items.map(p => {
      const isCurrentActive = p.url === window.activeProjectUrl;
      return `
        <div class="project-card ${isCurrentActive ? 'active' : ''}" style="${isCurrentActive ? 'border-color: var(--primary); background: rgba(99, 102, 241, 0.05);' : ''}">
          <div class="project-card-header">
            <div class="project-card-icon">⚡</div>
            <div style="flex: 1; min-width: 0;">
              <div class="project-card-title">${window.escapeHtml(p.name)}</div>
              <a href="${window.escapeHtml(p.url)}" target="_blank" rel="noopener" class="project-card-url">${window.escapeHtml(p.url)}</a>
            </div>
            ${isCurrentActive ? '<span class="badge" style="background: rgba(34, 197, 94, 0.2); color: #22c55e; font-size: 11px; padding: 2px 8px; border-radius: 10px;">Active</span>' : (p.assigned ? '<span class="badge project-assigned-badge">Assigned</span>' : '')}
          </div>
          <div class="project-card-stats">
            <div class="project-stat-item">
              <span class="project-stat-value">${p.competitorCount}</span>
              <span class="project-stat-label">Competitors</span>
            </div>
            <div class="project-stat-item" style="margin-left: 20px;">
              <span class="project-stat-value">${p.postCount}</span>
              <span class="project-stat-label">Social Posts</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button class="btn btn-primary" style="flex: 1; padding: 10px; font-size: 13px;" onclick="window.selectProject(decodeURIComponent('${encodeURIComponent(p.url)}'), true); window.switchTab('details', 'Project Details & Review');">
              Open Intelligence Workspace
            </button>
          </div>
        </div>
      `;
      }).join('');
    };
    yourGrid.innerHTML = renderProjectCards(assignedProjects, 'No projects have been assigned to you yet.');
    allGrid.innerHTML = renderProjectCards(otherProjects, 'No other projects found.');
  } catch(e) {
    console.error("Failed to render projects directory UI", e);
  }
};

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
window.updateThemeControls = () => {
  const isDark = document.body.classList.contains('dark-theme');
  document.querySelectorAll('#theme-toggle, #admin-theme-toggle').forEach(btn => {
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  });
};

window.toggleTheme = () => {
  document.body.classList.toggle('dark-theme');
  localStorage.setItem('theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
  window.updateThemeControls();
};

window.closeNavigation = () => {
  document.body.classList.remove('nav-open');
  const toggle = document.getElementById('nav-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
};

window.toggleNavigation = () => {
  const opening = !document.body.classList.contains('nav-open');
  document.body.classList.toggle('nav-open', opening);
  const toggle = document.getElementById('nav-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', String(opening));
};

window.addEventListener('resize', () => {
  if (window.innerWidth > 860) window.closeNavigation();
});

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
  window.closeNavigation();
  // New workspace sections should always open at their heading. This prevents
  // a long form or feed from leaving the next section halfway down the page.
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

  if (deleteBtn) deleteBtn.style.display = window.currentUser?.role === 'admin' ? 'block' : 'none';

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
  if (window.currentUser?.role !== 'admin') return;
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
              ${c.socials?.youtube ? `<a href="${c.socials.youtube}" target="_blank" title="YouTube" style="display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:rgba(255, 0, 0, 0.1); color:#ff0000; text-decoration:none; font-size:14px; transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">▶️</a>` : ''}
            </div>
            <button onclick="window.deleteSingleCompetitor('${c.url}')" title="Remove competitor" style="background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239,68,68,0.2); color:#ef4444; cursor:pointer; padding:6px; border-radius:8px; display:flex; align-items:center; justify-content:center; transition: all 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.15)'" onmouseout="this.style.background='rgba(239,68,68,0.05)'">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>

        <section class="competitor-product-summary" aria-label="Common products">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <span class="competitor-product-label">
              📦 Common Products (${commonProds.length})
            </span>
            ${(c.evidenceUrls && c.evidenceUrls.length > 0) ? `
              <div style="font-size: 12px; display: flex; align-items: center; gap: 6px;">
                <select class="replaced competitor-product-select" onchange="if(this.value) window.open(this.value, '_blank')">
                  <option value="">Product Pages...</option>
                  ${c.evidenceUrls.filter(u => u.url).map(u => `<option value="${u.url.startsWith('http') ? u.url : 'https://' + u.url}">${u.title}</option>`).join('')}
                </select>
              </div>
            ` : ''}
          </div>

          <div class="competitor-product-chips">
            ${commonProds.length > 0 
              ? commonProds.map(p => `<span class="competitor-product-chip">🏷️ ${p}</span>`).join('') 
              : `<span class="competitor-product-empty">No specific product matches recorded</span>`
            }
          </div>
        </section>

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
  if (!window.activeProjectUrl) {
    alert('Please select an active project workspace first.');
    return;
  }
  
  const nameInput = document.getElementById('add-comp-name');
  const urlInput = document.getElementById('add-comp-url');
  const ytInput = document.getElementById('add-comp-yt');
  const igInput = document.getElementById('add-comp-ig');
  const fbInput = document.getElementById('add-comp-fb');
  const liInput = document.getElementById('add-comp-li');
  const twInput = document.getElementById('add-comp-tw');
  
  const name = nameInput ? nameInput.value.trim() : '';
  let url = urlInput ? urlInput.value.trim() : '';
  
  if (!name || !url) {
    alert('Please provide both a Competitor Name and Website URL.');
    return;
  }
  
  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }

  const youtube = ytInput ? ytInput.value.trim() : '';
  const instagram = igInput ? igInput.value.trim() : '';
  const facebook = fbInput ? fbInput.value.trim() : '';
  const linkedin = liInput ? liInput.value.trim() : '';
  
  const btn = document.getElementById('btn-add-comp');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Saving Competitor...';
  }
  
  try {
    const res = await fetch('/api/competitors/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        websiteUrl: window.activeProjectUrl,
        compName: name,
        compUrl: url,
        youtube,
        instagram,
        facebook,
        linkedin
      })
    });
    
    if (res.ok) {
      if (nameInput) nameInput.value = '';
      if (urlInput) urlInput.value = '';
      if (ytInput) ytInput.value = '';
      if (igInput) igInput.value = '';
      if (fbInput) fbInput.value = '';
      if (liInput) liInput.value = '';
      if (twInput) twInput.value = '';

      window.showSuccess('Competitor profile & social links saved successfully!');
      await loadCompetitorsUI();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to add competitor');
    }
  } catch (error) {
    alert('Failed to add competitor');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Save Competitor Profile';
    }
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
      list.innerHTML = '<div class="empty-state">No recent competitor posts found yet. Click "Run Daily Tracker Now" above to trigger a social crawl.</div>';
      return;
    }
    
    // Group posts into 4 separate dedicated platform sections
    const ytPosts = [];
    const igPosts = [];
    const fbPosts = [];
    const liPosts = [];

    const seenKeys = new Set();

    feed.forEach(rawPost => {
      let post = {
        ...rawPost,
        link: rawPost.link || rawPost.post_url || rawPost.postUrl || '',
        content: rawPost.content || rawPost.caption || '',
        mediaUrl: rawPost.mediaUrl || rawPost.mediaUrls || rawPost.thumbnail || rawPost.thumbnail_url || '',
        date: rawPost.date || rawPost.timestamp || 'Recent'
      };
      let pLink = (post.link || '').trim();
      let normLink = pLink.split('#')[0].replace(/\/+$/, '');
      if (!pLink.includes('facebook.com') && !pLink.includes('fb.watch')) {
        normLink = pLink.split('?')[0].split('#')[0].replace(/\/+$/, '');
      }
      if (pLink.includes('youtube.com') || pLink.includes('youtu.be')) {
        let ytId = window.getYouTubeId(pLink) || window.getYouTubeId(post.content);
        if (ytId) normLink = `https://www.youtube.com/watch?v=${ytId}`;
      }

      let compKey = String(post.company || post.competitorName || 'Competitor').trim().toLowerCase();
      let pName = String(post.platform || 'Social Feed').trim().toLowerCase();
      let dedupKey = `${pName}_${compKey}_${normLink.toLowerCase()}`;
      if (seenKeys.has(dedupKey)) return;
      seenKeys.add(dedupKey);

      let pLinkLower = pLink.toLowerCase();
      let pMedia = (post.mediaUrl || '').toLowerCase();
      let rawContent = (post.content || '');
      let ytVidId = window.getYouTubeId(post.link || '') || window.getYouTubeId(post.mediaUrl || '') || window.getYouTubeId(rawContent);

      if (pLinkLower.includes('instagram.com') || (pName.includes('instagram') && !pLinkLower.includes('facebook.com'))) {
        igPosts.push({ ...post, _detectedPlatform: 'Instagram' });
      } else if (pLinkLower.includes('facebook.com') || (pName.includes('facebook') && !pLinkLower.includes('instagram.com'))) {
        fbPosts.push({ ...post, _detectedPlatform: 'Facebook' });
      } else if (pLinkLower.includes('linkedin.com') || pName.includes('linkedin')) {
        liPosts.push({ ...post, _detectedPlatform: 'LinkedIn' });
      } else if (ytVidId || pLinkLower.includes('youtube.com') || pLinkLower.includes('youtu.be') || pName.includes('youtube')) {
        ytPosts.push({ ...post, _detectedPlatform: 'YouTube', _ytId: ytVidId });
      }
    });

    const platformMeta = {
      'YouTube': { icon: '▶️', color: '#ff0000', badgeBg: '#cc0000', bg: 'linear-gradient(135deg, #2b0606, #120303)' },
      'Facebook': { icon: '📘', color: '#1877f2', badgeBg: '#1877f2', bg: 'linear-gradient(135deg, #0f2b5c, #071633)' },
      'Instagram': { icon: '📸', color: '#e1306c', badgeBg: '#d62976', bg: 'linear-gradient(135deg, #3d0d2b, #1f0516)' },
      'LinkedIn': { icon: '💼', color: '#0a66c2', badgeBg: '#0a66c2', bg: 'linear-gradient(135deg, #092747, #031224)' }
    };

    let html = `
      <style>
        .social-section-header { display: flex; align-items: center; gap: 10px; font-size: 1.25rem; font-weight: 700; color: #ffffff; margin: 24px 0 14px 0; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px; }
        .social-section-icon { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .social-horizontal-row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 14px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.2) transparent; }
        .social-horizontal-row::-webkit-scrollbar { height: 6px; }
        .social-horizontal-row::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
      </style>
      <div style="display: flex; flex-direction: column; gap: 20px; width: 100%;">
    `;
    
    if (!document.getElementById('media-lightbox')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="media-lightbox" onclick="if(event.target === this) this.style.display='none'" class="media-lightbox" style="display:none;">
          <button class="media-lightbox-close" type="button" aria-label="Close post preview" onclick="document.getElementById('media-lightbox').style.display='none'">&times;</button>
          <div id="media-lightbox-content" style="width: 100%; height: 100%; display:flex; justify-content:center; align-items:center; padding: 40px;"></div>
        </div>
      `);
      
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          const lb = document.getElementById('media-lightbox');
          if (lb && lb.style.display === 'flex') lb.style.display = 'none';
        }
      });

      window.gridVideoFailed = function(el, platform, icon, encodedBg) {
        if (!el) return;
        el.onerror = null;
        let fallbackUrl = 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&auto=format&fit=crop';
        if (platform === 'LinkedIn') fallbackUrl = 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&auto=format&fit=crop';
        else if (platform === 'Instagram') fallbackUrl = 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&auto=format&fit=crop';
        else if (platform === 'YouTube') fallbackUrl = 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=800&auto=format&fit=crop';
        el.src = window.getSocialMediaProxyUrl(fallbackUrl);
        el.style.display = 'block';
      };

      window.getYouTubeId = function(str) {
        if (!str || typeof str !== 'string') return null;
        var match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/)|vi\/)([\w-]{11})/i);
        return match ? match[1] : null;
      };

      // Bump this when changing proxy behaviour so an old cached fallback SVG
      // cannot hide a now-available signed social CDN image.
      window.getSocialMediaProxyUrl = function(url) {
        return `/api/proxy-media?url=${encodeURIComponent(url)}&mediaCache=2`;
      };

      window.extractSingleMediaUrl = function(post) {
        if (!post) return null;
        let candidates = [];
        if (post.thumbnail) candidates.push(post.thumbnail);
        if (post.thumbnail_url) candidates.push(post.thumbnail_url);
        if (post.media_url) candidates.push(post.media_url);
        if (Array.isArray(post.mediaUrl)) candidates.push(...post.mediaUrl);
        if (Array.isArray(post.mediaUrls)) candidates.push(...post.mediaUrls);
        if (typeof post.mediaUrl === 'string') candidates.push(...post.mediaUrl.split(','));
        if (typeof post.mediaUrls === 'string') candidates.push(...post.mediaUrls.split(','));
        if (post.post_url) candidates.push(post.post_url);
        if (post.link) candidates.push(post.link);

        for (let c of candidates) {
          if (!c || typeof c !== 'string') continue;
          let trimmed = c.trim();
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            let lower = trimmed.toLowerCase();
            let cstpMatch = lower.match(/cstp=mx(\d+)x(\d+)/);
            if (cstpMatch && cstpMatch[1] && cstpMatch[2]) {
              let w = parseInt(cstpMatch[1], 10);
              let h = parseInt(cstpMatch[2], 10);
              if (w > 0 && h > 0 && (w / h > 2.1)) {
                continue;
              }
            }
            if (lower.includes('p100x100') || lower.includes('p200x200') || lower.includes('p50x50') ||
                lower.includes('p36x36') || lower.includes('p75x75') || lower.includes('p160x160') ||
                lower.includes('p320x320') || lower.includes('s100x100') || lower.includes('s200x200') ||
                lower.includes('s50x50') || lower.includes('s36x36') || lower.includes('s75x75') ||
                lower.includes('profile_pic') || lower.includes('profile_photo') || lower.includes('avatar') ||
                lower.includes('cover_photo') || lower.includes('profile_cover') || lower.includes('banner') ||
                lower.includes('header') || lower.includes('rsrc.php') || lower.includes('emoji')) {
              continue;
            }
            if (lower.includes('cdninstagram') || lower.includes('fbcdn') || lower.includes('fbsbx') || lower.includes('licdn') || lower.includes('ytimg') || lower.match(/\.(jpeg|jpg|png|gif|webp|svg|mp4)(\?|$)/i) || lower.includes('facebook.com') || lower.includes('linkedin.com') || lower.includes('instagram.com') || lower.includes('youtube.com') || lower.includes('youtu.be')) {
              return lower.includes('instagram.com') ? trimmed.replace(/\/media\/?(\?.*)?$/i, '/') : trimmed;
            }
          }
        }
        return null;
      };

      // Split Media Left / Caption Right Lightbox Modal function
      window.openLightbox = function(url, isVideo, postLink, platform, mediaType, encodedContent, encodedAuthor, dateStr, platformColor, likes, comments) {
        const lb = document.getElementById('media-lightbox');
        const content = document.getElementById('media-lightbox-content');

        let rawText = encodedContent ? decodeURIComponent(encodedContent) : '';
        let authorName = encodedAuthor ? decodeURIComponent(encodedAuthor) : (platform || 'Competitor');
        let displayDate = dateStr && dateStr !== 'undefined' && dateStr !== 'null' ? dateStr : 'Recent';

        const ytId = window.getYouTubeId(url) || window.getYouTubeId(postLink) || window.getYouTubeId(rawText);
        const isIgReel = (platform === 'Instagram' || (postLink && postLink.includes('instagram.com'))) &&
                         ((postLink && postLink.includes('/reel/')) || (url && url.includes('/reel/')) || mediaType === 'Video' || isVideo);
        const igReelSc = isIgReel ? ((postLink || url || '').match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1]) : null;

        const liActId = (postLink || url || '').match(/activity-(\d+)/)?.[1] ||
                        (postLink || url || '').match(/urn:li:(?:activity|ugcPost|share):(\d+)/)?.[1] ||
                        ((postLink || url || '').includes('linkedin.com') ? (postLink || url || '').match(/(\d{18,19})/)?.[1] : null);

        const isLiVid = (platform === 'LinkedIn' || (postLink && postLink.includes('linkedin.com'))) &&
                        (mediaType === 'Video' || isVideo === true || (url && (url.includes('/playlist/vid/') || url.includes('video.licdn.com') || url.includes('.mp4'))));

        const isDirectVideo = (url && (url.match(/\.(mp4|webm|ogg)(\?|$)/i) || url.includes('.mp4') || url.includes('/playlist/vid/'))) ||
                              (postLink && (postLink.includes('/reel/') || postLink.includes('/watch') || postLink.includes('/videos/')));
        const isVideoMedia = isDirectVideo || isLiVid || (isVideo && (url.includes('.mp4') || url.includes('/playlist/vid/') || mediaType === 'Video'));
        const isFacebookVideo = (platform === 'Facebook' || (postLink && postLink.includes('facebook.com'))) &&
                                (mediaType === 'Video' || isVideo || /\/(?:videos|reel|watch)\b/i.test(postLink || ''));

        let leftMediaHtml = '';

        const isMediaUrl = function(u) {
          if (!u || typeof u !== 'string' || !u.startsWith('http')) return false;
          const lower = u.toLowerCase();
          if (lower.includes('/posts/') || lower.includes('/profile.php') || lower.includes('/feed/update/') || lower.includes('/p/') || lower.includes('/reel/') || lower.includes('/media/?size=')) return false;
          return lower.includes('fbcdn') || lower.includes('fbsbx') || lower.includes('cdninstagram') || lower.includes('licdn') || lower.includes('ytimg') || !!lower.match(/\.(jpeg|jpg|png|gif|webp|svg)(\?|$)/i) || lower.includes('unsplash');
        };

        if (ytId) {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #000; display:flex; align-items:center; justify-content:center; position:relative;">
              <iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1&enablejsapi=1" 
                style="width: 100%; height: 100%; border: 0;" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                referrerpolicy="no-referrer-when-downgrade"
                allowfullscreen></iframe>
            </div>`;
        } else if (isIgReel || (platform === 'Instagram' && (isVideo || mediaType === 'Video'))) {
          const igTarget = (postLink && (postLink.includes('/p/') || postLink.includes('/reel/'))) ? postLink : ((url && (url.includes('/p/') || url.includes('/reel/'))) ? url : postLink || url);
          if (igTarget) {
            leftMediaHtml = `
              <div style="width: 100%; height: 100%; background: #080d1a; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;">
                <iframe src="/api/instagram-embed?url=${encodeURIComponent(igTarget)}" 
                  style="width: 100%; height: 100%; border: 0; background: #080d1a;" 
                  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
                  allowfullscreen scrolling="no"></iframe>
                <a href="${igTarget}" target="_blank" rel="noopener noreferrer" style="position:absolute; right:14px; bottom:14px; z-index:2; padding:8px 12px; border-radius:6px; background:rgba(8,13,26,.86); color:#fff; font-size:12px; font-weight:700; text-decoration:none; border:1px solid rgba(255,255,255,.22);">Open on Instagram ↗</a>
              </div>`;
          }
        } else if (isFacebookVideo && postLink) {
          const fbEmbedUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(postLink)}&show_text=false&width=720`;
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #080d1a; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;">
              <iframe src="${fbEmbedUrl}" style="width:100%; height:100%; border:0; background:#080d1a;" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen scrolling="no"></iframe>
              <a href="${postLink}" target="_blank" rel="noopener noreferrer" style="position:absolute; right:14px; bottom:14px; z-index:2; padding:8px 12px; border-radius:6px; background:rgba(8,13,26,.86); color:#fff; font-size:12px; font-weight:700; text-decoration:none; border:1px solid rgba(255,255,255,.22);">Open on Facebook ↗</a>
            </div>`;
        } else if (isLiVid && liActId) {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #000; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden; border-radius: 8px;">
              <iframe src="/api/linkedin-embed-player?id=${liActId}" 
                style="width: 100%; height: 100%; border: 0; background: #000;" 
                allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
                allowfullscreen 
                scrolling="no"></iframe>
            </div>`;
        } else if (isVideoMedia && (url || postLink)) {
          let mediaTarget = (isLiVid && postLink && (postLink.includes('activity-') || postLink.includes('linkedin.com'))) ? postLink : url;
          let videoSrc = window.getSocialMediaProxyUrl(mediaTarget);
          leftMediaHtml = `<video src="${videoSrc}" controls autoplay preload="auto" playsinline style="width: 100%; max-height: 100%; object-fit: contain; background: #000; border-radius: 8px;"></video>`;
        } else if (isMediaUrl(url)) {
          let imgSrc = window.getSocialMediaProxyUrl(url);
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #080d1a; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 20px;">
              <div style="position: absolute; top: 16px; left: 16px; background: rgba(59, 130, 246, 0.9); color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; z-index: 10; text-transform: uppercase; letter-spacing: 0.05em; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
                ${platformMeta[platform]?.icon || '📷'} ${platform || 'Media'}
              </div>
              <img src="${imgSrc}" referrerpolicy="no-referrer" style="max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; display: block; margin: auto; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);" onerror="this.onerror=null; this.parentElement.innerHTML=\`<div style='text-align:center; padding:40px; color:#ffffff;'><div style='font-size:64px; margin-bottom:16px;'>${platformMeta[platform]?.icon || '🌐'}</div><h3 style='margin:0 0 8px 0;'>${authorName}</h3><p style='color:#94a3b8; margin-bottom:24px;'>Official ${platform} Content</p><a href='${postLink || url}' target='_blank' style='background:${platformColor || '#3b82f6'}; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold;'>View Original Post ↗</a></div>\`;" />
            </div>`;
        } else if (platform === 'Instagram' || (postLink && postLink.includes('instagram.com')) || (url && url.includes('instagram.com'))) {
          const igTarget = (postLink && (postLink.includes('/p/') || postLink.includes('/reel/'))) ? postLink : ((url && (url.includes('/p/') || url.includes('/reel/'))) ? url : postLink || url);
          if (igTarget) {
            leftMediaHtml = `
              <div style="width: 100%; height: 100%; background: #080d1a; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;">
                <iframe src="/api/instagram-embed?url=${encodeURIComponent(igTarget)}" 
                  style="width: 100%; height: 100%; border: 0; background: #080d1a;" 
                  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
                  allowfullscreen scrolling="no"></iframe>
                <a href="${igTarget}" target="_blank" rel="noopener noreferrer" style="position:absolute; right:14px; bottom:14px; z-index:2; padding:8px 12px; border-radius:6px; background:rgba(8,13,26,.86); color:#fff; font-size:12px; font-weight:700; text-decoration:none; border:1px solid rgba(255,255,255,.22);">Open on Instagram ↗</a>
              </div>`;
          } else {
            leftMediaHtml = `
              <div style="width: 100%; height: 100%; background: #1f0516; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px;">
                <div style="width: 88px; height: 88px; border-radius: 50%; background: rgba(225, 48, 108, 0.15); border: 2px solid rgba(225, 48, 108, 0.4); display: flex; align-items: center; justify-content: center; font-size: 44px; margin-bottom: 24px; box-shadow: 0 8px 24px rgba(225, 48, 108, 0.2);">
                  📸
                </div>
                <h3 style="font-size: 1.5rem; font-weight: 700; color: #ffffff; margin: 0 0 8px 0;">${authorName}</h3>
                <p style="font-size: 0.95rem; color: #94a3b8; margin: 0 0 24px 0;">Official Instagram Social Activity</p>
                ${(postLink || url) ? `<a href="${postLink || url}" target="_blank" rel="noopener noreferrer" style="background: #e1306c; color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.95rem; display: inline-flex; align-items: center; gap: 8px;">
                  <span>View Original Post on Instagram</span> ↗
                </a>` : ''}
              </div>`;
          }
        } else if (platform === 'Facebook' || (postLink && postLink.includes('facebook.com'))) {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #0b0f19; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px;">
              <div style="width: 88px; height: 88px; border-radius: 50%; background: rgba(59, 130, 246, 0.15); border: 2px solid rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; font-size: 44px; margin-bottom: 24px; box-shadow: 0 8px 24px rgba(59, 130, 246, 0.2);">
                📘
              </div>
              <h3 style="font-size: 1.5rem; font-weight: 700; color: #ffffff; margin: 0 0 8px 0;">${authorName}</h3>
              <p style="font-size: 0.95rem; color: #94a3b8; margin: 0 0 24px 0;">Official Facebook Social Update</p>
              ${(postLink || url) ? `<a href="${postLink || url}" target="_blank" rel="noopener noreferrer" style="background: #1877f2; color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.95rem; display: inline-flex; align-items: center; gap: 8px;">
                <span>View Original Post on Facebook</span> ↗
              </a>` : ''}
            </div>`;
        } else {
          const platformIcons = { Facebook: '📘', Instagram: '📸', LinkedIn: '💼', YouTube: '▶️' };
          const icon = platformIcons[platform] || '🌐';
          const targetUrl = postLink || url || '';
          leftMediaHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px; width: 100%; height: 100%; background: #0b0f19;">
              <div style="width: 88px; height: 88px; border-radius: 50%; background: ${platformColor || '#3b82f6'}22; border: 1px solid ${platformColor || '#3b82f6'}44; display: flex; align-items: center; justify-content: center; font-size: 44px; margin-bottom: 24px; box-shadow: 0 8px 24px ${platformColor || '#3b82f6'}33;">
                ${icon}
              </div>
              <h3 style="font-size: 1.5rem; font-weight: 700; color: #ffffff; margin: 0 0 8px 0;">${authorName}</h3>
              <p style="font-size: 0.95rem; color: #94a3b8; margin: 0 0 24px 0;">Official ${platform} Social Activity</p>
              ${targetUrl ? `<a href="${targetUrl}" target="_blank" rel="noopener noreferrer" style="background: ${platformColor || '#3b82f6'}; color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.95rem; display: inline-flex; align-items: center; gap: 8px;">
                <span>View Original Post on ${platform}</span> ↗
              </a>` : ''}
            </div>`;
        }

        let likesHtml = likes && likes !== '0' && likes !== 'Hidden' ? `<span>❤️ ${likes}</span>` : '';
        let commentsHtml = comments && comments !== '0' && comments !== 'Hidden' ? `<span>💬 ${comments}</span>` : '';
        let statsBar = (likesHtml || commentsHtml) ? `<div style="display:flex; gap:16px; font-size:0.85rem; color:#94a3b8; margin-top:6px; font-weight:600;">${likesHtml}${commentsHtml}</div>` : '';

        content.innerHTML = `
          <div class="post-preview-dialog">
            <!-- LEFT COLUMN: ACTUAL POST MEDIA (IMAGE / VIDEO) -->
            <div class="post-preview-media">
              ${leftMediaHtml}
            </div>
            <!-- RIGHT COLUMN: POST CAPTION & DETAILS -->
            <div class="post-preview-details">
              <div class="post-preview-header">
                <div>
                  <div class="post-preview-author">${authorName}</div>
                  <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">${displayDate}</div>
                  ${statsBar}
                </div>
                <span style="font-size: 0.65rem; font-weight: 800; padding: 4px 10px; border-radius: 4px; background: ${platformColor || '#3b82f6'}; color: #ffffff; text-transform: uppercase; letter-spacing: 0.05em;">${platform || 'POST'}</span>
              </div>
              <div class="feed-text post-preview-caption">${rawText || 'No caption available for this post.'}</div>
              ${postLink ? `<div class="post-preview-footer">
                <a href="${postLink}" target="_blank" onclick="event.stopPropagation(); window.open(this.href, '_blank'); return false;" style="display: block; width: 100%; padding: 12px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 8px; text-align: center; font-size: 13px; font-weight: 700; color: #60a5fa; text-decoration: none;">View Original Post ↗</a>
              </div>` : ''}
            </div>
          </div>
        `;

        lb.style.display = 'flex';
      };
    }

    const renderCard = (post) => {
      let compName = String(post.company || post.competitorName || 'Competitor').trim();
      let platform = post.platform || post._detectedPlatform || 'Social Feed';
      let meta = platformMeta[platform] || platformMeta['LinkedIn'];

      let dateStr = post.date || post.published_date || post.timestamp;
      if (!dateStr || dateStr === 'undefined' || dateStr === 'null') {
        dateStr = 'Recent';
      } else {
        try {
          let d = new Date(dateStr);
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

      let safeContent = encodeURIComponent(post.caption || post.content || '').replace(/'/g, "%27");
      let safeAuthor = encodeURIComponent(compName).replace(/'/g, "%27");

      let cardThumbHtml = '';
      const ytVidId = post._ytId || window.getYouTubeId(post.post_url || post.link || '') || window.getYouTubeId(post.thumbnail_url || post.mediaUrl || '') || window.getYouTubeId(post.caption || post.content || '');
      let firstMediaUrl = window.extractSingleMediaUrl(post);

      const pLink = post.post_url || post.link || '';
      if (!firstMediaUrl && pLink) {
        firstMediaUrl = pLink;
      }

      const isIgReelCard = (platform === 'Instagram' || post._detectedPlatform === 'Instagram') &&
                           (pLink.includes('/reel/') || post.media_type === 'Video' || post.mediaType === 'Video');

      const isLiVidCard = (platform === 'LinkedIn' || post._detectedPlatform === 'LinkedIn') &&
                          (post.media_type === 'Video' || post.mediaType === 'Video' || (firstMediaUrl && (firstMediaUrl.includes('/playlist/vid/') || firstMediaUrl.includes('video.licdn.com') || firstMediaUrl.includes('thumbnail-with-play-button'))));
      const isFacebookVideoCard = (platform === 'Facebook' || post._detectedPlatform === 'Facebook') &&
                                  (post.media_type === 'Video' || post.mediaType === 'Video' || /\/(?:videos|reel|watch)\b/i.test(pLink));

      if (ytVidId) {
        const ytThumb = `https://img.youtube.com/vi/${ytVidId}/hqdefault.jpg`;
        cardThumbHtml = `
          <div style="margin: 0 0 12px 0; width: 100%; height: 165px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: #080d1a; flex-shrink: 0; position: relative; padding: 0;">
            <img src="${ytThumb}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; border-radius: 8px;" onerror="window.gridVideoFailed(this, '${platform}', '${meta.icon}', '${encodeURIComponent(meta.bg)}');" />
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;background:rgba(255,0,0,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:20px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.6);">▶</div>
          </div>`;
      } else if (isIgReelCard && firstMediaUrl) {
        let proxiedThumb = window.getSocialMediaProxyUrl(firstMediaUrl);
        cardThumbHtml = `
          <div style="margin: 0 0 12px 0; width: 100%; height: 165px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: #080d1a; flex-shrink: 0; position: relative; padding: 0;">
            <img src="${proxiedThumb}" referrerpolicy="no-referrer" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; border-radius: 8px;" onerror="window.gridVideoFailed(this, '${platform}', '${meta.icon}', '${encodeURIComponent(meta.bg)}');" />
            <div style="position:absolute; top:10px; right:10px; background:rgba(225,48,108,0.95); color:white; font-size:10px; font-weight:800; padding:3px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.05em; box-shadow:0 2px 6px rgba(0,0,0,0.5); pointer-events:none;">📹 REEL</div>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;background:rgba(225,48,108,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:20px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.6);">▶</div>
          </div>`;
      } else if (isLiVidCard && firstMediaUrl) {
        let proxiedThumb = window.getSocialMediaProxyUrl(firstMediaUrl);
        cardThumbHtml = `
          <div style="margin: 0 0 12px 0; width: 100%; height: 165px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: #080d1a; flex-shrink: 0; position: relative; padding: 0;">
            <img src="${proxiedThumb}" referrerpolicy="no-referrer" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; border-radius: 8px;" onerror="window.gridVideoFailed(this, '${platform}', '${meta.icon}', '${encodeURIComponent(meta.bg)}');" />
            <div style="position:absolute; top:10px; right:10px; background:rgba(10,102,194,0.95); color:white; font-size:10px; font-weight:800; padding:3px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.05em; box-shadow:0 2px 6px rgba(0,0,0,0.5); pointer-events:none;">📹 VIDEO</div>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;background:rgba(10,102,194,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:20px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.6);">▶</div>
          </div>`;
      } else if (isFacebookVideoCard && firstMediaUrl) {
        let proxiedThumb = window.getSocialMediaProxyUrl(firstMediaUrl);
        cardThumbHtml = `
          <div style="margin: 0 0 12px 0; width: 100%; height: 165px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: #080d1a; flex-shrink: 0; position: relative; padding: 0;">
            <img src="${proxiedThumb}" referrerpolicy="no-referrer" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; border-radius: 8px;" onerror="window.gridVideoFailed(this, '${platform}', '${meta.icon}', '${encodeURIComponent(meta.bg)}');" />
            <div style="position:absolute; top:10px; right:10px; background:rgba(24,119,242,.95); color:white; font-size:10px; font-weight:800; padding:3px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:.05em; box-shadow:0 2px 6px rgba(0,0,0,.5); pointer-events:none;">📹 VIDEO</div>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;background:rgba(24,119,242,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:20px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.6);">▶</div>
          </div>`;
      } else if (firstMediaUrl) {
        let proxiedThumb = window.getSocialMediaProxyUrl(firstMediaUrl);
        cardThumbHtml = `
          <div style="margin: 0 0 12px 0; width: 100%; height: 165px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: #080d1a; flex-shrink: 0; position: relative; padding: 0;">
            <img src="${proxiedThumb}" referrerpolicy="no-referrer" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; border-radius: 8px;" onerror="window.gridVideoFailed(this, '${platform}', '${meta.icon}', '${encodeURIComponent(meta.bg)}');" />
          </div>`;
      } else {
        cardThumbHtml = `
          <div style="margin: 0 0 12px 0; width: 100%; height: 165px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: ${meta.bg}; flex-shrink: 0; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; position:relative;">
            <div style="width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.18); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; font-size:22px; margin-bottom:6px;">${meta.icon}</div>
            <span style="font-size:12px; font-weight:700; color:#ffffff;">${platform}</span>
            <span style="font-size:11px; font-weight:500; color:rgba(255,255,255,0.8); margin-top:2px;">Preview Post ↗</span>
          </div>`;
      }

      let displayContent = (post.caption || post.content || '').trim();
      if (!displayContent || displayContent === 'No caption' || displayContent === 'No caption.') {
        displayContent = platform === 'Facebook' ? 'No public caption is available for this Facebook post.' : `${compName} - ${post.post_url || post.link || platform}`;
      }

      let isMediaVidFlag = isIgReelCard || isLiVidCard || isFacebookVideoCard || post.media_type === 'Video' || post.mediaType === 'Video' || (firstMediaUrl && (firstMediaUrl.includes('mp4') || firstMediaUrl.includes('webm')));
      let mediaToOpen = firstMediaUrl || pLink;
      let likesVal = post.engagement?.likes || post.likes || '';
      let commentsVal = post.engagement?.comments || post.comments || '';

      return `
        <div class="feed-card-item" onclick="window.openLightbox('${mediaToOpen}', ${isMediaVidFlag ? true : false}, '${pLink}', '${platform}', '${post.media_type || post.mediaType || ''}', '${safeContent}', '${safeAuthor}', '${dateStr}', '${meta.color}', '${likesVal}', '${commentsVal}')" style="min-width: 270px; max-width: 280px; flex-shrink: 0; padding: 14px; border-radius: 12px; border: 1px solid var(--border); display: flex; flex-direction: column; height: 380px; box-shadow: var(--shadow-sm); cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease;" onmouseover="this.style.transform='translateY(-3px)'; this.style.borderColor='var(--primary)'" onmouseout="this.style.transform='none'; this.style.borderColor='var(--border)'">
          <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; gap: 6px;">
            <span style="font-size: 0.8rem; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;">${compName}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 0.72rem; color: var(--text-muted);">${dateStr}</span>
              <span style="font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 3px; background: ${meta.badgeBg}; color: #ffffff; text-transform: uppercase;">${platform}</span>
            </div>
          </div>
          ${cardThumbHtml}
          <div style="white-space: pre-wrap; font-size: 0.82rem; line-height: 1.4; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; margin-bottom: 10px; flex: 1;">${displayContent}</div>
          <span style="display: block; text-align: left; font-size: 11px; font-weight: 600; color: #3b82f6; margin-top: auto; padding-top: 6px;">Preview Post In Dashboard ↗</span>
        </div>
      `;
    };

    // Render 4 Distinct Sections (YouTube, Instagram, Facebook, LinkedIn)
    if (ytPosts.length > 0) {
      html += `
        <div>
          <div class="social-section-header">
            <div class="social-section-icon" style="background: rgba(255, 0, 0, 0.15); color: #ff0000;">▶️</div>
            <span>YouTube</span>
            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500; margin-left: 6px;">(${ytPosts.length} posts)</span>
          </div>
          <div class="social-horizontal-row">
            ${ytPosts.map(renderCard).join('')}
          </div>
        </div>
      `;
    }

    if (igPosts.length > 0) {
      html += `
        <div>
          <div class="social-section-header">
            <div class="social-section-icon" style="background: rgba(225, 48, 108, 0.15); color: #e1306c;">📸</div>
            <span>Instagram</span>
            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500; margin-left: 6px;">(${igPosts.length} posts)</span>
          </div>
          <div class="social-horizontal-row">
            ${igPosts.map(renderCard).join('')}
          </div>
        </div>
      `;
    }

    if (fbPosts.length > 0) {
      html += `
        <div>
          <div class="social-section-header">
            <div class="social-section-icon" style="background: rgba(24, 119, 242, 0.15); color: #1877f2;">📘</div>
            <span>Facebook</span>
            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500; margin-left: 6px;">(${fbPosts.length} posts)</span>
          </div>
          <div class="social-horizontal-row">
            ${fbPosts.map(renderCard).join('')}
          </div>
        </div>
      `;
    }

    if (liPosts.length > 0) {
      html += `
        <div>
          <div class="social-section-header">
            <div class="social-section-icon" style="background: rgba(10, 102, 194, 0.15); color: #0a66c2;">💼</div>
            <span>LinkedIn</span>
            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500; margin-left: 6px;">(${liPosts.length} posts)</span>
          </div>
          <div class="social-horizontal-row">
            ${liPosts.map(renderCard).join('')}
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
