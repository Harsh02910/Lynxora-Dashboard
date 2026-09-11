// ══════════════════════════════════════════════════
//  Lynxora - Advanced P&L Dashboard Application
// ══════════════════════════════════════════════════

// ── Categories & Sources ──
const INCOME_CATEGORIES = [
  'Opening Capital / Owner Capital', 'Amazon', 'Flipkart', 'Sales Revenue', 'Service Income',
  'Interest Income', 'Investment Returns', 'Loan Received', 'Other Income'
];
const EXPENSE_CATEGORIES = [
  'Product Purchase / Inventory', 'Stock Loss / Damaged Goods', 'Vendor / Supplier Payment',
  'Loan Payment', 'Upad / Personal Drawings (Owner Withdrawal)', 'Staff Upad / Advance',
  'Packaging & Shipping', 'Salaries & Wages', 'Rent & Lease',
  'Utilities', 'Marketing', 'Office Supplies', 'Insurance',
  'Professional Services', 'Depreciation', 'Other Expense'
];
const ASSET_CATEGORIES = [
  'Land & Building', 'Machinery & Equipment', 'Vehicles',
  'Furniture & Fixtures', 'Computers & Electronics', 'Other Asset'
];
const TRANSFER_CATEGORIES = [
  'Bank Withdrawal (Cash from Bank)',
  'Bank Deposit (Cash to Bank)'
];

// ── Global State ──
let records = [];
let editingId = null;
let currentPage = 1;
const RECORDS_PER_PAGE = 10;
let searchQuery = '';
let typeFilter = 'All';
let categoryFilter = 'All';
let paymentFilter = 'All';
let chartInstances = {};
let activePage = 'dashboard';
let currentDrilldownType = null;

// Cloud Sync globals
let firestoreDb = null;
let cloudUnsubscribe = null;
let isSyncingFromCloud = false;
let cloudHeartbeatTimer = null;
let lastKnownCloudUpdate = null;
let lastSuccessfulSyncTime = null;
let isSyncPushInProgress = false;
let hasInitialSyncCompleted = false;

// Inventory globals
let inventoryCategories = [];
let knownSuppliers = [];
let knownProductNames = [];
let inventoryItems = [];
let invSearchQuery = '';
let invCategoryFilter = 'All';
let invStatusFilter = 'All';
let invCurrentPage = 1;
const INV_PER_PAGE = 10;
// Dashboard Time Filter State
let timeFilterMode = 'all';
let filterYear = '2026';
let filterMonth = '';
let filterDateFrom = '';
let filterDateTo = '';

// Dedicated Line Graph Filter State
let lineGraphFilterRange = 'all';
let lineGraphDateFrom = '';
let lineGraphDateTo = '';

// ══════════════════════════════════════════════════
//  AUTHENTICATION & USER ROLES MODULE
// ══════════════════════════════════════════════════
const DEFAULT_USERS = [
  { id: 'usr_owner', username: 'harsh', name: 'Harsh', role: 'owner', password: 'admin123' },
  { id: 'usr_partner', username: 'partner', name: 'Business Partner', role: 'partner', password: 'partner123' },
  { id: 'usr_staff', username: 'staff', name: 'Accountant Staff', role: 'staff', password: 'staff123' },
  { id: 'usr_viewer', username: 'viewer', name: 'Auditor / Viewer', role: 'viewer', password: 'viewer123' }
];

let currentUser = null;
let companyUsers = [];

function loadCompanyUsers() {
  const saved = localStorage.getItem('lynxora_users');
  if (saved) {
    try {
      companyUsers = JSON.parse(saved);
    } catch {
      companyUsers = [...DEFAULT_USERS];
    }
  } else {
    companyUsers = [...DEFAULT_USERS];
    localStorage.setItem('lynxora_users', JSON.stringify(companyUsers));
  }
}

function saveCompanyUsers() {
  localStorage.setItem('lynxora_users', JSON.stringify(companyUsers));
  if (typeof broadcastToCloud === 'function') {
    broadcastToCloud('users', 'Updated company users & permissions');
  }
}

function initAuth() {
  loadCompanyUsers();

  // 1. Check URL parameters for room
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    localStorage.setItem('lynxora_sync_room', roomParam.trim());
  }

  // 2. Check existing active session
  // Tab/window session in sessionStorage takes priority.
  // localStorage is checked ONLY IF explicitly saved with "remembered: true".
  let sessionData = sessionStorage.getItem('lynxora_auth_session');
  if (!sessionData) {
    const localSession = localStorage.getItem('lynxora_auth_session');
    if (localSession) {
      try {
        const parsedLocal = JSON.parse(localSession);
        if (parsedLocal && parsedLocal.remembered === true) {
          sessionData = localSession;
        } else {
          // Remove old/legacy auto-saved sessions that were not explicitly remembered
          localStorage.removeItem('lynxora_auth_session');
        }
      } catch {
        localStorage.removeItem('lynxora_auth_session');
      }
    }
  }

  if (sessionData) {
    try {
      const parsed = JSON.parse(sessionData);
      const matched = companyUsers.find(u => u.username.toLowerCase() === (parsed.username || '').toLowerCase()) 
                    || DEFAULT_USERS.find(u => u.username.toLowerCase() === (parsed.username || '').toLowerCase());
      if (matched) {
        currentUser = matched;
        hideLoginScreen();
        applyUserRolePermissions();
        return;
      }
    } catch {}
  }

  // 3. No active session -> Keep user logged out and show login screen!
  currentUser = null;
  showLoginScreen();

  // If role is provided in URL (e.g. employee invite link: ?role=staff), pre-select staff chip
  const roleParam = urlParams.get('role');
  if (roleParam) {
    quickFillLogin(roleParam.toLowerCase());
  }
}

function showLoginScreen() {
  const overlay = document.getElementById('loginScreenOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
  }
}

function hideLoginScreen() {
  const overlay = document.getElementById('loginScreenOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  }
}

function toggleLoginPasswordVisibility() {
  const pwd = document.getElementById('loginPassword');
  const btn = document.getElementById('togglePwdBtn');
  if (!pwd) return;
  if (pwd.type === 'password') {
    pwd.type = 'text';
    if (btn) btn.textContent = 'Hide';
  } else {
    pwd.type = 'password';
    if (btn) btn.textContent = 'Show';
  }
}

function quickFillLogin(role) {
  document.querySelectorAll('.login-role-chip').forEach(c => c.classList.remove('active'));
  const chip = document.getElementById(`chipRole${role.charAt(0).toUpperCase() + role.slice(1)}`);
  if (chip) chip.classList.add('active');

  const uInput = document.getElementById('loginUsername');
  const pInput = document.getElementById('loginPassword');

  const user = companyUsers.find(u => u.role === role) || DEFAULT_USERS.find(u => u.role === role);
  if (user) {
    if (uInput) uInput.value = user.username;
    if (pInput) pInput.value = user.password;
  }
}

function doSuccessfulLogin(matched, remember) {
  const errorEl = document.getElementById('loginErrorMsg');
  currentUser = matched;
  if (errorEl) errorEl.style.display = 'none';

  const sessionData = JSON.stringify({ 
    username: matched.username, 
    role: matched.role, 
    name: matched.name,
    remembered: !!remember 
  });

  if (remember) {
    localStorage.setItem('lynxora_auth_session', sessionData);
    sessionStorage.setItem('lynxora_auth_session', sessionData);
  } else {
    sessionStorage.setItem('lynxora_auth_session', sessionData);
    localStorage.removeItem('lynxora_auth_session');
  }

  hideLoginScreen();
  applyUserRolePermissions();
  showToast(`Welcome back, ${matched.name}! (${getRoleEmoji(matched.role)})`, 'success');
  navigateTo('dashboard');

  // Trigger instant cloud sync to pull all live records, inventory & transactions immediately
  if (typeof manualSyncNow === 'function') {
    setTimeout(() => manualSyncNow(), 50);
  } else if (typeof initCloudSync === 'function') {
    initCloudSync();
  }
}

function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  const uInput = document.getElementById('loginUsername');
  const pInput = document.getElementById('loginPassword');
  const remember = document.getElementById('rememberMeCheck')?.checked;
  const errorEl = document.getElementById('loginErrorMsg');

  const username = (uInput ? uInput.value : '').trim().toLowerCase();
  const password = pInput ? pInput.value : '';

  if (!username || !password) {
    if (errorEl) {
      errorEl.innerHTML = '⚠️ Please enter both your Username and Password.';
      errorEl.style.display = 'block';
    }
    return;
  }

  // 1. Check local company users list, then default accounts
  let matched = companyUsers.find(u => u.username.toLowerCase() === username && u.password === password);
  if (!matched) {
    const fallback = DEFAULT_USERS.find(u => u.username.toLowerCase() === username && u.password === password);
    if (fallback) matched = fallback;
  }

  if (matched) {
    doSuccessfulLogin(matched, remember);
    return;
  }

  // 2. If not found locally, query Cloud Firestore to check if this user was created on another device
  if (firestoreDb || typeof firebase !== 'undefined') {
    if (errorEl) {
      errorEl.innerHTML = 'Verifying credentials with Cloud Sync...';
      errorEl.style.display = 'block';
    }
    const roomId = getActiveSyncRoomId();
    const db = firestoreDb || (firebase && firebase.apps.length ? firebase.firestore() : null);
    if (db) {
      db.collection('lynxora_rooms').doc(roomId).get({ source: 'server' })
        .then(doc => {
          if (doc.exists) {
            applyCloudData(doc.data(), 'login');
            let remoteMatched = companyUsers.find(u => u.username.toLowerCase() === username && u.password === password);
            if (!remoteMatched) {
              const fallback = DEFAULT_USERS.find(u => u.username.toLowerCase() === username && u.password === password);
              if (fallback) remoteMatched = fallback;
            }
            if (remoteMatched) {
              doSuccessfulLogin(remoteMatched, remember);
              return;
            }
          }
          if (errorEl) {
            errorEl.innerHTML = '❌ Invalid username or password. Please verify your credentials and try again.';
            errorEl.style.display = 'block';
          }
        })
        .catch(() => {
          if (errorEl) {
            errorEl.innerHTML = '❌ Invalid username or password. Please verify your credentials and try again.';
            errorEl.style.display = 'block';
          }
        });
      return;
    }
  }

  if (errorEl) {
    errorEl.innerHTML = '❌ Invalid username or password. Please verify your credentials and try again.';
    errorEl.style.display = 'block';
  }
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem('lynxora_auth_session');
  sessionStorage.removeItem('lynxora_auth_session');

  const uInput = document.getElementById('loginUsername');
  const pInput = document.getElementById('loginPassword');
  const errorEl = document.getElementById('loginErrorMsg');
  const remember = document.getElementById('rememberMeCheck');
  if (uInput) uInput.value = '';
  if (pInput) pInput.value = '';
  if (remember) remember.checked = false;
  if (errorEl) errorEl.style.display = 'none';
  document.querySelectorAll('.login-role-chip').forEach(c => c.classList.remove('active'));

  showLoginScreen();
  showToast('Logged out securely.', 'info');
}

function getRoleEmoji(role) {
  switch (role) {
    case 'owner': return 'Owner';
    case 'partner': return 'Partner';
    case 'staff': return 'Staff';
    case 'viewer': return 'Viewer';
    default: return 'User';
  }
}

function applyUserRolePermissions() {
  if (!currentUser) return;

  // Sidebar profile
  const nameEl = document.getElementById('sidebarUserName');
  const roleEl = document.getElementById('sidebarRoleLabel');
  const avatarEl = document.getElementById('sidebarAvatar');

  if (nameEl) nameEl.innerText = currentUser.name;
  if (roleEl) roleEl.innerText = getRoleEmoji(currentUser.role);
  if (avatarEl) avatarEl.innerText = (currentUser.name || 'U').charAt(0).toUpperCase();

  // Role permissions
  const isOwner = currentUser.role === 'owner';
  const isViewer = currentUser.role === 'viewer';

  const userMgmtCard = document.getElementById('userManagementCard');
  if (userMgmtCard) {
    userMgmtCard.style.display = isOwner ? 'block' : 'none';
  }

  const clearAllBtn = document.getElementById('clearAllDataBtn');
  if (clearAllBtn) {
    clearAllBtn.style.display = isOwner ? 'inline-flex' : 'none';
  }

  const recordsClearAllBtn = document.getElementById('recordsClearAllBtn');
  if (recordsClearAllBtn) {
    recordsClearAllBtn.style.display = isOwner ? 'inline-flex' : 'none';
  }

  const addRecordBtn = document.getElementById('addRecordBtn');
  if (addRecordBtn) {
    addRecordBtn.style.display = isViewer ? 'none' : 'inline-flex';
  }

  renderUserAccounts();
}

function renderUserAccounts() {
  const container = document.getElementById('userAccountsList');
  if (!container) return;

  if (!companyUsers || companyUsers.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:14px;color:#94a3b8;font-size:12.5px;background:#f8fafc;border-radius:10px;border:1px dashed #cbd5e1;">No user accounts found. Click below to create one.</div>';
    return;
  }

  const ownerCount = companyUsers.filter(u => u.role === 'owner').length;

  container.innerHTML = companyUsers.map(u => {
    const isSelf = currentUser && currentUser.id === u.id;
    const isLastOwner = u.role === 'owner' && ownerCount <= 1;
    let badgeClass = 'role-staff';
    if (u.role === 'owner') badgeClass = 'role-owner';
    if (u.role === 'partner') badgeClass = 'role-partner';
    if (u.role === 'viewer') badgeClass = 'role-viewer';

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;transition:all 0.2s;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <div class="user-avatar" style="width:34px;height:34px;font-size:13px;font-weight:700;flex-shrink:0;">${(u.name || 'U').charAt(0).toUpperCase()}</div>
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <span>${escapeHtml(u.name)}</span>
              ${isSelf ? '<span style="font-size:10px;background:#e2e8f0;color:#475569;padding:1px 6px;border-radius:6px;font-weight:700;">YOU</span>' : ''}
            </div>
            <div style="font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:6px;">
              <span>@${escapeHtml(u.username)}</span>
              <span style="color:#cbd5e1;">•</span>
              <span style="font-family:monospace;letter-spacing:1px;font-size:10px;color:#94a3b8;">••••••••</span>
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span class="role-badge ${badgeClass}">${getRoleEmoji(u.role)}</span>
          <button type="button" class="btn-user-action btn-user-edit" onclick="openEditUserModal('${u.id}')" title="Edit account details for ${escapeHtml(u.name)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Edit</span>
          </button>
          ${(!isSelf && !isLastOwner) ? `
            <button type="button" class="btn-user-action btn-user-delete" onclick="deleteUserAccount('${u.id}')" title="Delete account for ${escapeHtml(u.name)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <span>Delete</span>
            </button>
          ` : `
            <span style="display:inline-block;width:20px;"></span>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function openAddUserModal() {
  const overlay = document.getElementById('userModalOverlay');
  const title = document.getElementById('userModalTitle');
  const editIdInput = document.getElementById('editUserId');
  const submitBtn = document.getElementById('saveUserBtn');
  const form = document.getElementById('userForm');
  const roleSelect = document.getElementById('userRoleSelect');

  if (form) form.reset();
  if (editIdInput) editIdInput.value = '';
  if (title) title.textContent = 'Add New User Account';
  if (submitBtn) submitBtn.textContent = 'Create User Account';
  if (roleSelect) {
    roleSelect.disabled = false;
    roleSelect.value = 'staff';
  }
  if (overlay) overlay.classList.add('active');
}

function openEditUserModal(userId) {
  const u = companyUsers.find(item => item.id === userId);
  if (!u) {
    showToast('User account not found.', 'error');
    return;
  }

  const overlay = document.getElementById('userModalOverlay');
  const title = document.getElementById('userModalTitle');
  const editIdInput = document.getElementById('editUserId');
  const nameInput = document.getElementById('userDisplayName');
  const usernameInput = document.getElementById('userUsername');
  const passwordInput = document.getElementById('userPassword');
  const roleSelect = document.getElementById('userRoleSelect');
  const submitBtn = document.getElementById('saveUserBtn');

  if (editIdInput) editIdInput.value = u.id;
  if (title) title.textContent = `Edit User: ${u.name}`;
  if (nameInput) nameInput.value = u.name || '';
  if (usernameInput) usernameInput.value = u.username || '';
  if (passwordInput) passwordInput.value = u.password || '';
  if (roleSelect) {
    roleSelect.value = u.role || 'staff';
    // If editing self and self is owner, prevent demoting self to avoid lock-out
    roleSelect.disabled = (currentUser && currentUser.id === u.id && u.role === 'owner');
  }
  if (submitBtn) submitBtn.textContent = 'Save Changes';

  if (overlay) overlay.classList.add('active');
}

function closeUserModal() {
  const overlay = document.getElementById('userModalOverlay');
  const editIdInput = document.getElementById('editUserId');
  if (editIdInput) editIdInput.value = '';
  if (overlay) overlay.classList.remove('active');
}

function handleUserFormSubmit(e) {
  e.preventDefault();
  const editId = (document.getElementById('editUserId')?.value || '').trim();
  const name = document.getElementById('userDisplayName').value.trim();
  const username = document.getElementById('userUsername').value.trim().toLowerCase();
  const password = document.getElementById('userPassword').value;
  const roleSelect = document.getElementById('userRoleSelect');
  const role = roleSelect ? roleSelect.value : 'staff';

  if (!name || !username || !password) {
    showToast('Please fill all user fields.', 'error');
    return;
  }

  if (editId) {
    // ── EDIT EXISTING USER ──
    const idx = companyUsers.findIndex(u => u.id === editId);
    if (idx === -1) {
      showToast('User account not found.', 'error');
      return;
    }

    // Check duplicate username with other users
    const duplicate = companyUsers.some((u, i) => i !== idx && u.username.toLowerCase() === username);
    if (duplicate) {
      showToast(`Username "${username}" is already taken by another account.`, 'error');
      return;
    }

    const oldUser = companyUsers[idx];
    const isSelfOwner = (currentUser && currentUser.id === oldUser.id && oldUser.role === 'owner');
    const finalRole = isSelfOwner ? 'owner' : role;

    companyUsers[idx] = {
      ...oldUser,
      name,
      username,
      password,
      role: finalRole
    };

    // If editing currently logged-in user, refresh active session and UI labels
    if (currentUser && currentUser.id === oldUser.id) {
      currentUser = companyUsers[idx];
      const sessionObj = {
        username: currentUser.username,
        role: currentUser.role,
        name: currentUser.name
      };
      if (sessionStorage.getItem('lynxora_auth_session')) {
        sessionStorage.setItem('lynxora_auth_session', JSON.stringify(sessionObj));
      }
      if (localStorage.getItem('lynxora_auth_session')) {
        sessionObj.remembered = true;
        localStorage.setItem('lynxora_auth_session', JSON.stringify(sessionObj));
      }
      applyUserRolePermissions();
    }

    saveCompanyUsers(`Updated user: ${name} (@${username})`);
    closeUserModal();
    renderUserAccounts();
    showToast(`User account "${name}" updated successfully!`, 'success');

  } else {
    // ── CREATE NEW USER ──
    const exists = companyUsers.some(u => u.username.toLowerCase() === username);
    if (exists) {
      showToast(`Username "${username}" already exists. Please pick a different one.`, 'error');
      return;
    }

    const newUser = {
      id: 'usr_' + Date.now(),
      name,
      username,
      password,
      role
    };

    companyUsers.push(newUser);
    saveCompanyUsers(`Created user: ${name} (${getRoleEmoji(role)})`);
    closeUserModal();
    renderUserAccounts();
    showToast(`User "${name}" (${getRoleEmoji(role)}) created successfully!`, 'success');
  }
}

function deleteUserAccount(userId) {
  const u = companyUsers.find(item => item.id === userId);
  if (!u) return;

  if (currentUser && currentUser.id === userId) {
    showToast('You cannot delete your own active login account.', 'error');
    return;
  }

  const ownerCount = companyUsers.filter(item => item.role === 'owner').length;
  if (u.role === 'owner' && ownerCount <= 1) {
    showToast('Cannot delete the last remaining Owner account.', 'error');
    return;
  }

  const detailsHtml = `
    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 14px;text-align:left;font-size:13px;display:flex;flex-direction:column;gap:6px;">
      <div class="confirm-preview-row"><span class="confirm-preview-label">User Name:</span><span class="confirm-preview-val"><b>${escapeHtml(u.name)}</b></span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Username:</span><span class="confirm-preview-val">@${escapeHtml(u.username)}</span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Role:</span><span class="confirm-preview-val"><span class="badge" style="background:#e0e7ff;color:#4338ca;font-weight:700;">${escapeHtml(u.role.toUpperCase())}</span></span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Status:</span><span class="confirm-preview-val" style="color:${u.active ? '#059669' : '#dc2626'};font-weight:700;">${u.active ? '● Active' : '○ Inactive'}</span></div>
    </div>
  `;

  openConfirmModal({
    title: 'Delete User Account?',
    message: `Are you sure you want to permanently delete user account "<b>${escapeHtml(u.name)}</b>" (@${escapeHtml(u.username)})? This user will immediately lose access and will no longer be able to log in.`,
    detailsHtml: detailsHtml,
    actionText: 'Yes, Delete User',
    actionClass: 'btn-danger',
    cancelText: 'Cancel / Keep',
    onConfirm: () => {
      companyUsers = companyUsers.filter(item => item.id !== userId);
      saveCompanyUsers(`Deleted user account: ${u.name} (@${u.username})`);
      renderUserAccounts();
      showToast(`User account "${u.name}" deleted successfully.`, 'info');
    }
  });
}

// ══════════════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════════════
function init() {
  initTheme();
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    localStorage.setItem('lynxora_sync_room', roomParam.trim());
  }

  const saved = localStorage.getItem('lynxora_records') || localStorage.getItem('livvoracart_records') || localStorage.getItem('financepro_records');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      records = Array.isArray(parsed) ? parsed : [];
    } catch { records = []; }
  } else { records = []; }

  loadInventory();
  loadStockMovements();
  loadInvoices();
  updateInvoicesHeaderBadge();
  loadTrackedPricing();
  loadTrackedFlipkart();
  updateAmzTrackedBadge();
  updateFkTrackedBadge();
  populateCategoryFilter();
  attachEventListeners();
  initAuth();
  initCloudSync();
  navigateTo('dashboard');
}

function saveRecords(actionDesc = '', allowEmpty = false) {
  localStorage.setItem('lynxora_records', JSON.stringify(records));
  if (typeof broadcastToCloud === 'function') {
    broadcastToCloud('records', actionDesc || (editingId ? 'Updated financial transaction' : 'Added financial transaction'), allowEmpty);
  }
}

// ══════════════════════════════════════════════════
//  PAGE NAVIGATION
// ══════════════════════════════════════════════════
function navigateTo(page) {
  activePage = page;
  document.querySelectorAll('.nav-item').forEach(item =>
    item.classList.toggle('active', item.dataset.page === page)
  );
  document.querySelectorAll('.page-section').forEach(section =>
    section.classList.toggle('active', section.id === `page-${page}`)
  );
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (window.innerWidth < 1024) {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
  }
  updateMobileNav(page);
  try {
    switch (page) {
      case 'dashboard': updateDashboard(); break;
      case 'records':   updateRecordStats(); renderRecordsTable(); break;
      case 'inventory': renderInventory();
  renderStockMovementsTable(); break;
      case 'pricing':   calculateReversePrice(); renderPricingTrackerTable(); break;
      case 'flipkart':  calculateFlipkartPrice(); renderFkTrackerTable(); break;
      case 'reports':   renderReports(); break;
    }
  } catch (err) {
    console.error('Error rendering page ' + page, err);
  }
}

function updateMobileNav(page) {
  document.querySelectorAll('.mobile-nav-item[data-page]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
}


// ══════════════════════════════════════════════════
//  FORMATTING & BRAND HELPERS
// ══════════════════════════════════════════════════
const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR',
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

function formatCurrency(amount) {
  return currencyFormatter.format(Math.abs(amount || 0));
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00')
    .toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getMonthLabel(dateStr) {
  return new Date(dateStr + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short' });
}

function getMonthFullLabel(dateStr) {
  return new Date(dateStr + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getAmazonSvg(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#ea580c" style="vertical-align:middle;flex-shrink:0;">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.93 15.09c-2.83 2.08-6.94 3.19-10.47 1.83-1.63-.63-2.97-1.74-3.46-3.46-.22-.76.22-1.52.98-1.74.76-.22 1.52.22 1.74.98.26.93 1.05 1.58 2.03 1.95 2.67 1.03 5.79.19 7.94-1.39.64-.47 1.54-.33 2.01.31.47.64.33 1.54-.31 2.01l-.46.47zm3.62-2.78c-.32.41-.9.51-1.31.19l-1.92-1.48c-.41-.32-.51-.9-.19-1.31.32-.41.9-.51 1.31-.19l1.92 1.48c.41.32.51.9.19 1.31z"/>
  </svg>`;
}

function getFlipkartSvg(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#2563eb" style="vertical-align:middle;flex-shrink:0;">
    <path d="M17 18a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2c0-1.11.89-2 2-2M1 2h3.27l.94 2H20a1 1 0 0 1 1 1c0 .17-.05.34-.12.5l-3.58 6.49c-.37.66-1.08 1.01-1.85 1.01H8.53l-.13.27L8.27 14h11.73v2H8.53c-1.66 0-2.54-1.27-1.81-2.61L8.1 11l-3.36-7H1V2m6 16a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2c0-1.11.89-2 2-2m9-7 2.78-5H6.14l1.86 5H16z"/>
  </svg>`;
}

function getCategoryBadgeHtml(cat) {
  if (cat === 'Amazon') {
    return `<span class="cat-badge cat-amazon">${getAmazonSvg(15)} <b>Amazon</b></span>`;
  }
  if (cat === 'Flipkart') {
    return `<span class="cat-badge cat-flipkart">${getFlipkartSvg(15)} <b>Flipkart</b></span>`;
  }
  if (cat === 'Product Purchase / Inventory') {
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-weight:700;color:#c2410c;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> ${escapeHtml(cat)}</span>`;
  }
  return escapeHtml(cat);
}

// ══════════════════════════════════════════════════
//  DASHBOARD TIME FILTER MANAGEMENT
// ══════════════════════════════════════════════════
function setTimePreset(preset) {
  timeFilterMode = preset;
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === preset);
  });

  const yearSelect = document.getElementById('filterYearSelect');
  const monthSelect = document.getElementById('filterMonthSelect');
  const customGroup = document.getElementById('customDateGroup');

  if (yearSelect) yearSelect.style.display = (preset === 'customYear') ? 'block' : 'none';
  if (monthSelect) monthSelect.style.display = (preset === 'customMonth') ? 'block' : 'none';
  if (customGroup) customGroup.style.display = (preset === 'customRange') ? 'flex' : 'none';

  const now = new Date();
  if (preset === 'thisYear') {
    filterYear = now.getFullYear().toString();
  } else if (preset === 'thisMonth') {
    filterMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  handleTimeFilterChange();
}

function handleTimeFilterChange() {
  const yearSelect = document.getElementById('filterYearSelect');
  const monthSelect = document.getElementById('filterMonthSelect');
  const fromEl = document.getElementById('filterDateFrom');
  const toEl = document.getElementById('filterDateTo');
  const labelEl = document.getElementById('filterActiveLabel');

  let text = 'All Time';
  const now = new Date();

  if (timeFilterMode === 'all') {
    text = 'All Time';
  } else if (timeFilterMode === 'thisYear') {
    text = `Year ${now.getFullYear()}`;
  } else if (timeFilterMode === 'thisMonth') {
    const mStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    text = `${getMonthFullLabel(mStr)}`;
  } else if (timeFilterMode === 'customYear') {
    filterYear = yearSelect ? yearSelect.value : '2026';
    text = filterYear === 'ALL' ? 'All Years' : `Year ${filterYear}`;
  } else if (timeFilterMode === 'customMonth') {
    filterMonth = monthSelect ? monthSelect.value : '';
    text = filterMonth ? `${getMonthFullLabel(filterMonth)}` : 'Select Month';
  } else if (timeFilterMode === 'customRange') {
    filterDateFrom = fromEl ? fromEl.value : '';
    filterDateTo = toEl ? toEl.value : '';
    if (filterDateFrom && filterDateTo) {
      text = `${formatDate(filterDateFrom)} — ${formatDate(filterDateTo)}`;
    } else if (filterDateFrom) {
      text = `From ${formatDate(filterDateFrom)}`;
    } else {
      text = 'Custom Date Range';
    }
  }

  if (labelEl) labelEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${text}</span>`;

  if (activePage === 'dashboard') updateDashboard();
  if (activePage === 'reports') renderReports();
}

function getFilteredRecordsForTime() {
  const now = new Date();
  return records.filter(r => {
    if (!r.date) return false;
    const rDate = r.date;
    const rMonth = rDate.substring(0, 7);
    const rYear = rDate.substring(0, 4);

    if (timeFilterMode === 'all') return true;
    if (timeFilterMode === 'thisYear') return rYear === now.getFullYear().toString();
    if (timeFilterMode === 'thisMonth') {
      const curM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      return rMonth === curM;
    }
    if (timeFilterMode === 'customYear') {
      if (filterYear === 'ALL') return true;
      return rYear === filterYear;
    }
    if (timeFilterMode === 'customMonth') {
      if (!filterMonth) return true;
      return rMonth === filterMonth;
    }
    if (timeFilterMode === 'customRange') {
      if (filterDateFrom && rDate < filterDateFrom) return false;
      if (filterDateTo && rDate > filterDateTo) return false;
      return true;
    }
    return true;
  });
}

// ══════════════════════════════════════════════════
//  CORE FINANCIAL CALCULATIONS
//  (All loan payments are considered in total expenses)
// ══════════════════════════════════════════════════
function calcFinancials(targetRecords = null) {
  const recs = targetRecords || getFilteredRecordsForTime();

  let totalIncome = 0;
  let totalExpense = 0;
  let loanReceived = 0;
  let loanPayments = 0;
  let cashOnHand = 0;
  let bankBalance = 0;
  let totalAssets = 0;
  let amazonIncome = 0;
  let flipkartIncome = 0;
  let openingCapital = 0;

  recs.forEach(r => {
    const isCash = (r.paymentMethod === 'Cash');

    if (r.type === 'Income') {
      totalIncome += r.amount;
      if (r.category === 'Loan Received') loanReceived += r.amount;
      if (r.category === 'Amazon') amazonIncome += r.amount;
      if (r.category === 'Flipkart') flipkartIncome += r.amount;
      if (r.category === 'Opening Capital / Owner Capital') openingCapital += r.amount;

      if (isCash) cashOnHand += r.amount; else bankBalance += r.amount;

    } else if (r.type === 'Expense') {
      // ALL expenses including loan payment are factored directly into totalExpense
      totalExpense += r.amount;
      if (r.category === 'Loan Payment') {
        loanPayments += r.amount;
      }
      if (isCash) cashOnHand -= r.amount; else bankBalance -= r.amount;

    } else if (r.type === 'Asset') {
      totalAssets += r.amount;
      if (isCash) cashOnHand -= r.amount; else bankBalance -= r.amount;

    } else if (r.type === 'Transfer') {
      if (r.category === 'Bank Withdrawal (Cash from Bank)' || r.category.includes('Withdrawal')) {
        bankBalance -= r.amount;
        cashOnHand += r.amount;
      } else if (r.category === 'Bank Deposit (Cash to Bank)' || r.category.includes('Deposit')) {
        cashOnHand -= r.amount;
        bankBalance += r.amount;
      }
    }
  });

  const loanOutstanding = loanReceived - loanPayments;
  const netProfit = totalIncome - totalExpense;
  const ratio = totalExpense > 0 ? (totalIncome / totalExpense).toFixed(2) : (totalIncome > 0 ? '∞' : '0.00');
  const grossMargin = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome * 100).toFixed(1) : '0.0';
  const operatingMargin = totalIncome > 0 ? (netProfit / totalIncome * 100).toFixed(1) : '0.0';

  return {
    totalIncome, totalExpense, loanReceived, loanPayments, loanOutstanding,
    cashOnHand, bankBalance, totalAssets, amazonIncome, flipkartIncome, openingCapital,
    netProfit, ratio, grossMargin, operatingMargin, count: recs.length
  };
}

// ══════════════════════════════════════════════════
//  DASHBOARD PAGE & 8 SCORECARDS
// ══════════════════════════════════════════════════
function updateDashboard() {
  const f = calcFinancials();
  const timeRecs = getFilteredRecordsForTime();

  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  let curIncome = 0, prevIncome = 0, curExpense = 0, prevExpense = 0;
  records.forEach(r => {
    const m = r.date.substring(0, 7);
    if (r.type === 'Income') {
      if (m === curMonth) curIncome += r.amount;
      if (m === prevMonth) prevIncome += r.amount;
    } else if (r.type === 'Expense') {
      if (m === curMonth) curExpense += r.amount;
      if (m === prevMonth) prevExpense += r.amount;
    }
  });

  // 1. Net Income
  setText('netIncomeValue', formatCurrency(f.totalIncome));
  setTrend('netIncomeTrend', prevIncome, curIncome);

  // 2. Total Expenses (Includes all operating expenses + loan payments)
  setText('totalExpenseValue', formatCurrency(f.totalExpense));
  setTrend('totalExpenseTrend', prevExpense, curExpense, true);

  // 3. Cash on Hand
  setText('cashOnHandValue', formatCurrency(Math.max(0, f.cashOnHand)));

  // 4. Bank Balance
  setText('bankBalanceValue', formatCurrency(Math.max(0, f.bankBalance)));

  // 5. Loan Amount
  setText('loanAmountValue', formatCurrency(Math.max(0, f.loanOutstanding)));
  const loanEl = document.getElementById('loanAmountTrend');
  if (loanEl) {
    loanEl.className = 'scorecard-trend neutral';
    loanEl.innerHTML = `<span class="trend-arrow">&#8595;</span> Rcvd: ${formatCurrency(f.loanReceived)} | Paid: ${formatCurrency(f.loanPayments)}`;
  }

  // 6. Net Profit
  setText('netProfitValue', formatCurrency(f.netProfit));
  setTrend('netProfitTrend', prevIncome - prevExpense, curIncome - curExpense);

  // 7. Profit & Loss Ratio Scorecard
  setText('scorecardRatioValue', f.ratio);
  const marginEl = document.getElementById('scorecardMarginTrend');
  if (marginEl) {
    marginEl.textContent = `Margin: ${f.operatingMargin}%`;
    marginEl.className = `scorecard-trend ${parseFloat(f.operatingMargin) >= 0 ? 'up' : 'down'}`;
  }

  // 8. Company Assets
  setText('scorecardAssetValue', formatCurrency(f.totalAssets));
  const assetCount = timeRecs.filter(r => r.type === 'Asset').length;
  setText('scorecardAssetTrend', `${assetCount} Asset items`);

  // Summary bar
  setText('grossMarginValue', f.grossMargin + '%');
  setText('operatingMarginValue', f.operatingMargin + '%');
  setText('ratioValue', f.ratio);
  setText('totalRecordsValue', timeRecs.length.toString());

  updateCharts(f, timeRecs);
  updateDashboardInventoryOverview();
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setTrend(id, prevVal, curVal, invertColor = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!prevVal && !curVal) {
    el.className = 'scorecard-trend neutral';
    el.innerHTML = '<span class="trend-arrow">&#8212;</span> No change';
    return;
  }
  let pct = prevVal === 0 ? 100 : ((curVal - prevVal) / Math.abs(prevVal) * 100);
  pct = Math.round(pct * 10) / 10;
  const isUp = pct >= 0;
  const dir = invertColor ? (isUp ? 'down' : 'up') : (isUp ? 'up' : 'down');
  el.className = `scorecard-trend ${dir}`;
  el.innerHTML = `<span class="trend-arrow">${isUp ? '&#8593;' : '&#8595;'}</span> ${Math.abs(pct)}% vs last month`;
}

// ══════════════════════════════════════════════════
//  DRILLDOWN MODAL (SCORECARDS & FINAL ACCOUNTS)
// ══════════════════════════════════════════════════
function openScorecardDrilldown(type) {
  currentDrilldownType = type;
  const timeRecs = getFilteredRecordsForTime();
  let matched = [];
  let title = '';
  let subLabel = '';
  let totalAmt = 0;

  switch (type) {
    case 'income':
      matched = timeRecs.filter(r => r.type === 'Income');
      title = 'Net Income Records';
      subLabel = 'Total Income';
      totalAmt = matched.reduce((s, r) => s + r.amount, 0);
      break;
    case 'expense':
      matched = timeRecs.filter(r => r.type === 'Expense');
      title = 'Total Expense Records';
      subLabel = 'Total Outflows & Expenses';
      totalAmt = matched.reduce((s, r) => s + r.amount, 0);
      break;
    case 'cash':
      matched = timeRecs.filter(r => r.paymentMethod === 'Cash' || (r.type === 'Transfer' && (r.category.includes('Withdrawal') || r.category.includes('Deposit'))));
      title = 'Cash on Hand Records';
      subLabel = 'Physical Cash & Bank Cash Withdrawals';
      totalAmt = matched.reduce((s, r) => {
        if (r.type === 'Income') return s + r.amount;
        if (r.type === 'Expense' || r.type === 'Asset') return s - r.amount;
        if (r.type === 'Transfer') {
          if (r.category.includes('Withdrawal')) return s + r.amount;
          if (r.category.includes('Deposit')) return s - r.amount;
        }
        return s;
      }, 0);
      break;
    case 'bank':
      matched = timeRecs.filter(r => r.paymentMethod === 'Online/UPI' || (r.type === 'Transfer' && (r.category.includes('Withdrawal') || r.category.includes('Deposit'))));
      title = 'Bank / UPI Records';
      subLabel = 'Online, UPI & Bank Cash Withdrawals';
      totalAmt = matched.reduce((s, r) => {
        if (r.type === 'Income') return s + r.amount;
        if (r.type === 'Expense' || r.type === 'Asset') return s - r.amount;
        if (r.type === 'Transfer') {
          if (r.category.includes('Withdrawal')) return s - r.amount;
          if (r.category.includes('Deposit')) return s + r.amount;
        }
        return s;
      }, 0);
      break;
    case 'loan':
      matched = timeRecs.filter(r => r.category === 'Loan Received' || r.category === 'Loan Payment');
      title = 'Loan Records';
      subLabel = 'Loan Received & Repayments';
      totalAmt = matched.reduce((s, r) => s + (r.category === 'Loan Received' ? r.amount : -r.amount), 0);
      break;
    case 'profit':
      matched = timeRecs.filter(r => r.type === 'Income' || r.type === 'Expense');
      title = 'Profit & Loss Operating Records';
      subLabel = 'Revenue vs Expenses';
      const inc = matched.filter(r => r.type === 'Income').reduce((s, r) => s + r.amount, 0);
      const exp = matched.filter(r => r.type === 'Expense').reduce((s, r) => s + r.amount, 0);
      totalAmt = inc - exp;
      break;
    case 'ratio':
      matched = timeRecs.filter(r => r.type === 'Income' || r.type === 'Expense');
      title = 'Profit & Loss Ratio Breakdown';
      subLabel = 'All Operating Records';
      totalAmt = matched.reduce((s, r) => s + (r.type === 'Income' ? r.amount : -r.amount), 0);
      break;
    case 'asset':
      matched = timeRecs.filter(r => r.type === 'Asset');
      title = 'Company Assets Records';
      subLabel = 'Total Company Assets';
      totalAmt = matched.reduce((s, r) => s + r.amount, 0);
      break;
  }

  showDrilldownPopup(title, subLabel, totalAmt, matched, type);
}

// ── Final Accounts Drilldown by Category ──
function openFinalAccountDrilldown(catName, typeContext) {
  const repYear = document.getElementById('reportYearFilter')?.value || 'ALL';
  const targetRecs = records.filter(r => {
    if (!r.date) return false;
    if (repYear !== 'ALL' && r.date.substring(0, 4) !== repYear) return false;
    return r.category === catName;
  });

  const totalAmt = targetRecs.reduce((s, r) => s + r.amount, 0);
  const title = `${catName} — Transaction Records`;
  const subLabel = `${typeContext} Category (${repYear === 'ALL' ? 'All Financial Years' : 'FY ' + repYear})`;

  currentDrilldownType = 'category_' + catName;
  showDrilldownPopup(title, subLabel, totalAmt, targetRecs, 'finalAccountCat');
}

// ── Monthly Summary Drilldown by Month ──
function openMonthDrilldown(monthStr) {
  const targetRecs = records.filter(r => {
    if (!r.date) return false;
    return r.date.substring(0, 7) === monthStr && (r.type === 'Income' || r.type === 'Expense');
  });

  const inc = targetRecs.filter(r => r.type === 'Income').reduce((s, r) => s + r.amount, 0);
  const exp = targetRecs.filter(r => r.type === 'Expense').reduce((s, r) => s + r.amount, 0);
  const net = inc - exp;

  const title = `${getMonthFullLabel(monthStr)} — Monthly Records`;
  const subLabel = `Net Result: ${formatCurrency(net)} (Income: ${formatCurrency(inc)} | Expense: ${formatCurrency(exp)})`;

  showDrilldownPopup(title, subLabel, net, targetRecs, 'monthly');
}

function showDrilldownPopup(title, subLabel, totalAmt, matchedList, contextType) {
  setText('drilldownTitle', title);
  setText('drilldownSubLabel', subLabel);
  setText('drilldownTotalValue', formatCurrency(totalAmt));
  setText('drilldownCountPill', `${matchedList.length} record${matchedList.length === 1 ? '' : 's'}`);

  const tbody = document.getElementById('drilldownTableBody');
  if (tbody) {
    if (matchedList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#94a3b8;">No records found for this period.</td></tr>';
    } else {
      matchedList.sort((a, b) => new Date(b.date) - new Date(a.date));
      tbody.innerHTML = matchedList.map(r => {
        let pm = r.paymentMethod === 'Cash' ? 'Cash' : (r.paymentMethod === 'Online/UPI' ? 'UPI' : 'Transfer');
        let isPos = r.type === 'Income';
        if (contextType === 'cash') {
          isPos = (r.type === 'Income') || (r.type === 'Transfer' && r.category.includes('Withdrawal'));
        } else if (contextType === 'bank') {
          isPos = (r.type === 'Income') || (r.type === 'Transfer' && r.category.includes('Deposit'));
        }

        let descText = escapeHtml(r.description);
        if (r.partyName) {
          descText += ` <span style="display:inline-flex;align-items:center;gap:4px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;border:1px solid #bfdbfe;margin-left:6px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 7v14M21 7v14M9 21V7M15 21V7M9 3h6v4H9z"/></svg> ${escapeHtml(r.partyName)}</span>`;
        }

        return `<tr>
          <td>${formatDate(r.date)}</td>
          <td><b>${descText}</b></td>
          <td>${getCategoryBadgeHtml(r.category)}</td>
          <td>${pm}</td>
          <td style="font-weight:700; color:${isPos ? '#059669' : '#dc2626'}">${isPos ? '+' : '-'}${formatCurrency(r.amount)}</td>
        </tr>`;
      }).join('');
    }
  }

  const modal = document.getElementById('drilldownModalOverlay');
  if (modal) modal.classList.add('active');
}

function closeDrilldownModal() {
  const modal = document.getElementById('drilldownModalOverlay');
  if (modal) modal.classList.remove('active');
}

function drilldownOpenRecords() {
  closeDrilldownModal();
  navigateTo('records');

  if (currentDrilldownType === 'income') {
    typeFilter = 'Income';
  } else if (currentDrilldownType === 'expense') {
    typeFilter = 'Expense';
  } else if (currentDrilldownType === 'asset') {
    typeFilter = 'Asset';
  } else if (currentDrilldownType === 'cash') {
    paymentFilter = 'Cash';
  } else if (currentDrilldownType === 'bank') {
    paymentFilter = 'Online/UPI';
  } else if (currentDrilldownType && currentDrilldownType.startsWith('category_')) {
    categoryFilter = currentDrilldownType.replace('category_', '');
  }

  const typeEl = document.getElementById('typeFilterSelect');
  const payEl = document.getElementById('paymentFilterSelect');
  const catEl = document.getElementById('categoryFilterSelect');
  if (typeEl) typeEl.value = typeFilter;
  if (payEl) payEl.value = paymentFilter;
  if (catEl && categoryFilter !== 'All') catEl.value = categoryFilter;

  renderRecordsTable();
}

// ══════════════════════════════════════════════════
//  CHARTS CONFIGURATION
// ══════════════════════════════════════════════════
function updateCharts(f, timeRecs) {
  Chart.defaults.font.family = "'Plus Jakarta Sans', 'Inter', sans-serif";
  Chart.defaults.plugins.tooltip.backgroundColor = '#0f172a';
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;

  buildRatioLineChart();
  buildRatioChart(f.totalIncome, f.totalExpense);
  buildTypeChart(timeRecs);
  buildCategoryChart(timeRecs);
}

function setLineGraphRange(range) {
  lineGraphFilterRange = range;
  document.querySelectorAll('.line-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });

  const customInputs = document.getElementById('lineCustomDateInputs');
  if (customInputs) {
    customInputs.style.display = (range === 'custom') ? 'flex' : 'none';
  }

  buildRatioLineChart();
}

function handleLineCustomDateChange() {
  const fromEl = document.getElementById('lineDateFrom');
  const toEl = document.getElementById('lineDateTo');
  lineGraphDateFrom = fromEl ? fromEl.value : '';
  lineGraphDateTo = toEl ? toEl.value : '';
  buildRatioLineChart();
}

function buildRatioLineChart() {
  const canvas = document.getElementById('ratioLineChart');
  if (!canvas) return;
  if (chartInstances.ratioLine) chartInstances.ratioLine.destroy();

  const isDark = getAppTheme() === 'dark';
  const now = new Date();
  let filtered = records.filter(r => {
    if (!r.date || r.type === 'Transfer' || r.type === 'Asset') return false;
    const rDate = r.date;
    const rYear = rDate.substring(0, 4);

    if (lineGraphFilterRange === 'all') return true;
    if (lineGraphFilterRange === 'thisYear') return rYear === now.getFullYear().toString();
    if (lineGraphFilterRange === '6m') {
      const d6 = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().split('T')[0];
      return rDate >= d6;
    }
    if (lineGraphFilterRange === '3m') {
      const d3 = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0];
      return rDate >= d3;
    }
    if (lineGraphFilterRange === 'custom') {
      if (lineGraphDateFrom && rDate < lineGraphDateFrom) return false;
      if (lineGraphDateTo && rDate > lineGraphDateTo) return false;
      return true;
    }
    return true;
  });

  const monthly = {};
  filtered.forEach(r => {
    const m = r.date.substring(0, 7);
    if (!monthly[m]) monthly[m] = { income: 0, expense: 0 };
    if (r.type === 'Income') monthly[m].income += r.amount;
    else if (r.type === 'Expense') monthly[m].expense += r.amount;
  });

  let months = Object.keys(monthly).sort();
  if (months.length === 0) {
    const curM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    months = [curM];
    monthly[curM] = { income: 0, expense: 0 };
  }

  const labels = months.map(m => getMonthLabel(m));

  const expenseRatioData = months.map(m => {
    const inc = monthly[m].income;
    const exp = monthly[m].expense;
    return inc > 0 ? ((exp / inc) * 100).toFixed(1) : (exp > 0 ? 100 : 0);
  });

  const profitMarginData = months.map(m => {
    const inc = monthly[m].income;
    const exp = monthly[m].expense;
    const net = inc - exp;
    return inc > 0 ? ((net / inc) * 100).toFixed(1) : (net < 0 ? -100 : 0);
  });

  chartInstances.ratioLine = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Profit Margin (%)',
          data: profitMarginData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          fill: true,
          tension: 0.35,
          borderWidth: 3,
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#fff',
          pointRadius: 5,
          pointHoverRadius: 7
        },
        {
          label: 'Expense Ratio (%)',
          data: expenseRatioData,
          borderColor: '#f43f5e',
          backgroundColor: 'rgba(244, 63, 94, 0.08)',
          fill: true,
          tension: 0.35,
          borderWidth: 3,
          pointBackgroundColor: '#f43f5e',
          pointBorderColor: '#fff',
          pointRadius: 5,
          pointHoverRadius: 7
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 12, weight: '600' }, color: isDark ? '#94a3b8' : '#475569' } },
        y: {
          grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
          ticks: {
            callback: v => `${v}%`,
            font: { size: 11, weight: '600' },
            color: isDark ? '#94a3b8' : '#64748b'
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: { usePointStyle: true, padding: 18, font: { size: 12, weight: '700' }, color: isDark ? '#e2e8f0' : '#1e293b' }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}%`
          }
        }
      }
    }
  });
}

function buildRatioChart(income, expense) {
  const canvas = document.getElementById('ratioChart');
  if (!canvas) return;
  if (chartInstances.ratio) chartInstances.ratio.destroy();

  const isDark = getAppTheme() === 'dark';
  const ratio = expense > 0 ? (income / expense).toFixed(2) : (income > 0 ? '∞' : '0.00');

  const centerText = {
    id: 'centerText',
    beforeDraw(chart) {
      const { width, height, ctx } = chart;
      ctx.save();
      ctx.font = '800 1.8em Plus Jakarta Sans, sans-serif';
      ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ratio, width / 2, height / 2 - 8);
      ctx.font = '700 0.75em Plus Jakarta Sans, sans-serif';
      ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
      ctx.fillText('Ratio', width / 2, height / 2 + 18);
      ctx.restore();
    }
  };

  chartInstances.ratio = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Total Income', 'Total Expenses'],
      datasets: [{
        data: [income, expense],
        backgroundColor: ['#10b981', '#f6bcba'],
        borderWidth: 0,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 18, usePointStyle: true, font: { size: 12, weight: '600' }, color: isDark ? '#e2e8f0' : '#1e293b' } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.raw)}` } }
      }
    },
    plugins: [centerText]
  });
}

function buildTypeChart(timeRecs) {
  const canvas = document.getElementById('typeChart');
  if (!canvas) return;
  if (chartInstances.type) chartInstances.type.destroy();

  const isDark = getAppTheme() === 'dark';
  const monthly = {};
  timeRecs.forEach(r => {
    if (r.type === 'Transfer' || r.type === 'Asset') return;
    const m = r.date.substring(0, 7);
    if (!monthly[m]) monthly[m] = { income: 0, expense: 0 };
    if (r.type === 'Income') monthly[m].income += r.amount;
    else if (r.type === 'Expense') monthly[m].expense += r.amount;
  });

  const months = Object.keys(monthly).sort();
  chartInstances.type = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: months.map(getMonthLabel),
      datasets: [
        { label: 'Income', data: months.map(m => monthly[m].income), backgroundColor: '#10b981', borderRadius: 6, barPercentage: 0.7, categoryPercentage: 0.6 },
        { label: 'Expenses', data: months.map(m => monthly[m].expense), backgroundColor: '#f6bcba', borderRadius: 6, barPercentage: 0.7, categoryPercentage: 0.6 }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { callback: v => `₹${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v}`, font: { size: 11 }, color: isDark ? '#94a3b8' : '#64748b' }, grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' } },
        y: { ticks: { font: { size: 12, weight: '600' }, color: isDark ? '#e2e8f0' : '#334155' }, grid: { display: false } }
      },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { usePointStyle: true, padding: 14, font: { size: 12, weight: '600' }, color: isDark ? '#e2e8f0' : '#1e293b' } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
      }
    }
  });
}

function buildCategoryChart(timeRecs) {
  const canvas = document.getElementById('categoryChart');
  if (!canvas) return;
  if (chartInstances.category) chartInstances.category.destroy();

  const isDark = getAppTheme() === 'dark';
  const totals = {};
  timeRecs.forEach(r => {
    if (r.type === 'Transfer') return;
    totals[r.category] = (totals[r.category] || 0) + r.amount;
  });

  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const data = sorted.map(e => e[1]);
  const total = data.reduce((a, b) => a + b, 0);

  const pastelColors = ['#c8a8e9', '#e3aadd', '#f6bcba', '#c3c7f4', '#f2dddc', '#10b981', '#3d88b0', '#e06b72'];
  const palette = sorted.map(([cat], idx) => {
    if (cat === 'Amazon') return '#ff9900';
    if (cat === 'Flipkart') return '#2874f0';
    if (cat === 'Sales Revenue') return '#10b981';
    if (cat === 'Service Income') return '#c3c7f4';
    if (cat === 'Loan Received') return '#f2dddc';
    if (cat === 'Loan Payment') return '#f6bcba';
    return pastelColors[idx % pastelColors.length];
  });

  chartInstances.category = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: sorted.map(e => e[0]),
      datasets: [{ data, backgroundColor: palette, borderWidth: 2, borderColor: isDark ? '#150f20' : '#fff', hoverOffset: 8 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { padding: 12, usePointStyle: true, font: { size: 11, weight: '600' }, color: isDark ? '#e2e8f0' : '#1e293b' } },
        tooltip: {
          callbacks: {
            label(ctx) {
              const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
              return ` ${ctx.label}: ${formatCurrency(ctx.raw)} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════
//  RECORDS PAGE
// ══════════════════════════════════════════════════
function updateRecordStats() {
  setText('statTotal', records.length.toString());
  setText('statIncome', records.filter(r => r.type === 'Income').length.toString());
  setText('statExpense', records.filter(r => r.type === 'Expense').length.toString());
  setText('statAsset', records.filter(r => r.type === 'Asset').length.toString());
  setText('statTransfer', records.filter(r => r.type === 'Transfer').length.toString());
  setText('statCash', records.filter(r => r.paymentMethod === 'Cash').length.toString());
  setText('statUpi', records.filter(r => r.paymentMethod === 'Online/UPI').length.toString());

  const amazonCount = records.filter(r => r.category === 'Amazon').length;
  const flipkartCount = records.filter(r => r.category === 'Flipkart').length;
  setText('statAmazon', amazonCount.toString());
  setText('statFlipkart', flipkartCount.toString());
}

function renderRecordsTable() {
  const tbody = document.getElementById('recordsTableBody');
  const emptyState = document.getElementById('emptyState');
  const tableWrapper = document.querySelector('.table-wrapper');
  const tableFooter = document.querySelector('.table-footer');
  if (!tbody) return;

  let filtered = records.filter(r => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || r.description.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || (r.partyName && r.partyName.toLowerCase().includes(q));
    const matchType = typeFilter === 'All' || r.type === typeFilter;
    const matchCat = categoryFilter === 'All' || r.category === categoryFilter;
    const matchPayment = paymentFilter === 'All' || r.paymentMethod === paymentFilter;
    return matchSearch && matchType && matchCat && matchPayment;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  currentFilteredRecords = filtered;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / RECORDS_PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * RECORDS_PER_PAGE;
  const page = filtered.slice(start, start + RECORDS_PER_PAGE);

  if (total === 0) {
    if (emptyState) emptyState.style.display = 'block';
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (tableFooter) tableFooter.style.display = 'none';
    setText('recordCount', 'Showing 0 records');
    updateBulkToolbar(filtered);
    return;
  }
  if (emptyState) emptyState.style.display = 'none';
  if (tableWrapper) tableWrapper.style.display = 'block';
  if (tableFooter) tableFooter.style.display = 'flex';

  tbody.innerHTML = page.map(r => {
    let badgeClass = 'badge-income', amtClass = 'amount-positive', amtSign = '+';
    if (r.type === 'Expense') { badgeClass = 'badge-expense'; amtClass = 'amount-negative'; amtSign = '-'; }
    if (r.type === 'Transfer') { badgeClass = 'badge-transfer'; amtClass = 'amount-transfer'; amtSign = '↔ '; }
    if (r.type === 'Asset') { badgeClass = 'badge-asset'; amtClass = 'amount-asset'; amtSign = ''; }

    const pmBadge = r.paymentMethod === 'Cash'
      ? '<span class="pm-badge pm-cash">Cash</span>'
      : r.paymentMethod === 'Online/UPI'
        ? '<span class="pm-badge pm-upi">UPI</span>'
        : '<span class="pm-badge pm-na">&#8212;</span>';

    let descText = escapeHtml(r.description);
    if (r.partyName) {
      descText += ` <span style="display:inline-flex;align-items:center;gap:4px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;border:1px solid #bfdbfe;margin-left:6px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 7v14M21 7v14M9 21V7M15 21V7M9 3h6v4H9z"/></svg> ${escapeHtml(r.partyName)}</span>`;
    }
    if (r.createdBy) {
      descText += ` <span style="display:inline-flex;align-items:center;gap:4px;background:#f8fafc;color:#64748b;font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:6px;border:1px solid #e2e8f0;margin-left:4px;" title="Created by ${escapeHtml(r.createdBy)}">${escapeHtml(r.createdBy)}</span>`;
    }

    const isViewer = currentUser && currentUser.role === 'viewer';
    const canDelete = currentUser && currentUser.role !== 'viewer';
    const canEdit = currentUser && currentUser.role !== 'viewer';
    const isSelected = selectedRecordIds.has(r.id);

    return `<tr class="${isSelected ? 'row-selected' : ''}">
      <td data-label="Select" style="text-align:center;width:44px;">
        <input type="checkbox" class="record-row-checkbox" data-id="${r.id}" ${isSelected ? 'checked' : ''} onchange="handleRowSelectChange(this, ${r.id})">
      </td>
      <td data-label="Date">${formatDate(r.date)}</td>
      <td data-label="Description"><b>${descText}</b></td>
      <td data-label="Type"><span class="badge ${badgeClass}">${r.type}</span></td>
      <td data-label="Category">${getCategoryBadgeHtml(r.category)}</td>
      <td data-label="Payment">${pmBadge}</td>
      <td data-label="Amount" class="${amtClass}">${amtSign}${formatCurrency(r.amount)}</td>
      <td data-label="Actions" style="gap:6px;">
        ${canEdit ? `
        <button class="action-btn action-edit" onclick="openModal(${r.id})" title="Edit Transaction">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>` : ''}
        ${canDelete ? `
        <button class="action-btn action-delete" onclick="deleteRecord(${r.id})" title="Delete Transaction">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>` : (isViewer ? '<span style="font-size:11px;color:#94a3b8;font-weight:600;">View Only</span>' : '')}
      </td>
    </tr>`;
  }).join('');

  // Update master select-all checkbox state
  updateMasterCheckboxState(page);
  updateBulkToolbar(filtered);

  setText('recordCount', `Showing ${start + 1}–${Math.min(start + RECORDS_PER_PAGE, total)} of ${total} records`);
  buildPagination(totalPages);
}

// ══════════════════════════════════════════════════
//  BULK SELECTION & ACTIONS LOGIC
// ══════════════════════════════════════════════════
let selectedRecordIds = new Set();
let currentFilteredRecords = [];

function handleRowSelectChange(cb, id) {
  if (cb.checked) {
    selectedRecordIds.add(id);
  } else {
    selectedRecordIds.delete(id);
  }
  const row = cb.closest('tr');
  if (row) row.classList.toggle('row-selected', cb.checked);
  updateMasterCheckboxState();
  updateBulkToolbar();
}

function handleSelectAllChange(checked) {
  const checkboxes = document.querySelectorAll('.record-row-checkbox');
  checkboxes.forEach(cb => {
    const id = parseInt(cb.dataset.id);
    cb.checked = checked;
    if (checked) {
      selectedRecordIds.add(id);
    } else {
      selectedRecordIds.delete(id);
    }
    const row = cb.closest('tr');
    if (row) row.classList.toggle('row-selected', checked);
  });
  updateBulkToolbar();
}

function updateMasterCheckboxState(currentPageList) {
  const master = document.getElementById('selectAllCheckbox');
  if (!master) return;

  const checkboxes = Array.from(document.querySelectorAll('.record-row-checkbox'));
  if (checkboxes.length === 0) {
    master.checked = false;
    master.indeterminate = false;
    return;
  }
  const checkedCount = checkboxes.filter(cb => cb.checked).length;
  if (checkedCount === checkboxes.length) {
    master.checked = true;
    master.indeterminate = false;
  } else if (checkedCount > 0) {
    master.checked = false;
    master.indeterminate = true;
  } else {
    master.checked = false;
    master.indeterminate = false;
  }
}

function selectAllFilteredRecords() {
  if (!currentFilteredRecords || currentFilteredRecords.length === 0) return;
  currentFilteredRecords.forEach(r => selectedRecordIds.add(r.id));
  renderRecordsTable();
  showToast(`Selected all ${currentFilteredRecords.length} matching records.`, 'info');
}

function deselectAllRecords() {
  selectedRecordIds.clear();
  renderRecordsTable();
  showToast('All records deselected.', 'info');
}

function updateBulkToolbar(filteredList) {
  const toolbar = document.getElementById('bulkActionToolbar');
  const countEl = document.getElementById('bulkSelectedCount');
  const amtEl = document.getElementById('bulkSelectedAmount');
  const totalFilteredEl = document.getElementById('bulkTotalFilteredCount');
  const deleteBtn = document.getElementById('bulkDeleteBtn');
  const deleteBtnText = document.getElementById('bulkDeleteBtnText');
  if (!toolbar) return;

  if (filteredList) currentFilteredRecords = filteredList;
  if (totalFilteredEl) totalFilteredEl.innerText = currentFilteredRecords.length.toString();

  const count = selectedRecordIds.size;
  if (count === 0) {
    toolbar.style.display = 'none';
    return;
  }

  toolbar.style.display = 'flex';
  if (countEl) countEl.innerText = `${count} record${count > 1 ? 's' : ''} selected`;

  let sumIncome = 0;
  let sumExpense = 0;
  records.forEach(r => {
    if (selectedRecordIds.has(r.id)) {
      if (r.type === 'Income') sumIncome += r.amount;
      else if (r.type === 'Expense') sumExpense += r.amount;
    }
  });

  const netImpact = sumIncome - sumExpense;
  if (amtEl) {
    amtEl.innerHTML = `Net: <b style="color:${netImpact >= 0 ? '#10b981' : '#f43f5e'}">${formatCurrency(netImpact)}</b>`;
  }

  if (deleteBtnText) deleteBtnText.innerText = `Delete Selected (${count})`;

  const canDelete = currentUser && currentUser.role !== 'viewer';
  if (deleteBtn) {
    deleteBtn.style.display = canDelete ? 'inline-flex' : 'none';
  }
}

function confirmBulkDelete() {
  const canDelete = currentUser && currentUser.role !== 'viewer';
  if (!canDelete) {
    showToast('View-only accounts cannot delete records.', 'error');
    return;
  }

  const count = selectedRecordIds.size;
  if (count === 0) {
    showToast('No records selected.', 'info');
    return;
  }

  let totalInc = 0, totalExp = 0, incCount = 0, expCount = 0;
  records.forEach(r => {
    if (selectedRecordIds.has(r.id)) {
      if (r.type === 'Income') { totalInc += r.amount; incCount++; }
      else if (r.type === 'Expense') { totalExp += r.amount; expCount++; }
    }
  });

  const detailsHtml = `
    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 14px;text-align:left;font-size:13px;display:flex;flex-direction:column;gap:6px;">
      <div class="confirm-preview-row"><span class="confirm-preview-label">Selected to Delete:</span><span class="confirm-preview-val" style="color:#dc2626;font-size:15px;font-weight:800;">${count} records</span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Income Records (${incCount}):</span><span class="confirm-preview-val" style="color:#059669;font-weight:700;">+ ${formatCurrency(totalInc)}</span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Expense Records (${expCount}):</span><span class="confirm-preview-val" style="color:#dc2626;font-weight:700;">- ${formatCurrency(totalExp)}</span></div>
    </div>
  `;

  openConfirmModal({
    title: `Delete ${count} Selected Records?`,
    message: `Are you sure you want to permanently delete these <b>${count} financial records</b>? This action cannot be undone and will immediately recalculate your company Profit &amp; Loss totals across all devices.`,
    detailsHtml: detailsHtml,
    actionText: `Yes, Delete ${count} Records`,
    actionClass: 'btn-danger',
    cancelText: 'Cancel / Keep',
    onConfirm: () => {
      const deletedCount = selectedRecordIds.size;
      const idsToDelete = Array.from(selectedRecordIds);
      idsToDelete.forEach(id => {
        if (!deletedRecordIds.includes(id)) {
          deletedRecordIds.push(id);
        }
      });
      saveDeletedRecordIds();
      records = records.filter(r => !selectedRecordIds.has(r.id));
      selectedRecordIds.clear();
      saveRecords(`Deleted ${deletedCount} records`, true);
      populateCategoryFilter();
      showToast(`Permanently deleted ${deletedCount} record${deletedCount > 1 ? 's' : ''}.`, 'info');
      navigateTo(activePage);
    }
  });
}

function buildPagination(totalPages) {
  const container = document.getElementById('pagination');
  if (!container) return;
  let html = `<button class="page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>&#8249;</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages <= 7 || i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1)
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    else if (Math.abs(i - currentPage) === 2)
      html += `<span style="color:#94a3b8;padding:0 4px;">&#8230;</span>`;
  }
  html += `<button class="page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>&#8250;</button>`;
  container.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  renderRecordsTable();
}

function escapeHtml(str) {
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}

// ══════════════════════════════════════════════════
//  REPORTS PAGE (FINAL ACCOUNTS) WITH DRILLDOWN
// ══════════════════════════════════════════════════
function renderReports() {
  const repYear = document.getElementById('reportYearFilter')?.value || 'ALL';
  const targetRecs = records.filter(r => {
    if (!r.date) return false;
    if (repYear === 'ALL') return true;
    return r.date.substring(0, 4) === repYear;
  });

  renderPLAccount(targetRecs);
  renderBalanceSheet(targetRecs);
  renderMonthlySummary(targetRecs);
}

function renderPLAccount(recs) {
  const revByCat = {};
  const expByCat = {};

  recs.forEach(r => {
    if (r.type === 'Income') {
      if (r.category !== 'Opening Capital / Owner Capital') {
        revByCat[r.category] = (revByCat[r.category] || 0) + r.amount;
      }
    } else if (r.type === 'Expense') {
      // Loan Payment is counted directly as an expense
      expByCat[r.category] = (expByCat[r.category] || 0) + r.amount;
    }
  });

  const totalRev = Object.values(revByCat).reduce((a, b) => a + b, 0);
  const totalExp = Object.values(expByCat).reduce((a, b) => a + b, 0);
  const netProfit = totalRev - totalExp;

  const plDr = document.getElementById('plDrRows');
  if (plDr) {
    let html = '';
    if (Object.keys(expByCat).length === 0) {
      html = '<div class="fa-row"><span class="fa-row-muted">No expenses recorded</span><span>&#x20B9;0.00</span></div>';
    } else {
      html += Object.entries(expByCat).sort((a, b) => b[1] - a[1])
        .map(([c, a]) => {
          const isLoan = c === 'Loan Payment';
          return `<div class="fa-row fa-row-clickable ${isLoan ? 'fa-row-loan' : ''}" onclick="openFinalAccountDrilldown('${escapeHtml(c)}', 'Expense')" title="Click to view all ${escapeHtml(c)} records">
            <span>${c}</span>
            <span style="color:#e11d48;">${formatCurrency(a)}</span>
          </div>`;
        }).join('');
    }
    if (netProfit >= 0) {
      html += `<div class="fa-row fa-row-clickable fa-row-profit" onclick="openScorecardDrilldown('profit')" title="Click to view Net Profit records">
        <span>Net Profit c/d</span>
        <span>${formatCurrency(netProfit)}</span>
      </div>`;
    }
    plDr.innerHTML = html;
  }

  const plCr = document.getElementById('plCrRows');
  if (plCr) {
    let html = '';
    if (Object.keys(revByCat).length === 0) {
      html = '<div class="fa-row"><span class="fa-row-muted">No income recorded</span><span>&#x20B9;0.00</span></div>';
    } else {
      html += Object.entries(revByCat).sort((a, b) => b[1] - a[1])
        .map(([c, a]) => {
          let badge = getCategoryBadgeHtml(c);
          return `<div class="fa-row fa-row-clickable" onclick="openFinalAccountDrilldown('${escapeHtml(c)}', 'Income')" title="Click to view all ${escapeHtml(c)} records">
            <span>${badge}</span>
            <span style="color:#059669;font-weight:700;">${formatCurrency(a)}</span>
          </div>`;
        }).join('');
    }
    if (netProfit < 0) {
      html += `<div class="fa-row fa-row-clickable fa-row-loss" onclick="openScorecardDrilldown('profit')" title="Click to view Loss breakdown">
        <span>Net Loss c/d</span>
        <span>${formatCurrency(Math.abs(netProfit))}</span>
      </div>`;
    }
    plCr.innerHTML = html;
  }

  const grandTotal = Math.max(totalRev, totalExp + (netProfit >= 0 ? netProfit : 0));
  setText('plDrTotal', formatCurrency(grandTotal));
  setText('plCrTotal', formatCurrency(grandTotal));
  setText('plNetResult', (netProfit >= 0 ? 'Net Profit: ' : 'Net Loss: ') + formatCurrency(netProfit));
  const netEl = document.getElementById('plNetResult');
  if (netEl) netEl.style.color = netProfit >= 0 ? '#059669' : '#dc2626';
}

function renderBalanceSheet(recs) {
  const f = calcFinancials(recs);

  const assetByCat = {};
  recs.forEach(r => { if (r.type === 'Asset') assetByCat[r.category] = (assetByCat[r.category] || 0) + r.amount; });
  const totalFixedAssets = Object.values(assetByCat).reduce((a, b) => a + b, 0);

  const loanOutstanding = Math.max(0, f.loanOutstanding);
  const cashOnHand = Math.max(0, f.cashOnHand);
  const bankBalance = Math.max(0, f.bankBalance);
  const totalCurrentAssets = cashOnHand + bankBalance;
  const totalAssetsAll = totalFixedAssets + totalCurrentAssets;
  const initialCap = f.openingCapital > 0 ? f.openingCapital : Math.max(0, totalAssetsAll - loanOutstanding - f.netProfit);

  const bsAssets = document.getElementById('bsAssetRows');
  if (bsAssets) {
    let html = '<div class="fa-section-title">Fixed Assets</div>';
    if (Object.keys(assetByCat).length === 0) {
      html += '<div class="fa-row"><span class="fa-row-muted">No fixed assets recorded</span><span>&#x20B9;0.00</span></div>';
    } else {
      html += Object.entries(assetByCat).sort((a, b) => b[1] - a[1])
        .map(([c, a]) => `<div class="fa-row fa-row-clickable" onclick="openFinalAccountDrilldown('${escapeHtml(c)}', 'Asset')" title="Click to view all ${escapeHtml(c)} items">
          <span>${c}</span>
          <span>${formatCurrency(a)}</span>
        </div>`).join('');
    }
    html += `<div class="fa-subtotal fa-row-clickable" onclick="openScorecardDrilldown('asset')"><span>Total Fixed Assets</span><span>${formatCurrency(totalFixedAssets)}</span></div>`;
    html += '<div class="fa-section-title" style="margin-top:14px;">Current Assets</div>';
    html += `<div class="fa-row fa-row-clickable" onclick="openScorecardDrilldown('cash')" title="Click to view Cash on Hand records">
      <span>Cash on Hand</span>
      <span>${formatCurrency(cashOnHand)}</span>
    </div>`;
    html += `<div class="fa-row fa-row-clickable" onclick="openScorecardDrilldown('bank')" title="Click to view Bank/UPI records">
      <span>Bank Balance</span>
      <span>${formatCurrency(bankBalance)}</span>
    </div>`;
    html += `<div class="fa-subtotal"><span>Total Current Assets</span><span>${formatCurrency(totalCurrentAssets)}</span></div>`;
    bsAssets.innerHTML = html;
  }

  const bsLiab = document.getElementById('bsLiabRows');
  if (bsLiab) {
    let html = '<div class="fa-section-title">Capital &amp; Reserves</div>';
    html += `<div class="fa-row fa-row-clickable" onclick="openFinalAccountDrilldown('Opening Capital / Owner Capital', 'Income')" title="Click to view Capital records">
      <span>Opening Capital</span>
      <span>${formatCurrency(initialCap)}</span>
    </div>`;
    html += `<div class="fa-row fa-row-clickable" onclick="openScorecardDrilldown('profit')" title="Click to view Net Profit/Loss details">
      <span>Net Profit / (Loss)</span>
      <span style="color:${f.netProfit >= 0 ? '#059669' : '#dc2626'}">${formatCurrency(f.netProfit)}</span>
    </div>`;
    html += `<div class="fa-subtotal"><span>Total Capital</span><span>${formatCurrency(initialCap + f.netProfit)}</span></div>`;

    html += '<div class="fa-section-title" style="margin-top:14px;">Loan Liabilities</div>';
    if (loanOutstanding === 0) {
      html += '<div class="fa-row"><span class="fa-row-muted">No outstanding debt</span><span>&#x20B9;0.00</span></div>';
    } else {
      const loansByCred = {};
      recs.filter(r => r.type === 'Income' && r.category === 'Loan Received')
        .forEach(r => { loansByCred[r.description] = (loansByCred[r.description] || 0) + r.amount; });
      html += Object.entries(loansByCred)
        .map(([desc, amt]) => `<div class="fa-row fa-row-clickable" onclick="openScorecardDrilldown('loan')" title="Click to view Loan details">
          <span>${escapeHtml(desc)}</span>
          <span>${formatCurrency(amt)}</span>
        </div>`).join('');
      if (f.loanPayments > 0) {
        html += `<div class="fa-row fa-row-clickable" style="color:#059669" onclick="openScorecardDrilldown('loan')">
          <span>&nbsp;&nbsp;Less: Repayments</span>
          <span>- ${formatCurrency(f.loanPayments)}</span>
        </div>`;
      }
    }
    html += `<div class="fa-subtotal fa-row-clickable" onclick="openScorecardDrilldown('loan')"><span>Total Loan Outstanding</span><span>${formatCurrency(loanOutstanding)}</span></div>`;
    bsLiab.innerHTML = html;
  }

  setText('bsAssetTotal', formatCurrency(totalAssetsAll));
  setText('bsLiabTotal', formatCurrency(totalAssetsAll));
}

function renderMonthlySummary(recs) {
  const tbody = document.getElementById('monthlySummaryBody');
  if (!tbody) return;
  const monthly = {};
  recs.forEach(r => {
    if (r.type === 'Transfer' || r.type === 'Asset') return;
    const m = r.date.substring(0, 7);
    if (!monthly[m]) monthly[m] = { income: 0, expense: 0 };
    if (r.type === 'Income') monthly[m].income += r.amount;
    else if (r.type === 'Expense') monthly[m].expense += r.amount;
  });
  const months = Object.keys(monthly).sort();
  if (months.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#94a3b8;">No records available for the selected period.</td></tr>';
    return;
  }
  tbody.innerHTML = months.map(m => {
    const d = monthly[m];
    const net = d.income - d.expense;
    const pct = d.income > 0 ? ((net / d.income) * 100).toFixed(1) : '0.0';
    return `<tr onclick="openMonthDrilldown('${m}')" title="Click to view all records for ${getMonthFullLabel(m)}">
      <td style="font-weight:700;">${getMonthFullLabel(m)}</td>
      <td class="amount-positive">${formatCurrency(d.income)}</td>
      <td class="amount-negative">${formatCurrency(d.expense)}</td>
      <td style="font-weight:800;color:${net >= 0 ? '#059669' : '#dc2626'};">${formatCurrency(net)}</td>
      <td><span class="badge ${net >= 0 ? 'badge-income' : 'badge-expense'}">${pct}%</span></td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════
//  MODALS, BRAND SELECTION & EVENTS
// ══════════════════════════════════════════════════
function openModal(id = null) {
  editingId = id;
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('modalTitle');
  const submitBtn = document.getElementById('submitBtn');
  const form = document.getElementById('recordForm');
  const deleteBtn = document.getElementById('modalDeleteRecordBtn');
  if (!overlay || !form) return;
  form.reset();

  const partyInput = document.getElementById('recordPartyName');
  if (partyInput) partyInput.value = '';

  const canDelete = currentUser && currentUser.role !== 'viewer';

  if (id) {
    title.textContent = 'Edit Record';
    submitBtn.textContent = 'Save Changes';
    if (deleteBtn) {
      if (canDelete) {
        deleteBtn.style.display = 'inline-flex';
        deleteBtn.onclick = () => {
          const idToDelete = editingId;
          closeModal();
          deleteRecord(idToDelete);
        };
      } else {
        deleteBtn.style.display = 'none';
        deleteBtn.onclick = null;
      }
    }
    const rec = records.find(r => r.id === id);
    if (rec) {
      document.getElementById('recordDate').value = rec.date;
      document.getElementById('recordDescription').value = rec.description;
      document.getElementById('recordType').value = rec.type;
      updateModalCategories(rec.type);
      document.getElementById('recordCategory').value = rec.category;
      document.getElementById('recordAmount').value = rec.amount;
      if (rec.paymentMethod) {
        const radios = document.querySelectorAll('input[name="paymentMethod"]');
        radios.forEach(r => { if (r.value === rec.paymentMethod) r.checked = true; });
      }
      if (partyInput && rec.partyName) {
        partyInput.value = rec.partyName;
      }
      handleModalCategoryChange(rec.category);
    }
  } else {
    title.textContent = 'Add New Record';
    submitBtn.textContent = 'Add Record';
    if (deleteBtn) {
      deleteBtn.style.display = 'none';
      deleteBtn.onclick = null;
    }
    document.getElementById('recordDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('recordType').value = 'Income';
    updateModalCategories('Income');
    handleModalCategoryChange('');
  }
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('recordDescription').focus(), 150);
}

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) { overlay.classList.remove('active'); overlay.setAttribute('aria-hidden', 'true'); }
  const deleteBtn = document.getElementById('modalDeleteRecordBtn');
  if (deleteBtn) {
    deleteBtn.style.display = 'none';
    deleteBtn.onclick = null;
  }
  editingId = null;
  handleModalCategoryChange('');
}

function handleModalTypeChange(type) {
  updateModalCategories(type);
  const channelSection = document.getElementById('modalIncomeChannelSection');
  if (channelSection) {
    channelSection.style.display = (type === 'Income') ? 'block' : 'none';
  }
  handleModalCategoryChange('');
}

function selectModalCategory(catName) {
  document.getElementById('recordType').value = 'Income';
  updateModalCategories('Income');
  const catSelect = document.getElementById('recordCategory');
  if (catSelect) catSelect.value = catName;

  const descInput = document.getElementById('recordDescription');
  if (descInput && !descInput.value) {
    descInput.value = (catName === 'Amazon') ? 'Amazon Marketplace Payout' : 'Flipkart Hub Sales Payout';
  }

  // Auto-select Online/UPI for Amazon and Flipkart marketplace income
  const upiRadio = document.querySelector('input[name="paymentMethod"][value="Online/UPI"]');
  if (upiRadio) upiRadio.checked = true;

  handleModalCategoryChange(catName);
}

function handlePartyNameInput(val) {
  const descInput = document.getElementById('recordDescription');
  const cat = document.getElementById('recordCategory')?.value;
  if (descInput && (!descInput.value || descInput.value.startsWith('Product Purchase from') || descInput.value.startsWith('Vendor Payment to') || descInput.value.startsWith('Expense for') || descInput.value.startsWith('Payment to') || descInput.value.startsWith('Staff Upad to') || descInput.value.startsWith('Income from'))) {
    if (val.trim()) {
      if (cat === 'Vendor / Supplier Payment') {
        descInput.value = `Vendor Payment to ${val.trim()}`;
      } else if (cat === 'Other Expense') {
        descInput.value = `Expense for ${val.trim()}`;
      } else if (cat === 'Staff Upad / Advance') {
        descInput.value = `Staff Upad to ${val.trim()}`;
      } else if (cat === 'Other Income') {
        descInput.value = `Income from ${val.trim()}`;
      } else {
        descInput.value = `Product Purchase from ${val.trim()}`;
      }
    }
  }
}

function handleModalCategoryChange(cat) {
  const banner = document.getElementById('modalBrandBanner');
  const chipAmz = document.getElementById('chipAmazon');
  const chipFlp = document.getElementById('chipFlipkart');
  const partyGroup = document.getElementById('partyNameGroup');
  const partyLabel = document.getElementById('partyNameLabelTitle');
  const partyHint = document.getElementById('partyNameHint');
  const partyInput = document.getElementById('recordPartyName');
  const type = document.getElementById('recordType')?.value || 'Income';

  if (chipAmz) chipAmz.classList.toggle('active-amazon', cat === 'Amazon');
  if (chipFlp) chipFlp.classList.toggle('active-flipkart', cat === 'Flipkart');

  // Auto-select Online/UPI when Amazon or Flipkart is chosen
  if (cat === 'Amazon' || cat === 'Flipkart') {
    const upiRadio = document.querySelector('input[name="paymentMethod"][value="Online/UPI"]');
    if (upiRadio) upiRadio.checked = true;
  }

  if (partyGroup) {
    // Show Party / Supplier / Vendor field for ALL Expense categories, plus Asset and Other Income / Loan
    const isPartyRelevant = (type === 'Expense') || (type === 'Asset') || (cat === 'Other Income') || (cat === 'Product Purchase / Inventory') || (cat === 'Vendor / Supplier Payment') || (cat === 'Loan Received');
    partyGroup.style.display = isPartyRelevant ? 'block' : 'none';

    if (partyLabel && partyHint && partyInput) {
      if (cat === 'Staff Upad / Advance' || cat === 'Salaries & Wages') {
        partyLabel.innerHTML = 'Staff / Employee Name';
        partyHint.innerText = '(Who received the salary/advance?)';
        partyInput.placeholder = 'e.g. Ramesh Kumar, Sunita Verma, Staff Member';
      } else if (cat === 'Rent & Lease') {
        partyLabel.innerHTML = 'Landlord / Property Owner / Agency';
        partyHint.innerText = '(Who did you pay rent to?)';
        partyInput.placeholder = 'e.g. Landmark Realty, Landlord Name, Commercial Hub';
      } else if (cat === 'Utilities') {
        partyLabel.innerHTML = 'Utility Provider / Company';
        partyHint.innerText = '(e.g. Electricity Board, Gas Co, Internet)';
        partyInput.placeholder = 'e.g. Adani Electricity, Torrent Power, Airtel Broadband';
      } else if (cat === 'Marketing') {
        partyLabel.innerHTML = 'Marketing Agency / Platform / Vendor';
        partyHint.innerText = '(e.g. Meta Ads, Google, Influencer Agency)';
        partyInput.placeholder = 'e.g. Google Ads, Meta Facebook, Growth Media Agency';
      } else if (cat === 'Packaging & Shipping') {
        partyLabel.innerHTML = 'Courier / Logistics / Box Supplier';
        partyHint.innerText = '(e.g. Shiprocket, Delhivery, Box Manufacturer)';
        partyInput.placeholder = 'e.g. Delhivery, Shiprocket, Packman Box Suppliers';
      } else if (cat === 'Loan Payment' || cat === 'Loan Received') {
        partyLabel.innerHTML = 'Bank / Lender / Financier';
        partyHint.innerText = '(Bank or lender party name)';
        partyInput.placeholder = 'e.g. HDFC Bank, Bajaj Finance, Private Lender';
      } else if (cat === 'Insurance') {
        partyLabel.innerHTML = 'Insurance Provider / Company';
        partyHint.innerText = '(e.g. ICICI Lombard, HDFC ERGO, Star Health)';
        partyInput.placeholder = 'e.g. ICICI Lombard, HDFC ERGO, Insurance Broker';
      } else if (cat === 'Professional Services') {
        partyLabel.innerHTML = 'CA / Legal / Consultant Firm';
        partyHint.innerText = '(Consultant or agency name)';
        partyInput.placeholder = 'e.g. Sharma & Associates CA, Legal Consultants';
      } else if (cat === 'Office Supplies') {
        partyLabel.innerHTML = 'Stationery / Vendor / Shop';
        partyHint.innerText = '(Store or supplier name)';
        partyInput.placeholder = 'e.g. Reliance Digital, Local Stationery Mart';
      } else if (cat === 'Other Income') {
        partyLabel.innerHTML = 'Company / Client Name';
        partyHint.innerText = '(From which company/client?)';
        partyInput.placeholder = 'e.g. Client Corp, Affiliate Partner';
      } else {
        partyLabel.innerHTML = 'Party Name / Supplier / Vendor';
        partyHint.innerText = '(Company, vendor, or supplier name)';
        partyInput.placeholder = 'e.g. ABC Textiles, Super Traders, Shri Ram Fabrics, Vendor Name';
      }
    }
  }

  if (!banner) return;

  if (cat === 'Amazon') {
    banner.className = 'brand-live-banner brand-amazon';
    banner.innerHTML = `${getAmazonSvg(24)} <div><b>Amazon Marketplace Channel</b><div style="font-size:12px;opacity:0.85;">Selected for direct seller payout recording &bull; <b style="color:#2563eb;">Payment: Online/UPI</b></div></div>`;
    banner.style.display = 'flex';
  } else if (cat === 'Flipkart') {
    banner.className = 'brand-live-banner brand-flipkart';
    banner.innerHTML = `${getFlipkartSvg(24)} <div><b>Flipkart Marketplace Channel</b><div style="font-size:12px;opacity:0.85;">Selected for hub sales payout recording &bull; <b style="color:#2563eb;">Payment: Online/UPI</b></div></div>`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
    banner.innerHTML = '';
  }
}

function updateModalCategories(type) {
  const select = document.getElementById('recordCategory');
  const pmRow = document.getElementById('paymentMethodRow');
  const channelSection = document.getElementById('modalIncomeChannelSection');
  if (!select) return;

  let cats = [];
  if (type === 'Income') cats = INCOME_CATEGORIES;
  if (type === 'Expense') cats = EXPENSE_CATEGORIES;
  if (type === 'Asset') cats = ASSET_CATEGORIES;
  if (type === 'Transfer') cats = TRANSFER_CATEGORIES;

  select.innerHTML = '<option value="">Select category</option>' +
    cats.map(c => `<option value="${c}">${c}</option>`).join('');

  if (pmRow) pmRow.style.display = (type === 'Transfer') ? 'none' : 'block';
  if (channelSection) channelSection.style.display = (type === 'Income') ? 'block' : 'none';
}

function handleFormSubmit(e) {
  e.preventDefault();
  const date = document.getElementById('recordDate').value;
  let description = document.getElementById('recordDescription').value.trim();
  const type = document.getElementById('recordType').value;
  const category = document.getElementById('recordCategory').value;
  const amount = parseFloat(document.getElementById('recordAmount').value);
  const checkedPM = document.querySelector('input[name="paymentMethod"]:checked');
  const paymentMethod = (type !== 'Transfer' && checkedPM) ? checkedPM.value : null;
  const partyName = document.getElementById('recordPartyName')?.value.trim() || null;

  if (!date || !description || !type || !category || isNaN(amount) || amount <= 0) {
    showToast('Please fill in all fields correctly.', 'error'); return;
  }
  if (type !== 'Transfer' && !paymentMethod) {
    showToast('Please select a Payment Method (Cash or Online/UPI).', 'error'); return;
  }

  const authorName = currentUser ? currentUser.name : 'Harsh';

  if (editingId) {
    const idx = records.findIndex(r => r.id === editingId);
    if (idx !== -1) {
      const existingCreatedBy = records[idx].createdBy || authorName;
      const existingCreatedAt = records[idx].createdAt || new Date().toISOString();
      records[idx] = { 
        id: editingId, 
        date, 
        description, 
        partyName, 
        type, 
        category, 
        amount, 
        paymentMethod, 
        createdBy: existingCreatedBy, 
        createdAt: existingCreatedAt,
        lastEditedBy: authorName,
        lastEditedAt: new Date().toISOString()
      };
      showToast('Record updated successfully!', 'success');
    }
  } else {
    const newId = Date.now() + Math.floor(Math.random() * 1000);
    records.push({ 
      id: newId, 
      date, 
      description, 
      partyName, 
      type, 
      category, 
      amount, 
      paymentMethod, 
      createdBy: authorName,
      createdAt: new Date().toISOString(),
      lastEditedAt: new Date().toISOString()
    });
    showToast('Record added successfully!', 'success');
  }

  saveRecords();
  closeModal();
  populateCategoryFilter();
  navigateTo(activePage);
}

// ══════════════════════════════════════════════════
//  INTERNAL CONFIRMATION & WARNING MODAL
// ══════════════════════════════════════════════════
let pendingConfirmCallback = null;

function openConfirmModal(options) {
  const overlay = document.getElementById('confirmModalOverlay');
  const titleEl = document.getElementById('confirmModalTitle');
  const msgEl = document.getElementById('confirmModalMessage');
  const detailsEl = document.getElementById('confirmRecordDetails');
  const actionBtn = document.getElementById('confirmActionBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  if (!overlay) return;

  if (titleEl) titleEl.innerHTML = options.title || 'Are you sure?';
  if (msgEl) msgEl.innerHTML = options.message || 'This action cannot be undone.';
  
  if (detailsEl) {
    if (options.detailsHtml) {
      detailsEl.innerHTML = options.detailsHtml;
      detailsEl.style.display = 'block';
    } else {
      detailsEl.style.display = 'none';
      detailsEl.innerHTML = '';
    }
  }

  if (actionBtn) {
    actionBtn.innerHTML = options.actionText || 'Yes, Delete';
    actionBtn.className = `btn ${options.actionClass || 'btn-danger'}`;
  }

  if (cancelBtn) {
    cancelBtn.innerHTML = options.cancelText || '✕ Cancel / Keep';
  }

  pendingConfirmCallback = typeof options.onConfirm === 'function' ? options.onConfirm : null;
  overlay.style.display = 'flex';
  overlay.classList.add('active');
}

function closeConfirmModal() {
  const overlay = document.getElementById('confirmModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
  }
  pendingConfirmCallback = null;
}

function deleteRecord(id) {
  const recIdStr = String(id);
  const r = records.find(item => String(item.id) === recIdStr);
  if (!r) {
    showToast('Transaction not found or already deleted.', 'info');
    return;
  }

  const canDelete = currentUser && currentUser.role !== 'viewer';
  if (!canDelete) {
    showToast('View-only accounts cannot delete transactions.', 'error');
    return;
  }

  let descText = escapeHtml(r.description);
  let partyHtml = '';
  if (r.partyName) {
    partyHtml = `<div class="confirm-preview-row"><span class="confirm-preview-label">Party / Vendor:</span><span class="confirm-preview-val"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/></svg>${escapeHtml(r.partyName)}</span></div>`;
  }

  let pmHtml = '';
  if (r.paymentMethod) {
    const pmSvg = r.paymentMethod === 'Cash'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
    pmHtml = `<div class="confirm-preview-row"><span class="confirm-preview-label">Payment Method:</span><span class="confirm-preview-val">${pmSvg}${escapeHtml(r.paymentMethod)}</span></div>`;
  }

  let creatorHtml = '';
  if (r.createdBy) {
    creatorHtml = `<div class="confirm-preview-row"><span class="confirm-preview-label">Created By:</span><span class="confirm-preview-val"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${escapeHtml(r.createdBy)}</span></div>`;
  }

  const amtColor = r.type === 'Income' ? '#059669' : '#dc2626';
  const amtSign = r.type === 'Expense' ? '-' : (r.type === 'Income' ? '+' : '');
  const typeBadge = r.type === 'Income'
    ? '<span style="background:rgba(5,150,105,0.12);color:#059669;padding:2px 8px;border-radius:10px;font-weight:700;font-size:11.5px;">Income</span>'
    : '<span style="background:rgba(220,38,38,0.12);color:#dc2626;padding:2px 8px;border-radius:10px;font-weight:700;font-size:11.5px;">Expense</span>';

  const detailsHtml = `
    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 14px;text-align:left;font-size:13px;display:flex;flex-direction:column;gap:6px;">
      <div class="confirm-preview-row"><span class="confirm-preview-label">Date:</span><span class="confirm-preview-val"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${formatDate(r.date)}</span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Description:</span><span class="confirm-preview-val"><b>${descText}</b></span></div>
      ${partyHtml}
      <div class="confirm-preview-row"><span class="confirm-preview-label">Type &amp; Category:</span><span class="confirm-preview-val">${typeBadge} &bull; <b>${escapeHtml(r.category)}</b></span></div>
      ${pmHtml}
      ${creatorHtml}
      <div class="confirm-preview-row" style="margin-top:4px;padding-top:8px;border-top:1.5px dashed #cbd5e1;"><span class="confirm-preview-label" style="font-size:13px;">Amount:</span><span class="confirm-preview-val" style="color:${amtColor};font-size:18px;font-weight:800;">${amtSign}${formatCurrency(r.amount)}</span></div>
    </div>
  `;

  openConfirmModal({
    title: 'Delete Financial Transaction?',
    message: 'Are you sure you want to permanently delete this transaction? This action cannot be undone and will immediately recalculate your company Profit &amp; Loss totals.',
    detailsHtml: detailsHtml,
    actionText: 'Yes, Delete Transaction',
    actionClass: 'btn-danger',
    cancelText: '✕ Cancel / Keep',
    onConfirm: () => {
      records = records.filter(item => String(item.id) !== recIdStr);
      if (!deletedRecordIds.includes(recIdStr)) {
        deletedRecordIds.push(recIdStr);
        saveDeletedRecordIds();
      }
      saveRecords('Deleted financial transaction', true);
      populateCategoryFilter();
      showToast('Transaction permanently deleted.', 'info');
      navigateTo(activePage);
    }
  });
}

function promptClearAllRecords() {
  if (!records || records.length === 0) {
    showToast('No records to clear. Your financial records are already empty.', 'info');
    return;
  }

  const f = calcFinancials();
  const detailsHtml = `
    <div class="confirm-preview-row"><span class="confirm-preview-label">Total Records to Delete:</span><span class="confirm-preview-val" style="color:#dc2626;font-size:15px;">${records.length} records</span></div>
    <div class="confirm-preview-row"><span class="confirm-preview-label">Total Income:</span><span class="confirm-preview-val" style="color:#059669;">${formatCurrency(f.totalIncome)}</span></div>
    <div class="confirm-preview-row"><span class="confirm-preview-label">Total Expenses:</span><span class="confirm-preview-val" style="color:#e11d48;">${formatCurrency(f.totalExpense)}</span></div>
    <div class="confirm-preview-row"><span class="confirm-preview-label">Net Profit / Balance:</span><span class="confirm-preview-val">${formatCurrency(f.netProfit)}</span></div>
  `;

  openConfirmModal({
    title: '⚠️ Clear ALL Financial Records?',
    message: `You are about to permanently erase all <b>${records.length} records</b> from Lynxora across all connected devices and Cloud Sync.<br><br><span style="color:#b91c1c;font-weight:700;">⚠️ We recommend downloading a CSV backup before clearing. This action CANNOT be undone!</span>`,
    detailsHtml: detailsHtml,
    actionText: 'Yes, Clear All Records',
    actionClass: 'btn-danger',
    onConfirm: () => {
      clearAllFinancialRecords();
    }
  });
}

function clearAllFinancialRecords() {
  // 1. Mark all existing records as deleted
  if (Array.isArray(records)) {
    records.forEach(r => {
      if (r && r.id != null && !deletedRecordIds.includes(r.id)) {
        deletedRecordIds.push(r.id);
      }
    });
  }
  saveDeletedRecordIds();

  // 2. Clear local storage & in-memory records
  records = [];
  localStorage.setItem('lynxora_records', JSON.stringify([]));

  // 3. Broadcast empty records to Cloud with allowEmpty = true
  if (typeof broadcastToCloud === 'function') {
    broadcastToCloud('records', 'Cleared all financial records', true);
  }

  // 4. Update UI & recalculate totals
  populateCategoryFilter();
  refreshAllActiveViews();
  showToast('All financial records have been permanently cleared from all devices.', 'info');
  navigateTo(activePage);
}

function populateCategoryFilter() {
  const select = document.getElementById('categoryFilterSelect');
  if (!select) return;
  const current = categoryFilter;
  const cats = [...new Set(records.map(r => r.category))].sort();
  select.innerHTML = '<option value="All">All Categories</option>' +
    cats.map(c => `<option value="${c}">${c}</option>`).join('');
  categoryFilter = cats.includes(current) ? current : 'All';
  select.value = categoryFilter;
}

function exportToCSV() {
  if (!records.length) { showToast('No records to export.', 'error'); return; }
  const headers = ['Date', 'Description', 'Party Name', 'Type', 'Category', 'Payment Method', 'Amount'];
  const rows = records.map(r => [r.date, `"${r.description}"`, `"${r.partyName || ''}"`, r.type, `"${r.category}"`, r.paymentMethod || '', r.amount].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'lynxora_financial_records.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('CSV export downloaded!', 'success');
}

function importCSV(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const lines = e.target.result.split('\n').filter(l => l.trim());
      if (lines.length < 2) { showToast('CSV file is empty.', 'error'); return; }
      const maxId = records.length > 0 ? Math.max(...records.map(r => r.id)) : 0;
      const newRecords = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].match(/(".*?"|[^,]+)/g);
        if (!cols || cols.length < 5) continue;
        const date = cols[0].replace(/"/g, '').trim();
        const description = cols[1].replace(/"/g, '').trim();
        const type = cols[2].replace(/"/g, '').trim();
        const category = cols[3].replace(/"/g, '').trim();
        const pm = cols.length >= 6 ? cols[4].replace(/"/g, '').trim() : 'Cash';
        const amount = parseFloat((cols[cols.length - 1]).replace(/"/g, '').trim());
        if (date && description && ['Income', 'Expense', 'Asset', 'Transfer'].includes(type) && category && !isNaN(amount))
          newRecords.push({ id: maxId + i, date, description, type, category, paymentMethod: pm || null, amount });
      }
      if (!newRecords.length) { showToast('No valid records found in CSV.', 'error'); return; }
      records = [...records, ...newRecords];
      saveRecords();
      populateCategoryFilter();
      showToast(`${newRecords.length} records imported successfully!`, 'success');
      navigateTo(activePage);
    } catch { showToast('Error reading CSV file.', 'error'); }
  };
  reader.readAsText(file);
}

function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { success: '&#10003;', error: '&#10005;', info: '&#8505;' };
  toast.innerHTML = `<span>${icons[type] || '&#8226;'}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function debounce(fn, delay) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); };
}

function attachEventListeners() {
  document.querySelectorAll('.nav-item').forEach(item =>
    item.addEventListener('click', e => { e.preventDefault(); if (item.dataset.page) navigateTo(item.dataset.page); })
  );

  const hamburger = document.getElementById('hamburgerBtn');
  const sidebar = document.getElementById('sidebar');
  const sidebarOv = document.getElementById('sidebarOverlay');
  if (hamburger) hamburger.addEventListener('click', () => { sidebar.classList.toggle('open'); if (sidebarOv) sidebarOv.classList.toggle('active'); });
  if (sidebarOv) sidebarOv.addEventListener('click', () => { sidebar.classList.remove('open'); sidebarOv.classList.remove('active'); });

  // Dashboard
  const printBtn = document.getElementById('printBtn');
  const dashAddBtn = document.getElementById('dashAddRecordBtn');
  if (printBtn) printBtn.addEventListener('click', () => window.print());
  if (dashAddBtn) dashAddBtn.addEventListener('click', () => openModal());

  // Records
  const addBtn = document.getElementById('addRecordBtn');
  const exportBtn = document.getElementById('exportBtn');
  if (addBtn) addBtn.addEventListener('click', () => openModal());
  if (exportBtn) exportBtn.addEventListener('click', exportToCSV);

  // Modal
  const closeBtn = document.getElementById('modalCloseBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const modalOv = document.getElementById('modalOverlay');
  const form = document.getElementById('recordForm');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  if (modalOv) modalOv.addEventListener('click', e => { if (e.target === modalOv) closeModal(); });
  if (form) form.addEventListener('submit', handleFormSubmit);

  // Filters
  const searchInput = document.getElementById('searchInput');
  const typeFilterEl = document.getElementById('typeFilterSelect');
  const catFilterEl = document.getElementById('categoryFilterSelect');
  const payFilterEl = document.getElementById('paymentFilterSelect');
  if (searchInput) searchInput.addEventListener('input', debounce(e => { searchQuery = e.target.value; currentPage = 1; renderRecordsTable(); }, 300));
  if (typeFilterEl) typeFilterEl.addEventListener('change', e => { typeFilter = e.target.value; currentPage = 1; renderRecordsTable(); });
  if (catFilterEl) catFilterEl.addEventListener('change', e => { categoryFilter = e.target.value; currentPage = 1; renderRecordsTable(); });
  if (payFilterEl) payFilterEl.addEventListener('change', e => { paymentFilter = e.target.value; currentPage = 1; renderRecordsTable(); });

  // Reports
  const printRptBtn = document.getElementById('printReportBtn');
  const exportRptBtn = document.getElementById('exportReportBtn');
  if (printRptBtn) printRptBtn.addEventListener('click', () => window.print());
  if (exportRptBtn) exportRptBtn.addEventListener('click', exportToCSV);

  // Settings
  const saveCompanyBtn = document.getElementById('saveCompanyBtn');
  const clearAllBtn = document.getElementById('clearAllDataBtn');
  const settingsExport = document.getElementById('settingsExportBtn');
  const importInput = document.getElementById('importCsvInput');
  if (saveCompanyBtn) saveCompanyBtn.addEventListener('click', () => {
    const name = document.getElementById('companyName')?.value.trim();
    const fy = document.getElementById('financialYear')?.value.trim();
    const gstin = document.getElementById('companyGstin')?.value.trim().toUpperCase();
    const state = document.getElementById('companyState')?.value || 'Gujarat';
    const phone = document.getElementById('companyPhone')?.value.trim();
    const email = document.getElementById('companyEmail')?.value.trim();
    const address = document.getElementById('companyAddress')?.value.trim();
    const bankName = document.getElementById('companyBankName')?.value.trim();
    const bankAccount = document.getElementById('companyBankAccount')?.value.trim();
    const bankIfsc = document.getElementById('companyBankIfsc')?.value.trim().toUpperCase();
    const upiId = document.getElementById('companyUpiId')?.value.trim();

    if (name) localStorage.setItem('lynxora_company', name);
    if (fy) localStorage.setItem('financialYear', fy);
    if (gstin) localStorage.setItem('lynxora_company_gstin', gstin);
    if (state) localStorage.setItem('lynxora_company_state', state);
    if (phone) localStorage.setItem('lynxora_company_phone', phone);
    if (email) localStorage.setItem('lynxora_company_email', email);
    if (address) localStorage.setItem('lynxora_company_address', address);
    if (bankName) localStorage.setItem('lynxora_bank_name', bankName);
    if (bankAccount) localStorage.setItem('lynxora_bank_account', bankAccount);
    if (bankIfsc) localStorage.setItem('lynxora_bank_ifsc', bankIfsc);
    if (upiId) localStorage.setItem('lynxora_bank_upi', upiId);

    showToast('Company profile & bank details saved! ✓', 'success');
  });
  if (clearAllBtn) clearAllBtn.addEventListener('click', promptClearAllRecords);

  const confirmActionBtn = document.getElementById('confirmActionBtn');
  if (confirmActionBtn) {
    confirmActionBtn.addEventListener('click', () => {
      if (typeof pendingConfirmCallback === 'function') {
        pendingConfirmCallback();
      }
      closeConfirmModal();
    });
  }

  const confirmOverlay = document.getElementById('confirmModalOverlay');
  if (confirmOverlay) {
    confirmOverlay.addEventListener('click', e => {
      if (e.target === confirmOverlay) closeConfirmModal();
    });
  }

  if (settingsExport) settingsExport.addEventListener('click', exportToCSV);
  if (importInput) importInput.addEventListener('change', e => { if (e.target.files.length > 0) { importCSV(e.target.files[0]); e.target.value = ''; } });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      closeDrilldownModal();
      closeConfirmModal();
      closeStockAdjustModal();
      closeTaxInvoiceModal();
      closeGenerateInvoiceModal();
      closeInvoicesManagerModal();
    }
  });

  const savedCompany = localStorage.getItem('lynxora_company') || localStorage.getItem('livvoracart_company') || localStorage.getItem('financepro_company');
  const savedFY = localStorage.getItem('financialYear');
  if (savedCompany) {
    const el = document.getElementById('companyName');
    if (el) el.value = savedCompany;
  }
  if (savedFY) {
    const el = document.getElementById('financialYear');
    if (el) el.value = savedFY;
  }
  const savedGstin = localStorage.getItem('lynxora_company_gstin');
  if (savedGstin) {
    const el = document.getElementById('companyGstin');
    if (el) el.value = savedGstin;
  }
  const savedState = localStorage.getItem('lynxora_company_state');
  if (savedState) {
    const el = document.getElementById('companyState');
    if (el) el.value = savedState;
  }
  const savedPhone = localStorage.getItem('lynxora_company_phone');
  if (savedPhone) {
    const el = document.getElementById('companyPhone');
    if (el) el.value = savedPhone;
  }
  const savedEmail = localStorage.getItem('lynxora_company_email');
  if (savedEmail) {
    const el = document.getElementById('companyEmail');
    if (el) el.value = savedEmail;
  }
  const savedAddr = localStorage.getItem('lynxora_company_address');
  if (savedAddr) {
    const el = document.getElementById('companyAddress');
    if (el) el.value = savedAddr;
  }
  const savedBank = localStorage.getItem('lynxora_bank_name');
  if (savedBank) {
    const el = document.getElementById('companyBankName');
    if (el) el.value = savedBank;
  }
  const savedAcc = localStorage.getItem('lynxora_bank_account');
  if (savedAcc) {
    const el = document.getElementById('companyBankAccount');
    if (el) el.value = savedAcc;
  }
  const savedIfsc = localStorage.getItem('lynxora_bank_ifsc');
  if (savedIfsc) {
    const el = document.getElementById('companyBankIfsc');
    if (el) el.value = savedIfsc;
  }
  const savedUpi = localStorage.getItem('lynxora_bank_upi');
  if (savedUpi) {
    const el = document.getElementById('companyUpiId');
    if (el) el.value = savedUpi;
  }

  const savedLogo = localStorage.getItem('lynxora_company_logo');
  const logoPrev = document.getElementById('settingsLogoPreview');
  if (logoPrev) logoPrev.src = savedLogo || 'logo.png';

  const savedSig = localStorage.getItem('lynxora_company_signature');
  const sigPrev = document.getElementById('settingsSignaturePreview');
  const sigPlace = document.getElementById('settingsSignaturePlaceholder');
  const sigRemBtn = document.getElementById('removeSignatureBtn');
  if (savedSig) {
    if (sigPrev) { sigPrev.src = savedSig; sigPrev.style.display = 'block'; }
    if (sigPlace) sigPlace.style.display = 'none';
    if (sigRemBtn) sigRemBtn.style.display = 'inline-block';
  }

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLoginSubmit);
  }
}

// ══════════════════════════════════════════════════
//  APP INSTALLATION & LAUNCHER HELPERS
// ══════════════════════════════════════════════════
function handleSettingsInstall() {
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    showToast('Lynxora is already installed and running as an app!', 'info');
    return;
  }
  if (typeof deferredInstallPrompt !== 'undefined' && deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(result => {
      if (result.outcome === 'accepted') {
        showToast('Lynxora installed successfully!', 'success');
      }
    });
  } else {
    // Show helpful modal or toast based on platform
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /Android/.test(navigator.userAgent);
    if (isIOS) {
      alert('To install on iPhone/iPad:\n1. Tap the Safari Share button at bottom\n2. Select "Add to Home Screen"\n3. Tap Add!');
    } else if (isAndroid) {
      alert('To install on Android:\n1. Tap the 3-dot menu (⋮) in Chrome\n2. Select "Install app" or "Add to Home screen"');
    } else {
      alert('To install on Laptop/Desktop:\n1. Click the Install icon in your browser address bar at the top right\nOR\n2. Click "Download Windows Desktop Launcher" below.');
    }
  }
}

function downloadDesktopLauncher() {
  const batContent = '@echo off\r\ntitle Lynxora Financial Suite\r\necho Starting Lynxora...\r\nstart msedge --app="%~dp0index.html" || start chrome --app="%~dp0index.html" || start "" "%~dp0index.html"\r\n';
  const blob = new Blob([batContent], { type: 'application/x-bat' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Lynxora-Launcher.bat';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded Lynxora-Launcher.bat! Move to your app folder & double click to run.', 'success');
}

// ══════════════════════════════════════════════════
//  PARTNER SHARING & CLOUD SYNC
// ══════════════════════════════════════════════════
// (firestoreDb, cloudUnsubscribe, isSyncingFromCloud declared at top)

function shareViaWhatsApp() {
  const f = calcFinancials();
  const company = localStorage.getItem('lynxora_company') || 'Lynxora';
  const fy = localStorage.getItem('financialYear') || '2026-2027';
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const msg = 
`*Lynxora Financial Snapshot*
*Company:* ${company} (FY ${fy})
*Date:* ${today}
━━━━━━━━━━━━━━━━━━
*Total Income:* ${formatCurrency(f.totalIncome)}
*Total Expenses:* ${formatCurrency(f.totalExpense)}
*Net Profit:* ${formatCurrency(f.netProfit)}
━━━━━━━━━━━━━━━━━━
*Cash on Hand:* ${formatCurrency(f.cashOnHand)}
*Bank Balance:* ${formatCurrency(f.bankBalance)}
*Loan Outstanding:* ${formatCurrency(f.loanOutstanding)}
━━━━━━━━━━━━━━━━━━
*Total Records:* ${records.length}
*Lynxora Financial Suite*`;

  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
  window.open(waUrl, '_blank');
}

function exportLynxoraPackage() {
  const company = localStorage.getItem('lynxora_company') || 'Lynxora';
  const fy = localStorage.getItem('financialYear') || '2026-2027';
  const data = {
    app: 'Lynxora',
    version: '2.0',
    companyName: company,
    financialYear: fy,
    exportDate: new Date().toISOString(),
    recordCount: records.length,
    records: records
  };

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${company.toLowerCase().replace(/\s+/g, '_')}_partner_backup.lynxora`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Exported partner backup file (.lynxora)! Send this file to your partner.', 'success');
}

function importLynxoraPackage(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (Array.isArray(data.records)) {
        records = data.records;
        if (data.companyName) {
          localStorage.setItem('lynxora_company', data.companyName);
          const el = document.getElementById('companyName');
          if (el) el.value = data.companyName;
        }
        if (data.financialYear) {
          localStorage.setItem('financialYear', data.financialYear);
          const el = document.getElementById('financialYear');
          if (el) el.value = data.financialYear;
        }
        saveRecords();
        populateCategoryFilter();
        showToast(`Imported ${records.length} records from partner successfully!`, 'success');
        navigateTo(activePage);
      } else {
        showToast('Invalid backup file format.', 'error');
      }
    } catch (err) {
      showToast('Failed to parse backup file: ' + err.message, 'error');
    }
    inputEl.value = '';
  };
  reader.readAsText(file);
}

function openCloudSyncModal() {
  const overlay = document.getElementById('cloudSyncModalOverlay');
  const configInput = document.getElementById('firebaseConfigInput');
  const roomInput = document.getElementById('cloudCompanyId');
  const discBtn = document.getElementById('disconnectSyncBtn');
  if (!overlay) return;

  const savedConfig = localStorage.getItem('lynxora_firebase_config');
  const savedRoom = getActiveSyncRoomId();

  if (configInput && savedConfig) configInput.value = savedConfig;
  if (roomInput) roomInput.value = savedRoom;
  if (discBtn) discBtn.style.display = savedConfig ? 'inline-flex' : 'none';

  overlay.classList.add('active');
}

function closeCloudSyncModal() {
  const overlay = document.getElementById('cloudSyncModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

function saveAndConnectFirebase() {
  const configInput = document.getElementById('firebaseConfigInput');
  const roomInput = document.getElementById('cloudCompanyId');
  if (!configInput || !roomInput) return;

  let raw = configInput.value.trim();
  const roomId = roomInput.value.trim() || 'lynxora-main';

  if (!raw) {
    showToast('Please paste your Firebase configuration.', 'error');
    return;
  }

  // Handle JS object format or JSON
  if (raw.startsWith('const firebaseConfig =')) {
    raw = raw.replace('const firebaseConfig =', '').replace(/;$/, '').trim();
  }

  let configObj;
  try {
    configObj = (new Function(`return ${raw}`))();
  } catch (err) {
    try {
      configObj = JSON.parse(raw);
    } catch {
      showToast('Invalid Firebase configuration format.', 'error');
      return;
    }
  }

  if (!configObj || !configObj.projectId) {
    showToast('Firebase configuration must have a valid projectId.', 'error');
    return;
  }

  localStorage.setItem('lynxora_firebase_config', JSON.stringify(configObj));
  localStorage.setItem('lynxora_sync_room', roomId);

  closeCloudSyncModal();
  initCloudSync();
  showToast('Connected to Firebase Realtime Cloud Sync!', 'success');
}

function disconnectCloudSync() {
  if (cloudUnsubscribe) {
    cloudUnsubscribe();
    cloudUnsubscribe = null;
  }
  if (cloudHeartbeatTimer) {
    clearInterval(cloudHeartbeatTimer);
    cloudHeartbeatTimer = null;
  }
  firestoreDb = null;
  localStorage.removeItem('lynxora_firebase_config');

  updateSyncPillStatus('offline', 'Local Mode');
  const btnText = document.getElementById('cloudSyncBtnText');
  if (btnText) btnText.innerHTML = 'Connect Real-Time Cloud Sync (Firebase)';

  closeCloudSyncModal();
  showToast('Disconnected from Cloud Sync. Working in local offline mode.', 'info');
}

function getActiveSyncRoomId() {
  const room = localStorage.getItem('lynxora_sync_room');
  if (room && typeof room === 'string' && room.trim() && room.trim() !== 'undefined' && room.trim() !== 'null') {
    return room.trim();
  }
  return 'lynxora-main';
}

function updateSyncPillStatus(state, text) {
  const pillIds = ['dashSyncPill', 'recordsSyncPill', 'invSyncPill'];
  const textIds = ['dashSyncText', 'recordsSyncText', 'invSyncText'];
  const dotIds  = ['dashSyncDot',  'recordsSyncDot',  'invSyncDot'];

  // Clean text: strip any extra green dot emojis, corrupted bytes or bullet points
  let cleanText = (text || '').replace(/^[\s🟢•\?\?ðŸŽ¯\u{1F7E0}-\u{1F7EB}]+/u, '').trim();
  if (!cleanText) {
    cleanText = state === 'live' ? 'Live Sync' : (state === 'syncing' ? 'Syncing...' : 'Local Mode');
  }

  pillIds.forEach((pId, idx) => {
    const pill = document.getElementById(pId);
    const txt  = document.getElementById(textIds[idx]);
    if (pill) {
      pill.className = `cloud-sync-status-pill ${state === 'syncing' ? 'syncing' : (state === 'offline' ? 'offline' : '')}`;
      pill.title = `Sync Status: ${state.toUpperCase()} • Room: ${getActiveSyncRoomId()} (Click to force refresh)`;
    }
    if (txt) {
      txt.textContent = cleanText;
    }
  });

  const badge = document.getElementById('cloudSyncBadge');
  if (badge) {
    if (state === 'live') {
      badge.innerHTML = '<span class="sync-status-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;margin-right:6px;"></span>Live Sync Active';
      badge.style.background = '#d1fae5';
      badge.style.color = '#065f46';
    } else if (state === 'syncing') {
      badge.innerHTML = '<span class="sync-status-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-right:6px;"></span>Syncing...';
      badge.style.background = '#fef3c7';
      badge.style.color = '#92400e';
    } else {
      badge.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#94a3b8;margin-right:6px;"></span>Local Mode';
      badge.style.background = '#f1f5f9';
      badge.style.color = '#64748b';
    }
  }

  const roomBadge = document.getElementById('employeeRoomBadge');
  if (roomBadge) {
    roomBadge.textContent = `Room: ${getActiveSyncRoomId()}`;
  }
}

let deletedRecordIds = [];
function loadDeletedRecordIds() {
  const saved = localStorage.getItem('lynxora_deleted_records');
  if (saved) {
    try { deletedRecordIds = JSON.parse(saved) || []; } catch { deletedRecordIds = []; }
  }
}
function saveDeletedRecordIds() {
  localStorage.setItem('lynxora_deleted_records', JSON.stringify(deletedRecordIds));
}
loadDeletedRecordIds();

let deletedMovementIds = [];
function loadDeletedMovementIds() {
  const saved = localStorage.getItem('lynxora_deleted_movements');
  if (saved) {
    try { deletedMovementIds = JSON.parse(saved) || []; } catch { deletedMovementIds = []; }
  }
}
function saveDeletedMovementIds() {
  localStorage.setItem('lynxora_deleted_movements', JSON.stringify(deletedMovementIds));
}
loadDeletedMovementIds();

let deletedInvoiceIds = [];
function loadDeletedInvoiceIds() {
  const saved = localStorage.getItem('lynxora_deleted_invoices');
  if (saved) {
    try { deletedInvoiceIds = JSON.parse(saved) || []; } catch { deletedInvoiceIds = []; }
  }
}
function saveDeletedInvoiceIds() {
  localStorage.setItem('lynxora_deleted_invoices', JSON.stringify(deletedInvoiceIds));
}
loadDeletedInvoiceIds();

let deletedInventoryIds = [];
function loadDeletedInventoryIds() {
  const saved = localStorage.getItem('lynxora_deleted_inventory_ids');
  if (saved) {
    try { deletedInventoryIds = JSON.parse(saved) || []; } catch { deletedInventoryIds = []; }
  }
}
function saveDeletedInventoryIds() {
  localStorage.setItem('lynxora_deleted_inventory_ids', JSON.stringify(deletedInventoryIds));
}
loadDeletedInventoryIds();

function mergeRecords(localList, remoteList, remoteDeletedIds = []) {
  const allDeleted = new Set([...(deletedRecordIds || []), ...(remoteDeletedIds || [])].map(String));
  if (!Array.isArray(remoteList)) {
    const list = Array.isArray(localList) ? localList : [];
    return list.filter(r => r && r.id != null && !allDeleted.has(String(r.id)));
  }
  if (!Array.isArray(localList) || localList.length === 0) {
    return remoteList.filter(r => r && r.id != null && !allDeleted.has(String(r.id)));
  }

  const map = new Map();
  // Put remote first
  remoteList.forEach(r => {
    if (r && r.id != null && !allDeleted.has(String(r.id))) map.set(String(r.id), r);
  });
  // Local overlay
  localList.forEach(r => {
    if (r && r.id != null && !allDeleted.has(String(r.id))) {
      const existing = map.get(String(r.id));
      if (!existing) {
        map.set(String(r.id), r);
      } else {
        const localTime = new Date(r.lastEditedAt || r.date || 0).getTime();
        const remoteTime = new Date(existing.lastEditedAt || existing.date || 0).getTime();
        if (localTime >= remoteTime) {
          map.set(String(r.id), r);
        }
      }
    }
  });

  return Array.from(map.values()).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function mergeInventory(localList, remoteList, remoteDeletedIds = []) {
  const allDeleted = new Set([...(deletedInventoryIds || []), ...(remoteDeletedIds || [])].map(String));
  if (!Array.isArray(remoteList)) {
    const list = Array.isArray(localList) ? localList : [];
    return list.filter(i => i && i.id != null && !allDeleted.has(String(i.id)) && (!i.sku || !allDeleted.has(String(i.sku))));
  }
  if (!Array.isArray(localList) || localList.length === 0) {
    return remoteList.filter(i => i && i.id != null && !allDeleted.has(String(i.id)) && (!i.sku || !allDeleted.has(String(i.sku))));
  }
  const map = new Map();
  remoteList.forEach(i => {
    if (i && i.id != null && !allDeleted.has(String(i.id)) && (!i.sku || !allDeleted.has(String(i.sku)))) {
      map.set(String(i.id), i);
    }
  });
  localList.forEach(i => {
    if (i && i.id != null && !allDeleted.has(String(i.id)) && (!i.sku || !allDeleted.has(String(i.sku)))) {
      if (!map.has(String(i.id))) {
        map.set(String(i.id), i);
      } else {
        const existing = map.get(String(i.id));
        const localTime = i.updatedAt || 0;
        const remoteTime = existing.updatedAt || 0;
        if (localTime >= remoteTime) map.set(String(i.id), i);
      }
    }
  });
  return Array.from(map.values());
}

function mergeStockMovements(localList, remoteList, remoteDeletedIds = []) {
  const allDeleted = new Set([...(deletedMovementIds || []), ...(remoteDeletedIds || [])].map(String));
  if (!Array.isArray(remoteList)) {
    const list = Array.isArray(localList) ? localList : [];
    return list.filter(m => m && m.id != null && !allDeleted.has(String(m.id)));
  }
  if (!Array.isArray(localList) || localList.length === 0) {
    return remoteList.filter(m => m && m.id != null && !allDeleted.has(String(m.id)));
  }
  const map = new Map();
  remoteList.forEach(m => { if (m && m.id != null && !allDeleted.has(String(m.id))) map.set(String(m.id), m); });
  localList.forEach(m => { if (m && m.id != null && !allDeleted.has(String(m.id))) map.set(String(m.id), m); });
  return Array.from(map.values()).sort((a, b) => (b.id || 0) - (a.id || 0));
}

function mergeUsers(localList, remoteList) {
  if (!Array.isArray(remoteList) || remoteList.length === 0) {
    return Array.isArray(localList) && localList.length > 0 ? localList : [...DEFAULT_USERS];
  }
  // Remote list from cloud room is authoritative
  return remoteList;
}

function mergeInvoices(localList, remoteList, remoteDeletedIds = []) {
  const allDeleted = new Set([...(deletedInvoiceIds || []), ...(remoteDeletedIds || [])].map(String));
  if (!Array.isArray(remoteList)) {
    const list = Array.isArray(localList) ? localList : [];
    return list.filter(inv => inv && inv.id && !allDeleted.has(String(inv.id)));
  }
  if (!Array.isArray(localList) || localList.length === 0) {
    return remoteList.filter(inv => inv && inv.id && !allDeleted.has(String(inv.id)));
  }
  const map = new Map();
  remoteList.forEach(inv => { if (inv && inv.id && !allDeleted.has(String(inv.id))) map.set(String(inv.id), inv); });
  localList.forEach(inv => { if (inv && inv.id && !allDeleted.has(String(inv.id))) map.set(String(inv.id), inv); });
  return Array.from(map.values());
}

function mergeTrackedPricing(localList, remoteList) {
  if (!Array.isArray(remoteList)) return Array.isArray(localList) ? localList : [];
  if (!Array.isArray(localList) || localList.length === 0) return remoteList;
  const map = new Map();
  remoteList.forEach(item => { if (item && item.id != null) map.set(String(item.id), item); });
  localList.forEach(item => { if (item && item.id != null && !map.has(String(item.id))) map.set(String(item.id), item); });
  return Array.from(map.values()).sort((a, b) => (b.id || 0) - (a.id || 0));
}

function mergeTrackedFlipkart(localList, remoteList) {
  if (!Array.isArray(remoteList)) return Array.isArray(localList) ? localList : [];
  if (!Array.isArray(localList) || localList.length === 0) return remoteList;
  const map = new Map();
  remoteList.forEach(item => { if (item && item.id != null) map.set(String(item.id), item); });
  localList.forEach(item => { if (item && item.id != null && !map.has(String(item.id))) map.set(String(item.id), item); });
  return Array.from(map.values()).sort((a, b) => (b.id || 0) - (a.id || 0));
}

function refreshAllActiveViews() {
  try {
    updateDashboard();
    updateRecordStats();
    renderRecordsTable();
    renderInventory();
    renderStockMovementsTable();
    if (typeof renderPricingTrackerTable === 'function') renderPricingTrackerTable();
    if (typeof updateAmzTrackedBadge === 'function') updateAmzTrackedBadge();
    if (typeof renderFkTrackerTable === 'function') renderFkTrackerTable();
    if (typeof updateFkTrackedBadge === 'function') updateFkTrackedBadge();
  } catch (err) {
    console.warn('[Cloud Sync] Error refreshing active views:', err);
  }
}

function broadcastToCloud(entityName = 'all', actionDesc = '', allowEmpty = false) {
  if (!firestoreDb) {
    if (typeof initCloudSync === 'function') initCloudSync();
    setTimeout(() => broadcastToCloud(entityName, actionDesc, allowEmpty), 1000);
    return;
  }
  if (isSyncingFromCloud) {
    setTimeout(() => broadcastToCloud(entityName, actionDesc, allowEmpty), 600);
    return;
  }
  if (isSyncPushInProgress) {
    setTimeout(() => broadcastToCloud(entityName, actionDesc, allowEmpty), 500);
    return;
  }

  // Prevent blank local array from wiping populated cloud collection unless explicitly requested
  if (!allowEmpty) {
    if (entityName === 'records' && records.length === 0) return;
    if (entityName === 'inventory' && inventoryItems.length === 0 && deletedInventoryIds.length === 0) return;
    if (entityName === 'users' && companyUsers.length === 0) return;
    if (entityName === 'amazonPriceTracker' && trackedPricingList.length === 0) return;
    if (entityName === 'flipkartTracker' && trackedFlipkartList.length === 0) return;
  }

  const roomId = getActiveSyncRoomId();
  const authorName = currentUser ? `${currentUser.name} (${getRoleEmoji(currentUser.role)})` : 'Harsh (Owner)';

  updateSyncPillStatus('syncing', 'Syncing...');

  const payload = {
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastUpdatedBy: authorName,
    lastAction: actionDesc || `Updated ${entityName}`
  };

  if (entityName === 'records' || entityName === 'all') {
    payload.records = records;
    payload.deletedRecordIds = deletedRecordIds;
  }
  if (entityName === 'inventory' || entityName === 'all') {
    payload.inventory = inventoryItems;
    payload.deletedInventoryIds = deletedInventoryIds;
  }
  if (entityName === 'stockMovements' || entityName === 'all') {
    payload.stockMovements = stockMovements;
    payload.deletedMovementIds = deletedMovementIds;
  }
  if (entityName === 'invoices' || entityName === 'all') {
    payload.invoices = invoices;
    payload.deletedInvoiceIds = deletedInvoiceIds;
  }
  if (entityName === 'users' || entityName === 'all') {
    payload.users = companyUsers;
  }
  if (entityName === 'amazonPriceTracker' || entityName === 'all') {
    payload.amazonPriceTracker = trackedPricingList;
  }
  if (entityName === 'flipkartTracker' || entityName === 'all') {
    payload.flipkartTracker = trackedFlipkartList;
  }
  if (entityName === 'profile' || entityName === 'all') {
    payload.companyProfile = {
      name: localStorage.getItem('lynxora_company') || 'Lynxora',
      financialYear: localStorage.getItem('financialYear') || '2026-2027',
      state: localStorage.getItem('lynxora_company_state') || 'Gujarat',
      gstin: localStorage.getItem('lynxora_company_gstin') || '24AAACL1234F1Z5',
      address: localStorage.getItem('lynxora_company_address') || '',
      phone: localStorage.getItem('lynxora_company_phone') || '',
      email: localStorage.getItem('lynxora_company_email') || '',
      bankName: localStorage.getItem('lynxora_bank_name') || '',
      bankAccount: localStorage.getItem('lynxora_bank_account') || '',
      bankIfsc: localStorage.getItem('lynxora_bank_ifsc') || '',
      bankUpi: localStorage.getItem('lynxora_bank_upi') || ''
    };
  }

  isSyncPushInProgress = true;
  firestoreDb.collection('lynxora_rooms').doc(roomId).set(payload, { merge: true })
    .then(() => {
      isSyncPushInProgress = false;
      lastSuccessfulSyncTime = Date.now();
      updateSyncPillStatus('live', 'Live Sync');
    })
    .catch(err => {
      isSyncPushInProgress = false;
      console.warn('[Lynxora Cloud Sync] Push error:', err);
      updateSyncPillStatus('offline', 'Sync Error');
    });
}

function applyCloudData(data, source = 'realtime') {
  if (!data) return;
  if (isSyncPushInProgress) return;
  hasInitialSyncCompleted = true;
  isSyncingFromCloud = true;

  let hasChanges = false;
  let changeList = [];

  // 0. Deleted Records
  if (Array.isArray(data.deletedRecordIds)) {
    let delChanged = false;
    data.deletedRecordIds.forEach(id => {
      if (!deletedRecordIds.includes(id)) {
        deletedRecordIds.push(id);
        delChanged = true;
      }
    });
    if (delChanged) saveDeletedRecordIds();
  }

  // 0b. Deleted Stock Movements
  if (Array.isArray(data.deletedMovementIds)) {
    let mvDelChanged = false;
    data.deletedMovementIds.forEach(id => {
      const sId = String(id);
      if (!deletedMovementIds.includes(sId)) {
        deletedMovementIds.push(sId);
        mvDelChanged = true;
      }
    });
    if (mvDelChanged) saveDeletedMovementIds();
  }

  // 0c. Deleted Invoices
  if (Array.isArray(data.deletedInvoiceIds)) {
    let invDelChanged = false;
    data.deletedInvoiceIds.forEach(id => {
      const sId = String(id);
      if (!deletedInvoiceIds.includes(sId)) {
        deletedInvoiceIds.push(sId);
        invDelChanged = true;
      }
    });
    if (invDelChanged) saveDeletedInvoiceIds();
  }

  // 0d. Deleted Inventory Items
  if (Array.isArray(data.deletedInventoryIds)) {
    let invItemDelChanged = false;
    data.deletedInventoryIds.forEach(id => {
      const sId = String(id);
      if (!deletedInventoryIds.includes(sId)) {
        deletedInventoryIds.push(sId);
        invItemDelChanged = true;
      }
    });
    if (invItemDelChanged) saveDeletedInventoryIds();
  }

  // 1. Records
  const remoteRecords = Array.isArray(data.records) ? data.records : [];
  let merged;
  const isCloudCleared = data.lastAction && data.lastAction.toLowerCase().includes('clear');
  if (remoteRecords.length === 0 && Array.isArray(data.records)) {
    // Cloud room has 0 records (cleared or empty): purge records
    if (isCloudCleared) {
      merged = [];
    } else {
      const allDel = new Set((deletedRecordIds || []).map(String));
      merged = records.filter(r => r && r.id != null && !allDel.has(String(r.id)));
    }
  } else {
    merged = mergeRecords(records, remoteRecords, data.deletedRecordIds);
  }
  if (JSON.stringify(records) !== JSON.stringify(merged)) {
    records = merged;
    localStorage.setItem('lynxora_records', JSON.stringify(records));
    hasChanges = true;
    changeList.push('Transactions');
  }
  // Upstream sync: if this client has local records that the cloud does not yet have, push them automatically
  if (!isCloudCleared && merged.length > remoteRecords.length) {
    setTimeout(() => broadcastToCloud('records', 'Synced local transactions to cloud', false), 800);
  }

  // 2. Inventory Items
  const remoteInventory = Array.isArray(data.inventory) ? data.inventory : [];
  const mergedInv = mergeInventory(inventoryItems, remoteInventory, data.deletedInventoryIds);
  if (JSON.stringify(inventoryItems) !== JSON.stringify(mergedInv)) {
    inventoryItems = mergedInv;
    localStorage.setItem('lynxora_inventory', JSON.stringify(inventoryItems));
    hasChanges = true;
    changeList.push('Inventory');
  }
  if (mergedInv.length > remoteInventory.length) {
    setTimeout(() => broadcastToCloud('inventory', 'Synced local inventory to cloud', false), 1000);
  }

  // 3. Stock Movements
  const remoteMovements = Array.isArray(data.stockMovements) ? data.stockMovements : [];
  const mergedMv = mergeStockMovements(stockMovements, remoteMovements, data.deletedMovementIds);
  if (JSON.stringify(stockMovements) !== JSON.stringify(mergedMv)) {
    stockMovements = mergedMv;
    localStorage.setItem('lynxora_stock_movements', JSON.stringify(stockMovements));
    hasChanges = true;
    changeList.push('Stock Movements');
  }
  if (mergedMv.length > remoteMovements.length) {
    setTimeout(() => broadcastToCloud('stockMovements', 'Synced local stock movements to cloud', false), 1200);
  }

  // 4. Invoices
  const remoteInvoices = Array.isArray(data.invoices) ? data.invoices : [];
  const mergedInvoices = mergeInvoices(invoices, remoteInvoices, data.deletedInvoiceIds);
  if (JSON.stringify(invoices) !== JSON.stringify(mergedInvoices)) {
    invoices = mergedInvoices;
    localStorage.setItem('lynxora_tax_invoices', JSON.stringify(invoices));
    hasChanges = true;
    changeList.push('Invoices');
  }
  if (mergedInvoices.length > remoteInvoices.length) {
    setTimeout(() => broadcastToCloud('invoices', 'Synced local invoices to cloud', false), 1400);
  }

  // 5. Users
  if (Array.isArray(data.users)) {
    const mergedUsers = mergeUsers(companyUsers, data.users);
    if (JSON.stringify(companyUsers) !== JSON.stringify(mergedUsers)) {
      companyUsers = mergedUsers;
      localStorage.setItem('lynxora_users', JSON.stringify(companyUsers));
      renderUserAccounts();
      hasChanges = true;
      changeList.push('Users');
    }
    if (mergedUsers.length > data.users.length) {
      setTimeout(() => broadcastToCloud('users', 'Synced local users to cloud', false), 1600);
    }
  }

  // 6. Company Profile
  if (data.companyProfile) {
    const cp = data.companyProfile;
    if (cp.name && cp.name !== localStorage.getItem('lynxora_company')) {
      localStorage.setItem('lynxora_company', cp.name);
      hasChanges = true;
    }
    if (cp.financialYear) localStorage.setItem('financialYear', cp.financialYear);
    if (cp.gstin) localStorage.setItem('lynxora_company_gstin', cp.gstin);
    if (cp.state) localStorage.setItem('lynxora_company_state', cp.state);
    if (cp.address) localStorage.setItem('lynxora_company_address', cp.address);
    if (cp.phone) localStorage.setItem('lynxora_company_phone', cp.phone);
    if (cp.email) localStorage.setItem('lynxora_company_email', cp.email);
    if (cp.bankName) localStorage.setItem('lynxora_bank_name', cp.bankName);
    if (cp.bankAccount) localStorage.setItem('lynxora_bank_account', cp.bankAccount);
    if (cp.bankIfsc) localStorage.setItem('lynxora_bank_ifsc', cp.bankIfsc);
    if (cp.bankUpi) localStorage.setItem('lynxora_bank_upi', cp.bankUpi);
  }

  // 7. Amazon Price Tracker
  const remoteAmzTracker = Array.isArray(data.amazonPriceTracker) ? data.amazonPriceTracker : [];
  if (remoteAmzTracker.length > 0 || (Array.isArray(data.amazonPriceTracker) && data.lastAction && data.lastAction.toLowerCase().includes('clear amazon'))) {
    const mergedAmz = mergeTrackedPricing(trackedPricingList, remoteAmzTracker);
    if (JSON.stringify(trackedPricingList) !== JSON.stringify(mergedAmz)) {
      trackedPricingList = mergedAmz;
      localStorage.setItem('lynxora_price_tracker', JSON.stringify(trackedPricingList));
      hasChanges = true;
      changeList.push('Amazon Price Tracker');
    }
    if (mergedAmz.length > remoteAmzTracker.length && remoteAmzTracker.length > 0) {
      setTimeout(() => broadcastToCloud('amazonPriceTracker', 'Synced merged Amazon tracked listings to cloud', false), 1000);
    }
  } else if (!data.amazonPriceTracker && trackedPricingList.length > 0) {
    setTimeout(() => broadcastToCloud('amazonPriceTracker', 'Migrated local Amazon tracked listings to cloud', false), 1000);
  }

  // 8. Flipkart Price Tracker
  const remoteFkTracker = Array.isArray(data.flipkartTracker) ? data.flipkartTracker : [];
  if (remoteFkTracker.length > 0 || (Array.isArray(data.flipkartTracker) && data.lastAction && data.lastAction.toLowerCase().includes('clear flipkart'))) {
    const mergedFk = mergeTrackedFlipkart(trackedFlipkartList, remoteFkTracker);
    if (JSON.stringify(trackedFlipkartList) !== JSON.stringify(mergedFk)) {
      trackedFlipkartList = mergedFk;
      localStorage.setItem('lynxora_flipkart_tracker', JSON.stringify(trackedFlipkartList));
      hasChanges = true;
      changeList.push('Flipkart Price Tracker');
    }
    if (mergedFk.length > remoteFkTracker.length && remoteFkTracker.length > 0) {
      setTimeout(() => broadcastToCloud('flipkartTracker', 'Synced merged Flipkart tracked listings to cloud', false), 1000);
    }
  } else if (!data.flipkartTracker && trackedFlipkartList.length > 0) {
    setTimeout(() => broadcastToCloud('flipkartTracker', 'Migrated local Flipkart tracked listings to cloud', false), 1000);
  }

  if (hasChanges || source === 'manual' || source === 'login') {
    populateCategoryFilter();
    populateInventoryCategoryDropdowns();
    refreshAllActiveViews();
    lastSuccessfulSyncTime = Date.now();
    updateSyncPillStatus('live', 'Live Sync');
    const author = data.lastUpdatedBy ? ` from ${data.lastUpdatedBy}` : '';
    const desc = data.lastAction ? `: ${data.lastAction}` : '';
    if (source !== 'login' && hasChanges) {
      showToast(`Live Sync${author}${desc}!`, 'info');
    }
  } else {
    updateSyncPillStatus('live', 'Live Sync');
  }

  setTimeout(() => { 
    isSyncingFromCloud = false; 
  }, 500);
}

function startHeartbeatSync() {
  if (cloudHeartbeatTimer) clearInterval(cloudHeartbeatTimer);
  cloudHeartbeatTimer = setInterval(() => {
    if (!firestoreDb) {
      if (typeof initCloudSync === 'function') initCloudSync();
      return;
    }
    if (isSyncPushInProgress || isSyncingFromCloud) return;
    const roomId = getActiveSyncRoomId();
    firestoreDb.collection('lynxora_rooms').doc(roomId).get({ source: 'server' })
      .then(doc => {
        if (doc.exists) {
          applyCloudData(doc.data(), 'heartbeat');
        }
      })
      .catch(() => {});
  }, 3500);

  // Sync immediately when window gains focus or tab becomes visible (essential for mobile devices & desktop switches)
  const triggerFocusSync = () => {
    if (!firestoreDb) {
      if (typeof initCloudSync === 'function') initCloudSync();
      return;
    }
    if (!isSyncingFromCloud && !isSyncPushInProgress) {
      const roomId = getActiveSyncRoomId();
      firestoreDb.collection('lynxora_rooms').doc(roomId).get({ source: 'server' })
        .then(doc => {
          if (doc.exists) applyCloudData(doc.data(), 'focus');
        })
        .catch(() => {});
    }
  };

  window.addEventListener('focus', triggerFocusSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') triggerFocusSync();
  });
}

function manualSyncNow() {
  if (!firestoreDb) {
    if (typeof initCloudSync === 'function') initCloudSync();
    showToast('Connecting to Cloud Sync...', 'info');
    setTimeout(() => {
      if (firestoreDb) manualSyncNow();
    }, 1200);
    return;
  }
  updateSyncPillStatus('syncing', 'Syncing...');
  const roomId = getActiveSyncRoomId();
  firestoreDb.collection('lynxora_rooms').doc(roomId).get({ source: 'server' })
    .then(doc => {
      if (doc.exists) {
        const cloudData = doc.data() || {};
        applyCloudData(cloudData, 'manual');
        const cloudRecs = Array.isArray(cloudData.records) ? cloudData.records : [];
        const cloudInv = Array.isArray(cloudData.inventory) ? cloudData.inventory : [];
        if (records.length > cloudRecs.length || inventoryItems.length > cloudInv.length) {
          broadcastToCloud('all', 'Uploaded local records to cloud workspace', false);
          showToast('✅ Uploaded and synced your local records to Cloud!', 'success');
        } else {
          showToast('✅ Cloud Sync complete! All records & transactions are up to date.', 'success');
        }
      } else {
        broadcastToCloud('all', 'Initial sync upload');
        showToast('✅ Cloud workspace initialized and synced!', 'success');
      }
      updateSyncPillStatus('live', 'Live Sync');
    })
    .catch(err => {
      console.warn('Manual sync failed:', err);
      updateSyncPillStatus('offline', 'Sync Error');
      showToast('Cloud sync request failed. Please check your internet connection.', 'error');
    });
}

function copyEmployeeInviteLink() {
  const roomId = getActiveSyncRoomId();
  let base = window.location.href.split('?')[0];
  const inviteUrl = `${base}?room=${encodeURIComponent(roomId)}&role=staff`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      showToast('Copied Employee Live Access Link to clipboard! Send this URL to your staff.', 'success');
    }).catch(() => {
      prompt('Copy this Employee Live Access Link and send it to your staff:', inviteUrl);
    });
  } else {
    prompt('Copy this Employee Live Access Link and send it to your staff:', inviteUrl);
  }
}

function initCloudSync() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam && roomParam.trim() && roomParam.trim() !== 'undefined' && roomParam.trim() !== 'null') {
    localStorage.setItem('lynxora_sync_room', roomParam.trim());
  }

  const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyBjv01VpcYExqp0AmhoN6HA9EbJJGIA6pU",
    authDomain: "lynxora-company-deashboard.firebaseapp.com",
    projectId: "lynxora-company-deashboard",
    storageBucket: "lynxora-company-deashboard.firebasestorage.app",
    messagingSenderId: "447232907792",
    appId: "1:447232907792:web:6b777defd5c46cdf2c0895",
    measurementId: "G-32BE7H8EH9"
  };

  let savedConfig = localStorage.getItem('lynxora_firebase_config');
  let configToUse = null;
  if (savedConfig) {
    try {
      const parsed = JSON.parse(savedConfig);
      if (parsed && parsed.apiKey && parsed.projectId) {
        configToUse = parsed;
      }
    } catch (e) {}
  }
  if (!configToUse) {
    configToUse = DEFAULT_FIREBASE_CONFIG;
    localStorage.setItem('lynxora_firebase_config', JSON.stringify(DEFAULT_FIREBASE_CONFIG));
  }
  const roomId = getActiveSyncRoomId();

  if (typeof firebase === 'undefined') {
    updateSyncPillStatus('offline', 'Local Mode');
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(configToUse);
    }
    firestoreDb = firebase.firestore();

    updateSyncPillStatus('live', 'Live Sync');

    // 1. Listen to real-time room changes via onSnapshot
    if (cloudUnsubscribe) cloudUnsubscribe();
    cloudUnsubscribe = firestoreDb.collection('lynxora_rooms').doc(roomId).onSnapshot(doc => {
      if (doc.exists) {
        applyCloudData(doc.data(), 'realtime');
      } else {
        // Room doesn't exist yet: initialize with current records & items only if we have local data
        hasInitialSyncCompleted = true;
        if (records.length > 0 || inventoryItems.length > 0) {
          broadcastToCloud('all', 'Initialized workspace room');
        }
      }
    }, err => {
      console.warn('[Lynxora Cloud Sync] onSnapshot error:', err);
      updateSyncPillStatus('offline', 'Sync Error');
    });

    // 2. Start active heartbeat polling fallback (4-second interval + focus)
    startHeartbeatSync();

  } catch (err) {
    console.warn('[Lynxora Cloud Sync] Init error:', err);
    updateSyncPillStatus('offline', 'Sync Error');
  }
}

// ══════════════════════════════════════════════════
//  INVENTORY MANAGEMENT SYSTEM & AUTO-COMPLETE DROPDOWNS
// ══════════════════════════════════════════════════
let editingInvId = null;
let adjustingInvId = null;

// ── CATEGORIES ──
function loadInventoryCategories() {
  const OLD_DUMMIES = ['Apparel & Clothing', 'Kurtis & Sarees', 'Fabrics & Textiles', 'Electronics & Accessories', 'Home & Kitchen', 'Footwear', 'General', 'Finished Goods', 'Raw Materials', 'Packaging Supplies', 'Other Product', 'Electronics & Gadgets'];
  const saved = localStorage.getItem('lynxora_inv_categories');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      inventoryCategories = Array.isArray(parsed) ? parsed.filter(c => !OLD_DUMMIES.includes(c) || inventoryItems.some(i => i.category === c)) : [];
    } catch {
      inventoryCategories = [];
    }
  } else {
    inventoryCategories = [];
  }
  inventoryItems.forEach(i => {
    if (i.category && !inventoryCategories.includes(i.category)) {
      inventoryCategories.push(i.category);
    }
  });
}

function saveInventoryCategories() {
  localStorage.setItem('lynxora_inv_categories', JSON.stringify(inventoryCategories));
}

function populateInventoryCategoryDropdowns(selectedVal = null) {
  const datalist = document.getElementById('categoryDatalist');
  const input = document.getElementById('invCategory');
  const filterSelect = document.getElementById('invCategoryFilter');

  const unique = Array.from(new Set(inventoryCategories.filter(Boolean))).sort();

  if (datalist) {
    datalist.innerHTML = unique.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }

  if (filterSelect) {
    const curFilter = filterSelect.value || 'All';
    let filterHtml = '<option value="All">All Categories</option>';
    filterHtml += unique.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    filterSelect.innerHTML = filterHtml;
    if (unique.includes(curFilter)) filterSelect.value = curFilter;
  }

  if (input && selectedVal !== null) {
    input.value = selectedVal;
  }
}

// ── SUPPLIERS ──
function loadSuppliers() {
  const saved = localStorage.getItem('lynxora_suppliers');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      knownSuppliers = Array.isArray(parsed) ? parsed : [];
    } catch {
      knownSuppliers = [];
    }
  } else {
    knownSuppliers = [];
  }
  records.forEach(r => {
    if (r.partyName && !knownSuppliers.includes(r.partyName)) {
      knownSuppliers.push(r.partyName);
    }
  });
  inventoryItems.forEach(i => {
    if (i.supplier && !knownSuppliers.includes(i.supplier)) {
      knownSuppliers.push(i.supplier);
    }
  });
}

function saveSuppliers() {
  localStorage.setItem('lynxora_suppliers', JSON.stringify(knownSuppliers));
}

function populateSupplierDropdown(selectedVal = null) {
  const datalist = document.getElementById('supplierDatalist');
  const input = document.getElementById('invNewSupplier');
  if (!datalist) return;
  const unique = Array.from(new Set(knownSuppliers.filter(Boolean))).sort();
  datalist.innerHTML = unique.map(s => `<option value="${escapeHtml(s)}">`).join('');

  if (input && selectedVal !== null) {
    input.value = selectedVal;
  }
}

// ── PRODUCT NAMES / TITLES ──
function loadProductNames() {
  const saved = localStorage.getItem('lynxora_product_names');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      knownProductNames = Array.isArray(parsed) ? parsed : [];
    } catch {
      knownProductNames = [];
    }
  } else {
    knownProductNames = [];
  }
  inventoryItems.forEach(i => {
    if (i.name && !knownProductNames.includes(i.name)) {
      knownProductNames.push(i.name);
    }
  });
}

function saveProductNames() {
  localStorage.setItem('lynxora_product_names', JSON.stringify(knownProductNames));
}

function populateProductNameDropdown(selectedVal = null) {
  const datalist = document.getElementById('productNameDatalist');
  const input = document.getElementById('invName');
  if (!datalist) return;
  const unique = Array.from(new Set(knownProductNames.filter(Boolean))).sort();
  datalist.innerHTML = unique.map(n => `<option value="${escapeHtml(n)}">`).join('');

  if (input && selectedVal !== null) {
    input.value = selectedVal;
  }
}

// ── LOAD INVENTORY ──
// ==========================================
// TAX INVOICE & GST BILLING SYSTEM
// ==========================================
let invoices = [];

function loadInvoices() {
  const saved = localStorage.getItem('lynxora_tax_invoices');
  if (saved) {
    try {
      invoices = JSON.parse(saved) || [];
      const delSet = new Set((deletedInvoiceIds || []).map(String));
      invoices = invoices.filter(inv => inv && inv.id && !delSet.has(String(inv.id)));
    } catch { invoices = []; }
  } else {
    invoices = [];
  }
}

function saveInvoices(actionDesc = '') {
  localStorage.setItem('lynxora_tax_invoices', JSON.stringify(invoices));
  if (typeof broadcastToCloud === 'function') {
    broadcastToCloud('invoices', actionDesc || 'Updated GST tax invoices');
  }
}

function getNextInvoiceNumber() {
  const currentYear = new Date().getFullYear();
  let maxSeq = 0;
  invoices.forEach(inv => {
    if (inv && inv.invoiceNumber) {
      const match = inv.invoiceNumber.match(/INV-\d{4}-(\d+)/);
      if (match) {
        const seq = parseInt(match[1]);
        if (seq > maxSeq) maxSeq = seq;
      }
    }
  });
  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `INV-${currentYear}-${nextSeq}`;
}

function numberToIndianWords(num) {
  if (num === 0 || isNaN(num)) return 'Rupees Zero Only';
  num = Math.round(Math.abs(num));

  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(n) {
    if (n < 20) return a[n];
    const tens = b[Math.floor(n / 10)];
    const units = a[n % 10];
    return tens + (units ? ' ' + units : '');
  }

  function convertThreeDigits(n) {
    let str = '';
    if (Math.floor(n / 100) > 0) {
      str += a[Math.floor(n / 100)] + ' Hundred';
      if (n % 100 > 0) str += ' and ';
    }
    if (n % 100 > 0) {
      str += convertTwoDigits(n % 100);
    }
    return str.trim();
  }

  let words = '';
  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const remainder = num;

  if (crore > 0) {
    words += (crore < 100 ? convertTwoDigits(crore) : convertThreeDigits(crore)) + ' Crore ';
  }
  if (lakh > 0) {
    words += convertTwoDigits(lakh) + ' Lakh ';
  }
  if (thousand > 0) {
    words += convertTwoDigits(thousand) + ' Thousand ';
  }
  if (remainder > 0) {
    words += convertThreeDigits(remainder);
  }

  return 'Rupees ' + words.trim() + ' Only';
}

function toggleSaleInvoiceFields(checked) {
  const container = document.getElementById('invoiceFieldsContainer');
  const chk = document.getElementById('generateTaxInvoiceCheck');
  if (chk) chk.checked = checked;
  if (!container) return;

  if (checked) {
    container.style.display = 'block';
    const invNumInput = document.getElementById('invoiceNumber');
    if (invNumInput && !invNumInput.value) {
      invNumInput.value = getNextInvoiceNumber();
    }
    const nameInput = document.getElementById('invoiceBuyerName');
    if (nameInput) setTimeout(() => nameInput.focus(), 100);
  } else {
    container.style.display = 'none';
  }
}

let currentViewingInvoiceId = null;

function handleLogoUpload(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 2 * 1024 * 1024) {
    showToast('Logo image must be under 2MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    localStorage.setItem('lynxora_company_logo', dataUrl);
    const preview = document.getElementById('settingsLogoPreview');
    if (preview) preview.src = dataUrl;
    showToast('Company logo updated! ✓', 'success');
    if (currentViewingInvoiceId) {
      openTaxInvoiceModal(currentViewingInvoiceId);
    }
  };
  reader.readAsDataURL(file);
}

function resetCompanyLogo() {
  localStorage.removeItem('lynxora_company_logo');
  const preview = document.getElementById('settingsLogoPreview');
  if (preview) preview.src = 'logo.png';
  showToast('Company logo reset to default (logo.png).', 'info');
  if (currentViewingInvoiceId) {
    openTaxInvoiceModal(currentViewingInvoiceId);
  }
}

function handleSignatureUpload(input, refreshModal = false) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 2 * 1024 * 1024) {
    showToast('Signature image must be under 2MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    localStorage.setItem('lynxora_company_signature', dataUrl);

    // Update settings preview
    const preview = document.getElementById('settingsSignaturePreview');
    const placeholder = document.getElementById('settingsSignaturePlaceholder');
    const removeBtn = document.getElementById('removeSignatureBtn');
    if (preview) {
      preview.src = dataUrl;
      preview.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'inline-block';

    showToast('Authorized signature saved successfully! ✓', 'success');

    // If called from open invoice modal, refresh the invoice view immediately
    if (refreshModal && currentViewingInvoiceId) {
      openTaxInvoiceModal(currentViewingInvoiceId);
    }
  };
  reader.readAsDataURL(file);
}

function removeCompanySignature() {
  localStorage.removeItem('lynxora_company_signature');
  const preview = document.getElementById('settingsSignaturePreview');
  const placeholder = document.getElementById('settingsSignaturePlaceholder');
  const removeBtn = document.getElementById('removeSignatureBtn');
  if (preview) {
    preview.src = '';
    preview.style.display = 'none';
  }
  if (placeholder) placeholder.style.display = 'block';
  if (removeBtn) removeBtn.style.display = 'none';
  showToast('Digital signature removed.', 'info');
  if (currentViewingInvoiceId) {
    openTaxInvoiceModal(currentViewingInvoiceId);
  }
}

function closeTaxInvoiceModal() {
  const overlay = document.getElementById('taxInvoiceModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function downloadTaxInvoicePDF() {
  const paper = document.getElementById('invoicePaper');
  if (!paper) {
    showToast('Invoice paper element not found.', 'error');
    return;
  }
  const inv = invoices.find(i => String(i.id) === String(currentViewingInvoiceId));
  const invNum = inv && inv.invoiceNumber ? inv.invoiceNumber : ('INV-' + Date.now());
  const cleanNum = invNum.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${cleanNum}.pdf`;

  showToast('Generating invoice PDF download...', 'info');

  if (typeof html2pdf !== 'undefined') {
    const opt = {
      margin: [6, 6, 6, 6],
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        scrollY: 0
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(paper).save().then(() => {
      showToast(`Downloaded ${filename} successfully! ✓`, 'success');
    }).catch(err => {
      console.warn('html2pdf generation error, falling back to print dialog:', err);
      printTaxInvoice();
    });
  } else {
    printTaxInvoice();
  }
}

function printTaxInvoice() {
  const paper = document.getElementById('invoicePaper');
  if (!paper) {
    window.print();
    return;
  }

  // Use a dedicated print iframe so the main application DOM and classes are never distorted
  try {
    let iframe = document.getElementById('invoicePrintFrame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'invoicePrintFrame';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      document.body.appendChild(iframe);
    }

    const frameDoc = iframe.contentWindow.document;
    frameDoc.open();
    frameDoc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tax Invoice</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; padding: 0; background: #ffffff; color: #0f172a; font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 12px; }
    .invoice-paper { border: none !important; box-shadow: none !important; padding: 0 !important; width: 100% !important; max-width: 100% !important; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #cbd5e1; }
  </style>
</head>
<body>
  ${paper.outerHTML}
</body>
</html>`);
    frameDoc.close();

    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }, 350);
  } catch (err) {
    document.body.classList.add('printing-invoice');
    const cleanup = () => {
      document.body.classList.remove('printing-invoice');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-invoice');
    }, 2500);
  }
}

function openTaxInvoiceModal(invoiceId) {
  currentViewingInvoiceId = invoiceId;
  const inv = invoices.find(i => String(i.id) === String(invoiceId));
  if (!inv) {
    showToast('Invoice details not found.', 'error');
    return;
  }

  const paper = document.getElementById('invoicePaper');
  if (!paper) return;

  const seller = inv.seller || {};
  const buyer = inv.buyer || {};
  const items = inv.items || [];
  const isInterState = inv.isInterState;

  const logoSrc = localStorage.getItem('lynxora_company_logo') || 'logo.png';
  const sigSrc = localStorage.getItem('lynxora_company_signature') || '';

  const taxColumnsHeader = isInterState
    ? `<th style="text-align:right;">IGST (${items[0]?.gstRate || 0}%)</th>`
    : `<th style="text-align:right;">CGST (${(items[0]?.gstRate || 0) / 2}%)</th><th style="text-align:right;">SGST (${(items[0]?.gstRate || 0) / 2}%)</th>`;

  const itemsHtml = items.map((item, index) => {
    const taxCells = isInterState
      ? `<td style="text-align:right;">${formatCurrency(item.igstAmount || 0)}</td>`
      : `<td style="text-align:right;">${formatCurrency(item.cgstAmount || 0)}</td><td style="text-align:right;">${formatCurrency(item.sgstAmount || 0)}</td>`;

    return `<tr>
      <td style="text-align:center;">${index + 1}</td>
      <td>
        <b>${escapeHtml(item.name || '')}</b>
        <div style="font-size:11px;color:#64748b;">SKU: ${escapeHtml(item.sku || 'N/A')}</div>
      </td>
      <td style="text-align:center;">${escapeHtml(item.hsn || '610910')}</td>
      <td style="text-align:center;font-weight:700;">${item.qty} PCS</td>
      <td style="text-align:right;">${formatCurrency(item.unitRate || 0)}</td>
      <td style="text-align:right;font-weight:700;">${formatCurrency(item.taxableAmount || 0)}</td>
      ${taxCells}
      <td style="text-align:right;font-weight:800;color:#0f172a;">${formatCurrency(item.total || 0)}</td>
    </tr>`;
  }).join('');

  const taxSummaryRows = isInterState
    ? `<tr>
        <td colspan="6" style="text-align:right;font-weight:700;">Integrated Tax (IGST ${items[0]?.gstRate || 0}%):</td>
        <td style="text-align:right;font-weight:700;color:#0f172a;">${formatCurrency(inv.igstAmount || 0)}</td>
        <td></td>
      </tr>`
    : `<tr>
        <td colspan="6" style="text-align:right;font-weight:700;">Central Tax (CGST ${(items[0]?.gstRate || 0) / 2}%):</td>
        <td style="text-align:right;font-weight:700;color:#0f172a;">${formatCurrency(inv.cgstAmount || 0)}</td>
        <td style="text-align:right;font-weight:700;color:#0f172a;">${formatCurrency(inv.sgstAmount || 0)}</td>
      </tr>
      <tr>
        <td colspan="6" style="text-align:right;font-weight:700;">State Tax (SGST ${(items[0]?.gstRate || 0) / 2}%):</td>
        <td colspan="2" style="text-align:right;font-weight:700;color:#0f172a;">${formatCurrency(inv.sgstAmount || 0)}</td>
      </tr>`;

  paper.innerHTML = `
    <!-- INVOICE HEADER -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:16px;margin-bottom:16px;">
      <div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <img src="${logoSrc}" alt="Company Logo" style="height:48px;max-width:140px;object-fit:contain;border-radius:6px;background:white;" onerror="this.style.display='none'">
          <div>
            <div style="display:inline-block;background:#0f172a;color:white;font-size:10px;font-weight:800;padding:2px 8px;border-radius:4px;letter-spacing:1px;text-transform:uppercase;">
              TAX INVOICE
            </div>
            <h1 style="font-size:22px;font-weight:900;color:#0f172a;margin:2px 0 0 0;line-height:1.2;">${escapeHtml(seller.name || 'Lynxora')}</h1>
          </div>
        </div>
        <p style="font-size:12px;color:#475569;margin:3px 0 0 0;max-width:380px;">${escapeHtml(seller.address || 'Surat, Gujarat, India')}</p>
        <div style="font-size:12px;color:#0f172a;margin-top:4px;">
          <b>GSTIN:</b> <span style="font-family:monospace;font-weight:700;">${escapeHtml(seller.gstin || '24AAACL1234F1Z5')}</span>
        </div>
        <div style="font-size:12px;color:#475569;">
          <b>Phone:</b> ${escapeHtml(seller.phone || '+91 98765 43210')} | <b>Email:</b> ${escapeHtml(seller.email || 'contact@lynxora.com')}
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">Original for Recipient</div>
        <div style="font-size:18px;font-weight:800;color:#2563eb;margin-top:4px;">${escapeHtml(inv.invoiceNumber)}</div>
        <div style="font-size:12px;color:#475569;margin-top:2px;"><b>Date:</b> ${inv.date}</div>
        <div style="font-size:12px;color:#475569;"><b>Place of Supply:</b> ${escapeHtml(buyer.state || seller.state || 'Gujarat')}</div>
        <div style="font-size:12px;color:#475569;"><b>Payment Method:</b> ${escapeHtml(inv.paymentChannel || 'Bank / UPI')}</div>
      </div>
    </div>

    <!-- BILL TO / SHIP TO -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;margin-bottom:18px;">
      <div>
        <div style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Billed To (Buyer / Customer):</div>
        <div style="font-size:15px;font-weight:800;color:#0f172a;">${escapeHtml(buyer.name || 'Walk-in Customer')}</div>
        <div style="font-size:12px;color:#475569;margin-top:2px;">${escapeHtml(buyer.address || 'Direct Buyer')}</div>
        <div style="font-size:12px;color:#0f172a;margin-top:4px;">
          <b>Buyer GSTIN:</b> ${buyer.gstin ? `<span style="font-family:monospace;font-weight:700;">${escapeHtml(buyer.gstin)}</span>` : '<span style="color:#64748b;">Unregistered / Consumer</span>'}
        </div>
        <div style="font-size:12px;color:#475569;"><b>Contact:</b> ${escapeHtml(buyer.phone || '—')}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Dispatch / Transport Details:</div>
        <div style="font-size:12px;color:#475569;"><b>State:</b> ${escapeHtml(buyer.state || seller.state || 'Gujarat')}</div>
        <div style="font-size:12px;color:#475569;margin-top:2px;"><b>Supply Type:</b> ${isInterState ? '<span style="color:#7c3aed;font-weight:700;">Inter-State (IGST)</span>' : '<span style="color:#059669;font-weight:700;">Intra-State (CGST + SGST)</span>'}</div>
        <div style="font-size:12px;color:#475569;margin-top:2px;"><b>Reverse Charge:</b> Applicable (No)</div>
        ${inv.notes ? `<div style="font-size:12px;color:#475569;margin-top:2px;"><b>Notes:</b> ${escapeHtml(inv.notes)}</div>` : ''}
      </div>
    </div>

    <!-- ITEMIZED TABLE -->
    <table class="invoice-table">
      <thead>
        <tr>
          <th style="width:36px;text-align:center;">#</th>
          <th>Description of Goods / Services</th>
          <th style="width:80px;text-align:center;">HSN / SAC</th>
          <th style="width:60px;text-align:center;">Qty</th>
          <th style="width:90px;text-align:right;">Rate (&#8377;)</th>
          <th style="width:100px;text-align:right;">Taxable Amt</th>
          ${taxColumnsHeader}
          <th style="width:110px;text-align:right;">Total (&#8377;)</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
      <tfoot>
        <tr style="background:#f1f5f9;font-weight:700;">
          <td colspan="5" style="text-align:right;">Sub Total:</td>
          <td style="text-align:right;">${formatCurrency(inv.taxableAmount || 0)}</td>
          <td colspan="${isInterState ? 1 : 2}" style="text-align:right;color:#0f172a;">${formatCurrency(inv.taxTotal || 0)}</td>
          <td style="text-align:right;color:#0f172a;font-weight:800;">${formatCurrency(inv.grossTotal || 0)}</td>
        </tr>
        ${taxSummaryRows}
        <tr style="background:#eff6ff;font-size:14px;border-top:2px solid #2563eb;">
          <td colspan="6" style="font-weight:800;color:#1e40af;text-transform:uppercase;">Grand Total (Net Invoice Amount):</td>
          <td colspan="${isInterState ? 2 : 3}" style="text-align:right;font-weight:900;color:#1e40af;font-size:16px;">
            ${formatCurrency(inv.grossTotal || 0)}
          </td>
        </tr>
      </tfoot>
    </table>

    <!-- AMOUNT IN WORDS -->
    <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:10px 14px;margin-bottom:18px;">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Total Invoice Amount in Words:</div>
      <div style="font-size:13.5px;font-weight:800;color:#0f172a;margin-top:2px;">${escapeHtml(inv.totalInWords || '')}</div>
    </div>

    <!-- FOOTER: BANK DETAILS & SIGNATURE -->
    <div style="display:grid;grid-template-columns:1.2fr 0.8fr;gap:20px;border-top:1px solid #cbd5e1;padding-top:16px;margin-top:12px;">
      <div style="font-size:12px;color:#475569;">
        <div style="font-weight:800;color:#0f172a;margin-bottom:4px;text-transform:uppercase;font-size:11.5px;">Bank &amp; Payment Details:</div>
        <div><b>Bank Name:</b> ${escapeHtml(seller.bankName || 'HDFC Bank')}</div>
        <div><b>Account Number:</b> <span style="font-family:monospace;font-weight:700;">${escapeHtml(seller.bankAccount || '50200012345678')}</span></div>
        <div><b>IFSC Code:</b> <span style="font-family:monospace;font-weight:700;">${escapeHtml(seller.bankIfsc || 'HDFC0001234')}</span></div>
        <div><b>UPI ID:</b> <span style="font-weight:700;">${escapeHtml(seller.upiId || 'lynxora@upi')}</span></div>
        <div style="margin-top:8px;font-size:11px;color:#64748b;line-height:1.4;">
          <b>Terms &amp; Conditions:</b><br>
          1. Goods once sold will not be returned or exchanged.<br>
          2. All disputes are subject to local jurisdiction only.
        </div>
      </div>
      <div style="text-align:right;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-end;min-height:120px;">
        <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:4px;">For ${escapeHtml(seller.name || 'Lynxora')}</div>
        <div style="margin-top:auto;margin-bottom:6px;min-height:46px;display:flex;align-items:flex-end;justify-content:flex-end;">
          ${sigSrc ? `
            <img src="${sigSrc}" alt="Authorized Signature" style="max-height:46px;max-width:140px;object-fit:contain;display:block;">
          ` : `
            <label style="cursor:pointer;font-size:11px;color:#2563eb;font-weight:600;display:inline-flex;align-items:center;gap:4px;border:1px dashed #93c5fd;padding:4px 8px;border-radius:6px;background:#eff6ff;" title="Upload your signature image">
              <span>&#9997;&#65039; Upload Signature</span>
              <input type="file" accept="image/*" style="display:none;" onchange="handleSignatureUpload(this, true)">
            </label>
          `}
        </div>
        <div style="border-top:1px dashed #94a3b8;display:inline-block;padding-top:4px;font-size:11.5px;color:#475569;font-weight:700;min-width:140px;text-align:center;">
          Authorized Signatory
        </div>
      </div>
    </div>
  `;

  const overlay = document.getElementById('taxInvoiceModalOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
  }
}

// ==========================================
// DEDICATED GST TAX INVOICE GENERATOR & MANAGER SUITE
// ==========================================
const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
];

const GSTIN_STATE_CODES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Dadra and Nagar Haveli and Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh'
};

let genInvoiceLineItems = [];
let currentLinkingMovementId = null;

function openGenerateInvoiceForMovement(movementId) {
  const mv = (stockMovements || []).find(m => String(m.id) === String(movementId));
  if (!mv) return;

  currentLinkingMovementId = mv.id;

  const prod = (inventoryItems || []).find(p => (mv.productId && String(p.id) === String(mv.productId)) || (mv.sku && p.sku === mv.sku));

  const prefill = {
    product: prod || {
      id: mv.productId || '',
      name: mv.productName || 'Product',
      sku: mv.sku || '',
      hsn: '610910',
      sellingPrice: mv.unitRate || 0,
      costPrice: mv.unitRate || 0,
      gstRate: 18
    },
    qty: Math.abs(mv.qty || 1)
  };

  openGenerateInvoiceModal(prefill);

  // Since stock was already deducted for this movement, uncheck "Deduct from Inventory" to prevent double-deduction
  const deductCheck = document.getElementById('genInvDeductStock');
  if (deductCheck) deductCheck.checked = false;

  // If already reflected in finance, uncheck "Reflect in Financial Records" to prevent double revenue
  const reflectCheck = document.getElementById('genInvReflectFinance');
  if (reflectCheck && mv.reflectedInFinance) reflectCheck.checked = false;
}

function openGenerateInvoiceModal(prefillData = null) {
  const overlay = document.getElementById('generateInvoiceModalOverlay');
  if (!overlay) return;

  const sellerState = localStorage.getItem('lynxora_company_state') || 'Gujarat';

  // Populate State dropdown
  const stateSelect = document.getElementById('genInvBuyerState');
  if (stateSelect) {
    stateSelect.innerHTML = INDIAN_STATES.map(s => 
      `<option value="${s}" ${s.toLowerCase() === sellerState.toLowerCase() ? 'selected' : ''}>${s}</option>`
    ).join('');
  }

  // Next Invoice #
  const nextNum = getNextInvoiceNumber();
  const numInput = document.getElementById('genInvNumber');
  if (numInput) numInput.value = nextNum;
  const numBadge = document.getElementById('genInvNumberBadge');
  if (numBadge) numBadge.textContent = nextNum;

  // Date
  const dateInput = document.getElementById('genInvDate');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  // Reset fields
  const nameInput = document.getElementById('genInvBuyerName');
  if (nameInput) nameInput.value = '';
  const gstinInput = document.getElementById('genInvBuyerGstin');
  if (gstinInput) gstinInput.value = '';
  const phoneInput = document.getElementById('genInvBuyerPhone');
  if (phoneInput) phoneInput.value = '';
  const emailInput = document.getElementById('genInvBuyerEmail');
  if (emailInput) emailInput.value = '';
  const addressInput = document.getElementById('genInvBuyerAddress');
  if (addressInput) addressInput.value = '';

  // Setup initial item
  if (prefillData && prefillData.product) {
    const prod = prefillData.product;
    genInvoiceLineItems = [{
      id: Date.now(),
      productId: prod.id,
      name: prod.name || '',
      sku: prod.sku || '',
      hsn: prod.hsn || '610910',
      qty: prefillData.qty || 1,
      unitRate: prod.sellingPrice || prod.costPrice || 0,
      gstRate: prod.gstRate != null ? prod.gstRate : 18
    }];
  } else {
    genInvoiceLineItems = [{
      id: Date.now(),
      productId: '',
      name: '',
      sku: '',
      hsn: '610910',
      qty: 1,
      unitRate: 0,
      gstRate: 18
    }];
  }

  renderGenerateInvoiceItems();
  calculateGenerateInvoiceTotals();

  overlay.style.display = 'flex';
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');

  if (nameInput) setTimeout(() => nameInput.focus(), 150);
}

function closeGenerateInvoiceModal() {
  const overlay = document.getElementById('generateInvoiceModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function renderGenerateInvoiceItems() {
  const container = document.getElementById('genInvItemsContainer');
  if (!container) return;

  container.innerHTML = genInvoiceLineItems.map((item, idx) => {
    const prodOptions = (inventoryItems || []).map(p => 
      `<option value="${p.id}" ${String(item.productId) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.name)} (${p.sku || 'No SKU'} - Stock: ${p.quantity || 0})</option>`
    ).join('');

    const qty = Number(item.qty) || 1;
    const rate = Number(item.unitRate) || 0;
    const gstRate = Number(item.gstRate) || 0;
    const taxable = qty * rate;
    const tax = taxable * (gstRate / 100);
    const total = taxable + tax;

    return `
      <div class="gen-inv-item-row" style="background: var(--input-bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <div style="font-size: 12px; font-weight: 800; color: #2563eb; display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-flex; width: 20px; height: 20px; border-radius: 50%; background: #2563eb; color: white; align-items: center; justify-content: center; font-size: 11px;">${idx + 1}</span>
            <span>Item #${idx + 1}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 12px; font-weight: 700; color: #059669;">Line Total: ${formatCurrency(total)}</span>
            ${genInvoiceLineItems.length > 1 ? `
              <button type="button" class="btn btn-danger-sm" onclick="removeInvoiceLineItem(${idx})" style="padding: 2px 8px; font-size: 11px; background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; border-radius: 6px; cursor: pointer;">
                ✕ Remove
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Product Selector Dropdown -->
        <div style="display: grid; grid-template-columns: 1.5fr 1fr; gap: 10px;">
          <div class="form-group" style="margin: 0;">
            <label style="font-size: 11px; font-weight: 700;">Select Catalogue Product (Optional)</label>
            <select class="form-input" style="font-size: 12.5px; height: 38px;" onchange="onInvoiceProductSelect(${idx}, this.value)">
              <option value="">-- Custom Item / Non-Catalogue Product --</option>
              ${prodOptions}
            </select>
          </div>
          <div class="form-group" style="margin: 0;">
            <label style="font-size: 11px; font-weight: 700;">Item / Service Name *</label>
            <input type="text" class="form-input" placeholder="e.g. Cotton Polo T-Shirt" value="${escapeHtml(item.name || '')}" required style="font-size: 12.5px; height: 38px;" oninput="onInvoiceLineItemChange(${idx}, 'name', this.value)">
          </div>
        </div>

        <!-- SKU, HSN, Qty, Rate, GST Slab -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1.2fr 1fr; gap: 8px;">
          <div class="form-group" style="margin: 0;">
            <label style="font-size: 11px; font-weight: 700;">SKU / Code</label>
            <input type="text" class="form-input" placeholder="SKU-001" value="${escapeHtml(item.sku || '')}" style="font-size: 12px; height: 36px;" oninput="onInvoiceLineItemChange(${idx}, 'sku', this.value)">
          </div>
          <div class="form-group" style="margin: 0;">
            <label style="font-size: 11px; font-weight: 700;">HSN / SAC</label>
            <input type="text" class="form-input" placeholder="610910" value="${escapeHtml(item.hsn || '610910')}" style="font-size: 12px; height: 36px;" oninput="onInvoiceLineItemChange(${idx}, 'hsn', this.value)">
          </div>
          <div class="form-group" style="margin: 0;">
            <label style="font-size: 11px; font-weight: 700;">Quantity *</label>
            <input type="number" class="form-input" min="1" step="1" value="${item.qty || 1}" required style="font-size: 12px; height: 36px; font-weight: 700;" oninput="onInvoiceLineItemChange(${idx}, 'qty', this.value)">
          </div>
          <div class="form-group" style="margin: 0;">
            <label style="font-size: 11px; font-weight: 700;">Unit Rate (₹) *</label>
            <input type="number" class="form-input" min="0" step="0.01" value="${item.unitRate || 0}" required style="font-size: 12px; height: 36px; font-weight: 700;" oninput="onInvoiceLineItemChange(${idx}, 'unitRate', this.value)">
          </div>
          <div class="form-group" style="margin: 0;">
            <label style="font-size: 11px; font-weight: 700;">GST Slab</label>
            <select class="form-input" style="font-size: 12px; height: 36px;" onchange="onInvoiceLineItemChange(${idx}, 'gstRate', this.value)">
              <option value="0" ${item.gstRate === 0 ? 'selected' : ''}>0% (Exempt)</option>
              <option value="5" ${item.gstRate === 5 ? 'selected' : ''}>5% GST</option>
              <option value="12" ${item.gstRate === 12 ? 'selected' : ''}>12% GST</option>
              <option value="18" ${item.gstRate === 18 ? 'selected' : ''}>18% GST</option>
              <option value="28" ${item.gstRate === 28 ? 'selected' : ''}>28% GST</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function addInvoiceLineItem() {
  genInvoiceLineItems.push({
    id: Date.now(),
    productId: '',
    name: '',
    sku: '',
    hsn: '610910',
    qty: 1,
    unitRate: 0,
    gstRate: 18
  });
  renderGenerateInvoiceItems();
  calculateGenerateInvoiceTotals();
}

function removeInvoiceLineItem(idx) {
  if (genInvoiceLineItems.length <= 1) return;
  genInvoiceLineItems.splice(idx, 1);
  renderGenerateInvoiceItems();
  calculateGenerateInvoiceTotals();
}

function onInvoiceProductSelect(idx, productId) {
  const item = genInvoiceLineItems[idx];
  if (!item) return;

  if (!productId) {
    item.productId = '';
  } else {
    const prod = (inventoryItems || []).find(p => String(p.id) === String(productId));
    if (prod) {
      item.productId = prod.id;
      item.name = prod.name || '';
      item.sku = prod.sku || '';
      item.hsn = prod.hsn || '610910';
      item.unitRate = prod.sellingPrice || prod.costPrice || 0;
      if (prod.gstRate != null) item.gstRate = prod.gstRate;
    }
  }
  renderGenerateInvoiceItems();
  calculateGenerateInvoiceTotals();
}

function onInvoiceLineItemChange(idx, field, value) {
  const item = genInvoiceLineItems[idx];
  if (!item) return;

  if (field === 'qty') item.qty = Math.max(1, parseInt(value) || 1);
  else if (field === 'unitRate') item.unitRate = Math.max(0, parseFloat(value) || 0);
  else if (field === 'gstRate') item.gstRate = parseFloat(value) || 0;
  else item[field] = value;

  calculateGenerateInvoiceTotals();
}

function onInvoiceGstinChange(gstin) {
  if (!gstin || gstin.length < 2) return;
  const stateCode = gstin.substring(0, 2);
  const matchedState = GSTIN_STATE_CODES[stateCode];
  if (matchedState) {
    const stateSelect = document.getElementById('genInvBuyerState');
    if (stateSelect) {
      stateSelect.value = matchedState;
      calculateGenerateInvoiceTotals();
    }
  }
}

function calculateGenerateInvoiceTotals() {
  const sellerState = localStorage.getItem('lynxora_company_state') || 'Gujarat';
  const buyerState = document.getElementById('genInvBuyerState')?.value || sellerState;
  const isInterState = buyerState.trim().toLowerCase() !== sellerState.trim().toLowerCase();

  const badge = document.getElementById('genInvSupplyTypeBadge');
  if (badge) {
    if (isInterState) {
      badge.textContent = 'Inter-State (IGST 100%)';
      badge.style.background = 'rgba(37,99,235,0.12)';
      badge.style.color = '#2563eb';
    } else {
      badge.textContent = 'Intra-State (CGST 50% + SGST 50%)';
      badge.style.background = 'rgba(5,150,105,0.12)';
      badge.style.color = '#059669';
    }
  }

  let totalTaxable = 0;
  let totalTax = 0;

  genInvoiceLineItems.forEach(it => {
    const qty = Number(it.qty) || 1;
    const rate = Number(it.unitRate) || 0;
    const taxable = qty * rate;
    const tax = taxable * ((Number(it.gstRate) || 0) / 100);
    totalTaxable += taxable;
    totalTax += tax;
  });

  const grandTotal = totalTaxable + totalTax;

  setText('genInvTaxableSum', formatCurrency(totalTaxable));
  setText('genInvGstSum', formatCurrency(totalTax));
  setText('genInvGrandTotal', formatCurrency(grandTotal));
  setText('genInvInWords', numberToIndianWords(Math.round(grandTotal)));
}

function handleGenerateInvoiceSubmit(event) {
  if (event) event.preventDefault();

  const buyerName = (document.getElementById('genInvBuyerName')?.value || '').trim();
  if (!buyerName) {
    showToast('Please enter customer / buyer name.', 'error');
    return;
  }

  if (genInvoiceLineItems.length === 0) {
    showToast('Please add at least one line item.', 'error');
    return;
  }

  // Validate items
  for (let i = 0; i < genInvoiceLineItems.length; i++) {
    const it = genInvoiceLineItems[i];
    if (!it.name || !it.name.trim()) {
      showToast(`Please enter name for Item #${i + 1}`, 'error');
      return;
    }
    if ((Number(it.qty) || 0) <= 0) {
      showToast(`Invalid quantity for Item #${i + 1}`, 'error');
      return;
    }
  }

  const invoiceNumber = (document.getElementById('genInvNumber')?.value || '').trim() || getNextInvoiceNumber();
  const invoiceDate = document.getElementById('genInvDate')?.value || new Date().toISOString().split('T')[0];
  const channel = document.getElementById('genInvChannel')?.value || 'Bank Transfer';
  const buyerGstin = (document.getElementById('genInvBuyerGstin')?.value || '').trim().toUpperCase();
  const buyerState = document.getElementById('genInvBuyerState')?.value || 'Gujarat';
  const buyerPhone = (document.getElementById('genInvBuyerPhone')?.value || '').trim();
  const buyerEmail = (document.getElementById('genInvBuyerEmail')?.value || '').trim();
  const buyerAddress = (document.getElementById('genInvBuyerAddress')?.value || '').trim();
  const notes = (document.getElementById('genInvNotes')?.value || '').trim();

  const reflectFinance = document.getElementById('genInvReflectFinance')?.checked ?? true;
  const deductStock = document.getElementById('genInvDeductStock')?.checked ?? true;

  const sellerState = localStorage.getItem('lynxora_company_state') || 'Gujarat';
  const isInterState = buyerState.trim().toLowerCase() !== sellerState.trim().toLowerCase();

  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  const processedItems = genInvoiceLineItems.map(it => {
    const qty = Number(it.qty) || 1;
    const unitRate = Number(it.unitRate) || 0;
    const gstRate = Number(it.gstRate) || 0;
    const taxableAmount = qty * unitRate;
    const lineTax = taxableAmount * (gstRate / 100);

    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
    if (isInterState) {
      igstAmount = lineTax;
      totalIgst += lineTax;
    } else {
      cgstAmount = lineTax / 2;
      sgstAmount = lineTax / 2;
      totalCgst += cgstAmount;
      totalSgst += sgstAmount;
    }

    totalTaxable += taxableAmount;

    return {
      productId: it.productId || null,
      name: it.name.trim(),
      sku: (it.sku || 'SKU').trim(),
      hsn: (it.hsn || '610910').trim(),
      qty: qty,
      unitRate: unitRate,
      priceType: 'exclusive',
      taxableAmount: taxableAmount,
      gstRate: gstRate,
      cgstAmount: cgstAmount,
      sgstAmount: sgstAmount,
      igstAmount: igstAmount,
      total: taxableAmount + lineTax
    };
  });

  const taxTotal = isInterState ? totalIgst : (totalCgst + totalSgst);
  const grossTotal = totalTaxable + taxTotal;

  const invoiceId = 'INV_' + Date.now();
  let financialRecordId = null;

  // 1. Reflect in Financial Records if selected
  if (reflectFinance && grossTotal > 0) {
    financialRecordId = Date.now();
    const itemSummary = processedItems.map(it => `${it.qty}x ${it.name}`).join(', ');
    const salesRecord = {
      id: financialRecordId,
      date: invoiceDate,
      description: `Sales: ${buyerName} [${invoiceNumber}] - ${itemSummary}`,
      type: 'Income',
      category: 'Sales Revenue',
      partyName: buyerName,
      source: 'Tax Invoice',
      paymentMethod: channel === 'Cash' ? 'Cash' : 'Bank',
      amount: grossTotal,
      notes: `Generated via Tax Invoice ${invoiceNumber}. Taxable: ${formatCurrency(totalTaxable)}, GST: ${formatCurrency(taxTotal)}`
    };
    records.unshift(salesRecord);
    saveRecords(`Recorded sales revenue from invoice ${invoiceNumber}`);
    populateCategoryFilter();
  }

  // 2. Build Invoice Object
  const newInvoice = {
    id: invoiceId,
    invoiceNumber: invoiceNumber,
    date: invoiceDate,
    createdAt: new Date().toISOString(),
    seller: {
      name: localStorage.getItem('lynxora_company') || 'Lynxora',
      state: sellerState,
      gstin: localStorage.getItem('lynxora_company_gstin') || '24AAACL1234F1Z5',
      address: localStorage.getItem('lynxora_company_address') || '',
      phone: localStorage.getItem('lynxora_company_phone') || '',
      email: localStorage.getItem('lynxora_company_email') || '',
      bankName: localStorage.getItem('lynxora_bank_name') || '',
      bankAccount: localStorage.getItem('lynxora_bank_account') || '',
      bankIfsc: localStorage.getItem('lynxora_bank_ifsc') || '',
      bankUpi: localStorage.getItem('lynxora_bank_upi') || ''
    },
    buyer: {
      name: buyerName,
      phone: buyerPhone,
      email: buyerEmail,
      address: buyerAddress,
      gstin: buyerGstin,
      state: buyerState
    },
    isInterState: isInterState,
    items: processedItems,
    taxableAmount: totalTaxable,
    cgstAmount: totalCgst,
    sgstAmount: totalSgst,
    igstAmount: totalIgst,
    taxTotal: taxTotal,
    grossTotal: grossTotal,
    totalInWords: numberToIndianWords(Math.round(grossTotal)),
    paymentChannel: channel,
    notes: notes,
    recordId: financialRecordId
  };

  invoices.unshift(newInvoice);
  saveInvoices(`Created Tax Invoice ${invoiceNumber}`);

  // 3. Deduct from Inventory & Log Stock Movements if selected
  if (deductStock) {
    let inventoryModified = false;
    processedItems.forEach(it => {
      const prod = (inventoryItems || []).find(p => (it.productId && String(p.id) === String(it.productId)) || (it.sku && p.sku === it.sku));
      if (prod) {
        prod.quantity = Math.max(0, (Number(prod.quantity) || 0) - it.qty);
        inventoryModified = true;

        stockMovements.unshift({
          id: Date.now() + Math.floor(Math.random() * 1000),
          date: new Date().toLocaleString(),
          type: 'SALE',
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          qty: it.qty,
          unitRate: it.unitRate,
          totalAmount: it.total,
          channel: channel,
          reason: `Sold via Tax Invoice ${invoiceNumber}`,
          reflectedInFinance: reflectFinance,
          recordId: financialRecordId,
          invoiceId: invoiceId
        });
      }
    });

    if (inventoryModified) {
      saveInventory();
      saveStockMovements(`Deducted stock for invoice ${invoiceNumber}`);
    }
  }

  // If this invoice was generated for an existing stock movement, associate it
  if (currentLinkingMovementId) {
    const linkedMv = (stockMovements || []).find(m => String(m.id) === String(currentLinkingMovementId));
    if (linkedMv) {
      linkedMv.invoiceId = invoiceId;
      if (financialRecordId && !linkedMv.recordId) {
        linkedMv.recordId = financialRecordId;
        linkedMv.reflectedInFinance = reflectFinance;
      }
      saveStockMovements(`Linked invoice ${invoiceNumber} to stock movement`);
    }
    currentLinkingMovementId = null;
  }

  // 4. Update UI
  updateDashboard();
  renderInventory();
  renderStockMovementsTable();
  renderRecordsTable();
  updateInvoicesHeaderBadge();

  closeGenerateInvoiceModal();
  openTaxInvoiceModal(invoiceId);

  showToast(`Tax Invoice ${invoiceNumber} created successfully! ✓`, 'success');
}

function openInvoicesManagerModal() {
  const overlay = document.getElementById('invoicesManagerModalOverlay');
  if (!overlay) return;

  renderInvoicesListModal();

  overlay.style.display = 'flex';
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeInvoicesManagerModal() {
  const overlay = document.getElementById('invoicesManagerModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function handleInvoicesManagerSearch(query) {
  renderInvoicesListModal(query);
}

function renderInvoicesListModal(filterQuery = '') {
  const tbody = document.getElementById('invoicesManagerTableBody');
  const countBadge = document.getElementById('invMgrCountBadge');
  const totalCountEl = document.getElementById('invMgrTotalCount');
  const totalValEl = document.getElementById('invMgrTotalValue');
  const totalGstEl = document.getElementById('invMgrTotalGst');

  const totalInvoices = invoices.length;
  const totalVal = invoices.reduce((s, i) => s + (Number(i.grossTotal) || 0), 0);
  const totalGst = invoices.reduce((s, i) => s + (Number(i.taxTotal) || 0), 0);

  if (countBadge) countBadge.textContent = `${totalInvoices} Invoices`;
  if (totalCountEl) totalCountEl.textContent = totalInvoices.toString();
  if (totalValEl) totalValEl.textContent = formatCurrency(totalVal);
  if (totalGstEl) totalGstEl.textContent = formatCurrency(totalGst);
  updateInvoicesHeaderBadge();

  if (!tbody) return;

  const query = (filterQuery || '').toLowerCase().trim();
  const filtered = query
    ? invoices.filter(inv => 
        (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(query)) ||
        (inv.buyer && inv.buyer.name && inv.buyer.name.toLowerCase().includes(query)) ||
        (inv.buyer && inv.buyer.gstin && inv.buyer.gstin.toLowerCase().includes(query)) ||
        (inv.buyer && inv.buyer.address && inv.buyer.address.toLowerCase().includes(query)) ||
        (inv.date && inv.date.includes(query))
      )
    : invoices;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--text-muted);font-size:13.5px;">${query ? 'No invoices match your search query.' : 'No tax invoices created yet. Click "+ Generate Invoice" to create one!'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(inv => {
    const itemsCount = (inv.items || []).length;
    const totalUnits = (inv.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const supplyState = inv.buyer?.state || 'Local';
    const isInterState = inv.isInterState;

    return `<tr>
      <td style="font-weight:800;color:#2563eb;font-family:monospace;font-size:13px;">${escapeHtml(inv.invoiceNumber || 'INV')}</td>
      <td style="font-size:12.5px;color:var(--text-2);">${inv.date || '—'}</td>
      <td>
        <div style="font-weight:700;color:var(--text-1);">${escapeHtml(inv.buyer?.name || 'Customer')}</div>
        ${inv.buyer?.gstin ? `<div style="font-size:11px;color:var(--text-muted);font-family:monospace;">GSTIN: ${escapeHtml(inv.buyer.gstin)}</div>` : ''}
      </td>
      <td>
        <span style="font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:6px;background:${isInterState ? 'rgba(37,99,235,0.1)' : 'rgba(5,150,105,0.1)'};color:${isInterState ? '#2563eb' : '#059669'};">
          ${escapeHtml(supplyState)} (${isInterState ? 'IGST' : 'CGST+SGST'})
        </span>
      </td>
      <td style="font-size:12px;color:var(--text-2);">${itemsCount} item(s) • ${totalUnits} units</td>
      <td style="text-align:right;font-size:12.5px;">${formatCurrency(inv.taxableAmount || 0)}</td>
      <td style="text-align:right;font-size:12.5px;font-weight:700;color:#2563eb;">${formatCurrency(inv.taxTotal || 0)}</td>
      <td style="text-align:right;font-weight:800;color:#059669;font-size:13.5px;">${formatCurrency(inv.grossTotal || 0)}</td>
      <td style="text-align:center;">
        <div style="display:inline-flex;gap:6px;align-items:center;">
          <button type="button" class="btn" onclick="closeInvoicesManagerModal(); openTaxInvoiceModal('${inv.id}')" title="View, Print & Download PDF" style="background:#2563eb;color:white;font-weight:700;padding:4px 10px;border-radius:6px;font-size:11.5px;border:none;cursor:pointer;display:inline-flex;align-items:center;gap:4px;box-shadow:0 1px 3px rgba(37,99,235,0.3);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>View / PDF</span>
          </button>
          <button type="button" class="btn btn-danger-sm" onclick="deleteTaxInvoice('${inv.id}')" title="Delete Tax Invoice" style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;padding:4px 8px;border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span>Delete</span>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function updateInvoicesHeaderBadge() {
  const el = document.getElementById('invHeaderCount');
  if (el) el.textContent = invoices.length.toString();
}

function deleteTaxInvoice(invoiceId) {
  const invIdStr = String(invoiceId);
  const inv = invoices.find(i => String(i.id) === invIdStr);
  if (!inv) return;

  openConfirmModal({
    title: 'Delete Tax Invoice?',
    message: `Are you sure you want to delete invoice <b>${escapeHtml(inv.invoiceNumber || invIdStr)}</b> for <b>${escapeHtml(inv.buyer?.name || 'Customer')}</b> (${formatCurrency(inv.grossTotal || 0)})?`,
    detailsHtml: `<div class="confirm-preview-row"><span class="confirm-preview-label">Invoice:</span><span class="confirm-preview-val"><b>${escapeHtml(inv.invoiceNumber || '')}</b> (${inv.date || ''})</span></div><div class="confirm-preview-row"><span class="confirm-preview-label">Buyer:</span><span class="confirm-preview-val">${escapeHtml(inv.buyer?.name || '')}</span></div><div class="confirm-preview-row"><span class="confirm-preview-label">Total Amount:</span><span class="confirm-preview-val" style="color:#059669;font-weight:800;">${formatCurrency(inv.grossTotal || 0)}</span></div>`,
    actionText: 'Yes, Delete Invoice',
    actionClass: 'btn-danger',
    onConfirm: () => {
      if (!deletedInvoiceIds.includes(invIdStr)) {
        deletedInvoiceIds.push(invIdStr);
        saveDeletedInvoiceIds();
      }
      invoices = invoices.filter(i => String(i.id) !== invIdStr);
      saveInvoices(`Deleted Tax Invoice ${inv.invoiceNumber || invIdStr}`);
      renderInvoicesListModal();
      updateDashboard();
      showToast(`Invoice ${inv.invoiceNumber || ''} deleted successfully.`, 'info');
    }
  });
}

// ==========================================
// STOCK FINANCIAL MOVEMENTS (SALES & LOSSES)
// ==========================================
let stockMovements = [];

function loadStockMovements() {
  const saved = localStorage.getItem('lynxora_stock_movements');
  if (saved) {
    try {
      stockMovements = JSON.parse(saved) || [];
      const delSet = new Set((deletedMovementIds || []).map(String));
      stockMovements = stockMovements.filter(m => m && m.id != null && !delSet.has(String(m.id)));
    } catch { stockMovements = []; }
  } else {
    stockMovements = [];
  }
}

function saveStockMovements(actionDesc = '') {
  localStorage.setItem('lynxora_stock_movements', JSON.stringify(stockMovements));
  if (typeof broadcastToCloud === 'function') {
    broadcastToCloud('stockMovements', actionDesc || 'Updated stock movement log');
  }
}

function downloadTaxInvoicePDFById(invoiceId) {
  const invIdStr = String(invoiceId);
  const inv = (invoices || []).find(i => String(i.id) === invIdStr || (i.invoiceNumber && i.invoiceNumber === invIdStr));
  if (!inv) {
    showToast('Invoice record not found.', 'error');
    return;
  }
  openTaxInvoiceModal(inv.id);
  setTimeout(() => {
    downloadTaxInvoicePDF();
  }, 250);
}

let stockMovementsSearchQuery = '';
let stockMovementsFilterType = 'ALL';

function handleStockMovementsSearch(query) {
  stockMovementsSearchQuery = (query || '').trim().toLowerCase();
  renderStockMovementsTable();
}

function handleStockMovementsFilter(type) {
  stockMovementsFilterType = type || 'ALL';
  renderStockMovementsTable();
}

function renderStockMovementsTable() {
  const tbody = document.getElementById('stockMovementsTableBody');
  const badge = document.getElementById('stockMovementsCountBadge');
  const statsEl = document.getElementById('stockMovementsFilterStats');
  if (badge) badge.textContent = `${stockMovements.length} Entries`;
  if (!tbody) return;

  if (stockMovements.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:28px;color:var(--text-muted);">No stock sales or losses recorded yet. Click "+ Generate Invoice", "Sell" or "Loss" on any product to record a transaction!</td></tr>`;
    if (statsEl) statsEl.textContent = 'Showing 0 entries';
    return;
  }

  // Filter operations
  let filtered = [...stockMovements];
  if (stockMovementsFilterType === 'INVOICE') {
    filtered = filtered.filter(m => !!m.invoiceId);
  } else if (stockMovementsFilterType !== 'ALL') {
    filtered = filtered.filter(m => m.type === stockMovementsFilterType);
  }

  // Search filter
  if (stockMovementsSearchQuery) {
    const q = stockMovementsSearchQuery;
    filtered = filtered.filter(m => {
      const inv = (invoices || []).find(i => String(i.id) === String(m.invoiceId) || (i.invoiceNumber && i.invoiceNumber === String(m.invoiceId)));
      return (m.productName && m.productName.toLowerCase().includes(q)) ||
             (m.sku && m.sku.toLowerCase().includes(q)) ||
             (m.reason && m.reason.toLowerCase().includes(q)) ||
             (m.channel && m.channel.toLowerCase().includes(q)) ||
             (m.invoiceId && String(m.invoiceId).toLowerCase().includes(q)) ||
             (inv && inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(q)) ||
             (inv && inv.buyer && inv.buyer.name && inv.buyer.name.toLowerCase().includes(q));
    });
  }

  if (statsEl) {
    if (stockMovementsSearchQuery || stockMovementsFilterType !== 'ALL') {
      statsEl.textContent = `Showing ${filtered.length} of ${stockMovements.length} entries`;
    } else {
      statsEl.textContent = `Showing all ${stockMovements.length} entries`;
    }
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:28px;color:var(--text-muted);">No movements match your search or filter.</td></tr>`;
    return;
  }

  const sorted = filtered.sort((a, b) => (b.id || 0) - (a.id || 0));
  tbody.innerHTML = sorted.map(m => {
    const isSale = m.type === 'SALE';
    const isLoss = m.type === 'LOSS';
    const opBadge = isSale
      ? '<span style="background:#dcfce7;color:#15803d;padding:3px 8px;border-radius:6px;font-size:11.5px;font-weight:800;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Customer Sale</span>'
      : isLoss
      ? '<span style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:6px;font-size:11.5px;font-weight:800;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Stock Loss</span>'
      : '<span style="background:#dbeafe;color:#1e40af;padding:3px 8px;border-radius:6px;font-size:11.5px;font-weight:800;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> Restock</span>';

    const impactColor = isSale ? '#059669' : isLoss ? '#dc2626' : '#2563eb';
    const impactSign = isSale ? '+' : isLoss ? '&minus;' : '+';
    const impactText = `${impactSign} ${formatCurrency(m.totalAmount || 0)} (${isSale ? 'Income' : isLoss ? 'Expense' : 'Stock Val'})`;

    const reflectedBadge = m.reflectedInFinance
      ? `<span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">&#10003; Dashboard &amp; Records</span>`
      : `<span style="color:#94a3b8;font-size:11px;">Stock Only</span>`;

    let invoiceCell = `<span style="color:var(--text-muted);font-size:11.5px;">—</span>`;
    if (m.invoiceId) {
      const inv = (invoices || []).find(i => String(i.id) === String(m.invoiceId) || (i.invoiceNumber && i.invoiceNumber === String(m.invoiceId)));
      const invNum = inv ? inv.invoiceNumber : m.invoiceId;
      const buyerName = inv?.buyer?.name || '';
      invoiceCell = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
          <span class="badge" style="font-family:monospace;font-size:11px;font-weight:800;color:#2563eb;background:rgba(37,99,235,0.1);padding:2px 7px;border-radius:4px;border:1px solid rgba(37,99,235,0.25);" title="${escapeHtml(buyerName ? 'Buyer: ' + buyerName : invNum)}">
            ${escapeHtml(invNum)}
          </span>
          <div style="display:inline-flex;align-items:center;gap:4px;">
            <button type="button" class="btn" onclick="openTaxInvoiceModal('${m.invoiceId}')" title="Check &amp; View Tax Invoice" style="background:#2563eb;color:white;font-weight:700;padding:3px 8px;border-radius:6px;font-size:11px;border:none;cursor:pointer;display:inline-flex;align-items:center;gap:3px;box-shadow:0 1px 3px rgba(37,99,235,0.25);">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <span>Check</span>
            </button>
            <button type="button" class="btn" onclick="downloadTaxInvoicePDFById('${m.invoiceId}')" title="Download Invoice PDF (A4)" style="background:#d97706;color:white;font-weight:700;padding:3px 8px;border-radius:6px;font-size:11px;border:none;cursor:pointer;display:inline-flex;align-items:center;gap:3px;box-shadow:0 1px 3px rgba(217,119,6,0.25);">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download</span>
            </button>
          </div>
        </div>
      `;
    } else if (isSale) {
      invoiceCell = `
        <button type="button" class="btn btn-ghost" onclick="openGenerateInvoiceForMovement('${m.id}')" title="Generate GST Tax Invoice for this Customer Sale" style="padding:4px 9px;font-size:11px;font-weight:700;color:#2563eb;border:1px dashed rgba(37,99,235,0.4);border-radius:6px;display:inline-flex;align-items:center;gap:3px;cursor:pointer;background:rgba(37,99,235,0.04);">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>+ Invoice</span>
        </button>
      `;
    }

    const deleteCell = `<button type="button" class="btn btn-danger-sm" onclick="deleteStockMovement('${m.id}')" title="Delete Movement Record &amp; Reconcile Stock" style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;padding:4px 8px;border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:all 0.15s;box-shadow:0 1px 2px rgba(220,38,38,0.15);" onmouseover="this.style.background='#fca5a5'" onmouseout="this.style.background='#fee2e2'"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Delete</span></button>`;

    return `<tr>
      <td style="font-size:12px;color:var(--text-2);">${m.date || ''}</td>
      <td>${opBadge}</td>
      <td><b>${escapeHtml(m.productName || '')}</b> <span style="font-size:11px;color:var(--text-muted);">(${escapeHtml(m.sku || '')})</span></td>
      <td style="font-weight:800;text-align:center;">${m.qty || 0}</td>
      <td>${formatCurrency(m.unitRate || 0)}</td>
      <td style="font-weight:800;color:${impactColor};">${impactText}</td>
      <td>${reflectedBadge}</td>
      <td style="font-size:12px;color:var(--text-2);">${escapeHtml(m.reason || m.channel || '—')}</td>
      <td style="text-align:center;">${invoiceCell}</td>
      <td style="text-align:center;">${deleteCell}</td>
    </tr>`;
  }).join('');
}

function deleteStockMovement(movementId) {
  const mvIdStr = String(movementId);
  const m = stockMovements.find(item => String(item.id) === mvIdStr);
  if (!m) return;

  const isSale = m.type === 'SALE';
  const isLoss = m.type === 'LOSS';
  const opName = isSale ? 'Customer Sale' : isLoss ? 'Stock Loss' : 'Restock';
  const opColor = isSale ? '#059669' : isLoss ? '#dc2626' : '#2563eb';
  
  let reversalMsg = '';
  if (isSale) {
    reversalMsg = `Returning +${m.qty} unit(s) back to available inventory catalogue.`;
  } else if (isLoss) {
    reversalMsg = `Restoring +${m.qty} unit(s) back to available inventory catalogue.`;
  } else {
    reversalMsg = `Deducting -${m.qty} unit(s) from inventory catalogue.`;
  }

  let financeMsg = '';
  if (m.recordId && m.reflectedInFinance) {
    financeMsg = `<div class="confirm-preview-row"><span class="confirm-preview-label">Financial Reconciliation:</span><span class="confirm-preview-val" style="color:#2563eb;font-weight:700;">Will remove linked ${isSale ? 'Income' : 'Expense'} transaction (${formatCurrency(m.totalAmount || 0)}) from P&amp;L Dashboard</span></div>`;
  }

  const detailsHtml = `
    <div class="confirm-preview-row"><span class="confirm-preview-label">Operation:</span><span class="confirm-preview-val" style="color:${opColor};font-weight:800;">${opName}</span></div>
    <div class="confirm-preview-row"><span class="confirm-preview-label">Product:</span><span class="confirm-preview-val"><b>${escapeHtml(m.productName || '')}</b> (${escapeHtml(m.sku || '')})</span></div>
    <div class="confirm-preview-row"><span class="confirm-preview-label">Quantity:</span><span class="confirm-preview-val">${m.qty || 0} unit(s)</span></div>
    <div class="confirm-preview-row"><span class="confirm-preview-label">Total Amount:</span><span class="confirm-preview-val" style="font-weight:800;color:${opColor};">${formatCurrency(m.totalAmount || 0)}</span></div>
    <div class="confirm-preview-row"><span class="confirm-preview-label">Stock Impact:</span><span class="confirm-preview-val" style="color:#059669;font-weight:700;">${reversalMsg}</span></div>
    ${financeMsg}
  `;

  openConfirmModal({
    title: 'Delete Stock Movement Record?',
    message: 'Are you sure you want to delete this stock movement? Stock quantity will be restored and any linked financial records will be automatically reconciled.',
    detailsHtml: detailsHtml,
    actionText: 'Yes, Delete & Revert Stock',
    actionClass: 'btn-danger',
    onConfirm: () => {
      // 1. Revert Inventory quantity
      const prod = inventoryItems.find(p => (m.productId && String(p.id) === String(m.productId)) || (m.sku && p.sku === m.sku));
      if (prod) {
        if (isSale || isLoss) {
          prod.quantity = (Number(prod.quantity) || 0) + Number(m.qty || 0);
        } else if (m.type === 'IN') {
          prod.quantity = Math.max(0, (Number(prod.quantity) || 0) - Number(m.qty || 0));
        }
        saveInventory();
      }

      // 2. Remove financial record from records array if linked
      if (m.recordId) {
        const recIdStr = String(m.recordId);
        if (!deletedRecordIds.includes(recIdStr)) {
          deletedRecordIds.push(recIdStr);
          saveDeletedRecordIds();
        }
        records = records.filter(r => String(r.id) !== recIdStr);
        saveRecords('Reconciled deleted stock movement');
        populateCategoryFilter();
      }

      // 3. Remove invoice if linked
      if (m.invoiceId) {
        const invIdStr = String(m.invoiceId);
        if (!deletedInvoiceIds.includes(invIdStr)) {
          deletedInvoiceIds.push(invIdStr);
          saveDeletedInvoiceIds();
        }
        invoices = invoices.filter(inv => String(inv.id) !== invIdStr);
        saveInvoices('Deleted invoice linked to deleted movement');
      }

      // 4. Mark movement as deleted in tombstones
      if (!deletedMovementIds.includes(mvIdStr)) {
        deletedMovementIds.push(mvIdStr);
        saveDeletedMovementIds();
      }

      // 5. Remove from stockMovements array
      stockMovements = stockMovements.filter(item => String(item.id) !== mvIdStr);
      saveStockMovements('Deleted stock movement ' + mvIdStr);

      // 6. Re-render UI
      updateDashboard();
      renderInventory();
      renderStockMovementsTable();
      renderRecordsTable();
      updateInvoicesHeaderBadge();
      showToast('Stock movement deleted. Inventory stock and financials reconciled! ✓', 'success');
    }
  });
}

function promptClearAllStockMovements() {
  if (stockMovements.length === 0) {
    showToast('No stock movements to clear.', 'info');
    return;
  }
  openConfirmModal({
    title: 'Clear All Stock Movement Logs?',
    message: `You are about to delete all <b>${stockMovements.length}</b> stock movement entries from this log. Your current inventory stock quantities and financial records will remain intact.`,
    actionText: 'Yes, Clear All Logs',
    actionClass: 'btn-danger',
    onConfirm: () => {
      stockMovements.forEach(m => {
        if (m && m.id != null) {
          const sId = String(m.id);
          if (!deletedMovementIds.includes(sId)) deletedMovementIds.push(sId);
        }
      });
      saveDeletedMovementIds();
      stockMovements = [];
      saveStockMovements('Cleared all stock movements');
      renderStockMovementsTable();
      showToast('All stock movement records cleared successfully. ✓', 'info');
    }
  });
}
function loadInventory() {
  const saved = localStorage.getItem('lynxora_inventory');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const delSet = new Set((deletedInventoryIds || []).map(String));
      inventoryItems = (Array.isArray(parsed) ? parsed : []).filter(i => i && i.id != null && !delSet.has(String(i.id)) && (!i.sku || !delSet.has(String(i.sku))));
    } catch {
      inventoryItems = [];
    }
  } else {
    inventoryItems = [];
  }
  loadInventoryCategories();
  loadSuppliers();
  loadProductNames();
  populateInventoryCategoryDropdowns();
  populateSupplierDropdown();
  populateProductNameDropdown();
}

function saveInventory(actionDesc = '', allowEmpty = false) {
  localStorage.setItem('lynxora_inventory', JSON.stringify(inventoryItems));
  updateDashboardInventoryOverview();
  if (typeof broadcastToCloud === 'function') {
    broadcastToCloud('inventory', actionDesc || (editingInvId ? 'Updated product details' : 'Updated inventory catalogue'), allowEmpty);
  }
}

function renderInventory() {
  // 1. Calculate Summary Metrics
  const totalSkus = inventoryItems.length;
  let totalUnits = 0;
  let totalCostValuation = 0;
  let totalRetailValuation = 0;
  let lowStockCount = 0;
  const categoriesSet = new Set();

  inventoryItems.forEach(item => {
    const qty = item.quantity || 0;
    const cost = item.costPrice || 0;
    const retail = item.sellingPrice || 0;
    totalUnits += qty;
    totalCostValuation += (qty * cost);
    totalRetailValuation += (qty * retail);
    if (qty <= (item.minStock || 10)) {
      lowStockCount++;
    }
    if (item.category) categoriesSet.add(item.category);
  });

  const potentialProfit = Math.max(0, totalRetailValuation - totalCostValuation);

  setText('invTotalSkus', totalSkus.toString());
  setText('invTotalCategories', `${categoriesSet.size} Categories`);
  setText('invTotalUnits', `${totalUnits} Units`);
  setText('invTotalValuation', formatCurrency(totalCostValuation));
  setText('invTotalRetailValuation', formatCurrency(totalRetailValuation));
  setText('invPotentialProfit', `+ ${formatCurrency(potentialProfit)} Profit`);
  setText('invLowStockCount', lowStockCount.toString());
  setText('invLowStockSub', lowStockCount > 0 ? `${lowStockCount} items need restock` : 'All Stock Healthy');

  // 2. Filter Products
  let filtered = inventoryItems.filter(item => {
    const q = (invSearchQuery || '').toLowerCase();
    const matchSearch = !q ||
      (item.name && item.name.toLowerCase().includes(q)) ||
      (item.sku && item.sku.toLowerCase().includes(q)) ||
      (item.category && item.category.toLowerCase().includes(q)) ||
      (item.supplier && item.supplier.toLowerCase().includes(q));

    const matchCat = invCategoryFilter === 'All' || item.category === invCategoryFilter;

    let matchStatus = true;
    const qty = item.quantity || 0;
    const minS = item.minStock || 10;
    if (invStatusFilter === 'in_stock') matchStatus = qty > minS;
    else if (invStatusFilter === 'low_stock') matchStatus = qty > 0 && qty <= minS;
    else if (invStatusFilter === 'out_of_stock') matchStatus = qty === 0;

    return matchSearch && matchCat && matchStatus;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / INV_PER_PAGE));
  if (invCurrentPage > totalPages) invCurrentPage = totalPages;
  const start = (invCurrentPage - 1) * INV_PER_PAGE;
  const page = filtered.slice(start, start + INV_PER_PAGE);

  const tbody = document.getElementById('inventoryTableBody');
  const emptyState = document.getElementById('invEmptyState');
  if (!tbody) return;

  if (total === 0) {
    if (emptyState) emptyState.style.display = 'block';
    tbody.innerHTML = '';
    setText('invRecordCount', 'Showing 0 products');
    buildInvPagination(totalPages);
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  const isViewer = currentUser && currentUser.role === 'viewer';
  const canDelete = !currentUser || currentUser.role !== 'viewer';
  const canEdit = currentUser && currentUser.role !== 'viewer';

  tbody.innerHTML = page.map(item => {
    const qty = item.quantity || 0;
    const minS = item.minStock || 10;
    const cost = item.costPrice || 0;
    const sell = item.sellingPrice || 0;
    const marginAmt = sell - cost;
    const marginPct = cost > 0 ? ((marginAmt / cost) * 100).toFixed(0) : '0';
    const totalVal = qty * cost;
    const itemIdStr = escapeHtml(String(item.id));

    let statusHtml = '';
    if (qty === 0) {
      statusHtml = '<span class="stock-pill stock-pill-out">0 Out of Stock</span>';
    } else if (qty <= minS) {
      statusHtml = `<span class="stock-pill stock-pill-low">${qty} Low Stock</span>`;
    } else {
      statusHtml = `<span class="stock-pill stock-pill-in">✓ ${qty} In Stock</span>`;
    }

    const supplierBadge = item.supplier
      ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;border:1px solid #bfdbfe;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 7v14M21 7v14M9 21V7M15 21V7M9 3h6v4H9z"/></svg> ${escapeHtml(item.supplier)}</span>`
      : '<span style="color:#94a3b8;">—</span>';

    return `<tr>
      <td data-label="SKU"><span class="inv-sku-badge">${escapeHtml(item.sku || 'SKU')}</span></td>
      <td data-label="Product"><b class="inv-product-name-link" onclick="openInventoryModal('${itemIdStr}')" title="Click to edit product details">${escapeHtml(item.name)}</b></td>
      <td data-label="Category"><span class="badge badge-transfer" style="font-size:11px;">${escapeHtml(item.category || 'Product')}</span></td>
      <td data-label="Supplier">${supplierBadge}</td>
      <td data-label="Cost Price" style="font-weight:600;color:#64748b;">${formatCurrency(cost)}</td>
      <td data-label="Selling Price" style="font-weight:700;color:#0f172a;">${formatCurrency(sell)}</td>
      <td data-label="Margin"><span class="margin-badge">+${marginPct}%</span></td>
      <td data-label="Stock">${statusHtml}</td>
      <td data-label="Valuation" style="font-weight:800;color:#059669;">${formatCurrency(totalVal)}</td>
      <td data-label="Actions" style="white-space:nowrap;">
        <div class="inv-action-cell" style="display:flex;align-items:center;gap:6px;">
          <button type="button" class="inv-sell-btn" onclick="openStockAdjustModal('${itemIdStr}', 'SALE')" title="Record Customer Sale &amp; Generate Invoice" style="display:inline-flex;align-items:center;gap:4px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span>Sell</span>
          </button>
          ${!isViewer ? `
          <button type="button" class="inv-action-dots-btn" onclick="openProductActionMenu(event, '${itemIdStr}')" title="More Actions (Edit, Loss, Restock, Delete)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="19" r="2.2"/></svg>
          </button>
          <button type="button" class="action-btn action-delete" onclick="deleteInventoryProduct('${itemIdStr}')" title="Delete Product from Inventory" style="width:32px;height:32px;border-radius:8px;border:1px solid #fee2e2;background:#fef2f2;color:#dc2626;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s ease;" onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='#fef2f2'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  setText('invRecordCount', `Showing ${start + 1}–${Math.min(start + INV_PER_PAGE, total)} of ${total} products`);
  buildInvPagination(totalPages);
  updateDashboardInventoryOverview();
}

// ══════════════════════════════════════════════════
//  CLEAN PRODUCT ACTION MENU (FLOATING DROPDOWN)
// ══════════════════════════════════════════════════
function openProductActionMenu(event, productId) {
  event.stopPropagation();
  const prodIdStr = String(productId);
  const item = inventoryItems.find(p => String(p.id) === prodIdStr || (p.sku && p.sku === prodIdStr));
  if (!item) return;

  const menu = document.getElementById('productActionFloatingMenu');
  if (!menu) return;

  // Toggle if already open on same product
  if (menu.classList.contains('active') && menu.dataset.activeProductId === prodIdStr) {
    closeProductActionMenu();
    return;
  }

  const canDelete = !currentUser || currentUser.role !== 'viewer';

  menu.dataset.activeProductId = prodIdStr;
  menu.innerHTML = `
    <button type="button" onclick="closeProductActionMenu(); openInventoryModal('${escapeHtml(prodIdStr)}')" style="display:flex;align-items:center;gap:8px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit Product Details
    </button>
    <button type="button" onclick="closeProductActionMenu(); openStockAdjustModal('${escapeHtml(prodIdStr)}', 'IN')" style="display:flex;align-items:center;gap:8px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> Restock / Adjust (&plusmn;)
    </button>
    <button type="button" onclick="closeProductActionMenu(); openStockAdjustModal('${escapeHtml(prodIdStr)}', 'LOSS')" style="display:flex;align-items:center;gap:8px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Record Stock Loss / Damage
    </button>
    ${canDelete ? `
    <div class="product-action-divider"></div>
    <button type="button" class="menu-danger" onclick="closeProductActionMenu(); deleteInventoryProduct('${escapeHtml(prodIdStr)}')" style="display:flex;align-items:center;gap:8px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Delete Product
    </button>` : ''}
  `;

  menu.classList.add('active');

  const rect = event.currentTarget.getBoundingClientRect();
  const menuWidth = 205;
  const menuHeight = menu.offsetHeight || 160;

  let left = rect.right - menuWidth;
  if (left < 10) left = 10;
  if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;

  let top = rect.bottom + 6;
  if (top + menuHeight > window.innerHeight - 10) {
    top = rect.top - menuHeight - 6;
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeProductActionMenu() {
  const menu = document.getElementById('productActionFloatingMenu');
  if (menu) menu.classList.remove('active');
}

// Close action menu on outside click or scroll
document.addEventListener('click', (e) => {
  const menu = document.getElementById('productActionFloatingMenu');
  if (menu && !menu.contains(e.target) && !e.target.closest('.inv-action-dots-btn')) {
    menu.classList.remove('active');
  }
});
window.addEventListener('scroll', () => {
  const menu = document.getElementById('productActionFloatingMenu');
  if (menu) menu.classList.remove('active');
}, true);

// ══════════════════════════════════════════════════
//  INVENTORY SCORECARD DRILLDOWN ENGINE
// ══════════════════════════════════════════════════
let currentInvDrilldownType = 'skus';
let currentInvDrilldownList = [];

function openInventoryDrilldown(type) {
  currentInvDrilldownType = type;
  const overlay = document.getElementById('invDrilldownModalOverlay');
  if (!overlay) return;

  const totalSkus = inventoryItems.length;
  let totalUnits = 0;
  let totalCostValuation = 0;
  let totalRetailValuation = 0;
  let lowStockCount = 0;

  inventoryItems.forEach(item => {
    const qty = Number(item.quantity) || 0;
    const cost = Number(item.costPrice) || 0;
    const sell = Number(item.sellingPrice) || 0;
    totalUnits += qty;
    totalCostValuation += (qty * cost);
    totalRetailValuation += (qty * sell);
    if (qty <= (Number(item.minStock) || 10)) {
      lowStockCount++;
    }
  });

  const potentialProfit = Math.max(0, totalRetailValuation - totalCostValuation);

  let iconSvg = '';
  let title = '';
  let subLabel = '';
  let metricLabel = '';
  let metricValue = '';
  let countPill = '';
  let theadHtml = '';

  const searchInput = document.getElementById('invDrilldownSearchInput');
  if (searchInput) searchInput.value = '';

  if (type === 'skus') {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
    title = 'Total SKUs / Products Catalogue';
    subLabel = 'Complete overview of all active product lines and variants';
    metricLabel = 'Total Cost Asset Valuation';
    metricValue = formatCurrency(totalCostValuation);
    countPill = `${totalSkus} Active Product${totalSkus === 1 ? '' : 's'}`;
    currentInvDrilldownList = [...inventoryItems];
    theadHtml = `<tr>
      <th>SKU</th>
      <th>Product Name</th>
      <th>Category</th>
      <th>Supplier</th>
      <th>Cost Price</th>
      <th>Selling Price</th>
      <th>Margin</th>
      <th>Stock Qty</th>
      <th>Valuation (Cost)</th>
      <th style="text-align:center;">Action</th>
    </tr>`;
  } else if (type === 'quantity') {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';
    title = 'Total Stock Units Breakdown';
    subLabel = 'Live quantity breakdown and stock level status by product';
    metricLabel = 'Total Available Stock Units';
    metricValue = `${totalUnits} Units`;
    countPill = `${totalSkus} Product Lines`;
    currentInvDrilldownList = [...inventoryItems];
    theadHtml = `<tr>
      <th>SKU</th>
      <th>Product Name</th>
      <th>Category</th>
      <th>Status</th>
      <th style="text-align:center;">Current Qty</th>
      <th style="text-align:center;">Min Level</th>
      <th>Shelf Location</th>
      <th>Asset Valuation</th>
      <th style="text-align:center;">Action</th>
    </tr>`;
  } else if (type === 'cost_valuation') {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>';
    title = 'Stock Valuation Breakdown (At Cost)';
    subLabel = 'Total capital invested in inventory based on unit purchase cost';
    metricLabel = 'Total Asset Valuation (Cost)';
    metricValue = formatCurrency(totalCostValuation);
    countPill = `${totalSkus} Products • ${totalUnits} Units`;
    currentInvDrilldownList = [...inventoryItems].sort((a, b) => ((Number(b.quantity) || 0) * (Number(b.costPrice) || 0)) - ((Number(a.quantity) || 0) * (Number(a.costPrice) || 0)));
    theadHtml = `<tr>
      <th>SKU</th>
      <th>Product Name</th>
      <th>Category</th>
      <th>Unit Cost</th>
      <th style="text-align:center;">Stock Qty</th>
      <th>Total Cost Value</th>
      <th>% of Total Asset</th>
      <th style="text-align:center;">Action</th>
    </tr>`;
  } else if (type === 'retail_valuation') {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>';
    title = 'Estimated Retail Value & Potential Gross Profit';
    subLabel = 'Projected gross revenue and earnings upon selling available inventory';
    metricLabel = 'Estimated Retail Revenue';
    metricValue = formatCurrency(totalRetailValuation);
    countPill = `+ ${formatCurrency(potentialProfit)} Gross Profit`;
    currentInvDrilldownList = [...inventoryItems].sort((a, b) => ((Number(b.quantity) || 0) * (Number(b.sellingPrice) || 0)) - ((Number(a.quantity) || 0) * (Number(a.sellingPrice) || 0)));
    theadHtml = `<tr>
      <th>SKU</th>
      <th>Product Name</th>
      <th>Unit Cost</th>
      <th>Selling Price</th>
      <th>Margin %</th>
      <th style="text-align:center;">Stock Qty</th>
      <th>Est. Retail Value</th>
      <th style="color:#059669;font-weight:700;">Potential Profit</th>
      <th style="text-align:center;">Action</th>
    </tr>`;
  } else if (type === 'low_stock') {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    title = 'Low Stock & Reorder Alert List';
    subLabel = 'Products that have reached or fallen below minimum safety reorder threshold';
    metricLabel = 'Products Needing Restock';
    metricValue = `${lowStockCount} Items`;
    countPill = lowStockCount > 0 ? 'Restock Required' : '✓ All Stock Healthy';
    currentInvDrilldownList = inventoryItems.filter(item => (Number(item.quantity) || 0) <= (Number(item.minStock) || 10));
    theadHtml = `<tr>
      <th>SKU</th>
      <th>Product Name</th>
      <th>Supplier / Vendor</th>
      <th style="text-align:center;">Available Qty</th>
      <th style="text-align:center;">Min Level</th>
      <th>Deficit Units</th>
      <th>Supplier Phone</th>
      <th style="text-align:center;">Urgent Action</th>
    </tr>`;
  }

  const iconEl = document.getElementById('invDrilldownIcon');
  if (iconEl) iconEl.innerHTML = iconSvg;
  setText('invDrilldownTitle', title);
  setText('invDrilldownSubLabel', subLabel);
  setText('invDrilldownMetricLabel', metricLabel);
  setText('invDrilldownMetricValue', metricValue);
  setText('invDrilldownCountPill', countPill);

  const thead = document.getElementById('invDrilldownThead');
  if (thead) thead.innerHTML = theadHtml;

  renderInvDrilldownRows(currentInvDrilldownList);
  overlay.classList.add('active');
}

function renderInvDrilldownRows(list) {
  const tbody = document.getElementById('invDrilldownTbody');
  if (!tbody) return;

  if (!list || list.length === 0) {
    if (currentInvDrilldownType === 'low_stock') {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:36px;color:#059669;font-weight:700;">All products are healthy! No items currently need reordering.</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:36px;color:#94a3b8;">No products found matching your search.</td></tr>`;
    }
    return;
  }

  let totalCostAll = 0;
  inventoryItems.forEach(i => { totalCostAll += (Number(i.quantity) || 0) * (Number(i.costPrice) || 0); });

  tbody.innerHTML = list.map(item => {
    const qty = Number(item.quantity) || 0;
    const minS = Number(item.minStock) || 10;
    const cost = Number(item.costPrice) || 0;
    const sell = Number(item.sellingPrice) || 0;
    const totalVal = qty * cost;
    const totalRetail = qty * sell;
    const profit = Math.max(0, totalRetail - totalVal);
    const marginPct = cost > 0 ? (((sell - cost) / cost) * 100).toFixed(0) : '0';
    const pctOfTotal = totalCostAll > 0 ? ((totalVal / totalCostAll) * 100).toFixed(1) : '0';

    let statusPill = qty === 0
      ? '<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;">Out of Stock</span>'
      : (qty <= minS
      ? `<span style="background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;">Low Stock (${qty})</span>`
      : `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;">✓ In Stock (${qty})</span>`);

    if (currentInvDrilldownType === 'skus') {
      return `<tr>
        <td><span class="inv-sku-badge">${escapeHtml(item.sku || 'SKU')}</span></td>
        <td><b class="inv-product-name-link" onclick="closeInventoryDrilldown(); openInventoryModal(${item.id});">${escapeHtml(item.name)}</b></td>
        <td><span class="badge badge-transfer" style="font-size:11px;">${escapeHtml(item.category || 'Product')}</span></td>
        <td>${escapeHtml(item.supplier || '—')}</td>
        <td style="color:#64748b;font-weight:600;">${formatCurrency(cost)}</td>
        <td style="font-weight:700;color:#0f172a;">${formatCurrency(sell)}</td>
        <td><span class="margin-badge">+${marginPct}%</span></td>
        <td style="font-weight:800;text-align:center;">${qty}</td>
        <td style="font-weight:800;color:#059669;">${formatCurrency(totalVal)}</td>
        <td style="text-align:center;white-space:nowrap;">
          <button type="button" class="btn btn-primary" onclick="closeInventoryDrilldown(); openStockAdjustModal(${item.id}, 'SALE');" style="padding:4px 10px;font-size:11px;font-weight:700;background:#059669;border-color:#059669;display:inline-flex;align-items:center;gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span>Sell</span>
          </button>
        </td>
      </tr>`;
    } else if (currentInvDrilldownType === 'quantity') {
      return `<tr>
        <td><span class="inv-sku-badge">${escapeHtml(item.sku || 'SKU')}</span></td>
        <td><b class="inv-product-name-link" onclick="closeInventoryDrilldown(); openInventoryModal(${item.id});">${escapeHtml(item.name)}</b></td>
        <td><span class="badge badge-transfer" style="font-size:11px;">${escapeHtml(item.category || 'Product')}</span></td>
        <td>${statusPill}</td>
        <td style="font-weight:800;font-size:14px;text-align:center;color:#0891b2;">${qty}</td>
        <td style="text-align:center;color:#64748b;">${minS}</td>
        <td><span style="font-family:monospace;font-size:11.5px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${escapeHtml(item.shelfLocation || 'Main Warehouse')}</span></td>
        <td style="font-weight:700;color:#059669;">${formatCurrency(totalVal)}</td>
        <td style="text-align:center;white-space:nowrap;">
          <button type="button" class="btn btn-ghost" onclick="closeInventoryDrilldown(); openStockAdjustModal(${item.id}, 'IN');" style="padding:4px 10px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            <span>Restock</span>
          </button>
        </td>
      </tr>`;
    } else if (currentInvDrilldownType === 'cost_valuation') {
      return `<tr>
        <td><span class="inv-sku-badge">${escapeHtml(item.sku || 'SKU')}</span></td>
        <td><b class="inv-product-name-link" onclick="closeInventoryDrilldown(); openInventoryModal(${item.id});">${escapeHtml(item.name)}</b></td>
        <td><span class="badge badge-transfer" style="font-size:11px;">${escapeHtml(item.category || 'Product')}</span></td>
        <td style="font-weight:600;color:#64748b;">${formatCurrency(cost)}</td>
        <td style="font-weight:800;text-align:center;">${qty}</td>
        <td style="font-weight:800;color:#059669;font-size:13.5px;">${formatCurrency(totalVal)}</td>
        <td><div style="display:flex;align-items:center;gap:6px;"><div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;"><div style="width:${Math.min(100, pctOfTotal)}%;height:100%;background:#059669;"></div></div><span style="font-size:11px;font-weight:700;color:#64748b;">${pctOfTotal}%</span></div></td>
        <td style="text-align:center;white-space:nowrap;">
          <button type="button" class="btn btn-primary" onclick="closeInventoryDrilldown(); openStockAdjustModal(${item.id}, 'SALE');" style="padding:4px 10px;font-size:11px;font-weight:700;background:#059669;border-color:#059669;display:inline-flex;align-items:center;gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span>Sell</span>
          </button>
        </td>
      </tr>`;
    } else if (currentInvDrilldownType === 'retail_valuation') {
      return `<tr>
        <td><span class="inv-sku-badge">${escapeHtml(item.sku || 'SKU')}</span></td>
        <td><b class="inv-product-name-link" onclick="closeInventoryDrilldown(); openInventoryModal(${item.id});">${escapeHtml(item.name)}</b></td>
        <td style="color:#64748b;">${formatCurrency(cost)}</td>
        <td style="font-weight:700;color:#0f172a;">${formatCurrency(sell)}</td>
        <td><span class="margin-badge">+${marginPct}%</span></td>
        <td style="font-weight:800;text-align:center;">${qty}</td>
        <td style="font-weight:800;color:#d97706;">${formatCurrency(totalRetail)}</td>
        <td style="font-weight:800;color:#059669;font-size:13.5px;">+${formatCurrency(profit)}</td>
        <td style="text-align:center;white-space:nowrap;">
          <button type="button" class="btn btn-primary" onclick="closeInventoryDrilldown(); openStockAdjustModal(${item.id}, 'SALE');" style="padding:4px 10px;font-size:11px;font-weight:700;background:#059669;border-color:#059669;display:inline-flex;align-items:center;gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span>Sell</span>
          </button>
        </td>
      </tr>`;
    } else if (currentInvDrilldownType === 'low_stock') {
      const deficit = Math.max(0, minS - qty);
      return `<tr>
        <td><span class="inv-sku-badge" style="border-color:#fca5a5;background:#fef2f2;color:#991b1b;">${escapeHtml(item.sku || 'SKU')}</span></td>
        <td><b class="inv-product-name-link" onclick="closeInventoryDrilldown(); openInventoryModal(${item.id});">${escapeHtml(item.name)}</b></td>
        <td>${escapeHtml(item.supplier || 'Direct')}</td>
        <td style="font-weight:800;font-size:14px;text-align:center;color:#dc2626;">${qty}</td>
        <td style="text-align:center;color:#64748b;font-weight:700;">${minS}</td>
        <td style="text-align:center;"><span style="background:#fee2e2;color:#dc2626;font-weight:800;padding:2px 8px;border-radius:10px;font-size:11px;">-${deficit} Units</span></td>
        <td style="font-size:12px;color:#64748b;">${escapeHtml(item.supplierPhone || '—')}</td>
        <td style="text-align:center;white-space:nowrap;">
          <button type="button" class="btn" onclick="closeInventoryDrilldown(); openStockAdjustModal(${item.id}, 'IN');" style="background:#ea580c;color:white;font-weight:800;padding:4px 12px;font-size:11px;border-radius:6px;border:none;cursor:pointer;box-shadow:0 1px 3px rgba(234,88,12,0.3);display:inline-flex;align-items:center;gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            <span>Reorder / Restock</span>
          </button>
        </td>
      </tr>`;
    }
  }).join('');
}

function filterInvDrilldown(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderInvDrilldownRows(currentInvDrilldownList);
    return;
  }
  const filtered = currentInvDrilldownList.filter(item => {
    return (item.name && item.name.toLowerCase().includes(q)) ||
      (item.sku && item.sku.toLowerCase().includes(q)) ||
      (item.category && item.category.toLowerCase().includes(q)) ||
      (item.supplier && item.supplier.toLowerCase().includes(q));
  });
  renderInvDrilldownRows(filtered);
}

function exportInvDrilldownCSV() {
  if (!currentInvDrilldownList || currentInvDrilldownList.length === 0) {
    showToast('No items to export.', 'info');
    return;
  }
  const headers = ['SKU', 'Product Name', 'Category', 'Supplier', 'Cost Price', 'Selling Price', 'Margin %', 'Stock Qty', 'Cost Valuation', 'Retail Valuation'];
  const rows = currentInvDrilldownList.map(item => {
    const cost = Number(item.costPrice) || 0;
    const sell = Number(item.sellingPrice) || 0;
    const qty = Number(item.quantity) || 0;
    const margin = cost > 0 ? (((sell - cost) / cost) * 100).toFixed(0) : '0';
    return [
      `"${(item.sku || '').replace(/"/g, '""')}"`,
      `"${(item.name || '').replace(/"/g, '""')}"`,
      `"${(item.category || '').replace(/"/g, '""')}"`,
      `"${(item.supplier || '').replace(/"/g, '""')}"`,
      cost,
      sell,
      `"${margin}%"`,
      qty,
      (qty * cost),
      (qty * sell)
    ].join(',');
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory_drilldown_${currentInvDrilldownType}_${new Date().toISOString().substring(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Inventory report downloaded as CSV! ✓', 'success');
}

function closeInventoryDrilldown() {
  const overlay = document.getElementById('invDrilldownModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

function updateDashboardInventoryOverview() {
  const totalSkus = inventoryItems.length;
  let totalUnits = 0;
  let totalCostVal = 0;
  let totalRetailVal = 0;
  let lowStockCount = 0;
  const categoriesSet = new Set();

  inventoryItems.forEach(item => {
    const qty = item.quantity || 0;
    const cost = item.costPrice || 0;
    const sell = item.sellingPrice || 0;
    totalUnits += qty;
    totalCostVal += (qty * cost);
    totalRetailVal += (qty * sell);
    if (qty <= (item.minStock || 10)) lowStockCount++;
    if (item.category) categoriesSet.add(item.category);
  });

  const potentialProfit = Math.max(0, totalRetailVal - totalCostVal);

  setText('dashInvTotalSkus', totalSkus.toString());
  setText('dashInvCategories', `${categoriesSet.size} Categories`);
  setText('dashInvTotalUnits', `${totalUnits} Units`);
  setText('dashInvTotalVal', formatCurrency(totalCostVal));
  setText('dashInvRetailVal', formatCurrency(totalRetailVal));
  setText('dashInvPotentialProfit', `+ ${formatCurrency(potentialProfit)} Margin`);
  setText('dashInvLowStockCount', lowStockCount.toString());
  setText('dashInvLowStockSub', lowStockCount > 0 ? `${lowStockCount} items need restock` : 'All Stock Healthy');

  const badge = document.getElementById('dashInvHealthBadge');
  if (badge) {
    if (lowStockCount > 0) {
      badge.style.background = 'rgba(225,29,72,0.12)';
      badge.style.color = '#e11d48';
      badge.textContent = `⚠️ ${lowStockCount} Low Stock Warnings`;
    } else {
      badge.style.background = 'rgba(16,185,129,0.12)';
      badge.style.color = '#059669';
      badge.textContent = '✓ Healthy Stock';
    }
  }

  const tbody = document.getElementById('dashInventoryTableBody');
  if (!tbody) return;

  if (inventoryItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#94a3b8;">No products in inventory yet. Click "+ Add Product" to get started.</td></tr>';
    return;
  }

  // Sort: low stock first, then by valuation descending
  const sorted = [...inventoryItems].sort((a, b) => {
    const aLow = (a.quantity || 0) <= (a.minStock || 10);
    const bLow = (b.quantity || 0) <= (b.minStock || 10);
    if (aLow && !bLow) return -1;
    if (!aLow && bLow) return 1;
    return ((b.quantity || 0) * (b.costPrice || 0)) - ((a.quantity || 0) * (a.costPrice || 0));
  }).slice(0, 6);

  tbody.innerHTML = sorted.map(item => {
    const qty = item.quantity || 0;
    const minS = item.minStock || 10;
    const cost = item.costPrice || 0;
    const totalVal = qty * cost;

    let statusHtml = '';
    if (qty === 0) {
      statusHtml = '<span class="stock-pill stock-pill-out" style="font-size:11px;">Out of Stock</span>';
    } else if (qty <= minS) {
      statusHtml = `<span class="stock-pill stock-pill-low" style="font-size:11px;">Low (${qty})</span>`;
    } else {
      statusHtml = `<span class="stock-pill stock-pill-in" style="font-size:11px;">In Stock</span>`;
    }

    const supplierBadge = item.supplier
      ? `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(37,99,235,0.08);color:var(--accent-blue,#2563eb);font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:1px solid rgba(37,99,235,0.2);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/></svg>${escapeHtml(item.supplier)}</span>`
      : '<span style="color:#94a3b8;">—</span>';

    return `<tr>
      <td><span class="inv-sku-badge">${escapeHtml(item.sku || 'SKU')}</span></td>
      <td><b>${escapeHtml(item.name)}</b></td>
      <td><span class="badge badge-transfer" style="font-size:11px;">${escapeHtml(item.category || 'Product')}</span></td>
      <td>${supplierBadge}</td>
      <td style="font-weight:700;">${qty} units</td>
      <td style="font-weight:800;color:#059669;">${formatCurrency(totalVal)}</td>
      <td>${statusHtml}</td>
      <td>
        <button class="stock-action-btn" onclick="openStockAdjustModal(${item.id})" style="padding:3px 8px;font-size:11px;" title="Quick Restock / Stock Out">
          <span>&plusmn; Adjust</span>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function buildInvPagination(totalPages) {
  const container = document.getElementById('invPagination');
  if (!container) return;
  let html = `<button class="page-btn" onclick="goToInvPage(${invCurrentPage - 1})" ${invCurrentPage === 1 ? 'disabled' : ''}>&#8249;</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages <= 7 || i === 1 || i === totalPages || Math.abs(i - invCurrentPage) <= 1)
      html += `<button class="page-btn ${i === invCurrentPage ? 'active' : ''}" onclick="goToInvPage(${i})">${i}</button>`;
    else if (Math.abs(i - invCurrentPage) === 2)
      html += `<span style="color:#94a3b8;padding:0 4px;">&#8230;</span>`;
  }
  html += `<button class="page-btn" onclick="goToInvPage(${invCurrentPage + 1})" ${invCurrentPage === totalPages ? 'disabled' : ''}>&#8250;</button>`;
  container.innerHTML = html;
}

function goToInvPage(p) {
  invCurrentPage = p;
  renderInventory();
  renderStockMovementsTable();
}

function handleInventorySearch(val) {
  invSearchQuery = val;
  invCurrentPage = 1;
  renderInventory();
  renderStockMovementsTable();
}

function handleInventoryFilter() {
  invCategoryFilter = document.getElementById('invCategoryFilter')?.value || 'All';
  invStatusFilter = document.getElementById('invStatusFilter')?.value || 'All';
  invCurrentPage = 1;
  renderInventory();
  renderStockMovementsTable();
}

function generateAutoSku() {
  const maxNumId = inventoryItems.reduce((max, i) => {
    const n = Number(i.id);
    return !isNaN(n) && n > max ? n : max;
  }, 0);
  const nextNum = maxNumId > 0 ? maxNumId + 1 : (inventoryItems.length + 1);
  const sku = `SKU-${1000 + nextNum}`;
  const skuInput = document.getElementById('invSku');
  if (skuInput) skuInput.value = sku;
}

function calculateInvMarginPreview() {
  const cost = parseFloat(document.getElementById('invCostPrice')?.value) || 0;
  const sell = parseFloat(document.getElementById('invSellingPrice')?.value) || 0;
  const marginEl = document.getElementById('invMarginVal');
  if (!marginEl) return;
  const marginAmt = sell - cost;
  const marginPct = cost > 0 ? ((marginAmt / cost) * 100).toFixed(1) : '0';
  marginEl.innerHTML = `<b style="color:${marginAmt >= 0 ? '#059669' : '#dc2626'}">${marginPct}% (${formatCurrency(marginAmt)})</b>`;
}

function openInventoryModal(id = null) {
  editingInvId = id ? String(id) : null;
  const overlay = document.getElementById('inventoryModalOverlay');
  const title = document.getElementById('invModalTitle');
  const submitBtn = document.getElementById('invSubmitBtn');
  const deleteBtn = document.getElementById('invModalDeleteBtn');
  const form = document.getElementById('inventoryForm');

  if (!overlay || !form) return;
  form.reset();

  populateProductNameDropdown();
  populateInventoryCategoryDropdowns();
  populateSupplierDropdown();

  if (editingInvId) {
    title.textContent = 'Edit Product';
    submitBtn.textContent = 'Save Changes';
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';
    const item = inventoryItems.find(i => String(i.id) === editingInvId || (i.sku && i.sku === editingInvId));
    if (item) {
      document.getElementById('invSku').value = item.sku || '';
      document.getElementById('invName').value = item.name || '';
      document.getElementById('invCategory').value = item.category || '';
      document.getElementById('invNewSupplier').value = item.supplier || '';
      document.getElementById('invCostPrice').value = item.costPrice || 0;
      document.getElementById('invSellingPrice').value = item.sellingPrice || 0;
      document.getElementById('invQuantity').value = item.quantity || 0;
      document.getElementById('invMinStock').value = item.minStock || 10;
      calculateInvMarginPreview();
    }
  } else {
    title.textContent = 'Add New Product';
    submitBtn.textContent = 'Add Product';
    if (deleteBtn) deleteBtn.style.display = 'none';
    document.getElementById('invName').value = '';
    document.getElementById('invCategory').value = '';
    document.getElementById('invNewSupplier').value = '';
    generateAutoSku();
    document.getElementById('invMinStock').value = 10;
    calculateInvMarginPreview();
  }

  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('invName')?.focus(), 150);
}

function closeInventoryModal() {
  const overlay = document.getElementById('inventoryModalOverlay');
  if (overlay) { overlay.classList.remove('active'); overlay.setAttribute('aria-hidden', 'true'); }
  editingInvId = null;
}

function handleInventoryFormSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const sku = document.getElementById('invSku')?.value.trim() || '';
  const name = document.getElementById('invName')?.value.trim() || '';
  const category = document.getElementById('invCategory')?.value.trim() || '';
  const supplier = document.getElementById('invNewSupplier')?.value.trim() || '';

  if (!name) {
    showToast('Please enter a Product Name.', 'error');
    document.getElementById('invName')?.focus();
    return;
  }

  // 1. Remember Product Name
  if (name && !knownProductNames.includes(name)) {
    knownProductNames.push(name);
    saveProductNames();
    populateProductNameDropdown();
  }

  // 2. Remember Category
  if (category && !inventoryCategories.includes(category)) {
    inventoryCategories.push(category);
    saveInventoryCategories();
    populateInventoryCategoryDropdowns();
  }

  // 3. Remember Supplier
  if (supplier && !knownSuppliers.includes(supplier)) {
    knownSuppliers.push(supplier);
    saveSuppliers();
    populateSupplierDropdown();
  }

  const costPrice = parseFloat(document.getElementById('invCostPrice')?.value) || 0;
  const sellingPrice = parseFloat(document.getElementById('invSellingPrice')?.value) || 0;
  const quantity = parseInt(document.getElementById('invQuantity')?.value) || 0;
  const minStock = parseInt(document.getElementById('invMinStock')?.value) || 10;

  const maxNumId = inventoryItems.reduce((max, i) => {
    const n = Number(i.id);
    return !isNaN(n) && n > max ? n : max;
  }, 0);
  const autoSku = 'SKU-' + (1001 + (maxNumId > 0 ? maxNumId : inventoryItems.length));
  const finalSku = sku || autoSku;

  if (editingInvId) {
    const idx = inventoryItems.findIndex(i => String(i.id) === String(editingInvId) || (i.sku && i.sku === String(editingInvId)));
    if (idx !== -1) {
      inventoryItems[idx] = { ...inventoryItems[idx], id: inventoryItems[idx].id, sku: finalSku, name, category, supplier, costPrice, sellingPrice, quantity, minStock, updatedAt: Date.now() };
      showToast('Product updated successfully! ✓', 'success');
    }
  } else {
    const newId = maxNumId > 0 ? maxNumId + 1 : Date.now();
    const sNewId = String(newId);
    if (deletedInventoryIds.includes(sNewId) || deletedInventoryIds.includes(finalSku)) {
      deletedInventoryIds = deletedInventoryIds.filter(d => d !== sNewId && d !== finalSku);
      saveDeletedInventoryIds();
    }
    inventoryItems.push({ id: newId, sku: finalSku, name, category, supplier, costPrice, sellingPrice, quantity, minStock, updatedAt: Date.now() });
    showToast('Product added to inventory! ✓', 'success');
  }

  saveInventory();
  closeInventoryModal();
  renderInventory();
  renderStockMovementsTable();
}

function closeStockAdjustModal() {
  const overlay = document.getElementById('stockAdjustModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
  }
  adjustingInvId = null;
}

function syncAdjustProductHeader() {
  const item = adjustingInvId ? inventoryItems.find(i => String(i.id) === String(adjustingInvId) || (i.sku && i.sku === String(adjustingInvId))) : null;
  if (!item) return;

  setText('adjustProdName', item.name);
  setText('adjustProdSku', item.sku || 'SKU');
  setText('adjustCurrentStock', item.quantity.toString());
  setText('adjustCostPriceDisplay', formatCurrency(item.costPrice || 0));
  setText('adjustSellPriceDisplay', formatCurrency(item.sellingPrice || 0));
}

function onAdjustProductChanged(newId) {
  const parsedId = parseInt(newId);
  if (!parsedId) return;
  adjustingInvId = parsedId;
  syncAdjustProductHeader();
  const op = document.getElementById('adjustOpType')?.value || 'SALE';
  setStockOpType(op);
}

function openStockAdjustModal(id = null, defaultOp = 'SALE') {
  if (!inventoryItems || inventoryItems.length === 0) {
    showToast('Your inventory catalogue is currently empty. Please add a product first!', 'info');
    navigateTo('inventory');
    openInventoryModal();
    return;
  }

  const overlay = document.getElementById('stockAdjustModalOverlay');
  const form = document.getElementById('stockAdjustForm');
  if (!overlay || !form) return;
  form.reset();

  const prodSelect = document.getElementById('adjustProductSelect');
  if (prodSelect) {
    prodSelect.innerHTML = inventoryItems.map(item => {
      return `<option value="${item.id}">${escapeHtml(item.name)} (${escapeHtml(item.sku || 'SKU')}) — Stock: ${item.quantity} | Sell: ${formatCurrency(item.sellingPrice || 0)}</option>`;
    }).join('');
  }

  if (id) {
    adjustingInvId = parseInt(id);
    if (prodSelect) prodSelect.value = id;
  } else {
    adjustingInvId = inventoryItems[0].id;
    if (prodSelect) prodSelect.value = adjustingInvId;
  }

  syncAdjustProductHeader();
  setStockOpType(defaultOp);

  // Reset invoice section
  const invChk = document.getElementById('generateTaxInvoiceCheck');
  if (invChk) invChk.checked = false;
  const invCont = document.getElementById('invoiceFieldsContainer');
  if (invCont) invCont.style.display = 'none';
  const buyerName = document.getElementById('invoiceBuyerName');
  if (buyerName) buyerName.value = '';
  const buyerPhone = document.getElementById('invoiceBuyerPhone');
  if (buyerPhone) buyerPhone.value = '';
  const buyerGstin = document.getElementById('invoiceBuyerGstin');
  if (buyerGstin) buyerGstin.value = '';
  const buyerAddr = document.getElementById('invoiceBuyerAddress');
  if (buyerAddr) buyerAddr.value = '';
  const invNum = document.getElementById('invoiceNumber');
  if (invNum) invNum.value = '';

  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    const qtyInput = document.getElementById('adjustQuantity');
    if (qtyInput) qtyInput.focus();
  }, 150);
}

function setStockOpType(op) {
  const opInput = document.getElementById('adjustOpType');
  if (opInput) opInput.value = op;

  const item = adjustingInvId ? inventoryItems.find(i => i.id === adjustingInvId) : null;
  const cost = item ? (item.costPrice || 0) : 0;
  const sell = item ? (item.sellingPrice || 0) : 0;

  const btnSale = document.getElementById('btnAdjustSale');
  const btnLoss = document.getElementById('btnAdjustLoss');
  const btnIn   = document.getElementById('btnAdjustIn');

  const saleOpts = document.getElementById('adjustSaleOptions');
  const lossOpts = document.getElementById('adjustLossOptions');
  const invoiceSection = document.getElementById('saleInvoiceToggleSection');
  const qtyLabel = document.getElementById('adjustQtyLabel');
  const rateLabel = document.getElementById('adjustRateLabel');
  const unitRateInput = document.getElementById('adjustUnitRate');
  const submitBtn = document.getElementById('adjustSubmitBtn');

  // Reset button styles
  [btnSale, btnLoss, btnIn].forEach(b => {
    if (b) {
      b.style.borderColor = 'var(--border)';
      b.style.background = 'var(--input-bg)';
      b.style.color = 'var(--text-2)';
    }
  });

  if (op === 'SALE') {
    if (btnSale) {
      btnSale.style.borderColor = '#059669';
      btnSale.style.background = '#f0fdf4';
      btnSale.style.color = '#059669';
    }
    if (saleOpts) saleOpts.style.display = 'block';
    if (lossOpts) lossOpts.style.display = 'none';
    if (invoiceSection) invoiceSection.style.display = 'block';
    if (qtyLabel) qtyLabel.textContent = 'Quantity Sold';
    if (rateLabel) rateLabel.innerHTML = 'Selling Price per Unit (&#8377;)';
    if (unitRateInput) unitRateInput.value = sell.toFixed(2);
    if (submitBtn) {
      submitBtn.style.background = '#059669';
      submitBtn.style.borderColor = '#059669';
      submitBtn.innerHTML = '<span>Confirm &amp; Record Sale (Income)</span>';
    }
  } else if (op === 'LOSS') {
    if (btnLoss) {
      btnLoss.style.borderColor = '#dc2626';
      btnLoss.style.background = '#fef2f2';
      btnLoss.style.color = '#dc2626';
    }
    if (saleOpts) saleOpts.style.display = 'none';
    if (lossOpts) lossOpts.style.display = 'block';
    if (invoiceSection) invoiceSection.style.display = 'none';
    toggleSaleInvoiceFields(false);
    if (qtyLabel) qtyLabel.textContent = 'Quantity Lost / Damaged';
    if (rateLabel) rateLabel.innerHTML = 'Valuation Cost Rate (&#8377;)';
    if (unitRateInput) unitRateInput.value = cost.toFixed(2);
    if (submitBtn) {
      submitBtn.style.background = '#dc2626';
      submitBtn.style.borderColor = '#dc2626';
      submitBtn.innerHTML = '<span>Confirm &amp; Record Stock Loss (Expense)</span>';
    }
  } else {
    // IN (Restock)
    if (btnIn) {
      btnIn.style.borderColor = '#2563eb';
      btnIn.style.background = '#eff6ff';
      btnIn.style.color = '#2563eb';
    }
    if (saleOpts) saleOpts.style.display = 'none';
    if (lossOpts) lossOpts.style.display = 'none';
    if (invoiceSection) invoiceSection.style.display = 'none';
    toggleSaleInvoiceFields(false);
    if (qtyLabel) qtyLabel.textContent = 'Quantity to Restock (In)';
    if (rateLabel) rateLabel.innerHTML = 'Purchase Unit Cost (&#8377;)';
    if (unitRateInput) unitRateInput.value = cost.toFixed(2);
    if (submitBtn) {
      submitBtn.style.background = '#2563eb';
      submitBtn.style.borderColor = '#2563eb';
      submitBtn.innerHTML = '<span>Apply Restock</span>';
    }
  }

  recalcStockFinancialImpact();
}

function recalcStockFinancialImpact() {
  const op = document.getElementById('adjustOpType')?.value || 'SALE';
  const qty = parseInt(document.getElementById('adjustQuantity')?.value) || 0;
  const rate = parseFloat(document.getElementById('adjustUnitRate')?.value) || 0;
  const total = qty * rate;

  const impactBox = document.getElementById('adjustFinancialImpactBox');
  const impactTitle = document.getElementById('adjustImpactTitle');
  const impactAmount = document.getElementById('adjustImpactAmount');
  const impactNote = document.getElementById('adjustImpactNote');

  if (op === 'SALE') {
    if (impactBox) {
      impactBox.style.background = 'linear-gradient(135deg, #f0fdf4, #dcfce7)';
      impactBox.style.borderColor = '#86efac';
    }
    if (impactTitle) impactTitle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:middle;margin-right:4px;"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Financial Money Inflow (Income)';
    if (impactAmount) {
      impactAmount.style.color = '#059669';
      impactAmount.textContent = `+ ${formatCurrency(total)}`;
    }
    if (impactNote) impactNote.innerHTML = `This <b>${formatCurrency(total)}</b> will be added to <b>Net Income</b> &amp; <b>Cash on Hand</b> in your Dashboard and recorded under <b>Sales Revenue</b>.`;
  } else if (op === 'LOSS') {
    if (impactBox) {
      impactBox.style.background = 'linear-gradient(135deg, #fef2f2, #fee2e2)';
      impactBox.style.borderColor = '#fca5a5';
    }
    if (impactTitle) impactTitle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:middle;margin-right:4px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Financial Loss to Record (Expense)';
    if (impactAmount) {
      impactAmount.style.color = '#dc2626';
      impactAmount.innerHTML = `&minus; ${formatCurrency(total)}`;
    }
    if (impactNote) impactNote.innerHTML = `This <b>${formatCurrency(total)}</b> will be recorded as an Expense under <b>Stock Loss / Damaged Goods</b>. It increases <b>Total Expenses</b> and reduces <b>Net Profit</b> in your Dashboard.`;
  } else {
    // IN
    if (impactBox) {
      impactBox.style.background = 'linear-gradient(135deg, #eff6ff, #dbeafe)';
      impactBox.style.borderColor = '#93c5fd';
    }
    if (impactTitle) impactTitle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:middle;margin-right:4px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> Inventory Stock Valuation Inflow';
    if (impactAmount) {
      impactAmount.style.color = '#2563eb';
      impactAmount.textContent = `+ ${formatCurrency(total)}`;
    }
    if (impactNote) impactNote.innerHTML = `Adds <b>${qty} units</b> to your live stock catalogue and increases total inventory cost asset value.`;
  }
}

function handleStockAdjustSubmit(e) {
  e.preventDefault();
  if (!adjustingInvId) return;
  const item = inventoryItems.find(i => i.id === adjustingInvId);
  if (!item) return;

  const op = document.getElementById('adjustOpType')?.value || 'SALE';
  const qty = parseInt(document.getElementById('adjustQuantity')?.value) || 0;
  const unitRate = parseFloat(document.getElementById('adjustUnitRate')?.value) || 0;
  const totalAmount = qty * unitRate;
  const reason = document.getElementById('adjustReason')?.value.trim() || '';
  const channel = document.getElementById('adjustPaymentChannel')?.value || 'Bank / UPI';
  const lossReason = document.getElementById('adjustLossReason')?.value || 'Damaged in Warehouse / Handling';
  const reflectFinance = document.getElementById('adjustReflectFinance')?.checked ?? true;
  const today = new Date().toISOString().split('T')[0];

  if (qty <= 0) {
    showToast('Please enter a valid quantity greater than 0.', 'error');
    return;
  }

  if ((op === 'SALE' || op === 'LOSS') && qty > item.quantity) {
    showToast(`Cannot deduct ${qty} units. Current available stock is only ${item.quantity}.`, 'error');
    return;
  }

  const wantInvoice = (op === 'SALE') && (document.getElementById('generateTaxInvoiceCheck')?.checked ?? false);
  let buyerName = '';
  let buyerPhone = '';
  let buyerGstin = '';
  let buyerState = 'Gujarat';
  let buyerAddress = '';
  let invoiceNo = '';
  let gstRate = 18;
  let priceType = 'inclusive';

  if (wantInvoice) {
    buyerName = document.getElementById('invoiceBuyerName')?.value.trim() || '';
    if (!buyerName) {
      showToast('Please enter Party / Customer Name for the Tax Invoice.', 'error');
      document.getElementById('invoiceBuyerName')?.focus();
      return;
    }
    buyerPhone = document.getElementById('invoiceBuyerPhone')?.value.trim() || '';
    buyerGstin = document.getElementById('invoiceBuyerGstin')?.value.trim().toUpperCase() || '';
    buyerState = document.getElementById('invoicePlaceOfSupply')?.value || 'Gujarat';
    buyerAddress = document.getElementById('invoiceBuyerAddress')?.value.trim() || '';
    invoiceNo = document.getElementById('invoiceNumber')?.value.trim() || getNextInvoiceNumber();
    gstRate = parseFloat(document.getElementById('invoiceGstRate')?.value) || 18;
    priceType = document.getElementById('invoicePriceType')?.value || 'inclusive';
  }

  let transactionRecordId = null;
  let generatedInvoiceId = null;

  if (op === 'SALE') {
    item.quantity -= qty;

    if (reflectFinance && totalAmount > 0) {
      transactionRecordId = Date.now();
      const saleRecord = {
        id: transactionRecordId,
        date: today,
        description: `Sale: ${qty}x ${item.name} (${item.sku})${buyerName ? ' to ' + buyerName : ''}${reason ? ' - ' + reason : ''}`,
        type: 'Income',
        category: 'Sales Revenue',
        source: channel,
        paymentMethod: (channel === 'Cash in Hand') ? 'Cash' : 'Bank',
        amount: totalAmount,
        notes: `Direct Inventory Sale of ${qty} units @ ${formatCurrency(unitRate)}`
      };
      records.unshift(saleRecord);
      saveRecords();
    }

    // Generate GST Tax Invoice if requested
    if (wantInvoice) {
      const sellerState = localStorage.getItem('lynxora_company_state') || 'Gujarat';
      const isInterState = (buyerState.toLowerCase() !== sellerState.toLowerCase()) && (buyerState !== 'Other' ? buyerState.toLowerCase() !== sellerState.toLowerCase() : true);

      let taxableAmount = 0;
      let grossTotal = 0;
      let taxTotal = 0;

      if (priceType === 'inclusive') {
        grossTotal = totalAmount;
        taxableAmount = grossTotal / (1 + (gstRate / 100));
        taxTotal = grossTotal - taxableAmount;
      } else {
        taxableAmount = totalAmount;
        taxTotal = taxableAmount * (gstRate / 100);
        grossTotal = taxableAmount + taxTotal;
      }

      let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
      if (isInterState) {
        igstAmount = taxTotal;
      } else {
        cgstAmount = taxTotal / 2;
        sgstAmount = taxTotal / 2;
      }

      const invObj = {
        id: 'INV_' + Date.now(),
        invoiceNumber: invoiceNo,
        date: today,
        seller: {
          name: localStorage.getItem('lynxora_company') || 'Lynxora',
          address: localStorage.getItem('lynxora_company_address') || 'Surat, Gujarat, India',
          gstin: localStorage.getItem('lynxora_company_gstin') || '24AAACL1234F1Z5',
          phone: localStorage.getItem('lynxora_company_phone') || '+91 98765 43210',
          email: localStorage.getItem('lynxora_company_email') || 'contact@lynxora.com',
          state: sellerState,
          stateCode: '24',
          bankName: localStorage.getItem('lynxora_bank_name') || 'HDFC Bank',
          bankAccount: localStorage.getItem('lynxora_bank_account') || '50200012345678',
          bankIfsc: localStorage.getItem('lynxora_bank_ifsc') || 'HDFC0001234',
          upiId: localStorage.getItem('lynxora_bank_upi') || 'lynxora@upi'
        },
        buyer: {
          name: buyerName,
          phone: buyerPhone,
          address: buyerAddress,
          gstin: buyerGstin,
          state: buyerState
        },
        isInterState: isInterState,
        items: [{
          productId: item.id,
          name: item.name,
          sku: item.sku || 'SKU',
          hsn: item.hsn || '610910',
          qty: qty,
          unitRate: unitRate,
          priceType: priceType,
          taxableAmount: taxableAmount,
          gstRate: gstRate,
          cgstAmount: cgstAmount,
          sgstAmount: sgstAmount,
          igstAmount: igstAmount,
          total: grossTotal
        }],
        taxableAmount: taxableAmount,
        cgstAmount: cgstAmount,
        sgstAmount: sgstAmount,
        igstAmount: igstAmount,
        taxTotal: taxTotal,
        grossTotal: grossTotal,
        totalInWords: numberToIndianWords(Math.round(grossTotal)),
        paymentChannel: channel,
        notes: reason
      };

      invoices.unshift(invObj);
      saveInvoices();
      generatedInvoiceId = invObj.id;
    }

    // Log Stock Movement
    stockMovements.unshift({
      id: Date.now(),
      date: new Date().toLocaleString(),
      type: 'SALE',
      productId: item.id,
      productName: item.name,
      sku: item.sku,
      qty, unitRate, totalAmount,
      channel, reason,
      reflectedInFinance: reflectFinance,
      recordId: transactionRecordId,
      invoiceId: generatedInvoiceId
    });
    saveStockMovements();

    showToast(`Sold ${qty}x ${item.name}! ${reflectFinance ? formatCurrency(totalAmount) + ' added to Sales Revenue & Dashboard!' : ''}`, 'success');

  } else if (op === 'LOSS') {
    item.quantity -= qty;

    if (reflectFinance && totalAmount > 0) {
      transactionRecordId = Date.now();
      const lossRecord = {
        id: transactionRecordId,
        date: today,
        description: `Stock Loss: ${qty}x ${item.name} (${item.sku}) [${lossReason}]${reason ? ' - ' + reason : ''}`,
        type: 'Expense',
        category: 'Stock Loss / Damaged Goods',
        source: 'Stock / Inventory Loss',
        paymentMethod: 'Bank',
        amount: totalAmount,
        notes: `Inventory Loss of ${qty} units @ Cost ${formatCurrency(unitRate)}: ${lossReason}`
      };
      records.unshift(lossRecord);
      saveRecords();
    }

    // Log Stock Movement
    stockMovements.unshift({
      id: Date.now(),
      date: new Date().toLocaleString(),
      type: 'LOSS',
      productId: item.id,
      productName: item.name,
      sku: item.sku,
      qty, unitRate, totalAmount,
      reason: `${lossReason}${reason ? ' (' + reason + ')' : ''}`,
      reflectedInFinance: reflectFinance,
      recordId: transactionRecordId
    });
    saveStockMovements();

    showToast(`Logged ${qty}x ${item.name} loss! ${reflectFinance ? formatCurrency(totalAmount) + ' recorded as Stock Loss expense in Dashboard.' : ''}`, 'info');

  } else {
    // RESTOCK (IN)
    item.quantity += qty;

    if (reflectFinance && totalAmount > 0) {
      transactionRecordId = Date.now();
      const purchaseRecord = {
        id: transactionRecordId,
        date: today,
        description: `Purchase Restock: ${qty}x ${item.name} (${item.sku})${reason ? ' - ' + reason : ''}`,
        type: 'Expense',
        category: 'Product Purchase / Inventory',
        source: 'Supplier / Vendor',
        paymentMethod: 'Bank',
        amount: totalAmount,
        notes: `Inventory Restock of ${qty} units @ Cost ${formatCurrency(unitRate)}`
      };
      records.unshift(purchaseRecord);
      saveRecords();
    }

    stockMovements.unshift({
      id: Date.now(),
      date: new Date().toLocaleString(),
      type: 'IN',
      productId: item.id,
      productName: item.name,
      sku: item.sku,
      qty, unitRate, totalAmount,
      reason: reason || 'Restock Purchase',
      reflectedInFinance: reflectFinance,
      recordId: transactionRecordId
    });
    saveStockMovements();

    showToast(`Restocked +${qty} units of ${item.name}!`, 'success');
  }

  saveInventory();
  closeStockAdjustModal();
  updateDashboard();
  renderInventory();
  renderStockMovementsTable();
  renderRecordsTable();

  if (generatedInvoiceId) {
    setTimeout(() => {
      openTaxInvoiceModal(generatedInvoiceId);
    }, 250);
  }
}

function deleteInventoryProduct(id) {
  const canDelete = !currentUser || currentUser.role !== 'viewer';
  if (!canDelete) {
    showToast('View-only accounts cannot delete products.', 'error');
    return;
  }

  const prodIdStr = String(id);
  const item = inventoryItems.find(i => String(i.id) === prodIdStr || (i.sku && i.sku === prodIdStr));
  if (!item) {
    showToast('Product not found or already deleted.', 'info');
    return;
  }

  const cost = Number(item.costPrice) || 0;
  const sell = Number(item.sellingPrice) || 0;
  const qty = Number(item.quantity) || 0;
  const totalVal = cost * qty;

  const detailsHtml = `
    <div style="background:var(--input-bg);border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;text-align:left;font-size:13px;display:flex;flex-direction:column;gap:6px;">
      <div class="confirm-preview-row"><span class="confirm-preview-label">Product Name:</span><span class="confirm-preview-val"><b>${escapeHtml(item.name)}</b></span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">SKU Code:</span><span class="confirm-preview-val"><span class="inv-sku-badge">${escapeHtml(item.sku || 'N/A')}</span></span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Category:</span><span class="confirm-preview-val"><b>${escapeHtml(item.category || 'General')}</b></span></div>
      ${item.supplier ? `<div class="confirm-preview-row"><span class="confirm-preview-label">Supplier:</span><span class="confirm-preview-val">${escapeHtml(item.supplier)}</span></div>` : ''}
      <div class="confirm-preview-row"><span class="confirm-preview-label">Stock Quantity:</span><span class="confirm-preview-val" style="font-weight:700;color:${qty === 0 ? '#dc2626' : '#059669'};">${qty} In Stock</span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Cost Price:</span><span class="confirm-preview-val">${formatCurrency(cost)}</span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Selling Price:</span><span class="confirm-preview-val">${formatCurrency(sell)}</span></div>
      <div class="confirm-preview-row" style="margin-top:4px;padding-top:8px;border-top:1.5px dashed var(--border);"><span class="confirm-preview-label">Stock Valuation:</span><span class="confirm-preview-val" style="color:#059669;font-weight:800;font-size:16px;">${formatCurrency(totalVal)}</span></div>
    </div>
  `;

  openConfirmModal({
    title: `Delete Product "${item.name}"?`,
    message: `Are you sure you want to permanently delete <b>${escapeHtml(item.name)} (${escapeHtml(item.sku || prodIdStr)})</b> from your inventory catalogue? This action cannot be undone.`,
    detailsHtml: detailsHtml,
    actionText: 'Yes, Delete Product',
    actionClass: 'btn-danger',
    cancelText: '✕ Cancel / Keep',
    onConfirm: () => {
      const actualId = String(item.id);
      if (!deletedInventoryIds.includes(actualId)) {
        deletedInventoryIds.push(actualId);
      }
      if (item.sku && !deletedInventoryIds.includes(item.sku)) {
        deletedInventoryIds.push(item.sku);
      }
      saveDeletedInventoryIds();

      inventoryItems = inventoryItems.filter(i => String(i.id) !== actualId && (!item.sku || i.sku !== item.sku));
      saveInventory(`Deleted product: ${item.name} (${item.sku || actualId})`, true);

      showToast(`Product "${item.name}" deleted successfully. ✓`, 'info');
      renderInventory();
      renderStockMovementsTable();
      updateDashboardInventoryOverview();
    }
  });
}

function promptClearAllInventory() {
  if (inventoryItems.length === 0) {
    showToast('Inventory is already empty.', 'info');
    return;
  }
  const canDelete = currentUser && (currentUser.role === 'owner' || currentUser.role === 'partner');
  if (!canDelete) {
    showToast('Only Owner and Partner accounts can clear all inventory.', 'error');
    return;
  }

  openConfirmModal({
    title: '⚠️ Clear ALL Products from Inventory?',
    message: `Are you sure you want to delete all <b>${inventoryItems.length} products</b> from your inventory catalogue? All product stock records will be removed across all devices and Cloud Sync.<br><br><span style="color:#dc2626;font-weight:700;">We recommend exporting an Inventory CSV backup first.</span>`,
    actionText: 'Yes, Clear All Products',
    actionClass: 'btn-danger',
    cancelText: '✕ Cancel / Keep',
    onConfirm: () => {
      inventoryItems.forEach(i => {
        if (i && i.id != null) {
          const sId = String(i.id);
          if (!deletedInventoryIds.includes(sId)) deletedInventoryIds.push(sId);
        }
        if (i && i.sku && !deletedInventoryIds.includes(i.sku)) {
          deletedInventoryIds.push(i.sku);
        }
      });
      saveDeletedInventoryIds();
      inventoryItems = [];
      saveInventory('Cleared all inventory products', true);
      showToast('All inventory products removed successfully. ✓', 'info');
      renderInventory();
      renderStockMovementsTable();
      updateDashboardInventoryOverview();
    }
  });
}

function exportInventoryCSV() {
  if (inventoryItems.length === 0) {
    showToast('No inventory items to export.', 'info');
    return;
  }

  let csv = 'SKU,Product Name,Category,Supplier,Cost Price,Selling Price,Stock Quantity,Min Stock,Valuation (Cost)\n';
  inventoryItems.forEach(i => {
    const val = (i.quantity || 0) * (i.costPrice || 0);
    csv += `"${i.sku}","${i.name}","${i.category}","${i.supplier || ''}",${i.costPrice},${i.sellingPrice},${i.quantity},${i.minStock},${val}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lynxora_inventory_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(a);
  showToast('Inventory CSV exported!', 'success');
}

// ══════════════════════════════════════════════════
//  AMAZON SELLER CENTRAL — 5 ACCOUNTS MANAGEMENT
// ══════════════════════════════════════════════════
const AMAZON_ACCOUNT_NAMES = ['Livvora', 'Heer Art', 'Heer Feshion', 'MKD Enterprise', 'Anand IT Sales'];
const AMAZON_ACCOUNT_ICONS = [
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="2"></line><line x1="8" y1="6" x2="10" y2="6"></line><line x1="14" y1="6" x2="16" y2="6"></line><line x1="8" y1="10" x2="10" y2="10"></line><line x1="14" y1="10" x2="16" y2="10"></line><line x1="8" y1="14" x2="10" y2="14"></line><line x1="14" y1="14" x2="16" y2="14"></line><line x1="8" y1="18" x2="10" y2="18"></line><line x1="14" y1="18" x2="16" y2="18"></line></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>'
];
const AMAZON_ACCOUNT_COLORS = ['#ea580c', '#2563eb', '#7c3aed', '#059669', '#0891b2'];

let amazonAccounts = [];
let amazonOrders = [];

function loadAmazonAccounts() {
  const saved = localStorage.getItem('lynxora_amazon_accounts');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      amazonAccounts = Array.isArray(parsed) ? parsed : createDefaultAmazonAccounts();
    } catch { amazonAccounts = createDefaultAmazonAccounts(); }
  } else {
    amazonAccounts = createDefaultAmazonAccounts();
  }
  const savedOrders = localStorage.getItem('lynxora_amazon_orders');
  if (savedOrders) {
    try {
      const parsed = JSON.parse(savedOrders);
      amazonOrders = Array.isArray(parsed) ? parsed : [];
    } catch { amazonOrders = []; }
  }
}

function createDefaultAmazonAccounts() {
  return AMAZON_ACCOUNT_NAMES.map((name, i) => ({
    name: name,
    sellerId: '',
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    marketplace: 'amazon.in',
    connected: false,
    lastSync: null
  }));
}

function saveAmazonAccounts() {
  localStorage.setItem('lynxora_amazon_accounts', JSON.stringify(amazonAccounts));
}

function saveAmazonOrders() {
  localStorage.setItem('lynxora_amazon_orders', JSON.stringify(amazonOrders));
}

function renderAmazonDashboard() {
  let totalOrders = 0, totalRevenue = 0, totalUnits = 0;

  amazonAccounts.forEach((acc, i) => {
    const accOrders = amazonOrders.filter(o => o.accountIndex === i);
    const accRevenue = accOrders.reduce((s, o) => s + (o.amount || 0), 0);
    const accUnits = accOrders.reduce((s, o) => s + (o.quantity || 1), 0);
    totalOrders += accOrders.length;
    totalRevenue += accRevenue;
    totalUnits += accUnits;

    setText(`amzOrders_${i}`, accOrders.length.toString());
    const revEl = document.getElementById(`amzRevenue_${i}`);
    if (revEl) revEl.textContent = formatCurrency(accRevenue);

    const sellerEl = document.getElementById(`amzSellerId_${i}`);
    if (sellerEl) sellerEl.textContent = acc.sellerId ? `Seller ID: ${acc.sellerId}` : 'Seller ID: Not Set';

    const statusEl = document.getElementById(`amzStatus_${i}`);
    if (statusEl) {
      statusEl.style.background = acc.connected ? '#22c55e' : '#94a3b8';
      statusEl.title = acc.connected ? 'Connected' : 'Not Connected';
    }
  });

  setText('amzTotalOrders', totalOrders.toString());
  const totalRevEl = document.getElementById('amzTotalRevenue');
  if (totalRevEl) totalRevEl.textContent = formatCurrency(totalRevenue);
  const avgEl = document.getElementById('amzAvgOrderValue');
  if (avgEl) avgEl.textContent = totalOrders > 0 ? formatCurrency(totalRevenue / totalOrders) : '₹0.00';
  setText('amzTotalUnitsSold', totalUnits.toString());

  // Render recent orders table
  const tbody = document.getElementById('dashAmazonOrdersBody');
  if (!tbody) return;

  if (amazonOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8;">No Amazon orders yet. Configure your accounts in Settings or Import CSV.</td></tr>';
    return;
  }

  const recent = [...amazonOrders].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 10);
  tbody.innerHTML = recent.map(order => {
    const accIdx = order.accountIndex || 0;
    const accName = AMAZON_ACCOUNT_NAMES[accIdx] || 'Unknown';
    const accColor = AMAZON_ACCOUNT_COLORS[accIdx] || '#64748b';
    const accIcon = AMAZON_ACCOUNT_ICONS[accIdx] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>';
    const statusBadge = order.status === 'Shipped' ? '<span style="background:#dcfce7;color:#059669;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">✓ Shipped</span>'
      : order.status === 'Cancelled' ? '<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">✕ Cancelled</span>'
      : order.status === 'Pending' ? '<span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">Pending</span>'
      : `<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">${escapeHtml(order.status || 'N/A')}</span>`;

    return `<tr>
      <td data-label="Account"><span style="display:inline-flex;align-items:center;gap:4px;font-weight:700;color:${accColor};font-size:12px;">${accIcon} ${escapeHtml(accName)}</span></td>
      <td data-label="Order ID" style="font-family:monospace;font-size:11.5px;font-weight:700;color:#475569;">${escapeHtml(order.orderId || 'N/A')}</td>
      <td data-label="Product" style="font-weight:600;">${escapeHtml(order.product || 'N/A')}</td>
      <td data-label="Qty" style="font-weight:700;text-align:center;">${order.quantity || 1}</td>
      <td data-label="Amount" style="font-weight:800;color:#059669;">${formatCurrency(order.amount || 0)}</td>
      <td data-label="Status">${statusBadge}</td>
      <td data-label="Date" style="font-size:12px;color:#64748b;">${order.date ? formatDate(order.date) : 'N/A'}</td>
    </tr>`;
  }).join('');
}

function renderAmazonSettings() {
  const container = document.getElementById('amazonAccountsConfig');
  if (!container) return;

  container.innerHTML = amazonAccounts.map((acc, i) => {
    const color = AMAZON_ACCOUNT_COLORS[i];
    const icon = AMAZON_ACCOUNT_ICONS[i];
    const statusDot = acc.connected
      ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;"></span> <span style="color:#059669;font-weight:700;font-size:11px;">Connected</span>'
      : '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#94a3b8;"></span> <span style="color:#94a3b8;font-weight:700;font-size:11px;">Not Connected</span>';

    return `<div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;border-left:4px solid ${color};">
      <div onclick="toggleAmzAccordion(${i})" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;background:#f8fafc;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:16px;">${icon}</span>
          <span style="font-weight:800;font-size:14px;color:#0f172a;">${escapeHtml(acc.name)}</span>
          <span style="display:flex;align-items:center;gap:4px;">${statusDot}</span>
        </div>
        <span style="color:#94a3b8;font-size:18px;" id="amzAccArrow_${i}">▸</span>
      </div>
      <div id="amzAccBody_${i}" style="display:none;padding:14px 16px;background:white;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group" style="margin-bottom:0;"><label style="font-size:12px;">Seller ID / Merchant Token</label><input type="text" class="form-input" id="amzSellerIdInput_${i}" placeholder="e.g. A21ABC1234XYZ" value="${escapeHtml(acc.sellerId || '')}"></div>
          <div class="form-group" style="margin-bottom:0;"><label style="font-size:12px;">Marketplace</label><select class="form-input" id="amzMarketplace_${i}"><option value="amazon.in" ${acc.marketplace === 'amazon.in' ? 'selected' : ''}>Amazon.in (India)</option><option value="amazon.com" ${acc.marketplace === 'amazon.com' ? 'selected' : ''}>Amazon.com (US)</option></select></div>
        </div>
        <div class="form-group" style="margin-top:10px;"><label style="font-size:12px;">LWA Client ID</label><input type="text" class="form-input" id="amzClientId_${i}" placeholder="amzn1.application-oa2-client..." value="${escapeHtml(acc.clientId || '')}"></div>
        <div class="form-group"><label style="font-size:12px;">LWA Client Secret</label><input type="password" class="form-input" id="amzClientSecret_${i}" placeholder="amzn1.oa2-cs.v1..." value="${escapeHtml(acc.clientSecret || '')}"></div>
        <div class="form-group"><label style="font-size:12px;">LWA Refresh Token</label><input type="password" class="form-input" id="amzRefreshToken_${i}" placeholder="Atzr|..." value="${escapeHtml(acc.refreshToken || '')}"></div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost" onclick="saveAmazonAccount(${i})" style="flex:1;justify-content:center;font-weight:700;display:inline-flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>Save Account ${i + 1}</span>
          </button>
          <button class="btn" onclick="testAmazonConnection(${i})" style="flex:1;justify-content:center;font-weight:700;background:${color};color:white;border:none;border-radius:8px;display:inline-flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span>Test Connection</span>
          </button>
        </div>
        ${acc.lastSync ? `<div style="font-size:11px;color:#94a3b8;margin-top:6px;text-align:center;">Last synced: ${acc.lastSync}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function toggleAmzAccordion(i) {
  const body = document.getElementById(`amzAccBody_${i}`);
  const arrow = document.getElementById(`amzAccArrow_${i}`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (arrow) arrow.textContent = isOpen ? '▸' : '▾';
}

function saveAmazonAccount(i) {
  amazonAccounts[i].sellerId = document.getElementById(`amzSellerIdInput_${i}`)?.value.trim() || '';
  amazonAccounts[i].marketplace = document.getElementById(`amzMarketplace_${i}`)?.value || 'amazon.in';
  amazonAccounts[i].clientId = document.getElementById(`amzClientId_${i}`)?.value.trim() || '';
  amazonAccounts[i].clientSecret = document.getElementById(`amzClientSecret_${i}`)?.value.trim() || '';
  amazonAccounts[i].refreshToken = document.getElementById(`amzRefreshToken_${i}`)?.value.trim() || '';
  amazonAccounts[i].connected = !!(amazonAccounts[i].sellerId && amazonAccounts[i].clientId && amazonAccounts[i].refreshToken);
  saveAmazonAccounts();
  renderAmazonSettings();
  renderAmazonDashboard();
  showToast(`${AMAZON_ACCOUNT_NAMES[i]} account saved!`, 'success');
}

function saveAllAmazonAccounts() {
  for (let i = 0; i < 5; i++) {
    amazonAccounts[i].sellerId = document.getElementById(`amzSellerIdInput_${i}`)?.value.trim() || '';
    amazonAccounts[i].marketplace = document.getElementById(`amzMarketplace_${i}`)?.value || 'amazon.in';
    amazonAccounts[i].clientId = document.getElementById(`amzClientId_${i}`)?.value.trim() || '';
    amazonAccounts[i].clientSecret = document.getElementById(`amzClientSecret_${i}`)?.value.trim() || '';
    amazonAccounts[i].refreshToken = document.getElementById(`amzRefreshToken_${i}`)?.value.trim() || '';
    amazonAccounts[i].connected = !!(amazonAccounts[i].sellerId && amazonAccounts[i].clientId && amazonAccounts[i].refreshToken);
  }
  saveAmazonAccounts();
  renderAmazonSettings();
  renderAmazonDashboard();
  showToast('All 5 Amazon accounts saved!', 'success');
}

function testAmazonConnection(i) {
  const acc = amazonAccounts[i];
  if (!acc.sellerId || !acc.clientId || !acc.refreshToken) {
    showToast(`Please fill Seller ID, Client ID, and Refresh Token for ${acc.name}.`, 'error');
    return;
  }
  showToast(`Testing ${acc.name} connection... (SP-API requires a backend proxy on your Hostinger server)`, 'info');
  // Mark as connected for UI preview purposes
  amazonAccounts[i].connected = true;
  amazonAccounts[i].lastSync = new Date().toLocaleString('en-IN');
  saveAmazonAccounts();
  renderAmazonSettings();
  renderAmazonDashboard();
}

function syncAllAmazonOrders() {
  const connected = amazonAccounts.filter(a => a.connected);
  if (connected.length === 0) {
    showToast('No Amazon accounts connected. Configure credentials in Settings first.', 'error');
    return;
  }
  const backendUrl = amzSyncSettings.backendUrl;
  if (!backendUrl) {
    showToast('Backend Proxy URL not set. Go to Settings → Amazon → Auto-Sync Engine and enter your server URL.', 'error');
    return;
  }
  showToast(`Syncing orders from ${connected.length} Amazon account(s)...`, 'info');
  amzSyncLog(`Sync started for ${connected.length} account(s)...`);

  let completed = 0;
  let totalImported = 0;

  amazonAccounts.forEach((acc, i) => {
    if (!acc.connected) return;

    const payload = {
      sellerId: acc.sellerId,
      clientId: acc.clientId,
      clientSecret: acc.clientSecret,
      refreshToken: acc.refreshToken,
      marketplace: acc.marketplace,
      createdAfter: acc.lastSync ? new Date(acc.lastSync).toISOString() : new Date(Date.now() - 7 * 86400000).toISOString()
    };

    fetch(backendUrl + '?action=get_orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => {
      completed++;
      if (data.success && data.orders) {
        let imported = 0;
        data.orders.forEach(order => {
          // Avoid duplicates
          if (amazonOrders.some(o => o.orderId === order.orderId && o.accountIndex === i)) return;

          amazonOrders.push({
            id: Date.now() + Math.random() * 10000,
            accountIndex: i,
            orderId: order.orderId,
            product: order.product || 'Amazon Product',
            sku: order.sku || '',
            quantity: order.quantity || 1,
            amount: order.amount || 0,
            status: order.status || 'Shipped',
            date: order.date || new Date().toISOString().split('T')[0]
          });

          // Auto-create income record
          const newRecId = records.length > 0 ? Math.max(...records.map(r => r.id)) + 1 : 1;
          records.push({
            id: newRecId,
            date: order.date || new Date().toISOString().split('T')[0],
            description: `Amazon Order #${order.orderId} — ${order.product || 'Product'} (Qty: ${order.quantity || 1}) [${acc.name}]`,
            type: 'Income',
            category: 'Amazon',
            amount: order.amount || 0,
            paymentMode: 'Online/UPI',
            partyName: acc.name,
            createdBy: currentUser?.name || 'System'
          });
          imported++;
        });

        if (imported > 0) totalImported += imported;

        amazonAccounts[i].lastSync = new Date().toLocaleString('en-IN');
        amzSyncLog(`✅ ${acc.name}: ${imported} new orders imported (${data.orderCount} total from API)`);
      } else {
        amzSyncLog(`⚠️ ${acc.name}: ${data.error || 'Unknown error'}`);
      }

      // When all accounts done
      if (completed >= connected.length) {
        saveAmazonOrders();
        saveAmazonAccounts();
        saveRecords();
        renderAmazonDashboard();
        if (activePage === 'dashboard') updateDashboard();
        if (activePage === 'settings') renderAmazonSettings();

        amzSyncSettings.lastSync = new Date().toISOString();
        saveAmzSyncSettings();
        updateAmzSyncUI();

        if (totalImported > 0) {
          showToast(`Auto-Sync complete! ${totalImported} new orders imported from ${completed} account(s).`, 'success');
        } else {
          showToast(`Sync complete. No new orders found across ${completed} account(s).`, 'info');
        }
        amzSyncLog(`Sync complete. Total new orders: ${totalImported}`);
      }
    })
    .catch(err => {
      completed++;
      amzSyncLog(`❌ ${acc.name}: Network error — ${err.message}`);
      if (completed >= connected.length) {
        updateAmzSyncUI();
        showToast(`Sync finished with errors. Check sync log in Settings.`, 'error');
      }
    });
  });
}

// ══════════════════════════════════════════════════
//  AUTO-SYNC ENGINE — Timer & Settings
// ══════════════════════════════════════════════════
let amzSyncSettings = { backendUrl: '', intervalMinutes: 0, lastSync: null, autoSyncEnabled: false };
let amzSyncTimerId = null;

function loadAmzSyncSettings() {
  const saved = localStorage.getItem('lynxora_amz_sync_settings');
  if (saved) {
    try {
      amzSyncSettings = { ...amzSyncSettings, ...JSON.parse(saved) };
    } catch {}
  }
}

function saveAmzSyncSettings() {
  const urlEl = document.getElementById('amzBackendUrl');
  const intervalEl = document.getElementById('amzSyncInterval');
  if (urlEl) amzSyncSettings.backendUrl = urlEl.value.trim();
  if (intervalEl) amzSyncSettings.intervalMinutes = parseInt(intervalEl.value) || 0;
  localStorage.setItem('lynxora_amz_sync_settings', JSON.stringify(amzSyncSettings));
  showToast('Sync settings saved!', 'success');
  updateAmzSyncUI();
}

function updateAmzSyncInterval() {
}

function toggleAmzAutoSync() {
  if (amzSyncTimerId) {
    clearInterval(amzSyncTimerId);
    amzSyncTimerId = null;
    amzSyncSettings.autoSyncEnabled = false;
    localStorage.setItem('lynxora_amz_sync_settings', JSON.stringify(amzSyncSettings));
    showToast('Auto-Sync stopped.', 'info');
    amzSyncLog('Auto-Sync stopped by user.');
  } else {
    const url = document.getElementById('amzBackendUrl')?.value.trim() || amzSyncSettings.backendUrl;
    const interval = parseInt(document.getElementById('amzSyncInterval')?.value) || amzSyncSettings.intervalMinutes;

    if (!url) {
      showToast('Please enter your Backend Proxy URL first.', 'error');
      return;
    }
    if (!interval || interval <= 0) {
      showToast('Please select a sync interval (not "Manual Only").', 'error');
      return;
    }

    amzSyncSettings.backendUrl = url;
    amzSyncSettings.intervalMinutes = interval;
    amzSyncSettings.autoSyncEnabled = true;
    localStorage.setItem('lynxora_amz_sync_settings', JSON.stringify(amzSyncSettings));

    syncAllAmazonOrders();
    amzSyncTimerId = setInterval(() => {
      amzSyncLog(`Auto-sync triggered (every ${interval} min)...`);
      syncAllAmazonOrders();
    }, interval * 60 * 1000);

    showToast(`✅ Auto-Sync started! Syncing every ${interval} minutes.`, 'success');
    amzSyncLog(`Auto-Sync started — interval: ${interval} min, URL: ${url}`);
  }
  updateAmzSyncUI();
}

function updateAmzSyncUI() {
  const badge = document.getElementById('amzAutoSyncStatusBadge');
  const btn = document.getElementById('amzAutoSyncToggleBtn');
  const lastSyncEl = document.getElementById('amzLastSyncTime');
  const dashBadge = document.getElementById('dashAmzSyncBadge');
  const urlEl = document.getElementById('amzBackendUrl');
  const intervalEl = document.getElementById('amzSyncInterval');

  if (urlEl && !urlEl.value) urlEl.value = amzSyncSettings.backendUrl || '';
  if (intervalEl) intervalEl.value = (amzSyncSettings.intervalMinutes || 0).toString();

  const isRunning = !!amzSyncTimerId;
  if (badge) {
    badge.textContent = isRunning ? 'RUNNING' : 'OFF';
    badge.style.background = isRunning ? 'rgba(5,150,105,0.15)' : '#f1f5f9';
    badge.style.color = isRunning ? '#059669' : '#64748b';
  }
  if (btn) {
    btn.textContent = isRunning ? '⏹ Stop Auto-Sync' : '▶ Start Auto-Sync';
    btn.style.background = isRunning ? '#dc2626' : '#059669';
  }
  if (lastSyncEl) {
    lastSyncEl.textContent = amzSyncSettings.lastSync
      ? `Last sync: ${new Date(amzSyncSettings.lastSync).toLocaleString('en-IN')}`
      : 'Last sync: Never';
  }
  if (dashBadge) {
    dashBadge.textContent = isRunning ? `Auto-Sync (${amzSyncSettings.intervalMinutes}m)` : 'Manual Sync';
    dashBadge.style.background = isRunning ? 'rgba(5,150,105,0.12)' : 'rgba(234,88,12,0.12)';
    dashBadge.style.color = isRunning ? '#059669' : '#ea580c';
  }
}

function amzSyncLog(msg) {
  const log = document.getElementById('amzSyncLog');
  if (!log) return;
  log.style.display = 'block';
  const time = new Date().toLocaleTimeString('en-IN');
  log.innerHTML = `[${time}] ${msg}<br>` + log.innerHTML;
  const lines = log.innerHTML.split('<br>');
  if (lines.length > 20) log.innerHTML = lines.slice(0, 20).join('<br>');
}

function restoreAutoSync() {
  loadAmzSyncSettings();
  if (amzSyncSettings.autoSyncEnabled && amzSyncSettings.backendUrl && amzSyncSettings.intervalMinutes > 0) {
    amzSyncTimerId = setInterval(() => {
      amzSyncLog(`Auto-sync triggered (every ${amzSyncSettings.intervalMinutes} min)...`);
      syncAllAmazonOrders();
    }, amzSyncSettings.intervalMinutes * 60 * 1000);
    amzSyncLog(`Auto-Sync restored from saved settings — interval: ${amzSyncSettings.intervalMinutes} min`);
  }
  updateAmzSyncUI();
}

function openAmazonImportModal() {
  const input = document.getElementById('amazonCsvImportInput');
  if (input) input.click();
}

function importAmazonOrdersCSV(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const separator = text.includes('\t') ? '\t' : ',';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      showToast('CSV file appears empty or invalid.', 'error');
      return;
    }

    const headers = lines[0].split(separator).map(h => h.replace(/"/g, '').trim().toLowerCase());
    let imported = 0;
    const accountSelect = prompt(
      'Which Amazon account is this CSV from?\n\n' +
      '1. Livvora\n2. Heer Art\n3. Heer Feshion\n4. MKD Enterprise\n5. Anand IT Sales\n\nEnter number (1-5):'
    );
    const accIdx = parseInt(accountSelect) - 1;
    if (isNaN(accIdx) || accIdx < 0 || accIdx > 4) {
      showToast('Invalid account selection. Please enter 1-5.', 'error');
      return;
    }

    const orderIdCol = headers.findIndex(h => h.includes('order') && h.includes('id'));
    const productCol = headers.findIndex(h => h.includes('product') || h.includes('title') || h.includes('item') || h.includes('sku'));
    const qtyCol = headers.findIndex(h => h.includes('qty') || h.includes('quantity'));
    const amountCol = headers.findIndex(h => h.includes('amount') || h.includes('price') || h.includes('total') || h.includes('item-price'));
    const statusCol = headers.findIndex(h => h.includes('status'));
    const dateCol = headers.findIndex(h => h.includes('date') || h.includes('purchase'));

    for (let r = 1; r < lines.length; r++) {
      const cols = lines[r].split(separator).map(c => c.replace(/"/g, '').trim());
      if (cols.length < 2) continue;

      const orderId = orderIdCol >= 0 ? cols[orderIdCol] : `AMZ-${Date.now()}-${r}`;
      const product = productCol >= 0 ? cols[productCol] : 'Amazon Product';
      const qty = qtyCol >= 0 ? (parseInt(cols[qtyCol]) || 1) : 1;
      const amount = amountCol >= 0 ? (parseFloat(cols[amountCol]) || 0) : 0;
      const status = statusCol >= 0 ? cols[statusCol] : 'Shipped';
      let date = dateCol >= 0 ? cols[dateCol] : new Date().toISOString().split('T')[0];

      if (date && !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        try {
          const parsed = new Date(date);
          if (!isNaN(parsed)) date = parsed.toISOString().split('T')[0];
          else date = new Date().toISOString().split('T')[0];
        } catch { date = new Date().toISOString().split('T')[0]; }
      }

      if (amazonOrders.some(o => o.orderId === orderId && o.accountIndex === accIdx)) continue;

      amazonOrders.push({
        id: Date.now() + r,
        accountIndex: accIdx,
        orderId,
        product,
        quantity: qty,
        amount,
        status,
        date
      });

      const newRecId = records.length > 0 ? Math.max(...records.map(r => r.id)) + 1 : 1;
      records.push({
        id: newRecId,
        date: date,
        description: `Amazon Order #${orderId} — ${product} (Qty: ${qty}) [${AMAZON_ACCOUNT_NAMES[accIdx]}]`,
        type: 'Income',
        category: 'Amazon',
        amount: amount,
        paymentMode: 'Online/UPI',
        partyName: AMAZON_ACCOUNT_NAMES[accIdx],
        createdBy: currentUser?.name || 'System'
      });
      imported++;
    }

    if (imported > 0) {
      saveAmazonOrders();
      saveRecords();
      renderAmazonDashboard();
      if (activePage === 'dashboard') updateDashboard();
      showToast(`✅ Imported ${imported} Amazon orders from ${AMAZON_ACCOUNT_NAMES[accIdx]} and auto-created ${imported} income records!`, 'success');
    } else {
      showToast('No new orders found in the CSV (duplicates or empty file).', 'info');
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════════
//  AMAZON LISTING PRICE TRACKING & REVERSE CALCULATOR
// ══════════════════════════════════════════════════
let trackedPricingList = [];
let editingPricingId = null;
let pricingTrackerSearchQuery = '';

function loadTrackedPricing() {
  const saved = localStorage.getItem('lynxora_price_tracker');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      trackedPricingList = Array.isArray(parsed) ? parsed : [];
    } catch {
      trackedPricingList = [];
    }
  } else {
    trackedPricingList = [];
  }
}

function saveTrackedPricing(actionDesc = '', allowEmpty = false) {
  localStorage.setItem('lynxora_price_tracker', JSON.stringify(trackedPricingList));
  if (typeof broadcastToCloud === 'function') {
    broadcastToCloud('amazonPriceTracker', actionDesc || (editingPricingId ? 'Updated Amazon tracked listing' : 'Added Amazon tracked listing'), allowEmpty);
  }
}

// ── DYNAMIC AMAZON REVERSE PRICE CALCULATION FORMULA (10-FACTOR) ──
// Derivation (all % values as decimals):
//   Amazon Fees         = SP*r + CF + SF
//   GST on Amz Fees     = (SP*r + CF + SF) * 0.18  → total = 1.18*(SP*r + CF + SF)
//   Product GST (Net)   = SP*g - COGS*g
//   Return Cost Impact  = (SF + RP) * RR
//   Target Profit       = SP * p
//
//   SP = COGS + 1.18*(SP*r + CF + SF) + SP*g - COGS*g + Ads + Rev + (SF+RP)*RR + SP*p
//   SP * (1 - 1.18*r - g - p) = COGS*(1-g) + 1.18*(CF+SF) + Ads + Rev + (SF+RP)*RR
//
//   SP = [ COGS*(1-g) + 1.18*(CF+SF) + Ads + Rev + (SF+RP)*RR ] / [ 1 - p - 1.18*r - g ]
// ── AMAZON CALCULATION MODES & AUTO-CLOSING FEE STATE ──
// ==========================================
// AMAZON PRICING SUB-TABS STATE & NAVIGATION
// ==========================================
let activeAmzSubtab = 'calculator'; // 'calculator' | 'tracker'

function switchAmzSubtab(tab) {
  activeAmzSubtab = tab;
  const calcView = document.getElementById('amzSubviewCalculator');
  const trackerView = document.getElementById('amzSubviewTracker');
  const calcBtn = document.getElementById('amzSubtabCalcBtn');
  const trackerBtn = document.getElementById('amzSubtabTrackerBtn');
  const viewHint = document.getElementById('amzSubtabViewHint');

  if (tab === 'tracker') {
    if (calcView) calcView.style.display = 'none';
    if (trackerView) trackerView.style.display = 'block';

    if (calcBtn) {
      calcBtn.classList.remove('active');
    }
    if (trackerBtn) {
      trackerBtn.classList.add('active');
    }
    if (viewHint) viewHint.textContent = 'View: Tracked Listings Table';
    renderPricingTrackerTable();
  } else {
    if (calcView) calcView.style.display = 'block';
    if (trackerView) trackerView.style.display = 'none';

    if (trackerBtn) {
      trackerBtn.classList.remove('active');
    }
    if (calcBtn) {
      calcBtn.classList.add('active');
    }
    if (viewHint) viewHint.textContent = 'View: Real-Time Calculator';
    calculateReversePrice();
  }
  updateAmzTrackedBadge();
}

function updateAmzTrackedBadge() {
  const count = (typeof trackedPricingList !== 'undefined' && Array.isArray(trackedPricingList)) ? trackedPricingList.length : 0;
  const badge = document.getElementById('amzTrackedCountBadge');
  if (badge) {
    badge.textContent = count.toString();
    if (count > 0) {
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
    } else {
      badge.style.background = '#f1f5f9';
      badge.style.color = '#64748b';
    }
  }
  const topbarCount = document.getElementById('amzTopbarTrackedCount');
  if (topbarCount) topbarCount.textContent = count.toString();
  const notice = document.getElementById('amzTrackedNoticeBanner');
  const noticeCount = document.getElementById('amzNoticeTrackedCount');
  if (notice) {
    if (count > 0 && activeAmzSubtab === 'calculator') {
      notice.style.display = 'flex';
      if (noticeCount) noticeCount.textContent = count.toString();
    } else {
      notice.style.display = 'none';
    }
  }
}

let amzCalcMode = 'A'; // 'A': Target Margin % -> SP | 'B': Manual Selling Price -> Profit & Margin
let amzAutoClosingFee = true; // Auto-apply Amazon India closing fee slabs

// Amazon India Standard Closing Fee Slabs
function getAmazonClosingFee(sp) {
  const p = parseFloat(sp) || 0;
  if (p <= 250) return 4;
  if (p <= 500) return 9;
  if (p <= 1000) return 30;
  return 61;
}

function getAmazonClosingFeeSlabText(sp) {
  const p = parseFloat(sp) || 0;
  if (p <= 250) return 'Auto: ₹4 (≤₹250 slab)';
  if (p <= 500) return 'Auto: ₹9 (₹251–₹500 slab)';
  if (p <= 1000) return 'Auto: ₹30 (₹501–₹1000 slab)';
  return 'Auto: ₹61 (>₹1000 slab)';
}

function setAmzCalcMode(mode) {
  amzCalcMode = mode;
  const btnA = document.getElementById('btnAmzModeA');
  const btnB = document.getElementById('btnAmzModeB');
  const manualCard = document.getElementById('amzManualSpCard');
  const manualStatus = document.getElementById('amzManualSpStatus');
  const modeBadge = document.getElementById('amzModeBadge');
  const profitContainer = document.getElementById('amzTargetProfitContainer');
  const profitTitle = document.getElementById('amzProfitLabelTitle');
  const bdLabel = document.getElementById('breakdownSellingPriceLabel');
  const bdBadge = document.getElementById('breakdownModeBadge');

  if (mode === 'B') {
    // Mode B: Manual Selling Price active
    if (btnA) {
      btnA.style.background = 'transparent';
      btnA.style.color = 'var(--text-2)';
      btnA.style.boxShadow = 'none';
      btnA.classList.remove('active');
    }
    if (btnB) {
      btnB.style.background = 'var(--card-solid)';
      btnB.style.color = 'var(--text-1)';
      btnB.style.boxShadow = 'var(--shadow-sm)';
      btnB.classList.add('active');
    }
    if (manualCard) {
      manualCard.style.border = '2px solid #3b82f6';
      manualCard.style.background = 'rgba(59, 130, 246, 0.12)';
    }
    if (manualStatus) manualStatus.textContent = 'Active: Direct Listing Price';
    if (modeBadge) {
      modeBadge.textContent = 'Direct Entry Mode';
      modeBadge.style.background = '#2563eb';
    }
    if (profitTitle) profitTitle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px;display:inline-block;"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>Resulting Profit Margin (% of SP)';
    if (profitContainer) {
      profitContainer.style.background = 'var(--input-bg)';
      profitContainer.style.borderColor = 'var(--border)';
    }
    if (bdLabel) bdLabel.textContent = 'Direct / Manual Selling Price (SP)';
    if (bdBadge) {
      bdBadge.textContent = 'Mode B: Manual SP';
      bdBadge.style.background = '#dbeafe';
      bdBadge.style.color = '#1d4ed8';
    }
  } else {
    // Mode A: Target Margin % active
    if (btnB) {
      btnB.style.background = 'transparent';
      btnB.style.color = 'var(--text-2)';
      btnB.style.boxShadow = 'none';
      btnB.classList.remove('active');
    }
    if (btnA) {
      btnA.style.background = 'var(--card-solid)';
      btnA.style.color = 'var(--text-1)';
      btnA.style.boxShadow = 'var(--shadow-sm)';
      btnA.classList.add('active');
    }
    if (manualCard) {
      manualCard.style.border = '1.5px solid var(--border)';
      manualCard.style.background = 'var(--input-bg)';
    }
    if (manualStatus) manualStatus.textContent = 'Calculated from Target Margin %';
    if (modeBadge) {
      modeBadge.textContent = 'Auto-Calculated';
      modeBadge.style.background = '#64748b';
    }
    if (profitTitle) profitTitle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px;display:inline-block;"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>10. Desired Profit Margin (% of Selling Price)';
    if (profitContainer) {
      profitContainer.style.background = 'linear-gradient(135deg, #f0fdf4, #dcfce7)';
      profitContainer.style.borderColor = '#86efac';
    }
    if (bdLabel) bdLabel.textContent = 'Suggested Final Selling Price (SP)';
    if (bdBadge) {
      bdBadge.textContent = 'Mode A: Target %';
      bdBadge.style.background = '#dcfce7';
      bdBadge.style.color = '#15803d';
    }
  }
  calculateReversePrice();
}

function onAmzManualSpInput(val) {
  if (amzCalcMode !== 'B') {
    setAmzCalcMode('B');
  } else {
    calculateReversePrice();
  }
}

function onAmzTargetProfitInput(val) {
  syncProfitSlider(val);
  if (amzCalcMode !== 'A') {
    setAmzCalcMode('A');
  } else {
    calculateReversePrice();
  }
}

function onAmzProfitSlider(val) {
  syncProfitInput(val);
  if (amzCalcMode !== 'A') {
    setAmzCalcMode('A');
  } else {
    calculateReversePrice();
  }
}

function toggleAutoClosingFee(checked) {
  amzAutoClosingFee = !!checked;
  const closingInput = document.getElementById('priceCalcClosingFee');
  if (closingInput) {
    closingInput.readOnly = amzAutoClosingFee;
    closingInput.style.background = amzAutoClosingFee ? '#f8fafc' : '#ffffff';
  }
  calculateReversePrice();
}

function onCustomClosingFeeChange(val) {
  const chk = document.getElementById('amzAutoClosingFeeCheck');
  if (chk && chk.checked) {
    chk.checked = false;
    amzAutoClosingFee = false;
  }
  calculateReversePrice();
}

let amzAdsUnit = 'flat'; // 'flat' (₹ / unit) or 'pct' (% of SP)

function setAmzAdsUnit(unit) {
  amzAdsUnit = unit === 'pct' ? 'pct' : 'flat';
  const btnFlat = document.getElementById('btnAmzAdsFlat');
  const btnPct = document.getElementById('btnAmzAdsPct');
  const prefix = document.getElementById('amzAdsUnitPrefix');
  if (btnFlat && btnPct) {
    if (amzAdsUnit === 'pct') {
      btnFlat.style.background = 'transparent';
      btnFlat.style.color = '#64748b';
      btnPct.style.background = '#2563eb';
      btnPct.style.color = '#fff';
      if (prefix) prefix.textContent = '%';
    } else {
      btnFlat.style.background = '#2563eb';
      btnFlat.style.color = '#fff';
      btnPct.style.background = 'transparent';
      btnPct.style.color = '#64748b';
      if (prefix) prefix.textContent = '₹';
    }
  }
  calculateReversePrice();
}

// ── DYNAMIC AMAZON PRICE CALCULATION FORMULA (DUAL-MODE) ──
function calculateReversePrice() {
  const cost          = parseFloat(document.getElementById('priceCalcCost')?.value)           || 0;
  const prodGstPct    = (parseFloat(document.getElementById('priceCalcProductGst')?.value)    || 0) / 100;
  const refPct        = (parseFloat(document.getElementById('priceCalcReferralPct')?.value)   || 0) / 100;
  const shippingFee   = parseFloat(document.getElementById('priceCalcShippingFee')?.value)    || 0;
  const adsInputVal   = parseFloat(document.getElementById('priceCalcAdsCost')?.value)        || 0;
  const reviewCost    = parseFloat(document.getElementById('priceCalcReviewCost')?.value)     || 0;
  const returnRate    = (parseFloat(document.getElementById('priceCalcReturnRate')?.value)    || 0) / 100;
  const returnPenalty = parseFloat(document.getElementById('priceCalcReturnPenalty')?.value)  || 0;
  let targetProfitPct = (parseFloat(document.getElementById('priceCalcTargetProfitPct')?.value) || 0) / 100;

  const amzGstMult = 1.18; // 18% GST on Amazon service fees
  const returnCostImpact = (shippingFee + returnPenalty) * returnRate;

  // Indian GST inclusive base ratio: k_gst = g / (1 + g)
  const gstFactor = prodGstPct > 0 ? (prodGstPct / (1 + prodGstPct)) : 0;
  const adPctRate = (amzAdsUnit === 'pct') ? (adsInputVal / 100) : 0;
  const adFlatAmount = (amzAdsUnit === 'pct') ? 0 : adsInputVal;

  let sp = 0;
  let closingFee = parseFloat(document.getElementById('priceCalcClosingFee')?.value) || 0;

  if (amzCalcMode === 'B') {
    // ──────── MODE B: MANUAL SELLING PRICE ────────
    const manualSpInput = document.getElementById('priceCalcManualSp');
    sp = parseFloat(manualSpInput?.value) || 0;

    // Evaluate Auto-Closing Fee based on manual SP
    if (amzAutoClosingFee) {
      closingFee = getAmazonClosingFee(sp);
      const closeInput = document.getElementById('priceCalcClosingFee');
      if (closeInput) closeInput.value = closingFee;
    }
  } else {
    // ──────── MODE A: TARGET MARGIN % → EXACT 4-SLAB PIECEWISE SOLVER ────────
    const baseFixedCost = (cost * (1 - gstFactor))
                        + (amzGstMult * shippingFee)
                        + adFlatAmount
                        + reviewCost
                        + returnCostImpact;

    if (amzAutoClosingFee) {
      // Evaluate 4 slabs:
      // Slab 1: SP <= 250, close = 4, ref = 0 (since SP <= 1000)
      // Slab 2: 250 < SP <= 500, close = 9, ref = 0
      // Slab 3: 500 < SP <= 1000, close = 30, ref = 0
      // Slab 4: SP > 1000, close = 61, ref = refPct (since SP > 1000)
      const slabs = [
        { min: 0,        max: 250,      close: 4,  hasRef: false },
        { min: 250.0001, max: 500,      close: 9,  hasRef: false },
        { min: 500.0001, max: 1000,     close: 30, hasRef: false },
        { min: 1000.0001, max: Infinity, close: 61, hasRef: true }
      ];

      let solvedSp = 0;
      let solvedClose = 30;

      for (const slab of slabs) {
        const slabRefRate = slab.hasRef ? (amzGstMult * refPct) : 0;
        const denom = 1 - targetProfitPct - slabRefRate - gstFactor - adPctRate;
        if (denom > 0.001) {
          const candSp = (baseFixedCost + (amzGstMult * slab.close)) / denom;
          if (candSp >= slab.min && candSp <= slab.max) {
            solvedSp = candSp;
            solvedClose = slab.close;
            break;
          }
        }
      }

      // If boundary discontinuity jump occurred across slabs
      if (solvedSp === 0) {
        const denomHigh = 1 - targetProfitPct - (amzGstMult * refPct) - gstFactor - adPctRate;
        if (denomHigh > 0.001) {
          solvedSp = (baseFixedCost + (amzGstMult * 61)) / denomHigh;
          solvedClose = 61;
        } else {
          solvedSp = 0;
          solvedClose = 30;
        }
      }

      sp = solvedSp;
      closingFee = solvedClose;
      const closeInput = document.getElementById('priceCalcClosingFee');
      if (closeInput) closeInput.value = closingFee;
    } else {
      // User specified a custom closing fee
      const denomNoRef = 1 - targetProfitPct - gstFactor - adPctRate;
      const candNoRef = denomNoRef > 0.001 ? ((baseFixedCost + (amzGstMult * closingFee)) / denomNoRef) : 0;
      if (candNoRef > 0 && candNoRef <= 1000) {
        sp = candNoRef;
      } else {
        const denomWithRef = 1 - targetProfitPct - (amzGstMult * refPct) - gstFactor - adPctRate;
        sp = denomWithRef > 0.001 ? ((baseFixedCost + (amzGstMult * closingFee)) / denomWithRef) : 0;
      }
    }

    // Sync calculated SP into the manual input without losing focus
    const manualSpInput = document.getElementById('priceCalcManualSp');
    if (manualSpInput && document.activeElement !== manualSpInput) {
      manualSpInput.value = sp > 0 ? sp.toFixed(2) : '0.00';
    }
  }

  // Update Closing Fee badge
  const slabBadge = document.getElementById('amzClosingFeeSlabBadge');
  if (slabBadge) {
    if (amzAutoClosingFee) {
      slabBadge.textContent = getAmazonClosingFeeSlabText(sp);
      slabBadge.style.background = '#e0e7ff';
      slabBadge.style.color = '#4338ca';
    } else {
      slabBadge.textContent = `Custom: ₹${closingFee}`;
      slabBadge.style.background = '#fef3c7';
      slabBadge.style.color = '#92400e';
    }
  }

  // ──────── AMAZON FEES LOGIC ────────
  // Strict rule: Referral fee applied ONLY IF Selling Price > ₹1000. If SP <= ₹1000, Referral Fee = ₹0!
  const isReferralApplicable = sp > 1000;
  const referralFee = isReferralApplicable ? (sp * refPct) : 0;
  const fixedFees = closingFee + shippingFee;
  const totalAmzFee = referralFee + fixedFees;
  const gstOnAmzFee = totalAmzFee * 0.18;
  const totalAmzDeduction = totalAmzFee + gstOnAmzFee;

  // Gross Payout from Amazon = SP - (Amazon Fees + GST on Amazon Fees)
  const grossPayout = sp - totalAmzDeduction;

  // ──────── GST CALCULATIONS ────────
  // Output GST on Selling Price & Input Tax Credit (ITC) on Product Cost
  const outputGst = sp * gstFactor;
  const itcGst = cost * gstFactor;
  const netGstGovt = Math.max(0, outputGst - itcGst);

  // ──────── ADDITIONAL COSTS ────────
  const adsCost = (amzAdsUnit === 'pct') ? (sp * adsInputVal / 100) : adsInputVal;

  // Total Deductions = Amazon Fees + Amazon GST + Govt GST Liability + Ads + Review Cost + Return Impact
  const totalDeductions = totalAmzDeduction + netGstGovt + adsCost + reviewCost + returnCostImpact;

  // Net Profit = SP - Cost - Total Deductions (or Gross Payout - Cost - Govt GST - Ads - Review - Return Impact)
  const netProfit = sp > 0 ? (sp - cost - totalDeductions) : 0;
  const actualMargin = sp > 0 ? (netProfit / sp) * 100 : 0;

  // In Mode B, sync computed margin back to the Target Profit field and slider
  if (amzCalcMode === 'B') {
    targetProfitPct = sp > 0 ? (netProfit / sp) : 0;
    const profitInput = document.getElementById('priceCalcTargetProfitPct');
    const profitSlider = document.getElementById('priceCalcProfitSlider');
    if (profitInput && document.activeElement !== profitInput) {
      profitInput.value = actualMargin.toFixed(1);
    }
    if (profitSlider && document.activeElement !== profitSlider) {
      profitSlider.value = Math.min(60, Math.max(0, actualMargin));
    }
    setText('targetProfitPctDisplay', actualMargin.toFixed(1) + '%');
  } else {
    setText('targetProfitPctDisplay', (targetProfitPct * 100).toFixed(1) + '%');
  }

  // Update Referral Fee Badge on input
  const refStatusBadge = document.getElementById('amzReferralStatusBadge');
  if (refStatusBadge) {
    if (isReferralApplicable) {
      refStatusBadge.textContent = `Active: SP > ₹1000 (${(refPct * 100).toFixed(1)}%)`;
      refStatusBadge.style.background = '#ffedd5';
      refStatusBadge.style.color = '#c2410c';
    } else {
      refStatusBadge.textContent = 'Exempt: SP ≤ ₹1000 (₹0 fee)';
      refStatusBadge.style.background = '#dcfce7';
      refStatusBadge.style.color = '#15803d';
    }
  }

  // — Update UI Breakdown Elements —
  setText('breakdownSellingPrice',    formatCurrency(sp));
  setText('breakdownNetProfit',       formatCurrency(netProfit));
  setText('breakdownMarginPct',       actualMargin.toFixed(1) + '%');
  setText('breakdownCost',            formatCurrency(cost));
  setText('breakdownReferral',        isReferralApplicable 
    ? (formatCurrency(referralFee) + ` (${(refPct * 100).toFixed(1)}% on SP > ₹1000)`) 
    : '₹0.00 (Exempt: SP ≤ ₹1000)');
  setText('breakdownFixedFees',       formatCurrency(fixedFees) + ` (Close: ${formatCurrency(closingFee)} + Ship: ${formatCurrency(shippingFee)})`);
  setText('breakdownGstOnFees',       formatCurrency(gstOnAmzFee));
  setText('breakdownGrossPayout',     formatCurrency(grossPayout));
  setText('breakdownNetGstGovt',      formatCurrency(netGstGovt) + ` (Output: ${formatCurrency(outputGst)} − ITC: ${formatCurrency(itcGst)})`);
  setText('breakdownAdsCost',         formatCurrency(adsCost) + (amzAdsUnit === 'pct' ? ` (${adsInputVal}% of SP)` : ''));
  setText('breakdownReviewCost',      formatCurrency(reviewCost));
  setText('breakdownReturnCost',      formatCurrency(returnCostImpact));
  setText('breakdownReturnRatePct',   `(${(returnRate * 100).toFixed(1)}% return rate)`);
  setText('breakdownTotalDeductions', formatCurrency(totalDeductions));
  setText('breakdownNetProfitBottom', formatCurrency(netProfit) + ` (${actualMargin.toFixed(1)}% of SP)`);

  const profitBottomEl = document.getElementById('breakdownNetProfitBottom');
  const netProfitEl = document.getElementById('breakdownNetProfit');
  const isLoss = netProfit < 0;
  if (profitBottomEl) profitBottomEl.style.color = isLoss ? '#dc2626' : '#059669';
  if (netProfitEl) netProfitEl.style.color = isLoss ? '#f87171' : '#4ade80';

  return {
    calcMode: amzCalcMode,
    sp, cost, prodGstPct, refPct, closingFee, shippingFee, targetProfitPct,
    adsCost, adsInputVal, amzAdsUnit, reviewCost, returnRate, returnPenalty,
    referralFee, totalAmzFee, gstOnAmzFee, totalAmzDeduction, grossPayout,
    outputGst, itcGst, netGstGovt, netProfit, actualMargin, returnCostImpact, totalDeductions
  };
}

function syncProfitSlider(val) {
  const slider = document.getElementById('priceCalcProfitSlider');
  if (slider) slider.value = val;
}

function syncProfitInput(val) {
  const input = document.getElementById('priceCalcTargetProfitPct');
  if (input) input.value = val;
  setText('targetProfitPctDisplay', parseFloat(val).toFixed(1) + '%');
}

function applyReferralPreset(val) {
  if (!val) return;
  const input = document.getElementById('priceCalcReferralPct');
  if (input) {
    input.value = val;
    calculateReversePrice();
  }
}

function resetPricingCalculator() {
  document.getElementById('priceCalcName').value = '';
  document.getElementById('priceCalcSku').value = '';
  document.getElementById('priceCalcCost').value = '300';
  document.getElementById('priceCalcProductGst').value = '18';
  document.getElementById('priceCalcReferralPct').value = '10';
  document.getElementById('priceCalcClosingFee').value = '30';
  document.getElementById('priceCalcShippingFee').value = '65';
  document.getElementById('priceCalcAdsCost').value = '0';
  document.getElementById('priceCalcReviewCost').value = '0';
  document.getElementById('priceCalcReturnRate').value = '5';
  document.getElementById('priceCalcReturnPenalty').value = '50';
  document.getElementById('priceCalcTargetProfitPct').value = '15';
  setAmzAdsUnit('flat');
  const autoCheck = document.getElementById('amzAutoClosingFeeCheck');
  if (autoCheck) autoCheck.checked = true;
  amzAutoClosingFee = true;
  syncProfitSlider(15);
  setAmzCalcMode('A');
  cancelPricingEdit();
}

function saveCurrentListingToTracker() {
  const name = document.getElementById('priceCalcName')?.value.trim() || 'Custom Product';
  const sku = document.getElementById('priceCalcSku')?.value.trim() || ('SKU-' + Date.now().toString().slice(-4));
  const calc = calculateReversePrice();

  if (calc.sp <= 0) {
    showToast('Invalid calculation. Check your cost and target margin.', 'error');
    return;
  }

  if (editingPricingId) {
    const idx = trackedPricingList.findIndex(item => item.id === editingPricingId);
    if (idx !== -1) {
      trackedPricingList[idx] = {
        ...trackedPricingList[idx],
        sku, name,
        calcMode: calc.calcMode || 'A',
        cost: calc.cost,
        targetMargin: (calc.targetProfitPct * 100).toFixed(1),
        sp: calc.sp,
        amzDeduction: calc.totalAmzDeduction,
        netGstGovt: calc.netGstGovt,
        netProfit: calc.netProfit,
        actualMargin: calc.actualMargin.toFixed(1),
        prodGstPct: calc.prodGstPct,
        refPct: calc.refPct,
        closingFee: calc.closingFee,
        shippingFee: calc.shippingFee,
        targetProfitPct: calc.targetProfitPct,
        adsCost: calc.adsCost,
        reviewCost: calc.reviewCost,
        returnRate: calc.returnRate,
        returnPenalty: calc.returnPenalty,
        returnCostImpact: calc.returnCostImpact
      };
      saveTrackedPricing('Updated Amazon price for ' + sku);
      renderPricingTrackerTable();
      cancelPricingEdit();
      updateAmzTrackedBadge();
      switchAmzSubtab('tracker');
      showToast(`Updated price for ${sku} (${formatCurrency(calc.sp)})! ✓`, 'success');
      return;
    }
  }

  const newEntry = {
    id: Date.now(),
    date: new Date().toISOString().split('T')[0],
    sku, name,
    calcMode: calc.calcMode || 'A',
    cost: calc.cost,
    targetMargin: (calc.targetProfitPct * 100).toFixed(1),
    sp: calc.sp,
    amzDeduction: calc.totalAmzDeduction,
    netGstGovt: calc.netGstGovt,
    netProfit: calc.netProfit,
    actualMargin: calc.actualMargin.toFixed(1),
    prodGstPct: calc.prodGstPct,
    refPct: calc.refPct,
    closingFee: calc.closingFee,
    shippingFee: calc.shippingFee,
    targetProfitPct: calc.targetProfitPct,
    adsCost: calc.adsCost,
    reviewCost: calc.reviewCost,
    returnRate: calc.returnRate,
    returnPenalty: calc.returnPenalty,
    returnCostImpact: calc.returnCostImpact
  };

  trackedPricingList.unshift(newEntry);
  saveTrackedPricing('Added Amazon price for ' + sku);
  renderPricingTrackerTable();
  updateAmzTrackedBadge();
  switchAmzSubtab('tracker');
  showToast(`Saved ${sku} (${formatCurrency(calc.sp)}) to Price Tracker! ✓`, 'success');
}

// ── SEARCH BY SKU ID / PRODUCT NAME ──
function handlePricingTrackerSearch(query) {
  pricingTrackerSearchQuery = (query || '').trim().toLowerCase();
  const clearBtn = document.getElementById('pricingTrackerSearchClear');
  if (clearBtn) clearBtn.style.display = pricingTrackerSearchQuery ? 'inline-block' : 'none';
  renderPricingTrackerTable();
}

function clearPricingTrackerSearch() {
  const input = document.getElementById('pricingTrackerSearchInput');
  if (input) input.value = '';
  handlePricingTrackerSearch('');
}

// ── RENDER TRACKED PRICES TABLE ──
function renderPricingTrackerTable() {
  updateAmzTrackedBadge();
  const tbody = document.getElementById('pricingTrackerTableBody');
  if (!tbody) return;

  if (trackedPricingList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 48px 24px; color: var(--text-muted);"><div style="display:flex;justify-content:center;margin-bottom:12px;"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div><div style="font-weight: 800; font-size: 16px; color: var(--text-1); margin-bottom: 4px;">No Tracked Amazon Listings Yet</div><div style="font-size: 13px; color: var(--text-muted); margin-bottom: 18px;">Configure your cost, fees, and profit targets in the calculator to track your listings here.</div><button type="button" class="btn btn-primary" onclick="switchAmzSubtab(\'calculator\')" style="padding: 10px 20px; font-weight: 800; font-size: 13px; display: inline-flex; align-items: center; gap: 6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M8 18h.01M12 18h.01"/></svg><span>Open Amazon Price Calculator</span></button></td></tr>';
    return;
  }

  let list = trackedPricingList;
  if (pricingTrackerSearchQuery) {
    list = list.filter(item => {
      const sku = (item.sku || '').toLowerCase();
      const name = (item.name || '').toLowerCase();
      return sku.includes(pricingTrackerSearchQuery) || name.includes(pricingTrackerSearchQuery);
    });
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:28px;color:var(--text-muted);">
      <div style="display:flex;justify-content:center;margin-bottom:6px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></div>
      <div style="font-weight:700;font-size:14px;color:var(--text-1);">No listings matching "${escapeHtml(pricingTrackerSearchQuery)}"</div>
      <div style="font-size:12px;margin-top:4px;color:var(--text-muted);">Try checking the SKU ID or <a href="javascript:void(0)" onclick="clearPricingTrackerSearch()" style="color:#38bdf8;font-weight:600;">clear search</a></div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(item => `
    <tr>
      <td style="font-size:12px;color:var(--text-muted);">${escapeHtml(item.date || '')}</td>
      <td><span style="background:rgba(59,130,246,0.12);color:#38bdf8;padding:2px 8px;border-radius:6px;font-family:monospace;font-size:11.5px;font-weight:700;border:1px solid rgba(56,189,248,0.25);">${escapeHtml(item.sku)}</span></td>
      <td style="font-weight:600;color:var(--text-1);">${escapeHtml(item.name)}</td>
      <td style="font-weight:700;color:var(--text-1);">${formatCurrency(item.cost)}</td>
      <td style="color:#38bdf8;font-weight:700;">${item.targetMargin}%</td>
      <td style="color:#f97316;font-weight:700;">${formatCurrency(item.amzDeduction)}</td>
      <td style="color:var(--text-2);font-weight:600;">${formatCurrency(item.netGstGovt)}</td>
      <td style="font-weight:900;font-size:15px;color:var(--lynxora-coral);white-space:nowrap;">
        ${formatCurrency(item.sp)}
        ${item.calcMode === 'B' ? '<span class="badge" style="background:rgba(59,130,246,0.18);color:#60a5fa;border:1px solid rgba(59,130,246,0.3);font-size:9.5px;padding:1px 5px;margin-left:4px;border-radius:4px;">Manual</span>' : ''}
      </td>
      <td style="font-weight:800;color:#10b981;">${formatCurrency(item.netProfit)}</td>
      <td><span class="badge" style="background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.3);font-weight:800;padding:3px 8px;border-radius:6px;">${item.actualMargin}%</span></td>
      <td style="white-space:nowrap;">
        <button class="action-btn" onclick="openEditPricingModal(${item.id})" title="Edit Price / Calculation" style="width:28px;height:28px;margin-right:6px;background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="action-btn action-delete" onclick="deleteTrackedPrice(${item.id})" title="Delete" style="width:28px;height:28px;background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.25);border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

// ── EDIT PRICE MODAL & MAIN CALCULATOR INTEGRATION ──
function openEditPricingModal(id) {
  const item = trackedPricingList.find(i => i.id === id);
  if (!item) return;

  document.getElementById('editPricingItemId').value = item.id;
  document.getElementById('editPricingSku').value = item.sku || '';
  document.getElementById('editPricingName').value = item.name || '';
  document.getElementById('editPricingCost').value = item.cost != null ? item.cost : 0;
  document.getElementById('editPricingTargetMargin').value = item.targetMargin || '15';
  document.getElementById('editPricingSp').value = item.sp != null ? Number(item.sp).toFixed(2) : '0';

  const refPct = item.refPct != null ? (item.refPct * 100) : 10;
  const prodGst = item.prodGstPct != null ? (item.prodGstPct * 100) : 18;
  const closing = item.closingFee != null ? item.closingFee : 25;
  const shipping = item.shippingFee != null ? item.shippingFee : 65;

  document.getElementById('editPricingRefPct').value = refPct;
  document.getElementById('editPricingProdGst').value = prodGst;
  document.getElementById('editPricingClosingFee').value = closing;
  document.getElementById('editPricingShippingFee').value = shipping;

  document.getElementById('editPricingModalSub').textContent = `SKU: ${item.sku} — ${item.name}`;

  recalcEditPricingFromSp();

  const overlay = document.getElementById('editPricingModalOverlay');
  if (overlay) {
    overlay.classList.add('active');
    overlay.style.display = 'flex';
  }
}

function closeEditPricingModal() {
  const overlay = document.getElementById('editPricingModalOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
  }
}

// Recalculates profit & margin in modal when user edits Selling Price (SP) directly
function recalcEditPricingFromSp() {
  const sp = parseFloat(document.getElementById('editPricingSp')?.value) || 0;
  const cost = parseFloat(document.getElementById('editPricingCost')?.value) || 0;
  const refPct = (parseFloat(document.getElementById('editPricingRefPct')?.value) || 0) / 100;
  const prodGst = (parseFloat(document.getElementById('editPricingProdGst')?.value) || 0) / 100;
  const closing = parseFloat(document.getElementById('editPricingClosingFee')?.value) || 0;
  const shipping = parseFloat(document.getElementById('editPricingShippingFee')?.value) || 0;

  const refFee = sp > 1000 ? (sp * refPct) : 0;
  const totalAmzFee = refFee + closing + shipping;
  const totalAmzDeduction = totalAmzFee * 1.18;
  const gstFactor = prodGst > 0 ? (prodGst / (1 + prodGst)) : 0;
  const netGstGovt = Math.max(0, (sp * gstFactor) - (cost * gstFactor));
  const netProfit = sp - cost - totalAmzDeduction - netGstGovt;
  const actualMargin = sp > 0 ? (netProfit / sp) * 100 : 0;

  setText('editPricingAmzFees', formatCurrency(totalAmzDeduction));
  setText('editPricingProfit', formatCurrency(netProfit));
  setText('editPricingMarginPct', actualMargin.toFixed(1) + '%');
}

// Recalculates Selling Price (SP) in modal when user changes Cost, Target Margin, or Fees
function recalcEditPricingFromVariables() {
  const cost = parseFloat(document.getElementById('editPricingCost')?.value) || 0;
  const targetProfitPct = (parseFloat(document.getElementById('editPricingTargetMargin')?.value) || 0) / 100;
  const refPct = (parseFloat(document.getElementById('editPricingRefPct')?.value) || 0) / 100;
  const prodGst = (parseFloat(document.getElementById('editPricingProdGst')?.value) || 0) / 100;
  const closing = parseFloat(document.getElementById('editPricingClosingFee')?.value) || 0;
  const shipping = parseFloat(document.getElementById('editPricingShippingFee')?.value) || 0;

  const fixedFees = closing + shipping;
  const gstFactor = prodGst > 0 ? (prodGst / (1 + prodGst)) : 0;
  const baseNumerator = (cost * (1 - gstFactor)) + (1.18 * fixedFees);

  // First try without referral fee (if SP <= 1000)
  const denomNoRef = 1 - targetProfitPct - gstFactor;
  let sp = 0;
  if (denomNoRef > 0.01) {
    const candSp = baseNumerator / denomNoRef;
    if (candSp <= 1000) {
      sp = candSp;
    } else {
      const denomWithRef = 1 - targetProfitPct - (1.18 * refPct) - gstFactor;
      sp = denomWithRef > 0.01 ? (baseNumerator / denomWithRef) : 0;
    }
  }

  const spInput = document.getElementById('editPricingSp');
  if (spInput) spInput.value = sp.toFixed(2);

  recalcEditPricingFromSp();
}

function handleEditPricingSubmit(event) {
  event.preventDefault();
  const id = parseInt(document.getElementById('editPricingItemId')?.value);
  const idx = trackedPricingList.findIndex(i => i.id === id);
  if (idx === -1) return;

  const sku = document.getElementById('editPricingSku')?.value.trim() || trackedPricingList[idx].sku;
  const name = document.getElementById('editPricingName')?.value.trim() || trackedPricingList[idx].name;
  const cost = parseFloat(document.getElementById('editPricingCost')?.value) || 0;
  const sp = parseFloat(document.getElementById('editPricingSp')?.value) || 0;
  const targetMargin = parseFloat(document.getElementById('editPricingTargetMargin')?.value) || 0;
  const refPct = (parseFloat(document.getElementById('editPricingRefPct')?.value) || 0) / 100;
  const prodGst = (parseFloat(document.getElementById('editPricingProdGst')?.value) || 0) / 100;
  const closing = parseFloat(document.getElementById('editPricingClosingFee')?.value) || 0;
  const shipping = parseFloat(document.getElementById('editPricingShippingFee')?.value) || 0;

  const refFee = sp > 1000 ? (sp * refPct) : 0;
  const totalAmzFee = refFee + closing + shipping;
  const totalAmzDeduction = totalAmzFee * 1.18;
  const gstFactor = prodGst > 0 ? (prodGst / (1 + prodGst)) : 0;
  const netGstGovt = Math.max(0, (sp * gstFactor) - (cost * gstFactor));
  const netProfit = sp - cost - totalAmzDeduction - netGstGovt;
  const actualMargin = sp > 0 ? (netProfit / sp) * 100 : 0;

  trackedPricingList[idx] = {
    ...trackedPricingList[idx],
    sku,
    name,
    cost,
    targetMargin: targetMargin.toFixed(1),
    sp,
    amzDeduction: totalAmzDeduction,
    netGstGovt,
    netProfit,
    actualMargin: actualMargin.toFixed(1),
    prodGstPct: prodGst,
    refPct: refPct,
    closingFee: closing,
    shippingFee: shipping,
    targetProfitPct: targetMargin / 100
  };

  saveTrackedPricing();
  closeEditPricingModal();
  renderPricingTrackerTable();
  showToast(`Updated price for ${sku} (${formatCurrency(sp)})! ✓`, 'success');
}

// Load current modal item into the top main calculator
function loadEditInMainCalculator() {
  const id = parseInt(document.getElementById('editPricingItemId')?.value);
  const item = trackedPricingList.find(i => i.id === id);
  if (!item) return;

  closeEditPricingModal();

  editingPricingId = item.id;
  switchAmzSubtab('calculator');

  document.getElementById('priceCalcName').value = item.name || '';
  document.getElementById('priceCalcSku').value = item.sku || '';
  document.getElementById('priceCalcCost').value = item.cost != null ? item.cost : '300';
  document.getElementById('priceCalcProductGst').value = item.prodGstPct != null ? (item.prodGstPct * 100) : '18';
  document.getElementById('priceCalcReferralPct').value = item.refPct != null ? (item.refPct * 100) : '10';
  document.getElementById('priceCalcClosingFee').value = item.closingFee != null ? item.closingFee : '25';
  document.getElementById('priceCalcShippingFee').value = item.shippingFee != null ? item.shippingFee : '65';
  document.getElementById('priceCalcAdsCost').value = item.adsCost != null ? item.adsCost : '0';
  document.getElementById('priceCalcReviewCost').value = item.reviewCost != null ? item.reviewCost : '0';
  document.getElementById('priceCalcReturnRate').value = item.returnRate != null ? (item.returnRate * 100) : '5';
  document.getElementById('priceCalcReturnPenalty').value = item.returnPenalty != null ? item.returnPenalty : '50';
  const targetPct = item.targetMargin ? parseFloat(item.targetMargin) : 15;
  document.getElementById('priceCalcTargetProfitPct').value = targetPct;
  syncProfitSlider(targetPct);
  if (item.calcMode === 'B') {
    setAmzCalcMode('B');
    const manualSpInput = document.getElementById('priceCalcManualSp');
    if (manualSpInput) manualSpInput.value = item.sp != null ? Number(item.sp).toFixed(2) : '0.00';
  } else {
    setAmzCalcMode('A');
  }
  calculateReversePrice();

  // Show banner
  const banner = document.getElementById('pricingEditBanner');
  if (banner) {
    banner.style.display = 'flex';
    setText('pricingEditBannerTitle', `Editing Price for SKU: ${item.sku} (${item.name})`);
  }

  // Update Save button to Update button
  const container = document.getElementById("pricingSaveBtnContainer");
  if (container) {
    container.innerHTML = `
      <div style="display: flex; gap: 10px;">
        <button type="button" class="btn-save-tracker-green" onclick="saveCurrentListingToTracker()" style="flex: 1;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          <span>Update Tracked Price (${escapeHtml(item.sku)})</span>
        </button>
        <button type="button" class="btn btn-ghost" onclick="cancelPricingEdit()" style="height: 48px; border-radius: 12px; color: #dc2626; border-color: #fca5a5; font-weight: 700; padding: 0 16px;">
          Cancel
        </button>
      </div>
    `;
  }
  document.querySelector('.pricing-calc-grid')?.scrollIntoView({ behavior: 'smooth' });
}

function cancelPricingEdit() {
  editingPricingId = null;
  const banner = document.getElementById("pricingEditBanner");
  if (banner) banner.style.display = "none";
  const container = document.getElementById("pricingSaveBtnContainer");
  if (container) {
    container.innerHTML = `
      <button type="button" id="btnSavePriceTracker" class="btn-save-tracker" onclick="saveCurrentListingToTracker()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        <span>Save to Price Tracking Table</span>
      </button>
    `;
  }
}
function deleteTrackedPrice(id) {
  const item = trackedPricingList.find(i => i.id === id);
  if (!item) return;

  const detailsHtml = `
    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 14px;text-align:left;font-size:13px;display:flex;flex-direction:column;gap:6px;">
      <div class="confirm-preview-row"><span class="confirm-preview-label">SKU:</span><span class="confirm-preview-val"><b>${escapeHtml(item.sku || 'N/A')}</b></span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Product:</span><span class="confirm-preview-val">${escapeHtml(item.name || item.sku || 'Listing')}</span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Selling Price:</span><span class="confirm-preview-val" style="color:#059669;font-weight:800;">${formatCurrency(item.sp || 0)}</span></div>
    </div>
  `;

  openConfirmModal({
    title: 'Remove Tracked Price?',
    message: 'Are you sure you want to remove this tracked listing from your Amazon Price Calculator?',
    detailsHtml: detailsHtml,
    actionText: 'Yes, Remove Listing',
    actionClass: 'btn-danger',
    cancelText: 'Cancel / Keep',
    onConfirm: () => {
      trackedPricingList = trackedPricingList.filter(i => i.id !== id);
      saveTrackedPricing('Removed Amazon price for ' + (item.sku || ''));
      renderPricingTrackerTable();
      updateAmzTrackedBadge();
      showToast('Removed from price tracker.', 'info');
    }
  });
}

function clearAllTrackedPrices() {
  if (trackedPricingList.length === 0) return;
  openConfirmModal({
    title: 'Clear Amazon Tracked Prices?',
    message: `Are you sure you want to remove all <b>${trackedPricingList.length} tracked listings</b> from the price calculator? This cannot be undone.`,
    actionText: 'Yes, Clear All',
    actionClass: 'btn-danger',
    cancelText: 'Cancel / Keep',
    onConfirm: () => {
      trackedPricingList = [];
      saveTrackedPricing('Cleared all Amazon tracked prices', true);
      renderPricingTrackerTable();
      updateAmzTrackedBadge();
      showToast('Price tracker cleared.', 'info');
    }
  });
}

function exportPricingTrackerCSV() {
  if (trackedPricingList.length === 0) {
    showToast('No tracked listings to export.', 'info');
    return;
  }
  const headers = ['Date', 'SKU', 'Product Name', 'Product Cost', 'Target Margin %', 'Amazon Deductions (Inc GST)', 'Net GST to Govt', 'Recommended Selling Price', 'Net Profit', 'Actual Margin %'];
  const rows = trackedPricingList.map(i => [
    i.date, `"${i.sku}"`, `"${i.name}"`, i.cost, i.targetMargin, i.amzDeduction, i.netGstGovt, i.sp, i.netProfit, i.actualMargin
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `amazon_listing_prices_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported Amazon listing prices CSV! ✓', 'success');
}

function importPricingTrackerCSV(input) {
  const file = input && input.files ? input.files[0] : null;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const text = e.target.result;
      const lines = text.split(/\r\n|\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length < 2) {
        showToast('CSV file is empty or missing data rows.', 'error');
        return;
      }

      const parseCSVLine = (line) => {
        const result = [];
        let curr = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
              curr += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            result.push(curr.trim());
            curr = '';
          } else {
            curr += char;
          }
        }
        result.push(curr.trim());
        return result;
      };

      const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      let importedCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        if (!row || row.length < 3) continue;

        const dateIdx = header.findIndex(h => h.includes('date'));
        const skuIdx = header.findIndex(h => h.includes('sku'));
        const nameIdx = header.findIndex(h => h.includes('name') || h.includes('product'));
        const costIdx = header.findIndex(h => h.includes('cost'));
        const targetIdx = header.findIndex(h => h.includes('target'));
        const amzDedIdx = header.findIndex(h => h.includes('deduction') || h.includes('amz'));
        const netGstIdx = header.findIndex(h => h.includes('netgst') || h.includes('govt'));
        const spIdx = header.findIndex(h => h.includes('selling') || h.includes('sp') || h.includes('recommended'));
        const profitIdx = header.findIndex(h => h.includes('profit'));
        const marginIdx = header.findIndex(h => h.includes('actual') || h.includes('margin'));

        const sku = (skuIdx !== -1 ? row[skuIdx] : row[1]) || ('SKU-' + Date.now().toString().slice(-4));
        const name = (nameIdx !== -1 ? row[nameIdx] : row[2]) || sku;
        const date = (dateIdx !== -1 ? row[dateIdx] : row[0]) || new Date().toISOString().split('T')[0];
        const cost = parseFloat(costIdx !== -1 ? row[costIdx] : row[3]) || 0;
        const targetMargin = parseFloat(targetIdx !== -1 ? row[targetIdx] : row[4]) || 15;
        const amzDeduction = parseFloat(amzDedIdx !== -1 ? row[amzDedIdx] : row[5]) || 0;
        const netGstGovt = parseFloat(netGstIdx !== -1 ? row[netGstIdx] : row[6]) || 0;
        const sp = parseFloat(spIdx !== -1 ? row[spIdx] : row[7]) || 0;
        const netProfit = parseFloat(profitIdx !== -1 ? row[profitIdx] : row[8]) || 0;
        const actualMargin = (marginIdx !== -1 ? row[marginIdx] : row[9]) || targetMargin.toFixed(1);

        if (!sku || sp <= 0) continue;

        const existingIdx = trackedPricingList.findIndex(item => (item.sku || '').toLowerCase() === sku.toLowerCase());
        const entry = {
          id: existingIdx !== -1 ? trackedPricingList[existingIdx].id : Date.now() + i,
          date: date || new Date().toISOString().split('T')[0],
          sku: sku,
          name: name,
          calcMode: 'A',
          cost: cost,
          targetMargin: targetMargin.toString(),
          sp: sp,
          amzDeduction: amzDeduction,
          netGstGovt: netGstGovt,
          netProfit: netProfit,
          actualMargin: String(actualMargin),
          prodGstPct: 0.18,
          refPct: 0.12,
          closingFee: 4,
          shippingFee: 60,
          targetProfitPct: targetMargin / 100,
          adsCost: 0,
          reviewCost: 0,
          returnRate: 0.1,
          returnPenalty: 50,
          returnCostImpact: 0
        };

        if (existingIdx !== -1) {
          trackedPricingList[existingIdx] = entry;
        } else {
          trackedPricingList.unshift(entry);
        }
        importedCount++;
      }

      if (importedCount > 0) {
        saveTrackedPricing(`Imported ${importedCount} Amazon tracked listings from CSV`);
        renderPricingTrackerTable();
        updateAmzTrackedBadge();
        switchAmzSubtab('tracker');
        showToast(`Successfully imported ${importedCount} Amazon tracked listings!`, 'success');
      } else {
        showToast('No valid Amazon listings found in CSV.', 'error');
      }
    } catch (err) {
      console.error('[Amazon CSV Import Error]', err);
      showToast('Failed to parse CSV file: ' + err.message, 'error');
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file);
}

const _origInit = init;
init = function() {
  _origInit();
  loadAmazonAccounts();
  restoreAutoSync();
  try {
    if (typeof updateAmzTrackedBadge === 'function') updateAmzTrackedBadge();
    if (typeof updateFkTrackedBadge === 'function') updateFkTrackedBadge();
  } catch (e) {}
};

const _origNavigateTo = navigateTo;
navigateTo = function(page) {
  _origNavigateTo(page);
  try {
    if (page === 'settings') { renderAmazonSettings(); updateAmzSyncUI(); }
    if (page === 'dashboard') renderAmazonDashboard();
    if (page === 'pricing') updateAmzTrackedBadge();
    if (page === 'flipkart') updateFkTrackedBadge();
  } catch (err) {
    console.error('Amazon integration render error:', err);
  }
};





// ════════════════════════════════════════════════════════════════════════════
// FLIPKART LISTING PRICE TRACKING — ADVANCED ITERATIVE SOLVER (MODULAR ENGINE)
// ════════════════════════════════════════════════════════════════════════════

// ── Flipkart Fee Tables (2024-25 standard seller policy) ─────────────────────
const FK_FEE_TABLE = {
  fixed: {
    bronze: [{max:100,fee:8},{max:250,fee:18},{max:500,fee:23},{max:1000,fee:33},{max:Infinity,fee:43}],
    silver: [{max:100,fee:6},{max:250,fee:14},{max:500,fee:18},{max:1000,fee:26},{max:Infinity,fee:34}],
    gold:   [{max:100,fee:4},{max:250,fee:10},{max:500,fee:13},{max:1000,fee:20},{max:Infinity,fee:26}]
  },
  shipping: {
    bronze: {local:{base:30,extra:10}, zonal:{base:47,extra:18}, national:{base:68,extra:23}},
    silver: {local:{base:25,extra:8},  zonal:{base:40,extra:15}, national:{base:57,extra:19}},
    gold:   {local:{base:20,extra:6},  zonal:{base:33,extra:12}, national:{base:46,extra:15}}
  },
  revShipping: {
    bronze: {local:22, zonal:37, national:48},
    silver: {local:18, zonal:31, national:40},
    gold:   {local:15, zonal:25, national:33}
  },
  collection: { prepaid:0.015, cod:0.025 },
  codCharge: 25
};

// ── Modular Pricing Engine Class ─────────────────────────────────────────────
class FlipkartPricingEngine {
  constructor(feeTable = FK_FEE_TABLE) {
    this.feeTable = feeTable;
  }

  getFixedFee(sp, tier) {
    const slabs = this.feeTable.fixed[tier] || this.feeTable.fixed.bronze;
    for (const s of slabs) {
      if (sp <= s.max) return s.fee;
    }
    return slabs[slabs.length - 1].fee;
  }

  getShipping(weightGrams, zone, tier) {
    const t = this.feeTable.shipping[tier] || this.feeTable.shipping.bronze;
    const z = t[zone] || t.zonal;
    const extraSlabs = Math.max(0, Math.ceil((weightGrams - 500) / 500));
    return z.base + extraSlabs * z.extra;
  }

  getRevShipping(zone, tier) {
    const t = this.feeTable.revShipping[tier] || this.feeTable.revShipping.bronze;
    return t[zone] || t.zonal;
  }

  computeAtSP(sp, p) {
    const { cost, g, commRate, tier, weightGrams, deadWeight, lengthCm, widthCm, heightCm, volWeightGrams, zone, payMode,
            adsFlat, adsPct, adsMode, reviewCost, returnRate } = p;

    const commFee    = sp * commRate;
    const collRate   = this.feeTable.collection[payMode] || 0.015;
    const collFee    = sp * collRate;
    const codCharge  = (payMode === 'cod') ? this.feeTable.codCharge : 0;
    const fixedFee   = this.getFixedFee(sp, tier);
    const fwdShip    = this.getShipping(weightGrams, zone, tier);
    const revShip    = this.getRevShipping(zone, tier);

    const totalFkFees   = commFee + collFee + codCharge + fixedFee + fwdShip;
    const gstOnFkFees   = totalFkFees * 0.18;

    // ITC = GST paid on COGS + 18% GST paid on Flipkart marketplace services
    const itcFromCogs   = cost * g;
    const itcTotal      = itcFromCogs + gstOnFkFees;
    const outputGst     = sp * g;
    const netGovtGst    = Math.max(0, outputGst - itcTotal);

    const adsCost       = adsMode === 'pct' ? sp * adsPct : adsFlat;
    const returnBuffer  = (fwdShip + revShip) * returnRate;
    const profitAmt     = sp * p.targetProfit;

    const requiredSP = cost + profitAmt + totalFkFees + gstOnFkFees + netGovtGst
                     + adsCost + reviewCost + returnBuffer;

    const totalDeductions = totalFkFees + gstOnFkFees + netGovtGst + adsCost + reviewCost + returnBuffer;
    const netProfit       = sp - cost - totalDeductions;
    const actualMargin    = sp > 0 ? (netProfit / sp) * 100 : 0;

    return {
      sp, commFee, collFee, codCharge, fixedFee, fwdShip, revShip,
      totalFkFees, gstOnFkFees, itcFromCogs, itcTotal,
      outputGst, netGovtGst, adsCost, reviewCost, returnBuffer,
      profitAmt, requiredSP, totalDeductions, netProfit, actualMargin,
      collRate, iters: 0
    };
  }

  solve(params) {
    const effectivePct = (params.targetProfit || 0) + (params.commRate || 0) +
                         (this.feeTable.collection[params.payMode] || 0.015) +
                         (params.g || 0) + (params.adsMode === 'pct' ? params.adsPct : 0);
    if (effectivePct >= 0.98) {
      return { ...this.computeAtSP(0, params), sp: 0, netProfit: 0, actualMargin: 0, iters: 0, impossible: true };
    }

    let sp = Math.max(params.cost * 2.5, 100);
    let iters = 0;

    for (let i = 0; i < 600; i++) {
      const bd = this.computeAtSP(sp, params);
      const delta = bd.requiredSP - sp;
      if (Math.abs(delta) < 0.005) { iters = i; break; }
      sp = sp * 0.35 + bd.requiredSP * 0.65;
      if (sp < 1) sp = 1;
      iters = i;
    }

    const result = this.computeAtSP(sp, params);
    result.iters = iters;
    return result;
  }
}

// ===========================================
// FLIPKART PRICING SUB-TABS STATE & NAVIGATION
// ===========================================
let activeFkSubtab = 'calculator'; // 'calculator' | 'tracker'

function switchFkSubtab(tab) {
  activeFkSubtab = tab;
  const calcView = document.getElementById('fkSubviewCalculator');
  const trackerView = document.getElementById('fkSubviewTracker');
  const calcBtn = document.getElementById('fkSubtabCalcBtn');
  const trackerBtn = document.getElementById('fkSubtabTrackerBtn');
  const viewHint = document.getElementById('fkSubtabViewHint');

  if (tab === 'tracker') {
    if (calcView) calcView.style.display = 'none';
    if (trackerView) trackerView.style.display = 'block';

    if (calcBtn) calcBtn.classList.remove('active');
    if (trackerBtn) trackerBtn.classList.add('active');
    if (viewHint) viewHint.textContent = 'View: Tracked Listings Table';
    renderFkTrackerTable();
  } else {
    if (calcView) calcView.style.display = 'block';
    if (trackerView) trackerView.style.display = 'none';

    if (trackerBtn) trackerBtn.classList.remove('active');
    if (calcBtn) calcBtn.classList.add('active');
    if (viewHint) viewHint.textContent = 'View: Real-Time Calculator';
    calculateFlipkartPrice();
  }
  updateFkTrackedBadge();
}

function updateFkTrackedBadge() {
  const count = (typeof trackedFlipkartList !== 'undefined' && Array.isArray(trackedFlipkartList)) ? trackedFlipkartList.length : 0;
  const badge = document.getElementById('fkTrackedCountBadge');
  if (badge) {
    badge.textContent = count.toString();
    if (count > 0) {
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
    } else {
      badge.style.background = '#f1f5f9';
      badge.style.color = '#64748b';
    }
  }
  const topbarCount = document.getElementById('fkTopbarTrackedCount');
  if (topbarCount) topbarCount.textContent = count.toString();
  const notice = document.getElementById('fkTrackedNoticeBanner');
  const noticeCount = document.getElementById('fkNoticeTrackedCount');
  if (notice) {
    if (count > 0 && activeFkSubtab === 'calculator') {
      notice.style.display = 'flex';
      if (noticeCount) noticeCount.textContent = count.toString();
    } else {
      notice.style.display = 'none';
    }
  }
}

// Global Engine Instance
const fkEngine = new FlipkartPricingEngine();

// ── State ─────────────────────────────────────────────────────────────────────
let trackedFlipkartList = [];
let fkSearchQuery       = '';
let editingFkId         = null;

function loadTrackedFlipkart() {
  const saved = localStorage.getItem('lynxora_flipkart_tracker');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      trackedFlipkartList = Array.isArray(parsed) ? parsed : [];
    } catch {
      trackedFlipkartList = [];
    }
  } else {
    trackedFlipkartList = [];
  }
}
loadTrackedFlipkart();

// ── UI State setters ──────────────────────────────────────────────────────────
function setFkTier(tier) {
  document.getElementById('fkTier').value = tier;
  const styles = {
    bronze: { border: '#cd7f32', bg: 'rgba(205, 127, 50, 0.15)', color: '#d97706' },
    silver: { border: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)', color: 'var(--text-1)' },
    gold:   { border: '#eab308', bg: 'rgba(234, 179, 8, 0.15)', color: '#eab308' }
  };
  ['bronze','silver','gold'].forEach(t => {
    const btn = document.getElementById('fkTier' + t.charAt(0).toUpperCase() + t.slice(1));
    if (!btn) return;
    const s = styles[t];
    if (t === tier) {
      btn.style.border = `2px solid ${s.border}`;
      btn.style.background = s.bg;
      btn.style.color = s.color;
      btn.style.fontWeight = '800';
    } else {
      btn.style.border = '2px solid var(--border)';
      btn.style.background = 'var(--input-bg)';
      btn.style.color = 'var(--text-muted)';
      btn.style.fontWeight = '600';
    }
  });
  calculateFlipkartPrice();
}

function setFkPayMode(mode) {
  document.getElementById('fkPayMode').value = mode;
  const prepaidBtn = document.getElementById('fkPayPrepaid');
  const codBtn     = document.getElementById('fkPayCod');
  if (mode === 'prepaid') {
    if (prepaidBtn) prepaidBtn.style.cssText = 'flex:1;padding:8px 6px;border-radius:8px;border:2px solid #3b82f6;background:rgba(59,130,246,0.15);color:#60a5fa;font-weight:800;font-size:11.5px;cursor:pointer;';
    if (codBtn) codBtn.style.cssText         = 'flex:1;padding:8px 6px;border-radius:8px;border:2px solid var(--border);background:var(--input-bg);color:var(--text-muted);font-weight:600;font-size:11.5px;cursor:pointer;';
  } else {
    if (codBtn) codBtn.style.cssText         = 'flex:1;padding:8px 6px;border-radius:8px;border:2px solid #f59e0b;background:rgba(245,158,11,0.15);color:#fbbf24;font-weight:800;font-size:11.5px;cursor:pointer;';
    if (prepaidBtn) prepaidBtn.style.cssText = 'flex:1;padding:8px 6px;border-radius:8px;border:2px solid var(--border);background:var(--input-bg);color:var(--text-muted);font-weight:600;font-size:11.5px;cursor:pointer;';
  }
  calculateFlipkartPrice();
}

function setFkAdsMode(mode) {
  document.getElementById('fkAdsMode').value = mode;
  const flatBtn = document.getElementById('fkAdsFlatBtn');
  const pctBtn  = document.getElementById('fkAdsPctBtn');
  const suffix  = document.getElementById('fkAdsSuffix');
  if (mode === 'flat') {
    if (flatBtn) { flatBtn.style.background = 'var(--lynxora-coral)'; flatBtn.style.color = 'var(--btn-accent-text, #070709)'; flatBtn.style.fontWeight = '800'; }
    if (pctBtn)  { pctBtn.style.background  = 'var(--input-bg)'; pctBtn.style.color  = 'var(--text-muted)'; pctBtn.style.fontWeight = '600'; }
    if (suffix)  suffix.textContent = '₹';
  } else {
    if (pctBtn)  { pctBtn.style.background  = 'var(--lynxora-coral)'; pctBtn.style.color  = 'var(--btn-accent-text, #070709)'; pctBtn.style.fontWeight = '800'; }
    if (flatBtn) { flatBtn.style.background = 'var(--input-bg)'; flatBtn.style.color = 'var(--text-muted)'; flatBtn.style.fontWeight = '600'; }
    if (suffix)  suffix.textContent = '%';
  }
  calculateFlipkartPrice();
}

// ── Profit slider sync ────────────────────────────────────────────────────────
function syncFkProfitSlider(val) {
  const s = document.getElementById('fkCalcProfitSlider');
  if (s) s.value = val;
}
function syncFkProfitInput(val) {
  const i = document.getElementById('fkCalcTargetProfit');
  if (i) i.value = val;
  setText('fkTargetProfitDisplay', parseFloat(val).toFixed(1) + '%');
}

// ── Commission preset ─────────────────────────────────────────────────────────
// â”€â”€ Flipkart Calculation Mode State & Handlers (Mode A: Target Margin % / Mode B: Direct Selling Price) â”€â”€
let fkCalcMode = 'A'; // 'A' | 'B'

function setFkCalcMode(mode) {
  fkCalcMode = mode;
  const btnA = document.getElementById('btnFkModeA');
  const btnB = document.getElementById('btnFkModeB');
  const manualCard = document.getElementById('fkManualSpCard');
  const manualStatus = document.getElementById('fkManualSpStatus');
  const modeBadge = document.getElementById('fkModeBadge');
  const profitContainer = document.getElementById('fkTargetProfitContainer');
  const profitTitle = document.getElementById('fkProfitLabelTitle');
  const bdLabel = document.getElementById('fkBreakdownSellingPriceLabel');
  const bdBadge = document.getElementById('fkBreakdownModeBadge');

  if (mode === 'B') {
    // Mode B: Manual Selling Price active
    if (btnA) {
      btnA.style.background = 'transparent';
      btnA.style.color = 'var(--text-2)';
      btnA.style.boxShadow = 'none';
      btnA.classList.remove('active');
    }
    if (btnB) {
      btnB.style.background = 'var(--card-solid)';
      btnB.style.color = 'var(--text-1)';
      btnB.style.boxShadow = 'var(--shadow-sm)';
      btnB.classList.add('active');
    }
    if (manualCard) {
      manualCard.style.borderColor = '#2563eb';
      manualCard.style.background = 'rgba(37, 99, 235, 0.12)';
    }
    if (manualStatus) {
      manualStatus.textContent = 'Direct Entry (Active)';
      manualStatus.style.color = '#059669';
    }
    if (modeBadge) {
      modeBadge.textContent = 'Manual Input';
      modeBadge.style.background = '#059669';
    }
    if (profitContainer) {
      profitContainer.style.background = 'var(--input-bg)';
      profitContainer.style.borderColor = 'var(--border)';
    }
    if (profitTitle) {
      profitTitle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px;display:inline-block;"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>11. Calculated Profit Margin (% of SP)';
    }
    if (bdLabel) {
      bdLabel.textContent = 'Direct Target Selling Price (SP)';
    }
    if (bdBadge) {
      bdBadge.textContent = 'Mode B: Manual SP';
      bdBadge.style.background = '#dbeafe';
      bdBadge.style.color = '#1e40af';
    }
  } else {
    // Mode A: Target Margin % active
    if (btnA) {
      btnA.style.background = 'var(--card-solid)';
      btnA.style.color = 'var(--text-1)';
      btnA.style.boxShadow = 'var(--shadow-sm)';
      btnA.classList.add('active');
    }
    if (btnB) {
      btnB.style.background = 'transparent';
      btnB.style.color = 'var(--text-2)';
      btnB.style.boxShadow = 'none';
      btnB.classList.remove('active');
    }
    if (manualCard) {
      manualCard.style.borderColor = 'var(--border)';
      manualCard.style.background = 'var(--input-bg)';
    }
    if (manualStatus) {
      manualStatus.textContent = 'Calculated from Target Margin %';
      manualStatus.style.color = '#2563eb';
    }
    if (modeBadge) {
      modeBadge.textContent = 'Auto-Calculated';
      modeBadge.style.background = '#64748b';
    }
    if (profitContainer) {
      profitContainer.style.background = 'linear-gradient(135deg,#f0fdf4,#dcfce7)';
      profitContainer.style.borderColor = '#86efac';
    }
    if (profitTitle) {
      profitTitle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px;display:inline-block;"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>11. Desired Profit Margin (% of Selling Price)';
    }
    if (bdLabel) {
      bdLabel.textContent = 'Recommended Final Selling Price (SP)';
    }
    if (bdBadge) {
      bdBadge.textContent = 'Mode A: Target %';
      bdBadge.style.background = '#dcfce7';
      bdBadge.style.color = '#15803d';
    }
  }
  calculateFlipkartPrice();
}

function onFkManualSpInput(val) {
  if (fkCalcMode !== 'B') {
    setFkCalcMode('B');
  } else {
    calculateFlipkartPrice();
  }
}

function onFkTargetProfitInput(val) {
  syncFkProfitSlider(val);
  if (fkCalcMode !== 'A') {
    setFkCalcMode('A');
  } else {
    calculateFlipkartPrice();
  }
}

function onFkProfitSlider(val) {
  syncFkProfitInput(val);
  if (fkCalcMode !== 'A') {
    setFkCalcMode('A');
  } else {
    calculateFlipkartPrice();
  }
}

function applyFkCommissionPreset(val) {
  if (!val) return;
  const i = document.getElementById('fkCalcCommission');
  if (i) { i.value = val; calculateFlipkartPrice(); }
  const p = document.getElementById('fkCalcCommPreset');
  if (p) p.value = '';
}

// ── Main calculation function ─────────────────────────────────────────────────
function calculateFlipkartPrice() {
  const cost         = parseFloat(document.getElementById('fkCalcCost')?.value)          || 0;
  const g            = (parseFloat(document.getElementById('fkCalcProductGst')?.value)   || 0) / 100;
  const commRate     = (parseFloat(document.getElementById('fkCalcCommission')?.value)   || 0) / 100;
  const tier         = document.getElementById('fkTier')?.value || 'bronze';
  const deadWeight   = parseFloat(document.getElementById('fkCalcWeight')?.value)        || 500;
  const lengthCm     = parseFloat(document.getElementById('fkCalcLength')?.value)        || 0;
  const widthCm      = parseFloat(document.getElementById('fkCalcWidth')?.value)         || 0;
  const heightCm     = parseFloat(document.getElementById('fkCalcHeight')?.value)        || 0;
  const volWeightGrams = (lengthCm > 0 && widthCm > 0 && heightCm > 0) ? Math.round((lengthCm * widthCm * heightCm) / 5) : 0;
  const weightGrams  = Math.max(deadWeight, volWeightGrams, 50);
  setText('fkVolWeightPill', `Volumetric: ${volWeightGrams}g`);
  setText('fkBillableWeightDisplay', `${weightGrams}g` + (volWeightGrams > deadWeight ? ' (Volumetric)' : ' (Dead wt)'));
  const zone         = document.getElementById('fkCalcZone')?.value                      || 'zonal';
  const payMode      = document.getElementById('fkPayMode')?.value                       || 'prepaid';
  const adsMode      = document.getElementById('fkAdsMode')?.value                       || 'flat';
  const adsRaw       = parseFloat(document.getElementById('fkCalcAds')?.value)           || 0;
  const adsFlat      = adsMode === 'flat' ? adsRaw : 0;
  const adsPct       = adsMode === 'pct'  ? adsRaw / 100 : 0;
  const reviewCost   = parseFloat(document.getElementById('fkCalcReview')?.value)        || 0;
  const returnRate   = (parseFloat(document.getElementById('fkCalcReturnRate')?.value)   || 0) / 100;
  const targetProfit = (parseFloat(document.getElementById('fkCalcTargetProfit')?.value) || 0) / 100;

  const params = { cost, g, commRate, tier, weightGrams, deadWeight, lengthCm, widthCm, heightCm, volWeightGrams, zone, payMode,
                   adsFlat, adsPct, adsMode, reviewCost, returnRate, targetProfit };

  let bd;
  if (fkCalcMode === 'B') {
    // Mode B: Direct / Manual Selling Price
    const manualSpInput = document.getElementById('fkCalcManualSp');
    const directSp = manualSpInput ? (parseFloat(manualSpInput.value) || 0) : 0;

    if (directSp <= 0) {
      bd = {
        sp: 0, commFee: 0, collFee: 0, codCharge: 0, fixedFee: 0, fwdShip: 0, revShip: 0,
        totalFkFees: 0, gstOnFkFees: 0, itcFromCogs: cost * g, itcTotal: cost * g,
        outputGst: 0, netGovtGst: 0, adsCost: 0, reviewCost: 0, returnBuffer: 0,
        profitAmt: 0, requiredSP: 0, totalDeductions: cost, netProfit: -cost, actualMargin: -100,
        collRate: 0.015, iters: 0, impossible: true
      };
    } else {
      bd = fkEngine.computeAtSP(directSp, params);
      // Sync profit slider & display with resulting actual margin
      const tpInput = document.getElementById('fkCalcTargetProfit');
      const tpSlider = document.getElementById('fkCalcProfitSlider');
      const tpDisplay = document.getElementById('fkTargetProfitDisplay');
      if (tpInput) tpInput.value = bd.actualMargin.toFixed(1);
      if (tpSlider) tpSlider.value = Math.min(60, Math.max(1, bd.actualMargin));
      if (tpDisplay) tpDisplay.textContent = bd.actualMargin.toFixed(1) + '%';
    }
    setText('fkSolverNote', `Manual Direct Selling Price Mode Â· Net Margin: ${bd.actualMargin.toFixed(1)}%`);
  } else {
    // Mode A: Reverse Solver for Target Profit Margin
    bd = fkEngine.solve(params);
    const manualSpInput = document.getElementById('fkCalcManualSp');
    if (manualSpInput && bd.sp > 0) {
      manualSpInput.value = bd.sp.toFixed(2);
    }
  }

  // Update fee preview
  const fwdShip  = fkEngine.getShipping(weightGrams, zone, tier);
  const revShip  = fkEngine.getRevShipping(zone, tier);
  const fixedFee = fkEngine.getFixedFee(bd.sp, tier);
  const collRate = FK_FEE_TABLE.collection[payMode] || 0.015;
  setText('fkPreviewFixed',   formatCurrency(fixedFee));
  setText('fkPreviewShip',    formatCurrency(fwdShip));
  setText('fkPreviewRevShip', formatCurrency(revShip));
  setText('fkPreviewCollect', (collRate * 100).toFixed(1) + '%' + (payMode === 'cod' ? '+₹25' : ''));
  setText('fkReturnBufferPreview', formatCurrency((fwdShip + revShip) * returnRate) + ' per unit sold');

  // Update badges
  const tierLabels = { bronze:'Bronze Tier', silver:'Silver Tier', gold:'Gold Tier' };
  const zoneLabels = { local:'Local', zonal:'Zonal', national:'National' };
  setText('fkTierBadge', tierLabels[tier] || tier);
  setText('fkZoneBadge', zoneLabels[zone] || zone);

  // Update COD row visibility
  const codRow = document.getElementById('fkBdCodRow');
  if (codRow) codRow.style.display = payMode === 'cod' ? 'flex' : 'none';

  const fc = formatCurrency;

  // Main breakdown outputs
  setText('fkBreakdownSP',       bd.impossible ? 'N/A' : fc(bd.sp));
  setText('fkBreakdownNetProfit',bd.impossible ? '₹0.00' : fc(bd.netProfit));
  setText('fkBreakdownMargin',   bd.impossible ? '0%' : bd.actualMargin.toFixed(1) + '%');
  setText('fkBdCost',            fc(cost));
  setText('fkBdCommission',      fc(bd.commFee) + ` (${(commRate*100).toFixed(1)}%)`);
  setText('fkBdCollection',      fc(bd.collFee) + ` (${(bd.collRate*100).toFixed(1)}%)`);
  setText('fkBdCodCharge',       fc(bd.codCharge));
  setText('fkBdFixed',           fc(bd.fixedFee));
  setText('fkBdFwdShip',         fc(bd.fwdShip));
  setText('fkBdTotalFees',       fc(bd.totalFkFees));
  setText('fkBdGstOnFees',       fc(bd.gstOnFkFees));
  setText('fkBdOutputGst',       fc(bd.outputGst) + ` (${(g*100).toFixed(0)}% of SP)`);
  setText('fkBdItc',             '−' + fc(bd.itcTotal) + ' (COGS+FK)');
  setText('fkBdNetGst',          fc(bd.netGovtGst));
  setText('fkBdAdReview',        fc(bd.adsCost + bd.reviewCost));
  setText('fkBdReturnBuf',       fc(bd.returnBuffer));
  setText('fkBdReturnRateLbl',   `(${(returnRate*100).toFixed(1)}% rate)`);
  setText('fkBdTotalDed',        fc(bd.totalDeductions));
  setText('fkBdProfit',          fc(bd.netProfit) + ` (${bd.actualMargin.toFixed(1)}%)`);
  setText('fkTargetProfitDisplay', (targetProfit*100).toFixed(1) + '%');
  setText('fkSolverNote',        bd.impossible ? 'Target margin not mathematically feasible with current deductions' : `Converged in ${bd.iters} iteration${bd.iters===1?'':'s'} · Δ < ₹0.01`);

  return { ...bd, params };
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetFlipkartCalculator() {
  const nameEl = document.getElementById('fkCalcName'); if (nameEl) nameEl.value = '';
  const skuEl  = document.getElementById('fkCalcSku');  if (skuEl)  skuEl.value  = '';
  const costEl = document.getElementById('fkCalcCost'); if (costEl) costEl.value = '300';
  const gstEl  = document.getElementById('fkCalcProductGst'); if (gstEl) gstEl.value = '18';
  const commEl = document.getElementById('fkCalcCommission'); if (commEl) commEl.value = '10';
  const wtEl   = document.getElementById('fkCalcWeight'); if (wtEl) wtEl.value = '500';
  const lenEl  = document.getElementById('fkCalcLength'); if (lenEl) lenEl.value = '20';
  const widEl  = document.getElementById('fkCalcWidth');  if (widEl) widEl.value = '15';
  const htEl   = document.getElementById('fkCalcHeight'); if (htEl) htEl.value = '5';
  const znEl   = document.getElementById('fkCalcZone'); if (znEl) znEl.value = 'zonal';
  const adsEl  = document.getElementById('fkCalcAds'); if (adsEl) adsEl.value = '0';
  const revEl  = document.getElementById('fkCalcReview'); if (revEl) revEl.value = '0';
  const retEl  = document.getElementById('fkCalcReturnRate'); if (retEl) retEl.value = '5';
  const tpEl   = document.getElementById('fkCalcTargetProfit'); if (tpEl) tpEl.value = '15';
  setFkTier('bronze');
  setFkPayMode('prepaid');
  setFkAdsMode('flat');
  syncFkProfitSlider(15);
  setFkCalcMode('A');
  cancelFlipkartEdit();
  calculateFlipkartPrice();
}

// ── Cancel edit ───────────────────────────────────────────────────────────────
function cancelFlipkartEdit() {
  editingFkId = null;
  const banner = document.getElementById('fkEditBanner');
  if (banner) banner.style.display = 'none';
  const c = document.getElementById('fkSaveBtnContainer');
  if (c) c.innerHTML = `
    <button type="button" id="btnFkSave" class="btn-save-tracker" onclick="saveFlipkartToTracker()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      <span>Save to Flipkart Price Tracker</span>
    </button>
  `;
}

// ── Save to tracker ───────────────────────────────────────────────────────────
function saveFlipkartToTracker() {
  const name = document.getElementById('fkCalcName')?.value.trim() || 'Custom Product';
  const sku  = document.getElementById('fkCalcSku')?.value.trim()  || ('FK-' + Date.now().toString().slice(-4));
  const result = calculateFlipkartPrice();
  const bd = result;
  const p  = bd.params;

  if (!bd.sp || bd.sp <= 0 || bd.impossible) {
    showToast('Invalid calculation. Check your cost and target margin.', 'error');
    return;
  }

  const entry = {
    id: editingFkId || Date.now(),
    date: new Date().toISOString().split('T')[0],
    sku, name,
    calcMode: fkCalcMode,
    cost: p.cost,
    targetMargin: (p.targetProfit * 100).toFixed(1),
    sp: bd.sp,
    totalFkFees: bd.totalFkFees,
    gstOnFkFees: bd.gstOnFkFees,
    netGovtGst: bd.netGovtGst,
    netProfit: bd.netProfit,
    actualMargin: bd.actualMargin.toFixed(1),
    g: p.g, commRate: p.commRate, tier: p.tier,
    weightGrams: p.weightGrams, deadWeight: p.deadWeight, lengthCm: p.lengthCm, widthCm: p.widthCm, heightCm: p.heightCm, volWeightGrams: p.volWeightGrams, zone: p.zone, payMode: p.payMode,
    adsFlat: p.adsFlat, adsPct: p.adsPct, adsMode: p.adsMode,
    reviewCost: p.reviewCost, returnRate: p.returnRate
  };

  if (editingFkId) {
    const idx = trackedFlipkartList.findIndex(i => i.id === editingFkId);
    if (idx !== -1) {
      trackedFlipkartList[idx] = { ...trackedFlipkartList[idx], ...entry };
      saveFkTracking('Updated Flipkart price for ' + sku);
      renderFkTrackerTable();
      cancelFlipkartEdit();
      updateFkTrackedBadge();
      switchFkSubtab('tracker');
      showToast(`Updated Flipkart price for ${sku} (${formatCurrency(bd.sp)})! ✓`, 'success');
      return;
    }
  }

  trackedFlipkartList.unshift(entry);
  saveFkTracking('Added Flipkart price for ' + sku);
  renderFkTrackerTable();
  updateFkTrackedBadge();
  switchFkSubtab('tracker');
  showToast(`Saved ${sku} (${formatCurrency(bd.sp)}) to Flipkart Tracker! ✓`, 'success');
}

// ── Persist ───────────────────────────────────────────────────────────────────
function saveFkTracking(actionDesc = '', allowEmpty = false) {
  localStorage.setItem('lynxora_flipkart_tracker', JSON.stringify(trackedFlipkartList));
  if (typeof broadcastToCloud === 'function') {
    broadcastToCloud('flipkartTracker', actionDesc || (editingFkId ? 'Updated Flipkart tracked listing' : 'Added Flipkart tracked listing'), allowEmpty);
  }
}

// ── Search ────────────────────────────────────────────────────────────────────
function handleFkSearch(query) {
  fkSearchQuery = (query || '').trim().toLowerCase();
  renderFkTrackerTable();
  const clearBtn = document.getElementById('fkTrackerSearchClear');
  if (clearBtn) clearBtn.style.display = fkSearchQuery ? 'block' : 'none';
}
function clearFkSearch() {
  fkSearchQuery = '';
  const i = document.getElementById('fkTrackerSearch');
  if (i) i.value = '';
  const c = document.getElementById('fkTrackerSearchClear');
  if (c) c.style.display = 'none';
  renderFkTrackerTable();
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderFkTrackerTable() {
  updateFkTrackedBadge();
  const tbody = document.getElementById("fkTrackerTableBody");
  if (!tbody) return;

  let list = trackedFlipkartList;
  if (fkSearchQuery) {
    list = list.filter(i =>
      (i.sku  || "").toLowerCase().includes(fkSearchQuery) ||
      (i.name || "").toLowerCase().includes(fkSearchQuery)
    );
  }

  if (!list.length) {
    if (fkSearchQuery) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:28px;color:var(--text-muted);">
        <div style="display:flex;justify-content:center;margin-bottom:6px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></div>
        <div style="font-weight:700;font-size:14px;color:var(--text-1);">No listings matching "${escapeHtml(fkSearchQuery)}"</div>
        <div style="font-size:12px;margin-top:4px;color:var(--text-muted);">Try checking the SKU or <a href="javascript:void(0)" onclick="clearFkSearch()" style="color:#38bdf8;font-weight:600;">clear search</a></div>
      </td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 48px 24px; color: var(--text-muted);">
        <div style="display:flex;justify-content:center;margin-bottom:12px;"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
        <div style="font-weight: 800; font-size: 16px; color: var(--text-1); margin-bottom: 4px;">No Tracked Flipkart Listings Yet</div>
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 18px;">Configure your cost, weight, and profit targets in the calculator to track your listings here.</div>
        <button type="button" class="btn btn-primary" onclick="switchFkSubtab('calculator')" style="padding: 10px 20px; font-weight: 800; font-size: 13px; display: inline-flex; align-items: center; gap: 6px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M8 18h.01M12 18h.01"/></svg>
          <span>Open Flipkart Price Calculator</span>
        </button>
      </td></tr>`;
    }
    return;
  }

  tbody.innerHTML = list.map(item => {
    const totalFkWithGst = (item.totalFkFees || 0) + (item.gstOnFkFees || 0);
    const zoneLabel = { local:'Local', zonal:'Zonal', national:'National' }[item.zone] || item.zone || 'Zonal';
    return `
    <tr>
      <td style="font-size:11.5px;color:var(--text-muted);">${item.date || ''}</td>
      <td><span style="background:rgba(59,130,246,0.12);color:#38bdf8;padding:2px 8px;border-radius:6px;font-family:monospace;font-size:12px;font-weight:700;border:1px solid rgba(56,189,248,0.25);">${escapeHtml(item.sku)}</span></td>
      <td style="font-weight:600;color:var(--text-1);">${escapeHtml(item.name)}</td>
      <td style="font-weight:700;color:var(--text-1);">${formatCurrency(item.cost)}</td>
      <td style="font-size:11px;font-weight:600;color:var(--text-2);">${(item.tier||'bronze').charAt(0).toUpperCase()+(item.tier||'bronze').slice(1)} / ${zoneLabel}</td>
      <td style="color:#f97316;font-weight:700;">${formatCurrency(totalFkWithGst)}</td>
      <td style="color:var(--text-2);font-weight:600;">${formatCurrency(item.netGovtGst)}</td>
      <td style="font-weight:900;font-size:15px;color:var(--lynxora-coral);white-space:nowrap;">${formatCurrency(item.sp)}</td>
      <td style="color:#10b981;font-weight:800;">${formatCurrency(item.netProfit)}</td>
      <td><span style="background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.3);padding:3px 8px;border-radius:6px;font-size:12px;font-weight:800;">${item.actualMargin}%</span></td>
      <td style="white-space:nowrap;">
        <button class="action-btn" onclick="loadFkEditInCalculator(${item.id})" title="Edit in Calculator" style="width:30px;height:30px;margin-right:6px;background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="action-btn action-delete" onclick="deleteFkTracked(${item.id})" title="Delete" style="width:30px;height:30px;background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.25);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

// ── Load item into calculator for editing ─────────────────────────────────────
function loadFkEditInCalculator(id) {
  switchFkSubtab("calculator");
  const item = trackedFlipkartList.find(i => i.id === id);
  if (!item) return;

  editingFkId = item.id;

  const nameEl = document.getElementById('fkCalcName'); if (nameEl) nameEl.value = item.name || '';
  const skuEl  = document.getElementById('fkCalcSku');  if (skuEl)  skuEl.value  = item.sku  || '';
  const costEl = document.getElementById('fkCalcCost'); if (costEl) costEl.value = item.cost ?? 300;
  const gstEl  = document.getElementById('fkCalcProductGst'); if (gstEl) gstEl.value = item.g != null ? (item.g * 100) : 18;
  const commEl = document.getElementById('fkCalcCommission'); if (commEl) commEl.value = item.commRate != null ? (item.commRate * 100) : 10;
  const wtEl   = document.getElementById('fkCalcWeight'); if (wtEl) wtEl.value = item.deadWeight ?? item.weightGrams ?? 500;
  const lenEl  = document.getElementById('fkCalcLength'); if (lenEl) lenEl.value = item.lengthCm ?? 20;
  const widEl  = document.getElementById('fkCalcWidth');  if (widEl) widEl.value = item.widthCm  ?? 15;
  const htEl   = document.getElementById('fkCalcHeight'); if (htEl) htEl.value = item.heightCm ?? 5;
  const znEl   = document.getElementById('fkCalcZone'); if (znEl) znEl.value = item.zone || 'zonal';
  const adsEl  = document.getElementById('fkCalcAds');
  if (adsEl) adsEl.value = item.adsMode === 'pct' ? (item.adsPct != null ? (item.adsPct * 100) : 0) : (item.adsFlat ?? 0);
  const revEl  = document.getElementById('fkCalcReview'); if (revEl) revEl.value = item.reviewCost ?? 0;
  const retEl  = document.getElementById('fkCalcReturnRate'); if (retEl) retEl.value = item.returnRate != null ? (item.returnRate * 100) : 5;
  const pct    = item.targetMargin ? parseFloat(item.targetMargin) : 15;
  const tpEl   = document.getElementById('fkCalcTargetProfit'); if (tpEl) tpEl.value = pct;

  setFkTier(item.tier || 'bronze');
  setFkPayMode(item.payMode || 'prepaid');
  setFkAdsMode(item.adsMode || 'flat');
  syncFkProfitSlider(pct);
  if (item.calcMode === 'B') {
    setFkCalcMode('B');
    const manualSpInput = document.getElementById('fkCalcManualSp');
    if (manualSpInput) manualSpInput.value = item.sp != null ? Number(item.sp).toFixed(2) : '0.00';
  } else {
    setFkCalcMode('A');
  }
  calculateFlipkartPrice();

  const banner = document.getElementById('fkEditBanner');
  if (banner) { banner.style.display = 'flex'; setText('fkEditBannerTitle', `Editing: ${item.sku} — ${item.name}`); }

  const c = document.getElementById("fkSaveBtnContainer");
  if (c) c.innerHTML = `
    <div style="display:flex;gap:10px;">
      <button type="button" class="btn-save-tracker-green" onclick="saveFlipkartToTracker()" style="flex:1;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        <span>Update Flipkart Price (${escapeHtml(item.sku)})</span>
      </button>
      <button type="button" class="btn btn-ghost" onclick="cancelFlipkartEdit()" style="height:48px;border-radius:12px;color:#dc2626;border-color:#fca5a5;font-weight:700;padding:0 16px;">Cancel</button>
    </div>`;

  navigateTo("flipkart");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function deleteFkTracked(id) {
  const item = trackedFlipkartList.find(i => i.id === id);
  if (!item) return;

  const detailsHtml = `
    <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 14px;text-align:left;font-size:13px;display:flex;flex-direction:column;gap:6px;">
      <div class="confirm-preview-row"><span class="confirm-preview-label">SKU:</span><span class="confirm-preview-val"><b>${escapeHtml(item.sku || 'N/A')}</b></span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Product:</span><span class="confirm-preview-val">${escapeHtml(item.name || item.sku || 'Listing')}</span></div>
      <div class="confirm-preview-row"><span class="confirm-preview-label">Selling Price:</span><span class="confirm-preview-val" style="color:#059669;font-weight:800;">${formatCurrency(item.sp || 0)}</span></div>
    </div>
  `;

  openConfirmModal({
    title: 'Delete Flipkart Tracked Listing?',
    message: 'Are you sure you want to remove this tracked listing from your Flipkart Pricing Calculator?',
    detailsHtml: detailsHtml,
    actionText: 'Yes, Remove Listing',
    actionClass: 'btn-danger',
    cancelText: 'Cancel / Keep',
    onConfirm: () => {
      trackedFlipkartList = trackedFlipkartList.filter(i => i.id !== id);
      saveFkTracking('Removed Flipkart price for ' + (item.sku || ''));
      renderFkTrackerTable();
      updateFkTrackedBadge();
      showToast('Listing removed from Flipkart tracker.', 'info');
    }
  });
}

// ── Clear all ─────────────────────────────────────────────────────────────────
function clearAllFlipkartTracked() {
  if (!trackedFlipkartList.length) return;
  openConfirmModal({
    title: 'Clear ALL Flipkart Tracked Listings?',
    message: `Are you sure you want to delete all <b>${trackedFlipkartList.length} Flipkart listings</b> from the price calculator? This cannot be undone.`,
    actionText: 'Yes, Clear All',
    actionClass: 'btn-danger',
    cancelText: 'Cancel / Keep',
    onConfirm: () => {
      trackedFlipkartList = [];
      saveFkTracking('Cleared all Flipkart tracked prices', true);
      renderFkTrackerTable();
      updateFkTrackedBadge();
      showToast('All Flipkart tracked listings cleared.', 'info');
    }
  });
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportFlipkartCSV() {
  if (!trackedFlipkartList.length) { showToast('No Flipkart listings to export!', 'error'); return; }
  const headers = ['Date','SKU','Product Name','Base Cost','Target %','Tier','Zone',
                   'Pay Mode','Total FK Fees','18% GST on Fees','Net Govt GST',
                   'Selling Price','Net Profit','Margin %'];
  const rows = trackedFlipkartList.map(item => [
    item.date, item.sku, item.name,
    (item.cost||0).toFixed(2), item.targetMargin,
    item.tier || 'bronze', item.zone || 'zonal', item.payMode || 'prepaid',
    (item.totalFkFees||0).toFixed(2), (item.gstOnFkFees||0).toFixed(2),
    (item.netGovtGst||0).toFixed(2),
    (item.sp||0).toFixed(2), (item.netProfit||0).toFixed(2), item.actualMargin
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'flipkart_price_tracker.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('Flipkart Tracker CSV exported!', 'success');
}

function importFlipkartCSV(input) {
  const file = input && input.files ? input.files[0] : null;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const text = e.target.result;
      const lines = text.split(/\r\n|\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length < 2) {
        showToast('CSV file is empty or missing data rows.', 'error');
        return;
      }

      const parseCSVLine = (line) => {
        const result = [];
        let curr = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
              curr += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            result.push(curr.trim());
            curr = '';
          } else {
            curr += char;
          }
        }
        result.push(curr.trim());
        return result;
      };

      const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      let importedCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        if (!row || row.length < 3) continue;

        const dateIdx = header.findIndex(h => h.includes('date'));
        const skuIdx = header.findIndex(h => h.includes('sku'));
        const nameIdx = header.findIndex(h => h.includes('name') || h.includes('product'));
        const costIdx = header.findIndex(h => h.includes('cost'));
        const targetIdx = header.findIndex(h => h.includes('target'));
        const tierIdx = header.findIndex(h => h.includes('tier'));
        const zoneIdx = header.findIndex(h => h.includes('zone'));
        const payIdx = header.findIndex(h => h.includes('pay'));
        const feesIdx = header.findIndex(h => h.includes('fees') || h.includes('fkfees'));
        const gstFeesIdx = header.findIndex(h => h.includes('gstonfees') || h.includes('18gst'));
        const netGstIdx = header.findIndex(h => h.includes('netgovt') || h.includes('govt'));
        const spIdx = header.findIndex(h => h.includes('selling') || h.includes('sp'));
        const profitIdx = header.findIndex(h => h.includes('profit'));
        const marginIdx = header.findIndex(h => h.includes('margin'));

        const sku = (skuIdx !== -1 ? row[skuIdx] : row[1]) || ('SKU-' + Date.now().toString().slice(-4));
        const name = (nameIdx !== -1 ? row[nameIdx] : row[2]) || sku;
        const date = (dateIdx !== -1 ? row[dateIdx] : row[0]) || new Date().toISOString().split('T')[0];
        const cost = parseFloat(costIdx !== -1 ? row[costIdx] : row[3]) || 0;
        const targetMargin = parseFloat(targetIdx !== -1 ? row[targetIdx] : row[4]) || 15;
        const tier = (tierIdx !== -1 ? row[tierIdx] : row[5]) || 'bronze';
        const zone = (zoneIdx !== -1 ? row[zoneIdx] : row[6]) || 'zonal';
        const payMode = (payIdx !== -1 ? row[payIdx] : row[7]) || 'prepaid';
        const totalFkFees = parseFloat(feesIdx !== -1 ? row[feesIdx] : row[8]) || 0;
        const gstOnFkFees = parseFloat(gstFeesIdx !== -1 ? row[gstFeesIdx] : row[9]) || 0;
        const netGovtGst = parseFloat(netGstIdx !== -1 ? row[netGstIdx] : row[10]) || 0;
        const sp = parseFloat(spIdx !== -1 ? row[spIdx] : row[11]) || 0;
        const netProfit = parseFloat(profitIdx !== -1 ? row[profitIdx] : row[12]) || 0;
        const actualMargin = (marginIdx !== -1 ? row[marginIdx] : row[13]) || targetMargin.toFixed(1);

        if (!sku || sp <= 0) continue;

        const existingIdx = trackedFlipkartList.findIndex(item => (item.sku || '').toLowerCase() === sku.toLowerCase());
        const entry = {
          id: existingIdx !== -1 ? trackedFlipkartList[existingIdx].id : Date.now() + i,
          date: date || new Date().toISOString().split('T')[0],
          sku: sku,
          name: name,
          calcMode: 'A',
          cost: cost,
          targetMargin: targetMargin.toString(),
          sp: sp,
          totalFkFees: totalFkFees,
          gstOnFkFees: gstOnFkFees,
          netGovtGst: netGovtGst,
          netProfit: netProfit,
          actualMargin: String(actualMargin),
          g: 0.18, commRate: 0.12, tier: tier,
          weightGrams: 500, deadWeight: 500, lengthCm: 10, widthCm: 10, heightCm: 5, volWeightGrams: 100,
          zone: zone, payMode: payMode,
          adsFlat: 0, adsPct: 0, adsMode: 'flat',
          reviewCost: 0, returnRate: 0.10
        };

        if (existingIdx !== -1) {
          trackedFlipkartList[existingIdx] = entry;
        } else {
          trackedFlipkartList.unshift(entry);
        }
        importedCount++;
      }

      if (importedCount > 0) {
        saveFkTracking(`Imported ${importedCount} Flipkart tracked listings from CSV`);
        renderFkTrackerTable();
        updateFkTrackedBadge();
        switchFkSubtab('tracker');
        showToast(`Successfully imported ${importedCount} Flipkart tracked listings!`, 'success');
      } else {
        showToast('No valid Flipkart listings found in CSV.', 'error');
      }
    } catch (err) {
      console.error('[Flipkart CSV Import Error]', err);
      showToast('Failed to parse CSV file: ' + err.message, 'error');
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════════
//  PASTEL AESTHETIC THEME ENGINE (PASTEL DREAM / MIDNIGHT VELVET)
// ══════════════════════════════════════════════════
function getAppTheme() {
  return localStorage.getItem('lynxora_theme') || 'light';
}

function setAppTheme(theme) {
  const root = document.documentElement;
  const isDark = theme === 'dark';
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');
  localStorage.setItem('lynxora_theme', isDark ? 'dark' : 'light');

  // Update Topbar Toggle Button
  const topbarLabel = document.getElementById('themeToggleLabel');
  const topbarIcon = document.getElementById('themeToggleIcon');
  if (topbarLabel) topbarLabel.textContent = isDark ? 'Midnight Velvet' : 'Pastel Dream';
  if (topbarIcon) {
    topbarIcon.innerHTML = isDark
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
  }

  // Update Sidebar Toggle Button
  const sbLabel = document.getElementById('sidebarThemeToggleLabel');
  const sbIcon = document.getElementById('sidebarThemeToggleIcon');
  if (sbLabel) sbLabel.textContent = isDark ? 'Midnight Velvet' : 'Pastel Dream Mode';
  if (sbIcon) {
    sbIcon.innerHTML = isDark
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
  }

  // If dashboard is active and charts exist, update them with theme colors
  if (typeof activePage !== 'undefined' && activePage === 'dashboard' && typeof updateDashboard === 'function') {
    try { updateDashboard(); } catch (e) {}
  }
}

function toggleAppTheme() {
  const current = getAppTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setAppTheme(next);
  if (typeof showToast === 'function') {
    showToast(next === 'dark' ? 'Switched to Midnight Velvet Theme' : 'Switched to Pastel Dream Theme', 'info');
  }
}

function initTheme() {
  const saved = getAppTheme();
  setAppTheme(saved);
}

document.addEventListener('DOMContentLoaded', init);

