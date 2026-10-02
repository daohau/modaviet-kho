function createReturnDraft(payload) {
  canWarehouseTransact_();
  payload = payload || {};
  const sourceId = text_(payload.sourceIssueLineId);
  const src = findOne_(CFG.SHEETS.ISSUE_L,'issue_line_id',sourceId);
  if (!src) throw new Error('Không tìm thấy dòng xuất nguồn');
  const h = findOne_(CFG.SHEETS.ISSUE_H,'issue_id',src.obj.issue_id);
  if (!h || text_(h.obj.status)!=='POSTED') throw new Error('Phiếu xuất nguồn chưa POSTED');

  const returnId=uuid_('RET'), clientId=text_(payload.clientRequestId)||uuid_('REQ');
  const qty=num_(payload.returnQty), usable=num_(payload.usableQty), scrap=num_(payload.scrapQty);
  const ret={
    return_id:returnId,return_code:'',return_date:parseDateInput_(payload.returnDate),source_issue_line_id:sourceId,
    order_code:text_(h.obj.order_code),execution_code:text_(h.obj.execution_code),product_code:text_(src.obj.product_code),material_id:text_(src.obj.material_id),
    return_qty:qty,unit_cost:num_(src.obj.management_unit_cost),amount:qty*num_(src.obj.management_unit_cost),
    return_condition:usable>0&&scrap>0?'PARTIAL':(usable>0?'USABLE':'SCRAP'),usable_stock_qty:usable,scrap_qty:scrap,
    returned_by:text_(payload.returnedBy),received_by:activeUser_(),status:'DRAFT',posted_at:'',note:text_(payload.note),created_at:new Date(),
    validation_status:'',validation_message:'',line_can_post:'',source_issue_status:'POSTED',client_request_id:clientId,duplicate_request_flag:false,post_engine_status:''
  };
  const v=validateReturnAtPost_(ret);
  if(!v.ok) throw new Error('BLOCK_VALIDATION: '+v.errors.join(' | '));

  const lock=LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const existing=sheetObjects_(CFG.SHEETS.RETURN).rows.find(r=>text_(r.obj.client_request_id)===clientId);
    if(existing) return {returnId:text_(existing.obj.return_id),returnCode:text_(existing.obj.return_code),clientRequestId:clientId,idempotentDraft:true};
    const code=nextReturnCodeLocked_();
    ret.return_code=code;
    appendObjects_(CFG.SHEETS.RETURN,[ret]);
    appendAuditOnce_('CREATE_RETURN','RETURN',returnId,clientId,'Tạo phiếu nháp','','DRAFT');
    return {returnId,returnCode:code,clientRequestId:clientId,idempotentDraft:false};
  } finally {
    lock.releaseLock();
  }
}

function postReturn(returnId,clientRequestId) {
  canWarehouseTransact_();
  const lock=LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const found=findOne_(CFG.SHEETS.RETURN,'return_id',returnId);
    if(!found) throw new Error('Không tìm thấy Phiếu trả');
    const ret=found.obj;
    if(text_(ret.status)==='POSTED'&&text_(ret.client_request_id)===text_(clientRequestId)) return {ok:true,idempotent:true,returnId,returnCode:ret.return_code};
    if(text_(ret.status)!=='DRAFT') throw new Error('Phiếu trả không ở DRAFT');
    if(text_(ret.client_request_id)!==text_(clientRequestId)) throw new Error('client_request_id không khớp');
    const dup=clientRequestUsed_(CFG.SHEETS.RETURN,clientRequestId,'return_id',returnId);
    if(dup) throw new Error('BLOCK_TRUNG_YEU_CAU: '+dup.return_id);
    const v=validateReturnAtPost_(ret);
    if(!v.ok) throw new Error('BLOCK_VALIDATION: '+v.errors.join(' | '));
    const ledgerId='LG-'+returnId;
    const exists=existingKeySet_(CFG.SHEETS.LEDGER,'ledger_id').has(ledgerId);
    const ledger=exists?null:buildReturnLedgerRow_(ret);
    const lg=ledger?appendUniqueObjects_(CFG.SHEETS.LEDGER,'ledger_id',[ledger]):{appended:0};
    appendAuditOnce_('POST_RETURN','RETURN',returnId,clientRequestId,'POST hợp lệ',ret.status,'POSTED');
    patchRow_(CFG.SHEETS.RETURN,found.row,{status:'POSTED',posted_at:new Date(),validation_status:'OK',validation_message:'',line_can_post:true,source_issue_status:'POSTED',post_engine_status:'DA_GHI_SO'});
    SpreadsheetApp.flush();
    return {ok:true,idempotent:false,returnId,returnCode:ret.return_code,ledgerRows:lg.appended};
  } catch(err) {
    logError_('postReturn',err,returnId,'RETURN',clientRequestId);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function createAndPostReturn(payload) {
  const d=createReturnDraft(payload);
  const p=postReturn(d.returnId,d.clientRequestId);
  return Object.assign({},d,p);
}
