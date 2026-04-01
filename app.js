/* =========================================
   CLEARRUN – APP.JS
   ========================================= */

const SUPABASE_URL      = 'https://avmdholmwuuxaiqttnqd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2bWRob2xtd3V1eGFpcXR0bnFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTUyMDcsImV4cCI6MjA5MDU3MTIwN30.e5ns46NF1ERR5H1Z6y_m65KTqfy7rp7Jzy7KCH5Zseg';

let sbClient       = null;
let customers      = [];
let jobs           = [];
let scheduleView   = 'week';
let scheduleOffset = 0;
let routeMode      = false;
let payView        = 'unpaid'; // 'unpaid' | 'paid' | 'all'

// ─────────────────────────────────────────
// STARTUP & AUTH
// ─────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Check for existing session first
  const { data: { session } } = await sbClient.auth.getSession();
  if (session) {
    showApp();
  } else {
    showLogin();
  }

  // Listen for auth state changes (login / logout)
  sbClient.auth.onAuthStateChange((_event, session) => {
    if (session) showApp();
    else showLogin();
  });
});

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
  // Clear any sensitive fields
  const e = document.getElementById('login-email');
  const p = document.getElementById('login-password');
  if (p) p.value = '';
  if (e) e.focus();
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';
  setupTheme();
  setupTabs();
  setupToggleLabels();
  setTodayLabel();
  setupOverlayClose();
  setDefaultPayDates();
  bootstrap();
}

async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const loadEl   = document.getElementById('login-loading');
  const btn      = document.getElementById('login-btn');

  if (!email || !password) {
    errEl.textContent = 'Please enter your email and password.';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  btn.disabled = true;
  loadEl.style.display = 'block';

  const { error } = await sbClient.auth.signInWithPassword({ email, password });

  btn.disabled = false;
  loadEl.style.display = 'none';

  if (error) {
    errEl.textContent = error.message === 'Invalid login credentials'
      ? 'Incorrect email or password.'
      : error.message;
    errEl.style.display = 'block';
  }
  // On success, onAuthStateChange fires showApp() automatically
}

async function doLogout() {
  await sbClient.auth.signOut();
  // onAuthStateChange fires showLogin() automatically
  showToast('Signed out', '');
}

async function bootstrap() {
  await ensureTables();
  await loadCustomers();
  await loadJobs();
  renderToday();
  renderSchedule();
  renderCustomers();
  renderPayments();
  startAutoRefresh();
}

// ─────────────────────────────────────────
// AUTO-REFRESH
// ─────────────────────────────────────────
const AUTO_REFRESH_INTERVAL = 15_000; // 15 seconds
let autoRefreshTimer = null;

function startAutoRefresh() {
  autoRefreshTimer = setInterval(silentRefresh, AUTO_REFRESH_INTERVAL);
  // Also refresh whenever the browser tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') silentRefresh();
  });
}

async function silentRefresh() {
  await loadCustomers();
  await loadJobs();
  renderAll();
}

// ─────────────────────────────────────────
// THEME
// ─────────────────────────────────────────
function setupTheme() {
  const saved = localStorage.getItem('cr-theme');
  // Default to dark; respect OS preference only if no saved choice
  const preferLight = !saved && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved === 'light' || preferLight ? 'light' : 'dark');
}

function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
}

function toggleTheme() {
  const next = document.body.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('cr-theme', next);
  applyTheme(next);
}

// ─────────────────────────────────────────
// MANUAL SYNC
// ─────────────────────────────────────────
async function manualSync() {
  const btn = document.getElementById('sync-btn');
  if (btn) btn.classList.add('spinning');
  try {
    await loadCustomers();
    await loadJobs();
    renderAll();
    showToast('Synced ✓', 'success');
  } catch (err) {
    console.error('Sync error:', err);
    showToast('Sync failed: ' + (err?.message || err), 'error');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

// ─────────────────────────────────────────
// TABLE CHECK
// ─────────────────────────────────────────
async function ensureTables() {
  const { error } = await sbClient.from('cr_customers').select('id').limit(1);
  if (error && error.code === '42P01') {
    showToast('Tables missing – check console for SQL', 'error');
    console.log(`-- Run in Supabase SQL Editor:
create table if not exists cr_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text, town text, postcode text,
  phone text, email text, notes text,
  created_at timestamptz default now()
);
create table if not exists cr_jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references cr_customers(id) on delete cascade,
  scheduled_date date not null,
  scheduled_time time,
  price numeric(8,2) default 0,
  pvc_cleaning boolean default false,
  notes text,
  recurring text default 'none',
  completed boolean default false,
  paid boolean default false,
  sort_order integer default 0,
  created_at timestamptz default now()
);
alter table cr_customers enable row level security;
alter table cr_jobs enable row level security;
create policy "allow all" on cr_customers for all using (true) with check (true);
create policy "allow all" on cr_jobs for all using (true) with check (true);
-- If cr_jobs already exists, just add paid column:
-- alter table cr_jobs add column if not exists paid boolean default false;`);
  }
}

// ─────────────────────────────────────────
// DATA
// ─────────────────────────────────────────
async function loadCustomers() {
  const { data, error } = await sbClient
    .from('cr_customers').select('*').order('name');
  if (!error) customers = data || [];
}

async function loadJobs() {
  const { data, error } = await sbClient
    .from('cr_jobs')
    .select('*, cr_customers(name, address, town, postcode)')
    .order('scheduled_date')
    .order('sort_order')
    .order('scheduled_time');
  if (!error) jobs = data || [];
}

// ─────────────────────────────────────────
// TABS
// ─────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ─────────────────────────────────────────
// TODAY
// ─────────────────────────────────────────
function setTodayLabel() {
  document.getElementById('today-date-label').textContent =
    new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function renderToday() {
  const today     = todayISO();
  const list      = document.getElementById('jobs-list');
  const empty     = document.getElementById('jobs-empty');
  const todayJobs = jobs
    .filter(j => j.scheduled_date === today)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  list.innerHTML = '';

  if (todayJobs.length === 0) {
    empty.style.display = '';
    updateStats([], 0, 0, 0);
    return;
  }
  empty.style.display = 'none';
  todayJobs.forEach(job => list.appendChild(buildJobCard(job)));
  if (routeMode) enableDragDrop();

  const total = todayJobs.reduce((s, j) => s + Number(j.price || 0), 0);
  const done  = todayJobs.filter(j => j.completed).length;
  const paid  = todayJobs.filter(j => j.paid).length;
  updateStats(todayJobs, done, total, paid);
}

function updateStats(jobArr, done, total, paid) {
  document.getElementById('stat-total').textContent = jobArr.length;
  document.getElementById('stat-done').textContent  = done  ?? 0;
  document.getElementById('stat-value').textContent = (total || 0).toFixed(2);
  document.getElementById('stat-paid').textContent  = paid  ?? 0;
  const pct = jobArr.length > 0 ? (done / jobArr.length) * 100 : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
}

function buildJobCard(job) {
  const cust    = job.cr_customers || {};
  const addr    = [cust.address, cust.town].filter(Boolean).join(', ');
  const timeStr = job.scheduled_time ? job.scheduled_time.slice(0, 5) : '';

  const card = document.createElement('div');
  card.className  = 'job-card' + (job.completed ? ' completed' : '');
  card.dataset.id = job.id;
  card.setAttribute('draggable', routeMode);

  card.innerHTML = `
    <div class="drag-handle">⠿</div>
    <div class="job-check${job.completed ? ' checked' : ''}" onclick="toggleComplete('${job.id}',event)">
      ${job.completed ? '✓' : ''}
    </div>
    <div class="job-info">
      <div class="job-name">${escHtml(cust.name || 'Unknown')}</div>
      ${addr ? `<div class="job-address">📍 ${escHtml(addr)}</div>` : ''}
      <div class="job-meta">
        ${timeStr           ? `<span class="job-tag time">🕐 ${timeStr}</span>` : ''}
        ${job.pvc_cleaning  ? '<span class="job-tag pvc">PVC</span>' : ''}
        ${job.recurring !== 'none' ? `<span class="job-tag recurring">↻ ${capFirst(job.recurring)}</span>` : ''}
        ${job.notes         ? '<span class="job-tag">📝</span>' : ''}
      </div>
    </div>
    <div class="job-right">
      <div class="job-price">£${Number(job.price || 0).toFixed(2)}</div>
      <button class="paid-btn${job.paid ? ' paid' : ''}" onclick="togglePaid('${job.id}',event)">
        ${job.paid ? '£ Paid' : '£ Unpaid'}
      </button>
      <div class="job-actions">
        <button class="icon-action" onclick="editJob('${job.id}',event)" title="Edit">✏️</button>
        <button class="icon-action danger" onclick="deleteJob('${job.id}',event)" title="Delete">🗑</button>
      </div>
    </div>`;
  return card;
}

// ─────────────────────────────────────────
// TOGGLE COMPLETE / PAID
// ─────────────────────────────────────────
async function toggleComplete(id, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  const newVal = !job.completed;
  const { error } = await sbClient.from('cr_jobs').update({ completed: newVal }).eq('id', id);
  if (error) return showToast('Update failed', 'error');
  job.completed = newVal;
  renderAll();
  showToast(newVal ? 'Job complete ✓' : 'Marked incomplete', newVal ? 'success' : '');
}

async function togglePaid(id, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  const newVal = !job.paid;
  const { error } = await sbClient.from('cr_jobs').update({ paid: newVal }).eq('id', id);
  if (error) return showToast('Update failed', 'error');
  job.paid = newVal;
  renderAll();
  showToast(newVal ? '£ Payment recorded ✓' : 'Marked unpaid', newVal ? 'success' : '');
}

function renderAll() {
  renderToday();
  renderSchedule();
  renderCustomers();
  renderPayments();
}

// ─────────────────────────────────────────
// ROUTE MODE
// ─────────────────────────────────────────
function toggleRouteMode() {
  routeMode = !routeMode;
  const btn = document.getElementById('route-btn');
  btn.style.color       = routeMode ? 'var(--cyan)' : '';
  btn.style.borderColor = routeMode ? 'var(--cyan)' : '';
  document.getElementById('jobs-list').classList.toggle('route-mode', routeMode);
  renderToday();
  if (routeMode) showToast('Drag to reorder route', '');
}

function enableDragDrop() {
  const cards = document.querySelectorAll('.job-card');
  let dragSrc = null;
  cards.forEach(card => {
    card.addEventListener('dragstart', () => { dragSrc = card; card.classList.add('dragging'); });
    card.addEventListener('dragend',   () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.job-card').forEach(c => c.classList.remove('drag-over'));
      saveRouteOrder();
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      document.querySelectorAll('.job-card').forEach(c => c.classList.remove('drag-over'));
      if (card !== dragSrc) card.classList.add('drag-over');
    });
    card.addEventListener('drop', e => {
      e.preventDefault();
      if (dragSrc && dragSrc !== card) {
        const list = card.parentNode;
        const arr  = [...list.children];
        if (arr.indexOf(dragSrc) < arr.indexOf(card)) list.insertBefore(dragSrc, card.nextSibling);
        else list.insertBefore(dragSrc, card);
      }
    });
  });
}

async function saveRouteOrder() {
  const cards = document.querySelectorAll('.job-card');
  for (const [i, c] of [...cards].entries()) {
    await sbClient.from('cr_jobs').update({ sort_order: i }).eq('id', c.dataset.id);
    const j = jobs.find(j => j.id === c.dataset.id);
    if (j) j.sort_order = i;
  }
  showToast('Route order saved', 'success');
}

// ─────────────────────────────────────────
// SCHEDULE
// ─────────────────────────────────────────
function setScheduleView(view, el) {
  scheduleView = view; scheduleOffset = 0;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderSchedule();
}

function calNav(dir) { scheduleOffset += dir; renderSchedule(); }

function renderSchedule() {
  const grid  = document.getElementById('schedule-grid');
  const label = document.getElementById('cal-label');
  const today = todayISO();
  let days    = [];

  if (scheduleView === 'week') {
    const now    = new Date();
    now.setDate(now.getDate() + scheduleOffset * 7);
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i); days.push(isoDate(d));
    }
    label.textContent = `${formatDay(days[0])} – ${formatDay(days[6])}`;
  } else {
    const now   = new Date();
    const y     = now.getFullYear();
    const m     = now.getMonth() + scheduleOffset;
    const first = new Date(y, m, 1);
    const last  = new Date(y, m + 1, 0);
    label.textContent = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    for (let d = 1; d <= last.getDate(); d++) days.push(isoDate(new Date(y, m, d)));
  }

  grid.innerHTML = '';
  days.forEach(dateStr => {
    const dayJobs = jobs.filter(j => j.scheduled_date === dateStr)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const isToday = dateStr === today;
    const d       = new Date(dateStr + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const total   = dayJobs.reduce((s, j) => s + Number(j.price || 0), 0);
    const doneCnt = dayJobs.filter(j => j.completed).length;
    const paidCnt = dayJobs.filter(j => j.paid).length;

    const block = document.createElement('div');
    block.className = 'schedule-day';

    const header = document.createElement('div');
    header.className = 'schedule-day-header' + (isToday ? ' today-header' : '');
    header.innerHTML = `
      <span class="schedule-day-name${isToday ? ' today-text' : ''}">${isToday ? '★ ' : ''}${dayName}</span>
      <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
        ${dayJobs.length > 0
          ? `<span class="schedule-day-badge">${doneCnt}/${dayJobs.length} done</span>
             <span class="schedule-day-badge paid-badge">${paidCnt} paid · £${total.toFixed(2)}</span>`
          : `<span class="schedule-day-badge">No jobs</span>`}
        <button class="sched-add-btn" onclick="openAddJobModal('${dateStr}');event.stopPropagation()">+</button>
      </div>`;
    header.addEventListener('click', () => {
      const c = block.querySelector('.schedule-jobs');
      c.style.display = c.style.display === 'none' ? '' : 'none';
    });
    block.appendChild(header);

    const jobsDiv = document.createElement('div');
    jobsDiv.className = 'schedule-jobs';

    if (dayJobs.length === 0) {
      jobsDiv.innerHTML = '<div class="schedule-empty">No jobs scheduled</div>';
      if (scheduleView === 'month') jobsDiv.style.display = 'none';
    } else {
      dayJobs.forEach(job => {
        const cust = job.cr_customers || {};
        const row  = document.createElement('div');
        row.className = 'schedule-job-row' + (job.completed ? ' completed' : '');
        row.innerHTML = `
          <button class="sj-check${job.completed ? ' done' : ''}" onclick="toggleComplete('${job.id}',event)">${job.completed ? '✓' : '○'}</button>
          <span class="sj-name">${escHtml(cust.name || '—')}</span>
          ${job.scheduled_time ? `<span class="sj-time">${job.scheduled_time.slice(0,5)}</span>` : ''}
          ${job.pvc_cleaning   ? '<span class="job-tag pvc" style="font-size:0.62rem">PVC</span>' : ''}
          <span class="sj-price">£${Number(job.price || 0).toFixed(2)}</span>
          <button class="sj-paid-btn${job.paid ? ' paid' : ''}" onclick="togglePaid('${job.id}',event)">${job.paid ? '£✓' : '£?'}</button>
          <button class="sj-edit-btn" onclick="editJob('${job.id}',event)">✏️</button>`;
        jobsDiv.appendChild(row);
      });
    }
    block.appendChild(jobsDiv);
    grid.appendChild(block);
  });
}

// ─────────────────────────────────────────
// CUSTOMERS  (shows ALL customers always)
// ─────────────────────────────────────────
function renderCustomers(filter = '') {
  const list    = document.getElementById('customers-list');
  const empty   = document.getElementById('customers-empty');

  // Always work from the full customers array; filter is just for search
  const filtered = filter.trim()
    ? customers.filter(c =>
        c.name.toLowerCase().includes(filter.toLowerCase()) ||
        (c.address  || '').toLowerCase().includes(filter.toLowerCase()) ||
        (c.town     || '').toLowerCase().includes(filter.toLowerCase()) ||
        (c.postcode || '').toLowerCase().includes(filter.toLowerCase()) ||
        (c.phone    || '').toLowerCase().includes(filter.toLowerCase()))
    : [...customers]; // always a copy of the full array

  list.innerHTML = '';

  if (customers.length === 0) {
    empty.style.display = '';
    return;
  }

  // Hide the empty state element — there are customers
  empty.style.display = 'none';

  if (filtered.length === 0) {
    // Search returned nothing but customers exist
    const noMatch = document.createElement('div');
    noMatch.className = 'empty-state';
    noMatch.innerHTML = '<span>🔍</span><p>No customers match your search.</p>';
    list.appendChild(noMatch);
    return;
  }

  filtered.forEach(cust => {
    const custJobs   = jobs.filter(j => j.customer_id === cust.id);
    const totalJobs  = custJobs.length;
    const lastJob    = custJobs
      .filter(j => j.completed)
      .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date))[0];
    const owedAmt    = custJobs
      .filter(j => j.completed && !j.paid)
      .reduce((s, j) => s + Number(j.price || 0), 0);
    const addr       = [cust.address, cust.town, cust.postcode].filter(Boolean).join(', ');
    const initials   = cust.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const lastDate   = lastJob
      ? new Date(lastJob.scheduled_date + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
      : null;

    const card = document.createElement('div');
    card.className = 'customer-card';
    card.innerHTML = `
      <div class="cust-avatar">${initials}</div>
      <div class="cust-info">
        <div class="cust-name">${escHtml(cust.name)}</div>
        ${addr       ? `<div class="cust-address">📍 ${escHtml(addr)}</div>` : ''}
        ${cust.phone ? `<div class="cust-meta-row">📞 ${escHtml(cust.phone)}</div>` : ''}
        <div class="cust-stats-row">
          <span class="cust-stat">${totalJobs} job${totalJobs !== 1 ? 's' : ''}</span>
          ${lastDate   ? `<span class="cust-stat-sep">·</span><span class="cust-stat">Last: ${lastDate}</span>` : ''}
          ${owedAmt > 0 ? `<span class="cust-stat-sep">·</span><span class="cust-stat owed">Owes £${owedAmt.toFixed(2)}</span>` : ''}
        </div>
      </div>
      <div class="cust-actions">
        <button class="icon-action" onclick="viewHistory('${cust.id}')"       title="History">📋</button>
        <button class="icon-action" onclick="addJobForCustomer('${cust.id}')" title="Add job">＋</button>
        <button class="icon-action" onclick="editCustomer('${cust.id}')"      title="Edit">✏️</button>
        <button class="icon-action danger" onclick="deleteCustomer('${cust.id}')" title="Delete">🗑</button>
      </div>`;
    list.appendChild(card);
  });
}

function filterCustomers(val) { renderCustomers(val); }

// ─────────────────────────────────────────
// PAYMENTS TAB
// ─────────────────────────────────────────
function setDefaultPayDates() {
  const now   = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  document.getElementById('pay-from').value = isoDate(first);
  document.getElementById('pay-to').value   = isoDate(now);
}

function setPayView(view, el) {
  payView = view;
  document.querySelectorAll('.pay-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderPayments();
}

function clearPayDates() {
  document.getElementById('pay-from').value = '';
  document.getElementById('pay-to').value   = '';
  renderPayments();
}

function renderPayments() {
  const from = document.getElementById('pay-from').value;
  const to   = document.getElementById('pay-to').value;

  // Filter jobs by view and optional date range (use scheduled_date)
  let filtered = jobs.filter(j => j.completed); // only count completed jobs in payments

  if (payView === 'unpaid') filtered = filtered.filter(j => !j.paid);
  if (payView === 'paid')   filtered = filtered.filter(j =>  j.paid);

  if (from) filtered = filtered.filter(j => j.scheduled_date >= from);
  if (to)   filtered = filtered.filter(j => j.scheduled_date <= to);

  // Sort newest first
  filtered.sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));

  // Update summary cards (always based on ALL completed jobs, not filtered)
  const allCompleted = jobs.filter(j => j.completed);
  const totalOwed      = allCompleted.filter(j => !j.paid).reduce((s, j) => s + Number(j.price || 0), 0);
  const totalCollected = allCompleted.filter(j =>  j.paid).reduce((s, j) => s + Number(j.price || 0), 0);
  const unpaidCount    = allCompleted.filter(j => !j.paid).length;

  document.getElementById('pay-total-owed').textContent      = `£${totalOwed.toFixed(2)}`;
  document.getElementById('pay-total-collected').textContent = `£${totalCollected.toFixed(2)}`;
  document.getElementById('pay-unpaid-count').textContent    = unpaidCount;

  const container = document.getElementById('payments-list');
  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><span>💸</span><p>No ${payView === 'all' ? '' : payView} jobs${from || to ? ' in this date range' : ''}.</p></div>`;
    return;
  }

  // Group by customer
  const byCustomer = {};
  filtered.forEach(job => {
    const cid = job.customer_id || '__unknown__';
    if (!byCustomer[cid]) byCustomer[cid] = [];
    byCustomer[cid].push(job);
  });

  // Sort customer groups by total owed descending
  const sorted = Object.entries(byCustomer).sort((a, b) => {
    const sumA = a[1].reduce((s, j) => s + Number(j.price || 0), 0);
    const sumB = b[1].reduce((s, j) => s + Number(j.price || 0), 0);
    return sumB - sumA;
  });

  sorted.forEach(([custId, custJobs]) => {
    const cust      = customers.find(c => c.id === custId) || { name: 'Unknown Customer' };
    const groupTotal = custJobs.reduce((s, j) => s + Number(j.price || 0), 0);
    const initials  = cust.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const allPaid   = custJobs.every(j => j.paid);

    const group = document.createElement('div');
    group.className = 'pay-group';

    // Group header
    const gh = document.createElement('div');
    gh.className = 'pay-group-header';
    gh.innerHTML = `
      <div class="pay-group-left">
        <div class="cust-avatar small">${initials}</div>
        <div>
          <div class="pay-group-name">${escHtml(cust.name)}</div>
          <div class="pay-group-count">${custJobs.length} job${custJobs.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="pay-group-right">
        <div class="pay-group-total ${allPaid ? 'is-paid' : 'is-owed'}">£${groupTotal.toFixed(2)}</div>
        ${!allPaid ? `<button class="btn-mark-all-paid" onclick="markAllPaid('${custId}', event)">Mark all paid</button>` : ''}
      </div>`;
    group.appendChild(gh);

    // Job rows
    custJobs.forEach(job => {
      const d       = new Date(job.scheduled_date + 'T00:00:00');
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const row     = document.createElement('div');
      row.className = 'pay-job-row';
      row.innerHTML = `
        <span class="pay-job-date">${dateStr}</span>
        ${job.pvc_cleaning ? '<span class="job-tag pvc" style="font-size:0.62rem">PVC</span>' : ''}
        ${job.notes ? `<span class="pay-job-note" title="${escHtml(job.notes)}">📝</span>` : ''}
        <span class="pay-job-price">£${Number(job.price || 0).toFixed(2)}</span>
        <button class="sj-paid-btn${job.paid ? ' paid' : ''}" onclick="togglePaid('${job.id}',event)">
          ${job.paid ? '£ Paid' : '£ Unpaid'}
        </button>`;
      group.appendChild(row);
    });

    container.appendChild(group);
  });
}

async function markAllPaid(custId, e) {
  if (e) e.stopPropagation();
  const unpaid = jobs.filter(j => j.customer_id === custId && j.completed && !j.paid);
  if (unpaid.length === 0) return;
  for (const job of unpaid) {
    const { error } = await sbClient.from('cr_jobs').update({ paid: true }).eq('id', job.id);
    if (!error) job.paid = true;
  }
  renderAll();
  showToast(`${unpaid.length} job${unpaid.length > 1 ? 's' : ''} marked paid ✓`, 'success');
}

// ─────────────────────────────────────────
// JOB MODAL
// ─────────────────────────────────────────
function openAddJobModal(date) {
  document.getElementById('job-modal-title').textContent = 'Add Job';
  document.getElementById('job-edit-id').value           = '';
  document.getElementById('job-date').value              = date || todayISO();
  document.getElementById('job-time').value              = '';
  document.getElementById('job-price').value             = '';
  document.getElementById('job-pvc').checked             = false;
  document.getElementById('pvc-label').textContent       = 'No';
  document.getElementById('job-notes').value             = '';
  document.getElementById('job-recurring').value         = 'none';
  document.getElementById('job-paid').checked            = false;
  document.getElementById('paid-label').textContent      = 'No';
  populateCustomerDropdown('');
  document.getElementById('job-modal').classList.add('active');
}

function addJobForCustomer(custId) {
  openAddJobModal();
  setTimeout(() => { document.getElementById('job-customer').value = custId; }, 50);
}

function editJob(id, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  populateCustomerDropdown(job.customer_id);
  document.getElementById('job-modal-title').textContent = 'Edit Job';
  document.getElementById('job-edit-id').value           = job.id;
  document.getElementById('job-customer').value          = job.customer_id || '';
  document.getElementById('job-date').value              = job.scheduled_date;
  document.getElementById('job-time').value              = job.scheduled_time ? job.scheduled_time.slice(0,5) : '';
  document.getElementById('job-price').value             = job.price || '';
  document.getElementById('job-pvc').checked             = !!job.pvc_cleaning;
  document.getElementById('pvc-label').textContent       = job.pvc_cleaning ? 'Yes' : 'No';
  document.getElementById('job-notes').value             = job.notes || '';
  document.getElementById('job-recurring').value         = job.recurring || 'none';
  document.getElementById('job-paid').checked            = !!job.paid;
  document.getElementById('paid-label').textContent      = job.paid ? 'Yes' : 'No';
  document.getElementById('job-modal').classList.add('active');
}

function closeJobModal() { document.getElementById('job-modal').classList.remove('active'); }

function populateCustomerDropdown(selectedId) {
  const sel = document.getElementById('job-customer');
  sel.innerHTML = '<option value="">— Select customer —</option>';
  customers.forEach(c => {
    const opt       = document.createElement('option');
    opt.value       = c.id;
    opt.textContent = c.name + (c.town ? ` · ${c.town}` : '');
    if (c.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function saveJob() {
  const editId = document.getElementById('job-edit-id').value;
  const custId = document.getElementById('job-customer').value;
  const date   = document.getElementById('job-date').value;
  if (!custId) return showToast('Please select a customer', 'error');
  if (!date)   return showToast('Please set a date', 'error');

  const payload = {
    customer_id:    custId,
    scheduled_date: date,
    scheduled_time: document.getElementById('job-time').value || null,
    price:          parseFloat(document.getElementById('job-price').value) || 0,
    pvc_cleaning:   document.getElementById('job-pvc').checked,
    notes:          document.getElementById('job-notes').value.trim() || null,
    recurring:      document.getElementById('job-recurring').value,
    paid:           document.getElementById('job-paid').checked,
  };

  if (editId) {
    const { error } = await sbClient.from('cr_jobs').update(payload).eq('id', editId);
    if (error) return showToast('Update failed: ' + error.message, 'error');
    showToast('Job updated ✓', 'success');
  } else {
    const { error } = await sbClient.from('cr_jobs').insert(payload);
    if (error) return showToast('Save failed: ' + error.message, 'error');
    showToast('Job added ✓', 'success');
    if (payload.recurring !== 'none') await createRecurringJobs(payload, 12);
  }

  closeJobModal();
  await loadJobs();
  renderAll();
}

async function createRecurringJobs(base, count) {
  const list = [];
  let d = new Date(base.scheduled_date + 'T00:00:00');
  for (let i = 0; i < count; i++) {
    if      (base.recurring === 'weekly')      d.setDate(d.getDate() + 7);
    else if (base.recurring === 'fortnightly') d.setDate(d.getDate() + 14);
    else if (base.recurring === 'monthly')     d.setMonth(d.getMonth() + 1);
    else if (base.recurring === 'bimonthly')   d.setMonth(d.getMonth() + 2);
    list.push({ ...base, scheduled_date: isoDate(d), completed: false, paid: false, sort_order: 0 });
  }
  await sbClient.from('cr_jobs').insert(list);
}

async function deleteJob(id, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!confirm('Delete this job?')) return;
  const { error } = await sbClient.from('cr_jobs').delete().eq('id', id);
  if (error) return showToast('Delete failed', 'error');
  jobs = jobs.filter(j => j.id !== id);
  renderAll();
  showToast('Job deleted', '');
}

// ─────────────────────────────────────────
// CUSTOMER MODAL
// ─────────────────────────────────────────
function openCustomerModal() {
  document.getElementById('customer-modal-title').textContent = 'New Customer';
  document.getElementById('cust-edit-id').value = '';
  ['cust-name','cust-address','cust-town','cust-postcode','cust-phone','cust-email','cust-notes']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('customer-modal').classList.add('active');
}

function editCustomer(id) {
  const cust = customers.find(c => c.id === id);
  if (!cust) return;
  document.getElementById('customer-modal-title').textContent = 'Edit Customer';
  document.getElementById('cust-edit-id').value    = cust.id;
  document.getElementById('cust-name').value       = cust.name     || '';
  document.getElementById('cust-address').value    = cust.address  || '';
  document.getElementById('cust-town').value       = cust.town     || '';
  document.getElementById('cust-postcode').value   = cust.postcode || '';
  document.getElementById('cust-phone').value      = cust.phone    || '';
  document.getElementById('cust-email').value      = cust.email    || '';
  document.getElementById('cust-notes').value      = cust.notes    || '';
  document.getElementById('customer-modal').classList.add('active');
}

function closeCustomerModal() { document.getElementById('customer-modal').classList.remove('active'); }

async function saveCustomer() {
  const editId = document.getElementById('cust-edit-id').value;
  const name   = document.getElementById('cust-name').value.trim();
  if (!name) return showToast('Name is required', 'error');

  const payload = {
    name,
    address:  document.getElementById('cust-address').value.trim()  || null,
    town:     document.getElementById('cust-town').value.trim()     || null,
    postcode: document.getElementById('cust-postcode').value.trim() || null,
    phone:    document.getElementById('cust-phone').value.trim()    || null,
    email:    document.getElementById('cust-email').value.trim()    || null,
    notes:    document.getElementById('cust-notes').value.trim()    || null,
  };

  if (editId) {
    const { error } = await sbClient.from('cr_customers').update(payload).eq('id', editId);
    if (error) return showToast('Update failed: ' + error.message, 'error');
    showToast('Customer updated ✓', 'success');
  } else {
    const { error } = await sbClient.from('cr_customers').insert(payload);
    if (error) return showToast('Save failed: ' + error.message, 'error');
    showToast('Customer added ✓', 'success');
  }

  closeCustomerModal();
  await loadCustomers();
  renderCustomers();
  renderPayments();
}

async function deleteCustomer(id) {
  if (!confirm('Delete this customer and all their jobs?')) return;
  const { error } = await sbClient.from('cr_customers').delete().eq('id', id);
  if (error) return showToast('Delete failed', 'error');
  customers = customers.filter(c => c.id !== id);
  jobs      = jobs.filter(j => j.customer_id !== id);
  renderAll();
  showToast('Customer deleted', '');
}

// ─────────────────────────────────────────
// HISTORY MODAL
// ─────────────────────────────────────────
function viewHistory(custId) {
  const cust = customers.find(c => c.id === custId);
  if (!cust) return;

  const custJobs   = jobs.filter(j => j.customer_id === custId)
    .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
  const paidValue  = custJobs.filter(j => j.completed && j.paid).reduce((s, j) => s + Number(j.price || 0), 0);
  const owedValue  = custJobs.filter(j => j.completed && !j.paid).reduce((s, j) => s + Number(j.price || 0), 0);
  const addr       = [cust.address, cust.town, cust.postcode].filter(Boolean).join(', ');

  let html = `
    ${addr ? `<p style="color:var(--text-secondary);font-size:0.82rem;margin-bottom:1rem">📍 ${escHtml(addr)}</p>` : ''}
    <div class="history-stats">
      <div class="history-stat"><div class="history-stat-value">${custJobs.length}</div><div class="history-stat-label">Total Jobs</div></div>
      <div class="history-stat"><div class="history-stat-value">${custJobs.filter(j=>j.completed).length}</div><div class="history-stat-label">Completed</div></div>
      <div class="history-stat"><div class="history-stat-value" style="color:var(--green)">£${paidValue.toFixed(0)}</div><div class="history-stat-label">Paid</div></div>
      <div class="history-stat"><div class="history-stat-value" style="color:${owedValue>0?'var(--amber)':'var(--text-secondary)'}">£${owedValue.toFixed(0)}</div><div class="history-stat-label">Owed</div></div>
    </div>
    <div style="margin-top:0.75rem">`;

  if (custJobs.length === 0) {
    html += '<p style="color:var(--text-muted);text-align:center;padding:1rem">No jobs yet</p>';
  } else {
    custJobs.forEach(job => {
      const dateStr = new Date(job.scheduled_date + 'T00:00:00')
        .toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
      html += `
        <div class="history-job-row">
          <span style="color:${job.completed?'var(--green)':'var(--text-secondary)'}">${job.completed?'✓':'○'}</span>
          <span style="flex:1;padding:0 0.6rem;font-size:0.83rem">${dateStr}${job.scheduled_time?' · '+job.scheduled_time.slice(0,5):''}</span>
          ${job.pvc_cleaning?'<span class="job-tag pvc" style="font-size:0.62rem;margin-right:0.3rem">PVC</span>':''}
          <span style="color:var(--cyan);font-family:\'Barlow Condensed\',sans-serif;font-weight:700;min-width:3.5rem;text-align:right">£${Number(job.price||0).toFixed(2)}</span>
          <span style="margin-left:0.5rem;font-size:0.72rem;padding:0.15rem 0.5rem;border-radius:3px;font-weight:600;
            background:${job.paid?'var(--green-dim)':'var(--amber-dim)'};
            color:${job.paid?'var(--green)':'var(--amber)'};
            border:1px solid ${job.paid?'rgba(34,197,94,0.3)':'rgba(245,158,11,0.3)'}">
            ${job.paid?'PAID':'OWED'}
          </span>
        </div>`;
    });
  }
  html += '</div>';

  document.getElementById('history-title').textContent = cust.name;
  document.getElementById('history-body').innerHTML    = html;
  document.getElementById('history-modal').classList.add('active');
}

function closeHistoryModal() { document.getElementById('history-modal').classList.remove('active'); }

// ─────────────────────────────────────────
// TOGGLE LABELS
// ─────────────────────────────────────────
function setupToggleLabels() {
  document.getElementById('job-pvc').addEventListener('change', function () {
    document.getElementById('pvc-label').textContent = this.checked ? 'Yes' : 'No';
  });
  document.getElementById('job-paid').addEventListener('change', function () {
    document.getElementById('paid-label').textContent = this.checked ? 'Yes' : 'No';
  });
}

// ─────────────────────────────────────────
// OVERLAY CLOSE
// ─────────────────────────────────────────
function setupOverlayClose() {
  ['job-modal','customer-modal','history-modal'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('click', e => { if (e.target === el) el.classList.remove('active'); });
  });
}

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function isoDate(d)  { return d.toISOString().slice(0,10); }
function formatDay(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}
function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' '+type : '') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ─────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────
Object.assign(window, {
  doLogin, doLogout,
  openAddJobModal, openCustomerModal, viewHistory,
  closeJobModal, closeCustomerModal, closeHistoryModal,
  saveJob, saveCustomer, deleteJob, deleteCustomer,
  editJob, editCustomer, addJobForCustomer,
  toggleComplete, togglePaid, markAllPaid,
  toggleRouteMode, setScheduleView, calNav,
  filterCustomers, setPayView, clearPayDates,
  toggleTheme, manualSync,
});