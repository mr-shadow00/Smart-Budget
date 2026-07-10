// public/js/app.js
// Vanilla JS SPA — no build step needed, so it runs straight off the
// filesystem inside the Docker image.

(() => {
  'use strict';

  /* ============== tiny helpers ============== */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const CURRENCIES = [
    ['USD', 'US Dollar'], ['EUR', 'Euro'], ['GBP', 'British Pound'],
    ['JPY', 'Japanese Yen'], ['CAD', 'Canadian Dollar'], ['AUD', 'Australian Dollar'],
    ['INR', 'Indian Rupee'], ['BDT', 'Bangladeshi Taka'], ['CNY', 'Chinese Yuan'],
    ['CHF', 'Swiss Franc'], ['SEK', 'Swedish Krona'], ['NZD', 'New Zealand Dollar'],
    ['SGD', 'Singapore Dollar'], ['AED', 'UAE Dirham']
  ];
  const CURRENCY_SYMBOLS = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: '$', AUD: '$', INR: '₹',
    BDT: '৳', CNY: '¥', CHF: 'CHF', SEK: 'kr', NZD: '$', SGD: '$', AED: 'د.إ'
  };

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function monthKey(year, month) { return `${year}-${pad2(month + 1)}`; }
  function monthLabel(year, month) {
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
      .format(new Date(year, month, 1));
  }
  function fmtMoney(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount || 0);
    } catch (e) {
      return `${CURRENCY_SYMBOLS[currency] || currency} ${(amount || 0).toFixed(2)}`;
    }
  }
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ============== API wrapper ============== */
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || (data && data.error) || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ============== global state ============== */
  const state = {
    settings: { currency: 'USD', theme: 'dark', displayName: 'My Budget' },
    categories: [],
    activeTab: 'home',
    month: (() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; })(),
    allTime: false,
    typeFilter: '',
    search: '',
    editingCatId: null
  };

  /* ============== toast ============== */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ============== theme ============== */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  /* ============== screens ============== */
  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  /* ============== PIN pad (shared by setup + login) ============== */
  function buildPinPad(container, dotsEl, opts) {
    const { onSubmit, minLen = 4, maxLen = 8 } = opts;
    let buffer = '';

    function renderDots() {
      dotsEl.innerHTML = '';
      const count = Math.max(buffer.length, minLen);
      for (let i = 0; i < count; i++) {
        const d = document.createElement('div');
        d.className = 'pin-dot' + (i < buffer.length ? ' filled' : '');
        dotsEl.appendChild(d);
      }
    }

    function addDigit(d) {
      if (buffer.length >= maxLen) return;
      buffer += d;
      renderDots();
    }
    function backspace() {
      buffer = buffer.slice(0, -1);
      renderDots();
    }
    function reset() {
      buffer = '';
      renderDots();
    }
    function submit() {
      if (buffer.length < minLen) return;
      onSubmit(buffer);
    }

    container.innerHTML = '';
    const layout = ['1','2','3','4','5','6','7','8','9','clear','0','enter'];
    layout.forEach((key) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (key === 'clear') {
        btn.className = 'key-btn key-action';
        btn.textContent = 'Clear';
        btn.addEventListener('click', reset);
      } else if (key === 'enter') {
        btn.className = 'key-btn key-enter';
        btn.textContent = '✓';
        btn.addEventListener('click', submit);
      } else {
        btn.className = 'key-btn';
        btn.textContent = key;
        btn.addEventListener('click', () => addDigit(key));
      }
      container.appendChild(btn);
    });

    renderDots();
    return { reset, backspace, submit, getValue: () => buffer };
  }

  /* ============== setup screen ============== */
  let setupStage = 'create'; // 'create' | 'confirm'
  let firstPin = '';
  let setupPad = null;

  function initSetupScreen() {
    setupStage = 'create';
    firstPin = '';
    $('#setup-step-label').textContent = 'Choose a 4-8 digit PIN to lock this budget.';
    $('#setup-error').textContent = '';
    setupPad = buildPinPad($('#setup-keypad'), $('#setup-dots'), {
      onSubmit: handleSetupSubmit
    });
  }

  function handleSetupSubmit(value) {
    if (setupStage === 'create') {
      firstPin = value;
      setupStage = 'confirm';
      $('#setup-step-label').textContent = 'Enter the same PIN again to confirm.';
      $('#setup-error').textContent = '';
      setupPad.reset();
    } else {
      if (value !== firstPin) {
        $('#setup-error').textContent = "PINs didn't match — try again from the start.";
        setupStage = 'create';
        firstPin = '';
        $('#setup-step-label').textContent = 'Choose a 4-8 digit PIN to lock this budget.';
        setupPad.reset();
        return;
      }
      api('/auth/setup', { method: 'POST', body: { pin: value } })
        .then(() => bootApp())
        .catch((err) => {
          $('#setup-error').textContent = err.message || 'Could not set up PIN.';
          setupPad.reset();
        });
    }
  }

  /* ============== login screen ============== */
  function initLoginScreen() {
    $('#login-error').textContent = '';
    const input = $('#login-pin-input');
    input.value = '';

    function submitLogin() {
      const pin = input.value.trim();
      if (!pin) return;
      api('/auth/login', { method: 'POST', body: { pin } })
        .then(() => bootApp())
        .catch((err) => {
          $('#login-error').textContent = err.message || 'Incorrect PIN.';
          input.value = '';
          input.focus();
        });
    }

    $('#login-submit-btn').onclick = submitLogin;
    input.onkeydown = (e) => { if (e.key === 'Enter') submitLogin(); };
    input.focus();
  }

  /* ============== tabs ============== */
  function setActiveTab(tab) {
    state.activeTab = tab;
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.bn-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab-pane').forEach((p) => p.classList.remove('active'));
    $('#pane-' + tab).classList.add('active');
    $('#fab-add').classList.toggle('hidden', tab !== 'home');

    if (tab === 'home') loadHome();
    if (tab === 'charts') loadCharts();
    if (tab === 'categories') renderCategoryList();
    if (tab === 'settings') populateSettingsForm();
  }

  /* ============== home tab: hero + breakdown + ledger ============== */
  function findCategory(name, type) {
    return state.categories.find((c) => c.name === name && (!type || c.type === type))
      || state.categories.find((c) => c.name === name);
  }

  async function loadHome() {
    const month = state.allTime ? '' : monthKey(state.month.year, state.month.month);
    $('#month-label').textContent = state.allTime ? 'All time' : monthLabel(state.month.year, state.month.month);

    const [summary, txRes] = await Promise.all([
      api('/transactions/summary' + (month ? `?month=${month}` : '')),
      api('/transactions' + buildTxQuery(month))
    ]);

    renderHero(summary);
    renderTxList(txRes.transactions);
  }

  function buildTxQuery(month) {
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (state.typeFilter) params.set('type', state.typeFilter);
    if (state.search) params.set('q', state.search);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  function renderHero(summary) {
    const cur = state.settings.currency;
    $('#hero-balance').textContent = fmtMoney(summary.balance, cur);
    $('#hero-income').textContent = fmtMoney(summary.income, cur);
    $('#hero-expense').textContent = fmtMoney(summary.expense, cur);
    $('#hero-alltime').textContent = fmtMoney(summary.allTimeBalance, cur);
  }

  /* ============== charts tab: trend line + category donut + list ============== */
  function changeMonth(delta) {
    if (state.allTime) return;
    state.month.month += delta;
    if (state.month.month < 0) { state.month.month = 11; state.month.year -= 1; }
    if (state.month.month > 11) { state.month.month = 0; state.month.year += 1; }
    loadHome();
    if (state.activeTab === 'charts') loadCharts();
  }
  function toggleAllTime() {
    state.allTime = !state.allTime;
    loadHome();
    if (state.activeTab === 'charts') loadCharts();
  }

  function last12MonthKeys() {
    const out = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const y = d.getFullYear();
      const m = d.getMonth() - i;
      const real = new Date(y, m, 1);
      out.push({
        key: monthKey(real.getFullYear(), real.getMonth()),
        label: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(real)
      });
    }
    return out;
  }

  async function loadCharts() {
    const month = state.allTime ? '' : monthKey(state.month.year, state.month.month);
    const label = state.allTime ? 'All time' : monthLabel(state.month.year, state.month.month);
    $('#charts-month-label').textContent = label;
    $('#charts-income-month-label').textContent = label;
    $('#trend-range-label').textContent = 'Last 12 months';

    const [summary, allTx] = await Promise.all([
      api('/transactions/summary' + (month ? `?month=${month}` : '')),
      api('/transactions')
    ]);

    renderTrendChart(allTx.transactions);
    renderRingChart(summary.byCategory, { type: 'expense', wrapSelector: '#category-chart', emptySelector: '#category-chart-empty', centerSub: 'Spent' });
    renderRingChart(summary.byCategory, { type: 'income', wrapSelector: '#income-chart', emptySelector: '#income-chart-empty', centerSub: 'Received' });
    renderBreakdownList(summary.byCategory, 'expense', '#expense-breakdown-list', '#expense-breakdown-empty');
    renderBreakdownList(summary.byCategory, 'income', '#income-breakdown-list', '#income-breakdown-empty');
  }

  function roundedTopBarPath(x, yTop, width, yBase, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, yBase - yTop));
    if (yBase - yTop <= 0) return '';
    return `M${x},${yBase} L${x},${(yTop + r).toFixed(1)} Q${x},${yTop.toFixed(1)} ${(x + r).toFixed(1)},${yTop.toFixed(1)} L${(x + width - r).toFixed(1)},${yTop.toFixed(1)} Q${(x + width).toFixed(1)},${yTop.toFixed(1)} ${(x + width).toFixed(1)},${(yTop + r).toFixed(1)} L${(x + width).toFixed(1)},${yBase} Z`;
  }

  function renderTrendChart(transactions) {
    const buckets = last12MonthKeys();
    const map = {};
    buckets.forEach((b) => { map[b.key] = { income: 0, expense: 0 }; });
    transactions.forEach((t) => {
      const key = t.date.slice(0, 7);
      if (map[key]) map[key][t.type] += t.amount;
    });
    const points = buckets.map((b) => ({ label: b.label, income: map[b.key].income, expense: map[b.key].expense }));

    const w = 680, h = 260;
    const padL = 44, padRight = 16, padT = 16, padB = 30;
    const innerW = w - padL - padRight;
    const innerH = h - padT - padB;
    const baseY = padT + innerH;

    const maxVal = Math.max(1, ...points.map((p) => Math.max(p.income, p.expense)));
    const niceMax = maxVal <= 0 ? 1 : Math.ceil(maxVal / 5) * 5 || maxVal * 1.2;

    const n = points.length;
    const bandWidth = innerW / n;
    const groupPad = bandWidth * 0.26;
    const usable = bandWidth - groupPad;
    const barWidth = usable * 0.42;
    const barGapInner = usable * 0.16;
    const radius = Math.min(5, barWidth / 2);

    const yFor = (v) => baseY - (v / niceMax) * innerH;

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const y = padT + innerH - f * innerH;
      const val = f * niceMax;
      return `<line class="trend-grid-line" x1="${padL}" y1="${y}" x2="${w - padRight}" y2="${y}"/>
        <text class="trend-y-label" x="${padL - 8}" y="${y + 3}" text-anchor="end">${Math.round(val)}</text>`;
    }).join('');

    let bars = '';
    let labels = '';
    points.forEach((p, i) => {
      const bandStart = padL + i * bandWidth + groupPad / 2;
      const incomeX = bandStart;
      const expenseX = bandStart + barWidth + barGapInner;
      const groupCenter = bandStart + barWidth + barGapInner / 2;

      if (p.income > 0) {
        const top = Math.min(yFor(p.income), baseY - 2);
        bars += `<path class="trend-bar-income" d="${roundedTopBarPath(incomeX, top, barWidth, baseY, radius)}"><title>${p.label}: ${fmtMoney(p.income, state.settings.currency)}</title></path>`;
      }
      if (p.expense > 0) {
        const top = Math.min(yFor(p.expense), baseY - 2);
        bars += `<path class="trend-bar-expense" d="${roundedTopBarPath(expenseX, top, barWidth, baseY, radius)}"><title>${p.label}: ${fmtMoney(p.expense, state.settings.currency)}</title></path>`;
      }
      labels += `<text class="trend-x-label" x="${groupCenter}" y="${h - 8}" text-anchor="middle">${p.label}</text>`;
    });

    const svg = `
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
        ${gridLines}
        <line x1="${padL}" y1="${baseY}" x2="${w - padRight}" y2="${baseY}" class="trend-grid-line" />
        ${bars}
        ${labels}
      </svg>
    `;
    $('#trend-chart').innerHTML = svg;
  }

  function categoryEntries(byCategory, type) {
    type = type || 'expense';
    return Object.entries(byCategory || {})
      .map(([name, v]) => ({ name, amount: v[type] }))
      .filter((e) => e.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }

  function renderRingChart(byCategory, opts) {
    const { type, wrapSelector, emptySelector, centerSub } = opts;
    const allEntries = categoryEntries(byCategory, type);
    const wrapEl = $(wrapSelector);
    const emptyEl = $(emptySelector);

    if (!allEntries.length) {
      wrapEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    const total = allEntries.reduce((s, e) => s + e.amount, 0);
    const entries = allEntries.slice(0, 5);

    const strokeWidth = 15, ringGap = 7, baseInnerRadius = 32;
    const n = entries.length;
    const outerRadius = baseInnerRadius + (n - 1) * (strokeWidth + ringGap) + strokeWidth / 2;
    const size = Math.ceil((outerRadius + strokeWidth / 2 + 3) * 2);
    const cx = size / 2, cy = size / 2;

    let rings = '';
    entries.forEach((e, i) => {
      const cat = findCategory(e.name, type);
      const color = cat ? cat.color : '#a24b3f';
      // index 0 (largest) is the outermost ring
      const r = baseInnerRadius + (n - 1 - i) * (strokeWidth + ringGap) + strokeWidth / 2;
      const circumference = 2 * Math.PI * r;
      const frac = Math.max(0, Math.min(1, e.amount / total));
      const dash = frac * circumference;
      rings += `<circle class="ring-track" cx="${cx}" cy="${cy}" r="${r}" stroke-width="${strokeWidth}"/>`;
      rings += `<circle class="ring-arc" cx="${cx}" cy="${cy}" r="${r}" stroke="${color}" stroke-width="${strokeWidth}"
        stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})">
        <title>${escapeHtml(e.name)}: ${fmtMoney(e.amount, state.settings.currency)}</title>
      </circle>`;
    });

    const svg = `
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
        ${rings}
        <text class="donut-center-label" x="${cx}" y="${cy - 2}" text-anchor="middle">${fmtMoney(total, state.settings.currency)}</text>
        <text class="donut-center-sub" x="${cx}" y="${cy + 16}" text-anchor="middle">${centerSub}</text>
      </svg>
    `;
    wrapEl.innerHTML = svg;
  }

  function renderBreakdownList(byCategory, type, listSelector, emptySelector) {
    const entries = categoryEntries(byCategory, type);
    const listEl = $(listSelector);
    const emptyEl = $(emptySelector);
    listEl.innerHTML = '';

    if (!entries.length) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    const fallback = type === 'income' ? '#4f7a5c' : '#a24b3f';
    const max = entries[0].amount;
    entries.forEach((e) => {
      const cat = findCategory(e.name, type);
      const color = cat ? cat.color : fallback;
      const icon = cat ? cat.icon : '🏷️';
      const row = document.createElement('div');
      row.className = 'breakdown-item';
      row.innerHTML = `
        <span>${icon}</span>
        <span>${escapeHtml(e.name)}</span>
        <span class="breakdown-amount">${fmtMoney(e.amount, state.settings.currency)}</span>
        <div class="breakdown-bar-track"><div class="breakdown-bar-fill" style="width:${(e.amount / max) * 100}%;background:${color}"></div></div>
      `;
      listEl.appendChild(row);
    });
  }

  function groupDateLabel(dateStr) {
    const today = todayStr();
    const yest = (() => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    })();
    if (dateStr === today) return 'Today';
    if (dateStr === yest) return 'Yesterday';
    const [y, m, day] = dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      .format(new Date(y, m - 1, day));
  }

  let lastRenderedIds = new Set();
  function renderTxList(transactions) {
    const listEl = $('#tx-list');
    const emptyEl = $('#tx-empty');
    listEl.innerHTML = '';

    if (!transactions.length) {
      emptyEl.classList.add('show');
      lastRenderedIds = new Set();
      return;
    }
    emptyEl.classList.remove('show');

    const groups = [];
    let currentGroup = null;
    for (const t of transactions) {
      if (!currentGroup || currentGroup.date !== t.date) {
        currentGroup = { date: t.date, items: [] };
        groups.push(currentGroup);
      }
      currentGroup.items.push(t);
    }

    const newIds = new Set();
    groups.forEach((g) => {
      const groupEl = document.createElement('div');
      const header = document.createElement('div');
      header.className = 'tx-group-date';
      header.textContent = groupDateLabel(g.date);
      groupEl.appendChild(header);

      g.items.forEach((t) => {
        newIds.add(t.id);
        const cat = findCategory(t.category, t.type);
        const icon = cat ? cat.icon : (t.type === 'income' ? '💰' : '🧾');
        const color = cat ? cat.color : (t.type === 'income' ? '#4f7a5c' : '#a24b3f');
        const row = document.createElement('div');
        row.className = 'tx-row';
        if (!lastRenderedIds.has(t.id) && lastRenderedIds.size > 0) {
          row.classList.add('flash-in');
          if (t.type === 'expense') row.classList.add('expense');
        }
        row.innerHTML = `
          <div class="tx-icon" style="background:${color}22">${icon}</div>
          <div class="tx-main">
            <div class="tx-desc">${escapeHtml(t.description || t.category || 'Untitled')}</div>
            <div class="tx-cat">${escapeHtml(t.category || '')}</div>
          </div>
          <div class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '−'}${fmtMoney(t.amount, state.settings.currency).replace(/^-/, '')}</div>
          <button class="tx-delete-btn" aria-label="Delete entry" title="Delete entry">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0v13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7h10Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        `;
        row.querySelector('.tx-delete-btn').addEventListener('click', () => deleteTxById(t.id));
        groupEl.appendChild(row);
      });

      listEl.appendChild(groupEl);
    });

    lastRenderedIds = newIds;
  }

  /* ============== categories tab ============== */
  function renderCategoryList() {
    const listEl = $('#category-list');
    listEl.innerHTML = '';

    ['expense', 'income'].forEach((type) => {
      const items = state.categories.filter((c) => c.type === type);
      if (!items.length) return;
      const header = document.createElement('div');
      header.className = 'section-title';
      header.style.marginTop = '14px';
      header.textContent = type === 'expense' ? 'Expense categories' : 'Income categories';
      listEl.appendChild(header);

      items.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'category-item';
        row.innerHTML = `
          <div class="cat-swatch" style="background:${c.color}22">${c.icon}</div>
          <div class="cat-name">${escapeHtml(c.name)}</div>
          <div class="cat-type-tag">${c.type}</div>
        `;
        row.addEventListener('click', () => openCatModal(c));
        listEl.appendChild(row);
      });
    });
  }

  /* ============== settings tab ============== */
  function populateSettingsForm() {
    const sel = $('#setting-currency');
    if (!sel.options.length) {
      CURRENCIES.forEach(([code, name]) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = `${code} — ${name}`;
        sel.appendChild(opt);
      });
    }
    sel.value = state.settings.currency;
    $('#setting-display-name').value = state.settings.displayName;
  }

  /* ============== transaction modal (add-only — editing/deleting past entries happens inline in the ledger) ============== */
  function openTxModal() {
    $('#tx-modal-title').textContent = 'New entry';
    $('#tx-modal-error').textContent = '';

    setTxType('expense');

    $('#tx-amount').value = '';
    $('#tx-description').value = '';
    $('#tx-date').value = todayStr();
    $('#tx-note').value = '';
    renderTxCategoryChips('expense', null);

    $('#tx-currency-symbol').textContent = CURRENCY_SYMBOLS[state.settings.currency] || state.settings.currency;
    $('#tx-modal-backdrop').classList.add('open');
  }
  function closeTxModal() { $('#tx-modal-backdrop').classList.remove('open'); }

  let selectedTxCategory = null;
  function renderTxCategoryChips(type, selected) {
    const wrap = $('#tx-category-chips');
    wrap.innerHTML = '';
    const items = state.categories.filter((c) => c.type === type);
    selectedTxCategory = selected && items.some((c) => c.name === selected) ? selected : (items[0] ? items[0].name : null);

    items.forEach((c) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (c.name === selectedTxCategory ? ' active' : '');
      chip.textContent = `${c.icon} ${c.name}`;
      chip.addEventListener('click', () => {
        selectedTxCategory = c.name;
        $$('#tx-category-chips .chip').forEach((el) => el.classList.remove('active'));
        chip.classList.add('active');
      });
      wrap.appendChild(chip);
    });
  }

  function setTxType(type) {
    $$('#tx-type-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
    renderTxCategoryChips(type, selectedTxCategory);
  }

  async function saveTx() {
    const amount = parseFloat($('#tx-amount').value);
    const type = $('#tx-type-seg .seg-btn.active').dataset.type;
    const body = {
      type,
      amount,
      description: $('#tx-description').value.trim(),
      category: selectedTxCategory || '',
      date: $('#tx-date').value,
      note: $('#tx-note').value.trim()
    };
    if (!amount || amount <= 0) {
      $('#tx-modal-error').textContent = 'Enter an amount greater than zero.';
      return;
    }
    if (!body.date) {
      $('#tx-modal-error').textContent = 'Pick a date.';
      return;
    }
    try {
      await api('/transactions', { method: 'POST', body });
      closeTxModal();
      toast('Entry saved');
      loadHome();
    } catch (err) {
      $('#tx-modal-error').textContent = err.message || 'Could not save entry.';
    }
  }

  // Ledger entries can only be deleted, not edited — keeps the history honest.
  async function deleteTxById(id) {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    try {
      await api(`/transactions/${id}`, { method: 'DELETE' });
      toast('Entry deleted');
      loadHome();
    } catch (err) {
      toast(err.message || 'Could not delete entry.');
    }
  }

  /* ============== category modal ============== */
  function openCatModal(cat) {
    state.editingCatId = cat ? cat.id : null;
    $('#cat-modal-title').textContent = cat ? 'Edit category' : 'New category';
    $('#cat-modal-error').textContent = '';
    $('#cat-delete-btn').hidden = !cat;

    $$('#cat-type-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === (cat ? cat.type : 'expense')));
    $('#cat-name').value = cat ? cat.name : '';
    $('#cat-icon').value = cat ? cat.icon : '';
    $('#cat-color').value = cat ? cat.color : '#d98e4a';

    $('#cat-modal-backdrop').classList.add('open');
  }
  function closeCatModal() { $('#cat-modal-backdrop').classList.remove('open'); }

  async function saveCat() {
    const body = {
      name: $('#cat-name').value.trim(),
      type: $('#cat-type-seg .seg-btn.active').dataset.type,
      icon: $('#cat-icon').value.trim() || '🏷️',
      color: $('#cat-color').value
    };
    if (!body.name) {
      $('#cat-modal-error').textContent = 'Give the category a name.';
      return;
    }
    try {
      if (state.editingCatId) {
        await api(`/categories/${state.editingCatId}`, { method: 'PUT', body });
      } else {
        await api('/categories', { method: 'POST', body });
      }
      closeCatModal();
      toast('Category saved');
      await refreshCategories();
      renderCategoryList();
    } catch (err) {
      $('#cat-modal-error').textContent = err.message || 'Could not save category.';
    }
  }

  async function deleteCat() {
    if (!state.editingCatId) return;
    if (!confirm('Delete this category? Past entries will keep their text but lose their icon/color.')) return;
    try {
      await api(`/categories/${state.editingCatId}`, { method: 'DELETE' });
      closeCatModal();
      toast('Category deleted');
      await refreshCategories();
      renderCategoryList();
    } catch (err) {
      $('#cat-modal-error').textContent = err.message || 'Could not delete category.';
    }
  }

  async function refreshCategories() {
    const res = await api('/categories');
    state.categories = res.categories;
  }

  /* ============== change PIN modal ============== */
  function openPinModal() {
    $('#pin-current').value = '';
    $('#pin-new').value = '';
    $('#pin-confirm').value = '';
    $('#pin-modal-error').textContent = '';
    $('#pin-modal-backdrop').classList.add('open');
  }
  function closePinModal() { $('#pin-modal-backdrop').classList.remove('open'); }

  async function savePinChange() {
    const currentPin = $('#pin-current').value;
    const newPin = $('#pin-new').value;
    const confirmPin = $('#pin-confirm').value;
    if (newPin !== confirmPin) {
      $('#pin-modal-error').textContent = "New PINs don't match.";
      return;
    }
    try {
      await api('/auth/change-pin', { method: 'POST', body: { currentPin, newPin } });
      closePinModal();
      toast('PIN updated');
    } catch (err) {
      $('#pin-modal-error').textContent = err.message || 'Could not update PIN.';
    }
  }

  /* ============== backup ============== */
  function exportBackup() {
    window.location.href = '/api/backup/export';
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(reader.result);
        await api('/backup/import', { method: 'POST', body: json });
        toast('Backup restored');
        await refreshCategories();
        loadHome();
      } catch (err) {
        toast(err.message || 'Could not restore backup');
      }
    };
    reader.readAsText(file);
  }

  /* ============== wire up static events ============== */
  function wireEvents() {
    $$('.tab-btn, .bn-btn').forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });

    $('#theme-toggle').addEventListener('click', () => {
      const next = state.settings.theme === 'light' ? 'dark' : 'light';
      state.settings.theme = next;
      applyTheme(next);
      api('/settings', { method: 'PUT', body: { theme: next } }).catch(() => {});
    });

    $('#month-prev').addEventListener('click', () => changeMonth(-1));
    $('#month-next').addEventListener('click', () => changeMonth(1));
    $('#month-label').addEventListener('click', toggleAllTime);

    $('#charts-month-prev').addEventListener('click', () => changeMonth(-1));
    $('#charts-month-next').addEventListener('click', () => changeMonth(1));
    $('#charts-month-label').addEventListener('click', toggleAllTime);

    $('#charts-income-month-prev').addEventListener('click', () => changeMonth(-1));
    $('#charts-income-month-next').addEventListener('click', () => changeMonth(1));
    $('#charts-income-month-label').addEventListener('click', toggleAllTime);

    $('#charts-cta-btn').addEventListener('click', () => setActiveTab('charts'));

    $('#type-filter').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      $$('#type-filter .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.typeFilter = btn.dataset.type;
      loadHome();
    });

    let searchDebounce = null;
    $('#search-input').addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.search = e.target.value.trim();
        loadHome();
      }, 250);
    });

    // tx modal
    $('#fab-add').addEventListener('click', () => openTxModal());
    $('#tx-modal-close').addEventListener('click', closeTxModal);
    $('#tx-modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'tx-modal-backdrop') closeTxModal(); });
    $('#tx-type-seg').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      setTxType(btn.dataset.type);
    });
    $('#tx-save-btn').addEventListener('click', saveTx);

    // category modal
    $('#cat-type-seg').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      $$('#cat-type-seg .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
    $('#add-category-btn').addEventListener('click', () => openCatModal(null));
    $('#cat-modal-close').addEventListener('click', closeCatModal);
    $('#cat-modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'cat-modal-backdrop') closeCatModal(); });
    $('#cat-save-btn').addEventListener('click', saveCat);
    $('#cat-delete-btn').addEventListener('click', deleteCat);

    // settings
    $('#save-settings-btn').addEventListener('click', async () => {
      const currency = $('#setting-currency').value;
      const displayName = $('#setting-display-name').value.trim() || 'My Budget';
      try {
        const res = await api('/settings', { method: 'PUT', body: { currency, displayName } });
        state.settings = res.settings;
        $('#app-display-name').textContent = state.settings.displayName;
        toast('Settings saved');
        loadHome();
      } catch (err) {
        toast(err.message || 'Could not save settings');
      }
    });
    $('#change-pin-btn').addEventListener('click', openPinModal);
    $('#pin-modal-close').addEventListener('click', closePinModal);
    $('#pin-modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'pin-modal-backdrop') closePinModal(); });
    $('#pin-save-btn').addEventListener('click', savePinChange);

    $('#export-btn').addEventListener('click', exportBackup);
    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importBackup(file);
      e.target.value = '';
    });

    $('#logout-btn').addEventListener('click', async () => {
      if (!confirm('Log out of this device?')) return;
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      location.reload();
    });
  }

  /* ============== boot ============== */
  async function bootApp() {
    const [settingsRes, catRes] = await Promise.all([api('/settings'), api('/categories')]);
    state.settings = settingsRes.settings;
    state.categories = catRes.categories;

    applyTheme(state.settings.theme);
    $('#app-display-name').textContent = state.settings.displayName;

    showScreen('#screen-app');
    setActiveTab('home');
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  async function init() {
    wireEvents();
    registerServiceWorker();
    try {
      const status = await api('/auth/status');
      if (!status.initialized) {
        showScreen('#screen-setup');
        initSetupScreen();
      } else if (!status.authenticated) {
        $('#login-title').textContent = `Unlock ${status.displayName || 'your budget'}`;
        showScreen('#screen-login');
        initLoginScreen();
      } else {
        await bootApp();
      }
    } catch (err) {
      toast('Could not reach the server. Is it running?');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
