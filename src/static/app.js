window.activeProjectUrl = null;
window.currentUser = null;
window.isAnalyzingBusiness = false;

// Keep existing dashboard calls unchanged while attaching the session to every
// protected same-origin request.
const nativeFetch = window.fetch.bind(window);
window.fetch = function(resource, options = {}) {
  const url = typeof resource === 'string' ? resource : resource?.url || '';
  const isProtectedPath = /^\/(?:api(?!\/auth(?:\/|$))|memory|business-intelligence)/.test(url);
  const token = localStorage.getItem('dashboardToken') || localStorage.getItem('adminToken');
  if (!isProtectedPath || !token) return nativeFetch(resource, options);
  const headers = new Headers(options.headers || (typeof resource !== 'string' ? resource.headers : undefined));
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return nativeFetch(resource, { ...options, headers });
};

// Safe JSON parser that intercepts HTML/error pages and proxy timeouts,
// preventing 'Unexpected token <' exceptions.
window.safeParseResponse = async function(res) {
  if (!res) throw new Error("No response received from server");
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!isJson) {
    const rawText = await res.text().catch(() => "");
    if (!res.ok) {
      if (res.status === 504 || res.status === 524) {
        throw new Error(`Server gateway timeout (${res.status}). The operation is continuing in the background.`);
      }
      if (res.status === 502) {
        throw new Error(`Server temporarily unavailable (502). The service is processing requests.`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Authentication or permission error (${res.status}). Please verify you are logged in.`);
      }
      throw new Error(`Server returned HTTP ${res.status}`);
    }
    try {
      return JSON.parse(rawText);
    } catch (_) {
      throw new Error("Unexpected non-JSON response from server");
    }
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error("Invalid JSON response from server");
  }

  if (!res.ok) {
    throw new Error(data && data.error ? data.error : `Request failed with status ${res.status}`);
  }

  return data;
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

window.clearSessionWorkspaceState = function() {
  // 1. Remove project and tab state from localStorage
  localStorage.removeItem('activeProjectUrl');
  localStorage.removeItem('activeTab');
  localStorage.removeItem('activeTabTitle');
  localStorage.removeItem('smmLastResult');
  localStorage.removeItem('smmLastProjectUrl');

  // 2. Clear JavaScript runtime globals
  window.activeProjectUrl = null;
  window.projectMemory = null;
  window.lastTrendingTopic = null;
  window.selectedTrendingTopic = null;

  // 3. Clear URL hash
  if (window.location.hash) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // 4. Reset sidebar project select and delete button
  const globalProjectSelect = document.getElementById('global-project');
  if (globalProjectSelect) {
    globalProjectSelect.value = '';
    globalProjectSelect.dispatchEvent(new CustomEvent('optionsUpdated'));
  }
  const deleteBtn = document.getElementById('btn-global-delete');
  if (deleteBtn) deleteBtn.style.display = 'none';

  // 5. Disable project-specific sidebar tabs until a project is explicitly opened
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    const id = item.id;
    if (id !== 'nav-projects' && id !== 'nav-analyse') {
      item.classList.add('disabled');
      item.onclick = (e) => { e.preventDefault(); return false; };
    }
    item.classList.remove('active');
  });
  const navProjects = document.getElementById('nav-projects');
  if (navProjects) {
    navProjects.classList.remove('disabled');
    navProjects.classList.add('active');
    navProjects.onclick = () => { window.switchTab('projects', 'Projects Overview'); return false; };
  }
  const navAnalyse = document.getElementById('nav-analyse');
  if (navAnalyse) {
    navAnalyse.classList.remove('disabled');
    navAnalyse.onclick = () => { window.switchTab('analyse', 'New Analysis'); return false; };
  }

  // 6. Reset form inputs
  const businessForm = document.getElementById('business-form');
  if (businessForm && typeof businessForm.reset === 'function') businessForm.reset();
  const detailsForm = document.getElementById('details-form');
  if (detailsForm && typeof detailsForm.reset === 'function') detailsForm.reset();

  const websiteUrlInput = document.getElementById('website-url');
  if (websiteUrlInput) websiteUrlInput.value = '';
  const siteUrlInput = document.getElementById('siteUrl');
  if (siteUrlInput) siteUrlInput.value = '';
  const searchInput = document.getElementById('search-projects-input');
  if (searchInput) searchInput.value = '';
  const smmGoal = document.getElementById('smm-custom-goal');
  if (smmGoal) smmGoal.value = '';
  const addCompDetails = document.getElementById('add-competitor-details');
  if (addCompDetails) addCompDetails.open = false;

  // 7. Clear SMM answer container & text
  const smmAnswer = document.getElementById('smm-answer');
  if (smmAnswer) smmAnswer.style.display = 'none';
  const smmText = document.getElementById('smm-text');
  if (smmText) smmText.innerHTML = '';
  const trendingCont = document.getElementById('smm-trending-topics');
  if (trendingCont) {
    trendingCont.style.display = 'none';
    trendingCont.innerHTML = '';
  }

  // 8. Clear SEO container & text
  const seoAnswer = document.getElementById('seo-answer');
  if (seoAnswer) seoAnswer.style.display = 'none';
  const seoText = document.getElementById('seo-text');
  if (seoText) seoText.innerHTML = '';

  // 9. Clear Details, Competitors, and Social Feed containers
  const detailsContent = document.getElementById('details-content');
  if (detailsContent) {
    detailsContent.innerHTML = '<div class="empty-state">Select a project from the Projects Overview to view detailed intelligence.</div>';
  }
  const compList = document.getElementById('competitor-list');
  if (compList) {
    compList.innerHTML = '<div class="empty-state">Click "Find Competitors" to begin market research.</div>';
  }
  const compResults = document.getElementById('competitors-results');
  if (compResults) compResults.innerHTML = '';
  const feedList = document.getElementById('feed-list');
  if (feedList) feedList.innerHTML = '<div class="empty-state">Run the daily tracker to find recent competitor posts.</div>';
  const ownFeedList = document.getElementById('own-feed-list');
  if (ownFeedList) ownFeedList.innerHTML = '<div class="empty-state">Loading company feed...</div>';
  const brandVoice = document.getElementById('brand-voice-pattern-container');
  if (brandVoice) brandVoice.innerHTML = '';
};

window.showRoleHome = async function() {
  const isAdmin = window.currentUser?.role === 'admin';
  const adminCenter = document.getElementById('admin-control-center');
  const dashboard = document.getElementById('dashboard-shell');
  if (adminCenter) adminCenter.style.display = 'none';
  if (dashboard) dashboard.style.display = '';

  const returnToAdmin = document.getElementById('return-admin-center');
  if (returnToAdmin) returnToAdmin.style.display = isAdmin ? 'inline-flex' : 'none';

  if (isAdmin) {
    Promise.all([window.loadDashboardUsers(), window.loadAdminProjects()]).catch(() => {});
  }

  // DEFAULT VIEW ON LOGIN FOR EVERYONE: Projects Overview
  window.switchTab('projects', 'Projects Overview');
  if (typeof window.renderProjectsDirectoryUI === 'function') {
    await window.renderProjectsDirectoryUI();
  }
};

window.openAdminControlCenter = async function() {
  if (window.currentUser?.role !== 'admin') return;
  const adminCenter = document.getElementById('admin-control-center');
  const dashboard = document.getElementById('dashboard-shell');
  if (adminCenter) adminCenter.style.display = 'block';
  if (dashboard) dashboard.style.display = 'none';
  await Promise.all([window.loadDashboardUsers(), window.loadAdminProjects()]);
};

window.returnToAdminCenter = function() {
  window.openAdminControlCenter();
};

window.openDashboardWorkspace = function() {
  const adminCenter = document.getElementById('admin-control-center');
  const dashboard = document.getElementById('dashboard-shell');
  if (adminCenter) adminCenter.style.display = 'none';
  if (dashboard) dashboard.style.display = '';
  window.switchTab('projects', 'Projects Overview');
  if (typeof window.renderProjectsDirectoryUI === 'function') {
    window.renderProjectsDirectoryUI();
  }
};

window.getYouTubeId = function(link) {
  if (!link || typeof link !== 'string') return null;
  var match = link.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
};

window.showSuccess = function(message) {
  const toast = document.getElementById('global-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = '';
  toast.style.color = '';
  toast.style.display = 'block';
  setTimeout(() => toast.style.opacity = '1', 10);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.style.display = 'none', 300);
  }, 3000);
};

window.showError = function(message) {
  const toast = document.getElementById('global-toast');
  if (!toast) {
    alert(message);
    return;
  }
  toast.textContent = message;
  toast.style.background = '#ef4444';
  toast.style.color = '#ffffff';
  toast.style.display = 'block';
  setTimeout(() => toast.style.opacity = '1', 10);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.style.display = 'none';
      toast.style.background = '';
      toast.style.color = '';
    }, 300);
  }, 5000);
};

// On load
document.addEventListener('DOMContentLoaded', async () => {
  // Check and apply theme on load
  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-theme');
  window.updateThemeControls();

  const loginBtn = document.getElementById('login-submit-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.handleAdminLogin(e);
    });
  }

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.handleAdminLogin(e);
      return false;
    });
  }

  const userInput = document.getElementById('login-username');
  const passInput = document.getElementById('login-password');
  [userInput, passInput].forEach(input => {
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.handleAdminLogin(e);
        }
      });
    }
  });

  // Attach direct event listeners for theme toggles and logout buttons
  document.querySelectorAll('#theme-toggle, #admin-theme-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.toggleTheme();
    });
  });

  document.querySelectorAll('#admin-logout-btn, #sidebar-logout-btn, button[onclick*="handleLogout"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.handleLogout();
    });
  });

  const authenticated = await window.checkAuthStatus();
  if (authenticated) {
    await loadProjects();
    if (window.currentUser?.role !== 'admin') await renderProjectsDirectoryUI();
  }
  if (authenticated) await window.showRoleHome();
  setTimeout(initializeCustomSelects, 100);
});

window.handleAdminLogin = async function(event) {
  if (event) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }

  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorDiv = document.getElementById('login-error');
  const btn = document.getElementById('login-submit-btn');

  if (!usernameInput || !passwordInput) return;
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!username || !password) {
    if (errorDiv) {
      errorDiv.textContent = 'Please enter both username and password.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Verifying...';
  }
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    let data;
    try {
      data = await res.json();
    } catch (_jsonErr) {
      data = { success: false, error: 'Unexpected response from server (' + res.status + ')' };
    }

    if (res.ok && data.success) {
      // 1. Wipe any state from previous user session
      window.clearSessionWorkspaceState();

      localStorage.setItem('dashboardToken', data.token);
      localStorage.removeItem('adminToken');
      window.applyCurrentUser(data.user);
      const overlay = document.getElementById('login-overlay');
      if (overlay) overlay.style.display = 'none';

      // Clear login inputs so credentials never leak or persist in DOM
      usernameInput.value = '';
      passwordInput.value = '';

      if (typeof window.showSuccess === 'function') window.showSuccess(`Welcome, ${data.user.username}!`);
      try {
        if (typeof window.loadProjects === 'function') await window.loadProjects();
        await window.showRoleHome();
      } catch (postLoginErr) {
        console.warn('[LOGIN] Post-login UI load warning:', postLoginErr);
      }
    } else {
      if (errorDiv) {
        errorDiv.textContent = data.error || (res.status === 429 ? 'Too many login attempts. Please wait a few minutes.' : 'Invalid credentials');
        errorDiv.style.display = 'block';
      }
    }
  } catch (e) {
    if (errorDiv) {
      errorDiv.textContent = 'Server connection error. Please try again.';
      errorDiv.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Sign In';
    }
  }
};

window.checkAuthStatus = async function() {
  const token = localStorage.getItem('dashboardToken') || localStorage.getItem('adminToken');
  const overlay = document.getElementById('login-overlay');
  if (!token) {
    window.clearSessionWorkspaceState();
    const uInput = document.getElementById('login-username');
    if (uInput) uInput.value = '';
    const pInput = document.getElementById('login-password');
    if (pInput) pInput.value = '';
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
      window.clearSessionWorkspaceState();
      localStorage.removeItem('dashboardToken');
      localStorage.removeItem('adminToken');
      window.applyCurrentUser(null);
      const uInput = document.getElementById('login-username');
      if (uInput) uInput.value = '';
      const pInput = document.getElementById('login-password');
      if (pInput) pInput.value = '';
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
  
  // Wipe session and workspace state completely
  window.clearSessionWorkspaceState();

  localStorage.removeItem('dashboardToken');
  localStorage.removeItem('adminToken');
  window.applyCurrentUser(null);

  const adminCenter = document.getElementById('admin-control-center');
  if (adminCenter) adminCenter.style.display = 'none';
  const dashboard = document.getElementById('dashboard-shell');
  if (dashboard) dashboard.style.display = 'none';

  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'flex';

  const userInput = document.getElementById('login-username');
  if (userInput) userInput.value = '';
  const pwdInput = document.getElementById('login-password');
  if (pwdInput) pwdInput.value = '';
  const errorDiv = document.getElementById('login-error');
  if (errorDiv) errorDiv.style.display = 'none';

  if (typeof window.showSuccess === 'function') window.showSuccess('Logged out successfully');
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
    let users = data.users || [];

    // Auto-restore custom users on platforms with ephemeral container filesystems (e.g. Render)
    try {
      const cached = JSON.parse(localStorage.getItem('managed_users_cache') || '[]');
      if (Array.isArray(cached) && cached.length > 0) {
        const existingSet = new Set(users.map(u => (u.username || '').toLowerCase()));
        let needsRefresh = false;
        for (const cu of cached) {
          if (cu?.username && cu?.password && !existingSet.has(cu.username.toLowerCase())) {
            const addRes = await fetch('/api/admin/users', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: cu.username, password: cu.password, role: cu.role || 'user' })
            });
            if (addRes.ok) {
              needsRefresh = true;
              existingSet.add(cu.username.toLowerCase());
            }
          }
        }
        if (needsRefresh) {
          const refreshed = await fetch('/api/admin/users');
          const refData = await refreshed.json();
          if (refData.users) users = refData.users;
        }
      }
    } catch (_) {}

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
    try {
      const stored = JSON.parse(localStorage.getItem('managed_users_cache') || '[]');
      const filtered = Array.isArray(stored) ? stored.filter(u => (u.username || '').toLowerCase() !== username.toLowerCase()) : [];
      filtered.push({ username, password, role });
      localStorage.setItem('managed_users_cache', JSON.stringify(filtered));
    } catch (_) {}
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
    try {
      const stored = JSON.parse(localStorage.getItem('managed_users_cache') || '[]');
      const filtered = Array.isArray(stored) ? stored.filter(u => (u.username || '').toLowerCase() !== username.toLowerCase()) : [];
      localStorage.setItem('managed_users_cache', JSON.stringify(filtered));
    } catch (_) {}
    window.showSuccess(`User ${username} removed.`);
    await window.loadDashboardUsers();
  } catch (error) { window.showSuccess(error.message || 'Unable to remove user.'); }
};

window.loadAdminProjects = async function(isSilent = false) {
  if (window.currentUser?.role !== 'admin') return;
  const list = document.getElementById('admin-project-list');
  const count = document.getElementById('admin-overview-project-count');
  if (!list) return;

  // Only show the loading placeholder on cold loads when the list is completely empty
  if (!isSilent && (!list.children.length || list.querySelector('.empty-state'))) {
    list.innerHTML = '<div class="empty-state">Loading projects…</div>';
  }

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
      <article class="admin-project-row" data-project-url="${window.escapeHtml(project.url)}">
        <div class="admin-project-main">
          <div class="admin-project-icon">⚡</div>
          <div class="admin-project-details">
            <div class="admin-project-title-row">
              <strong class="admin-project-name" title="${window.escapeHtml(project.name)}">${window.escapeHtml(project.name)}</strong>
            </div>
            <div class="admin-project-meta">
              <span>${window.escapeHtml(project.industry || 'Business intelligence')}</span>
              <span class="meta-dot">·</span>
              <span>${project.competitorCount || 0} competitors</span>
              <span class="meta-dot">·</span>
              <span>${project.postCount || 0} posts</span>
            </div>
          </div>
          <div class="admin-project-quick-actions">
            <button class="btn btn-secondary admin-action-btn" type="button" onclick="window.openAdminProject('${encodeURIComponent(project.url)}')">Open</button>
            <button class="admin-delete-btn" type="button" onclick="window.deleteAdminProject('${encodeURIComponent(project.url)}', '${window.escapeHtml(project.name)}')" title="Delete project and all associated intelligence data">🗑️ Delete</button>
          </div>
        </div>

        <div class="admin-project-footer">
          <div class="admin-project-assignees">
            ${project.assignedTo?.length ? `
              <div class="project-assignees-list">
                <span class="assignee-label">Assigned:</span>
                ${project.assignedTo.map(username => `
                  <span class="project-assignee" data-username="${window.escapeHtml(username)}">
                    ${window.escapeHtml(username)}
                    <button type="button" onclick="window.unassignProject('${encodeURIComponent(username)}','${encodeURIComponent(project.url)}', event)" aria-label="Unassign ${window.escapeHtml(username)}">×</button>
                  </span>
                `).join('')}
              </div>
            ` : '<span class="project-unassigned">Not assigned to a user</span>'}
          </div>
          <div class="project-assignment-control">
            <select id="project-assignee-${project.id}" multiple aria-label="Assign ${window.escapeHtml(project.name)}" data-placeholder="Assign to users…">
              ${assignableUsers.length ? assignableUsers.map(user => { 
                const isAssigned = (project.assignedTo || []).includes(user.username); 
                return `<option value="${window.escapeHtml(user.username)}" ${isAssigned ? 'data-assigned="true"' : ''}>${window.escapeHtml(user.username)}${isAssigned ? ' (Assigned)' : ''}</option>`; 
              }).join('') : '<option value="" disabled>Create a dashboard user first</option>'}
            </select>
            <button class="btn btn-secondary admin-assign-btn" type="button" ${assignableUsers.length ? '' : 'disabled'} onclick="window.assignProject('${encodeURIComponent(project.url)}','project-assignee-${project.id}')">Assign</button>
          </div>
        </div>
      </article>`).join('') : '<div class="empty-state">No saved projects found.</div>';
    setTimeout(initializeCustomSelects, 0);
  } catch (error) {
    if (!isSilent) {
      list.innerHTML = `<div class="empty-state">${window.escapeHtml(error.message || 'Unable to load projects.')}</div>`;
    }
  }
};

window.assignProject = async function(encodedUrl, selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const projectUrl = decodeURIComponent(encodedUrl);
  let usernames = [];
  if (select.multiple) {
    usernames = Array.from(select.selectedOptions).map(o => o.value).filter(Boolean);
  } else if (select.value) {
    usernames = [select.value];
  }

  if (usernames.length === 0) {
    return window.showSuccess('Select at least one user from the dropdown first.');
  }

  // --- Instant Optimistic UI Update (0 ms latency) ---
  const row = select.closest('.admin-project-row');
  const assigneesContainer = row?.querySelector('.admin-project-assignees');
  if (assigneesContainer) {
    const existingBadges = Array.from(assigneesContainer.querySelectorAll('.project-assignee'))
      .map(el => (el.getAttribute('data-username') || el.textContent.replace('×', '').trim()));
    const mergedUsernames = [...new Set([...existingBadges, ...usernames])];

    assigneesContainer.innerHTML = `
      <div class="project-assignees-list">
        <span class="assignee-label">Assigned:</span>
        ${mergedUsernames.map(u => `
          <span class="project-assignee" data-username="${window.escapeHtml(u)}">
            ${window.escapeHtml(u)}
            <button type="button" onclick="window.unassignProject('${encodeURIComponent(u)}','${encodeURIComponent(projectUrl)}', event)" aria-label="Unassign ${window.escapeHtml(u)}">×</button>
          </span>
        `).join('')}
      </div>
    `;

    // Mark options as assigned and deselect them
    select.querySelectorAll('option').forEach(opt => {
      if (usernames.includes(opt.value)) {
        opt.selected = false;
        opt.setAttribute('data-assigned', 'true');
        if (!opt.textContent.includes('(Assigned)')) {
          opt.textContent = `${opt.value} (Assigned)`;
        }
      }
    });

    // Refresh custom select dropdown without disrupting screen
    setTimeout(initializeCustomSelects, 0);
  }

  window.showSuccess(usernames.length === 1 
    ? `Project assigned to ${usernames[0]}.` 
    : `Project assigned to ${usernames.length} users (${usernames.join(', ')}).`);

  try {
    const response = await fetch('/api/admin/projects/assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectUrl, usernames })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to assign project.');

    // Silent background sync
    await window.loadAdminProjects(true);
  } catch (error) {
    try {
      for (const username of usernames) {
        await fetch(`/api/admin/users/${encodeURIComponent(username)}/projects`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectUrl })
        });
      }
      await window.loadAdminProjects(true);
    } catch (fallbackError) {
      window.showSuccess(error.message || 'Unable to assign project.');
      await window.loadAdminProjects(false);
    }
  }
};

window.unassignProject = async function(encodedUsername, encodedUrl, event) {
  const username = decodeURIComponent(encodedUsername);
  const projectUrl = decodeURIComponent(encodedUrl);

  // --- Instant Optimistic UI Update (0 ms latency) ---
  const triggerBtn = event?.target;
  const chip = triggerBtn?.closest('.project-assignee');
  const container = chip?.closest('.admin-project-assignees');
  const row = triggerBtn?.closest('.admin-project-row');

  if (chip) chip.remove();
  if (container && !container.querySelector('.project-assignee')) {
    container.innerHTML = '<span class="project-unassigned">Not assigned to a user</span>';
  }

  // Unmark assigned state in corresponding select dropdown
  if (row) {
    const select = row.querySelector('.project-assignment-control select');
    if (select) {
      select.querySelectorAll('option').forEach(opt => {
        if (opt.value === username) {
          opt.removeAttribute('data-assigned');
          opt.textContent = username;
        }
      });
      setTimeout(initializeCustomSelects, 0);
    }
  }

  window.showSuccess(`Project unassigned from ${username}.`);

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}/projects?projectUrl=${encodeURIComponent(projectUrl)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to unassign project.');

    // Silent background sync
    await window.loadAdminProjects(true);
  } catch (error) {
    window.showSuccess(error.message || 'Unable to unassign project.');
    await window.loadAdminProjects(false);
  }
};

window.openAdminProject = async function(encodedUrl) {
  const url = decodeURIComponent(encodedUrl);
  await window.selectProject(url, true);
  window.openDashboardWorkspace();
  window.switchTab('details', 'Project Details & Review');
};

window.deleteAdminProject = async function(encodedUrl, projectName = '') {
  const url = decodeURIComponent(encodedUrl);
  const nameLabel = projectName ? `"${projectName}"` : 'this project';
  const confirmed = window.confirm(
    `Are you sure you want to permanently delete ${nameLabel} and all its stored data (intelligence profile, reports, and assignments)?\n\nThis action cannot be undone.`
  );
  if (!confirmed) return;

  try {
    window.showSuccess(`Deleting ${nameLabel} and associated data…`);
    const response = await fetch(`/api/admin/projects?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const fbResponse = await fetch(`/api/memory?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
      const fbData = await fbResponse.json().catch(() => ({}));
      if (!fbResponse.ok) throw new Error(data.error || fbData.error || 'Unable to delete project.');
    }

    if (window.activeProjectUrl === url || localStorage.getItem('activeProjectUrl') === url) {
      window.activeProjectUrl = null;
      localStorage.removeItem('activeProjectUrl');
      window.selectProject(null, false, true);
    }

    window.showSuccess('Project and all associated data deleted successfully.');
    await Promise.all([
      window.loadAdminProjects && window.loadAdminProjects(),
      window.renderProjectsDirectoryUI && window.renderProjectsDirectoryUI(),
      window.loadProjects && window.loadProjects(true)
    ]);
  } catch (error) {
    window.showSuccess(error.message || 'Unable to delete project.');
  }
};

window.renderProjectsDirectoryUI = async function() {
  const yourGrid = document.getElementById('your-projects-grid');
  const allGrid = document.getElementById('all-projects-grid');
  const yourCount = document.getElementById('your-projects-count');
  const allCount = document.getElementById('all-projects-count');
  const allOtherSection = document.getElementById('section-all-other-projects') || document.getElementById('all-projects-grid')?.parentElement;
  
  if (!yourGrid || !allGrid) return;
  
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    const projects = data.allProjects || [];
    const isAdmin = window.currentUser?.role === 'admin';
    const assignedProjects = projects.filter(project => project.assigned);
    const otherProjects = projects.filter(project => !project.assigned);
    
    // Both sections are visible to all users: Assigned projects on top, others in bottom
    if (allOtherSection) {
      allOtherSection.style.display = otherProjects.length > 0 ? 'block' : 'none';
    }
    
    if (projects.length === 0) {
      yourGrid.innerHTML = '<div class="empty-state">No active projects found. Click "Start New Analysis" above to analyze a website.</div>';
      if (allGrid) allGrid.innerHTML = '<div class="empty-state">No historical projects found.</div>';
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
      const isAdminUser = window.currentUser?.role === 'admin';
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
            ${isAdminUser ? `
              <button class="admin-card-delete-btn" type="button" onclick="event.stopPropagation(); window.deleteAdminProject('${encodeURIComponent(p.url)}', '${window.escapeHtml(p.name)}')" title="Delete project and all data">
                🗑️ Delete
              </button>
            ` : ''}
          </div>
        </div>
      `;
      }).join('');
    };
    yourGrid.innerHTML = renderProjectCards(assignedProjects, 'No projects are currently assigned to your account. You can explore and work on any project below.');
    if (allGrid) {
      allGrid.innerHTML = renderProjectCards(otherProjects, 'No other projects found.');
    }
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
    const isMultiple = Boolean(select.multiple);
    
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper' + (isMultiple ? ' custom-select-multiple' : '');
    
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
        const text = opt.querySelector('.custom-option-label')?.textContent || opt.textContent || '';
        const match = !filterText || text.toLowerCase().includes(filterText);
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
       
       let selectedText = '';
       let activeVal = select.value || window.activeProjectUrl;
       if (isMultiple) {
         const selectedOpts = Array.from(select.selectedOptions).filter(o => o.value);
         if (selectedOpts.length === 0) {
           selectedText = select.getAttribute('data-placeholder') || 'Assign to users…';
         } else if (selectedOpts.length === 1) {
           selectedText = selectedOpts[0].text.replace(/\s*\(Assigned\)$/i, '');
         } else {
           selectedText = `${selectedOpts.length} users selected`;
         }
       } else {
         let selectedOpt = Array.from(select.options).find(o => o.value === activeVal) ||
           (select.options.length > 0 && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null);
         selectedText = selectedOpt ? selectedOpt.text : 'Select...';
       }
       trigger.innerHTML = `<span>${window.escapeHtml(selectedText)}</span> <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

       const total = optionCount();
       if (total > SEARCH_THRESHOLD) {
         optionsContainer.appendChild(searchInput);
       }

       if (isMultiple && total > 1) {
         const multiActions = document.createElement('div');
         multiActions.className = 'custom-select-multi-actions';
         multiActions.innerHTML = `
           <button type="button" class="custom-select-action-btn multi-select-all">Select All</button>
           <button type="button" class="custom-select-action-btn multi-clear-all">Clear All</button>
         `;
         multiActions.querySelector('.multi-select-all').addEventListener('click', (e) => {
           e.stopPropagation();
           Array.from(select.options).forEach(opt => {
             if (opt.value && opt.style.display !== 'none') opt.selected = true;
           });
           select.dispatchEvent(new Event('change', { bubbles: true }));
           updateOptions();
         });
         multiActions.querySelector('.multi-clear-all').addEventListener('click', (e) => {
           e.stopPropagation();
           Array.from(select.options).forEach(opt => opt.selected = false);
           select.dispatchEvent(new Event('change', { bubbles: true }));
           updateOptions();
         });
         optionsContainer.appendChild(multiActions);
       }

       Array.from(select.options).forEach(opt => {
          if (opt.style.display === 'none') return;
          if (isMultiple && !opt.value) return;
          
          const optionDiv = document.createElement('div');
          
          if (isMultiple) {
            optionDiv.className = 'custom-option multi-option' + (opt.selected ? ' selected' : '');
            const isAssigned = opt.getAttribute('data-assigned') === 'true';
            optionDiv.innerHTML = `
              <input type="checkbox" class="custom-option-checkbox" ${opt.selected ? 'checked' : ''} />
              <span class="custom-option-label">${window.escapeHtml(opt.text.replace(/\s*\(Assigned\)$/i, ''))}</span>
              ${isAssigned ? '<span class="custom-option-assigned-badge">Assigned</span>' : ''}
            `;
            optionDiv.addEventListener('click', (e) => {
               e.stopPropagation();
               opt.selected = !opt.selected;
               select.dispatchEvent(new Event('change', { bubbles: true }));
               updateOptions();
            });
          } else {
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
               const row = wrapper.closest('.admin-project-row');
               if (row) row.classList.remove('dropdown-open');
               updateOptions();
            });
          }
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
      const height = Math.min(260, optionsContainer.scrollHeight || 260);
      if (spaceBelow < height + 8) wrapper.classList.add('open-up');
    };

    trigger.addEventListener('click', (e) => {
       e.stopPropagation();
       const willOpen = !wrapper.classList.contains('open');
       document.querySelectorAll('.custom-select-wrapper').forEach(w => {
          if (w !== wrapper) w.classList.remove('open');
       });
       document.querySelectorAll('.admin-project-row.dropdown-open').forEach(r => r.classList.remove('dropdown-open'));

       wrapper.classList.toggle('open', willOpen);
       const row = wrapper.closest('.admin-project-row');
       if (row) row.classList.toggle('dropdown-open', willOpen);

       if (willOpen) {
         setTimeout(() => { searchInput.value = ''; filterText = ''; applyFilter(); }, 0);
         positionDropdown();
       }
    });
    
    wrapper.appendChild(trigger);
    wrapper.appendChild(optionsContainer);
    select.parentNode.insertBefore(wrapper, select.nextSibling);
    
    select.addEventListener('change', () => updateOptions());
    select.addEventListener('optionsUpdated', () => updateOptions());
    select.addEventListener('focus', () => {
      wrapper.classList.add('open');
      const row = wrapper.closest('.admin-project-row');
      if (row) row.classList.add('dropdown-open');
      positionDropdown();
    });
    
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
       document.querySelectorAll('.admin-project-row.dropdown-open').forEach(r => r.classList.remove('dropdown-open'));
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
  'projects': 'Projects Overview',
  'analyse': 'New Analysis',
  'details': 'Project Details & Review',
  'competitors': 'Competitor Intelligence',
  'smm': 'SMM Generation',
  'seo': 'Website & SEO',
  'social-feed': 'Competitor Feed'
};

window.restoreActiveTab = function() {
  const hash = window.location.hash ? window.location.hash.replace('#', '') : null;
  let savedTab = hash || localStorage.getItem('activeTab');

  // If the user has an active project and tab is unset,
  // show their project data. Otherwise default to Projects Overview.
  if (window.activeProjectUrl && !savedTab) {
    savedTab = 'details';
  } else if (!savedTab) {
    savedTab = 'projects';
  }

  const savedTitle = TAB_TITLES[savedTab] || localStorage.getItem('activeTabTitle') || 'Projects Overview';

  const navEl = document.getElementById('nav-' + savedTab);
  if (!navEl || (savedTab !== 'analyse' && savedTab !== 'projects' && navEl.classList.contains('disabled'))) {
    if (window.activeProjectUrl) {
      window.switchTab('details', TAB_TITLES['details']);
    } else {
      window.switchTab('projects', 'Projects Overview');
    }
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
  if (name === 'projects') { if (window.renderProjectsDirectoryUI) window.renderProjectsDirectoryUI(); }
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
  window.selectProject(url, false, true);
};

window.loadProjects = async function(isSilent = false) {
  try {
    const res = await fetch('/api/sites');
    if (!res.ok) return;
    const sites = await res.json();
    if (!Array.isArray(sites)) return;
    const select = document.getElementById('global-project');
    if (!select) return;

    const currentVal = window.activeProjectUrl || localStorage.getItem('activeProjectUrl') || select.value;

    const siteMap = new Map();
    sites.forEach(s => siteMap.set(s.url, s.name));

    // CRITICAL FIX: If currentVal is NOT in sites returned by the server,
    // the project was DELETED or UNASSIGNED. DO NOT add it back to siteMap!
    let activeSiteUrl = currentVal;
    if (!window.isAnalyzingBusiness && currentVal && !siteMap.has(currentVal)) {
      activeSiteUrl = null;
      window.activeProjectUrl = null;
      localStorage.removeItem('activeProjectUrl');
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
        if (u === activeSiteUrl) opt.selected = true;
        frag.appendChild(opt);
      });

      const oldOnChange = select.onchange;
      select.onchange = null;
      select.innerHTML = '';
      select.appendChild(frag);
      select.value = activeSiteUrl || "";
      select.onchange = oldOnChange;

      select.dispatchEvent(new CustomEvent('optionsUpdated'));
    } else {
      if (select.value !== (activeSiteUrl || "")) {
        select.value = activeSiteUrl || "";
        select.dispatchEvent(new CustomEvent('optionsUpdated'));
      }
    }

    if (activeSiteUrl && siteMap.has(activeSiteUrl)) {
      window.selectProject(activeSiteUrl, false, isSilent);
    } else {
      select.value = "";
      select.dispatchEvent(new CustomEvent('optionsUpdated'));
      window.selectProject(null, false, true);
    }
  } catch (err) {
    console.error("Failed to load projects:", err);
  }
};

window.selectProject = function(url, autoSwitchTab = false, isSilent = false) {
  window.activeProjectUrl = url;
  if (url) localStorage.setItem('activeProjectUrl', url);
  else localStorage.removeItem('activeProjectUrl');

  const deleteBtn = document.getElementById('btn-global-delete');

  if (!url) {
    if (deleteBtn) deleteBtn.style.display = 'none';
    // Disable project-specific tabs, leaving nav-projects and nav-analyse enabled
    document.querySelectorAll('.sidebar-nav .nav-item:not(#nav-analyse):not(#nav-projects)').forEach(el => {
      el.classList.add('disabled');
      el.onclick = (e) => { e.preventDefault(); return false; };
    });
    const navProjects = document.getElementById('nav-projects');
    if (navProjects) {
      navProjects.classList.remove('disabled');
      navProjects.onclick = () => { switchTab('projects', 'Projects Overview'); return false; };
    }
    const navAnalyse = document.getElementById('nav-analyse');
    if (navAnalyse) {
      navAnalyse.classList.remove('disabled');
      navAnalyse.onclick = () => { switchTab('analyse', 'New Analysis'); return false; };
    }
    return;
  }

  if (deleteBtn) deleteBtn.style.display = window.currentUser?.role === 'admin' ? 'block' : 'none';

  // Enable tabs
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
    el.classList.remove('disabled');
  });

  // Re-bind onclick
  const navProjects = document.getElementById('nav-projects');
  if (navProjects) navProjects.onclick = () => { switchTab('projects', 'Projects Overview'); return false; };
  const navAnalyse = document.getElementById('nav-analyse');
  if (navAnalyse) navAnalyse.onclick = () => { switchTab('analyse', 'New Analysis'); return false; };
  const navDetails = document.getElementById('nav-details');
  if (navDetails) navDetails.onclick = () => { switchTab('details', 'Project Details & Review'); return false; };
  const navComp = document.getElementById('nav-competitors');
  if (navComp) navComp.onclick = () => { switchTab('competitors', 'Competitor Intelligence'); return false; };
  const navSmm = document.getElementById('nav-smm');
  if (navSmm) navSmm.onclick = () => { switchTab('smm', 'SMM Generation'); return false; };
  const navSeo = document.getElementById('nav-seo');
  if (navSeo) navSeo.onclick = () => { switchTab('seo', 'Website & SEO'); return false; };
  const navFeed = document.getElementById('nav-social-feed');
  if (navFeed) navFeed.onclick = () => { switchTab('social-feed', 'Competitor Feed'); return false; };

  if (autoSwitchTab) {
    switchTab('details', 'Project Details & Review');
  } else if (!isSilent) {
    // Only reload tab-specific UI when NOT in silent mode (i.e., not from live sync)
    const activeTab = localStorage.getItem('activeTab');
    if (!activeTab || activeTab === 'details') {
      if (typeof loadProjectDetails === 'function') loadProjectDetails();
    } else if (activeTab === 'smm' && window.loadSmmUI) {
      window.loadSmmUI();
    } else if (activeTab === 'competitors' && typeof window.loadCompetitorsUI === 'function') {
      window.loadCompetitorsUI();
    } else if (activeTab === 'social-feed' && typeof window.loadFeedUI === 'function') {
      window.loadFeedUI();
    }
  }
};

// ---- Live Synchronization Engine ----
let _liveSyncInterval = null;
function startLiveSync() {
  if (_liveSyncInterval) clearInterval(_liveSyncInterval);
  _liveSyncInterval = setInterval(async () => {
    // If business intelligence analysis is running, do not interfere with active project or sync memory
    if (window.isAnalyzingBusiness) return;

    // Keep sidebar projects dropdown synced live
    await window.loadProjects(true);

    if (!window.activeProjectUrl || window.isAnalyzingBusiness) return;
    try {
      const res = await fetch(`/api/memory?url=${encodeURIComponent(window.activeProjectUrl)}`);
      if (!res.ok) {
        if (res.status === 404 || res.status === 403) {
          if (window.isAnalyzingBusiness) return;
          // Project was deleted or unassigned! Clean up state immediately
          window.activeProjectUrl = null;
          localStorage.removeItem('activeProjectUrl');
          window.selectProject(null, false, true);
          await window.loadProjects(true);
          if (window.renderProjectsDirectoryUI) await window.renderProjectsDirectoryUI();
        }
        return;
      }
      const data = await res.json();
      if (!data.memory) return;
      
      const newMem = data.memory;
      const oldMem = window.projectMemory;
      
      // Preserve any richer competitor footprint already discovered in this session
      if (Array.isArray(oldMem?.competitors) && oldMem.competitors.length > (newMem.competitors?.length || 0)) {
        const compMap = new Map();
        for (const c of oldMem.competitors) {
          if (c?.url) compMap.set(c.url.toLowerCase(), c);
        }
        for (const c of (newMem.competitors || [])) {
          if (c?.url) compMap.set(c.url.toLowerCase(), c);
        }
        newMem.competitors = Array.from(compMap.values());
      }

      const compCountChanged = (newMem.competitors?.length || 0) !== (oldMem?.competitors?.length || 0);
      const feedCountChanged = (newMem.socialFeed?.length || 0) !== (oldMem?.socialFeed?.length || 0);
      
      window.projectMemory = newMem;
      
      const activeTab = localStorage.getItem('activeTab');
      if (compCountChanged && activeTab === 'competitors' && !window._isFindingCompetitors) {
        loadCompetitorsUI();
      }
      if (feedCountChanged && activeTab === 'social-feed' && !_trackerPollInterval) {
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
    if (window.updateSmmAntiRepetitionBadge) window.updateSmmAntiRepetitionBadge();
    
    document.getElementById('edit-name').value = mem.businessIdentity?.officialName || '';
    document.getElementById('edit-industry').value = mem.businessIdentity?.industry || '';
    document.getElementById('edit-subindustry').value = mem.businessIdentity?.subIndustry || '';
    document.getElementById('edit-location').value = mem.businessIdentity?.location || '';
    document.getElementById('edit-vision').value = mem.businessIdentity?.vision || '';
    document.getElementById('edit-description').value = mem.businessIdentity?.description || '';
    
    document.getElementById('edit-products').value = (mem.offerings?.products || []).map(p => typeof p === 'string' ? p : p.name).join(', ');
    document.getElementById('edit-services').value = (mem.offerings?.services || []).map(s => typeof s === 'string' ? s : s.name).join(', ');
    document.getElementById('edit-audience').value = (mem.audience?.buyerPersonas || []).join(', ');

    // Official Company Social Media Accounts
    const socials = mem.ownSocials || {};
    if (document.getElementById('edit-own-li')) document.getElementById('edit-own-li').value = socials.linkedin || '';
    if (document.getElementById('edit-own-ig')) document.getElementById('edit-own-ig').value = socials.instagram || '';
    if (document.getElementById('edit-own-yt')) document.getElementById('edit-own-yt').value = socials.youtube || '';
    if (document.getElementById('edit-own-fb')) document.getElementById('edit-own-fb').value = socials.facebook || '';
    
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
    },
    ownSocials: {
      linkedin: document.getElementById('edit-own-li')?.value?.trim() || null,
      instagram: document.getElementById('edit-own-ig')?.value?.trim() || null,
      youtube: document.getElementById('edit-own-yt')?.value?.trim() || null,
      facebook: document.getElementById('edit-own-fb')?.value?.trim() || null,
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
      if (updates.businessIdentity?.officialName) {
        window.addOrUpdateProjectInSidebar(window.activeProjectUrl, updates.businessIdentity.officialName);
      }
      try {
        const memRes = await fetch(`/api/memory?url=${encodeURIComponent(window.activeProjectUrl)}`);
        const memData = await memRes.json();
        if (memData.memory) {
          window.projectMemory = memData.memory;
          if (window.updateSmmPersonas) window.updateSmmPersonas();
          if (window.updateSmmSuboptions) window.updateSmmSuboptions();
        }
      } catch (_) {}
    }
  } catch (e) {
    console.error("Failed to save details:", e);
  }
};

window.deleteProjectDetails = async function() {
  if (window.currentUser?.role !== 'admin') return;
  if (!window.activeProjectUrl) return;
  const projectUrlToDelete = window.activeProjectUrl;
  await window.deleteAdminProject(encodeURIComponent(projectUrlToDelete));
  if (!window.activeProjectUrl) {
    window.switchTab('projects', 'Projects Overview');
  }
};

// ---- Run Intelligence ----
window.runIntelligence = async function() {
  const form = document.getElementById('business-form');
  const urlInput = document.getElementById('website-url');
  let url = urlInput ? urlInput.value.trim() : '';
  if (!url) return;

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
    if (urlInput) urlInput.value = url;
  }

  window.isAnalyzingBusiness = true;
  document.getElementById('loading-overlay').style.display = 'flex';
  const statusEl = document.getElementById('agent-status');
  if (statusEl) statusEl.innerText = 'Connecting to AI intelligence engine...';

  const formData = new FormData(form);
  formData.set('websiteUrl', url);

  let hasCompleted = false;
  let streamError = null;

  try {
    const res = await fetch('/api/analyze-stream', {
      method: 'POST',
      body: formData
    });
    
    if (!res.ok) {
      let errText = `HTTP error ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error) errText = errJson.error;
      } catch (_) {}
      throw new Error(errText);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const processSSEChunk = async (chunk) => {
      const trimmed = (chunk || "").trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      let data;
      try {
        data = JSON.parse(trimmed.replace(/^data:\s*/, ''));
      } catch (jsonErr) {
        console.debug("SSE JSON chunk parsing wait:", jsonErr);
        return;
      }

      if (data.type === 'heartbeat') {
        return;
      }

      if (data.type === 'error') {
        streamError = data.error || 'Analysis failed';
        throw new Error(streamError);
      }

      if (data.type === 'progress') {
        if (statusEl) {
          statusEl.innerText = data.step || data.message || 'Processing...';
          statusEl.style.animation = 'none';
          void statusEl.offsetWidth; // trigger reflow
          statusEl.style.animation = 'pulse 1s ease';
        }
        if (data.partial) {
          if (data.partial.businessIdentity) {
            const id = data.partial.businessIdentity;
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
        hasCompleted = true;
        window.isAnalyzingBusiness = false;
        window.showSuccess("Business intelligence fully analyzed!");
        
        const finalUrl = (data.profile && data.profile.input && data.profile.input.websiteUrl) ? data.profile.input.websiteUrl : url;
        const officialName = (data.profile && data.profile.businessIdentitySummary && data.profile.businessIdentitySummary.officialName) || finalUrl;

        // Register in sidebar
        window.addOrUpdateProjectInSidebar(finalUrl, officialName);
        await loadProjects(true);
        const globalProj = document.getElementById('global-project');
        if (globalProj) globalProj.value = finalUrl;
        window.selectProject(finalUrl, false, false);
        switchTab('details', 'Project Details & Review');
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      
      let lines = buffer.split(/\r?\n\r?\n/);
      buffer = lines.pop(); // Keep incomplete chunk
      
      for (const line of lines) {
        await processSSEChunk(line);
        if (hasCompleted) return;
      }
    }

    // Process any remaining chunk left in buffer upon stream close
    if (buffer && buffer.trim()) {
      await processSSEChunk(buffer);
      if (hasCompleted) return;
    }

    if (!hasCompleted) {
      if (statusEl) {
        statusEl.innerText = "Finalizing business analysis on server...";
      }

      const pollStart = Date.now();
      const normalizedTarget = url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

      // Resilient long-polling for up to 6 minutes (360s) to handle deep intelligence & reverse proxy timeouts
      while (Date.now() - pollStart < 360000) {
        await new Promise(r => setTimeout(r, 2500));
        try {
          // 1. Check live job status from server
          const statusRes = await fetch(`/api/analyze-status?url=${encodeURIComponent(url)}`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.step && statusEl) {
              const elapsed = statusData.elapsedSec ? ` [${statusData.elapsedSec}s]` : '';
              statusEl.innerText = `${statusData.step}${elapsed}`;
            }
            if (statusData.partial) {
              if (statusData.partial.businessIdentity) {
                const id = statusData.partial.businessIdentity;
                if (document.getElementById('edit-name') && id.officialName) document.getElementById('edit-name').value = id.officialName;
                if (document.getElementById('edit-industry') && id.industry) document.getElementById('edit-industry').value = id.industry;
                if (document.getElementById('edit-subindustry') && id.subIndustry) document.getElementById('edit-subindustry').value = id.subIndustry;
                if (document.getElementById('edit-location') && id.location) document.getElementById('edit-location').value = id.location;
              }
              if (statusData.partial.offerings) {
                const off = statusData.partial.offerings;
                if (document.getElementById('edit-products') && off.products) {
                  document.getElementById('edit-products').value = off.products.map(p => typeof p === 'string' ? p : p.name).join(', ');
                }
              }
            }
            if (statusData.completed) {
              hasCompleted = true;
              window.isAnalyzingBusiness = false;
              const finalUrl = (statusData.profile && statusData.profile.input && statusData.profile.input.websiteUrl) ? statusData.profile.input.websiteUrl : url;
              const officialName = (statusData.profile && statusData.profile.businessIdentitySummary && statusData.profile.businessIdentitySummary.officialName) || finalUrl;

              window.addOrUpdateProjectInSidebar(finalUrl, officialName);
              await loadProjects(true);
              const globalProj = document.getElementById('global-project');
              if (globalProj) globalProj.value = finalUrl;
              window.selectProject(finalUrl, false, false);
              switchTab('details', 'Project Details & Review');
              window.showSuccess("Business intelligence fully analyzed and saved!");
              return;
            }
            if (statusData.error) {
              throw new Error(statusData.error);
            }
          }

          // 2. Fallback check projects list in case project was saved directly
          await loadProjects(true);
          const projectSelect = document.getElementById('global-project');
          const match = Array.from(projectSelect?.options || []).find(o => {
            const norm = (o.value || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
            return norm === normalizedTarget || norm.includes(normalizedTarget) || normalizedTarget.includes(norm);
          });

          if (match && match.value) {
            hasCompleted = true;
            window.isAnalyzingBusiness = false;
            if (projectSelect) projectSelect.value = match.value;
            window.selectProject(match.value, false, false);
            switchTab('details', 'Project Details & Review');
            window.showSuccess("Business intelligence analyzed and saved!");
            return;
          }
        } catch (pollErr) {
          if (pollErr.message && !pollErr.message.includes('Failed to fetch') && !pollErr.message.includes('NetworkError')) {
            throw pollErr;
          }
        }
      }

      throw new Error(streamError || "Analysis timed out after 6 minutes. Please check your server or connection.");
    }
  } catch (e) {
    console.error("Intelligence analysis error:", e);
    
    // Check if background analysis finished or saved even if the SSE stream disconnected
    const isNetworkErr = e.message && (
      e.message.toLowerCase().includes('network') ||
      e.message.toLowerCase().includes('failed to fetch') ||
      e.message.toLowerCase().includes('closed') ||
      e.message.toLowerCase().includes('unexpectedly') ||
      e.name === 'TypeError'
    );

    if (isNetworkErr) {
      try {
        const finalStatus = await fetch(`/api/analyze-status?url=${encodeURIComponent(url)}`).then(r => r.json()).catch(() => null);
        if (finalStatus && finalStatus.completed) {
          hasCompleted = true;
          window.isAnalyzingBusiness = false;
          await loadProjects(true);
          const projectSelect = document.getElementById('global-project');
          if (projectSelect) projectSelect.value = url;
          window.selectProject(url, false, true);
          switchTab('details', 'Project Details & Review');
          window.showSuccess("Analysis was saved successfully!");
          return;
        }

        await loadProjects();
        const projectSelect = document.getElementById('global-project');
        let domain = url;
        try { domain = new URL(url).hostname; } catch (_) {}
        const match = Array.from(projectSelect.options).find(o => o.value === url || o.value.includes(domain));
        if (match) {
          window.isAnalyzingBusiness = false;
          projectSelect.value = match.value;
          window.selectProject(match.value, false, true);
          switchTab('details', 'Project Details & Review');
          window.showSuccess("Analysis was saved successfully!");
          return;
        }
      } catch (_) {}
    }

    if (typeof window.showError === 'function') {
      window.showError("Analysis error: " + (e.message || "Connection interrupted. Please try again."));
    } else {
      alert("Analysis error: " + (e.message || "Connection interrupted. Please try again."));
    }
  } finally {
    window.isAnalyzingBusiness = false;
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

window.extractCommonProducts = function(c) {
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

window.renderCompetitorCard = function(c) {
  let href = c.url || '#';
  if (href !== '#' && !href.startsWith('http')) href = 'https://' + href;
  const commonProds = window.extractCommonProducts(c);

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
    <div id="live-comp-cards" style="grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 16px;"></div>
  `;
  
  // Hide buttons while loading
  const btnFind = document.getElementById('btn-find-comp');
  const btnRegen = document.getElementById('btn-regen-comp');
  const btnBackfill = document.getElementById('btn-backfill-socials');
  if (btnFind) btnFind.style.display = 'none';
  if (btnRegen) btnRegen.style.display = 'none';
  if (btnBackfill) btnBackfill.style.display = 'none';
  
  const scope = document.getElementById('comp-scope')?.value || 'all';
  const liveCompetitors = [];
  let streamEndedNormally = false;

  try {
    const res = await fetch('/api/competitors-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: window.activeProjectUrl, scope, force: Boolean(force) })
    });

    if (!res.ok) {
      let errText = `HTTP error ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error) errText = errJson.error;
      } catch (_) {}
      throw new Error(errText);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let lastChunkTime = Date.now();
    const inactivityWatchdog = setInterval(() => {
      // If 90 seconds pass without any chunk or heartbeat from the server, terminate reader
      if (Date.now() - lastChunkTime > 90000) {
        console.warn("Competitor stream inactivity watchdog fired (90s idle).");
        clearInterval(inactivityWatchdog);
        try { reader.cancel(); } catch (_) {}
      }
    }, 2000);

    const processCompetitorSSEChunk = (line) => {
      const trimmed = (line || "").trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      try {
        const jsonStr = trimmed.replace(/^data:\s*/, '');
        const data = JSON.parse(jsonStr);
        if (data.type === 'error') {
          throw new Error(data.error || 'Competitor stream failed');
        }
        if (data.type === 'progress') {
          const statusEl = document.getElementById('comp-agent-status');
          if (statusEl && data.status) statusEl.innerText = data.status;
        }
        if (data.type === 'competitor' && data.competitor) {
          liveCompetitors.push(data.competitor);
          if (!window.projectMemory) window.projectMemory = {};
          if (!Array.isArray(window.projectMemory.competitors)) window.projectMemory.competitors = [];
          if (!window.projectMemory.competitors.some(c => c.url === data.competitor.url)) {
            window.projectMemory.competitors.push(data.competitor);
          }
          const statusEl = document.getElementById('comp-agent-status');
          if (statusEl) {
            const norm = (t) => (t || '').toLowerCase().trim();
            const localCount = liveCompetitors.filter(c => norm(c.type) === 'local').length;
            const regCount = liveCompetitors.filter(c => norm(c.type) === 'regional').length;
            const globCount = liveCompetitors.filter(c => norm(c.type) === 'global').length;
            statusEl.innerText = `Discovered ${liveCompetitors.length} competitors (${localCount} local, ${regCount} regional, ${globCount} global) — Latest: ${data.competitor.name}`;
          }
          loadCompetitorsUI(true, liveCompetitors);
        }
        if (data.type === 'complete') {
          streamEndedNormally = true;
          window.showSuccess("Competitors successfully extracted!");
          const header = document.getElementById('live-comp-header');
          if (header) header.remove();
        }
      } catch(err) {
        console.error("Competitor SSE parse error", err);
        if (line.includes('"type":"error"')) {
          throw err;
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lastChunkTime = Date.now();
        buffer += decoder.decode(value, { stream: true });
        
        let lines = buffer.split(/\r?\n\r?\n/);
        buffer = lines.pop(); // Keep incomplete chunk
        
        for (const line of lines) {
          processCompetitorSSEChunk(line);
          if (streamEndedNormally) break;
        }
        if (streamEndedNormally) break;
      }

      // Flush trailing buffer
      if (buffer && buffer.trim()) {
        processCompetitorSSEChunk(buffer);
      }
    } finally {
      clearInterval(inactivityWatchdog);
    }

    // If stream disconnected or closed prematurely without 'complete', seamlessly poll background engine until completed
    if (!streamEndedNormally) {
      const statusEl = document.getElementById('comp-agent-status');
      if (statusEl) {
        statusEl.innerText = "Synchronizing live discovery with background engine...";
      }

      const pollStart = Date.now();
      while (Date.now() - pollStart < 360000) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const statusRes = await fetch(`/api/competitor-status?url=${encodeURIComponent(window.activeProjectUrl)}`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.step && statusEl) {
              const elapsed = statusData.elapsedSec ? ` [${statusData.elapsedSec}s]` : '';
              statusEl.innerText = `${statusData.step}${elapsed}`;
            }
            if (Array.isArray(statusData.competitors) && statusData.competitors.length > 0) {
              let newlyAdded = false;
              for (const c of statusData.competitors) {
                if (c?.url && !liveCompetitors.some(lc => lc.url === c.url)) {
                  liveCompetitors.push(c);
                  newlyAdded = true;
                }
              }
              if (newlyAdded) {
                await loadCompetitorsUI(true, liveCompetitors);
              }
            }
            if (statusData.completed) {
              streamEndedNormally = true;
              window.showSuccess("Competitors successfully extracted!");
              break;
            }
            if (statusData.error) {
              throw new Error(statusData.error);
            }
          }
        } catch (pollErr) {
          console.debug("Competitor poll warning:", pollErr);
        }
      }
    }
  } catch (e) {
    console.error("Competitor discovery error:", e);
    if (typeof window.showError === 'function') {
      window.showError("Competitor discovery error: " + (e.message || "Connection interrupted."));
    }
  } finally {
    window._isFindingCompetitors = false;
    const header = document.getElementById('live-comp-header');
    if (header) header.remove();
    // If live competitors were found, sync them into window.projectMemory so they are never lost
    if (liveCompetitors.length > 0) {
      if (!window.projectMemory) window.projectMemory = {};
      const compMap = new Map();
      for (const c of (window.projectMemory.competitors || [])) {
        if (c?.url) compMap.set(c.url.toLowerCase(), c);
      }
      for (const c of liveCompetitors) {
        if (c?.url) compMap.set(c.url.toLowerCase(), c);
      }
      window.projectMemory.competitors = Array.from(compMap.values());
    }
    // Always refresh UI so loading animation is replaced by final categorized list and buttons are restored
    await loadCompetitorsUI(false, liveCompetitors);
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

async function loadCompetitorsUI(isLivePartial = false, fallbackCompetitors = null) {
  if (!window.activeProjectUrl) return;
  const list = document.getElementById('competitor-list');
  if (!window._isFindingCompetitors && !isLivePartial) {
    const header = document.getElementById('live-comp-header');
    if (header) header.remove();
  }
  
  try {
    const res = await fetch(`/api/competitors?url=${encodeURIComponent(window.activeProjectUrl)}`);
    const data = await res.json();
    
    const serverComps = (res.ok && Array.isArray(data.competitors)) ? data.competitors : [];
    
    // Build resilient union across all sources so discovered competitors are NEVER lost or collapsed
    const compMap = new Map();
    const getCompKey = (c) => {
      if (!c || !c.url) return '';
      try {
        const u = c.url.startsWith('http') ? c.url : 'https://' + c.url;
        const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
        return h;
      } catch {
        return (c.url || '').toLowerCase().trim();
      }
    };

    // 1. Existing memory
    if (Array.isArray(window.projectMemory?.competitors)) {
      for (const c of window.projectMemory.competitors) {
        const k = getCompKey(c);
        if (k) compMap.set(k, c);
      }
    }

    // 2. Streamed / fallback competitors
    if (Array.isArray(fallbackCompetitors)) {
      for (const c of fallbackCompetitors) {
        const k = getCompKey(c);
        if (k) compMap.set(k, c);
      }
    }

    // 3. Server competitors
    for (const c of serverComps) {
      const k = getCompKey(c);
      if (k) compMap.set(k, c);
    }

    let competitors = Array.from(compMap.values()).filter(c => {
      if (!c || !c.socials) return false;
      const count = Object.values(c.socials).filter(v => typeof v === 'string' && v.trim().length > 0).length;
      return count >= 2;
    });
    if (competitors.length > 0) {
      if (!window.projectMemory) window.projectMemory = {};
      window.projectMemory.competitors = competitors;
    }

    // If client has more competitors than the server returned, sync them to server
    if (competitors.length > serverComps.length && res.ok && window.activeProjectUrl) {
      fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: window.activeProjectUrl, updates: { competitors } })
      }).catch(err => console.debug("Client-side competitor sync warning:", err));
    }

    if (!res.ok && competitors.length === 0) {
      const errMsg = data.error || `HTTP ${res.status} error loading competitors`;
      list.innerHTML = `<div class="empty-state" style="color:var(--danger, #ef4444); border-color:rgba(239,68,68,0.2);">⚠️ ${errMsg}</div>`;
      document.getElementById('btn-find-comp').style.display = 'inline-block';
      document.getElementById('btn-regen-comp').style.display = 'none';
      document.getElementById('btn-backfill-socials').style.display = 'none';
      return;
    }
    
    if (competitors.length === 0) {
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
    
    const norm = (t) => (t || '').toLowerCase().trim();
    const sortByOverlap = (a, b) => {
      const countA = (a.commonProducts?.length || a.products?.length || 0);
      const countB = (b.commonProducts?.length || b.products?.length || 0);
      return countB - countA;
    };
    const MAX_PER_CATEGORY = 15;
    const localComps = competitors.filter(c => norm(c.type) === 'local').sort(sortByOverlap).slice(0, MAX_PER_CATEGORY);
    const regionalComps = competitors.filter(c => norm(c.type) === 'regional').sort(sortByOverlap).slice(0, MAX_PER_CATEGORY);
    const globalComps = competitors.filter(c => norm(c.type) === 'global').sort(sortByOverlap).slice(0, MAX_PER_CATEGORY);
    const otherComps = competitors.filter(c => !['local', 'regional', 'global'].includes(norm(c.type))).sort(sortByOverlap).slice(0, MAX_PER_CATEGORY);
    
    // Keep projectMemory aligned with the capped 15 per category set
    const cappedCompetitors = [...localComps, ...regionalComps, ...globalComps, ...otherComps];
    if (window.projectMemory) {
      window.projectMemory.competitors = cappedCompetitors;
    }
    
    const renderCard = (c) => window.renderCompetitorCard(c);
    
    let html = '';
    if (localComps.length > 0) {
      html += `<div style="grid-column: 1 / -1; margin-top:10px; margin-bottom:5px;"><h3 style="color:var(--text); font-weight:600; border-bottom:1px solid var(--border); padding-bottom:5px; display:flex; align-items:center; gap:8px;">🌍 Local Competitors <span class="badge" style="background:rgba(99,102,241,0.15); color:var(--primary); font-size:12px; font-weight:700; padding:2px 8px; border-radius:12px;">${localComps.length}</span></h3></div>`;
      html += localComps.map(renderCard).join('');
    }
    if (regionalComps.length > 0) {
      html += `<div style="grid-column: 1 / -1; margin-top:20px; margin-bottom:5px;"><h3 style="color:var(--text); font-weight:600; border-bottom:1px solid var(--border); padding-bottom:5px; display:flex; align-items:center; gap:8px;">🏭 Regional & National Competitors <span class="badge" style="background:rgba(99,102,241,0.15); color:var(--primary); font-size:12px; font-weight:700; padding:2px 8px; border-radius:12px;">${regionalComps.length}</span></h3></div>`;
      html += regionalComps.map(renderCard).join('');
    }
    if (globalComps.length > 0) {
      html += `<div style="grid-column: 1 / -1; margin-top:20px; margin-bottom:5px;"><h3 style="color:var(--text); font-weight:600; border-bottom:1px solid var(--border); padding-bottom:5px; display:flex; align-items:center; gap:8px;">🌐 Global Leaders <span class="badge" style="background:rgba(99,102,241,0.15); color:var(--primary); font-size:12px; font-weight:700; padding:2px 8px; border-radius:12px;">${globalComps.length}</span></h3></div>`;
      html += globalComps.map(renderCard).join('');
    }
    if (otherComps.length > 0) {
      html += `<div style="grid-column: 1 / -1; margin-top:20px; margin-bottom:5px;"><h3 style="color:var(--text); font-weight:600; border-bottom:1px solid var(--border); padding-bottom:5px; display:flex; align-items:center; gap:8px;">🏢 Industry Competitors <span class="badge" style="background:rgba(99,102,241,0.15); color:var(--primary); font-size:12px; font-weight:700; padding:2px 8px; border-radius:12px;">${otherComps.length}</span></h3></div>`;
      html += otherComps.map(renderCard).join('');
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
  
  const savedProjectUrl = localStorage.getItem('smmLastProjectUrl');
  const savedResult = localStorage.getItem('smmLastResult');
  const ansDiv = document.getElementById('smm-answer');

  // Reset answer box if project changed
  if (savedProjectUrl !== window.activeProjectUrl) {
    if (ansDiv) ansDiv.style.display = 'none';
    window.selectedTrendingTopic = null;
    const trendingCont = document.getElementById('smm-trending-topics');
    if (trendingCont) trendingCont.style.display = 'none';
  }
  
  try {
    const res = await fetch(`/api/memory?url=${encodeURIComponent(window.activeProjectUrl)}`);
    const data = await res.json();
    if (data.memory) {
      window.projectMemory = data.memory;
      
      // Update Target Personas
      if (window.updateSmmPersonas) window.updateSmmPersonas();

      // Update Theme Sub-options
      if (window.updateSmmSuboptions) window.updateSmmSuboptions();
      
      // Update Mirror Competitors
      if (window.populateMirrorCompetitors) window.populateMirrorCompetitors();

      // Update Anti-Repetition Shield Banner
      const shieldBanner = document.getElementById('smm-anti-repetition-banner');
      const ownPostsCount = (data.memory.ownSocialFeed || []).length;
      const hasVoice = !!data.memory.brandVoicePattern;
      if (shieldBanner) {
        shieldBanner.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">🛡️</span>
            <span><strong>Anti-Repetition Shield: Active</strong> — ${ownPostsCount > 0 ? `<strong>${ownPostsCount}</strong> company posts indexed` : 'Verified company memory loaded'} to guarantee 100% original, non-duplicate content.</span>
          </div>
          <span id="smm-voice-badge" style="background: rgba(34, 197, 94, 0.15); padding: 3px 10px; border-radius: 12px; font-weight: 600; font-size: 11px;">${hasVoice ? '🎙️ Brand Voice Aligned' : '🏢 Verified Company Profile'}</span>
        `;
      }
    }
  } catch (e) {
    console.error("Failed to load memory for SMM:", e);
  }

  // Restore saved SMM results now that project memory is loaded
  if (savedProjectUrl === window.activeProjectUrl && savedResult && window.renderSmmResults) {
    try {
      const parsed = JSON.parse(savedResult);
      if (parsed && parsed.posts) {
        window.renderSmmResults(parsed.posts, parsed.type);
      }
    } catch(e) {
      console.error("Failed to restore SMM results:", e);
    }
  }
};

window.updateSmmPersonas = function() {
  const mem = window.projectMemory;
  const personaSelect = document.getElementById('smm-target-persona');
  if (!personaSelect) return;
  
  personaSelect.innerHTML = '<option value="all">🎯 All Buyer Personas (Broad Market Appeal)</option>';
  if (!mem) return;
  
  const personas = (mem.audience?.buyerPersonas || []).filter(Boolean);
  if (personas.length > 0) {
    personas.forEach(p => {
      const el = document.createElement('option');
      el.value = p;
      el.textContent = `👤 ${p}`;
      personaSelect.appendChild(el);
    });
  }
  
  const industries = (mem.audience?.targetIndustries || []).filter(Boolean);
  if (industries.length > 0) {
    const group = document.createElement('optgroup');
    group.label = 'Specific Target Industries';
    industries.forEach(ind => {
      const el = document.createElement('option');
      el.value = `Industry Sector: ${ind}`;
      el.textContent = `🏢 ${ind}`;
      group.appendChild(el);
    });
    personaSelect.appendChild(group);
  }
  personaSelect.dispatchEvent(new Event('optionsUpdated'));
};

window.updateSmmSuboptions = function() {
  const mem = window.projectMemory;
  const themeSelect = document.getElementById('smm-theme');
  const container = document.getElementById('smm-suboption-container');
  const label = document.getElementById('smm-suboption-label');
  const select = document.getElementById('smm-suboption');
  
  if (!themeSelect || !container || !select) return;
  if (!mem) {
    container.style.display = 'none';
    return;
  }
  
  const theme = themeSelect.value;
  select.innerHTML = '';
  
  const prods = (mem.offerings?.products || []).map(p => typeof p === 'string' ? p : p.name).filter(Boolean);
  const servs = (mem.offerings?.services || []).map(s => typeof s === 'string' ? s : s.name).filter(Boolean);
  const procs = (mem.processes?.processes || []).map(p => p.name).filter(Boolean);
  const usps = [...new Set([...(mem.brandPositioning?.usps || []), ...(mem.offerings?.valuePropositions || [])])].filter(Boolean);
  const vision = mem.businessIdentity?.vision;
  const ind = (mem.businessIdentity?.industry || mem.businessIdentity?.subIndustry || '').toLowerCase();
  
  container.style.display = 'block';
  
  if (theme === 'product') {
    label.innerText = 'Target Offering (Product / Service)';
    
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '🌟 Full Portfolio Showcase (All Core Offerings)';
    select.appendChild(allOpt);
    
    if (prods.length > 0 && servs.length > 0) {
      const prodGroup = document.createElement('optgroup');
      prodGroup.label = `📦 Products (${prods.length})`;
      prods.forEach(p => {
        const el = document.createElement('option');
        el.value = p;
        el.textContent = p;
        prodGroup.appendChild(el);
      });
      select.appendChild(prodGroup);
      
      const servGroup = document.createElement('optgroup');
      servGroup.label = `🛠️ Services & Solutions (${servs.length})`;
      servs.forEach(s => {
        const el = document.createElement('option');
        el.value = s;
        el.textContent = s;
        servGroup.appendChild(el);
      });
      select.appendChild(servGroup);
    } else if (prods.length > 0) {
      label.innerText = `Target Product (${prods.length} available)`;
      prods.forEach(p => {
        const el = document.createElement('option');
        el.value = p;
        el.textContent = p;
        select.appendChild(el);
      });
    } else if (servs.length > 0) {
      label.innerText = `Target Service / Solution (${servs.length} available)`;
      servs.forEach(s => {
        const el = document.createElement('option');
        el.value = s;
        el.textContent = s;
        select.appendChild(el);
      });
    }
  } else if (theme === 'technical') {
    label.innerText = 'Technical Capability, Process or Workflow';
    
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '⚙️ End-to-End Operational Excellence & Technical Quality';
    select.appendChild(allOpt);
    
    if (procs.length > 0) {
      const procGroup = document.createElement('optgroup');
      procGroup.label = `🏭 Operational Processes (${procs.length})`;
      procs.forEach(p => {
        const el = document.createElement('option');
        el.value = p;
        el.textContent = p;
        procGroup.appendChild(el);
      });
      select.appendChild(procGroup);
    }
    
    if (servs.length > 0) {
      const servGroup = document.createElement('optgroup');
      servGroup.label = `🛠️ Technical & Specialized Services (${servs.length})`;
      servs.forEach(s => {
        const el = document.createElement('option');
        el.value = s;
        el.textContent = s;
        servGroup.appendChild(el);
      });
      select.appendChild(servGroup);
    }
  } else if (theme === 'brand') {
    label.innerText = 'Brand Focus & Value Proposition';
    
    const brandOpts = [
      { val: vision ? `Core Vision: ${vision}` : 'Core Vision & Strategic Mission', label: '🎯 Core Vision & Strategic Mission' },
      { val: 'Company Scale, Infrastructure & Reliability', label: '🏛️ Company Scale, Infrastructure & Reliability' },
      { val: 'Certified Quality Assurance & Rigorous Testing', label: '🏆 Certified Quality Assurance & Zero-Defect Standards' },
      { val: 'Global Reach & Supply Chain Predictability', label: '🌍 Global Reach & Supply Chain Predictability' }
    ];
    
    brandOpts.forEach(o => {
      const el = document.createElement('option');
      el.value = o.val;
      el.textContent = o.label;
      select.appendChild(el);
    });
    
    if (usps.length > 0) {
      const uspGroup = document.createElement('optgroup');
      uspGroup.label = `⭐ Verified USPs & Differentiators (${usps.length})`;
      usps.forEach(u => {
        const el = document.createElement('option');
        el.value = u;
        el.textContent = u;
        uspGroup.appendChild(el);
      });
      select.appendChild(uspGroup);
    }
  } else if (theme === 'educative') {
    label.innerText = 'Educational & Problem-Solving Angle';
    
    let eduOptions = [];
    if (/seed|agri|crop|farming/i.test(ind)) {
      eduOptions = [
        'How to Select High-Yield Certified Seeds for Your Soil',
        'Hybrid vs Traditional Seeds: Disease Resistance & Yield Comparison',
        'Seed Germination Testing & Storage Best Practices',
        'Seasonal Agronomy Guide & Soil Preparation Tips'
      ];
    } else if (/marketing|digital|media|seo|software|tech/i.test(ind)) {
      eduOptions = [
        'High-Converting Funnel Architecture: Eliminating Conversion Drop-Off',
        'Technical SEO & Core Web Vitals: Ranking Factors Demystified',
        'Omnichannel Performance Ads: Scaling ROAS Predictably',
        'UI/UX Redesign: Turning Visitors into Long-Term Customers'
      ];
    } else {
      eduOptions = [
        'Material Selection & Metallurgy Guide (Carbon vs Alloy Steels)',
        'Understanding Precision Machining Tolerances & Part Lifespan',
        'Forging vs Casting vs Billet: Which Process Best Fits Your Application',
        'Eliminating Component Failure: Non-Destructive Testing & Quality Checks'
      ];
    }
    
    eduOptions.forEach(eo => {
      const el = document.createElement('option');
      el.value = eo;
      el.textContent = `💡 ${eo}`;
      select.appendChild(el);
    });
    
    if (procs.length > 0) {
      const procGroup = document.createElement('optgroup');
      procGroup.label = 'Deep-Dive Process Explainer';
      procs.forEach(p => {
        const el = document.createElement('option');
        el.value = `Deep Dive Engineering Guide: ${p}`;
        el.textContent = `🔬 How It Works: ${p}`;
        procGroup.appendChild(el);
      });
      select.appendChild(procGroup);
    }
  } else if (theme === 'ugc') {
    label.innerText = 'Authentic Behind-the-Scenes Focus';
    const ugcOptions = [
      'Shop Floor & Manufacturing In Action (High-Precision Machinery)',
      'Raw Material Receipt & Metallurgical Inspection Standards',
      'Engineering Team & Skilled Craftsmanship Spotlight',
      'Quality Control Gate: 100% Dimensional & Ultrasonic Inspection',
      'Packing & Global Dispatch: Ready for Assembly Lines'
    ];
    ugcOptions.forEach(uo => {
      const el = document.createElement('option');
      el.value = uo;
      el.textContent = `🎬 ${uo}`;
      select.appendChild(el);
    });
  }
  
  select.dispatchEvent(new Event('optionsUpdated'));
};

window.populateMirrorCompetitors = function() {
  const mem = window.projectMemory;
  const select = document.getElementById('smm-mirror-competitor');
  if (!select) return;
  
  select.innerHTML = '<option value="">Select a competitor...</option>';
  if (!mem) return;
  
  const realComps = (mem.competitors || []).map(c => ({
    name: c.name,
    type: c.type || 'competitor',
    location: c.location || ''
  }));
  
  const feed = mem.socialFeed || [];
  const invalidNames = new Set(['instagram', 'facebook', 'youtube', 'twitter', 'linkedin', 'undefined', 'null', 'admin', 'google', 'meta', 'social']);
  
  const nameMap = new Map();
  realComps.forEach(c => {
    if (c.name && !invalidNames.has(c.name.trim().toLowerCase())) {
      nameMap.set(c.name.trim().toLowerCase(), c);
    }
  });
  
  feed.forEach(p => {
    if (p.competitorName && !invalidNames.has(p.competitorName.trim().toLowerCase())) {
      const key = p.competitorName.trim().toLowerCase();
      if (!nameMap.has(key)) {
        nameMap.set(key, { name: p.competitorName.trim(), type: 'tracked', location: '' });
      }
    }
  });
  
  const cleanCompetitors = Array.from(nameMap.values());
  
  if (cleanCompetitors.length === 0) {
    const el = document.createElement('option');
    el.value = "";
    el.disabled = true;
    el.textContent = "No verified competitors yet. Run 'Find Competitors' first.";
    select.appendChild(el);
  } else {
    const localGroup = document.createElement('optgroup');
    localGroup.label = '🌍 Local Competitors';
    const regGroup = document.createElement('optgroup');
    regGroup.label = '🏭 Regional Competitors';
    const globGroup = document.createElement('optgroup');
    globGroup.label = '🌐 Global Leaders';
    const otherGroup = document.createElement('optgroup');
    otherGroup.label = '🎯 Industry Competitors';
    
    cleanCompetitors.forEach(c => {
      const el = document.createElement('option');
      el.value = c.name;
      el.textContent = c.location ? `${c.name} (${c.location})` : c.name;
      
      if (c.type === 'local') localGroup.appendChild(el);
      else if (c.type === 'regional') regGroup.appendChild(el);
      else if (c.type === 'global') globGroup.appendChild(el);
      else otherGroup.appendChild(el);
    });
    
    if (localGroup.children.length) select.appendChild(localGroup);
    if (regGroup.children.length) select.appendChild(regGroup);
    if (globGroup.children.length) select.appendChild(globGroup);
    if (otherGroup.children.length) select.appendChild(otherGroup);
  }
  
  select.dispatchEvent(new Event('optionsUpdated'));
};

window.populateMirrorPosts = function(competitorName) {
  const mem = window.projectMemory;
  const select = document.getElementById('smm-mirror-post');
  if (!select) return;
  
  select.innerHTML = '<option value="">Select a post or strategy...</option>';
  if (!competitorName || !mem) return;
  
  const feed = mem.socialFeed || [];
  const compKey = competitorName.trim().toLowerCase();
  const posts = feed.filter(p => (p.competitorName || '').trim().toLowerCase() === compKey);
  
  if (posts.length > 0) {
    const allOpt = document.createElement('option');
    allOpt.value = JSON.stringify({ strategyOnly: true, competitorName: competitorName });
    allOpt.textContent = `⭐ Mirror Overall Content Strategy & Tone (${posts.length} recent posts)`;
    select.appendChild(allOpt);
    
    posts.forEach((p, idx) => {
      const el = document.createElement('option');
      el.value = JSON.stringify(p);
      el.dataset.postJson = JSON.stringify(p);
      
      let text = `[${p.platform || 'Social'}] ${p.date || 'Recent'}`;
      if (p.content || p.caption) {
        let snippet = (p.content || p.caption).substring(0, 45).replace(/\n/g, ' ');
        text += ` — "${snippet}..."`;
      }
      el.textContent = text;
      select.appendChild(el);
    });
  } else {
    const profileOpt = document.createElement('option');
    profileOpt.value = JSON.stringify({ strategyOnly: true, competitorName: competitorName });
    profileOpt.textContent = `🌐 Mirror Competitor Market Posture & Value Messaging (Profile & Website)`;
    profileOpt.selected = true;
    select.appendChild(profileOpt);
  }
  
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
  
  const suboptionEl = document.getElementById('smm-suboption');
  const subTheme = suboptionEl && suboptionEl.parentElement.style.display !== 'none' ? suboptionEl.value : null;
  
  const personaEl = document.getElementById('smm-target-persona');
  const targetPersona = personaEl ? personaEl.value : 'all';

  const platformEl = document.getElementById('smm-platform');
  const targetPlatform = platformEl ? platformEl.value : 'LinkedIn';

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
        trendingTopic: window.selectedTrendingTopic,
        targetPersona: targetPersona,
        targetPlatform: targetPlatform
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

window.copySmmText = function(text, btn, label = 'Copied to clipboard!') {
  if (!text) return;
  const doFeedback = () => {
    if (btn) {
      const origHtml = btn.innerHTML;
      btn.innerHTML = '✓ Copied!';
      btn.style.color = '#4ade80';
      btn.style.borderColor = '#4ade80';
      setTimeout(() => {
        btn.innerHTML = origHtml;
        btn.style.color = '';
        btn.style.borderColor = '';
      }, 2000);
    }
    if (window.showSuccess) window.showSuccess(label);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(doFeedback).catch(() => {
      window.fallbackCopyText(text);
      doFeedback();
    });
  } else {
    window.fallbackCopyText(text);
    doFeedback();
  }
};

window.fallbackCopyText = function(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
};

window.cleanRawLabels = function(str) {
  if (!str) return '';
  return String(str)
    .replace(/(^|[\n\r]+|\s*[•\-–*🔹⚙️💡📊🚀]\s*)\*\*(?:Before|After|Problem|Solution|Result|Challenge|Impact|Outcome|Metric|Status|Benefit|Takeaway):\*\*\s*/gi, '$1')
    .replace(/(^|[\n\r]+|\s*[•\-–*🔹⚙️💡📊🚀]\s*)(?:Before|After|Problem|Solution|Result|Challenge|Impact|Outcome):\s*/gi, '$1')
    .replace(/\*\*(?:Before|After|Problem|Solution|Result|Challenge|Impact|Outcome)\*\*/gi, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^[ \t]*[•\-–*][ \t]*[•\-–*][ \t]*/gm, '🔹 ')
    .trim();
};

window.formatSmmContent = function(text) {
  if (!text) return '';
  const cleaned = window.cleanRawLabels(text);
  // Normalize unicode bullets to markdown list dashes for uniform list rendering
  const normalized = cleaned.replace(/^[ \t]*[•●][ \t]*/gm, '- ');
  if (window.marked && typeof window.marked.parse === 'function') {
    return window.marked.parse(normalized);
  }
  return window.escapeHtml(cleaned)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '<p></p>')
    .replace(/\n/g, '<br>');
};

// 1080x1080 High-Res Social Card Canvas Renderer
window.renderSocialCardToCanvas = function(canvas, post, companyName) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  canvas.width = 1080;
  canvas.height = 1080;
  
  // Base deep modern gradient
  const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
  grad.addColorStop(0, '#0a0e1a');
  grad.addColorStop(0.45, '#1e1b4b');
  grad.addColorStop(1, '#0f172a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1080);
  
  // Ambient radial glow in top right
  const radial = ctx.createRadialGradient(900, 180, 10, 900, 180, 500);
  radial.addColorStop(0, 'rgba(99, 102, 241, 0.32)');
  radial.addColorStop(1, 'rgba(99, 102, 241, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, 1080, 1080);
  
  // Top Header Bar
  const brandName = (companyName || 'BUSINESS INTELLIGENCE').toUpperCase();
  ctx.font = '700 24px Inter, -apple-system, sans-serif';
  const brandWidth = ctx.measureText(`⚡ ${brandName}`).width;
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(80, 70, brandWidth + 36, 48, 24);
  } else {
    ctx.rect(80, 70, brandWidth + 36, 48);
  }
  ctx.fill();
  ctx.stroke();
  
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(`⚡ ${brandName}`, 98, 103);
  
  // 1080x1080 Ratio Indicator
  ctx.font = '600 20px Inter, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillText('1080 × 1080 · DIRECT POST', 760, 102);
  
  // Decorative Accent Divider Line
  const lineGrad = ctx.createLinearGradient(80, 145, 1000, 145);
  lineGrad.addColorStop(0, 'rgba(99, 102, 241, 0.8)');
  lineGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.8)');
  lineGrad.addColorStop(1, 'rgba(99, 102, 241, 0)');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(80, 145);
  ctx.lineTo(1000, 145);
  ctx.stroke();
  
  // Main Headline (50px Bold)
  const headline = post.heading || post.title || 'Transforming Business Through Precision';
  ctx.font = '800 50px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  
  const wrapText = (text, x, y, maxWidth, lineHeight, maxLines = 4) => {
    const words = text.split(' ');
    let line = '';
    let currentY = y;
    let linesDrawn = 0;
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line.trim(), x, currentY);
        linesDrawn++;
        line = words[n] + ' ';
        currentY += lineHeight;
        if (linesDrawn >= maxLines) break;
      } else {
        line = testLine;
      }
    }
    if (linesDrawn < maxLines && line.trim()) {
      ctx.fillText(line.trim(), x, currentY);
    }
    return currentY + lineHeight;
  };
  
  let nextY = wrapText(headline, 80, 235, 920, 64, 3);
  
  // Proof Metric Pill (Level 2 Hierarchy)
  if (post.subText) {
    const metricText = post.subText.trim();
    ctx.font = '700 28px Inter, -apple-system, sans-serif';
    const metricWidth = ctx.measureText(`✓  ${metricText}`).width;
    
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(80, nextY + 10, metricWidth + 44, 56, 12);
    } else {
      ctx.rect(80, nextY + 10, metricWidth + 44, 56);
    }
    ctx.fill();
    ctx.stroke();
    
    ctx.fillStyle = '#38BDF8';
    ctx.fillText(`✓  ${metricText}`, 102, nextY + 48);
    nextY += 95;
  } else {
    nextY += 25;
  }
  
  // ELI5 Kid-Friendly Analogy / Simple Truth Card
  const simpleText = post.simpleExplanation || post.hook || 'High performance engineering built with zero compromises.';
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(80, nextY + 20, 920, 280, 20);
  } else {
    ctx.rect(80, nextY + 20, 920, 280);
  }
  ctx.fill();
  ctx.stroke();
  
  // Card Header Label
  ctx.font = '800 22px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#F59E0B';
  ctx.fillText('💡 THE SIMPLE TRUTH (ELI5):', 115, nextY + 70);
  
  // Card Metaphor Text
  ctx.font = '500 28px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#E2E8F0';
  wrapText(`"${simpleText}"`, 115, nextY + 125, 850, 44, 4);
  
  // Footer Area
  const footerY = 1000;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, footerY - 40);
  ctx.lineTo(1000, footerY - 40);
  ctx.stroke();
  
  ctx.font = '600 22px Inter, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.fillText(`🏢 ${brandName}`, 80, footerY);
  
  ctx.font = '500 20px Inter, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillText('Direct Social Post · High Resolution 1080p', 610, footerY);
};

// 1-Click Native Image and Canvas Download Handlers
window.downloadCanvasAsImage = function(canvas, filename) {
  if (!canvas) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'social-media-post.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (typeof window.showGlobalToast === 'function') {
      window.showGlobalToast('✓ Downloaded 1080x1080 social graphic to your device!');
    }
  }, 'image/png');
};

window.downloadDirectImage = async function(imageUrl, filename) {
  if (!imageUrl) return;
  try {
    const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(imageUrl)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error('Proxy fetch failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'social-image.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (typeof window.showGlobalToast === 'function') {
      window.showGlobalToast('✓ Photo visual downloaded to your device!');
    }
  } catch (err) {
    window.open(imageUrl, '_blank');
  }
};

window.renderSmmResults = function(postsData, type) {
    const ansDiv = document.getElementById('smm-answer');
    const textDiv = document.getElementById('smm-text');
    if (!ansDiv || !textDiv) return;
    
    ansDiv.style.display = 'block';
    
    if (type === 'image') {
      const parsedPosts = postsData.map(p => {
        try { return typeof p === 'object' ? p : JSON.parse(p); } catch(e) { return null; }
      }).filter(Boolean);
      
      const trendingBadge = window.lastTrendingTopic && window.lastTrendingTopic.title
        ? `<div style="margin-bottom:12px; padding:10px 14px; background:rgba(77,171,247,0.1); border:1px solid rgba(77,171,247,0.4); border-radius:8px; font-size:0.9em;">
             <strong style="color:var(--primary-color);">Trending Topic:</strong> <span style="color:var(--text-light);">${window.escapeHtml(window.lastTrendingTopic.title)}</span>
             ${window.lastTrendingTopic.sources && window.lastTrendingTopic.sources.length ? `<div style="font-size:0.75em; color:var(--text-muted); margin-top:4px;">${window.escapeHtml(window.lastTrendingTopic.sources.join(' · '))}</div>` : ''}
           </div>`
        : '';

      let html = '<div class="smm-studio-container">';
      html += trendingBadge;
      html += '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">';
      html += '  <h4 style="margin: 0; color: var(--primary); font-size: 1.05rem; font-weight: 700;">✨ Choose a Content Angle & Post Concept</h4>';
      html += `  <span style="font-size: 0.85rem; color: var(--text-muted);">${parsedPosts.length} post concept${parsedPosts.length > 1 ? 's' : ''} generated</span>`;
      html += '</div>';
      
      html += '<div id="smm-idea-cards" class="smm-idea-cards-grid">';
      
      parsedPosts.forEach((post, idx) => {
         const angleBadge = post.angle ? `<span class="smm-tag-angle">${window.escapeHtml(post.angle)}</span>` : '';
         const hookTypeBadge = post.hookType ? `<span class="smm-hook-badge">⚡ ${window.escapeHtml(post.hookType)}</span>` : '';
         const previewTitle = post.heading || post.title || `Concept ${idx + 1}`;
         const previewIdea = post.hook || post.visualIdea || post.content || '';

         html += `
         <div class="idea-card" data-idx="${idx}">
           <div class="idea-card-header">
             <strong style="color: var(--text-color); font-size: 0.95em;">Concept ${idx + 1}</strong>
             <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
               ${angleBadge}
               ${hookTypeBadge}
             </div>
           </div>
           <div class="idea-card-title">${window.escapeHtml(previewTitle)}</div>
           <span class="idea-card-desc">${window.escapeHtml(previewIdea)}</span>
         </div>`;
      });
      html += '</div>';
      
      html += '<div id="smm-post-details" style="display:none; margin-top: 10px;"></div>';
      html += '</div>';
      
      textDiv.innerHTML = html;
      
      const cards = textDiv.querySelectorAll('.idea-card');
      const detailsDiv = textDiv.querySelector('#smm-post-details');
      
      cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            
            const idx = parseInt(card.getAttribute('data-idx'), 10);
            const p = parsedPosts[idx];
            detailsDiv.style.display = 'block';

            // Sanitize math
            const sanitizeMath = (str) => {
              if (!str) return '';
              return String(str).replace(/\b(jumped|increased|rose|boosted|grew|surged|improved|up to)\s+([^\n.]+?)\s*\(-(\d+(?:\.\d+)?%)\s*(?:change|increase)?\)/gi, '$1 $2 (+$3)');
            };

            const cleanRawLabels = window.cleanRawLabels || function(str) {
              if (!str) return '';
              return String(str)
                .replace(/(^|[\n\r]+|\s*[•\-–*🔹⚙️💡📊🚀]\s*)\*\*(?:Before|After|Problem|Solution|Result|Challenge|Impact|Outcome|Metric|Status|Benefit|Takeaway):\*\*\s*/gi, '$1')
                .replace(/(^|[\n\r]+|\s*[•\-–*🔹⚙️💡📊🚀]\s*)(?:Before|After|Problem|Solution|Result|Challenge|Impact|Outcome):\s*/gi, '$1')
                .replace(/\*\*(?:Before|After|Problem|Solution|Result|Challenge|Impact|Outcome)\*\*/gi, '')
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .replace(/^[ \t]*[•\-–*][ \t]*[•\-–*][ \t]*/gm, '🔹 ')
                .trim();
            };

            const heading = cleanRawLabels(p.heading || p.title || '').trim();
            const subText = cleanRawLabels(p.subText || p.subtitle || '').trim();
            const hookType = (p.hookType || '').trim();
            const hook = cleanRawLabels(sanitizeMath(p.hook || p.content || ''));
            const body = cleanRawLabels(sanitizeMath(p.body || ''));
            const cta = cleanRawLabels(p.callToAction || p.cta || '').trim();
            const hashtags = (p.hashtags || '').trim();
            const angle = p.angle || '';

            // Ensure 3 to 4 hashtags
            let tagList = [];
            if (hashtags) {
              tagList = hashtags.split(/\s+/).filter(t => t.length > 0).map(t => t.startsWith('#') ? t : `#${t}`);
              if (tagList.length > 4) tagList = tagList.slice(0, 4);
            }
            const cleanHashtags = tagList.join(' ');

            let fullPost = p.fullPost ? cleanRawLabels(sanitizeMath(p.fullPost.trim())) : '';
            if (!fullPost) {
              const parts = [];
              if (hook) parts.push(hook);
              if (body) parts.push(body);
              if (cta && !body.toLowerCase().includes(cta.toLowerCase())) {
                parts.push(cta);
              }
              if (cleanHashtags && !body.includes(cleanHashtags)) {
                parts.push(cleanHashtags);
              }
              fullPost = parts.join('\n\n').trim();
            } else {
              fullPost = cleanRawLabels(fullPost);
            }
            p.fullPost = fullPost;

            const companyName = window.projectMemory?.businessIdentity?.officialName || 'Company';
            const companyInitial = companyName.charAt(0).toUpperCase() || 'C';

            // Structured caption markup
            let formattedCaption = '';
            if (body) {
              let partsHtml = '';
              if (hook) {
                partsHtml += `<div class="smm-caption-hook">${window.escapeHtml(hook)}</div>`;
              }
              partsHtml += `<div class="smm-caption-body">${window.formatSmmContent(body)}</div>`;
              if (cta) {
                partsHtml += `<div class="smm-cta-block"><span style="font-size: 1.15em;">👉</span> <span>${window.escapeHtml(cta)}</span></div>`;
              }
              if (tagList.length > 0) {
                partsHtml += `<div class="smm-hashtags-container">${tagList.map(t => `<span class="smm-hashtag-pill">${window.escapeHtml(t)}</span>`).join('')}</div>`;
              }
              formattedCaption = partsHtml;
            } else {
              formattedCaption = window.formatSmmContent(fullPost);
            }

            detailsDiv.innerHTML = `
              <div class="smm-studio-container">
                <!-- TOP TOOLBAR -->
                <div class="smm-studio-toolbar">
                  <div class="smm-toolbar-tags">
                    ${angle ? `<span class="smm-tag-angle">🎯 ${window.escapeHtml(angle)}</span>` : ''}
                    ${hookType ? `<span class="smm-hook-badge">⚡ ${window.escapeHtml(hookType)}</span>` : ''}
                    <span class="smm-tag-ratio" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);">📄 Text Post</span>
                  </div>
                  <div class="smm-toolbar-actions">
                    <button class="btn btn-primary copy-post-btn" type="button">📋 Copy Full Post</button>
                    <button class="btn btn-secondary edit-btn" type="button">✏️ Edit Content</button>
                  </div>
                </div>

                <!-- MAIN STUDIO GRID: 2 COLUMNS ON DESKTOP -->
                <div class="smm-studio-grid">
                  <!-- COLUMN 1: AUTHENTIC SOCIAL MEDIA FEED MOCKUP (TEXT-FIRST) -->
                  <div class="smm-post-card">
                    <!-- SOCIAL POST HEADER -->
                    <div class="smm-post-header">
                      <div class="smm-post-author">
                        <div class="smm-post-avatar">${companyInitial}</div>
                        <div class="smm-post-meta">
                          <div class="smm-post-name">${window.escapeHtml(companyName)} <span class="smm-verified-badge">✓</span></div>
                          <div class="smm-post-sub">Promoted · Just now · 🌐</div>
                        </div>
                      </div>
                      <span class="smm-live-badge">Live Preview</span>
                    </div>

                    <!-- POST CAPTION & NARRATIVE -->
                    <div class="smm-post-caption">${formattedCaption}</div>

                    <!-- SOCIAL INTERACTION BAR -->
                    <div class="smm-mockup-actions">
                      <span class="smm-action-item">👍 Like</span>
                      <span class="smm-action-item">💬 Comment</span>
                      <span class="smm-action-item">🔁 Repost</span>
                      <span class="smm-action-item">🚀 Send</span>
                    </div>
                  </div>

                  <!-- COLUMN 2: STRUCTURED SCHEMA & COPY BREAKDOWN -->
                  <div class="smm-schema-grid">
                    <!-- 1. STRATEGY ANGLE & HOOK -->
                    <div class="smm-schema-card">
                      <div class="smm-schema-card-header">
                        <span class="smm-schema-label">📌 Strategy Angle & Hook</span>
                        ${hookType ? `<span class="smm-hook-badge">⚡ ${window.escapeHtml(hookType)}</span>` : ''}
                      </div>
                      <div class="smm-schema-val">
                        <strong>Angle:</strong> ${window.escapeHtml(angle || 'Brand Authority & Problem-Solving')}
                      </div>
                    </div>

                    <!-- 2. CORE FOCUS & VALUE METRIC -->
                    <div class="smm-schema-card">
                      <div class="smm-schema-card-header">
                        <span class="smm-schema-label">🏷️ Key Focus & Value Metric</span>
                      </div>
                      <div class="smm-schema-val" style="display:flex; flex-direction:column; gap:6px;">
                        <div><strong style="color:var(--text-light);">Core Insight:</strong> ${window.escapeHtml(heading || 'Technical Precision & Reliability')}</div>
                        ${subText ? `<div><strong style="color:var(--text-light);">Proof Metric:</strong> <span style="background:rgba(99,102,241,0.15); padding:2px 6px; border-radius:4px; font-weight:600; color:var(--primary);">${window.escapeHtml(subText)}</span></div>` : ''}
                      </div>
                    </div>

                    <!-- 3. HOOK, VALUE & CTA BREAKDOWN -->
                    <div class="smm-schema-card">
                      <div class="smm-schema-card-header">
                        <span class="smm-schema-label">✍️ Hook, Value & CTA Breakdown</span>
                        <span style="font-size:11px; font-weight:700; color:#10b981;">3-Step Formula</span>
                      </div>
                      <div class="smm-schema-val" style="display:flex; flex-direction:column; gap:8px;">
                        <div>
                          <strong style="color:var(--text-light);">🪝 Hook (Pattern Interrupt):</strong>
                          <div style="font-style:italic; margin-top:2px; color:var(--text-muted); padding-left:8px; border-left:2px solid var(--primary);">${window.escapeHtml(hook || 'Pattern interrupt hook')}</div>
                        </div>
                        <div>
                          <strong style="color:var(--text-light);">💡 Value Delivery (Bullet Points):</strong>
                          <div style="margin-top:2px; font-size:12.5px; color:var(--text-muted); line-height:1.5; max-height:120px; overflow-y:auto;">${window.escapeHtml(body || 'Structured technical insights and data')}</div>
                        </div>
                        <div>
                          <strong style="color:var(--text-light);">👉 Single-Outcome Call-to-Action:</strong>
                          <div style="margin-top:2px; color:var(--primary); font-weight:600;">${window.escapeHtml(cta || 'Comment or DM for details')}</div>
                        </div>
                        ${tagList.length > 0 ? `
                        <div>
                          <strong style="color:var(--text-light);">🏷️ Targeted Hashtags (${tagList.length}):</strong>
                          <div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:4px;">
                            ${tagList.map(t => `<span class="smm-hashtag-pill">${window.escapeHtml(t)}</span>`).join('')}
                          </div>
                        </div>` : ''}
                      </div>
                    </div>

                    <!-- 4. COMPLETE READY-TO-PUBLISH POST -->
                    <div class="smm-schema-card" style="border: 1px solid rgba(99,102,241,0.3); background: rgba(99,102,241,0.03);">
                      <div class="smm-schema-card-header">
                        <span class="smm-schema-label" style="color:var(--primary);">📋 Ready-to-Publish Copy</span>
                        <button class="btn btn-primary copy-post-inline-btn" type="button" style="padding: 3px 10px; font-size: 11.5px; height: 28px;">📋 Copy Post</button>
                      </div>
                      <div class="smm-schema-val" style="font-size:12px; color:var(--text-muted); line-height:1.45; max-height:120px; overflow-y:auto; white-space:pre-wrap;">${window.escapeHtml(fullPost)}</div>
                    </div>
                  </div>
                </div>
              </div>
            `;

            const editBtn = detailsDiv.querySelector('.edit-btn');
            const captionDiv = detailsDiv.querySelector('.smm-post-caption');
            const copyPostBtn = detailsDiv.querySelector('.copy-post-btn');
            const copyPostInlineBtn = detailsDiv.querySelector('.copy-post-inline-btn');

            if (copyPostBtn) {
              copyPostBtn.onclick = () => {
                const textToCopy = (p.fullPost || '').trim();
                window.copySmmText(textToCopy, copyPostBtn, 'Full social post copied to clipboard!');
              };
            }

            if (copyPostInlineBtn) {
              copyPostInlineBtn.onclick = () => {
                const textToCopy = (p.fullPost || '').trim();
                window.copySmmText(textToCopy, copyPostInlineBtn, 'Full social post copied to clipboard!');
              };
            }

            if (editBtn && captionDiv) {
              editBtn.onclick = () => {
                const isEditing = editBtn.dataset.editing === 'true';
                if (isEditing) {
                  const textarea = captionDiv.querySelector('.smm-edit-textarea');
                  if (textarea) {
                    p.fullPost = textarea.value.trim();
                    const newPosts = parsedPosts.map(pp => JSON.stringify(pp));
                    localStorage.setItem('smmLastResult', JSON.stringify({ posts: newPosts, type: 'image' }));
                    captionDiv.innerHTML = window.formatSmmContent(p.fullPost);
                  }
                  editBtn.dataset.editing = 'false';
                  editBtn.innerText = '✏️ Edit Content';
                  editBtn.classList.remove('btn-primary');
                  editBtn.classList.add('btn-secondary');
                  if (window.showSuccess) window.showSuccess('Post content updated!');
                } else {
                  editBtn.dataset.editing = 'true';
                  editBtn.innerText = '💾 Save Changes';
                  editBtn.classList.remove('btn-secondary');
                  editBtn.classList.add('btn-primary');
                  
                  const currentText = p.fullPost || captionDiv.innerText;
                  captionDiv.innerHTML = `<textarea class="smm-edit-textarea">${window.escapeHtml(currentText)}</textarea>`;
                  const textarea = captionDiv.querySelector('.smm-edit-textarea');
                  if (textarea) {
                    textarea.focus();
                    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
                    textarea.style.height = Math.max(160, textarea.scrollHeight + 10) + 'px';
                  }
                }
              };
            }
        });
      });

      if (cards.length > 0) {
        cards[0].click();
      }
    } else {
      let rawHtml = '';
      if (type === 'video_edited') {
        rawHtml = postsData[0];
      } else {
        const joined = postsData.join('\n\n---\n\n');
        rawHtml = window.marked ? window.marked.parse(joined) : joined;
      }
      
      const trendingBadge = window.lastTrendingTopic && window.lastTrendingTopic.title
        ? `<div style="margin-bottom:12px; padding:10px 14px; background:rgba(77,171,247,0.1); border:1px solid rgba(77,171,247,0.4); border-radius:8px; font-size:0.9em;">
             <strong style="color:var(--primary-color);">Trending Topic:</strong> <span style="color:var(--text-light);">${window.escapeHtml(window.lastTrendingTopic.title)}</span>
             ${window.lastTrendingTopic.sources && window.lastTrendingTopic.sources.length ? `<div style="font-size:0.75em; color:var(--text-muted); margin-top:4px;">${window.escapeHtml(window.lastTrendingTopic.sources.join(' · '))}</div>` : ''}
           </div>`
        : '';

      textDiv.innerHTML = `
        ${trendingBadge}
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <h4 style="margin:0; color:var(--primary);">🎬 Cinematic Video Scripts</h4>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary copy-video-btn" style="padding:6px 14px; font-size:12px; font-weight:600;">📋 Copy Video Scripts</button>
            <button class="btn btn-secondary edit-btn" style="padding:6px 14px; font-size:12px; font-weight:600;">✏️ Edit Scripts</button>
          </div>
        </div>
        <div class="editable-content" style="background: rgba(15,23,42,0.6); padding: 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); line-height: 1.6;">
          ${rawHtml}
        </div>
      `;
      
      const editBtn = textDiv.querySelector('.edit-btn');
      const contentDiv = textDiv.querySelector('.editable-content');
      const copyVideoBtn = textDiv.querySelector('.copy-video-btn');

      if (copyVideoBtn && contentDiv) {
        copyVideoBtn.onclick = () => {
          window.copySmmText(contentDiv.innerText, copyVideoBtn, 'Video scripts copied to clipboard!');
        };
      }
      
      if (editBtn && contentDiv) {
        editBtn.onclick = () => {
           const isEditing = contentDiv.contentEditable === 'true';
           if (isEditing) {
             contentDiv.contentEditable = 'false';
             contentDiv.style.border = '1px solid rgba(255,255,255,0.08)';
             editBtn.innerText = '✏️ Edit Scripts';
             editBtn.classList.remove('btn-primary');
             editBtn.classList.add('btn-secondary');
             
             const newHtml = contentDiv.innerHTML;
             localStorage.setItem('smmLastResult', JSON.stringify({ posts: [newHtml], type: 'video_edited' }));
             if (window.showSuccess) window.showSuccess('Video script edits saved!');
           } else {
             contentDiv.contentEditable = 'true';
             contentDiv.style.border = '1px dashed var(--primary)';
             contentDiv.focus();
             editBtn.innerText = '💾 Save Changes';
             editBtn.classList.remove('btn-secondary');
             editBtn.classList.add('btn-primary');
           }
        };
      }
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
let _trackerPollInterval = null;

window.renderTrackerRunningCard = function(list, progressText = "Crawling competitor social media across YouTube, Instagram, Facebook, and LinkedIn...", startTime = Date.now()) {
  if (!list) return;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
  list.innerHTML = `
    <div style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 40px 24px; text-align: center; max-width: 600px; margin: 30px auto;">
      <div class="spinner" style="width: 44px; height: 44px; border-width: 3.5px; border-top-color: var(--primary); margin: 0 auto 20px auto;"></div>
      <h3 style="font-size: 1.25rem; font-weight: 700; margin: 0 0 10px 0; color: #ffffff;">Competitor Social Tracker in Progress</h3>
      <p id="tracker-progress-msg" style="color: var(--text-muted); font-size: 14px; margin: 0 0 16px 0; line-height: 1.5;">${(window.escapeHtml || (s => s))(progressText)}</p>
      <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.25); padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; color: #818cf8;">
        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #818cf8;"></span>
        <span id="tracker-elapsed-text">Elapsed: ${elapsedSeconds}s</span>
      </div>
      <p style="margin: 20px 0 0 0; font-size: 12px; color: var(--text-muted);">
        Running in background. The feed will automatically refresh once verified posts are indexed.
      </p>
    </div>
  `;
};

window.pollTrackerStatus = function(projectUrl, startTime = Date.now()) {
  if (_trackerPollInterval) clearInterval(_trackerPollInterval);

  const btn = document.getElementById('btn-cron');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span> Tracker Running...';
  }

  const poll = async () => {
    // If user changed projects, stop polling
    if (!window.activeProjectUrl || window.activeProjectUrl !== projectUrl) {
      if (_trackerPollInterval) {
        clearInterval(_trackerPollInterval);
        _trackerPollInterval = null;
      }
      if (btn) { btn.disabled = false; btn.innerText = 'Run Competitor Tracker Now'; }
      return;
    }

    const elapsedEl = document.getElementById('tracker-elapsed-text');
    const msgEl = document.getElementById('tracker-progress-msg');

    try {
      const res = await fetch(`/api/cron/status?url=${encodeURIComponent(projectUrl)}`);
      const status = await window.safeParseResponse(res);

      const elapsedSeconds = (typeof status.elapsedSec === 'number' && status.elapsedSec >= 0)
        ? status.elapsedSec
        : Math.max(0, Math.floor((Date.now() - startTime) / 1000));
      if (elapsedEl) elapsedEl.textContent = `Elapsed: ${elapsedSeconds}s`;

      if (status.running) {
        if (msgEl && status.progress) {
          msgEl.textContent = status.progress;
        }
        return; // continue polling
      }

      // Tracker completed
      if (_trackerPollInterval) {
        clearInterval(_trackerPollInterval);
        _trackerPollInterval = null;
      }
      if (btn) {
        btn.disabled = false;
        btn.innerText = 'Run Competitor Tracker Now';
      }

      if (status.error) {
        window.showError && window.showError(`Tracker error: ${status.error}`);
      } else {
        window.showSuccess && window.showSuccess(`Competitor tracker completed! Updated feed.`);
      }

      const list = document.getElementById('feed-list');
      if (list) {
        list.innerHTML = '<div style="text-align:center; padding: 40px; color: #4ade80; font-size: 1.2rem; font-weight: 500;">✅ Tracker completed successfully! Loading dashboard...</div>';
      }

      setTimeout(() => {
        loadFeedUI();
      }, 1200);
    } catch (e) {
      console.warn('Tracker status poll warning:', e.message);
    }
  };

  _trackerPollInterval = setInterval(poll, 2500);
  poll();
};

window.triggerCron = async function() {
  if (!window.activeProjectUrl) {
    window.showError && window.showError("Please select an active project first.");
    return;
  }
  const currentUrl = window.activeProjectUrl;
  const list = document.getElementById('feed-list');
  const btn = document.getElementById('btn-cron');
  
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span> Starting Tracker...';
  }

  const startTime = Date.now();
  if (list) {
    window.renderTrackerRunningCard(list, "Initializing background social crawler across competitors...", startTime);
  }

  try {
    const res = await fetch(`/api/cron/run?url=${encodeURIComponent(currentUrl)}`, { method: 'POST' });
    await window.safeParseResponse(res);

    window.pollTrackerStatus(currentUrl, startTime);
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Run Competitor Tracker Now';
    }
    if (list) {
      list.innerHTML = `<div class="empty-state" style="color:red">Failed to start tracker: ${window.escapeHtml(e.message)}</div>`;
    }
  }
};

window.runCompetitorTrackerNow = window.triggerCron;

async function loadFeedUI() {
  if (!window.activeProjectUrl) return;
  if (window.currentSocialFeedSubView === 'own') {
    return loadOwnFeedUI();
  }
  const list = document.getElementById('feed-list');
  if (!list) return;
  
  try {
    const res = await fetch(`/api/social-feed?url=${encodeURIComponent(window.activeProjectUrl)}`);
    const data = await window.safeParseResponse(res);
    
    // If tracker is actively running in background, show progress and poll
    if (data.trackerRunning) {
      if (!_trackerPollInterval) {
        window.renderTrackerRunningCard(list, "Crawling competitor social media across YouTube, Instagram, Facebook, and LinkedIn...");
        window.pollTrackerStatus(window.activeProjectUrl);
      }
      return;
    }

    const feed = data.feed || [];
    
    // Helper functions for safe rendering, proxying, and media extraction
    window.escapeHtml = function(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    window.getYouTubeId = function(str) {
      if (!str || typeof str !== 'string') return null;
      var match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/)|vi\/)([\w-]{11})/i);
      return match ? match[1] : null;
    };

    window.getSocialMediaProxyUrl = function(url, postUrl) {
      if (!url) return '';
      const p = postUrl ? `&post_url=${encodeURIComponent(postUrl)}` : '';
      return `/api/proxy-media?url=${encodeURIComponent(url)}${p}&mediaCache=4`;
    };

    window.extractSingleMediaUrl = function(post) {
      if (!post) return null;
      let candidates = [];

      const pUrl = (post.post_url || post.link || post.postUrl || '').trim();
      const platform = post.platform || post._detectedPlatform || '';
      const sc = post.shortcode || (pUrl.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i) || [])[1];
      const isBundle = sc && (sc.toLowerCase().startsWith('yv5pcb') || sc.toLowerCase().startsWith('qtfxdj') || sc.toLowerCase().startsWith('kj4gsf') || sc.toLowerCase().startsWith('rpztim'));

      // If it is an Instagram post with a valid shortcode, prioritize the authentic photo/thumbnail
      if (sc && !isBundle && (platform === 'Instagram' || post._detectedPlatform === 'Instagram' || pUrl.includes('instagram.com'))) {
        if (post.thumbnail && (post.thumbnail.includes('cdninstagram.com') || post.thumbnail.includes('fbcdn.net'))) {
          candidates.push(post.thumbnail);
        }
        candidates.push(`https://www.instagram.com/p/${sc}/media/?size=l`);
      }

      // If Facebook, check for numeric photo or video ID to resolve crisp lookaside image
      if (platform === 'Facebook' || post._detectedPlatform === 'Facebook' || pUrl.includes('facebook.com')) {
        const fbPhotoMatch = pUrl.match(/(?:fbid=|\/photos\/(?:[^\/]+\/)?|\/photo\/?\?fbid=|\bmedia_id=|\/videos\/(?:[^\/]+\/)?|\/posts\/)(\d{8,25})/i);
        if (fbPhotoMatch && fbPhotoMatch[1]) {
          candidates.push(`https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${fbPhotoMatch[1]}`);
        }
      }

      if (post.thumbnail) candidates.push(post.thumbnail);
      if (post.thumbnail_url) candidates.push(post.thumbnail_url);
      if (post.media_url) candidates.push(post.media_url);
      if (Array.isArray(post.mediaUrl)) candidates.push(...post.mediaUrl);
      if (Array.isArray(post.mediaUrls)) candidates.push(...post.mediaUrls);
      if (typeof post.mediaUrl === 'string') candidates.push(...post.mediaUrl.split(','));
      if (typeof post.mediaUrls === 'string') candidates.push(...post.mediaUrls.split(','));

      // If Facebook post page (videos, reel, posts, permalink), allow pUrl so proxy can resolve fresh og:image
      if ((platform === 'Facebook' || pUrl.includes('facebook.com')) && pUrl && (pUrl.includes('/videos/') || pUrl.includes('/reel/') || pUrl.includes('/posts/') || pUrl.includes('permalink.php') || pUrl.includes('story.php'))) {
        candidates.push(pUrl);
      }

      for (let c of candidates) {
        if (!c || typeof c !== 'string') continue;
        let trimmed = c.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          let lower = trimmed.toLowerCase();

          // Exclude static placeholders, small icons, profile pics, and LinkedIn aero-v1 static assets
          if (lower.includes('static.licdn.com') || lower.includes('aero-v1') || lower.includes('c45fy346jw096z9pbphyyhdz7') ||
              lower.includes('rsrc.php') || lower.includes('/images/icons/') || lower.includes('/static/images/') ||
              lower.includes('favicon') ||
              lower.includes('p100x100') || lower.includes('p200x200') || lower.includes('p50x50') ||
              lower.includes('p36x36') || lower.includes('p75x75') || lower.includes('p160x160') ||
              lower.includes('p320x320') || lower.includes('s100x100') || lower.includes('s200x200') ||
              lower.includes('s50x50') || lower.includes('s36x36') || lower.includes('s75x75') ||
              lower.includes('profile_pic') || lower.includes('profile_photo') || lower.includes('avatar') ||
              lower.includes('cover_photo') || lower.includes('profile_cover') || lower.includes('banner') ||
              lower.includes('header') || lower.includes('emoji')) {
            continue;
          }

          // Exclude HTML webpage/profile links (but ALLOW /media/ endpoints and supported FB post pages)
          try {
            const parsed = new URL(trimmed);
            const host = parsed.hostname.toLowerCase();
            const path = parsed.pathname.toLowerCase();

            if (
              ((host === 'instagram.com' || host === 'www.instagram.com') && !path.includes('/media/') && (path.includes('/p/') || path.includes('/reel/') || path.includes('/stories/') || path.split('/').filter(Boolean).length <= 1)) ||
              ((host === 'facebook.com' || host === 'www.facebook.com' || host === 'm.facebook.com' || host === 'web.facebook.com') && !path.includes('permalink.php') && !path.includes('story.php') && (path.split('/').filter(Boolean).length <= 1)) ||
              ((host === 'linkedin.com' || host === 'www.linkedin.com') && (path.includes('/posts/') || path.includes('/feed/update/') || path.includes('/in/') || path.includes('/company/'))) ||
              (host === 'youtube.com' || host === 'www.youtube.com' || host === 'youtu.be')
            ) {
              continue;
            }
          } catch (e) {
            continue;
          }

          // Accept media CDN domains, /media/ endpoints, FB post pages, or files with image/video extensions
          if (lower.includes('cdninstagram') || lower.includes('fbcdn') || lower.includes('fbsbx') ||
              lower.includes('lookaside') || lower.includes('/media/?size=') || lower.includes('/media/') ||
              lower.includes('permalink.php') || lower.includes('/posts/') || lower.includes('/videos/') || lower.includes('/photos/') ||
              lower.includes('media.licdn.com') || lower.includes('dms.licdn.com') || lower.includes('licdn.com/dms') ||
              lower.includes('ytimg') || lower.includes('googleusercontent.com') || lower.includes('unsplash.com') ||
              lower.match(/\.(jpeg|jpg|png|gif|webp|svg|mp4)(\?|$)/i)) {
            return trimmed;
          }
        }
      }

      // If no valid media thumbnail was found, but it is an Instagram post with a valid shortcode:
      if (sc && !isBundle && (platform === 'Instagram' || post._detectedPlatform === 'Instagram' || pUrl.includes('instagram.com'))) {
        return `https://www.instagram.com/p/${sc}/media/?size=l`;
      }

      return null;
    };

    window.isMediaUrl = function(u) {
      if (!u || typeof u !== 'string' || !u.startsWith('http')) return false;
      const lower = u.toLowerCase();
      if (lower.includes('static.licdn.com') || lower.includes('aero-v1') || lower.includes('c45fy346jw096z9pbphyyhdz7')) return false;
      try {
        const parsed = new URL(u);
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname.toLowerCase();
        if (
          ((host === 'instagram.com' || host === 'www.instagram.com') && !path.includes('/media/') && (path.includes('/p/') || path.includes('/reel/'))) ||
          ((host === 'facebook.com' || host === 'www.facebook.com' || host === 'm.facebook.com') && (path.includes('/posts/') || path.includes('/videos/'))) ||
          ((host === 'linkedin.com' || host === 'www.linkedin.com') && (path.includes('/posts/') || path.includes('/feed/update/')))
        ) {
          return false;
        }
      } catch(e) {
        return false;
      }
      return lower.includes('fbcdn') || lower.includes('fbsbx') || lower.includes('lookaside') || lower.includes('cdninstagram') ||
             lower.includes('/media/?size=') || lower.includes('/media/') ||
             lower.includes('media.licdn.com') || lower.includes('dms.licdn.com') || lower.includes('licdn.com/dms') ||
             lower.includes('ytimg') || lower.includes('googleusercontent') || !!lower.match(/\.(jpeg|jpg|png|gif|webp|svg)(\?|$)/i) || lower.includes('unsplash');
    };

    window.gridVideoFailed = function(el, platform, icon, encodedBg) {
      if (!el) return;
      el.onerror = null;
      const container = el.parentElement;
      if (container) {
        const bg = encodedBg ? decodeURIComponent(encodedBg) : 'linear-gradient(135deg, #1e293b, #0f172a)';
        const pIcon = icon || '🌐';
        const pName = platform || 'Social Post';
        container.style.background = bg;
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        container.innerHTML = `
          <div style="width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,0.16);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:6px;">${pIcon}</div>
          <span style="font-size:12px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">${pName}</span>
          <span style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.78);margin-top:2px;">Preview Post ↗</span>
        `;
      }
    };

    window.renderIgVideoFallback = function(container, post) {
      if (!container) return;
      const pLink = (post.link || post.post_url || post.postUrl || '').trim();
      const sc = post.shortcode || (pLink.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i) || [])[1];
      const thumb = (sc ? `https://www.instagram.com/p/${sc}/media/?size=l` : '') || post.thumbnail || post.thumbnail_url || post.media_url || '';
      const proxiedThumb = thumb ? window.getSocialMediaProxyUrl(thumb, pLink) : '';
      const compName = post.company || post.competitorName || post.competitor_name || 'Competitor';
      container.innerHTML = `
        <div style="width: 100%; height: 100%; background: #040814; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 24px; box-sizing: border-box; text-align: center;">
          ${proxiedThumb ? `
            <div style="position: relative; width: 100%; max-width: 480px; max-height: 60%; aspect-ratio: 9/16; margin-bottom: 20px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 8px 24px rgba(0,0,0,0.6);">
              <img src="${proxiedThumb}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none';" />
              ${pLink ? `<a href="${pLink}" target="_blank" rel="noopener noreferrer" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 56px; height: 56px; background: rgba(225, 48, 108, 0.9); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; text-decoration: none; box-shadow: 0 4px 16px rgba(0,0,0,0.6); transition: transform 0.2s;" onmouseover="this.style.transform='translate(-50%, -50%) scale(1.1)'" onmouseout="this.style.transform='translate(-50%, -50%) scale(1)'">▶</a>` : ''}
            </div>` : `
            <div style="width: 76px; height: 76px; border-radius: 50%; background: rgba(225, 48, 108, 0.2); border: 2px solid rgba(225, 48, 108, 0.5); display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 18px; color: #e1306c;">
              📹
            </div>`}
          <div style="position: absolute; top: 16px; left: 16px; background: #e1306c; color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; z-index: 10; text-transform: uppercase;">📹 INSTAGRAM REEL</div>
          <h4 style="font-size: 1.15rem; font-weight: 700; color: #ffffff; margin: 0 0 8px 0;">${window.escapeHtml(compName)}</h4>
          <p style="font-size: 0.88rem; color: #94a3b8; margin: 0 0 20px 0; max-width: 360px;">To watch this official reel, view it directly on Instagram.</p>
          ${pLink ? `
            <a href="${pLink}" target="_blank" rel="noopener noreferrer" style="background: #e1306c; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.92rem; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(225, 48, 108, 0.4); transition: transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
              <span>▶ Watch Reel on Instagram</span> ↗
            </a>` : ''}
        </div>`;
    };

    window.handleIgVideoError = function(videoEl, idx, customPosts) {
      if (!videoEl || !videoEl.parentElement) return;
      const postsArray = customPosts || window.allFeedPosts;
      const post = postsArray && postsArray[idx];
      if (!post) return;
      if (!videoEl.dataset.retried) {
        videoEl.dataset.retried = 'true';
        const pLink = (post.link || post.post_url || post.postUrl || '').trim();
        if (pLink) {
          fetch('/api/social-video-url?url=' + encodeURIComponent(pLink))
            .then(r => r.json())
            .then(data => {
              if (data && data.success && data.videoUrl) {
                videoEl.src = '/api/instagram-video-stream?url=' + encodeURIComponent(data.videoUrl) + '&post_url=' + encodeURIComponent(pLink);
                videoEl.load();
                videoEl.play().catch(() => {});
                return;
              }
              window.renderIgVideoFallback(videoEl.parentElement, post);
            })
            .catch(() => window.renderIgVideoFallback(videoEl.parentElement, post));
          return;
        }
      }
      window.renderIgVideoFallback(videoEl.parentElement, post);
    };

    window.renderFbVideoFallback = function(container, post) {
      if (!container) return;
      const pLink = (post.link || post.post_url || post.postUrl || '').trim();
      const thumb = post.thumbnail || post.media_url || (post.media_urls && post.media_urls[0]) || pLink || '';
      const proxiedThumb = thumb ? window.getSocialMediaProxyUrl(thumb, pLink) : '';
      const compName = post.company || post.competitorName || post.competitor_name || 'Competitor';
      container.innerHTML = `
        <div style="width: 100%; height: 100%; background: #040814; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 24px; box-sizing: border-box; text-align: center;">
          ${proxiedThumb ? `
            <div style="position: relative; width: 100%; max-width: 480px; max-height: 60%; aspect-ratio: 16/9; margin-bottom: 20px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 8px 24px rgba(0,0,0,0.6);">
              <img src="${proxiedThumb}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none';" />
              ${pLink ? `<a href="${pLink}" target="_blank" rel="noopener noreferrer" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 56px; height: 56px; background: rgba(24, 119, 242, 0.9); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; text-decoration: none; box-shadow: 0 4px 16px rgba(0,0,0,0.6); transition: transform 0.2s;" onmouseover="this.style.transform='translate(-50%, -50%) scale(1.1)'" onmouseout="this.style.transform='translate(-50%, -50%) scale(1)'">▶</a>` : ''}
            </div>` : `
            <div style="width: 76px; height: 76px; border-radius: 50%; background: rgba(24, 119, 242, 0.2); border: 2px solid rgba(24, 119, 242, 0.5); display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 18px; color: #1877f2;">
              📹
            </div>`}
          <div style="position: absolute; top: 16px; left: 16px; background: #1877f2; color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; z-index: 10; text-transform: uppercase;">📹 FACEBOOK VIDEO</div>
          <h4 style="font-size: 1.15rem; font-weight: 700; color: #ffffff; margin: 0 0 8px 0;">${window.escapeHtml(compName)}</h4>
          <p style="font-size: 0.88rem; color: #94a3b8; margin: 0 0 20px 0; max-width: 360px;">To watch this official video, view it directly on Facebook.</p>
          ${pLink ? `
            <a href="${pLink}" target="_blank" rel="noopener noreferrer" style="background: #1877f2; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.92rem; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(24, 119, 242, 0.4); transition: transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
              <span>▶ Watch Video on Facebook</span> ↗
            </a>` : ''}
        </div>`;
    };

    window.handleFbVideoError = function(videoEl, idx, customPosts) {
      if (!videoEl || !videoEl.parentElement) return;
      const postsArray = customPosts || window.allFeedPosts;
      const post = postsArray && postsArray[idx];
      if (!post) return;
      if (!videoEl.dataset.retried) {
        videoEl.dataset.retried = 'true';
        const pLink = (post.link || post.post_url || post.postUrl || '').trim();
        if (pLink) {
          fetch('/api/social-video-url?url=' + encodeURIComponent(pLink))
            .then(r => r.json())
            .then(data => {
              if (data && data.success && data.videoUrl) {
                videoEl.src = window.getSocialMediaProxyUrl(data.videoUrl);
                videoEl.load();
                videoEl.play().catch(() => {});
                return;
              }
              window.renderFbVideoFallback(videoEl.parentElement, post);
            })
            .catch(() => window.renderFbVideoFallback(videoEl.parentElement, post));
          return;
        }
      }
      window.renderFbVideoFallback(videoEl.parentElement, post);
    };

    window.resolveFbVideo = async function(idx, customPosts) {
      const postsArray = customPosts || window.allFeedPosts;
      const post = postsArray && postsArray[idx];
      if (!post) return;
      const pLink = (post.link || post.post_url || post.postUrl || '').trim();
      const container = document.getElementById('fb-video-container-' + idx);
      if (!container) return;
      if (!pLink) {
        window.renderFbVideoFallback(container, post);
        return;
      }

      try {
        const res = await fetch('/api/social-video-url?url=' + encodeURIComponent(pLink));
        const data = await res.json();
        if (data.success && data.videoUrl) {
          post.video_url = data.videoUrl;
          const videoSrc = window.getSocialMediaProxyUrl(data.videoUrl);
          container.innerHTML = `
            <video src="${videoSrc}" controls autoplay preload="auto" playsinline style="max-width: 100%; max-height: 100%; object-fit: contain; background: #000; border-radius: 8px;" onerror="window.handleFbVideoError(this, ${idx});"></video>
            <div style="position: absolute; top: 16px; left: 16px; background: #1877f2; color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; z-index: 10; text-transform: uppercase;">📹 FACEBOOK VIDEO</div>
            <div style="position: absolute; bottom: 12px; right: 12px; z-index: 10;">
              <a href="${pLink}" target="_blank" rel="noopener noreferrer" style="background: rgba(0,0,0,0.75); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; padding: 5px 12px; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">Watch on Facebook ↗</a>
            </div>`;
        } else {
          window.renderFbVideoFallback(container, post);
        }
      } catch (e) {
        window.renderFbVideoFallback(container, post);
      }
    };

    window.platformMeta = {
      'YouTube': { icon: '▶️', color: '#ff0000', badgeBg: '#cc0000', bg: 'linear-gradient(135deg, #2b0606, #120303)' },
      'Facebook': { icon: '📘', color: '#1877f2', badgeBg: '#1877f2', bg: 'linear-gradient(135deg, #0f2b5c, #071633)' },
      'Instagram': { icon: '📸', color: '#e1306c', badgeBg: '#d62976', bg: 'linear-gradient(135deg, #3d0d2b, #1f0516)' },
      'LinkedIn': { icon: '💼', color: '#0a66c2', badgeBg: '#0a66c2', bg: 'linear-gradient(135deg, #092747, #031224)' },
      'Twitter': { icon: '🐦', color: '#1da1f2', badgeBg: '#1da1f2', bg: 'linear-gradient(135deg, #082136, #03101c)' },
      'X': { icon: '𝕏', color: '#000000', badgeBg: '#1e293b', bg: 'linear-gradient(135deg, #1e293b, #0f172a)' },
      'News & Press': { icon: '📰', color: '#64748b', badgeBg: '#475569', bg: 'linear-gradient(135deg, #1e293b, #0f172a)' }
    };
    const platformMeta = window.platformMeta;

    // Inject lightbox modal once
    window.closeFeedModal = function() {
      const lb = document.getElementById('media-lightbox');
      const content = document.getElementById('media-lightbox-content');
      if (lb) lb.style.display = 'none';
      if (content) content.innerHTML = '';
    };

    if (!document.getElementById('media-lightbox')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="media-lightbox" onclick="if(event.target === this) window.closeFeedModal()" class="media-lightbox" style="display:none;">
          <button class="media-lightbox-close" type="button" aria-label="Close post preview" onclick="window.closeFeedModal()">&times;</button>
          <div id="media-lightbox-content" style="width: 100%; height: 100%; display:flex; justify-content:center; align-items:center; padding: 40px;"></div>
        </div>
      `);
      
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          window.closeFeedModal();
        }
      });
    }

    // Modal popup function using index lookup
    window.openFeedItemModal = function(globalIndex, mode, customPosts) {
      const postsArray = customPosts || window.allFeedPosts;
      const post = postsArray ? postsArray[globalIndex] : null;
      if (!post) {
        console.warn('Feed post not found for index:', globalIndex);
        return;
      }

      const lb = document.getElementById('media-lightbox');
      const content = document.getElementById('media-lightbox-content');
      if (!lb || !content) return;

      const compName = post.company || post.competitorName || (window.projectMemory && window.projectMemory.businessIdentity && window.projectMemory.businessIdentity.officialName) || 'Company Post';
      const platform = post.platform || post._detectedPlatform || 'Social Feed';
      const meta = (window.platformMeta && window.platformMeta[platform]) || (window.platformMeta && window.platformMeta['LinkedIn']) || { icon: '🌐', color: '#3b82f6', badgeBg: '#3b82f6', bg: 'linear-gradient(135deg, #1e293b, #0f172a)' };
      const postLink = (post.post_url || post.link || post.postUrl || '').trim();
      let rawText = (post.caption || post.content || '').trim();
      const isBoilerplateModal = !rawText ||
        rawText === 'No caption' || rawText === 'No caption.' ||
        rawText.includes('Welcome back to Instagram') ||
        rawText.includes('Sign in to check out') ||
        rawText.includes('Log in to see photos') ||
        rawText.includes('No photo description available') ||
        rawText.includes('May be an image of') ||
        rawText.includes('See posts, photos and more on Facebook') ||
        rawText.includes('Log into Facebook') ||
        rawText.includes('See more posts') ||
        rawText.includes('merriam-webster') ||
        rawText.includes('dictionary.com') ||
        rawText.toLowerCase() === 'instagram' ||
        rawText.toLowerCase() === 'facebook';

      if (isBoilerplateModal) {
        let slugTitle = "";
        const slugMatch = postLink.match(/\/(?:videos|posts|reel)\/([a-zA-Z0-9_-]{10,})/i);
        if (slugMatch && slugMatch[1] && !/^\d+$/.test(slugMatch[1])) {
          slugTitle = slugMatch[1].replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (slugTitle.length > 5) {
            slugTitle = slugTitle.charAt(0).toUpperCase() + slugTitle.slice(1);
          }
        }
        rawText = slugTitle || (platform === 'Facebook' ? `${compName} - Official Facebook Post` : (platform === 'Instagram' ? `${compName} - Official Instagram Post` : `${compName} - Official ${platform} Post`));
      }
      const displayDate = post.date || post.published_date || post.timestamp || 'Recent';

      const firstMediaUrl = post._mediaResolved || window.extractSingleMediaUrl(post);
      const ytId = post._ytVidId || post._ytId || window.getYouTubeId(postLink) || window.getYouTubeId(firstMediaUrl || '') || window.getYouTubeId(rawText);

      // Extract shortcode for Instagram
      let igShortcode = post.shortcode || '';
      if (!igShortcode && postLink) {
        const m = postLink.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i);
        if (m) igShortcode = m[1];
      }

      // Extract activity ID for LinkedIn
      let liActivityId = post.activity_id || '';
      if (!liActivityId && postLink) {
        const m = postLink.match(/(?:activity-|activity:|ugcPost:|share:)(\d+)/);
        if (m) liActivityId = m[1];
      }

      const isRealDirectVideo = Boolean(
        post.video_url ||
        (firstMediaUrl && firstMediaUrl.match(/\.(mp4|webm|ogg)(\?|$)/i) && !firstMediaUrl.includes('thumbnail'))
      );

      const isIgReel = (platform === 'Instagram' || post._detectedPlatform === 'Instagram') && (postLink.includes('/reel/') || post.media_type === 'Video' || post.mediaType === 'Video' || Boolean(post.video_url));
      const isIgPost = (platform === 'Instagram' || post._detectedPlatform === 'Instagram');
      const isFbVid = (platform === 'Facebook' || post._detectedPlatform === 'Facebook') &&
                      (Boolean(post.video_url) || Boolean(post.fb_video_id) || post.media_type === 'Video' || post.mediaType === 'Video' || /\/(?:videos|reel|watch)\b/i.test(postLink));
      const isLiVid = (platform === 'LinkedIn' || post._detectedPlatform === 'LinkedIn') &&
                      (Boolean(post.video_url) || post.media_type === 'Video' || post.mediaType === 'Video' || postLink.includes('/video/') || (firstMediaUrl && (firstMediaUrl.includes('/playlist/vid/') || firstMediaUrl.includes('video.licdn.com') || firstMediaUrl.includes('thumbnail-with-play-button'))));

      let leftMediaHtml = '';
      let activeMode = mode || 'default';

      if (ytId) {
        leftMediaHtml = `
          <div style="width: 100%; height: 100%; background: #000; display:flex; align-items:center; justify-content:center; position:relative;">
            <iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1&enablejsapi=1" 
              style="width: 100%; height: 100%; border: 0;" 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
              referrerpolicy="no-referrer-when-downgrade"
              allowfullscreen></iframe>
          </div>`;
      } else if (isIgReel) {
        // Instagram Reel/Video inline playable dashboard player: Stream MP4 directly via /api/instagram-video-stream
        let igCanonicalUrl = postLink;
        if (!igCanonicalUrl && igShortcode) {
          igCanonicalUrl = `https://www.instagram.com/reel/${igShortcode}/`;
        }
        const videoTarget = igCanonicalUrl || post.video_url || firstMediaUrl;

        if (videoTarget) {
          const videoStreamSrc = `/api/instagram-video-stream?url=${encodeURIComponent(videoTarget)}${igCanonicalUrl ? `&post_url=${encodeURIComponent(igCanonicalUrl)}` : ''}`;
          const thumb = post.thumbnail || post.thumbnail_url || post.media_url || firstMediaUrl || (igShortcode ? `https://www.instagram.com/p/${igShortcode}/media/?size=l` : '');
          const posterAttr = (thumb && !thumb.includes('.mp4')) ? `poster="${window.getSocialMediaProxyUrl(thumb)}"` : '';

          leftMediaHtml = `
            <div id="ig-video-container-${globalIndex}" style="width: 100%; height: 100%; background: #000; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative; overflow:hidden;">
              <video src="${videoStreamSrc}" ${posterAttr} controls autoplay preload="auto" playsinline style="max-width: 100%; max-height: 100%; object-fit: contain; background: #000; border-radius: 8px;" onerror="window.handleIgVideoError(this, ${globalIndex}, ${customPosts ? 'customPosts' : 'null'});"></video>
              <div style="position: absolute; top: 16px; left: 16px; background: #e1306c; color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; z-index: 10; text-transform: uppercase; pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">📹 INSTAGRAM REEL</div>
              ${postLink ? `
                <div style="position: absolute; bottom: 12px; right: 12px; z-index: 10;">
                  <a href="${postLink}" target="_blank" rel="noopener noreferrer" style="background: rgba(0,0,0,0.75); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; padding: 5px 12px; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">Watch on Instagram ↗</a>
                </div>` : ''}
            </div>`;
        } else {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: ${meta.bg}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 36px; box-sizing: border-box;">
              <div style="width: 76px; height: 76px; border-radius: 50%; background: rgba(255,255,255,0.18); border: 2px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 18px;">
                📹
              </div>
              <h3 style="font-size: 1.35rem; font-weight: 700; color: #ffffff; margin: 0 0 6px 0;">${window.escapeHtml(compName)}</h3>
              <p style="font-size: 0.9rem; color: rgba(255,255,255,0.75); margin: 0 0 20px 0;">Instagram Reel</p>
              ${postLink ? `<a href="${postLink}" target="_blank" rel="noopener noreferrer" style="background: ${meta.badgeBg || '#e1306c'}; color: white; padding: 11px 24px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.9rem;">Play on Instagram ↗</a>` : ''}
            </div>`;
        }
      } else if (isIgPost) {
        // Instagram Post Preview (Clean high-resolution uncropped full photo with optional embed toggle)
        const fullIgImgUrl = igShortcode ? `https://www.instagram.com/p/${igShortcode}/media/?size=l` : firstMediaUrl;
        if (activeMode === 'embed' && igShortcode) {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #080d1a; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 12px; box-sizing: border-box;">
              <iframe src="https://www.instagram.com/p/${igShortcode}/embed/" 
                style="width: 100%; max-width: 480px; height: 90%; max-height: 650px; border: 0; background: #fff; border-radius: 12px; margin: auto;" 
                frameborder="0" scrolling="no" allowtransparency="true" 
                allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" 
                allowfullscreen></iframe>
              ${fullIgImgUrl ? `
                <div style="position: absolute; bottom: 8px; left: 8px; z-index: 10;">
                  <button type="button" onclick="window.openFeedItemModal(${globalIndex}, 'image')" style="background: rgba(0,0,0,0.75); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; padding: 5px 12px; font-size: 11px; font-weight: 600; cursor: pointer;">Clean Image View 🖼️</button>
                </div>` : ''}
            </div>`;
        } else if (fullIgImgUrl) {
          let imgSrc = window.getSocialMediaProxyUrl(fullIgImgUrl, postLink);
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #080d1a; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 16px; box-sizing: border-box;">
              <div style="position: absolute; top: 16px; left: 16px; background: ${meta.badgeBg || '#e1306c'}; color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; z-index: 10; text-transform: uppercase;">📸 INSTAGRAM</div>
              <img src="${imgSrc}" referrerpolicy="no-referrer" style="max-width: 96% !important; max-height: 92% !important; width: auto !important; height: auto !important; object-fit: contain !important; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);" onerror="this.onerror=null; ${igShortcode ? `this.parentElement.innerHTML = '<iframe src=\\'https://www.instagram.com/p/${igShortcode}/embed/\\' style=\\'width:100%;max-width:480px;height:90%;max-height:650px;border:0;border-radius:12px;margin:auto;background:#fff;\\' frameborder=\\'0\\' scrolling=\\'no\\' allowtransparency=\\'true\\' allowfullscreen></iframe>';` : (firstMediaUrl ? `this.src='${firstMediaUrl}';` : '')}" />
              ${igShortcode ? `
                <div style="position: absolute; bottom: 12px; left: 12px; z-index: 10;">
                  <button type="button" onclick="window.openFeedItemModal(${globalIndex}, 'embed')" style="background: rgba(0,0,0,0.75); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; padding: 5px 12px; font-size: 11px; font-weight: 600; cursor: pointer;">Switch to IG Embed ↗</button>
                </div>` : ''}
            </div>`;
        } else if (igShortcode) {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #080d1a; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 12px; box-sizing: border-box;">
              <iframe src="https://www.instagram.com/p/${igShortcode}/embed/" 
                style="width: 100%; max-width: 480px; height: 90%; max-height: 650px; border: 0; background: #fff; border-radius: 12px; margin: auto;" 
                frameborder="0" scrolling="no" allowtransparency="true" 
                allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" 
                allowfullscreen></iframe>
            </div>`;
        } else {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: ${meta.bg}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 36px; box-sizing: border-box;">
              <div style="width: 76px; height: 76px; border-radius: 50%; background: rgba(255,255,255,0.18); border: 2px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 18px;">
                ${meta.icon}
              </div>
              <h3 style="font-size: 1.35rem; font-weight: 700; color: #ffffff; margin: 0 0 6px 0;">${window.escapeHtml(compName)}</h3>
              <p style="font-size: 0.9rem; color: rgba(255,255,255,0.75); margin: 0 0 20px 0;">Official Instagram Post</p>
              ${postLink ? `<a href="${postLink}" target="_blank" rel="noopener noreferrer" style="background: ${meta.badgeBg || '#e1306c'}; color: white; padding: 11px 24px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 8px;">
                <span>View on Instagram</span> ↗
              </a>` : ''}
            </div>`;
        }
      } else if (isLiVid) {
        // LinkedIn Video preview: High quality direct MP4 stream or official player
        if (activeMode === 'embed' && liActivityId) {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #000; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;">
              <iframe src="/api/linkedin-embed-player?id=${liActivityId}" 
                style="width: 100%; height: 100%; border: 0; background: #000; border-radius: 8px;" 
                frameborder="0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture" 
                allowfullscreen></iframe>
              ${post.video_url ? `
                <div style="position: absolute; bottom: 12px; left: 12px; z-index: 10;">
                  <button type="button" onclick="window.openFeedItemModal(${globalIndex}, 'video')" style="background: rgba(0,0,0,0.7); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; padding: 4px 10px; font-size: 11px; cursor: pointer;">Direct MP4 Player ▶</button>
                </div>` : ''}
            </div>`;
        } else if (post.video_url) {
          let videoSrc = window.getSocialMediaProxyUrl(post.video_url);
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #000; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;">
              <video src="${videoSrc}" controls autoplay preload="auto" playsinline style="max-width: 100%; max-height: 100%; object-fit: contain; background: #000; border-radius: 8px;"></video>
              ${liActivityId ? `
                <div style="position: absolute; bottom: 12px; left: 12px; z-index: 10;">
                  <button type="button" onclick="window.openFeedItemModal(${globalIndex}, 'embed')" style="background: rgba(0,0,0,0.7); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; padding: 4px 10px; font-size: 11px; cursor: pointer;">LinkedIn Player ↗</button>
                </div>` : ''}
            </div>`;
        } else if (liActivityId) {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #000; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;">
              <iframe src="/api/linkedin-embed-player?id=${liActivityId}" 
                style="width: 100%; height: 100%; border: 0; background: #000; border-radius: 8px;" 
                frameborder="0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture" 
                allowfullscreen></iframe>
            </div>`;
        } else if (firstMediaUrl) {
          let videoSrc = window.getSocialMediaProxyUrl(firstMediaUrl);
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #000; display:flex; align-items:center; justify-content:center; position:relative;">
              <video src="${videoSrc}" controls autoplay preload="auto" playsinline style="max-width: 100%; max-height: 100%; object-fit: contain; background: #000; border-radius: 8px;"></video>
            </div>`;
        } else {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: ${meta.bg}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 36px; box-sizing: border-box;">
              <div style="width: 76px; height: 76px; border-radius: 50%; background: rgba(255,255,255,0.18); border: 2px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 18px;">
                ${meta.icon}
              </div>
              <h3 style="font-size: 1.35rem; font-weight: 700; color: #ffffff; margin: 0 0 6px 0;">${window.escapeHtml(compName)}</h3>
              <p style="font-size: 0.9rem; color: rgba(255,255,255,0.75); margin: 0 0 20px 0;">Official LinkedIn Video</p>
              ${postLink ? `<a href="${postLink}" target="_blank" rel="noopener noreferrer" style="background: ${meta.badgeBg || '#0a66c2'}; color: white; padding: 11px 24px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.9rem;">View on LinkedIn ↗</a>` : ''}
            </div>`;
        }
      } else if (platform === 'LinkedIn' || post._detectedPlatform === 'LinkedIn') {
        // LinkedIn Regular Post (Photo, Carousel, or Article Update)
        if (firstMediaUrl) {
          let imgSrc = window.getSocialMediaProxyUrl(firstMediaUrl);
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #080d1a; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 20px; box-sizing: border-box;">
              <div style="position: absolute; top: 16px; left: 16px; background: ${meta.badgeBg || '#0a66c2'}; color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; z-index: 10; text-transform: uppercase;">💼 LINKEDIN</div>
              <img src="${imgSrc}" referrerpolicy="no-referrer" style="max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);" onerror="this.onerror=null; this.src='${firstMediaUrl}';" />
              ${postLink ? `
                <div style="position: absolute; bottom: 12px; right: 12px; z-index: 10;">
                  <a href="${postLink}" target="_blank" rel="noopener noreferrer" style="background: rgba(0,0,0,0.75); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; padding: 5px 12px; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">View on LinkedIn ↗</a>
                </div>` : ''}
            </div>`;
        } else if (liActivityId) {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: #000; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;">
              <iframe src="/api/linkedin-embed-player?id=${liActivityId}" 
                style="width: 100%; height: 100%; border: 0; background: #000; border-radius: 8px;" 
                frameborder="0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture" 
                allowfullscreen></iframe>
            </div>`;
        } else {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: ${meta.bg}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 36px; box-sizing: border-box;">
              <div style="width: 76px; height: 76px; border-radius: 50%; background: rgba(255,255,255,0.18); border: 2px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 18px;">
                💼
              </div>
              <h3 style="font-size: 1.35rem; font-weight: 700; color: #ffffff; margin: 0 0 6px 0;">${window.escapeHtml(compName)}</h3>
              <p style="font-size: 0.9rem; color: rgba(255,255,255,0.75); margin: 0 0 20px 0;">Official LinkedIn Update</p>
              ${postLink ? `<a href="${postLink}" target="_blank" rel="noopener noreferrer" style="background: ${meta.badgeBg || '#0a66c2'}; color: white; padding: 11px 24px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.9rem;">View on LinkedIn ↗</a>` : ''}
            </div>`;
        }
      } else if (isFbVid) {
        // Facebook video player: Stream video directly in dashboard modal via /api/facebook-video-stream
        let fbCanonicalUrl = postLink;
        if (!fbCanonicalUrl && post.fb_video_id) {
          fbCanonicalUrl = `https://www.facebook.com/watch/?v=${post.fb_video_id}`;
        }
        const videoTarget = fbCanonicalUrl || post.video_url || firstMediaUrl;

        if (videoTarget) {
          const videoStreamSrc = `/api/facebook-video-stream?url=${encodeURIComponent(videoTarget)}`;
          const thumb = post.thumbnail || post.thumbnail_url || post.media_url || firstMediaUrl || fbCanonicalUrl || '';
          const posterAttr = (thumb && !thumb.includes('.mp4')) ? `poster="${window.getSocialMediaProxyUrl(thumb, fbCanonicalUrl)}"` : (fbCanonicalUrl ? `poster="${window.getSocialMediaProxyUrl(fbCanonicalUrl, fbCanonicalUrl)}"` : '');

          leftMediaHtml = `
            <div id="fb-video-container-${globalIndex}" style="width: 100%; height: 100%; background: #000; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative; overflow:hidden;">
              <video src="${videoStreamSrc}" ${posterAttr} controls autoplay preload="auto" playsinline style="max-width: 100%; max-height: 100%; object-fit: contain; background: #000; border-radius: 8px;" onerror="window.handleFbVideoError(this, ${globalIndex}, ${customPosts ? 'customPosts' : 'null'});"></video>
              <div style="position: absolute; top: 16px; left: 16px; background: #1877f2; color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; z-index: 10; text-transform: uppercase; pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">📹 FACEBOOK VIDEO</div>
              ${fbCanonicalUrl ? `
                <div style="position: absolute; bottom: 12px; right: 12px; z-index: 10;">
                  <a href="${fbCanonicalUrl}" target="_blank" rel="noopener noreferrer" style="background: rgba(0,0,0,0.75); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; padding: 5px 12px; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">Watch on Facebook ↗</a>
                </div>` : ''}
            </div>`;
        } else {
          leftMediaHtml = `
            <div style="width: 100%; height: 100%; background: ${meta.bg}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 36px; box-sizing: border-box;">
              <div style="width: 76px; height: 76px; border-radius: 50%; background: rgba(255,255,255,0.18); border: 2px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 18px;">
                📹
              </div>
              <h3 style="font-size: 1.35rem; font-weight: 700; color: #ffffff; margin: 0 0 6px 0;">${window.escapeHtml(compName)}</h3>
              <p style="font-size: 0.9rem; color: rgba(255,255,255,0.75); margin: 0 0 20px 0;">Official Facebook Video</p>
            </div>`;
        }
      } else if (isRealDirectVideo) {
        let videoSrc = window.getSocialMediaProxyUrl(post.video_url || firstMediaUrl);
        leftMediaHtml = `
          <div style="width: 100%; height: 100%; background: #000; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;">
            <video src="${videoSrc}" controls autoplay preload="auto" playsinline style="max-width: 100%; max-height: 100%; object-fit: contain; background: #000; border-radius: 8px;"></video>
          </div>`;
      } else if (firstMediaUrl) {
        let imgSrc = window.getSocialMediaProxyUrl(firstMediaUrl);
        leftMediaHtml = `
          <div style="width: 100%; height: 100%; background: #080d1a; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 20px; box-sizing: border-box;">
            <div style="position: absolute; top: 16px; left: 16px; background: ${meta.badgeBg || '#3b82f6'}; color: white; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; z-index: 10; text-transform: uppercase; letter-spacing: 0.05em; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
              ${meta.icon || '📷'} ${platform || 'Media'}
            </div>
            <img src="${imgSrc}" referrerpolicy="no-referrer" style="max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; display: block; margin: auto; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);" onerror="this.onerror=null; this.src='${firstMediaUrl}'; this.onerror=function(){ this.parentElement.innerHTML=\`<div style='text-align:center; padding:40px; color:#ffffff;'><div style='font-size:64px; margin-bottom:16px;'>${meta.icon || '🌐'}</div><h3 style='margin:0 0 8px 0;'>${window.escapeHtml(compName)}</h3><p style='color:#94a3b8; margin-bottom:24px;'>Official ${platform} Content</p><a href='${postLink || firstMediaUrl}' target='_blank' style='background:${meta.color || '#3b82f6'}; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold;'>View Original Post ↗</a></div>\`; };" />
            ${postLink ? `
              <div style="position: absolute; bottom: 12px; right: 12px; z-index: 10;">
                <a href="${postLink}" target="_blank" rel="noopener noreferrer" style="background: rgba(0,0,0,0.7); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; padding: 4px 10px; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">View on ${platform} ↗</a>
              </div>` : ''}
          </div>`;
      } else {
        leftMediaHtml = `
          <div style="width: 100%; height: 100%; background: ${meta.bg}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 36px; box-sizing: border-box;">
            <div style="width: 76px; height: 76px; border-radius: 50%; background: rgba(255,255,255,0.18); border: 2px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 18px; box-shadow: 0 8px 24px rgba(0,0,0,0.3);">
              ${meta.icon}
            </div>
            <h3 style="font-size: 1.35rem; font-weight: 700; color: #ffffff; margin: 0 0 6px 0;">${window.escapeHtml(compName)}</h3>
            <p style="font-size: 0.9rem; color: rgba(255,255,255,0.75); margin: 0 0 20px 0;">Official ${platform} Post</p>
            ${postLink ? `<a href="${postLink}" target="_blank" rel="noopener noreferrer" style="background: ${meta.badgeBg || '#3b82f6'}; color: white; padding: 11px 24px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.3);">
              <span>View Original Post on ${platform}</span> ↗
            </a>` : ''}
          </div>`;
      }

      let likes = post.engagement?.likes || post.likes;
      let comments = post.engagement?.comments || post.comments;
      let likesHtml = likes && likes !== '0' && likes !== 'Hidden' ? `<span>❤️ ${window.escapeHtml(String(likes))}</span>` : '';
      let commentsHtml = comments && comments !== '0' && comments !== 'Hidden' ? `<span>💬 ${window.escapeHtml(String(comments))}</span>` : '';
      let statsBar = (likesHtml || commentsHtml) ? `<div style="display:flex; gap:16px; font-size:0.85rem; color:#94a3b8; margin-top:6px; font-weight:600;">${likesHtml}${commentsHtml}</div>` : '';

      content.innerHTML = `
        <div class="post-preview-dialog">
          <div class="post-preview-media">
            ${leftMediaHtml}
          </div>
          <div class="post-preview-details">
            <div class="post-preview-header">
              <div>
                <div class="post-preview-author">${window.escapeHtml(compName)}</div>
                <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">${window.escapeHtml(displayDate)}</div>
                ${statsBar}
              </div>
              <span style="font-size: 0.65rem; font-weight: 800; padding: 4px 10px; border-radius: 4px; background: ${meta.color || '#3b82f6'}; color: #ffffff; text-transform: uppercase; letter-spacing: 0.05em;">${platform}</span>
            </div>
            <div class="feed-text post-preview-caption">${window.escapeHtml(rawText || 'No caption available for this post.')}</div>
            ${postLink ? `<div class="post-preview-footer">
              <a href="${postLink}" target="_blank" onclick="event.stopPropagation(); window.open(this.href, '_blank'); return false;" style="display: block; width: 100%; padding: 12px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 8px; text-align: center; font-size: 13px; font-weight: 700; color: #60a5fa; text-decoration: none;">View Original Post ↗</a>
            </div>` : ''}
          </div>
        </div>
      `;

      lb.style.display = 'flex';
    };

    // Backward-compatibility wrapper for window.openLightbox
    window.openLightbox = function(encodedMediaUrl, isVideo, encodedPostLink, platform, mediaType, encodedContent, encodedAuthor, dateStr, platformColor, likes, comments) {
      if (window.allFeedPosts && window.allFeedPosts.length > 0) {
        window.openFeedItemModal(0);
      }
    };

    // Group posts into 4 separate dedicated platform sections
    const ytPosts = [];
    const igPosts = [];
    const fbPosts = [];
    const liPosts = [];

    const parsePostTimestamp = (p) => {
      if (!p) return 0;
      const raw = String(p.date || p.published_date || p.timestamp || '').trim();
      if (!raw) return 0;
      const lower = raw.toLowerCase();
      if (lower === 'today' || lower === 'just now' || lower.includes('minute') || lower.includes('second')) return Date.now();
      if (lower === 'yesterday') return Date.now() - 86400000;
      if (lower.includes('hour') && lower.includes('ago')) {
        const hrs = parseInt(lower) || 1;
        return Date.now() - (hrs * 3600000);
      }
      if (lower.includes('day') && lower.includes('ago')) {
        const days = parseInt(lower) || 1;
        return Date.now() - (days * 86400000);
      }
      if (lower.includes('week') && lower.includes('ago')) {
        const wks = parseInt(lower) || 1;
        return Date.now() - (wks * 7 * 86400000);
      }
      if (lower.includes('month') && lower.includes('ago')) {
        const mos = parseInt(lower) || 1;
        return Date.now() - (mos * 30 * 86400000);
      }
      if (lower.includes('year') && lower.includes('ago')) {
        const yrs = parseInt(lower) || 1;
        return Date.now() - (yrs * 365 * 86400000);
      }
      if (lower === 'recent') return Date.now() - 43200000;
      const parsed = Date.parse(raw);
      if (!isNaN(parsed)) return parsed;
      return 0;
    };

    feed.sort((a, b) => parsePostTimestamp(b) - parsePostTimestamp(a));

    const seenKeys = new Set();
    window.allFeedPosts = [];

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
      let rawContent = (post.content || '');
      let ytVidId = window.getYouTubeId(post.link || '') || window.getYouTubeId(post.mediaUrl || '') || window.getYouTubeId(rawContent);
      let firstMediaUrl = window.extractSingleMediaUrl(post);

      // Require valid media or valid social post link so all 4 platforms are consistently represented
      if (!firstMediaUrl && !ytVidId) {
        if (pLinkLower.includes('instagram.com') || pLinkLower.includes('facebook.com') || pLinkLower.includes('linkedin.com') || pLinkLower.includes('youtube.com') || post.link) {
          firstMediaUrl = post.thumbnail || post.media_url || post.link;
        } else {
          return;
        }
      }

      post._globalIndex = window.allFeedPosts.length;
      post._mediaResolved = firstMediaUrl;
      post._ytVidId = ytVidId;
      window.allFeedPosts.push(post);

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

    ytPosts.sort((a, b) => parsePostTimestamp(b) - parsePostTimestamp(a));
    igPosts.sort((a, b) => parsePostTimestamp(b) - parsePostTimestamp(a));
    fbPosts.sort((a, b) => parsePostTimestamp(b) - parsePostTimestamp(a));
    liPosts.sort((a, b) => parsePostTimestamp(b) - parsePostTimestamp(a));

    window.selectedCompPlat = window.selectedCompPlat || 'All';
    window.filterCompetitorFeed = function(selectedPlat) {
      window.selectedCompPlat = selectedPlat;
      const btns = document.querySelectorAll('.comp-feed-filter-btn');
      btns.forEach(b => {
        if (b.getAttribute('data-platform') === selectedPlat) {
          b.className = 'btn btn-primary comp-feed-filter-btn';
        } else {
          b.className = 'btn btn-secondary comp-feed-filter-btn';
        }
      });
      const sections = document.querySelectorAll('.comp-feed-platform-section');
      sections.forEach(s => {
        const p = s.getAttribute('data-platform');
        s.style.display = (selectedPlat === 'All' || p === selectedPlat) ? 'block' : 'none';
      });
    };

    const totalValidPosts = ytPosts.length + igPosts.length + fbPosts.length + liPosts.length;
    let filterBarHtml = `
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center;">
        <span style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-right: 4px;">Filter Platform:</span>
        <button type="button" class="btn ${window.selectedCompPlat === 'All' ? 'btn-primary' : 'btn-secondary'} comp-feed-filter-btn" data-platform="All" onclick="window.filterCompetitorFeed('All')">🌐 All (${totalValidPosts})</button>
        <button type="button" class="btn ${window.selectedCompPlat === 'YouTube' ? 'btn-primary' : 'btn-secondary'} comp-feed-filter-btn" data-platform="YouTube" onclick="window.filterCompetitorFeed('YouTube')">▶️ YouTube (${ytPosts.length})</button>
        <button type="button" class="btn ${window.selectedCompPlat === 'Instagram' ? 'btn-primary' : 'btn-secondary'} comp-feed-filter-btn" data-platform="Instagram" onclick="window.filterCompetitorFeed('Instagram')">📸 Instagram (${igPosts.length})</button>
        <button type="button" class="btn ${window.selectedCompPlat === 'Facebook' ? 'btn-primary' : 'btn-secondary'} comp-feed-filter-btn" data-platform="Facebook" onclick="window.filterCompetitorFeed('Facebook')">📘 Facebook (${fbPosts.length})</button>
        <button type="button" class="btn ${window.selectedCompPlat === 'LinkedIn' ? 'btn-primary' : 'btn-secondary'} comp-feed-filter-btn" data-platform="LinkedIn" onclick="window.filterCompetitorFeed('LinkedIn')">💼 LinkedIn (${liPosts.length})</button>
      </div>
    `;

    let emptyTopBannerHtml = (feed.length === 0) ? `
      <div style="padding: 16px 20px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 12px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="font-weight: 700; font-size: 0.95rem; color: #fff; margin-bottom: 2px;">⚡ Ready to Track Competitors Across All Platforms</div>
          <div style="font-size: 0.82rem; color: var(--text-muted);">No competitor posts have been fetched yet for this project. Start the crawler to scan YouTube, Instagram, Facebook, and LinkedIn.</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.runCompetitorTrackerNow()" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; padding: 7px 16px;">
          <span>⚡ Run Competitor Tracker Now</span>
        </button>
      </div>` : '';

    let html = `
      <style>
        .social-section-header { display: flex; align-items: center; gap: 8px; font-size: 1rem; font-weight: 700; color: #ffffff; margin: 10px 0 6px 0; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 4px; }
        .social-section-icon { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
        .social-horizontal-row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.2) transparent; }
        .social-horizontal-row::-webkit-scrollbar { height: 5px; }
        .social-horizontal-row::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
      </style>
      <div style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
        ${filterBarHtml}
        ${emptyTopBannerHtml}
    `;

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

      let displayContent = (post.caption || post.content || '').trim();
      const isBoilerplate = !displayContent ||
        displayContent === 'No caption' || displayContent === 'No caption.' ||
        displayContent.includes('Welcome back to Instagram') ||
        displayContent.includes('Sign in to check out') ||
        displayContent.includes('Log in to see photos') ||
        displayContent.includes('No photo description available') ||
        displayContent.includes('Commenting has been turned off') ||
        displayContent.includes('May be an image of') ||
        displayContent.includes('See posts, photos and more on Facebook') ||
        displayContent.includes('Log into Facebook') ||
        displayContent.includes('See more posts') ||
        displayContent.includes('merriam-webster') ||
        displayContent.includes('dictionary.com') ||
        displayContent.toLowerCase() === 'instagram' ||
        displayContent.toLowerCase() === 'facebook';

      const pLink = post.post_url || post.link || '';
      const isIgReelCard = (platform === 'Instagram' || post._detectedPlatform === 'Instagram') &&
                           (pLink.includes('/reel/') || post.media_type === 'Video' || post.mediaType === 'Video');
      const isInstagramCard = (platform === 'Instagram' || post._detectedPlatform === 'Instagram');
      const isLiVidCard = (platform === 'LinkedIn' || post._detectedPlatform === 'LinkedIn') &&
                          (Boolean(post.video_url) || post.media_type === 'Video' || post.mediaType === 'Video');
      const isFacebookVideoCard = (platform === 'Facebook' || post._detectedPlatform === 'Facebook') &&
                                  (Boolean(post.video_url) || Boolean(post.fb_video_id) || post.media_type === 'Video' || post.mediaType === 'Video' || /\/(?:videos|reel|watch)\b/i.test(pLink));

      if (isBoilerplate) {
        let slugTitle = "";
        const slugMatch = pLink.match(/\/(?:videos|posts|reel)\/([a-zA-Z0-9_-]{10,})/i);
        if (slugMatch && slugMatch[1] && !/^\d+$/.test(slugMatch[1])) {
          slugTitle = slugMatch[1].replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (slugTitle.length > 5) {
            slugTitle = slugTitle.charAt(0).toUpperCase() + slugTitle.slice(1);
          }
        }
        displayContent = slugTitle || (platform === 'Facebook' ? `${compName} - Facebook Update` : (platform === 'Instagram' ? `${compName} - Instagram ${isIgReelCard ? 'Reel' : 'Post'}` : `${compName} - ${platform}`));
      }

      let cardThumbHtml = '';
      const ytVidId = post._ytVidId || post._ytId || window.getYouTubeId(pLink) || window.getYouTubeId(post.thumbnail_url || post.mediaUrl || '') || window.getYouTubeId(post.caption || post.content || '');
      let firstMediaUrl = post._mediaResolved || window.extractSingleMediaUrl(post);

      if (!firstMediaUrl && isFacebookVideoCard && pLink) {
        firstMediaUrl = pLink;
      }

      const rawIgSc = post.shortcode || (pLink.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i) || [])[1];
      const isIgBundle = rawIgSc && (rawIgSc.toLowerCase().startsWith('yv5pcb') || rawIgSc.toLowerCase().startsWith('qtfxdj') || rawIgSc.toLowerCase().startsWith('kj4gsf') || rawIgSc.toLowerCase().startsWith('rpztim'));
      const validIgSc = isIgBundle ? '' : rawIgSc;

      const escapedSnippet = window.escapeHtml(displayContent).replace(/'/g, "\\'");
      const snippetFallbackHtml = `<div style=\\'width:100%;height:100%;background:${meta.bg};border-radius:8px;padding:10px 12px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;\\'><div style=\\'display:flex;align-items:center;gap:6px;\\'><span style=\\'font-size:14px;\\'>${meta.icon}</span><span style=\\'font-size:10px;font-weight:700;color:#fff;text-transform:uppercase;\\'>${platform}</span></div><div style=\\'font-size:10.5px;line-height:1.35;color:rgba(255,255,255,0.9);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;\\'>&ldquo;${escapedSnippet}&rdquo;</div><span style=\\'font-size:9.5px;font-weight:600;color:#93c5fd;\\'>View on ${platform} ↗</span></div>`;

      if (ytVidId) {
        const ytThumb = `https://img.youtube.com/vi/${ytVidId}/hqdefault.jpg`;
        cardThumbHtml = `
          <div style="margin: 0 0 6px 0; width: 100%; height: 115px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: #080d1a; flex-shrink: 0; position: relative; padding: 0;">
            <img src="${ytThumb}" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; border-radius: 8px;" onerror="this.onerror=null; this.parentElement.innerHTML = '${snippetFallbackHtml}';" />
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:34px;height:34px;background:rgba(255,0,0,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:15px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.6);">▶</div>
          </div>`;
      } else if (firstMediaUrl) {
        let proxiedThumb = window.getSocialMediaProxyUrl(firstMediaUrl, pLink);
        let badgeText = isIgReelCard ? '📹 REEL' : ((isLiVidCard || isFacebookVideoCard) ? '📹 VIDEO' : '');
        let playBtn = (isIgReelCard || isLiVidCard || isFacebookVideoCard) ? `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:34px;height:34px;background:rgba(0,0,0,0.6);border:2px solid rgba(255,255,255,0.8);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:14px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.6);">▶</div>` : '';
        let badgeHtml = badgeText ? `<div style="position:absolute; top:6px; right:6px; background:${meta.badgeBg}; color:white; font-size:8.5px; font-weight:800; padding:2px 5px; border-radius:4px; text-transform:uppercase; letter-spacing:0.05em; box-shadow:0 2px 6px rgba(0,0,0,0.5); pointer-events:none;">${badgeText}</div>` : '';

        const fitStyle = isInstagramCard ? 'object-fit: contain !important; background: #080d1a !important;' : 'object-fit: cover;';
        const imgClass = isInstagramCard ? 'feed-card-thumb-contain' : '';

        let onErrAction = '';
        if (isInstagramCard && validIgSc) {
          onErrAction = `this.parentElement.innerHTML = '<iframe src=\\'https://www.instagram.com/${isIgReelCard ? 'reel' : 'p'}/${validIgSc}/embed/\\' style=\\'width:100%;height:100%;border:0;background:#080d1a;border-radius:8px;pointer-events:none;\\' frameborder=\\'0\\' scrolling=\\'no\\'></iframe>';`;
        } else if (isFacebookVideoCard && pLink) {
          onErrAction = `this.parentElement.innerHTML = '<iframe src=\\'https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(pLink)}&show_text=false&width=280\\' style=\\'width:100%;height:100%;border:0;pointer-events:none;background:#000;border-radius:8px;\\' frameborder=\\'0\\' scrolling=\\'no\\'></iframe><div style=\\'position:absolute;top:6px;right:6px;background:#1877f2;color:white;font-size:8.5px;font-weight:800;padding:2px 5px;border-radius:4px;pointer-events:none;\\'>📹 VIDEO</div>';`;
        } else {
          onErrAction = `this.parentElement.innerHTML = '${snippetFallbackHtml}';`;
        }

        cardThumbHtml = `
          <div style="margin: 0 0 6px 0; width: 100%; height: 115px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: #080d1a; flex-shrink: 0; position: relative; padding: 0;">
            <img src="${proxiedThumb}" class="${imgClass}" referrerpolicy="no-referrer" loading="lazy" style="width: 100%; height: 100%; ${fitStyle} object-position: center; display: block; border-radius: 8px;" onerror="this.onerror=null; ${onErrAction}" />
            ${badgeHtml}
            ${playBtn}
          </div>`;
      } else if (isInstagramCard && validIgSc) {
        cardThumbHtml = `
          <div style="margin: 0 0 6px 0; width: 100%; height: 115px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: #080d1a; flex-shrink: 0; position: relative; padding: 0;">
            <iframe src="https://www.instagram.com/${isIgReelCard ? 'reel' : 'p'}/${validIgSc}/embed/" style="width: 100%; height: 100%; border: 0; pointer-events: none; border-radius: 8px; background: #080d1a;" frameborder="0" scrolling="no"></iframe>
            <div style="position:absolute; top:6px; right:6px; background:#e1306c; color:white; font-size:8.5px; font-weight:800; padding:2px 5px; border-radius:4px; text-transform:uppercase; pointer-events:none;">📸 INSTAGRAM</div>
          </div>`;
      } else if (isFacebookVideoCard && pLink) {
        cardThumbHtml = `
          <div style="margin: 0 0 6px 0; width: 100%; height: 115px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: #080d1a; flex-shrink: 0; position: relative; padding: 0;">
            <iframe src="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(pLink)}&show_text=false&width=280" style="width: 100%; height: 100%; border: 0; pointer-events: none; background: #000; border-radius: 8px;" frameborder="0" scrolling="no"></iframe>
            <div style="position:absolute; top:6px; right:6px; background:#1877f2; color:white; font-size:8.5px; font-weight:800; padding:2px 5px; border-radius:4px; text-transform:uppercase; pointer-events:none;">📹 VIDEO</div>
          </div>`;
      }

      if (!cardThumbHtml) {
        cardThumbHtml = `
          <div style="margin: 0 0 6px 0; width: 100%; height: 115px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: ${meta.bg}; flex-shrink: 0; position: relative; padding: 10px 12px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 14px;">${meta.icon}</span>
              <span style="font-size: 10px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.05em;">${platform}</span>
            </div>
            <div style="font-size: 10.5px; line-height: 1.35; color: rgba(255,255,255,0.9); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">
              &ldquo;${window.escapeHtml(displayContent)}&rdquo;
            </div>
            <span style="font-size: 9.5px; font-weight: 600; color: #93c5fd;">View on ${platform} ↗</span>
          </div>`;
      }

      return `
        <div class="feed-card-item" data-platform="${platform}" onclick="window.openFeedItemModal(${post._globalIndex})" style="min-width: 206px; max-width: 216px; width: 210px; flex-shrink: 0; padding: 8px 9px; border-radius: 12px; border: 1px solid var(--border); display: flex; flex-direction: column; height: 295px; box-shadow: var(--shadow-sm); cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease;" onmouseover="this.style.transform='translateY(-3px)'; this.style.borderColor='var(--primary)'" onmouseout="this.style.transform='none'; this.style.borderColor='var(--border)'">
          <div style="margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; gap: 4px;">
            <span style="font-size: 0.75rem; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 105px;">${window.escapeHtml(compName)}</span>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 0.66rem; color: var(--text-muted);">${window.escapeHtml(dateStr)}</span>
              <span style="font-size: 0.56rem; font-weight: 800; padding: 1px 4px; border-radius: 3px; background: ${meta.badgeBg}; color: #ffffff; text-transform: uppercase;">${platform}</span>
            </div>
          </div>
          ${cardThumbHtml}
          <div style="white-space: pre-wrap; font-size: 0.74rem; line-height: 1.3; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 4px; flex: 1;">${window.escapeHtml(displayContent)}</div>
          <span style="display: block; text-align: left; font-size: 9.5px; font-weight: 600; color: #3b82f6; margin-top: auto; padding-top: 2px;">Preview Post In Dashboard ↗</span>
        </div>
      `;
    };

    // Render all 4 distinct platform sections (YouTube, Instagram, Facebook, LinkedIn)
    const sectionsConfig = [
      { name: 'YouTube', icon: '▶️', iconBg: 'rgba(255, 0, 0, 0.15)', iconColor: '#ff0000', posts: ytPosts },
      { name: 'Instagram', icon: '📸', iconBg: 'rgba(225, 48, 108, 0.15)', iconColor: '#e1306c', posts: igPosts },
      { name: 'Facebook', icon: '📘', iconBg: 'rgba(24, 119, 242, 0.15)', iconColor: '#1877f2', posts: fbPosts },
      { name: 'LinkedIn', icon: '💼', iconBg: 'rgba(10, 102, 194, 0.15)', iconColor: '#0a66c2', posts: liPosts }
    ];

    sectionsConfig.forEach(sec => {
      const isVisible = (window.selectedCompPlat === 'All' || window.selectedCompPlat === sec.name);
      html += `
        <div class="comp-feed-platform-section" data-platform="${sec.name}" style="display: ${isVisible ? 'block' : 'none'}; margin-bottom: 14px;">
          <div class="social-section-header">
            <div class="social-section-icon" style="background: ${sec.iconBg}; color: ${sec.iconColor};">${sec.icon}</div>
            <span>${sec.name}</span>
            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500; margin-left: 6px;">(${sec.posts.length} posts)</span>
          </div>
          ${sec.posts.length > 0 ? `
            <div class="social-horizontal-row">
              ${sec.posts.map(renderCard).join('')}
            </div>
          ` : `
            <div style="padding: 14px 18px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.12); border-radius: 10px; color: var(--text-muted); font-size: 0.82rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
              <span>No recent ${sec.name} posts currently crawled for tracked competitors.</span>
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.runCompetitorTrackerNow()" style="padding: 4px 12px; font-size: 11px; font-weight: 600;">Sync ${sec.name} Posts Now</button>
            </div>
          `}
        </div>
      `;
    });

    html += '</div>';
    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Failed to load social feed.</div>';
  }
}

window.currentSocialFeedSubView = 'competitors';

window.switchSocialFeedView = function(view) {
  window.currentSocialFeedSubView = view;
  const tabComp = document.getElementById('feed-tab-competitors');
  const tabOwn = document.getElementById('feed-tab-own');
  const viewComp = document.getElementById('view-competitors-feed');
  const viewOwn = document.getElementById('view-own-feed');
  const actComp = document.getElementById('feed-actions-competitors');
  const actOwn = document.getElementById('feed-actions-own');

  if (view === 'competitors') {
    if (tabComp) { tabComp.className = 'btn btn-primary'; }
    if (tabOwn) { tabOwn.className = 'btn btn-secondary'; }
    if (viewComp) viewComp.style.display = 'block';
    if (viewOwn) viewOwn.style.display = 'none';
    if (actComp) actComp.style.display = 'block';
    if (actOwn) actOwn.style.display = 'none';
    loadFeedUI();
  } else {
    if (tabComp) { tabComp.className = 'btn btn-secondary'; }
    if (tabOwn) { tabOwn.className = 'btn btn-primary'; }
    if (viewComp) viewComp.style.display = 'none';
    if (viewOwn) viewOwn.style.display = 'block';
    if (actComp) actComp.style.display = 'none';
    if (actOwn) actOwn.style.display = 'block';
    loadOwnFeedUI();
  }
};

window.refreshOwnSocials = async function() {
  if (!window.activeProjectUrl) {
    window.showError && window.showError("Please select a project first.");
    return;
  }
  const btn = document.getElementById('btn-refresh-own-socials');
  const originalText = btn ? btn.innerHTML : '🔄 Re-scan Company Socials';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span> Scanning official accounts...';
  }

  try {
    const res = await fetch('/api/refresh-own-socials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: window.activeProjectUrl })
    });
    const data = await window.safeParseResponse(res);

    if (window.projectMemory) {
      window.projectMemory.ownSocials = data.socials;
      window.projectMemory.ownSocialFeed = data.feed;
      window.projectMemory.brandVoicePattern = data.pattern;
    }

    window.showSuccess && window.showSuccess("✅ Successfully crawled company accounts and updated brand voice pattern!");
    await loadOwnFeedUI();
    if (window.updateSmmAntiRepetitionBadge) window.updateSmmAntiRepetitionBadge();
  } catch (err) {
    window.showError && window.showError(`Failed to refresh socials: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
};

async function loadOwnFeedUI() {
  if (!window.activeProjectUrl) return;
  const patternBox = document.getElementById('brand-voice-pattern-container');
  const feedList = document.getElementById('own-feed-list');
  if (!feedList) return;

  feedList.innerHTML = '<div class="spinner"></div><p style="text-align:center;color:var(--text-muted);margin-top:12px;">Loading official company feed & voice patterns...</p>';

  try {
    const res = await fetch(`/api/own-social-feed?url=${encodeURIComponent(window.activeProjectUrl)}`);
    const data = await window.safeParseResponse(res);

    const pattern = data.pattern;
    const feed = data.feed || [];

    // Render Brand Voice Pattern Card
    if (patternBox && pattern) {
      const hashtagsHtml = (pattern.signatureHashtags || []).map(h => `<span style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;">${window.escapeHtml(h)}</span>`).join(' ') || '<span style="color:var(--text-muted);font-size:12px;">None specified</span>';
      
      const ctasHtml = (pattern.preferredCTAs || []).map(c => `<span style="background: rgba(34, 197, 94, 0.12); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.25); padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 500;">${window.escapeHtml(c)}</span>`).join(' ') || '<span style="color:var(--text-muted);font-size:12px;">Standard B2B CTAs</span>';
      
      const themesHtml = (pattern.frequentThemes || []).map(t => `<span style="background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.25); padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 500;">${window.escapeHtml(t)}</span>`).join(' ') || '<span style="color:var(--text-muted);font-size:12px;">General capabilities</span>';

      const recentTopics = pattern.recentPostTopics || [];
      const topicsHtml = recentTopics.length > 0 
        ? recentTopics.map(t => `<div style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-color); margin-bottom:4px;"><span style="color:#22c55e;">🚫</span> <span>${window.escapeHtml(t)}</span></div>`).join('')
        : '<div style="font-size:12px; color:var(--text-muted);">No past topics indexed yet. Run "Re-scan Company Socials" to crawl historical topics.</div>';

      patternBox.innerHTML = `
        <div style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.95)); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 16px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.3);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px; flex-wrap:wrap; gap:10px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:22px;">🎙️</span>
              <div>
                <h3 style="margin:0; font-size:1.15rem; font-weight:700;">Company Social DNA & Brand Voice Pattern</h3>
                <span style="font-size:12px; color:var(--text-muted);">Analyzed across official social accounts • SMM engine automatically mirrors this voice</span>
              </div>
            </div>
            <span style="background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700;">
              🛡️ Anti-Repetition Shield: Active (${recentTopics.length} Topics Excluded)
            </span>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 20px;">
            <div style="background: rgba(0,0,0,0.25); padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 700; margin-bottom: 6px;">Tone & Cadence</div>
              <div style="font-size: 13px; font-weight: 600; color: #e2e8f0; line-height: 1.4;">${window.escapeHtml(pattern.tone || 'Authoritative B2B')}</div>
              <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">${window.escapeHtml(pattern.captionStyle || '')}</div>
            </div>

            <div style="background: rgba(0,0,0,0.25); padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 700; margin-bottom: 8px;">Signature Hashtags</div>
              <div style="display:flex; flex-wrap:wrap; gap:6px;">${hashtagsHtml}</div>
            </div>

            <div style="background: rgba(0,0,0,0.25); padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 700; margin-bottom: 8px;">Preferred CTAs</div>
              <div style="display:flex; flex-wrap:wrap; gap:6px;">${ctasHtml}</div>
            </div>
          </div>

          <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 12px; border: 1px solid rgba(34, 197, 94, 0.2);">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #4ade80; font-weight: 700; margin-bottom: 8px; display:flex; align-items:center; gap:6px;">
              <span>🛡️</span> Excluded Recent Post Topics (Anti-Repetition List)
            </div>
            <p style="font-size: 12px; color: var(--text-muted); margin: 0 0 10px 0;">The SMM generator is strictly instructed NEVER to repeat these exact topics or hooks:</p>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 4px;">
              ${topicsHtml}
            </div>
          </div>
        </div>
      `;
    }

    // Render Posts
    if (feed.length === 0) {
      feedList.innerHTML = `
        <div class="empty-state" style="padding: 40px; text-align: center;">
          <div style="font-size: 32px; margin-bottom: 12px;">🏢</div>
          <h3 style="margin: 0 0 8px 0;">No official posts crawled yet</h3>
          <p style="color: var(--text-muted); font-size: 13px; max-width: 480px; margin: 0 auto 20px auto;">
            Click the button below or make sure your company's social URLs are entered under <strong>Project Details</strong>.
          </p>
          <button class="btn btn-primary" onclick="window.refreshOwnSocials()" style="font-weight: 600;">🔄 Re-scan Company Socials Now</button>
        </div>
      `;
      return;
    }

    const platformMeta = {
      'YouTube': { icon: '▶️', color: '#ff0000', badgeBg: '#cc0000' },
      'Facebook': { icon: '📘', color: '#1877f2', badgeBg: '#1877f2' },
      'Instagram': { icon: '📸', color: '#e1306c', badgeBg: '#d62976' },
      'LinkedIn': { icon: '💼', color: '#0a66c2', badgeBg: '#0a66c2' }
    };

    window.allOwnFeedPosts = feed;

    const platCounts = { All: feed.length };
    feed.forEach(p => {
      const plat = p.platform || 'Social';
      platCounts[plat] = (platCounts[plat] || 0) + 1;
    });

    window.filterOwnFeed = function(selectedPlat) {
      window.selectedOwnPlat = selectedPlat;
      const btns = document.querySelectorAll('.own-feed-filter-btn');
      btns.forEach(b => {
        if (b.getAttribute('data-platform') === selectedPlat) {
          b.className = 'btn btn-primary own-feed-filter-btn';
        } else {
          b.className = 'btn btn-secondary own-feed-filter-btn';
        }
      });
      const cards = document.querySelectorAll('.own-feed-card-item');
      cards.forEach(c => {
        const p = c.getAttribute('data-platform');
        c.style.display = (selectedPlat === 'All' || p === selectedPlat) ? 'flex' : 'none';
      });
    };

    const orderedPlats = ['LinkedIn', 'Instagram', 'Facebook', 'YouTube'];
    let filterBarHtml = `
      <div style="display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; align-items: center;">
        <button class="btn btn-primary own-feed-filter-btn" data-platform="All" onclick="window.filterOwnFeed('All')" style="padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 8px;">
          🌐 All Platforms (${feed.length})
        </button>
    `;

    orderedPlats.forEach(pKey => {
      const cnt = platCounts[pKey] || 0;
      const pMeta = platformMeta[pKey] || { icon: '🌐' };
      filterBarHtml += `
        <button class="btn btn-secondary own-feed-filter-btn" data-platform="${pKey}" onclick="window.filterOwnFeed('${pKey}')" style="padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 8px;">
          ${pMeta.icon} ${pKey} (${cnt})
        </button>
      `;
    });
    filterBarHtml += '</div>';

    let postHtml = filterBarHtml + '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 12px;">';
    
    feed.forEach((post, idx) => {
      const plat = post.platform || 'Social';
      const meta = platformMeta[plat] || platformMeta['LinkedIn'];
      const rawText = (post.caption || post.content || '').trim();
      const displayDate = post.date || post.published_date || post.timestamp || 'Recent';
      const postLink = post.post_url || post.link || post.postUrl || '#';
      const thumb = post.thumbnail || post.thumbnail_url || post.media_url || '';

      const mediaPreview = thumb
        ? `<div style="height: 125px; background: #0b1120; position: relative; overflow: hidden; border-radius: 8px 8px 0 0;">
             <img src="${window.getSocialMediaProxyUrl ? window.getSocialMediaProxyUrl(thumb) : thumb}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.style.display='none';" />
             <span style="position: absolute; top: 6px; left: 6px; background: ${meta.badgeBg}; color: white; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${meta.icon} ${plat}</span>
           </div>`
        : `<div style="height: 42px; background: rgba(0,0,0,0.2); padding: 6px 10px; display: flex; align-items: center; border-radius: 8px 8px 0 0;">
             <span style="background: ${meta.badgeBg}; color: white; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${meta.icon} ${plat}</span>
           </div>`;

      postHtml += `
        <div class="own-feed-card-item" data-platform="${plat}" onclick="window.openFeedItemModal(${idx}, 'default', window.allOwnFeedPosts)" style="background: var(--surface); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 4px 12px rgba(0,0,0,0.15); cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease;" onmouseover="this.style.transform='translateY(-3px)'; this.style.borderColor='var(--primary)'" onmouseout="this.style.transform='none'; this.style.borderColor='rgba(255,255,255,0.08)'">
          ${mediaPreview}
          <div style="padding: 10px; flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 4px;">${window.escapeHtml(displayDate)}</div>
              <div style="font-size: 12px; color: var(--text-color); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
                ${window.escapeHtml(rawText || 'No caption text')}
              </div>
            </div>
            ${postLink && postLink !== '#' ? `
              <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);">
                <a href="${postLink}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: #60a5fa; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                  View on ${plat} ↗
                </a>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    });

    postHtml += '</div>';
    feedList.innerHTML = postHtml;
  } catch (err) {
    feedList.innerHTML = `<div class="empty-state" style="color:#ef4444;">Failed to load company feed: ${err.message}</div>`;
  }
}

window.updateSmmAntiRepetitionBadge = function() {
  const mem = window.projectMemory;
  const banner = document.getElementById('smm-anti-repetition-banner');
  if (!banner) return;

  const topicsCount = mem?.brandVoicePattern?.recentPostTopics?.length || 0;
  if (topicsCount > 0) {
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">🛡️</span>
        <span><strong>Anti-Repetition Shield: Active</strong> — ${topicsCount} historical company post topics excluded from generation to guarantee 100% original content.</span>
      </div>
      <span id="smm-voice-badge" style="background: rgba(34, 197, 94, 0.15); padding: 3px 10px; border-radius: 12px; font-weight: 600; font-size: 11px;">🎙️ Brand Voice Aligned</span>
    `;
  }
};
