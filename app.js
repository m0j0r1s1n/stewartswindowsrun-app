/* =========================================
   CLEARRUN – APP.JS
   Supabase-backed window cleaning run manager
   ========================================= */

// ── Supabase config ────────────────────────────────────────
const SUPABASE_URL = 'https://avmdholmwuuxaiqttnqd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2bWRob2xtd3V1eGFpcXR0bnFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTUyMDcsImV4cCI6MjA5MDU3MTIwN30.e5ns46NF1ERR5H1Z6y_m65KTqfy7rp7Jzy7KCH5Zseg';

let db = null;

// ── State ─────────────────────────────────────────────────
let customers = [];
let jobs = [];
let scheduleView = 'week';
let scheduleOffset = 0;
let routeMode = false;
let customersTab = 'all';

// ── Startup ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  setupTabs();
  setupPvcToggle();
  setTodayLabel();
  setupOverlayClose();
  await bootstrap();
});

async function bootstrap() {
  await ensureTables();
  // Load both to ensure filters work immediately
  await Promise.all([loadCustomers(), loadJobs()]);
  renderToday();
  renderSchedule();
  renderCustomers();
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

async function refreshCustomersAndJobs() {
  const list = document.getElementById('customers-list');
  if (list) list.innerHTML = '<div class="empty-state">Refreshing…</div>';
  await Promise.all([loadCustomers(), loadJobs()]);
  renderToday();
  renderSchedule();
  renderCustomers();
  showToast('Data refreshed', 'success');
}

// ── Tabs ──────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      document.getElementById('tab-' + target).classList.add('active');
      
      if (target === 'today') renderToday();
      if (target === 'schedule') renderSchedule();
      if (target === 'customers') renderCustomers();
    });
  });
}

// ── Render Today ──────────────────────────────────────────
function renderToday() {
  const today = todayISO();
  const todayJobs = jobs.filter(j => j.scheduled_date === today)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const list = document.getElementById('jobs-list');
  const empty = document.getElementById('jobs-empty');

  if (!list) return;
  list.innerHTML = '';
  
  if (todayJobs.length === 0) {
    if (empty) {
      list.appendChild(empty);
      empty.style.display = '';
    }
    updateStats([], 0, 0);
    return;
  }
  if (empty) empty.style.display = 'none';

  todayJobs.forEach(job => list.appendChild(buildJobCard(job)));
  if (routeMode) enableDragDrop();

  const total = todayJobs.reduce((s, j) => s + Number(j.price || 0), 0);
  const done = todayJobs.filter(j => j.completed).length;
  updateStats(todayJobs, done, total);
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
        <button class="icon-action ${job.paid ? 'paid-active' : ''}" onclick="togglePaid('${job.id}', event)" title="${job.paid ? 'Mark unpaid' : 'Mark paid'}">${job.paid ? '💷' : '💸'}</button>
      </div>
    </div>
  `;
  return card;
}

// ── Core Job Actions ───────────────────────────────────────────
async function togglePaid(id, e) {
  if (e) e.stopPropagation();
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  const newVal = !job.paid;
  const { error } = await db.from('cr_jobs').update({ paid: newVal }).eq('id', id);
  if (error) return showToast('Update failed', 'error');
  
  job.paid = newVal;
  renderToday();
  renderSchedule();
  renderCustomers();
  showToast(newVal ? 'Marked as paid 💷' : 'Marked unpaid', 'success');
}

async function toggleComplete(id, e) {
  if (e) e.stopPropagation();
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  const newVal = !job.completed;
  const { error } = await db.from('cr_jobs').update({ completed: newVal }).eq('id', id);
  if (error) return showToast('Update failed', 'error');
  
  job.completed = newVal;
  renderToday();
  renderSchedule();
  showToast(newVal ? 'Job marked complete ✓' : 'Marked incomplete', 'success');
}

// ── Schedule ──────────────────────────────────────────────
function renderSchedule() {
  const grid = document.getElementById('schedule-grid');
  const label = document.getElementById('cal-label');
  const today = todayISO();
  if (!grid) return;

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
    const dayJobs = jobs.filter(j => j.scheduled_date === dateStr);
    const isToday = dateStr === today;
    const d = new Date(dateStr + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const total = dayJobs.reduce((s, j) => s + Number(j.price || 0), 0);

    const block = document.createElement('div');
    block.className = 'schedule-day';
    block.innerHTML = `
      <div class="schedule-day-header ${isToday ? ' today-header' : ''}">
        <span class="schedule-day-name">${isToday ? '★ ' : ''}${dayName}</span>
        <span class="schedule-day-badge">${dayJobs.length} jobs · £${total.toFixed(2)}</span>
      </div>
      <div class="schedule-jobs"></div>
    `;

    const jobsDiv = block.querySelector('.schedule-jobs');
    if (dayJobs.length === 0) {
      jobsDiv.innerHTML = '<div class="schedule-empty">No jobs</div>';
    } else {
      dayJobs.forEach(job => {
        const cust = job.cr_customers || {};
        const row = document.createElement('div');
        row.className = 'schedule-job-row' + (job.completed ? ' completed' : '');
        row.innerHTML = `<span class="sj-name">${escHtml(cust.name || '—')}</span><span class="sj-price">£${Number(job.price).toFixed(2)}</span>`;
        row.onclick = () => editJob(job.id, { stopPropagation: () => {} });
        jobsDiv.appendChild(row);
      });
    }
    grid.appendChild(block);
  });
}

// ── Customers ─────────────────────────────────────────────
async function setCustomersTab(tab) {
  customersTab = tab;
  const list = document.getElementById('customers-list');
  if (list) list.innerHTML = '<div class="empty-state">Loading...</div>';
  
  await Promise.all([loadCustomers(), loadJobs()]);
  renderCustomers();
}

function renderCustomers(filter = '') {
  const list = document.getElementById('customers-list');
  const empty = document.getElementById('customers-empty');
  if (!list) return;

  let filtered = filter ? customers.filter(c => 
    c.name.toLowerCase().includes(filter.toLowerCase()) ||
    (c.address || '').toLowerCase().includes(filter.toLowerCase())
  ) : customers;

  if (customersTab === 'paid') {
    filtered = filtered.filter(cust => jobs.some(j => j.customer_id === cust.id && j.paid));
  } else if (customersTab === 'unpaid') {
    filtered = filtered.filter(cust => !jobs.some(j => j.customer_id === cust.id && j.paid));
  }

  list.innerHTML = '';
  if (filtered.length === 0) {
    if (empty) {
      empty.style.display = '';
      list.appendChild(empty);
    }
    return;
  }
  if (empty) empty.style.display = 'none';

  filtered.forEach(cust => {
    const initials = cust.name ? cust.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '??';
    const custJobs = jobs.filter(j => j.customer_id === cust.id);
    const jobList = custJobs.length > 0
      ? `<ul class="cust-job-list" style="margin:0.5rem 0 0 0.2rem;padding:0;list-style:none;">
          ${custJobs.map(j => `
            <li style="font-size:0.92em;margin-bottom:0.1rem;display:flex;align-items:center;gap:0.5em;">
              <span title="${j.paid ? 'Paid' : 'Unpaid'}" style="font-size:1.1em;vertical-align:middle;${j.paid ? 'color:var(--green);' : 'color:var(--text-secondary);'}">${j.paid ? '💷' : '💸'}</span>
              <span>${escHtml(j.scheduled_date || '')}${j.scheduled_time ? ' ' + escHtml(j.scheduled_time.slice(0,5)) : ''}</span>
              <span style="color:var(--cyan);font-family:'Barlow Condensed',sans-serif;font-weight:700;">£${Number(j.price||0).toFixed(2)}</span>
              <button class="icon-action" style="margin-left:0.5em;" onclick="togglePaidFromCustomerList('${j.id}')" title="${j.paid ? 'Mark Unpaid' : 'Mark Paid'}">${j.paid ? '❌' : '💷'}</button>
            </li>
          `).join('')}
        </ul>`
      : '<div style="color:var(--text-muted);font-size:0.9em;margin-top:0.4rem;">No jobs</div>';
    const card = document.createElement('div');
    card.className = 'customer-card';
    card.innerHTML = `
      <div class="cust-avatar">${initials}</div>
      <div class="cust-info">
        <div class="cust-name">${escHtml(cust.name)}</div>
        <div class="cust-address">📍 ${escHtml(cust.address || 'No address')}</div>
        ${jobList}
      </div>
      <div class="cust-actions">
        <button class="icon-action" onclick="viewHistory('${cust.id}')">📋</button>
        <button class="icon-action" onclick="addJobForCustomer('${cust.id}')">＋</button>
        <button class="icon-action" onclick="editCustomer('${cust.id}')">✏️</button>
        <button class="icon-action danger" onclick="deleteCustomer('${cust.id}')">🗑</button>
      </div>
    `;
    list.appendChild(card);
  });
// Toggle paid status for a job from the customer card job list
async function togglePaidFromCustomerList(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;
  const newVal = !job.paid;
  const { error } = await db.from('cr_jobs').update({ paid: newVal }).eq('id', jobId);
  if (error) return showToast('Update failed', 'error');
  job.paid = newVal;
  await Promise.all([loadCustomers(), loadJobs()]);
  renderCustomers();
  showToast(newVal ? 'Marked as paid 💷' : 'Marked unpaid', newVal ? 'success' : '');
}

  // Update button visual states
  ['all','paid','unpaid'].forEach(tab => {
    const btn = document.getElementById(tab+'-customers-tab');
    if (btn) btn.classList.toggle('active', customersTab === tab);
  });
}

// ── Modals & Form Handlers ─────────────────────────────────────────
function openAddJobModal(date) {
  if (customers.length === 0) {
    showToast('Add a customer first', 'error');
    openCustomerModal();
    return;
  }
  document.getElementById('job-modal-title').textContent = 'Add Job';
  document.getElementById('job-edit-id').value = '';
  document.getElementById('job-customer').value = '';
  document.getElementById('job-date').value = date || todayISO();
  document.getElementById('job-price').value = '';
  document.getElementById('job-pvc').checked = false;
  document.getElementById('pvc-label').textContent = 'No';
  populateCustomerDropdown();
  document.getElementById('job-modal').classList.add('active');
}

function addJobForCustomer(custId) {
  openAddJobModal();
  setTimeout(() => { document.getElementById('job-customer').value = custId; }, 50);
}

function editJob(id, e) {
  if (e) e.stopPropagation();
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
  document.getElementById('job-modal').classList.add('active');
}

function closeJobModal() { document.getElementById('job-modal').classList.remove('active'); }

function populateCustomerDropdown(selectedId) {
  const sel = document.getElementById('job-customer');
  sel.innerHTML = '<option value="">— Select customer —</option>';
  customers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    if (c.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function saveJob() {
  const editId = document.getElementById('job-edit-id').value;
  const payload = {
    customer_id: document.getElementById('job-customer').value,
    scheduled_date: document.getElementById('job-date').value,
    scheduled_time: document.getElementById('job-time').value || null,
    price: parseFloat(document.getElementById('job-price').value) || 0,
    pvc_cleaning: document.getElementById('job-pvc').checked,
    notes: document.getElementById('job-notes').value.trim() || null,
    recurring: document.getElementById('job-recurring').value,
  };

  if (editId) {
    await db.from('cr_jobs').update(payload).eq('id', editId);
  } else {
    await db.from('cr_jobs').insert(payload);
  }
  closeJobModal();
  await loadJobs();
  renderToday();
  renderSchedule();
  showToast('Job Saved', 'success');
}

async function deleteJob(id, e) {
  if (e) e.stopPropagation();
  if (!confirm('Delete this job?')) return;
  await db.from('cr_jobs').delete().eq('id', id);
  jobs = jobs.filter(j => j.id !== id);
  renderToday();
  renderSchedule();
  showToast('Job Deleted');
}

// ── Customer Modals ────────────────────────────────────────
function openCustomerModal() {
  document.getElementById('customer-modal-title').textContent = 'New Customer';
  document.getElementById('cust-edit-id').value = '';
  ['cust-name', 'cust-address', 'cust-town', 'cust-phone'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('customer-modal').classList.add('active');
}

function editCustomer(id) {
  const cust = customers.find(c => c.id === id);
  if (!cust) return;
  document.getElementById('customer-modal-title').textContent = 'Edit Customer';
  document.getElementById('cust-edit-id').value = cust.id;
  document.getElementById('cust-name').value = cust.name;
  document.getElementById('cust-address').value = cust.address || '';
  document.getElementById('cust-town').value = cust.town || '';
  document.getElementById('cust-phone').value = cust.phone || '';
  document.getElementById('customer-modal').classList.add('active');
}

async function saveCustomer() {
  const editId = document.getElementById('cust-edit-id').value;
  const payload = {
    name: document.getElementById('cust-name').value,
    address: document.getElementById('cust-address').value,
    town: document.getElementById('cust-town').value,
    phone: document.getElementById('cust-phone').value,
  };
  if (editId) await db.from('cr_customers').update(payload).eq('id', editId);
  else await db.from('cr_customers').insert(payload);
  
  document.getElementById('customer-modal').classList.remove('active');
  await loadCustomers();
  renderCustomers();
}

async function deleteCustomer(id) {
  if (!confirm('Delete customer and all history?')) return;
  await db.from('cr_customers').delete().eq('id', id);
  await bootstrap();
}

function viewHistory(custId) {
  const cust = customers.find(c => c.id === custId);
  if (!cust) return;
  const custJobs = jobs.filter(j => j.customer_id === custId).sort((a,b) => b.scheduled_date.localeCompare(a.scheduled_date));
  
  let html = `<div style="padding:1rem"><h3>${cust.name} History</h3>`;
  custJobs.forEach(j => {
    html += `<div class="history-job-row">
      <span>${j.scheduled_date}</span>
      <span>£${Number(j.price).toFixed(2)}</span>
      <span>${j.completed ? '✓' : '○'}</span>
      ${j.paid ? '<span>💷</span>' : ''}
    </div>`;
  });
  html += `</div>`;
  document.getElementById('history-body').innerHTML = html;
  document.getElementById('history-modal').classList.add('active');
}

// ── Helpers ───────────────────────────────────────────────
function escHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function formatDay(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function capFirst(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function setTodayLabel() { document.getElementById('today-date-label').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); }

function updateStats(jobArr, done, total) {
  document.getElementById('stat-total').textContent = jobArr.length;
  document.getElementById('stat-done').textContent = done;
  document.getElementById('stat-value').textContent = total.toFixed(2);
  const pBar = document.getElementById('progress-bar');
  if (pBar) pBar.style.width = (jobArr.length > 0 ? (done / jobArr.length) * 100 : 0) + '%';
}

async function ensureTables() {
  const { error } = await db.from('cr_customers').select('id').limit(1);
  if (error && error.code === '42P01') showToast('Run SQL setup in Supabase!', 'error');
}

let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function setupPvcToggle() {
  const el = document.getElementById('job-pvc');
  if (el) el.addEventListener('change', function() { document.getElementById('pvc-label').textContent = this.checked ? 'Yes' : 'No'; });
}

function setupOverlayClose() {
  ['job-modal', 'customer-modal', 'history-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', e => { if (e.target === el) el.classList.remove('active'); });
  });
}

// Global Exports
window.togglePaid = togglePaid;
window.toggleComplete = toggleComplete;
window.setCustomersTab = setCustomersTab;
window.openAddJobModal = openAddJobModal;
window.openCustomerModal = openCustomerModal;
window.saveJob = saveJob;
window.saveCustomer = saveCustomer;
window.closeJobModal = closeJobModal;
window.closeCustomerModal = () => document.getElementById('customer-modal').classList.remove('active');
window.closeHistoryModal = () => document.getElementById('history-modal').classList.remove('active');
window.editJob = editJob;
window.deleteJob = deleteJob;
window.editCustomer = editCustomer;
window.deleteCustomer = deleteCustomer;
window.viewHistory = viewHistory;
window.addJobForCustomer = addJobForCustomer;
window.setScheduleView = (v, el) => { scheduleView = v; renderSchedule(); };
window.calNav = (dir) => { scheduleOffset += dir; renderSchedule(); };
window.filterCustomers = (val) => renderCustomers(val);
window.refreshCustomersAndJobs = refreshCustomersAndJobs;