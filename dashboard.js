// ══════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════
const SHEET_ID   = '1SF4HkZyqPIhLbSRMrMo7HcsAptvtgF8oItdnNLFymR0';
const SHEET_NAME = 'Estado de Resultados USD';
const INTERVAL   = 30;

const csvURL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

const COLORS = { blue:'#378ADD', green:'#1D9E75', purple:'#534AB7', red:'#D85A30' };

// Filas del Estado de Resultados (P&L), en orden de presentación
const PL_ROWS = [
  { label: 'Ingresos por ventas',      key: 'Total Ingresos por Ventas', type: 'normal' },
  { label: 'Costo de ventas',          key: 'Total Costo de Ventas',     type: 'sub', sign: -1 },
  { label: 'Resultado bruto',          key: 'Resultado Bruto',           type: 'sub' },
  { label: 'Gastos',                   key: 'Total Gastos',              type: 'normal', sign: -1 },
  { label: 'Otros ingresos y egresos', key: 'Otros Ingresos y Egresos',  type: 'normal' },
  { label: 'EBITDA',                   key: 'EBITDA',                    type: 'sub' },
  { label: 'Resultados financieros',   key: 'Resultados Financieros',    type: 'normal' },
  { label: 'Resultado neto',           key: 'Resultado Neto',            type: 'sub' },
  { label: 'Impuesto a las ganancias', key: 'Impuesto a las Ganancias',  type: 'normal', sign: -1 },
  { label: 'Resultado después de impuestos', key: 'Resultado Despues de Impuestos', type: 'total' },
];

// Filas del Estado Financiero (posición patrimonial)
const FIN_ROWS = [
  { label: 'Total caja',           key: 'TOTAL',                   type: 'sub' },
  { label: 'Créditos por ventas',  key: 'Creditos por Ventas',      type: 'normal' },
  { label: 'Otros créditos',       key: 'Otros Creditos',           type: 'normal' },
  { label: 'Bienes de uso',        key: 'Bienes de Uso',            type: 'normal' },
  { label: 'Deudas comerciales',   key: 'Deudas Comerciales',       type: 'normal', sign: -1 },
  { label: 'Deudas sociales',      key: 'Deudas Sociales',          type: 'normal', sign: -1 },
  { label: 'Deudas fiscales',      key: 'Deudas Fiscales',          type: 'normal', sign: -1 },
  { label: 'Total caja + patrimonio', key: 'Total Caja + Patrimonio', type: 'total' },
];

// Gastos: detalle para gráfico de composición (directos / indirectos)
const GASTOS_DIRECTOS_KEY   = 'Total Gastos Directos';
const GASTOS_INDIRECTOS_KEY = 'Total Gastos Indirectos';
const IMPUESTO_KEY          = 'Impuesto a las Ganancias';

// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
let monthCols   = [];   // [{idx, label, sortKey}]  -- columnas del bloque P&L
let finMonthCols = [];  // columnas del bloque Estado Financiero (puede tener distinto offset)
let dataRows    = {};   // label de fila -> [valores alineados a monthCols]
let finRows     = {};   // label de fila -> [valores alineados a finMonthCols]
let selectedIdx = null;
let mode = 'single';
let rangeSel = new Set(); // índices seleccionados en modo rango
let countdown = INTERVAL, timerID;
let charts = {};

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MES_KEYS = { 'ene':0,'feb':1,'mar':2,'abr':3,'may':4,'jun':5,'jul':6,'ago':7,'sep':8,'sept':8,'oct':9,'nov':10,'dic':11 };

// ══════════════════════════════════════════════════════════
// PARSING HELPERS
// ══════════════════════════════════════════════════════════
function parseMonthLabel(cell) {
  if (!cell) return null;
  const m = String(cell).trim().toLowerCase().match(/^([a-z]+)[-\/](\d{2,4})$/);
  if (!m) return null;
  const monKey = m[1];
  if (!(monKey in MES_KEYS)) return null;
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  const monIdx = MES_KEYS[monKey];
  return { label: MESES[monIdx] + '-' + String(year).slice(2), sortKey: year * 12 + monIdx };
}

function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return 0;
  let s = String(v).trim();
  if (s === '') return 0;
  if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
  s = s.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function fmtUSD(n, compact) {
  const abs = Math.abs(n);
  let formatted;
  if (compact && abs >= 1000) {
    formatted = (abs/1000).toLocaleString('en-US', {maximumFractionDigits:1}) + 'K';
  } else {
    formatted = abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return (n < 0 ? '-$' : '$') + formatted;
}

function fmtUSDParens(n) {
  // estilo contable: negativos entre paréntesis
  const abs = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n < 0 ? '(' + abs + ')' : abs;
}

// ══════════════════════════════════════════════════════════
// FETCH + PARSE MAIN
// ══════════════════════════════════════════════════════════
async function fetchData() {
  try {
    const res = await fetch(csvURL + '&_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const rows = parseCSV(text);
    processSheet(rows);
    document.getElementById('last-update').textContent =
      'Actualizado ' + new Date().toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  } catch (e) {
    console.error(e);
    const dashVisible = document.getElementById('dashboard').style.display === 'block';
    if (dashVisible) {
      document.getElementById('last-update').textContent = '⚠️ Sin conexión — reintentando…';
    } else {
      document.getElementById('state-msg').textContent =
        '⚠️ No se pudo conectar con el Sheet "' + SHEET_NAME + '". Verificá que esté público y el nombre de la hoja sea exacto.';
      document.getElementById('state-msg').className = 'error';
    }
  }
}

function findHeaderRows(rows) {
  // Hay dos bloques de meses en la hoja (USD en $ y luego en USD, o viceversa);
  // tomamos todas las filas candidatas y nos quedamos con la que tenga MÁS columnas de mes
  // (es la fila "completa" del bloque principal, evita headers parciales/resumen)
  let best = { idx: -1, cols: [] };
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const cols = [];
    const seen = new Set();
    rows[i].forEach((cell, idx) => {
      const parsed = parseMonthLabel(cell);
      if (parsed && !seen.has(parsed.sortKey)) {
        seen.add(parsed.sortKey);
        cols.push({ idx, label: parsed.label, sortKey: parsed.sortKey });
      }
    });
    if (cols.length > best.cols.length) best = { idx: i, cols };
  }
  return best;
}

function buildRowMap(rows, startRow, cols, stopLabel) {
  const map = {};
  for (let r = startRow; r < rows.length; r++) {
    const rowLabel = (rows[r][0] || '').trim();
    if (stopLabel && rowLabel === stopLabel) break;
    if (!rowLabel) continue;
    if (!map[rowLabel]) {
      map[rowLabel] = cols.map(c => toNumber(rows[r][c.idx]));
    }
  }
  return map;
}

function processSheet(rows) {
  const header = findHeaderRows(rows);
  if (header.idx === -1) throw new Error('No se encontró fila de encabezado de meses');

  monthCols = header.cols.slice().sort((a,b) => a.sortKey - b.sortKey);
  dataRows = buildRowMap(rows, header.idx + 1, header.cols, 'ESTADO FINANCIERO');

  // Buscar el bloque "ESTADO FINANCIERO" para la tabla patrimonial
  let finHeaderRow = -1;
  for (let i = header.idx; i < rows.length; i++) {
    if ((rows[i][0] || '').trim().toUpperCase().indexOf('ESTADO FINANCIERO') !== -1) { finHeaderRow = i; break; }
  }
  if (finHeaderRow !== -1) {
    const seen = new Set();
    const cols = [];
    rows[finHeaderRow].forEach((cell, idx) => {
      const parsed = parseMonthLabel(cell);
      if (parsed && !seen.has(parsed.sortKey)) { seen.add(parsed.sortKey); cols.push({ idx, label: parsed.label, sortKey: parsed.sortKey }); }
    });
    finMonthCols = cols.sort((a,b) => a.sortKey - b.sortKey);
    finRows = buildRowMap(rows, finHeaderRow + 1, finMonthCols, '');
  }

  if (selectedIdx === null) selectedIdx = monthCols.length - 1;
  if (rangeSel.size === 0) rangeSel.add(monthCols.length - 1);

  renderPeriodBar();
  renderAll();

  document.getElementById('state-msg').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('row-count').textContent = `${monthCols.length} períodos disponibles · datos en USD`;
}

// ══════════════════════════════════════════════════════════
// PERIOD SELECTION
// ══════════════════════════════════════════════════════════
function activeIndices() {
  if (mode === 'single') return [selectedIdx];
  return Array.from(rangeSel).sort((a,b) => a - b);
}

function renderPeriodBar() {
  const bar = document.getElementById('period-bar');
  bar.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'period-label';
  label.textContent = mode === 'single' ? 'Período' : 'Comparar meses';
  bar.appendChild(label);

  monthCols.forEach((m, i) => {
    const chip = document.createElement('div');
    const active = mode === 'single' ? i === selectedIdx : rangeSel.has(i);
    chip.className = 'period-chip' + (active ? ' active' : '');
    chip.textContent = m.label;
    chip.onclick = () => {
      if (mode === 'single') { selectedIdx = i; }
      else {
        if (rangeSel.has(i)) { if (rangeSel.size > 1) rangeSel.delete(i); }
        else rangeSel.add(i);
      }
      renderPeriodBar(); renderAll();
    };
    bar.appendChild(chip);
  });

  const divider = document.createElement('div');
  divider.className = 'period-divider';
  bar.appendChild(divider);

  const toggle = document.createElement('div');
  toggle.className = 'mode-toggle';
  const btnSingle = document.createElement('div');
  btnSingle.className = 'mode-btn' + (mode === 'single' ? ' active' : '');
  btnSingle.textContent = 'Mensual';
  btnSingle.onclick = () => { mode = 'single'; renderPeriodBar(); renderAll(); };
  const btnRange = document.createElement('div');
  btnRange.className = 'mode-btn' + (mode === 'range' ? ' active' : '');
  btnRange.textContent = 'Comparar';
  btnRange.onclick = () => {
    mode = 'range';
    if (rangeSel.size === 0) rangeSel.add(selectedIdx);
    renderPeriodBar(); renderAll();
  };
  toggle.appendChild(btnSingle);
  toggle.appendChild(btnRange);
  bar.appendChild(toggle);

  if (mode === 'range') {
    const hint = document.createElement('div');
    hint.className = 'range-hint';
    hint.textContent = 'Tocá los meses que querés comparar. La última columna de las tablas muestra la suma del total seleccionado.';
    bar.appendChild(hint);
  }

  const periodLabel = mode === 'single'
    ? monthCols[selectedIdx].label
    : activeIndices().map(i => monthCols[i].label).join(' + ');
  document.getElementById('period-badge').textContent = periodLabel;
}

function getValueAt(map, rowKey, idx) {
  const values = map[rowKey];
  if (!values) return 0;
  return values[idx] || 0;
}

function getValueSum(map, rowKey, indices) {
  const values = map[rowKey];
  if (!values) return 0;
  return indices.reduce((s, i) => s + (values[i] || 0), 0);
}

// Para KPIs y gráficos: usa la suma de los meses activos (en single, es 1 mes = el mismo valor)
function getVal(rowKey) { return getValueSum(dataRows, rowKey, activeIndices()); }
function getFinVal(rowKey, idx) { return getValueAt(finRows, rowKey, idx); }

// ══════════════════════════════════════════════════════════
// RENDER ALL
// ══════════════════════════════════════════════════════════
function renderAll() {
  renderKPIs();
  renderPLTable();
  renderFinTable();
  renderCharts();
}

// ══════════════════════════════════════════════════════════
// KPIs
// ══════════════════════════════════════════════════════════
function renderKPIs() {
  const ingresos = getVal('Total Ingresos por Ventas');
  const bruto    = getVal('Resultado Bruto');
  const ebitda   = getVal('EBITDA');
  const neto     = getVal('Resultado Neto');
  const caja     = (() => {
    const idxs = activeIndices();
    const lastIdx = idxs[idxs.length - 1];
    // mapear índice de mes (P&L) a índice correspondiente en finMonthCols por sortKey
    const targetSort = monthCols[lastIdx] ? monthCols[lastIdx].sortKey : null;
    const fi = finMonthCols.findIndex(c => c.sortKey === targetSort);
    return fi !== -1 ? getFinVal('TOTAL', fi) : null;
  })();

  const mb = ingresos !== 0 ? (bruto/ingresos*100) : 0;
  const me = ingresos !== 0 ? (ebitda/ingresos*100) : 0;
  const mn = ingresos !== 0 ? (neto/ingresos*100) : 0;

  const kpis = [
    { label: 'Ventas totales', value: fmtUSD(ingresos, true), sub: null, cls:'' },
    { label: 'Resultado bruto', value: fmtUSD(bruto, true), sub: `Margen ${mb.toFixed(1)}%`, cls: bruto>=0?'pos':'neg' },
    { label: 'EBITDA', value: fmtUSD(ebitda, true), sub: `Margen ${me.toFixed(1)}%`, cls: ebitda>=0?'pos':'neg' },
    { label: 'Resultado neto', value: fmtUSD(neto, true), sub: `Margen ${mn.toFixed(1)}%`, cls: neto>=0?'pos':'neg' },
    { label: 'Posición de caja', value: caja !== null ? fmtUSD(caja, true) : '—', sub: caja !== null ? 'al cierre del período' : 'sin dato', cls:'' },
  ];

  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-val">${k.value}</div>
      ${k.sub ? `<div class="kpi-sub ${k.cls}">${k.sub}</div>` : ''}
    </div>
  `).join('');
}

// ══════════════════════════════════════════════════════════
// TABLA P&L  (columnas = meses activos, + columna Total si hay >1)
// ══════════════════════════════════════════════════════════
function renderPLTable() {
  const idxs = activeIndices();
  const showTotal = idxs.length > 1;

  const thead = document.getElementById('pl-thead');
  let headHtml = '<tr><th>Concepto</th>';
  idxs.forEach(i => headHtml += `<th>${monthCols[i].label}</th>`);
  if (showTotal) headHtml += '<th class="total-col">Total</th>';
  headHtml += '</tr>';
  thead.innerHTML = headHtml;

  const ingresosTotal = getVal('Total Ingresos por Ventas');

  const tbody = document.getElementById('pl-tbody');
  tbody.innerHTML = PL_ROWS.map(r => {
    const sign = r.sign || 1;
    let rowHtml = `<tr class="${r.type === 'total' ? 'total' : r.type === 'sub' ? 'sub' : ''}"><td>${r.label}</td>`;
    idxs.forEach(i => {
      const v = getValueAt(dataRows, r.key, i) * sign;
      const cls = v < 0 ? 'neg' : (r.type !== 'normal' && v > 0 ? 'pos' : '');
      rowHtml += `<td class="${cls}">${fmtUSDParens(v)}</td>`;
    });
    if (showTotal) {
      const vt = getValueSum(dataRows, r.key, idxs) * sign;
      const cls = vt < 0 ? 'neg' : (r.type !== 'normal' && vt > 0 ? 'pos' : '');
      rowHtml += `<td class="total-col ${cls}">${fmtUSDParens(vt)}</td>`;
    }
    rowHtml += '</tr>';
    return rowHtml;
  }).join('');
}

// ══════════════════════════════════════════════════════════
// TABLA FINANCIERA (mapea índices de mes del P&L -> índices propios)
// ══════════════════════════════════════════════════════════
function finIndexFor(plIdx) {
  const sortKey = monthCols[plIdx] ? monthCols[plIdx].sortKey : null;
  return finMonthCols.findIndex(c => c.sortKey === sortKey);
}

function renderFinTable() {
  if (finMonthCols.length === 0) {
    document.getElementById('fin-thead').innerHTML = '';
    document.getElementById('fin-tbody').innerHTML = '<tr><td>Sin datos de posición financiera disponibles para este período.</td></tr>';
    return;
  }
  const idxs = activeIndices();
  const finIdxs = idxs.map(finIndexFor).filter(i => i !== -1);
  const showTotal = finIdxs.length > 1;

  const thead = document.getElementById('fin-thead');
  let headHtml = '<tr><th>Concepto</th>';
  finIdxs.forEach(i => headHtml += `<th>${finMonthCols[i].label}</th>`);
  if (showTotal) headHtml += '<th class="total-col">Total</th>';
  headHtml += '</tr>';
  thead.innerHTML = headHtml;

  if (finIdxs.length === 0) {
    document.getElementById('fin-tbody').innerHTML = '<tr><td>No hay datos de posición financiera para el período seleccionado.</td></tr>';
    return;
  }

  const tbody = document.getElementById('fin-tbody');
  tbody.innerHTML = FIN_ROWS.map(r => {
    const sign = r.sign || 1;
    let rowHtml = `<tr class="${r.type === 'total' ? 'total' : r.type === 'sub' ? 'sub' : ''}"><td>${r.label}</td>`;
    finIdxs.forEach(i => {
      const v = getValueAt(finRows, r.key, i) * sign;
      const cls = v < 0 ? 'neg' : '';
      rowHtml += `<td class="${cls}">${fmtUSDParens(v)}</td>`;
    });
    if (showTotal) {
      const vt = getValueSum(finRows, r.key, finIdxs) * sign;
      const cls = vt < 0 ? 'neg' : '';
      rowHtml += `<td class="total-col ${cls}">${fmtUSDParens(vt)}</td>`;
    }
    rowHtml += '</tr>';
    return rowHtml;
  }).join('');
}

// ══════════════════════════════════════════════════════════
// CHARTS
// ══════════════════════════════════════════════════════════
function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function baseOpts(extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' $' + Math.round(c.parsed.y ?? c.parsed).toLocaleString() } } },
    ...extra
  };
}

function renderCharts() {
  const idxs = activeIndices();
  const labels = idxs.map(i => monthCols[i].label);
  const isCompare = idxs.length > 1;

  const ventas = idxs.map(i => getValueAt(dataRows, 'Total Ingresos por Ventas', i));
  const costo  = idxs.map(i => getValueAt(dataRows, 'Total Costo de Ventas', i));
  const bruto  = idxs.map(i => getValueAt(dataRows, 'Resultado Bruto', i));
  const gastos = idxs.map(i => getValueAt(dataRows, 'Total Gastos', i));
  const ebitda = idxs.map(i => getValueAt(dataRows, 'EBITDA', i));
  const rneto  = idxs.map(i => getValueAt(dataRows, 'Resultado Neto', i));
  const rfin   = idxs.map(i => getValueAt(dataRows, 'Resultados Financieros', i));
  const otros  = idxs.map(i => getValueAt(dataRows, 'Otros Ingresos y Egresos', i));
  const impuesto = idxs.map(i => getValueAt(dataRows, 'Impuesto a las Ganancias', i));
  const rpost  = idxs.map(i => getValueAt(dataRows, 'Resultado Despues de Impuestos', i));

  const mb = ventas.map((v,i) => v !== 0 ? +(bruto[i]/v*100).toFixed(1) : 0);
  const me = ventas.map((v,i) => v !== 0 ? +(ebitda[i]/v*100).toFixed(1) : 0);
  const mn = ventas.map((v,i) => v !== 0 ? +(rneto[i]/v*100).toFixed(1) : 0);

  document.getElementById('c1-title').textContent = isCompare
    ? 'Ingresos vs costo vs resultado bruto — comparativa mensual'
    : `Ingresos vs costo vs resultado bruto — ${labels[0]}`;

  // C1 — Ventas / Costo / Bruto
  destroyChart('c1');
  charts.c1 = new Chart(document.getElementById('c1'), {
    type: 'bar',
    data: { labels, datasets: [
      { label:'Ventas', data: ventas, backgroundColor: COLORS.blue, borderRadius: 3 },
      { label:'Costo', data: costo.map(v => -Math.abs(v)), backgroundColor: COLORS.red, borderRadius: 3 },
      { label:'Res. bruto', data: bruto, backgroundColor: COLORS.green, borderRadius: 3 },
    ]},
    options: baseOpts({ scales: {
      x: { grid: { display:false } },
      y: { grid: { color:'rgba(0,0,0,.06)' }, ticks: { callback: v => '$' + (Math.abs(v)/1000).toFixed(0) + 'K' } }
    }})
  });

  // C2 — márgenes
  destroyChart('c2');
  charts.c2 = new Chart(document.getElementById('c2'), {
    type: 'line',
    data: { labels, datasets: [
      { label:'Margen bruto', data: mb, borderColor: COLORS.green, backgroundColor:'rgba(29,158,117,.08)', tension:.35, fill:true, pointRadius:4 },
      { label:'EBITDA', data: me, borderColor: COLORS.purple, tension:.35, pointRadius:4, borderDash:[5,3] },
      { label:'Res. neto', data: mn, borderColor: COLORS.blue, tension:.35, pointRadius:4, borderDash:[2,3] },
    ]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } } },
      scales: { x:{grid:{display:false}}, y:{grid:{color:'rgba(0,0,0,.06)'}, ticks:{callback:v=>v+'%'}} }
    }
  });

  // C3 — composición de egresos (dona) del período activo (suma)
  const gDir = getVal('Total Gastos Directos');
  const gInd = getVal('Total Gastos Indirectos');
  const gImp = Math.abs(getVal('Impuesto a las Ganancias'));
  document.getElementById('c3-title').textContent = isCompare ? 'Composición de egresos — total del período' : `Composición de egresos — ${labels[0]}`;
  document.getElementById('c3-legend').innerHTML = `
    <span><span class="dot" style="background:${COLORS.blue}"></span>Directos ${fmtUSD(Math.abs(gDir), true)}</span>
    <span><span class="dot" style="background:${COLORS.purple}"></span>Indirectos ${fmtUSD(Math.abs(gInd), true)}</span>
    <span><span class="dot" style="background:${COLORS.red}"></span>Imp. ganancias ${fmtUSD(gImp, true)}</span>`;
  destroyChart('c3');
  charts.c3 = new Chart(document.getElementById('c3'), {
    type: 'doughnut',
    data: { labels: ['Directos','Indirectos','Imp. ganancias'],
      datasets: [{ data: [Math.abs(gDir), Math.abs(gInd), gImp], backgroundColor: [COLORS.blue, COLORS.purple, COLORS.red], hoverOffset:6 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'65%',
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => ' $' + c.parsed.toLocaleString() } } } }
  });

  // C6 — Waterfall del período activo (suma)
  const wfIngresos = getVal('Total Ingresos por Ventas');
  const wfCosto = -Math.abs(getVal('Total Costo de Ventas'));
  const wfBruto = getVal('Resultado Bruto');
  const wfGastos = -Math.abs(getVal('Total Gastos'));
  const wfOtros = getVal('Otros Ingresos y Egresos');
  const wfEbitda = getVal('EBITDA');
  const wfFin = getVal('Resultados Financieros');
  const wfNeto = getVal('Resultado Neto');
  const wfImp = -Math.abs(getVal('Impuesto a las Ganancias'));
  const wfPost = getVal('Resultado Despues de Impuestos');

  document.getElementById('c6-title').textContent = isCompare
    ? `Waterfall — de ventas a resultado neto (suma ${labels.join('+')})`
    : `Waterfall — de ventas a resultado neto (${labels[0]})`;

  const wfL = ['Ventas','(-) Costo','Res. bruto','(-) Gastos','Otros ing/egr','EBITDA','(+/-) Financ.','Res. neto','(-) Impuestos','Res. post-imp.'];
  const wfV = [wfIngresos, wfCosto, wfBruto, wfGastos, wfOtros, wfEbitda, wfFin, wfNeto, wfImp, wfPost];
  const wfC = wfV.map((v,i) => {
    if (i===0) return COLORS.blue;
    if (i===9) return COLORS.green;
    if (i===2||i===5||i===7) return COLORS.purple;
    return v >= 0 ? COLORS.green : COLORS.red;
  });
  destroyChart('c6');
  charts.c6 = new Chart(document.getElementById('c6'), {
    type: 'bar',
    data: { labels: wfL, datasets: [{ data: wfV.map(Math.abs), backgroundColor: wfC, borderRadius: 4 }] },
    options: { responsive:true, maintainAspectRatio:false,
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => { const v = wfV[c.dataIndex]; return ' $' + (v>=0?'':'-') + Math.abs(v).toLocaleString(); } } } },
      scales: { x:{grid:{display:false}, ticks:{autoSkip:false, maxRotation:35, font:{size:10}}}, y:{grid:{color:'rgba(0,0,0,.06)'}, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'K'}} }
    }
  });

  // C7 — Tendencia: ventas / ebitda / neto, sobre TODOS los meses disponibles (no solo los activos)
  // así siempre se ve el contexto histórico completo, independiente del selector
  const allLabels = monthCols.map(c => c.label);
  const allVentas = monthCols.map((c,i) => getValueAt(dataRows, 'Total Ingresos por Ventas', i));
  const allEbitda = monthCols.map((c,i) => getValueAt(dataRows, 'EBITDA', i));
  const allNeto   = monthCols.map((c,i) => getValueAt(dataRows, 'Resultado Neto', i));
  destroyChart('c7');
  charts.c7 = new Chart(document.getElementById('c7'), {
    type: 'line',
    data: { labels: allLabels, datasets: [
      { label:'Ventas', data: allVentas, borderColor: COLORS.blue, backgroundColor:'rgba(55,138,221,.08)', tension:.35, fill:true, pointRadius:4 },
      { label:'EBITDA', data: allEbitda, borderColor: COLORS.purple, tension:.35, pointRadius:4, borderDash:[5,3] },
      { label:'Resultado neto', data: allNeto, borderColor: COLORS.green, tension:.35, pointRadius:4, borderDash:[2,3] },
    ]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => ` ${c.dataset.label}: $${c.parsed.y.toLocaleString()}` } } },
      scales: { x:{grid:{display:false}}, y:{grid:{color:'rgba(0,0,0,.06)'}, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'K'}} }
    }
  });

  // C5 — Evolución de caja (histórico completo de finMonthCols)
  document.getElementById('c5-title').textContent = 'Evolución de caja total (USD) — histórico completo';
  if (finMonthCols.length > 0) {
    const finLabels = finMonthCols.map(c => c.label);
    const cajaSerie = finMonthCols.map((c,i) => getFinVal('TOTAL', i));
    const varSerie = cajaSerie.map((v,i) => i === 0 ? 0 : v - cajaSerie[i-1]);
    destroyChart('c5');
    charts.c5 = new Chart(document.getElementById('c5'), {
      type: 'bar',
      data: { labels: finLabels, datasets: [
        { label:'Total caja', data: cajaSerie, backgroundColor:'rgba(83,74,183,.7)', borderRadius:3, yAxisID:'y' },
        { label:'Variación', data: varSerie, type:'line', borderColor: COLORS.red, borderWidth:2, pointRadius:4, fill:false, yAxisID:'y2', tension:.3 },
      ]},
      options: { responsive:true, maintainAspectRatio:false,
        plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => ` ${c.dataset.label}: $${c.parsed.y.toLocaleString()}` } } },
        scales: {
          x: { grid:{display:false} },
          y: { grid:{color:'rgba(0,0,0,.06)'}, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'K'}, position:'left' },
          y2: { position:'right', grid:{display:false}, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'K'} }
        }
      }
    });
  }

  // C10 — Créditos vs deudas, del último mes activo
  const lastIdx = idxs[idxs.length - 1];
  const fi = finIndexFor(lastIdx);
  document.getElementById('c10-title').textContent = fi !== -1 ? `Créditos vs deudas — ${finMonthCols[fi].label}` : 'Créditos vs deudas';
  destroyChart('c10');
  if (fi !== -1) {
    const credVentas = getFinVal('Creditos por Ventas', fi);
    const otrosCred = getFinVal('Otros Creditos', fi);
    const bienesUso = getFinVal('Bienes de Uso', fi);
    const dCom = -Math.abs(getFinVal('Deudas Comerciales', fi));
    const dSoc = -Math.abs(getFinVal('Deudas Sociales', fi));
    const dFis = -Math.abs(getFinVal('Deudas Fiscales', fi));
    charts.c10 = new Chart(document.getElementById('c10'), {
      type: 'bar',
      data: { labels: ['Créd. ventas','Otros créd.','B. uso','D. comerc.','D. sociales','D. fiscales'],
        datasets: [{ data: [credVentas, otrosCred, bienesUso, dCom, dSoc, dFis],
          backgroundColor: ctx => ctx.raw >= 0 ? 'rgba(29,158,117,.8)' : 'rgba(216,90,48,.8)', borderRadius:3 }] },
      options: { responsive:true, maintainAspectRatio:false,
        plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => ' $' + c.parsed.y.toLocaleString() } } },
        scales: { x:{grid:{display:false}, ticks:{font:{size:10}}}, y:{grid:{color:'rgba(0,0,0,.06)'}, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'K'}} }
      }
    });
  }
}

// ══════════════════════════════════════════════════════════
// COUNTDOWN + INIT
// ══════════════════════════════════════════════════════════
function startCountdown() {
  clearInterval(timerID);
  countdown = INTERVAL;
  timerID = setInterval(() => {
    countdown--;
    const el = document.getElementById('countdown');
    if (el) el.textContent = countdown + 's';
    if (countdown <= 0) { countdown = INTERVAL; fetchData(); }
  }, 1000);
}

fetchData();
startCountdown();
