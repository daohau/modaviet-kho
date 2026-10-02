function sourceDef_(sourceCode) {
  const found = findOne_(CFG.SHEETS.DATA_SOURCES, 'source_code', sourceCode);
  if (!found) throw new Error('SYNC_CONFIG_MISSING: Chưa cấu hình nguồn ' + sourceCode);
  return found.obj;
}

function sourceSheet_(sourceCode) {
  const def = sourceDef_(sourceCode);
  const fileId = text_(def.file_id), sheetName = text_(def.sheet_name);
  if (!fileId || !sheetName) throw new Error('SYNC_CONFIG_INVALID: Thiếu file_id/sheet_name cho ' + sourceCode);
  const sourceSs = SpreadsheetApp.openById(fileId);
  const sh = sourceSs.getSheetByName(sheetName);
  if (!sh) throw new Error('SYNC_SOURCE_SHEET_MISSING: ' + sourceCode + ' / ' + sheetName);
  return {def, sh};
}

function updateSourceSyncStatus_(sourceCode, status, note) {
  const found = findOne_(CFG.SHEETS.DATA_SOURCES, 'source_code', sourceCode);
  if (!found) return;
  const patch = {'lần đồng bộ gần nhất':new Date(), 'trạng thái đồng bộ':text_(status)};
  if (note) patch.notes = text_(found.obj.notes) + ' | ' + text_(note);
  patchRow_(CFG.SHEETS.DATA_SOURCES, found.row, patch);
}

function replaceSnapshotObjects_(sheetName, objects) {
  const meta = headers_(sheetName);
  const oldLast = Math.max(meta.sh.getLastRow(), CFG.DATA_START_ROW);
  if (oldLast >= CFG.DATA_START_ROW) {
    meta.sh.getRange(CFG.DATA_START_ROW, 1, oldLast - CFG.DATA_START_ROW + 1, meta.lastCol).clearContent();
  }
  if (!objects || !objects.length) return 0;
  ensureRowsForAppend_(meta.sh, CFG.DATA_START_ROW, objects.length);
  const values = objects.map(o => meta.headers.map(h => h ? (Object.prototype.hasOwnProperty.call(o, h) ? o[h] : '') : ''));
  meta.sh.getRange(CFG.DATA_START_ROW, 1, values.length, meta.lastCol).setValues(values);
  return values.length;
}

function sourceValues_(sourceCode, startRow, colCount) {
  const src = sourceSheet_(sourceCode);
  const lastRow = src.sh.getLastRow();
  if (lastRow < startRow) return {def:src.def, rows:[], startRow};
  const rows = src.sh.getRange(startRow, 1, lastRow - startRow + 1, colCount).getValues();
  return {def:src.def, rows, startRow};
}

function executionTypeFrom_(executionCode) {
  const x = code_(executionCode);
  if (x.indexOf('SH') === 0) return 'SH';
  if (x.indexOf('M') === 0) return 'M';
  if (x.indexOf('S') === 0) return 'S';
  return '';
}

function productTypeFrom_(productCode) {
  const seg = text_(productCode).split('-').pop() || '';
  const m = seg.match(/^([A-Za-zÀ-ỹ]+)/);
  return m ? m[1].toUpperCase() : '';
}

function syncOrderProductInternal_() {
  const src = sourceValues_('ORDER_PRODUCT', 3, 11);
  const now = new Date();
  const out = [];
  src.rows.forEach((r, i) => {
    const productCode = text_(r[8]), executionCode = text_(r[3]);
    if (!productCode || !executionCode) return;
    out.push({
      contract_code:text_(r[1]), order_code:text_(r[2]), execution_code:executionCode,
      execution_type:executionTypeFrom_(executionCode), product_code:productCode,
      product_type_code:productTypeFrom_(productCode), product_name:text_(r[4]), gender:text_(r[5]),
      production_qty:num_(r[9]), customer_id:'', customer_name:'', order_name:text_(r[7]), sales_code:'', sales_name:text_(r[0]),
      source_status:'ĐỒNG BỘ', source_updated_at:'', synced_at:now,
      source_row_key:text_(src.def.sheet_name) + '!' + (src.startRow + i)
    });
  });
  const n = replaceSnapshotObjects_(CFG.SHEETS.ORDER_PRODUCT, out);
  updateSourceSyncStatus_('ORDER_PRODUCT', 'OK ('+n+' dòng)');
  return n;
}

function syncDmsxInternal_() {
  const src = sourceValues_('DMSX', 5, 29);
  const now = new Date();
  const out = [];
  src.rows.forEach((r, i) => {
    const execution = text_(r[2]), product = text_(r[4]), material = text_(r[7]);
    if (!execution && !product && !material) return;
    out.push({
      dmsx_date:r[0]||'', pr_code:text_(r[1])||text_(r[27]), execution_code:execution, order_name:text_(r[3]),
      product_code:product, product_name:text_(r[5]), production_qty:num_(r[6]), material_id:material,
      material_name:text_(r[8]), uom:text_(r[9]), material_type:text_(r[10]), fabric_width:r[11]||'',
      bom_qty:num_(r[12]), waste_rate:num_(r[13]), gross_requirement_qty:num_(r[14]), estimated_unit_price:num_(r[15]), estimated_amount:num_(r[16]),
      supplier_display:text_(r[17]), supplier_id:text_(r[19]), required_fabric_date:r[20]||'', required_trim_date:r[21]||'',
      actual_fabric_date_legacy:r[22]||'', fabric_confirm_date_legacy:r[23]||'', actual_trim_date_legacy:r[24]||'', quality_legacy:text_(r[25]),
      order_code:text_(r[26]), status_legacy:text_(r[28]), synced_at:now,
      source_row_key:text_(src.def.sheet_name) + '!' + (src.startRow + i)
    });
  });
  const n = replaceSnapshotObjects_(CFG.SHEETS.DMSX, out);
  updateSourceSyncStatus_('DMSX', 'OK ('+n+' dòng)');
  return n;
}

function existingByKey_(sheetName, keyField) {
  const map = new Map();
  sheetObjects_(sheetName).rows.forEach(r => {
    const k = text_(r.obj[keyField]);
    if (k && !map.has(k)) map.set(k, r.obj);
  });
  return map;
}

function syncMaterialInternal_() {
  const src = sourceValues_('MATERIAL_MASTER', 2, 8);
  const now = new Date(), existing = existingByKey_(CFG.SHEETS.MATERIAL, 'material_id');
  const out = [];
  src.rows.forEach(r => {
    const id = text_(r[1]); if (!id) return;
    const old = existing.get(id) || {};
    out.push({
      material_id:id, material_name:text_(r[5]), uom:text_(r[6]), material_group:text_(r[7]),
      material_type:text_(old.material_type), fabric_name:text_(r[2]), color:text_(r[3]), specification:text_(r[4]), fabric_width:old.fabric_width||'',
      item_class:text_(old.item_class)||CFG.ITEM_CLASS.STOCK, is_active:Object.prototype.hasOwnProperty.call(old,'is_active')?bool_(old.is_active):true,
      source_updated_at:'', synced_at:now
    });
  });
  const n = replaceSnapshotObjects_(CFG.SHEETS.MATERIAL, out);
  updateSourceSyncStatus_('MATERIAL_MASTER', 'OK ('+n+' dòng)');
  return n;
}

function syncSupplierInternal_() {
  const src = sourceValues_('SUPPLIER_MASTER', 2, 10);
  const now = new Date(), existing = existingByKey_(CFG.SHEETS.SUPPLIER, 'supplier_id');
  const out = [];
  src.rows.forEach(r => {
    const id = text_(r[3]); if (!id) return;
    const old = existing.get(id) || {};
    out.push({
      supplier_id:id, supplier_short_code:text_(r[2]), supplier_display_name:text_(r[2]),
      legal_name:text_(old.legal_name), tax_code:text_(old.tax_code), misa_supplier_code:id, misa_supplier_name:text_(r[1]),
      contact_person:text_(old.contact_person), phone:text_(old.phone), bank_account:text_(old.bank_account), bank_name:text_(old.bank_name), account_holder:text_(old.account_holder),
      supplier_group:text_(old.supplier_group), is_active:Object.prototype.hasOwnProperty.call(old,'is_active')?bool_(old.is_active):true,
      source_updated_at:'', synced_at:now
    });
  });
  const n = replaceSnapshotObjects_(CFG.SHEETS.SUPPLIER, out);
  updateSourceSyncStatus_('SUPPLIER_MASTER', 'OK ('+n+' dòng)');
  return n;
}

function nplTrackingStatus_(status) {
  const s = text_(status).toUpperCase().replace(/\s+/g,' ');
  return ['ĐANG MUA NPL','ĐÃ ĐỒNG BỘ NPL','ĐỢI CHỐT VẢI','ĐANG MUA FOB','ĐANG TÁI CHẾ'].indexOf(s) >= 0;
}

function syncActiveBbsxInternal_() {
  const src = sourceValues_('PROGRESS', 7, 14);
  const now = new Date();
  const out = [];
  src.rows.forEach(r => {
    const execution = text_(r[2]), product = text_(r[4]);
    if (!execution || !product) return;
    const status = text_(r[13]);
    out.push({'Mã biên bản':execution, 'Mã sản phẩm':product, 'Nguồn':'ĐANG CHẠY', 'Trạng thái nguồn':status, 'Đồng bộ lúc':now, 'Theo dõi NPL':nplTrackingStatus_(status)});
  });
  const n = replaceSnapshotObjects_(CFG.SHEETS.ACTIVE_BBSX, out);
  updateSourceSyncStatus_('PROGRESS', 'OK ('+n+' dòng)');
  return n;
}

function runSyncPart_(code, fn) {
  try { return {code, ok:true, rows:fn()}; }
  catch (err) {
    try { updateSourceSyncStatus_(code, 'LỖI: ' + (err.message || err)); } catch (_) {}
    logError_('SYNC_'+code, err, code, 'SYNC', '');
    return {code, ok:false, error:String(err.message||err)};
  }
}

function syncAllInternal_() {
  const results = [];
  results.push(runSyncPart_('ORDER_PRODUCT', syncOrderProductInternal_));
  results.push(runSyncPart_('DMSX', syncDmsxInternal_));
  results.push(runSyncPart_('MATERIAL_MASTER', syncMaterialInternal_));
  results.push(runSyncPart_('SUPPLIER_MASTER', syncSupplierInternal_));
  results.push(runSyncPart_('PROGRESS', syncActiveBbsxInternal_));
  SpreadsheetApp.flush();
  return results;
}

function syncAllNow() {
  canAdmin_();
  const lock = LockService.getDocumentLock(); lock.waitLock(30000);
  try {
    const results = syncAllInternal_();
    appendAudit_('SYNC_ALL','SYSTEM','SOURCE_SYNC','', 'Đồng bộ dữ liệu nguồn thủ công','','');
    return {ok:results.every(x=>x.ok), results, status:getSyncStatus_()};
  } finally { lock.releaseLock(); }
}

function scheduledSyncFast() {
  const lock = LockService.getDocumentLock(); if (!lock.tryLock(1000)) return;
  try { runSyncPart_('DMSX', syncDmsxInternal_); runSyncPart_('PROGRESS', syncActiveBbsxInternal_); SpreadsheetApp.flush(); }
  finally { lock.releaseLock(); }
}
function scheduledSyncOrder() {
  const lock = LockService.getDocumentLock(); if (!lock.tryLock(1000)) return;
  try { runSyncPart_('ORDER_PRODUCT', syncOrderProductInternal_); SpreadsheetApp.flush(); }
  finally { lock.releaseLock(); }
}
function scheduledSyncMaster() {
  const lock = LockService.getDocumentLock(); if (!lock.tryLock(1000)) return;
  try { runSyncPart_('MATERIAL_MASTER', syncMaterialInternal_); runSyncPart_('SUPPLIER_MASTER', syncSupplierInternal_); SpreadsheetApp.flush(); }
  finally { lock.releaseLock(); }
}

function installSyncTriggers() {
  canAdmin_();
  const names = ['scheduledSyncFast','scheduledSyncOrder','scheduledSyncMaster'];
  ScriptApp.getProjectTriggers().forEach(t => { if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('scheduledSyncFast').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('scheduledSyncOrder').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('scheduledSyncMaster').timeBased().everyHours(1).create();
  appendAudit_('INSTALL_SYNC_TRIGGERS','SYSTEM','SOURCE_SYNC','', 'Cài trigger đồng bộ 10/15/60 phút','','ACTIVE');
  return {ok:true, triggers:[{handler:'scheduledSyncFast',cadence:'10 phút'},{handler:'scheduledSyncOrder',cadence:'15 phút'},{handler:'scheduledSyncMaster',cadence:'60 phút'}]};
}

function syncSourceCodes_() {
  return ['ORDER_PRODUCT','DMSX','MATERIAL_MASTER','SUPPLIER_MASTER','PROGRESS'];
}

function getSyncStatus_() {
  const allowed = new Set(syncSourceCodes_());
  return sheetObjects_(CFG.SHEETS.DATA_SOURCES).rows.map(r=>r.obj)
    .filter(o=>allowed.has(text_(o.source_code)))
    .map(o=>({
      sourceCode:text_(o.source_code), fileTitle:text_(o.file_title), sheetName:text_(o.sheet_name), mode:text_(o.mode),
      lastSync:clientDateTime_(o['lần đồng bộ gần nhất']), status:text_(o['trạng thái đồng bộ'])
    }));
}

function clientDateTime_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CFG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
  return text_(v);
}
