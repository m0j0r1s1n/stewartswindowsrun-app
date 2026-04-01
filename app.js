// Manual refresh for customers and jobs
async function refreshCustomersAndJobs() {
  document.getElementById('customers-list').innerHTML = '<div class="empty-state">Refreshing…</div>';
  await loadCustomers();
  await loadJobs();
  renderCustomers();
  showToast('Data refreshed', 'success');
}
/* =========================================
   CLEARRUN – APP.JS
   Supabase-backed window cleaning run manager
   ========================================= */

// ── Supabase config ────────────────────────────────────────
const SUPABASE_URL = 'https://avmdholmwuuxaiqttnqd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2bWRob2xtd3V1eGFpcXR0bnFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTUyMDcsImV4cCI6MjA5MDU3MTIwN30.e5ns46NF1ERR5H1Z6y_m65KTqfy7rp7Jzy7KCH5Zseg';

// supabase is initialised inside DOMContentLoaded so the SDK is guaranteed loaded
let db = null;

// ── State ─────────────────────────────────────────────────
let customers = [];
let jobs = [];
let scheduleView = 'week';
let scheduleOffset = 0;
let routeMode = false;

// ── Startup ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Init client here — SDK script is guaranteed ready after DOM load
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  setupTabs();
  setupPvcToggle();
  setTodayLabel();
  setupOverlayClose();
  await bootstrap();
});

async function bootstrap() {
  await ensureTables();
  await loadCustomers();
  await loadJobs();
  renderToday();
  renderSchedule();
  renderCustomers();
}

// ── Ensure tables exist ───────────────────────────────────
// Tables should be created in Supabase dashboard, but we guide if missing.
async function ensureTables() {
  // Just test a query; if it fails we'll show a helpful hint.
  const { error } = await db.from('cr_customers').select('id').limit(1);
  if (error && error.code === '42P01') {
    showToast('Run the SQL setup in Supabase first!', 'error');
    showSQLHelper();
  }
}

function showSQLHelper() {
  const sql = `
-- Run this SQL in your Supabase project (SQL Editor):

create table if not exists cr_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  town text,
  postcode text,
  phone text,
  email text,
  notes text,
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
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- Enable RLS (optional but recommended)
alter table cr_customers enable row level security;
alter table cr_jobs enable row level security;
create policy "allow all" on cr_customers for all using (true) with check (true);
create policy "allow all" on cr_jobs for all using (true) with check (true);
`.trim();

  console.log('%cClearRun SQL Setup:\n' + sql, 'font-family:monospace;color:cyan');
  alert('Tables missing! Check the browser console for the SQL to run in Supabase.');
}

// ── Data loading ──────────────────────────────────────────
async function loadCustomers() {
  const { data, error } = await db
    .from('cr_customers')
    .select('*')
    .order('name');
  if (!error) customers = data || [];
}

async function loadJobs() {
  const { data, error } = await db
    .from('cr_jobs')
    .select('*, cr_customers(name, address, town, postcode)')
    .order('sort_order')
    .order('scheduled_time');
  if (!error) jobs = data || [];
}

// ── Tabs ──────────────────────────────────────────────────
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

// ── Today label ───────────────────────────────────────────
function setTodayLabel() {
  const now = new Date();
  const label = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('today-date-label').textContent = label;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Render Today ──────────────────────────────────────────
function renderToday() {
  const today = todayISO();
  const todayJobs = jobs.filter(j => j.scheduled_date === today)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const list = document.getElementById('jobs-list');
  const empty = document.getElementById('jobs-empty');

  list.innerHTML = '';
  if (todayJobs.length === 0) {
    list.appendChild(empty);
    empty.style.display = '';
    updateStats([], 0);
    return;
  }
  empty.style.display = 'none';

  todayJobs.forEach(job => list.appendChild(buildJobCard(job)));
  if (routeMode) enableDragDrop();

  const total = todayJobs.reduce((s, j) => s + Number(j.price || 0), 0);
  const done = todayJobs.filter(j => j.completed).length;
  updateStats(todayJobs, done, total);
}

function updateStats(jobArr, done, total) {
  document.getElementById('stat-total').textContent = jobArr.length;
  document.getElementById('stat-done').textContent = done ?? 0;
  document.getElementById('stat-value').textContent = (total || 0).toFixed(2);
  const pct = jobArr.length > 0 ? (done / jobArr.length) * 100 : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
}

function buildJobCard(job) {
  const cust = job.cr_customers || {};
  const addr = [cust.address, cust.town].filter(Boolean).join(', ');
  const timeStr = job.scheduled_time ? job.scheduled_time.slice(0, 5) : '';

  const card = document.createElement('div');
  card.className = 'job-card' + (job.completed ? ' completed' : '');
  card.dataset.id = job.id;
  card.setAttribute('draggable', routeMode);

  card.innerHTML = `
    <div class="drag-handle" title="Drag to reorder">⠿</div>
    <div class="job-check" onclick="toggleComplete('${job.id}', event)">${job.completed ? '✓' : ''}</div>
    <div class="job-info">
      <div class="job-name">${escHtml(cust.name || 'Unknown Customer')}</div>
      ${addr ? `<div class="job-address">📍 ${escHtml(addr)}</div>` : ''}
      <div class="job-meta">
        ${timeStr ? `<span class="job-tag time">🕐 ${timeStr}</span>` : ''}
        ${job.pvc_cleaning ? '<span class="job-tag pvc">PVC</span>' : ''}
        ${job.recurring !== 'none' ? `<span class="job-tag recurring">↻ ${capFirst(job.recurring)}</span>` : ''}
        ${job.notes ? '<span class="job-tag">📝</span>' : ''}
      </div>
    </div>
    <div class="job-right">
      <div class="job-price">£${Number(job.price || 0).toFixed(2)}</div>
      <div class="job-actions">
        <button class="icon-action" onclick="editJob('${job.id}', event)" title="Edit">✏️</button>
        <button class="icon-action danger" onclick="deleteJob('${job.id}', event)" title="Delete">🗑</button>
        <button class="icon-action" onclick="togglePaid('${job.id}', event)" title="${job.paid ? 'Mark unpaid' : 'Mark paid'}">${job.paid ? '💷' : '💸'}</button>
      </div>
    </div>
  `;
  return card;
// Toggle paid status for a job
async function togglePaid(id, e) {
  e.stopPropagation();
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  const newVal = !job.paid;
  const { error } = await db.from('cr_jobs').update({ paid: newVal }).eq('id', id);
  if (error) return showToast('Update failed', 'error');
  job.paid = newVal;
  renderToday();
  renderSchedule();
  showToast(newVal ? 'Marked as paid 💷' : 'Marked unpaid', newVal ? 'success' : '');
}
}

// ── Complete toggle ───────────────────────────────────────
async function toggleComplete(id, e) {
  e.stopPropagation();
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  const newVal = !job.completed;
  const { error } = await db.from('cr_jobs').update({ completed: newVal }).eq('id', id);
  if (error) return showToast('Update failed', 'error');
  job.completed = newVal;
  renderToday();
  showToast(newVal ? 'Job marked complete ✓' : 'Marked incomplete', newVal ? 'success' : '');
  renderSchedule();
}

// ── Route mode / drag-drop ────────────────────────────────
function toggleRouteMode() {
  routeMode = !routeMode;
  const btn = document.getElementById('route-btn');
  btn.style.color = routeMode ? 'var(--cyan)' : '';
  btn.style.borderColor = routeMode ? 'var(--cyan)' : '';
  document.getElementById('jobs-list').classList.toggle('route-mode', routeMode);
  renderToday();
  if (routeMode) showToast('Drag to reorder route', '');
}

function enableDragDrop() {
  const cards = document.querySelectorAll('.job-card');
  let dragSrc = null;

  cards.forEach(card => {
    card.addEventListener('dragstart', () => {
      dragSrc = card;
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
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
        const cards2 = [...list.children];
        const srcIdx = cards2.indexOf(dragSrc);
        const tgtIdx = cards2.indexOf(card);
        if (srcIdx < tgtIdx) list.insertBefore(dragSrc, card.nextSibling);
        else list.insertBefore(dragSrc, card);
      }
    });
  });
}

async function saveRouteOrder() {
  const cards = document.querySelectorAll('.job-card');
  const updates = [...cards].map((c, i) => ({ id: c.dataset.id, sort_order: i }));
  for (const u of updates) {
    await db.from('cr_jobs').update({ sort_order: u.sort_order }).eq('id', u.id);
    const j = jobs.find(j => j.id === u.id);
    if (j) j.sort_order = u.sort_order;
  }
  showToast('Route order saved', 'success');
}

// ── Schedule ──────────────────────────────────────────────
function setScheduleView(view, el) {
  scheduleView = view;
  scheduleOffset = 0;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderSchedule();
}

function calNav(dir) {
  scheduleOffset += dir;
  renderSchedule();
}

function renderSchedule() {
  const grid = document.getElementById('schedule-grid');
  const label = document.getElementById('cal-label');
  const today = todayISO();

  let days = [];

  if (scheduleView === 'week') {
    const now = new Date();
    now.setDate(now.getDate() + scheduleOffset * 7);
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(isoDate(d));
    }
    label.textContent = `${formatDay(days[0])} – ${formatDay(days[6])}`;
  } else {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + scheduleOffset;
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    label.textContent = firstDay.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(isoDate(new Date(y, m, d)));
    }
  }

  grid.innerHTML = '';

  days.forEach(dateStr => {
    const dayJobs = jobs.filter(j => j.scheduled_date === dateStr)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const isToday = dateStr === today;
    const d = new Date(dateStr + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const total = dayJobs.reduce((s, j) => s + Number(j.price || 0), 0);

    const block = document.createElement('div');
    block.className = 'schedule-day';

    const header = document.createElement('div');
    header.className = 'schedule-day-header' + (isToday ? ' today-header' : '');
    header.innerHTML = `
      <span class="schedule-day-name${isToday ? ' today-text' : ''}">${isToday ? '★ ' : ''}${dayName}</span>
      <span class="schedule-day-badge">${dayJobs.length} job${dayJobs.length !== 1 ? 's' : ''} · £${total.toFixed(2)}</span>
    `;
    header.addEventListener('click', () => {
      const content = block.querySelector('.schedule-jobs');
      content.style.display = content.style.display === 'none' ? '' : 'none';
    });

    block.appendChild(header);

    const jobsDiv = document.createElement('div');
    jobsDiv.className = 'schedule-jobs';

    if (dayJobs.length === 0) {
      jobsDiv.innerHTML = '<div class="schedule-empty">No jobs</div>';
      if (scheduleView === 'month' && dayJobs.length === 0) jobsDiv.style.display = 'none';
    } else {
      dayJobs.forEach(job => {
        const cust = job.cr_customers || {};
        const row = document.createElement('div');
        row.className = 'schedule-job-row' + (job.completed ? ' completed' : '');
        row.innerHTML = `
          <span class="sj-dot${job.completed ? ' done' : ''}"></span>
          <span class="sj-name">${escHtml(cust.name || '—')}</span>
          ${job.scheduled_time ? `<span class="sj-time">${job.scheduled_time.slice(0,5)}</span>` : ''}
          ${job.pvc_cleaning ? '<span class="job-tag pvc" style="font-size:0.65rem">PVC</span>' : ''}
          <span class="sj-price">£${Number(job.price || 0).toFixed(2)}</span>
        `;
        row.addEventListener('click', () => editJob(job.id, { stopPropagation: () => {} }));
        jobsDiv.appendChild(row);
      });
    }

    block.appendChild(jobsDiv);
    grid.appendChild(block);
  });
}

// ── Customers ─────────────────────────────────────────────
let customersTab = 'all'; // 'all', 'paid', 'unpaid'



function renderCustomers(filter = '') {
  const list = document.getElementById('customers-list');
  const empty = document.getElementById('customers-empty');
  let filtered = filter
    ? customers.filter(c =>
        c.name.toLowerCase().includes(filter.toLowerCase()) ||
        (c.address || '').toLowerCase().includes(filter.toLowerCase()) ||
        (c.town || '').toLowerCase().includes(filter.toLowerCase())
      )
    : customers;

  if (!Array.isArray(jobs) || jobs.length === 0) {
    // If jobs are not loaded, always show all customers
    filtered = filtered;
  } else if (customersTab === 'paid') {
    filtered = filtered.filter(cust => jobs.some(j => j.customer_id === cust.id && j.paid));
  } else if (customersTab === 'unpaid') {
    filtered = filtered.filter(cust => {
      const custJobs = jobs.filter(j => j.customer_id === cust.id);
      // Show if no jobs at all, or all jobs are unpaid
      return custJobs.length === 0 || !custJobs.some(j => j.paid);
    });
  }

  // Update tab active state
  ['all','paid','unpaid'].forEach(tab => {
    const btn = document.getElementById(tab+'-customers-tab');
    if (btn) btn.classList.toggle('active', customersTab === tab);
  });

  list.innerHTML = '';
  if (filtered.length === 0) {
    list.appendChild(empty);
    return;
  }
  empty.style.display = 'none';

  filtered.forEach(cust => {
    const custJobs = jobs.filter(j => j.customer_id === cust.id);
    const totalEarned = custJobs.filter(j => j.completed).reduce((s, j) => s + Number(j.price || 0), 0);
    const addr = [cust.address, cust.town, cust.postcode].filter(Boolean).join(', ');
    const initials = cust.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    const hasPaid = custJobs.some(j => j.paid);
    const card = document.createElement('div');
    card.className = 'customer-card';
    card.innerHTML = `
      <div class="cust-avatar">${initials}</div>
      <div class="cust-info">
        <div class="cust-name">${escHtml(cust.name)}${hasPaid ? ' <span title="Has paid jobs" style="color:var(--green);font-size:1.1em;vertical-align:middle;">💷</span>' : ''}</div>
        ${addr ? `<div class="cust-address">📍 ${escHtml(addr)}</div>` : ''}
        ${cust.phone ? `<div class="cust-phone">📞 ${escHtml(cust.phone)}</div>` : ''}
      </div>
      <div class="cust-actions">
        <button class="icon-action" onclick="viewHistory('${cust.id}')" title="History">📋</button>
        <button class="icon-action" onclick="addJobForCustomer('${cust.id}')" title="Add job">＋</button>
        <button class="icon-action" onclick="editCustomer('${cust.id}')" title="Edit">✏️</button>
        <button class="icon-action danger" onclick="deleteCustomer('${cust.id}')" title="Delete">🗑</button>
      </div>
    `;
    list.appendChild(card);
  });
}

// Async tab switcher for UI buttons
function setCustomersTabAsync(tab) {
  const list = document.getElementById('customers-list');
  if (list) list.innerHTML = '<div class="empty-state">Loading…</div>';
  setCustomersTab(tab);
}

// Set which customers tab is active, reload data, and re-render
async function setCustomersTab(tab) {
  customersTab = tab;
  await loadCustomers();
  await loadJobs();
  renderCustomers();
}

function filterCustomers(val) {
  renderCustomers(val);
}

// ── Job Modal ─────────────────────────────────────────────
function openAddJobModal(date) {
  if (customers.length === 0) {
    showToast('Add a customer first before creating a job', 'error');
    openCustomerModal();
    return;
  }

  document.getElementById('job-modal-title').textContent = 'Add Job';
  document.getElementById('job-edit-id').value = '';
  document.getElementById('job-customer').value = '';
  document.getElementById('job-date').value = date || todayISO();
  document.getElementById('job-time').value = '';
  document.getElementById('job-price').value = '';
  document.getElementById('job-pvc').checked = false;
  document.getElementById('pvc-label').textContent = 'No';
  document.getElementById('job-notes').value = '';
  document.getElementById('job-recurring').value = 'none';
  populateCustomerDropdown();
  document.getElementById('job-modal').classList.add('active');
}

function addJobForCustomer(custId) {
  openAddJobModal();
  setTimeout(() => {
    document.getElementById('job-customer').value = custId;
  }, 50);
}

function editJob(id, e) {
  e.stopPropagation();
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  populateCustomerDropdown(job.customer_id);
  document.getElementById('job-modal-title').textContent = 'Edit Job';
  document.getElementById('job-edit-id').value = job.id;
  document.getElementById('job-customer').value = job.customer_id || '';
  document.getElementById('job-date').value = job.scheduled_date;
  document.getElementById('job-time').value = job.scheduled_time ? job.scheduled_time.slice(0, 5) : '';
  document.getElementById('job-price').value = job.price || '';
  document.getElementById('job-pvc').checked = !!job.pvc_cleaning;
  document.getElementById('pvc-label').textContent = job.pvc_cleaning ? 'Yes' : 'No';
  document.getElementById('job-notes').value = job.notes || '';
  document.getElementById('job-recurring').value = job.recurring || 'none';
  document.getElementById('job-modal').classList.add('active');
}

function closeJobModal() {
  document.getElementById('job-modal').classList.remove('active');
}

function populateCustomerDropdown(selectedId) {
  const sel = document.getElementById('job-customer');
  sel.innerHTML = '<option value="">— Select customer —</option>';
  customers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name + (c.town ? ` · ${c.town}` : '');
    if (c.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function saveJob() {
  const editId = document.getElementById('job-edit-id').value;
  const custId = document.getElementById('job-customer').value;
  const date = document.getElementById('job-date').value;

  if (!custId) return showToast('Please select a customer', 'error');
  if (!date) return showToast('Please set a date', 'error');

  const payload = {
    customer_id: custId,
    scheduled_date: date,
    scheduled_time: document.getElementById('job-time').value || null,
    price: parseFloat(document.getElementById('job-price').value) || 0,
    pvc_cleaning: document.getElementById('job-pvc').checked,
    notes: document.getElementById('job-notes').value.trim() || null,
    recurring: document.getElementById('job-recurring').value,
  };

  if (editId) {
    const { error } = await db.from('cr_jobs').update(payload).eq('id', editId);
    if (error) return showToast('Update failed: ' + error.message, 'error');
    showToast('Job updated ✓', 'success');
  } else {
    const { error } = await db.from('cr_jobs').insert(payload);
    if (error) return showToast('Save failed: ' + error.message, 'error');
    showToast('Job added ✓', 'success');

    // Auto-create recurring future jobs (next 12 occurrences)
    if (payload.recurring !== 'none') {
      await createRecurringJobs(payload, 12);
    }
  }

  closeJobModal();
  await loadJobs();
  renderToday();
  renderSchedule();
}

async function createRecurringJobs(base, count) {
  const intervals = { weekly: 7, fortnightly: 14, monthly: null, bimonthly: null };
  const jobs2create = [];
  let d = new Date(base.scheduled_date + 'T00:00:00');

  for (let i = 0; i < count; i++) {
    if (base.recurring === 'weekly') d.setDate(d.getDate() + 7);
    else if (base.recurring === 'fortnightly') d.setDate(d.getDate() + 14);
    else if (base.recurring === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (base.recurring === 'bimonthly') d.setMonth(d.getMonth() + 2);

    jobs2create.push({ ...base, scheduled_date: isoDate(d), completed: false, sort_order: 0 });
  }

  await db.from('cr_jobs').insert(jobs2create);
}

async function deleteJob(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this job?')) return;
  const { error } = await db.from('cr_jobs').delete().eq('id', id);
  if (error) return showToast('Delete failed', 'error');
  jobs = jobs.filter(j => j.id !== id);
  renderToday();
  renderSchedule();
  showToast('Job deleted', '');
}

// ── Customer Modal ────────────────────────────────────────
function openCustomerModal() {
  document.getElementById('customer-modal-title').textContent = 'New Customer';
  document.getElementById('cust-edit-id').value = '';
  ['cust-name', 'cust-address', 'cust-town', 'cust-postcode', 'cust-phone', 'cust-email', 'cust-notes']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('customer-modal').classList.add('active');
}

function editCustomer(id) {
  const cust = customers.find(c => c.id === id);
  if (!cust) return;
  document.getElementById('customer-modal-title').textContent = 'Edit Customer';
  document.getElementById('cust-edit-id').value = cust.id;
  document.getElementById('cust-name').value = cust.name || '';
  document.getElementById('cust-address').value = cust.address || '';
  document.getElementById('cust-town').value = cust.town || '';
  document.getElementById('cust-postcode').value = cust.postcode || '';
  document.getElementById('cust-phone').value = cust.phone || '';
  document.getElementById('cust-email').value = cust.email || '';
  document.getElementById('cust-notes').value = cust.notes || '';
  document.getElementById('customer-modal').classList.add('active');
}

function closeCustomerModal() {
  document.getElementById('customer-modal').classList.remove('active');
}

async function saveCustomer() {
  const editId = document.getElementById('cust-edit-id').value;
  const name = document.getElementById('cust-name').value.trim();
  if (!name) return showToast('Name is required', 'error');

  const payload = {
    name,
    address: document.getElementById('cust-address').value.trim() || null,
    town: document.getElementById('cust-town').value.trim() || null,
    postcode: document.getElementById('cust-postcode').value.trim() || null,
    phone: document.getElementById('cust-phone').value.trim() || null,
    email: document.getElementById('cust-email').value.trim() || null,
    notes: document.getElementById('cust-notes').value.trim() || null,
  };

  if (editId) {
    const { error } = await db.from('cr_customers').update(payload).eq('id', editId);
    if (error) return showToast('Update failed: ' + error.message, 'error');
    showToast('Customer updated ✓', 'success');
  } else {
    const { error } = await db.from('cr_customers').insert(payload);
    if (error) return showToast('Save failed: ' + error.message, 'error');
    showToast('Customer added ✓', 'success');
  }

  closeCustomerModal();
  await loadCustomers();
  renderCustomers();
  populateCustomerDropdown();
}

async function deleteCustomer(id) {
  if (!confirm('Delete this customer and all their jobs?')) return;
  const { error } = await db.from('cr_customers').delete().eq('id', id);
  if (error) return showToast('Delete failed', 'error');
  customers = customers.filter(c => c.id !== id);
  jobs = jobs.filter(j => j.customer_id !== id);
  renderCustomers();
  renderToday();
  renderSchedule();
  showToast('Customer deleted', '');
}

// ── Customer History Modal ────────────────────────────────
function viewHistory(custId) {
  const cust = customers.find(c => c.id === custId);
  if (!cust) return;

  const custJobs = jobs.filter(j => j.customer_id === custId)
    .sort((a, b) => a.scheduled_date < b.scheduled_date ? 1 : -1);

  const totalJobs = custJobs.length;
  const doneJobs = custJobs.filter(j => j.completed).length;
  const totalValue = custJobs.filter(j => j.completed).reduce((s, j) => s + Number(j.price || 0), 0);

  const addr = [cust.address, cust.town, cust.postcode].filter(Boolean).join(', ');

  let html = `
    ${addr ? `<p style="color:var(--text-secondary);font-size:0.82rem;margin-bottom:1rem">📍 ${escHtml(addr)}</p>` : ''}
    <div class="history-stats">
      <div class="history-stat">
        <div class="history-stat-value">${totalJobs}</div>
        <div class="history-stat-label">Total Jobs</div>
      </div>
      <div class="history-stat">
        <div class="history-stat-value">${doneJobs}</div>
        <div class="history-stat-label">Completed</div>
      </div>
      <div class="history-stat">
        <div class="history-stat-value">£${totalValue.toFixed(0)}</div>
        <div class="history-stat-label">Earned</div>
      </div>
    </div>
    <div style="margin-top:0.5rem">
  `;

  if (custJobs.length === 0) {
    html += '<p style="color:var(--text-muted);text-align:center;padding:1rem">No jobs yet</p>';
  } else {
    custJobs.forEach(job => {
      const d = new Date(job.scheduled_date + 'T00:00:00');
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      html += `
        <div class="history-job-row">
          <span style="color:${job.completed ? 'var(--green)' : 'var(--text-secondary)'}">${job.completed ? '✓' : '○'}</span>
          <span style="flex:1;padding:0 0.75rem">${dateStr}${job.scheduled_time ? ' · ' + job.scheduled_time.slice(0,5) : ''}</span>
          ${job.pvc_cleaning ? '<span class="job-tag pvc" style="font-size:0.65rem;margin-right:0.5rem">PVC</span>' : ''}
          <span style="color:var(--cyan);font-family:'Barlow Condensed',sans-serif;font-weight:700">£${Number(job.price||0).toFixed(2)}</span>
          ${job.paid ? '<span title="Paid" style="margin-left:0.5rem;color:var(--green);font-size:1.1em">💷</span>' : ''}
        </div>
      `;
    });
  }

  html += '</div>';

  document.getElementById('history-title').textContent = cust.name;
  document.getElementById('history-body').innerHTML = html;
  document.getElementById('history-modal').classList.add('active');
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.remove('active');
}

// ── PVC toggle label ──────────────────────────────────────
function setupPvcToggle() {
  document.getElementById('job-pvc').addEventListener('change', function () {
    document.getElementById('pvc-label').textContent = this.checked ? 'Yes' : 'No';
  });
}

// ── Helpers ───────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function formatDay(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function capFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Toast ─────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Close modals on backdrop click only ──────────────────
function setupOverlayClose() {
  ['job-modal', 'customer-modal', 'history-modal'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('click', e => {
      // Only close if the click landed directly on the dark overlay, not inside the box
      if (e.target === el) el.classList.remove('active');
    });
  });
}

// Ensure inline handlers can always call these functions even in restrictive JS sandboxes
window.openAddJobModal = openAddJobModal;
window.openCustomerModal = openCustomerModal;
window.openHistoryModal = viewHistory;
window.closeJobModal = closeJobModal;
window.closeCustomerModal = closeCustomerModal;
window.closeHistoryModal = closeHistoryModal;
window.saveJob = saveJob;
window.saveCustomer = saveCustomer;
window.toggleRouteMode = toggleRouteMode;
window.setScheduleView = setScheduleView;
window.calNav = calNav;
window.filterCustomers = filterCustomers;
window.addJobForCustomer = addJobForCustomer;
window.editJob = editJob;
window.deleteJob = deleteJob;
window.editCustomer = editCustomer;
window.deleteCustomer = deleteCustomer;
window.viewHistory = viewHistory;
window.toggleComplete = toggleComplete;

async function togglePaid(id, e) {
  e.stopPropagation();
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  const newVal = !job.paid;
  // Update the database (column already exists, so this will work!)
  const { error } = await db.from('cr_jobs').update({ paid: newVal }).eq('id', id);
  if (error) return showToast('Update failed', 'error');
  
  job.paid = newVal;
  renderToday(); // Refresh the screen
  showToast(newVal ? 'Paid £' : 'Unpaid', 'success');
}
window.togglePaid = togglePaid;