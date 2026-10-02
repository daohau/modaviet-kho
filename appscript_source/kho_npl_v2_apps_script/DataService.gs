const DATA_HEADER_CACHE_ = {};

function headers_(sheetName) {
  if (DATA_HEADER_CACHE_[sheetName]) return DATA_HEADER_CACHE_[sheetName];
  const sh = sh_(sheetName);
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(CFG.HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];
  const map = {};
  headers.forEach((h, i) => { if (h) map[h] = i; });
  const meta = {sh, headers, map, lastCol};
  DATA_HEADER_CACHE_[sheetName] = meta;
  return meta;
}

function rowObject_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { if (h) obj[h] = row[i]; });
  return obj;
}

function lastKeyDataRow_(sh) {
  const lastUsed = sh.getLastRow();
  if (lastUsed < CFG.DATA_START_ROW) return CFG.DATA_START_ROW - 1;
  if (text_(sh.getRange(lastUsed, 1).getDisplayValue())) return lastUsed;
  const count = lastUsed - CFG.DATA_START_ROW + 1;
  const vals = sh.getRange(CFG.DATA_START_ROW, 1, count, 1).getDisplayValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (text_(vals[i][0])) return CFG.DATA_START_ROW + i;
  }
  return CFG.DATA_START_ROW - 1;
}

function sheetObjects_(sheetName) {
  const meta = headers_(sheetName);
  const lastRow = lastKeyDataRow_(meta.sh);
  if (lastRow < CFG.DATA_START_ROW) return {meta, rows:[]};
  const values = meta.sh.getRange(CFG.DATA_START_ROW, 1, lastRow - CFG.DATA_START_ROW + 1, meta.lastCol).getValues();
  const rows = values.map((r, i) => ({obj: rowObject_(meta.headers, r), row: CFG.DATA_START_ROW + i}));
  return {meta, rows};
}

function ensureRowsForAppend_(sh, startRow, count) {
  const neededLastRow = startRow + count - 1;
  const maxRows = sh.getMaxRows();
  if (neededLastRow <= maxRows) return;
  sh.insertRowsAfter(maxRows, Math.max(neededLastRow - maxRows, 100));
}

function appendObjects_(sheetName, objects) {
  if (!objects || !objects.length) return [];
  const meta = headers_(sheetName);
  const start = Math.max(lastKeyDataRow_(meta.sh) + 1, CFG.DATA_START_ROW);
  ensureRowsForAppend_(meta.sh, start, objects.length);
  const values = objects.map(o => meta.headers.map(h => h ? (Object.prototype.hasOwnProperty.call(o, h) ? o[h] : '') : ''));
  meta.sh.getRange(start, 1, values.length, meta.lastCol).setValues(values);
  return objects.map((_, i) => start + i);
}

function patchRow_(sheetName, row, patch) {
  const meta = headers_(sheetName);
  const updates = Object.keys(patch).map(key => ({key, col:meta.map[key]})).filter(x => x.col !== undefined).sort((a,b)=>a.col-b.col);
  if (!updates.length) return;
  const groups=[];
  updates.forEach(x=>{
    const g=groups[groups.length-1];
    if (!g || x.col !== g[g.length-1].col + 1) groups.push([x]);
    else g.push(x);
  });
  groups.forEach(g=>{
    meta.sh.getRange(row, g[0].col + 1, 1, g.length).setValues([g.map(x=>patch[x.key])]);
  });
}

function patchRowsWhere_(sheetName, field, value, patch) {
  const data = sheetObjects_(sheetName);
  let count = 0;
  data.rows.forEach(r => {
    if (String(r.obj[field] ?? '') !== String(value ?? '')) return;
    patchRow_(sheetName, r.row, patch);
    count++;
  });
  return count;
}

function findOne_(sheetName, field, value) {
  const data = sheetObjects_(sheetName);
  return data.rows.find(r => String(r.obj[field] ?? '') === String(value ?? '')) || null;
}

function objectsWhere_(sheetName, predicate) {
  return sheetObjects_(sheetName).rows.filter(r => predicate(r.obj)).map(r => r.obj);
}

function clientRequestUsed_(sheetName, clientRequestId, idField, currentId) {
  if (!clientRequestId) return null;
  const data = sheetObjects_(sheetName);
  return data.rows.map(r => r.obj).find(o =>
    String(o.client_request_id || '') === String(clientRequestId) &&
    String(o[idField] || '') !== String(currentId || '')
  ) || null;
}

function parseDateInput_(value) {
  if (value instanceof Date) return value;
  if (!value) return new Date();
  const s = String(value).trim();
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new Error('Ngày không hợp lệ: ' + value);
  return d;
}

function clientDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, CFG.TIMEZONE, 'dd/MM/yyyy');
  }
  return text_(v);
}

function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function text_(v) { return v == null ? '' : String(v).trim(); }
function code_(v) { return text_(v).toUpperCase(); }
function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1'; }

function getConfigValue_(key, fallback) {
  const rows = objectsWhere_(CFG.SHEETS.CONFIG, o => text_(o.config_key) === key && text_(o.status) === 'ACTIVE');
  return rows.length ? rows[0].config_value : fallback;
}

function existingKeySet_(sheetName, keyField) {
  const set = new Set();
  sheetObjects_(sheetName).rows.forEach(r => { const k=text_(r.obj[keyField]); if(k)set.add(k); });
  return set;
}

function appendUniqueObjects_(sheetName, keyField, objects) {
  if(!objects || !objects.length) return {appended:0, skipped:0};
  const existing=existingKeySet_(sheetName,keyField); const fresh=[];
  objects.forEach(o=>{const k=text_(o[keyField]); if(!k)throw new Error('Thiếu khóa '+keyField+' khi append '+sheetName); if(!existing.has(k)){fresh.push(o);existing.add(k);}});
  appendObjects_(sheetName,fresh); return {appended:fresh.length, skipped:objects.length-fresh.length};
}
