function createReceiptDraft(payload) {
  canWarehouseTransact_();
  payload = payload || {};
  const supplierId = text_(payload.supplierId);
  if (!supplierId) throw new Error('Thiếu NCC');
  const supplier = supplierMap_().get(supplierId);
  if (!supplier) throw new Error('NCC không có trong danh mục: ' + supplierId);

  const selected = Array.isArray(payload.lines) ? payload.lines.filter(x => num_(x.deliveredQty) > 0 || num_(x.acceptedQty) > 0) : [];
  if (!selected.length) throw new Error('Chưa nhập dòng hàng nhận');
  const seenPr = new Set();
  selected.forEach(x => {
    const k = text_(x.prRefKey);
    if (!k) throw new Error('Thiếu pr_ref_key');
    if (seenPr.has(k)) throw new Error('BLOCK_DUPLICATE_PR_LINE: Dòng ĐNMH bị lặp trong cùng phiếu: ' + k);
    seenPr.add(k);
  });

  const prData = sheetObjects_(CFG.SHEETS.PR_OPEN);
  const prMap = new Map(prData.rows.map(r => [text_(r.obj.pr_ref_key), r.obj]));
  const materialMap = materialMap_();
  const receiptId = uuid_('REC');
  const clientId = text_(payload.clientRequestId) || uuid_('REQ');
  const date = parseDateInput_(payload.receiptDate);
  const header = {
    receipt_id: receiptId, receipt_code: '', receipt_date: date,
    supplier_id: supplierId,
    supplier_name_snapshot: text_(supplier.supplier_display_name) || text_(supplier.supplier_short_code),
    delivery_note_no: text_(payload.deliveryNoteNo), invoice_no: '', invoice_date: '',
    delivered_by: text_(payload.deliveredBy), status: 'DRAFT', price_status: 'PROVISIONAL',
    received_by: activeUser_(), posted_by: '', posted_at: '', client_request_id: clientId,
    note: text_(payload.note), created_at: new Date(), updated_at: new Date()
  };
  const lines = selected.map(x => {
    const src = prMap.get(text_(x.prRefKey));
    if (!src) throw new Error('Không tìm thấy dòng ĐNMH: ' + x.prRefKey);
    if (text_(src.supplier_id) !== supplierId) throw new Error('Dòng ĐNMH không thuộc NCC đã chọn');
    if (num_(src.remaining_qty) <= 0) throw new Error('Dòng ĐNMH đã nhận đủ: ' + src.pr_ref_key);
    const m = materialMap.get(text_(src.material_id)) || {};
    if (m.__duplicate) throw new Error('BLOCK_MASTER_DUPLICATE: ' + src.material_id);
    const delivered = num_(x.deliveredQty), accepted = num_(x.acceptedQty);
    const actualPrice = x.actualUnitPrice === '' || x.actualUnitPrice == null ? num_(src.estimated_unit_price) : num_(x.actualUnitPrice);
    return {
      receipt_line_id: uuid_('RL'), receipt_id: receiptId, receipt_code: '',
      pr_ref_key: text_(src.pr_ref_key), pr_code: text_(src.pr_code),
      order_code: text_(src.order_code), execution_code: text_(src.execution_code), product_code: text_(src.product_code),
      material_id: text_(src.material_id), material_name_snapshot: text_(src.material_name), uom_snapshot: text_(src.uom),
      ordered_qty: num_(src.ordered_qty), previous_received_qty: num_(src.received_qty), remaining_before_receipt: num_(src.remaining_qty),
      delivered_qty: delivered, accepted_qty: accepted, rejected_qty: Math.max(delivered - accepted, 0),
      expected_unit_price: num_(src.estimated_unit_price), actual_unit_price: actualPrice, management_amount: accepted * actualPrice,
      quality_status: text_(x.qualityStatus) || 'ACCEPTED', over_receipt_qty: Math.max(accepted - num_(src.remaining_qty), 0),
      over_receipt_reason: text_(x.overReceiptReason), item_class: text_(m.item_class) || 'STOCK', lot_no: text_(x.lotNo),
      note: text_(x.note), validation_status: '', validation_message: '', can_post: '', receipt_status_ref: 'DRAFT'
    };
  });
  const v = validateReceipt_(header, lines);
  if (!v.ok) throw new Error('BLOCK_VALIDATION: ' + v.errors.join(' | '));

  // Validation đã PASS trước khi vào lock; chỉ cấp số chứng từ sau khi xác nhận client_request_id chưa tồn tại.
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const existing = sheetObjects_(CFG.SHEETS.RECEIPT_H).rows.find(r => text_(r.obj.client_request_id) === clientId);
    if (existing) {
      return {
        receiptId: text_(existing.obj.receipt_id),
        receiptCode: text_(existing.obj.receipt_code),
        clientRequestId: clientId,
        lineCount: objectsWhere_(CFG.SHEETS.RECEIPT_L, o => text_(o.receipt_id) === text_(existing.obj.receipt_id)).length,
        idempotentDraft: true
      };
    }
    const code = nextReceiptCodeLocked_();
    header.receipt_code = code;
    lines.forEach(line => { line.receipt_code = code; });
    appendObjects_(CFG.SHEETS.RECEIPT_H, [header]);
    appendObjects_(CFG.SHEETS.RECEIPT_L, lines);
    appendAuditOnce_('CREATE_RECEIPT', 'RECEIPT', receiptId, clientId, 'Tạo phiếu nháp', '', 'DRAFT');
    return {receiptId, receiptCode: code, clientRequestId: clientId, lineCount: lines.length, idempotentDraft: false};
  } finally {
    lock.releaseLock();
  }
}

function postReceipt(receiptId, clientRequestId) {
  canWarehouseTransact_();
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const h = findOne_(CFG.SHEETS.RECEIPT_H, 'receipt_id', receiptId);
    if (!h) throw new Error('Không tìm thấy Phiếu nhập: ' + receiptId);
    const header = h.obj;
    if (text_(header.status) === 'POSTED' && text_(header.client_request_id) === text_(clientRequestId)) {
      return {ok:true, idempotent:true, receiptId, receiptCode:header.receipt_code};
    }
    if (text_(header.status) !== 'DRAFT') throw new Error('Phiếu không ở trạng thái DRAFT. Hiện tại: ' + header.status);
    if (text_(header.client_request_id) !== text_(clientRequestId)) throw new Error('client_request_id không khớp phiếu');
    const dup = clientRequestUsed_(CFG.SHEETS.RECEIPT_H, clientRequestId, 'receipt_id', receiptId);
    if (dup) throw new Error('BLOCK_TRUNG_YEU_CAU: client_request_id đã được dùng cho ' + dup.receipt_id);

    const lineRows = sheetObjects_(CFG.SHEETS.RECEIPT_L).rows.filter(r => text_(r.obj.receipt_id) === text_(receiptId));
    const lines = lineRows.map(r => r.obj);
    const v = validateReceipt_(header, lines);
    if (!v.ok) throw new Error('BLOCK_VALIDATION: ' + v.errors.join(' | '));

    const ledgerKeys = existingKeySet_(CFG.SHEETS.LEDGER, 'ledger_id');
    const missingLines = lines.filter(l => !ledgerKeys.has('LG-' + text_(l.receipt_line_id)));
    const ledgerRows = buildReceiptLedgerRows_(header, missingLines);
    const lg = appendUniqueObjects_(CFG.SHEETS.LEDGER, 'ledger_id', ledgerRows);

    // RA_NGUỒN CÔNG NỢ là read-model công thức, TUYỆT ĐỐI không append trực tiếp từ Web App.
    lineRows.forEach(r => patchRow_(CFG.SHEETS.RECEIPT_L, r.row, {
      validation_status:'OK', validation_message:'', can_post:true, receipt_status_ref:'POSTED'
    }));
    appendAuditOnce_('POST_RECEIPT', 'RECEIPT', receiptId, clientRequestId, 'POST hợp lệ', header.status, 'POSTED');
    patchRow_(CFG.SHEETS.RECEIPT_H, h.row, {
      status:'POSTED', posted_by:activeUser_(), posted_at:new Date(), updated_at:new Date(), post_engine_status:'DA_GHI_SO'
    });
    SpreadsheetApp.flush();
    return {
      ok:true, idempotent:false, receiptId, receiptCode:header.receipt_code,
      ledgerRows:lg.appended, payableReadModel:'RA_NGUỒN CÔNG NỢ'
    };
  } catch(err) {
    logError_('postReceipt', err, receiptId, 'RECEIPT', clientRequestId);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function createAndPostReceipt(payload) {
  const d = createReceiptDraft(payload);
  const p = postReceipt(d.receiptId, d.clientRequestId);
  return Object.assign({}, d, p);
}
