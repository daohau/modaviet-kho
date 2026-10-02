function openingReady_(status) {
  const s=text_(status).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
  return ['SAN SANG POST','SAN_SANG_POST','READY','READY TO POST'].indexOf(s)>=0;
}

function openingPreflight_(){
  const rows=sheetObjects_(CFG.SHEETS.OPENING_CANDIDATE).rows.filter(r=>text_(r.obj.material_id));
  const candidates=rows.map(r=>r.obj).filter(o=>!bool_(o.posted_flag));
  const invalid=candidates.filter(o=>!openingReady_(o.ready_status)||num_(o.approved_qty)<0||num_(o.approved_unit_cost)<0||!text_(o.approved_by)||!o.approved_at);
  const counts=new Map();
  candidates.forEach(o=>{ const id=code_(o.material_id); if(id) counts.set(id,(counts.get(id)||0)+1); });
  const duplicateMaterials=Array.from(counts.entries()).filter(([,n])=>n>1).map(([id,n])=>({materialId:id,count:n}));
  const codeFlag=!!CFG.OPENING_POST_ENABLED;
  const configFlag=bool_(getConfigValue_('OPENING_BALANCE_POST_ENABLED','FALSE'));
  const mode=text_(getConfigValue_('PILOT_TRANSACTION_MODE','SHADOW_ONLY'));
  return {
    candidateCount:candidates.length, invalidCount:invalid.length,
    duplicateMaterialCount:duplicateMaterials.length, duplicateMaterials:duplicateMaterials.slice(0,20),
    totalQty:candidates.reduce((s,o)=>s+num_(o.approved_qty),0), totalValue:candidates.reduce((s,o)=>s+num_(o.approved_value||num_(o.approved_qty)*num_(o.approved_unit_cost)),0),
    codeEnabled:codeFlag, configEnabled:configFlag, transactionMode:mode,
    postEnabled:codeFlag&&configFlag&&CFG.ENVIRONMENT==='PRODUCTION'&&mode==='PRODUCTION'
  };
}

function postOpeningBalance(payload){
  canAdmin_(); payload=payload||{};
  const pf=openingPreflight_();
  if(!pf.postEnabled) throw new Error('OPENING_BALANCE_LOCKED: Tồn đầu vẫn đang khóa. Cần ENVIRONMENT=PRODUCTION + code flag + config flag + transaction mode PRODUCTION.');
  if(pf.invalidCount) throw new Error('OPENING_BALANCE_INVALID: Còn '+pf.invalidCount+' dòng chưa đủ điều kiện duyệt.');
  if(pf.duplicateMaterialCount) throw new Error('OPENING_BALANCE_DUPLICATE: Có '+pf.duplicateMaterialCount+' Mã VT bị trùng trong danh sách tồn đầu. Phải xử lý trùng trước khi POST.');
  if(text_(payload.confirmText)!=='XAC NHAN CUTOVER MODAVIET') throw new Error('OPENING_CONFIRM_REQUIRED: Thiếu câu xác nhận cutover chính xác.');
  const clientId=text_(payload.clientRequestId)||uuid_('REQ');
  const lock=LockService.getDocumentLock(); lock.waitLock(30000);
  try{
    const already=objectsWhere_(CFG.SHEETS.LEDGER,o=>text_(o.transaction_type)==='OPENING_BALANCE');
    if(already.length) return {ok:true,idempotent:true,batchCode:text_(already[0].document_code),ledgerRows:already.length};
    const rows=sheetObjects_(CFG.SHEETS.OPENING_CANDIDATE).rows.filter(r=>text_(r.obj.material_id)&&!bool_(r.obj.posted_flag)&&openingReady_(r.obj.ready_status));
    if(!rows.length) throw new Error('Không có dòng tồn đầu sẵn sàng POST');
    const batch=nextOpeningBatchCodeLocked_(), date=parseDateInput_(rows[0].obj.cutoff_date||new Date()), balances=new Map(), ledger=[];
    rows.forEach(r=>{
      const o=r.obj, id=text_(o.material_id), qty=num_(o.approved_qty), unitCost=num_(o.approved_unit_cost);
      if(qty<0||unitCost<0) throw new Error('Dòng tồn đầu không hợp lệ: '+id);
      if(qty<=0) { patchRow_(CFG.SHEETS.OPENING_CANDIDATE,r.row,{posted_flag:true,post_batch_id:batch,posted_at:new Date()}); return; }
      const amount=qty*unitCost; balances.set(id,{qty,value:amount,avg:unitCost});
      ledger.push({ledger_id:'LG-'+batch+'-'+id,posted_at:new Date(),transaction_date:date,transaction_type:'OPENING_BALANCE',transaction_id:batch,transaction_line_id:'OB-'+id,document_code:batch,material_id:id,qty_in:qty,qty_out:0,unit_cost:unitCost,amount_in:amount,amount_out:0,running_qty:qty,running_value:amount,avg_cost_after:unitCost,order_code:'',execution_code:'',product_code:'',supplier_id:'',pr_code:'',created_by:activeUser_(),source_environment:CFG.ENVIRONMENT,source_client_request_id:clientId});
      patchRow_(CFG.SHEETS.OPENING_CANDIDATE,r.row,{posted_flag:true,post_batch_id:batch,posted_at:new Date()});
    });
    appendUniqueObjects_(CFG.SHEETS.LEDGER,'ledger_id',ledger);
    appendAuditOnce_('POST_OPENING_BALANCE','OPENING_BALANCE',batch,clientId,'Cutover tồn đầu chính thức','','POSTED');
    SpreadsheetApp.flush();
    return {ok:true,idempotent:false,batchCode:batch,ledgerRows:ledger.length,totalQty:pf.totalQty,totalValue:pf.totalValue};
  } finally{lock.releaseLock();}
}
