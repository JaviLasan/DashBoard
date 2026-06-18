// ══════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════
const SHEET_ID   = '1SF4HkZyqPIhLbSRMrMo7HcsAptvtgF8oItdnNLFymR0';
const SHEET_NAME = 'Estado de Resultados USD';

const csvURL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

const COLORS = { blue:'#2BA8E0', green:'#2FBF8F', purple:'#8B7FD6', red:'#E2604F', orange:'#E8954A' };

// Filas del Estado de Resultados (P&L), en orden de presentación
const PL_ROWS = [
  { label: 'Ingresos por ventas',      key: 'Total Ingresos por Ventas', type: 'normal' },
  { label: 'Costo de ventas',          key: 'Total Costo de Ventas',     type: 'normal', sign: -1 },
  { label: 'Resultado bruto',          key: 'Resultado Bruto',           type: 'sub' },
  { label: 'Gastos',                   key: 'Total Gastos',              type: 'normal', sign: -1 },
  { label: 'Otros ingresos y egresos', key: 'Otros Ingresos y Egresos',  type: 'normal' },
  { label: 'EBITDA',                   key: 'EBITDA',                    type: 'sub' },
  { label: 'Resultados financieros',   key: 'Resultados Financieros',    type: 'normal' },
  { label: 'Resultado neto',           key: 'Resultado Neto',            type: 'sub' },
  { label: 'Impuesto a las ganancias', key: 'Impuesto a las Ganancias',  type: 'normal', sign: -1 },
  { label: 'Resultado después de impuestos', key: 'Resultado Despues de Impuestos', type: 'total' },
];

// Filas del Estado Financiero (posición patrimonial) — sin columna Total (punto 8)
// 'keys' es un array porque algunos conceptos son la suma de varias filas del Sheet
const FIN_ROWS = [
  { label: 'Total caja',           keys: ['TOTAL'],                                    type: 'sub' },
  { label: 'Créditos por ventas',  keys: ['Creditos por Ventas'],                       type: 'normal' },
  { label: 'Otros créditos',       keys: ['Otros Creditos', 'Ajuste Otros Creditos'],   type: 'normal' },
  { label: 'Deudas comerciales',   keys: ['Deudas Comerciales'],                        type: 'normal', sign: -1 },
  { label: 'Deudas financieras',   keys: ['Deudas Financieras'],                        type: 'normal', sign: -1 },
  { label: 'Deudas sociales',      keys: ['Deudas Sociales'],                           type: 'normal', sign: -1 },
  { label: 'Deudas fiscales',      keys: ['Deudas Fiscales', 'Ajuste Deudas Fiscales'],  type: 'normal', sign: -1 },
  { label: 'Otras deudas',         keys: ['Otras Deudas'],                              type: 'normal', sign: -1 },
  { label: 'Deudas B',             keys: ['Deudas B'],                                  type: 'normal', sign: -1 },
];

// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
let monthCols   = [];
let finMonthCols = [];
let dataRows    = {};
let finRows     = {};
let cajaAccounts = [];
let selectedIdx = null;
let selectedYear = null;
let visibleMonthIdxs = [];
let mode = 'single';
let rangeSel = new Set();
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
  const abs = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n < 0 ? '(' + abs + ')' : abs;
}

function fmtPct(n) {
  if (!isFinite(n)) return '—';
  return n.toFixed(1) + '%';
}

// ══════════════════════════════════════════════════════════
// FETCH + PARSE MAIN  (sin auto-refresh: solo al cargar o click manual)
// ══════════════════════════════════════════════════════════
async function fetchData() {
  try {
    const res = await fetch(csvURL + '&_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const rows = parseCSV(text);
    processSheet(rows);
    document.getElementById('last-update').textContent =
      'Actualizado ' + new Date().toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }) +
      ' · ' + new Date().toLocaleDateString('es-AR');
  } catch (e) {
    console.error(e);
    const dashVisible = document.getElementById('dashboard').style.display === 'block';
    if (dashVisible) {
      document.getElementById('last-update').textContent = '⚠️ Sin conexión — probá actualizar';
    } else {
      document.getElementById('state-msg').textContent =
        '⚠️ No se pudo conectar con el Sheet "' + SHEET_NAME + '". Verificá que esté público y el nombre de la hoja sea exacto.';
      document.getElementById('state-msg').className = 'error';
    }
  }
}

function findHeaderRows(rows) {
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

  let allMonthCols = header.cols.slice().sort((a,b) => a.sortKey - b.sortKey);
  const rawData = buildRowMap(rows, header.idx + 1, header.cols, 'ESTADO FINANCIERO');

  // Filtrar solo meses con datos reales (Ingresos por Ventas != 0)
  const ventasRaw = rawData['Total Ingresos por Ventas'] || [];
  monthCols = allMonthCols.filter(c => {
    const origPos = header.cols.findIndex(hc => hc.idx === c.idx);
    return ventasRaw[origPos] !== undefined && ventasRaw[origPos] !== 0;
  });

  dataRows = {};
  Object.keys(rawData).forEach(k => {
    dataRows[k] = monthCols.map(c => {
      const origPos = header.cols.findIndex(hc => hc.idx === c.idx);
      return rawData[k][origPos];
    });
  });

  // Bloque ESTADO FINANCIERO
  let finHeaderRow = -1;
  for (let i = header.idx; i < rows.length; i++) {
    if ((rows[i][0] || '').trim().toUpperCase().indexOf('ESTADO FINANCIERO') !== -1) { finHeaderRow = i; break; }
  }
  finMonthCols = [];
  finRows = {};
  cajaAccounts = []; // cuentas individuales de caja detectadas dinámicamente

  if (finHeaderRow !== -1) {
    const seen = new Set();
    const allFinCols = [];
    rows[finHeaderRow].forEach((cell, idx) => {
      const parsed = parseMonthLabel(cell);
      if (parsed && !seen.has(parsed.sortKey)) { seen.add(parsed.sortKey); allFinCols.push({ idx, label: parsed.label, sortKey: parsed.sortKey }); }
    });
    allFinCols.sort((a,b) => a.sortKey - b.sortKey);
    const rawFin = buildRowMap(rows, finHeaderRow + 1, allFinCols, '');

    const validSortKeys = new Set(monthCols.map(c => c.sortKey));
    finMonthCols = allFinCols.filter(c => validSortKeys.has(c.sortKey));
    Object.keys(rawFin).forEach(k => {
      finRows[k] = finMonthCols.map(c => {
        const origPos = allFinCols.findIndex(ac => ac.idx === c.idx);
        return rawFin[k][origPos];
      });
    });

    // Detectar cuentas individuales de caja: filas entre el header y 'TOTAL'
    cajaAccounts = [];
    for (let r = finHeaderRow + 1; r < rows.length; r++) {
      const label = (rows[r][0] || '').trim();
      if (!label) continue;
      if (label === 'TOTAL') break;
      if (label.startsWith('Variación') || label.startsWith('Variacion')) break;
      cajaAccounts.push(label);
    }
  }

  if (monthCols.length === 0) throw new Error('No hay meses con datos cargados todavía');

  // Selector de año: extraer años únicos de los meses disponibles
  const years = [...new Set(monthCols.map(c => Math.floor(c.sortKey / 12)))];
  if (selectedYear === null || !years.includes(selectedYear)) selectedYear = years[years.length - 1];

  // Filtrar meses del año seleccionado
  visibleMonthIdxs = monthCols.map((c,i) => ({ c, i }))
    .filter(({c}) => Math.floor(c.sortKey / 12) === selectedYear)
    .map(({i}) => i);

  if (selectedIdx === null || !visibleMonthIdxs.includes(selectedIdx)) {
    selectedIdx = visibleMonthIdxs[visibleMonthIdxs.length - 1];
  }
  rangeSel = new Set(Array.from(rangeSel).filter(i => visibleMonthIdxs.includes(i)));
  if (rangeSel.size === 0) rangeSel.add(selectedIdx);

  renderPeriodBar(years);
  renderAll();

  document.getElementById('state-msg').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('row-count').textContent = `${monthCols.length} ${monthCols.length===1?'período':'períodos'} con datos · ${years.join(', ')}`;
}

// ══════════════════════════════════════════════════════════
// PERIOD SELECTION
// ══════════════════════════════════════════════════════════
function activeIndices() {
  if (mode === 'single') return [selectedIdx];
  const sel = Array.from(rangeSel).filter(i => visibleMonthIdxs.includes(i)).sort((a,b) => a-b);
  return sel.length ? sel : [selectedIdx];
}

function renderPeriodBar(years) {
  const bar = document.getElementById('period-bar');
  bar.innerHTML = '';

  // ── Fila 1: Selector de AÑO ──
  const yearRow = document.createElement('div');
  yearRow.className = 'period-row';
  const yearLabel = document.createElement('span');
  yearLabel.className = 'period-label';
  yearLabel.textContent = 'Año';
  yearRow.appendChild(yearLabel);

  (years || [...new Set(monthCols.map(c => Math.floor(c.sortKey / 12)))]).forEach(y => {
    const chip = document.createElement('div');
    chip.className = 'year-chip' + (y === selectedYear ? ' active' : '');
    chip.textContent = y;
    chip.onclick = () => {
      selectedYear = y;
      visibleMonthIdxs = monthCols.map((c,i) => ({ c, i }))
        .filter(({c}) => Math.floor(c.sortKey / 12) === selectedYear)
        .map(({i}) => i);
      selectedIdx = visibleMonthIdxs[visibleMonthIdxs.length - 1];
      rangeSel = new Set([selectedIdx]);
      renderPeriodBar();
      renderAll();
    };
    yearRow.appendChild(chip);
  });
  bar.appendChild(yearRow);

  // ── Fila 2: Selector de MES (solo del año activo) ──
  const monthRow = document.createElement('div');
  monthRow.className = 'period-row';
  const monthLabel = document.createElement('span');
  monthLabel.className = 'period-label';
  monthLabel.textContent = mode === 'single' ? 'Mes' : 'Comparar';
  monthRow.appendChild(monthLabel);

  visibleMonthIdxs.forEach(i => {
    const m = monthCols[i];
    const chip = document.createElement('div');
    const active = mode === 'single' ? i === selectedIdx : rangeSel.has(i);
    chip.className = 'period-chip' + (active ? ' active' : '');
    chip.textContent = m.label.split('-')[0]; // solo "Ene", "Feb", etc.
    chip.onclick = () => {
      if (mode === 'single') { selectedIdx = i; }
      else {
        if (rangeSel.has(i)) { if (rangeSel.size > 1) rangeSel.delete(i); }
        else rangeSel.add(i);
      }
      renderPeriodBar();
      renderAll();
    };
    monthRow.appendChild(chip);
  });

  // Divider + toggle Mensual/Comparar
  const divider = document.createElement('div');
  divider.className = 'period-divider';
  monthRow.appendChild(divider);

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
  monthRow.appendChild(toggle);
  bar.appendChild(monthRow);

  if (mode === 'range') {
    const hint = document.createElement('div');
    hint.className = 'range-hint';
    hint.textContent = 'Tocá los meses que querés comparar. La última columna de las tablas muestra la suma del total seleccionado.';
    bar.appendChild(hint);
  }

  const periodLabel = mode === 'single'
    ? monthCols[selectedIdx]?.label || '—'
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
// Variantes que aceptan un array de keys y suman el resultado de todas (para filas compuestas)
function getValueAtMulti(map, keys, idx) {
  return keys.reduce((s, k) => s + getValueAt(map, k, idx), 0);
}
function getValueSumMulti(map, keys, indices) {
  return keys.reduce((s, k) => s + getValueSum(map, k, indices), 0);
}
function getVal(rowKey) { return getValueSum(dataRows, rowKey, activeIndices()); }
function getFinVal(rowKey, idx) { return getValueAt(finRows, rowKey, idx); }
function getFinValMulti(keys, idx) { return getValueAtMulti(finRows, keys, idx); }

function finIndexFor(plIdx) {
  const sortKey = monthCols[plIdx] ? monthCols[plIdx].sortKey : null;
  return finMonthCols.findIndex(c => c.sortKey === sortKey);
}

// ══════════════════════════════════════════════════════════
// RENDER ALL
// ══════════════════════════════════════════════════════════
function renderAll() {
  renderPLTable();
  renderKPIs();
  renderRatios();
  renderFinTable();
  renderCharts();
}

// ══════════════════════════════════════════════════════════
// TABLA P&L  (columnas = meses activos + %, + columna Total si hay >1)
// ══════════════════════════════════════════════════════════
function renderPLTable() {
  const idxs = activeIndices();
  const showTotal = idxs.length > 1;

  const thead = document.getElementById('pl-thead');
  let headHtml = '<tr><th>Concepto</th>';
  idxs.forEach(i => { headHtml += `<th>${monthCols[i].label}</th><th class="pct-col">%</th>`; });
  if (showTotal) headHtml += '<th class="total-col">Total</th><th class="pct-col">%</th>';
  headHtml += '</tr>';
  thead.innerHTML = headHtml;

  const tbody = document.getElementById('pl-tbody');
  tbody.innerHTML = PL_ROWS.map(r => {
    const sign = r.sign || 1;
    let rowHtml = `<tr class="${r.type === 'total' ? 'total' : r.type === 'sub' ? 'sub' : ''}"><td>${r.label}</td>`;
    idxs.forEach(i => {
      const v = getValueAt(dataRows, r.key, i) * sign;
      const ingresosMes = getValueAt(dataRows, 'Total Ingresos por Ventas', i);
      const pct = ingresosMes !== 0 ? (v / ingresosMes * 100) : 0;
      const cls = v < 0 ? 'neg' : (r.type !== 'normal' && v > 0 ? 'pos' : '');
      rowHtml += `<td class="${cls}">${fmtUSDParens(v)}</td><td class="pct-cell">${fmtPct(pct)}</td>`;
    });
    if (showTotal) {
      const vt = getValueSum(dataRows, r.key, idxs) * sign;
      const ingresosTotal = getValueSum(dataRows, 'Total Ingresos por Ventas', idxs);
      const pctT = ingresosTotal !== 0 ? (vt / ingresosTotal * 100) : 0;
      const cls = vt < 0 ? 'neg' : (r.type !== 'normal' && vt > 0 ? 'pos' : '');
      rowHtml += `<td class="total-col ${cls}">${fmtUSDParens(vt)}</td><td class="pct-cell">${fmtPct(pctT)}</td>`;
    }
    rowHtml += '</tr>';
    return rowHtml;
  }).join('');
}

// ══════════════════════════════════════════════════════════
// KPIs
// ══════════════════════════════════════════════════════════
function renderKPIs() {
  const idxs = activeIndices();
  const ingresos = getVal('Total Ingresos por Ventas');
  const bruto    = getVal('Resultado Bruto');
  const ebitda   = getVal('EBITDA');
  const neto     = getVal('Resultado Neto');
  const caja     = (() => {
    const lastIdx = idxs[idxs.length - 1];
    const fi = finIndexFor(lastIdx);
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

  const grid = document.getElementById('kpi-grid');
  // Adaptar tamaño de fuente si hay muchos meses seleccionados (punto 5)
  grid.className = 'kpi-grid' + (idxs.length >= 4 ? ' cols-many' : '');

  grid.innerHTML = kpis.map(k => `
    <div class="kpi">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-val">${k.value}</div>
      ${k.sub ? `<div class="kpi-sub ${k.cls}">${k.sub}</div>` : ''}
    </div>
  `).join('');
}

// ══════════════════════════════════════════════════════════
// RATIOS CLAVE  (con leyenda explicativa en tooltip)
// ══════════════════════════════════════════════════════════
function renderRatios() {
  const idxs = activeIndices();
  const lastIdx = idxs[idxs.length - 1];
  const firstIdx = idxs[0];
  const fiLast = finIndexFor(lastIdx);
  const days = idxs.length * 30.4; // aproximación de días del período (mensual ~30.4 días)

  const ventas   = getVal('Total Ingresos por Ventas');
  const costo    = Math.abs(getVal('Total Costo de Ventas'));
  const gastos   = Math.abs(getVal('Total Gastos'));
  const bruto    = getVal('Resultado Bruto');
  const ebitda   = getVal('EBITDA');
  const neto     = getVal('Resultado Neto');

  const credVentas = fiLast !== -1 ? getFinVal('Creditos por Ventas', fiLast) : 0;
  const deudasCom   = fiLast !== -1 ? getFinVal('Deudas Comerciales', fiLast) : 0;
  const deudasSoc   = fiLast !== -1 ? getFinVal('Deudas Sociales', fiLast) : 0;
  const deudasFis   = fiLast !== -1 ? getFinVal('Deudas Fiscales', fiLast) : 0;
  const totalDeudas = deudasCom + deudasSoc + deudasFis;
  const otrosCred   = fiLast !== -1 ? getFinVal('Otros Creditos', fiLast) : 0;
  const bienesUso   = fiLast !== -1 ? getFinVal('Bienes de Uso', fiLast) : 0;
  const caja        = fiLast !== -1 ? getFinVal('TOTAL', fiLast) : 0;

  // DSO: días de cobranza
  const dso = ventas !== 0 ? (credVentas / ventas) * days : null;
  // DPO: días de pago (usando costo + gastos totales como base de egresos)
  const dpo = (costo + gastos) !== 0 ? (deudasCom / (costo + gastos)) * days : null;
  // CCC
  const ccc = (dso !== null && dpo !== null) ? (dso - dpo) : null;

  // Liquidez corriente = activo corriente / pasivo corriente
  const activoCorriente = caja + credVentas + otrosCred;
  const liquidez = totalDeudas !== 0 ? (activoCorriente / totalDeudas) : null;

  // Solvencia = activo total / pasivo total
  const activoTotal = caja + credVentas + otrosCred + bienesUso;
  const solvencia = totalDeudas !== 0 ? (activoTotal / totalDeudas) : null;

  // Márgenes
  const margenBruto = ventas !== 0 ? (bruto/ventas*100) : null;
  const margenEbitda = ventas !== 0 ? (ebitda/ventas*100) : null;
  const margenNeto = ventas !== 0 ? (neto/ventas*100) : null;

  // OCF aproximado / Revenue: Resultado Neto ajustado por variación de capital de trabajo
  let ocfRevenue = null;
  if (fiLast !== -1 && firstIdx !== lastIdx) {
    const fiFirstPrev = finIndexFor(firstIdx) - 1; // mes anterior al inicio del rango
    if (fiFirstPrev >= 0) {
      const credPrev = getFinVal('Creditos por Ventas', fiFirstPrev);
      const deudasPrev = getFinVal('Deudas Comerciales', fiFirstPrev) + getFinVal('Deudas Sociales', fiFirstPrev) + getFinVal('Deudas Fiscales', fiFirstPrev);
      const deltaCred = credVentas - credPrev;
      const deltaDeudas = totalDeudas - deudasPrev;
      const ocf = neto - deltaCred + deltaDeudas;
      ocfRevenue = ventas !== 0 ? (ocf/ventas*100) : null;
    }
  } else if (fiLast - 1 >= 0) {
    const credPrev = getFinVal('Creditos por Ventas', fiLast - 1);
    const deudasPrev = getFinVal('Deudas Comerciales', fiLast - 1) + getFinVal('Deudas Sociales', fiLast - 1) + getFinVal('Deudas Fiscales', fiLast - 1);
    const deltaCred = credVentas - credPrev;
    const deltaDeudas = totalDeudas - deudasPrev;
    const ocf = neto - deltaCred + deltaDeudas;
    ocfRevenue = ventas !== 0 ? (ocf/ventas*100) : null;
  }

  // Crecimiento de ventas vs período anterior equivalente
  let crecimiento = null;
  const prevIdxs = idxs.map(i => i - idxs.length).filter(i => i >= 0);
  if (prevIdxs.length === idxs.length) {
    const ventasPrev = getValueSum(dataRows, 'Total Ingresos por Ventas', prevIdxs);
    if (ventasPrev !== 0) crecimiento = ((ventas / ventasPrev) - 1) * 100;
  }

  const ratios = [
    { label: 'Margen bruto', value: fmtPct(margenBruto), tag: 'Rentabilidad',
      desc: 'Porcentaje de las ventas que queda después de descontar el costo de lo vendido. Indica cuán rentable es la actividad principal antes de gastos operativos.' },
    { label: 'Margen EBITDA', value: fmtPct(margenEbitda), tag: 'Rentabilidad',
      desc: 'Porcentaje de las ventas que se convierte en resultado operativo, antes de intereses, impuestos y amortizaciones. Mide la eficiencia operativa del negocio.' },
    { label: 'Margen neto', value: fmtPct(margenNeto), tag: 'Rentabilidad',
      desc: 'Porcentaje de las ventas que queda como ganancia final, después de todos los gastos, resultados financieros e impuestos.' },
    { label: 'Crecimiento de ventas', value: crecimiento !== null ? fmtPct(crecimiento) : '—', tag: 'Crecimiento',
      desc: 'Variación de las ventas del período actual respecto al período inmediatamente anterior de igual duración. Un valor positivo indica crecimiento.' },
    { label: 'Ciclo de cobranza (DSO)', value: dso !== null ? Math.round(dso) + ' días' : '—', tag: 'Eficiencia',
      desc: 'Días promedio que tarda la empresa en cobrarle a sus clientes, calculado como Créditos por Ventas ÷ Ventas del período × días del período. Cuanto más bajo, mejor: el dinero vuelve más rápido a la caja.' },
    { label: 'Ciclo de pago (DPO)', value: dpo !== null ? Math.round(dpo) + ' días' : '—', tag: 'Eficiencia',
      desc: 'Días promedio que tarda la empresa en pagarle a sus proveedores, calculado como Deudas Comerciales ÷ (Costo de Ventas + Gastos) × días del período. Un DPO más alto significa que la empresa retiene caja por más tiempo antes de pagar.' },
    { label: 'Cash Conversion Cycle', value: ccc !== null ? Math.round(ccc) + ' días' : '—', tag: 'Eficiencia',
      desc: 'Combina el ciclo de cobranza menos el ciclo de pago. Indica cuántos días el negocio necesita financiar con capital propio antes de recuperar el efectivo. Valores negativos son favorables: significa que cobra antes de tener que pagar.' },
    { label: 'Liquidez corriente', value: liquidez !== null ? liquidez.toFixed(2) : '—', tag: 'Solidez financiera',
      desc: 'Activos de corto plazo (caja + créditos) divididos por las deudas de corto plazo (comerciales, sociales y fiscales). Un valor entre 1 y 2 se considera saludable: indica que la empresa puede cubrir sus deudas inmediatas sin dificultad.' },
    { label: 'Solvencia', value: solvencia !== null ? solvencia.toFixed(2) : '—', tag: 'Solidez financiera',
      desc: 'Total de activos (caja, créditos y bienes de uso) dividido por el total de deudas. Mide cuántas veces los activos de la empresa cubren sus obligaciones totales. Valores más altos indican mayor respaldo patrimonial frente a la deuda.' },
    { label: 'Operating CF / Revenue', value: ocfRevenue !== null ? fmtPct(ocfRevenue) : '—', tag: 'Aproximado',
      desc: 'Aproximación del flujo de caja operativo sobre las ventas, estimado como Resultado Neto ajustado por la variación de créditos por cobrar y deudas comerciales. Es una estimación (no un flujo de caja real, ya que el Sheet no separa actividades de inversión/financiamiento) que indica si las ventas se están convirtiendo en caja real.' },
  ];

  document.getElementById('ratio-grid').innerHTML = ratios.map(r => `
    <div class="ratio-card">
      <div class="ratio-head">
        <div class="ratio-label">${r.label}</div>
        <div class="info-icon">i</div>
      </div>
      <div class="ratio-val">${r.value}</div>
      <div class="ratio-tag">${r.tag}</div>
      <div class="ratio-tooltip">${r.desc}</div>
    </div>
  `).join('');
}

// ══════════════════════════════════════════════════════════
// TABLA FINANCIERA
// ══════════════════════════════════════════════════════════
function renderFinTable() {
  if (finMonthCols.length === 0) {
    document.getElementById('fin-thead').innerHTML = '';
    document.getElementById('fin-tbody').innerHTML = '<tr><td>Sin datos de posición financiera disponibles para este período.</td></tr>';
    return;
  }
  const idxs = activeIndices();
  const finIdxs = idxs.map(finIndexFor).filter(i => i !== -1);

  const thead = document.getElementById('fin-thead');
  let headHtml = '<tr><th>Concepto</th>';
  finIdxs.forEach(i => headHtml += `<th>${finMonthCols[i].label}</th>`);
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
      const v = getFinValMulti(r.keys, i) * sign;
      const cls = v < 0 ? 'neg' : '';
      rowHtml += `<td class="${cls}">${fmtUSDParens(v)}</td>`;
    });
    rowHtml += '</tr>';
    return rowHtml;
  }).join('');

  // Fila de Total Caja + Patrimonio: usamos el dato real de la fila 68 del Sheet (punto 7),
  // no un cálculo propio, para que coincida exactamente con lo que el contador tiene en la planilla.
  let totalRowHtml = '<tr class="total"><td>Total caja + patrimonio</td>';
  finIdxs.forEach(i => {
    const v = getFinVal('Total Caja + Patrimonio', i);
    totalRowHtml += `<td>${fmtUSDParens(v)}</td>`;
  });
  totalRowHtml += '</tr>';
  tbody.innerHTML += totalRowHtml;
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

const gridColor = 'rgba(255,255,255,.06)';
const textColor = '#9aa4b2';

function renderCharts() {
  const idxs = activeIndices();
  const labels = idxs.map(i => monthCols[i].label);
  const isCompare = idxs.length > 1;

  const ventas = idxs.map(i => getValueAt(dataRows, 'Total Ingresos por Ventas', i));
  const costo  = idxs.map(i => getValueAt(dataRows, 'Total Costo de Ventas', i));
  const bruto  = idxs.map(i => getValueAt(dataRows, 'Resultado Bruto', i));
  const ebitda = idxs.map(i => getValueAt(dataRows, 'EBITDA', i));
  const rneto  = idxs.map(i => getValueAt(dataRows, 'Resultado Neto', i));

  const mb = ventas.map((v,i) => v !== 0 ? +(bruto[i]/v*100).toFixed(1) : 0);
  const me = ventas.map((v,i) => v !== 0 ? +(ebitda[i]/v*100).toFixed(1) : 0);
  const mn = ventas.map((v,i) => v !== 0 ? +(rneto[i]/v*100).toFixed(1) : 0);

  document.getElementById('c1-title').textContent = isCompare
    ? 'Ingresos vs costo vs resultado bruto — comparativa mensual'
    : `Ingresos vs costo vs resultado bruto — ${labels[0]}`;

  destroyChart('c1');
  charts.c1 = new Chart(document.getElementById('c1'), {
    type: 'bar',
    data: { labels, datasets: [
      { label:'Ventas', data: ventas, backgroundColor: COLORS.blue, borderRadius: 3 },
      { label:'Costo', data: costo.map(v => -Math.abs(v)), backgroundColor: COLORS.red, borderRadius: 3 },
      { label:'Res. bruto', data: bruto, backgroundColor: COLORS.green, borderRadius: 3 },
    ]},
    options: baseOpts({ scales: {
      x: { grid: { display:false }, ticks:{ color:textColor } },
      y: { grid: { color:gridColor }, ticks: { color:textColor, callback: v => '$' + (Math.abs(v)/1000).toFixed(0) + 'K' } }
    }})
  });

  destroyChart('c2');
  charts.c2 = new Chart(document.getElementById('c2'), {
    type: 'line',
    data: { labels, datasets: [
      { label:'Margen bruto', data: mb, borderColor: COLORS.green, backgroundColor:'rgba(47,191,143,.10)', tension:.35, fill:true, pointRadius:4 },
      { label:'EBITDA', data: me, borderColor: COLORS.purple, tension:.35, pointRadius:4, borderDash:[5,3] },
      { label:'Res. neto', data: mn, borderColor: COLORS.blue, tension:.35, pointRadius:4, borderDash:[2,3] },
    ]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } } },
      scales: { x:{grid:{display:false}, ticks:{color:textColor}}, y:{grid:{color:gridColor}, ticks:{color:textColor, callback:v=>v+'%'}} }
    }
  });

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
      datasets: [{ data: [Math.abs(gDir), Math.abs(gInd), gImp], backgroundColor: [COLORS.blue, COLORS.purple, COLORS.red], hoverOffset:6, borderColor: '#1a212b', borderWidth: 2 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'65%',
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => ' $' + c.parsed.toLocaleString() } } } }
  });

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
    if (i===9) return COLORS.orange;
    if (i===2||i===5||i===7) return COLORS.purple;
    return v >= 0 ? COLORS.green : COLORS.red;
  });
  destroyChart('c6');
  charts.c6 = new Chart(document.getElementById('c6'), {
    type: 'bar',
    data: { labels: wfL, datasets: [{ data: wfV.map(Math.abs), backgroundColor: wfC, borderRadius: 4 }] },
    options: { responsive:true, maintainAspectRatio:false,
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => { const v = wfV[c.dataIndex]; return ' $' + (v>=0?'':'-') + Math.abs(v).toLocaleString(); } } } },
      scales: {
        x:{grid:{display:false}, ticks:{autoSkip:false, maxRotation:35, font:{size:11}, color:textColor}},
        y:{grid:{color:gridColor}, ticks:{color:textColor, callback:v=>'$'+(v/1000).toFixed(0)+'K'}, position:'left'},
        y2:{position:'right', grid:{display:false}, ticks:{color:textColor, callback:v=>'$'+(v/1000).toFixed(0)+'K'}}
      }
    }
  });

  const allLabels = monthCols.map(c => c.label);
  const allVentas = monthCols.map((c,i) => getValueAt(dataRows, 'Total Ingresos por Ventas', i));
  const allEbitda = monthCols.map((c,i) => getValueAt(dataRows, 'EBITDA', i));
  const allNeto   = monthCols.map((c,i) => getValueAt(dataRows, 'Resultado Neto', i));
  destroyChart('c7');
  charts.c7 = new Chart(document.getElementById('c7'), {
    type: 'line',
    data: { labels: allLabels, datasets: [
      { label:'Ventas', data: allVentas, borderColor: COLORS.blue, backgroundColor:'rgba(43,168,224,.10)', tension:.35, fill:true, pointRadius:4 },
      { label:'EBITDA', data: allEbitda, borderColor: COLORS.purple, tension:.35, pointRadius:4, borderDash:[5,3] },
      { label:'Resultado neto', data: allNeto, borderColor: COLORS.green, tension:.35, pointRadius:4, borderDash:[2,3] },
    ]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => ` ${c.dataset.label}: $${c.parsed.y.toLocaleString()}` } } },
      scales: {
        x:{grid:{display:false}, ticks:{color:textColor}},
        y:{grid:{color:gridColor}, ticks:{color:textColor, callback:v=>'$'+(v/1000).toFixed(0)+'K'}, position:'left'},
        y2:{position:'right', grid:{display:false}, ticks:{color:textColor, callback:v=>'$'+(v/1000).toFixed(0)+'K'}}
      }
    }
  });

  // C5 — Evolución de caja + patrimonio total (histórico completo)
  // Patrimonio total: usamos la fila real "Total Caja + Patrimonio" del Sheet (fila 68), no un cálculo propio
  if (finMonthCols.length > 0) {
    const finLabels = finMonthCols.map(c => c.label);
    const cajaSerie = finMonthCols.map((c,i) => getFinVal('TOTAL', i));
    const patrimonioSerie = finMonthCols.map((c,i) => getFinVal('Total Caja + Patrimonio', i));
    destroyChart('c5');
    charts.c5 = new Chart(document.getElementById('c5'), {
      type: 'bar',
      data: { labels: finLabels, datasets: [
        { label:'Total caja', data: cajaSerie, backgroundColor:'rgba(139,127,214,.75)', borderRadius:3, yAxisID:'y' },
        { label:'Patrimonio total', data: patrimonioSerie, type:'line', borderColor: COLORS.orange, borderWidth:2.5, pointRadius:4, fill:false, tension:.3, yAxisID:'y' },
      ]},
      options: { responsive:true, maintainAspectRatio:false,
        plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => ` ${c.dataset.label}: $${c.parsed.y.toLocaleString()}` } } },
        scales: {
          x: { grid:{display:false}, ticks:{color:textColor} },
          y: { grid:{color:gridColor}, ticks:{color:textColor, callback:v=>'$'+(v/1000).toFixed(0)+'K'}, position:'left' },
          y2: { position:'right', grid:{display:false}, ticks:{color:textColor, callback:v=>'$'+(v/1000).toFixed(0)+'K'} }
        }
      }
    });
  }

  // C11 — Composición de caja: cuentas dinámicas, último mes activo
  const cajaFiLast = finIndexFor(idxs[idxs.length - 1]);
  document.getElementById('c11-title').textContent = cajaFiLast !== -1
    ? `Composición de la caja — ${finMonthCols[cajaFiLast].label}`
    : 'Composición de la caja';
  destroyChart('c11');
  if (cajaFiLast !== -1 && cajaAccounts.length > 0) {
    const cajaData = cajaAccounts.map(acc => Math.abs(getFinVal(acc, cajaFiLast)));
    const cajaTotal = cajaData.reduce((s,v) => s+v, 0);
    const paletteColors = [COLORS.blue, COLORS.green, COLORS.orange, COLORS.purple, COLORS.red,
      '#5bc4de','#a8d98f','#f0b86e','#b3aee8','#e89090',
      '#7ecfc8','#d4c46a'];
    // Tabla de caja
    const cajaTheadEl = document.getElementById('caja-thead');
    const cajaTbodyEl = document.getElementById('caja-tbody');
    cajaTheadEl.innerHTML = `<tr><th>Cuenta</th><th>${finMonthCols[cajaFiLast].label}</th><th>%</th></tr>`;
    cajaTbodyEl.innerHTML = cajaAccounts.map((acc, i) => {
      const v = getFinVal(acc, cajaFiLast);
      const pct = cajaTotal !== 0 ? (Math.abs(v)/cajaTotal*100).toFixed(1) : '0.0';
      return `<tr><td>${acc}</td><td>${fmtUSDParens(v)}</td><td class="pct-cell">${pct}%</td></tr>`;
    }).join('') +
    `<tr class="sub"><td>Total</td><td>${fmtUSDParens(cajaTotal)}</td><td class="pct-cell">100%</td></tr>`;

    charts.c11 = new Chart(document.getElementById('c11'), {
      type: 'doughnut',
      data: {
        labels: cajaAccounts,
        datasets: [{ data: cajaData, backgroundColor: paletteColors.slice(0, cajaAccounts.length), hoverOffset:6, borderColor:'#2a2f37', borderWidth:2 }]
      },
      options: { responsive:true, maintainAspectRatio:false, cutout:'55%',
        plugins: {
          legend: { display:true, position:'right', labels:{ color:textColor, font:{size:11}, padding:10, boxWidth:12 } },
          tooltip: { callbacks:{ label: c => ` ${c.label}: $${c.parsed.toLocaleString()} (${cajaTotal>0?(c.parsed/cajaTotal*100).toFixed(1):0}%)` } }
        }
      }
    });
  }

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
          backgroundColor: ctx => ctx.raw >= 0 ? 'rgba(47,191,143,.8)' : 'rgba(226,96,79,.8)', borderRadius:3 }] },
      options: { responsive:true, maintainAspectRatio:false,
        plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: c => ' $' + c.parsed.y.toLocaleString() } } },
        scales: { x:{grid:{display:false}, ticks:{font:{size:10}, color:textColor}}, y:{grid:{color:gridColor}, ticks:{color:textColor, callback:v=>'$'+(v/1000).toFixed(0)+'K'}} }
      }
    });
  }
}

// ══════════════════════════════════════════════════════════
// INIT — sin auto-refresh; solo al cargar la página o click manual
// ══════════════════════════════════════════════════════════
document.getElementById('reload-btn').addEventListener('click', () => {
  document.getElementById('last-update').textContent = 'Actualizando…';
  fetchData();
});

fetchData();
