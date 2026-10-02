function createIssueDraft(payload) {
  canWarehouseTransact_();
  payload = payload || {};
  const execution = code_(payload.executionCode);
  if (!execution) throw new Error('Thiếu Mã biên bản/BBSX');
  const selected = Array.isArray(payload.lines) ? payload.lines.filter(x => num_(x.issueQty) > 0) : [];
  if (!selected.length) throw new Error('Chưa có dòng xuất');
  const seenReservation = new Set();
  selected.forEach(x => {
    const k = text_(x.reservationId);
    if (!k) throw new Error('Thiếu reservation_id');
    if (seenReservation.has(k)) throw new Error('BLOCK_DUPLICATE_RESERVATION: Reservation bị lặp trong cùng phiếu: ' + k);
    seenReservation.add(k);
  });

  const balances = getCurrentBalances_(), totals = reservationTotalsByMaterial_(), mMap = materialMap_();
  const issueId = uuid_('ISS'), clientId = text_(payload.clientRequestId) || uuid_('REQ');
  const header = {
    issue_id:issueId, issue_code:'', issue_date:parseDateInput_(payload.issueDate),
    issue_type:text_(payload.issueType)||'PRODUCTION', order_code:text_(payload.orderCode)||execution,
    execution_code:execution, department:text_(payload.department)||'SẢN XUẤT', receiver:text_(payload.receiver),
    status:'DRAFT', issued_by:activeUser_(), posted_by:'', posted_at:'', client_request_id:clientId,
    note:text_(payload.note), created_at:new Date()
  };
  const lines = selected.map(x => {
    const res = findReservation_(text_(x.reservationId));
    if (!res) throw new Error('Không tìm thấy Reservation: ' + x.reservationId);
    if (code_(res.obj.execution_code) !== execution) throw new Error('Reservation không thuộc BBSX đã chọn');
    const material = text_(res.obj.material_id), mat = mMap.get(material) || {};
    if (mat.__duplicate) throw new Error('BLOCK_MASTER_DUPLICATE: ' + material);
    const allow = issueAllowance_(material, text_(res.obj.reservation_id), balances, totals), bal = balances.get(material) || {avg:0};
    const qty = num_(x.issueQty);
    return {
      issue_line_id:uuid_('IL'), issue_id:issueId, issue_code:'', product_code:text_(res.obj.product_code),
      material_id:material, material_name_snapshot:text_(mat.material_name)||text_(x.materialName), uom_snapshot:text_(mat.uom)||text_(x.uom),
      bom_required_qty:num_(res.obj.required_qty), previous_issued_qty:num_(res.obj.issued_qty),
      remaining_bom_qty:Math.max(num_(res.obj.required_qty)-num_(res.obj.issued_qty),0),
      physical_stock_before:allow.physical, available_stock_before:allow.allowed, issue_qty:qty,
      management_unit_cost:bal.avg, management_amount:qty*bal.avg,
      variance_vs_bom:Math.max(qty-Math.max(num_(res.obj.required_qty)-num_(res.obj.issued_qty),0),0),
      variance_reason:text_(x.varianceReason), reservation_id:text_(res.obj.reservation_id), note:text_(x.note), created_at:new Date(),
      validation_status:'', validation_message:'', line_can_post:'', issue_status_ref:'DRAFT'
    };
  });
  lines.forEach((line,i)=>{
    const v = validateIssueLineAtPost_(line, balances, totals);
    if (!v.ok) throw new Error('Dòng ' + (i+1) + ': ' + v.errors.join(' | '));
  });

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const existing = sheetObjects_(CFG.SHEETS.ISSUE_H).rows.find(r => text_(r.obj.client_request_id) === clientId);
    if (existing) {
      return {
        issueId:text_(existing.obj.issue_id), issueCode:text_(existing.obj.issue_code), clientRequestId:clientId,
        lineCount:objectsWhere_(CFG.SHEETS.ISSUE_L,o=>text_(o.issue_id)===text_(existing.obj.issue_id)).length,
        idempotentDraft:true
      };
    }
    const code = nextIssueCodeLocked_();
    header.issue_code = code;
    lines.forEach(line => { line.issue_code = code; });
    appendObjects_(CFG.SHEETS.ISSUE_H,[header]);
    appendObjects_(CFG.SHEETS.ISSUE_L,lines);
    appendAuditOnce_('CREATE_ISSUE','ISSUE',issueId,clientId,'Tạo phiếu nháp','','DRAFT');
    return {issueId,issueCode:code,clientRequestId:clientId,lineCount:lines.length,idempotentDraft:false};
  } finally {
    lock.releaseLock();
  }
}

function postIssue(issueId, clientRequestId) {
  canWarehouseTransact_();
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const h = findOne_(CFG.SHEETS.ISSUE_H,'issue_id',issueId);
    if (!h) throw new Error('Không tìm thấy Phiếu xuất: ' + issueId);
    const header = h.obj;
    if (text_(header.status)==='POSTED' && text_(header.client_request_id)===text_(clientRequestId)) {
      return {ok:true,idempotent:true,issueId,issueCode:header.issue_code};
    }
    if (text_(header.status)!=='DRAFT') throw new Error('Phiếu không ở trạng thái DRAFT');
    if (text_(header.client_request_id)!==text_(clientRequestId)) throw new Error('client_request_id không khớp phiếu');
    const dup = clientRequestUsed_(CFG.SHEETS.ISSUE_H,clientRequestId,'issue_id',issueId);
    if (dup) throw new Error('BLOCK_TRUNG_YEU_CAU: ' + dup.issue_id);

    const lineRows = sheetObjects_(CFG.SHEETS.ISSUE_L).rows.filter(r=>text_(r.obj.issue_id)===text_(issueId));
    const lines = lineRows.map(r=>r.obj);
    if (!lines.length) throw new Error('Phiếu không có chi tiết');

    const existingLedgerRows = sheetObjects_(CFG.SHEETS.LEDGER).rows.map(r=>r.obj);
    const ledgerById = new Map(existingLedgerRows.map(o=>[text_(o.ledger_id),o]));
    const missingLines = lines.filter(l=>!ledgerById.has('LG-'+text_(l.issue_line_id)));

    // Retry-safe: chỉ validate các dòng chưa có ledger. Dòng đã có ledger là giao dịch kinh tế đã ghi và cần hoàn tất trạng thái/audit.
    const balances = getCurrentBalances_(), totals = reservationTotalsByMaterial_();
    missingLines.forEach((line,i)=>{
      const v = validateIssueLineAtPost_(line,balances,totals);
      if (!v.ok) throw new Error('Dòng chưa ghi sổ ' + (i+1) + ': ' + v.errors.join(' | '));
    });

    const newLedgerRows = buildIssueLedgerRows_(header,missingLines);
    const lg = appendUniqueObjects_(CFG.SHEETS.LEDGER,'ledger_id',newLedgerRows);
    newLedgerRows.forEach(o=>ledgerById.set(text_(o.ledger_id),o));

    lineRows.forEach((r,i)=>{
      const l=lines[i], ledger=ledgerById.get('LG-'+text_(l.issue_line_id));
      patchRow_(CFG.SHEETS.ISSUE_L,r.row,{
        management_unit_cost:ledger?num_(ledger.unit_cost):num_(l.management_unit_cost),
        management_amount:ledger?num_(ledger.amount_out):num_(l.management_amount),
        validation_status:'OK',validation_message:'',line_can_post:true,issue_status_ref:'POSTED'
      });
    });
    Array.from(new Set(lines.map(l=>text_(l.reservation_id)).filter(Boolean))).forEach(recalculateReservation_);
    appendAuditOnce_('POST_ISSUE','ISSUE',issueId,clientRequestId,'POST hợp lệ',header.status,'POSTED');
    patchRow_(CFG.SHEETS.ISSUE_H,h.row,{status:'POSTED',posted_by:activeUser_(),posted_at:new Date(),post_engine_status:'DA_GHI_SO'});
    SpreadsheetApp.flush();
    return {ok:true,idempotent:false,issueId,issueCode:header.issue_code,ledgerRows:lg.appended};
  } catch(err) {
    logError_('postIssue',err,issueId,'ISSUE',clientRequestId);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function createAndPostIssue(payload) {
  const d=createIssueDraft(payload);
  const p=postIssue(d.issueId,d.clientRequestId);
  return Object.assign({},d,p);
}
