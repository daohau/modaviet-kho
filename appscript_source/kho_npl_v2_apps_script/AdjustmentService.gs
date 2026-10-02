function currentBalanceFor_(materialId, balances) {
  const b = (balances || getCurrentBalances_()).get(text_(materialId)) || {qty:0,value:0,avg:0};
  return {qty:num_(b.qty),value:num_(b.value),avg:num_(b.avg)};
}

function appendLedgerMovementFromBalance_(balances, movement) {
  const material=text_(movement.material_id), prev=currentBalanceFor_(material,balances);
  const qtyIn=num_(movement.qty_in), qtyOut=num_(movement.qty_out), unitCost=num_(movement.unit_cost);
  if(qtyOut>prev.qty+1e-9) throw new Error('BLOCK_AM_KHO: '+material+' chỉ còn '+prev.qty+', yêu cầu giảm '+qtyOut);
  const amountIn=qtyIn*unitCost, amountOut=qtyOut*unitCost;
  const nextQty=prev.qty+qtyIn-qtyOut, nextValue=prev.value+amountIn-amountOut;
  if(nextQty< -1e-9) throw new Error('BLOCK_AM_KHO: '+material);
  if(nextQty===0 && Math.abs(nextValue)<1) { /* normalize */ }
  const normQty=Math.abs(nextQty)<1e-9?0:nextQty;
  const normValue=Math.abs(nextValue)<1e-6?0:nextValue;
  const avg=normQty?normValue/normQty:0;
  balances.set(material,{qty:normQty,value:normValue,avg});
  const row={
    ledger_id:text_(movement.ledger_id),posted_at:new Date(),transaction_date:movement.transaction_date,
    transaction_type:text_(movement.transaction_type),transaction_id:text_(movement.transaction_id),transaction_line_id:text_(movement.transaction_line_id),document_code:text_(movement.document_code),
    material_id:material,qty_in:qtyIn,qty_out:qtyOut,unit_cost:unitCost,amount_in:amountIn,amount_out:amountOut,
    running_qty:normQty,running_value:normValue,avg_cost_after:avg,
    order_code:text_(movement.order_code),execution_code:text_(movement.execution_code),product_code:text_(movement.product_code),supplier_id:text_(movement.supplier_id),pr_code:text_(movement.pr_code),
    created_by:activeUser_(),source_environment:CFG.ENVIRONMENT,source_client_request_id:text_(movement.client_request_id)
  };
  return row;
}

function getAdjustmentMaterialContext_(materialId) {
  canAdjustStock_();
  const id=code_(materialId);
  if(!id) throw new Error('Thiếu Mã vật tư');
  const mats=materialMap_(), m=mats.get(id);
  if(!m) throw new Error('Không tìm thấy Mã vật tư: '+id);
  if(m.__duplicate) throw new Error('BLOCK_MASTER_DUPLICATE: '+id);
  if(text_(m.item_class)!==CFG.ITEM_CLASS.STOCK) throw new Error('Chỉ điều chỉnh tồn cho vật tư STOCK');
  const b=currentBalanceFor_(id);
  return {materialId:id,materialName:text_(m.material_name),uom:text_(m.uom),onHand:b.qty,avgCost:b.avg,stockValue:b.value};
}

function createAndPostAdjustment(payload) {
  canAdjustStock_(); payload=payload||{};
  const material=code_(payload.materialId), type=code_(payload.adjustmentType), qty=num_(payload.qty), reasonCode=code_(payload.reasonCode), reasonDetail=text_(payload.reasonDetail), clientId=text_(payload.clientRequestId)||uuid_('REQ');
  if(['IN','OUT'].indexOf(type)<0) throw new Error('Loại điều chỉnh phải là IN hoặc OUT');
  if(qty<=0) throw new Error('SL điều chỉnh phải > 0');
  if(!reasonCode||!reasonDetail) throw new Error('Phải chọn lý do và ghi diễn giải điều chỉnh');
  const ctx=getAdjustmentMaterialContext_(material);
  if(type==='OUT'&&qty>ctx.onHand+1e-9) throw new Error('BLOCK_AM_KHO: '+material+' chỉ còn '+ctx.onHand);
  let unitCost=type==='OUT'?ctx.avgCost:(num_(payload.unitCost)||ctx.avgCost);
  if(unitCost<0) throw new Error('Đơn giá điều chỉnh không hợp lệ');
  if(type==='IN'&&unitCost<=0) throw new Error('Điều chỉnh tăng khi chưa có giá BQ phải nhập đơn giá quản trị > 0');

  const lock=LockService.getDocumentLock(); lock.waitLock(30000);
  try {
    const existing=sheetObjects_(CFG.SHEETS.ADJUSTMENT).rows.find(r=>text_(r.obj.client_request_id)===clientId&&text_(r.obj.status)==='POSTED');
    if(existing) return {ok:true,idempotent:true,adjustmentCode:text_(existing.obj.adjustment_code),adjustmentId:text_(existing.obj.adjustment_id)};
    const balances=getCurrentBalances_(), fresh=currentBalanceFor_(material,balances);
    if(type==='OUT'&&qty>fresh.qty+1e-9) throw new Error('BLOCK_AM_KHO: '+material+' chỉ còn '+fresh.qty);
    if(type==='OUT') unitCost=fresh.avg;
    const id=uuid_('ADJ'), code=nextAdjustmentCodeLocked_(), date=parseDateInput_(payload.adjustmentDate), amount=qty*unitCost;
    const row={adjustment_id:id,adjustment_code:code,adjustment_date:date,material_id:material,adjustment_type:type,qty,unit_cost:unitCost,amount,
      reason_code:reasonCode,reason_detail:reasonDetail,reference_transaction_id:'',requested_by:activeUser_(),approved_by:activeUser_(),status:'POSTED',posted_by:activeUser_(),posted_at:new Date(),note:text_(payload.note),created_at:new Date(),
      validation_status:'OK',validation_message:'',can_post:true,stock_before:fresh.qty,client_request_id:clientId,duplicate_request_flag:false,post_engine_status:'DA_GHI_SO',source_environment:CFG.ENVIRONMENT,reversal_check:'',reversal_message:'',reference_status_snapshot:''};
    const ledger=appendLedgerMovementFromBalance_(balances,{ledger_id:'LG-'+id,transaction_date:date,transaction_type:type==='IN'?'DIEU_CHINH_TANG':'DIEU_CHINH_GIAM',transaction_id:id,transaction_line_id:id,document_code:code,material_id:material,qty_in:type==='IN'?qty:0,qty_out:type==='OUT'?qty:0,unit_cost:unitCost,client_request_id:clientId});
    appendObjects_(CFG.SHEETS.ADJUSTMENT,[row]); appendUniqueObjects_(CFG.SHEETS.LEDGER,'ledger_id',[ledger]);
    appendAuditOnce_('POST_ADJUSTMENT','ADJUSTMENT',id,clientId,reasonDetail,'',type+' '+qty);
    SpreadsheetApp.flush();
    return {ok:true,idempotent:false,adjustmentId:id,adjustmentCode:code,materialId:material,qty,type,stockAfter:ledger.running_qty,avgCostAfter:ledger.avg_cost_after};
  } catch(err){logError_('createAndPostAdjustment',err,'','ADJUSTMENT',clientId);throw err;}
  finally{lock.releaseLock();}
}

function findReversalDocument_(documentCode) {
  const code=code_(documentCode); if(!code) throw new Error('Thiếu mã chứng từ');
  let h=findOne_(CFG.SHEETS.RECEIPT_H,'receipt_code',code);
  if(h){
    const lines=sheetObjects_(CFG.SHEETS.RECEIPT_L).rows.filter(r=>text_(r.obj.receipt_id)===text_(h.obj.receipt_id)).map(r=>r.obj);
    return {type:'RECEIPT',id:text_(h.obj.receipt_id),code,status:text_(h.obj.status),date:h.obj.receipt_date,header:h.obj,lines};
  }
  h=findOne_(CFG.SHEETS.ISSUE_H,'issue_code',code);
  if(h){
    const lines=sheetObjects_(CFG.SHEETS.ISSUE_L).rows.filter(r=>text_(r.obj.issue_id)===text_(h.obj.issue_id)).map(r=>r.obj);
    return {type:'ISSUE',id:text_(h.obj.issue_id),code,status:text_(h.obj.status),date:h.obj.issue_date,header:h.obj,lines};
  }
  h=findOne_(CFG.SHEETS.RETURN,'return_code',code);
  if(h) return {type:'RETURN',id:text_(h.obj.return_id),code,status:text_(h.obj.status),date:h.obj.return_date,header:h.obj,lines:[h.obj]};
  const adj=sheetObjects_(CFG.SHEETS.ADJUSTMENT).rows.filter(r=>code_(r.obj.adjustment_code)===code);
  if(adj.length) return {type:'ADJUSTMENT',id:code,code,status:adj.every(r=>text_(r.obj.status)==='POSTED')?'POSTED':text_(adj[0].obj.status),date:adj[0].obj.adjustment_date,header:adj[0].obj,lines:adj.map(r=>r.obj)};
  throw new Error('Không tìm thấy chứng từ: '+code);
}


function documentTypeLabel_(type) {
  return ({RECEIPT:'Nhập kho',ISSUE:'Xuất kho',RETURN:'Trả NPL',ADJUSTMENT:'Điều chỉnh / Đảo'})[text_(type)] || text_(type);
}

function adjustmentSourceAction_(adjustmentType) {
  const t=text_(adjustmentType);
  if(['IN','REVERSAL_IN'].indexOf(t)>=0) return 'TĂNG TỒN';
  if(['OUT','REVERSAL_OUT'].indexOf(t)>=0) return 'GIẢM TỒN';
  return t || '-';
}

function uniqueText_(values) {
  const out=[]; const seen=new Set();
  (values||[]).forEach(v=>{const x=text_(v); if(x&&!seen.has(x)){seen.add(x);out.push(x);}});
  return out;
}

function documentOriginalAction_(doc) {
  if(doc.type==='RECEIPT') return 'TĂNG TỒN';
  if(doc.type==='ISSUE') return 'GIẢM TỒN';
  if(doc.type==='RETURN') return 'TĂNG TỒN';
  if(doc.type==='ADJUSTMENT') {
    const acts=uniqueText_(doc.lines.map(l=>adjustmentSourceAction_(l.adjustment_type)));
    return acts.join(' + ') || '-';
  }
  return '-';
}

function documentUser_(doc) {
  const h=doc.header||{};
  if(doc.type==='RECEIPT') return text_(h.posted_by)||text_(h.received_by);
  if(doc.type==='ISSUE') return text_(h.posted_by)||text_(h.issued_by)||text_(h.created_by);
  if(doc.type==='RETURN') return text_(h.received_by)||text_(h.returned_by);
  if(doc.type==='ADJUSTMENT') return text_(h.posted_by)||text_(h.approved_by)||text_(h.requested_by);
  return '';
}

function documentSupplier_(doc) {
  return doc.type==='RECEIPT' ? text_(doc.header.supplier_id) : '';
}

function documentExecutions_(doc) {
  if(doc.type==='RECEIPT') return uniqueText_(doc.lines.map(l=>l.execution_code));
  if(doc.type==='ISSUE') return uniqueText_([doc.header.execution_code].concat(doc.lines.map(l=>l.execution_code)));
  if(doc.type==='RETURN') return uniqueText_(doc.lines.map(l=>l.execution_code));
  return [];
}

function documentMaterials_(doc) {
  return uniqueText_(doc.lines.map(l=>l.material_id));
}

function documentQtySummary_(doc) {
  if(doc.type==='RECEIPT') return doc.lines.reduce((a,l)=>a+num_(l.accepted_qty),0);
  if(doc.type==='ISSUE') return doc.lines.reduce((a,l)=>a+num_(l.issue_qty),0);
  if(doc.type==='RETURN') return doc.lines.reduce((a,l)=>a+num_(l.return_qty),0);
  if(doc.type==='ADJUSTMENT') return doc.lines.reduce((a,l)=>a+num_(l.qty),0);
  return 0;
}

function documentDateValue_(doc) {
  try { return parseDateInput_(doc.date).getTime(); } catch(_) { return 0; }
}

function normalizedDocument_(doc) {
  const mats=documentMaterials_(doc), execs=documentExecutions_(doc);
  return {
    documentCode:doc.code,
    documentType:doc.type,
    documentTypeLabel:documentTypeLabel_(doc.type),
    date:clientDate_(doc.date),
    dateValue:documentDateValue_(doc),
    status:text_(doc.status),
    originalAction:documentOriginalAction_(doc),
    executionCode:execs.join(', '),
    supplierId:documentSupplier_(doc),
    materialIds:mats,
    materialSummary:mats.slice(0,3).join(', ')+(mats.length>3?' +'+(mats.length-3):''),
    qty:documentQtySummary_(doc),
    userEmail:documentUser_(doc),
    canReverse:text_(doc.status)==='POSTED'
  };
}

function collectDocuments_() {
  const docs=[];
  const receiptLines=sheetObjects_(CFG.SHEETS.RECEIPT_L).rows.map(r=>r.obj);
  const receiptById=new Map(); receiptLines.forEach(l=>{const k=text_(l.receipt_id); if(!receiptById.has(k))receiptById.set(k,[]);receiptById.get(k).push(l);});
  sheetObjects_(CFG.SHEETS.RECEIPT_H).rows.forEach(r=>{const h=r.obj;docs.push({type:'RECEIPT',id:text_(h.receipt_id),code:text_(h.receipt_code),status:text_(h.status),date:h.receipt_date,header:h,lines:receiptById.get(text_(h.receipt_id))||[]});});

  const issueLines=sheetObjects_(CFG.SHEETS.ISSUE_L).rows.map(r=>r.obj);
  const issueById=new Map(); issueLines.forEach(l=>{const k=text_(l.issue_id); if(!issueById.has(k))issueById.set(k,[]);issueById.get(k).push(l);});
  sheetObjects_(CFG.SHEETS.ISSUE_H).rows.forEach(r=>{const h=r.obj;docs.push({type:'ISSUE',id:text_(h.issue_id),code:text_(h.issue_code),status:text_(h.status),date:h.issue_date,header:h,lines:issueById.get(text_(h.issue_id))||[]});});

  sheetObjects_(CFG.SHEETS.RETURN).rows.forEach(r=>{const h=r.obj;docs.push({type:'RETURN',id:text_(h.return_id),code:text_(h.return_code),status:text_(h.status),date:h.return_date,header:h,lines:[h]});});

  const adjGroups=new Map();
  sheetObjects_(CFG.SHEETS.ADJUSTMENT).rows.forEach(r=>{const o=r.obj,k=code_(o.adjustment_code);if(!k)return;if(!adjGroups.has(k))adjGroups.set(k,[]);adjGroups.get(k).push(o);});
  adjGroups.forEach((rows,code)=>{const h=rows[0];docs.push({type:'ADJUSTMENT',id:code,code,status:rows.every(x=>text_(x.status)==='POSTED')?'POSTED':text_(h.status),date:h.adjustment_date,header:h,lines:rows});});
  return docs.filter(d=>text_(d.code));
}

function listDocuments_(filters) {
  getUserAccess_();
  filters=filters||{};
  const type=code_(filters.documentType), status=code_(filters.status), exec=code_(filters.executionCode), material=code_(filters.materialId), supplier=code_(filters.supplierId), user=text_(filters.userEmail).toLowerCase(), codeQ=code_(filters.documentCode);
  let from=0,to=Number.MAX_SAFE_INTEGER;
  if(text_(filters.dateFrom)) from=parseDateInput_(filters.dateFrom).setHours(0,0,0,0);
  if(text_(filters.dateTo)) to=parseDateInput_(filters.dateTo).setHours(23,59,59,999);
  const rows=collectDocuments_().map(normalizedDocument_).filter(x=>{
    if(type&&x.documentType!==type)return false;
    if(status&&code_(x.status)!==status)return false;
    if(codeQ&&code_(x.documentCode).indexOf(codeQ)<0)return false;
    if(exec&&code_(x.executionCode).indexOf(exec)<0)return false;
    if(material&&!x.materialIds.some(m=>code_(m).indexOf(material)>=0))return false;
    if(supplier&&code_(x.supplierId).indexOf(supplier)<0)return false;
    if(user&&text_(x.userEmail).toLowerCase().indexOf(user)<0)return false;
    if(x.dateValue<from||x.dateValue>to)return false;
    return true;
  });
  rows.sort((a,b)=>b.dateValue-a.dateValue||String(b.documentCode).localeCompare(String(a.documentCode)));
  return rows.slice(0,Math.max(1,Math.min(num_(filters.limit)||50,100)));
}

function getDocumentDetail_(documentCode) {
  getUserAccess_();
  const doc=findReversalDocument_(documentCode);
  const info=normalizedDocument_(doc);
  const lines=[];
  if(doc.type==='RECEIPT') doc.lines.forEach(l=>lines.push({materialId:text_(l.material_id),materialName:text_(l.material_name_snapshot),executionCode:text_(l.execution_code),productCode:text_(l.product_code),qty:num_(l.accepted_qty),unitCost:num_(l.actual_unit_price),amount:num_(l.management_amount)}));
  if(doc.type==='ISSUE') doc.lines.forEach(l=>lines.push({materialId:text_(l.material_id),materialName:text_(l.material_name_snapshot),executionCode:text_(doc.header.execution_code),productCode:text_(l.product_code),qty:num_(l.issue_qty),unitCost:num_(l.management_unit_cost),amount:num_(l.management_amount)}));
  if(doc.type==='RETURN') doc.lines.forEach(l=>lines.push({materialId:text_(l.material_id),materialName:text_(l.material_id),executionCode:text_(l.execution_code),productCode:text_(l.product_code),qty:num_(l.return_qty),unitCost:num_(l.unit_cost),amount:num_(l.amount)}));
  if(doc.type==='ADJUSTMENT') doc.lines.forEach(l=>lines.push({materialId:text_(l.material_id),materialName:text_(l.material_id),executionCode:'',productCode:'',qty:num_(l.qty),unitCost:num_(l.unit_cost),amount:num_(l.amount),sourceAction:adjustmentSourceAction_(l.adjustment_type),referenceTransactionId:text_(l.reference_transaction_id)}));
  info.lines=lines;
  return info;
}

function getReversalPreview_(documentCode) {
  canAdjustStock_();
  const doc=findReversalDocument_(documentCode);
  const balances=getCurrentBalances_();
  const projected=new Map();
  balances.forEach((v,k)=>projected.set(k,{qty:num_(v.qty),value:num_(v.value),avg:num_(v.avg)}));
  const lines=[];
  const pushLine=(materialId,materialName,qty,sourceDirection,reversalDirection,unitCost)=>{
    const id=text_(materialId), before=currentBalanceFor_(id,projected), q=num_(qty), cost=num_(unitCost);
    let afterQty=before.qty;
    if(reversalDirection==='TĂNG TỒN') afterQty+=q;
    if(reversalDirection==='GIẢM TỒN') afterQty-=q;
    lines.push({materialId:id,materialName:text_(materialName),qty:q,sourceDirection,reversalDirection,direction:reversalDirection,unitCost:cost,stockBefore:before.qty,stockAfter:afterQty});
    projected.set(id,{qty:afterQty,value:before.value+(reversalDirection==='TĂNG TỒN'?q*cost:-q*cost),avg:afterQty?(before.value+(reversalDirection==='TĂNG TỒN'?q*cost:-q*cost))/afterQty:0});
  };
  if(doc.type==='RECEIPT') doc.lines.forEach(l=>{if(text_(l.item_class)===CFG.ITEM_CLASS.STOCK&&num_(l.accepted_qty)>0)pushLine(l.material_id,l.material_name_snapshot,l.accepted_qty,'TĂNG TỒN','GIẢM TỒN',l.actual_unit_price);});
  if(doc.type==='ISSUE') doc.lines.forEach(l=>{if(num_(l.issue_qty)>0)pushLine(l.material_id,l.material_name_snapshot,l.issue_qty,'GIẢM TỒN','TĂNG TỒN',l.management_unit_cost);});
  if(doc.type==='RETURN') doc.lines.forEach(l=>{if(num_(l.usable_stock_qty)>0)pushLine(l.material_id,l.material_id,l.usable_stock_qty,'TĂNG TỒN','GIẢM TỒN',l.unit_cost);});
  if(doc.type==='ADJUSTMENT') doc.lines.forEach(l=>{const increase=['IN','REVERSAL_IN'].indexOf(text_(l.adjustment_type))>=0;pushLine(l.material_id,l.material_id,l.qty,increase?'TĂNG TỒN':'GIẢM TỒN',increase?'GIẢM TỒN':'TĂNG TỒN',l.unit_cost);});
  return {documentType:doc.type,documentTypeLabel:documentTypeLabel_(doc.type),documentId:doc.id,documentCode:doc.code,status:doc.status,date:clientDate_(doc.date),originalAction:documentOriginalAction_(doc),lines,canReverse:doc.status==='POSTED'};
}

function ensureReceiptReversalSafe_(doc) {
  const ledger=sheetObjects_(CFG.SHEETS.LEDGER).rows;
  doc.lines.forEach(l=>{
    if(text_(l.item_class)!==CFG.ITEM_CLASS.STOCK||num_(l.accepted_qty)<=0)return;
    const id='LG-'+text_(l.receipt_line_id); const src=ledger.find(r=>text_(r.obj.ledger_id)===id);
    if(!src) throw new Error('Không tìm thấy Sổ kho gốc cho '+id);
    const later=ledger.some(r=>r.row>src.row&&text_(r.obj.material_id)===text_(l.material_id)&&text_(r.obj.transaction_id)!==text_(doc.id));
    if(later) throw new Error('BLOCK_REVERSAL_RECEIPT: Vật tư '+l.material_id+' đã có giao dịch sau phiếu nhập này. Hãy dùng Điều chỉnh tồn thay vì đảo phiếu.');
  });
}

function ensureIssueReversalSafe_(doc) {
  const lineIds=new Set(doc.lines.map(l=>text_(l.issue_line_id)));
  const postedReturns=objectsWhere_(CFG.SHEETS.RETURN,o=>text_(o.status)==='POSTED'&&lineIds.has(text_(o.source_issue_line_id)));
  if(postedReturns.length) throw new Error('BLOCK_REVERSAL_ISSUE: Phiếu xuất đã có Phiếu trả NPL. Hãy đảo Phiếu trả trước.');
}

function ensureAdjustmentReversalSafe_(doc) {
  const ledger=sheetObjects_(CFG.SHEETS.LEDGER).rows;
  doc.lines.forEach(l=>{
    const t=text_(l.adjustment_type);
    // Điều chỉnh tăng đã đưa thêm tồn vào kho. Nếu sau đó vật tư đã phát sinh
    // giao dịch khác thì không thể biết phần tồn tăng này còn nguyên hay đã được
    // sử dụng. Chặn đảo lịch sử và yêu cầu tạo điều chỉnh hiện tại để bảo toàn
    // giá bình quân/audit.
    if(['IN','REVERSAL_IN'].indexOf(t)<0) return;
    const id='LG-'+text_(l.adjustment_id);
    const src=ledger.find(r=>text_(r.obj.ledger_id)===id);
    if(!src) throw new Error('Không tìm thấy Sổ kho gốc cho '+id);
    const later=ledger.some(r=>
      r.row>src.row &&
      text_(r.obj.material_id)===text_(l.material_id) &&
      text_(r.obj.transaction_id)!==text_(l.adjustment_id)
    );
    if(later) throw new Error('BLOCK_REVERSAL_ADJUSTMENT: Vật tư '+l.material_id+' đã có giao dịch sau điều chỉnh tăng này. Hãy tạo Điều chỉnh tồn hiện tại thay vì đảo chứng từ cũ.');
  });
}

function reversePostedDocument(payload) {
  canAdjustStock_(); payload=payload||{};
  const code=code_(payload.documentCode), reason=text_(payload.reason), clientId=text_(payload.clientRequestId)||uuid_('REQ');
  if(!code||!reason) throw new Error('Phải nhập mã chứng từ và lý do đảo');
  const preview=getReversalPreview_(code);
  if(!preview.canReverse) throw new Error('Chứng từ không ở trạng thái POSTED nên không thể đảo');
  const lock=LockService.getDocumentLock(); lock.waitLock(30000);
  try {
    const prior=objectsWhere_(CFG.SHEETS.ADJUSTMENT,o=>text_(o.client_request_id)===clientId&&text_(o.status)==='POSTED');
    if(prior.length) return {ok:true,idempotent:true,reversalCode:text_(prior[0].adjustment_code)};
    const doc=findReversalDocument_(code); if(doc.status!=='POSTED') throw new Error('Chứng từ đã thay đổi trạng thái: '+doc.status);
    if(doc.type==='RECEIPT') ensureReceiptReversalSafe_(doc);
    if(doc.type==='ISSUE') ensureIssueReversalSafe_(doc);
    if(doc.type==='ADJUSTMENT') {
      ensureAdjustmentReversalSafe_(doc);
      const already=objectsWhere_(CFG.SHEETS.ADJUSTMENT,o=>doc.lines.some(l=>text_(o.reference_transaction_id)===text_(l.adjustment_id))&&text_(o.status)==='POSTED');
      if(already.length) throw new Error('Giao dịch điều chỉnh đã được đảo trước đó');
    }
    const balances=getCurrentBalances_(), reversalCode=nextReversalCodeLocked_(), date=new Date(), adjRows=[], ledgerRows=[];
    const addMovement=(origId,material,qty,direction,unitCost,meta)=>{
      const adjId=uuid_('RV');
      const before=currentBalanceFor_(material,balances);
      const ledger=appendLedgerMovementFromBalance_(balances,{ledger_id:'LG-'+adjId,transaction_date:date,transaction_type:'DAO_'+doc.type,transaction_id:adjId,transaction_line_id:adjId,document_code:reversalCode,material_id:material,qty_in:direction==='IN'?qty:0,qty_out:direction==='OUT'?qty:0,unit_cost:unitCost,order_code:meta.orderCode,execution_code:meta.executionCode,product_code:meta.productCode,supplier_id:meta.supplierId,pr_code:meta.prCode,client_request_id:clientId});
      adjRows.push({adjustment_id:adjId,adjustment_code:reversalCode,adjustment_date:date,material_id:material,adjustment_type:direction==='IN'?'REVERSAL_IN':'REVERSAL_OUT',qty,unit_cost:unitCost,amount:qty*unitCost,reason_code:'DATA_ERROR',reason_detail:reason,reference_transaction_id:origId,requested_by:activeUser_(),approved_by:activeUser_(),status:'POSTED',posted_by:activeUser_(),posted_at:new Date(),note:'Đảo '+code,created_at:new Date(),validation_status:'OK',validation_message:'',can_post:true,stock_before:before.qty,client_request_id:clientId,duplicate_request_flag:false,post_engine_status:'DA_GHI_SO',source_environment:CFG.ENVIRONMENT,reversal_check:'OK',reversal_message:'',reference_status_snapshot:'POSTED'});
      ledgerRows.push(ledger);
    };
    if(doc.type==='RECEIPT') doc.lines.forEach(l=>{if(text_(l.item_class)===CFG.ITEM_CLASS.STOCK&&num_(l.accepted_qty)>0)addMovement(text_(l.receipt_line_id),text_(l.material_id),num_(l.accepted_qty),'OUT',num_(l.actual_unit_price),{orderCode:l.order_code,executionCode:l.execution_code,productCode:l.product_code,supplierId:doc.header.supplier_id,prCode:l.pr_code});});
    if(doc.type==='ISSUE') doc.lines.forEach(l=>{if(num_(l.issue_qty)>0)addMovement(text_(l.issue_line_id),text_(l.material_id),num_(l.issue_qty),'IN',num_(l.management_unit_cost),{orderCode:doc.header.order_code,executionCode:doc.header.execution_code,productCode:l.product_code});});
    if(doc.type==='RETURN') doc.lines.forEach(l=>{if(num_(l.usable_stock_qty)>0)addMovement(text_(l.return_id),text_(l.material_id),num_(l.usable_stock_qty),'OUT',num_(l.unit_cost),{orderCode:l.order_code,executionCode:l.execution_code,productCode:l.product_code});});
    if(doc.type==='ADJUSTMENT') doc.lines.forEach(l=>{const increase=['IN','REVERSAL_IN'].indexOf(text_(l.adjustment_type))>=0;addMovement(text_(l.adjustment_id),text_(l.material_id),num_(l.qty),increase?'OUT':'IN',num_(l.unit_cost),{});});
    appendObjects_(CFG.SHEETS.ADJUSTMENT,adjRows); appendUniqueObjects_(CFG.SHEETS.LEDGER,'ledger_id',ledgerRows);
    if(doc.type==='RECEIPT'){
      const h=findOne_(CFG.SHEETS.RECEIPT_H,'receipt_id',doc.id); patchRow_(CFG.SHEETS.RECEIPT_H,h.row,{status:'REVERSED',updated_at:new Date(),post_engine_status:'DA_DAO'});
      sheetObjects_(CFG.SHEETS.RECEIPT_L).rows.filter(r=>text_(r.obj.receipt_id)===doc.id).forEach(r=>patchRow_(CFG.SHEETS.RECEIPT_L,r.row,{receipt_status_ref:'REVERSED'}));
    }
    if(doc.type==='ISSUE'){
      const h=findOne_(CFG.SHEETS.ISSUE_H,'issue_id',doc.id); patchRow_(CFG.SHEETS.ISSUE_H,h.row,{status:'REVERSED',post_engine_status:'DA_DAO'});
      const ids=[]; sheetObjects_(CFG.SHEETS.ISSUE_L).rows.filter(r=>text_(r.obj.issue_id)===doc.id).forEach(r=>{ids.push(text_(r.obj.reservation_id));patchRow_(CFG.SHEETS.ISSUE_L,r.row,{issue_status_ref:'REVERSED'});});
      Array.from(new Set(ids.filter(Boolean))).forEach(recalculateReservation_);
    }
    if(doc.type==='RETURN') { const r=findOne_(CFG.SHEETS.RETURN,'return_id',doc.id); patchRow_(CFG.SHEETS.RETURN,r.row,{status:'REVERSED',post_engine_status:'DA_DAO'}); }
    if(doc.type==='ADJUSTMENT') sheetObjects_(CFG.SHEETS.ADJUSTMENT).rows.filter(r=>code_(r.obj.adjustment_code)===code&&text_(r.obj.status)==='POSTED').forEach(r=>patchRow_(CFG.SHEETS.ADJUSTMENT,r.row,{status:'REVERSED',post_engine_status:'DA_DAO'}));
    appendAuditOnce_('REVERSE_'+doc.type,doc.type,doc.id,clientId,reason,'POSTED','REVERSED');
    SpreadsheetApp.flush();
    return {ok:true,idempotent:false,reversalCode,documentCode:code,documentType:doc.type,lineCount:adjRows.length};
  } catch(err){logError_('reversePostedDocument',err,code,'REVERSAL',clientId);throw err;}
  finally{lock.releaseLock();}
}
