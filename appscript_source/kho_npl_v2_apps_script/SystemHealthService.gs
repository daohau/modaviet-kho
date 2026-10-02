function requiredErrorLogHeaders_() {
  return ['error_id','timestamp','user_email','function_name','object_type','object_id','client_request_id','error_code','error_message','stack_or_context','status'];
}
function headerNames_(sheetName) { return headers_(sheetName).headers.filter(Boolean).map(String); }
function duplicateMaterialIds_() {
  const counts=new Map(); objectsWhere_(CFG.SHEETS.MATERIAL,o=>text_(o.material_id)).forEach(o=>{const id=text_(o.material_id);counts.set(id,(counts.get(id)||0)+1);});
  return Array.from(counts.entries()).filter(([,n])=>n>1).map(([id,n])=>({materialId:id,count:n}));
}
function activePermissionCount_(){return objectsWhere_(CFG.SHEETS.PERMISSIONS,o=>bool_(o.is_active)&&text_(o.user_email)&&text_(o.role)).length;}
function syncHealth_(){
  const rows=sheetObjects_(CFG.SHEETS.DATA_SOURCES).rows.map(r=>r.obj).filter(o=>['ORDER_PRODUCT','DMSX','MATERIAL_MASTER','SUPPLIER_MASTER','PROGRESS'].indexOf(text_(o.source_code))>=0);
  const bad=rows.filter(o=>{const s=text_(o['trạng thái đồng bộ']).toUpperCase();return !s||s.indexOf('LỖI')>=0;});
  return {total:rows.length,bad:bad.length,detail:bad.map(o=>text_(o.source_code)+': '+text_(o['trạng thái đồng bộ'])).join(' | ')};
}

function systemHealth_() {
  const checks=[]; const add=(code,status,detail)=>checks.push({code,status,detail:text_(detail)}); const ss=ss_();
  const requiredSheets=[CFG.SHEETS.RECEIPT_H,CFG.SHEETS.RECEIPT_L,CFG.SHEETS.ISSUE_H,CFG.SHEETS.ISSUE_L,CFG.SHEETS.RETURN,CFG.SHEETS.ADJUSTMENT,CFG.SHEETS.RESERVATION,CFG.SHEETS.LEDGER,CFG.SHEETS.AUDIT,CFG.SHEETS.ERROR_LOG,CFG.SHEETS.CONFIG,CFG.SHEETS.PERMISSIONS,CFG.SHEETS.DATA_SOURCES,CFG.SHEETS.MATERIAL,CFG.SHEETS.SUPPLIER,CFG.SHEETS.ORDER_PRODUCT,CFG.SHEETS.DMSX,CFG.SHEETS.ACTIVE_BBSX,CFG.SHEETS.PR_OPEN,CFG.SHEETS.STOCK_VIEW,CFG.SHEETS.OPENING_CANDIDATE,CFG.SHEETS.PAYABLE_VIEW,CFG.SHEETS.COST_VIEW,CFG.SHEETS.MATERIAL_STATUS_VIEW];
  const missing=requiredSheets.filter(name=>!ss.getSheetByName(name));
  add('REQUIRED_SHEETS',missing.length?'BLOCK':'PASS',missing.length?('Thiếu: '+missing.join(', ')):(requiredSheets.length+' sheet OK'));

  add('ENVIRONMENT',['THU_NGHIEM','PRODUCTION'].indexOf(CFG.ENVIRONMENT)>=0?'PASS':'BLOCK',CFG.ENVIRONMENT);
  const sourceWrite=String(getConfigValue_('SOURCE_WRITE_ALLOWED','FALSE')).toUpperCase(); add('SOURCE_WRITE_ALLOWED',sourceWrite==='FALSE'?'PASS':'BLOCK',sourceWrite);
  const openingSheetFlag=String(getConfigValue_('OPENING_BALANCE_POST_ENABLED','FALSE')).toUpperCase(); add('OPENING_LOCK',(!CFG.OPENING_POST_ENABLED&&openingSheetFlag==='FALSE')?'PASS':(CFG.ENVIRONMENT==='PRODUCTION'?'WARN':'BLOCK'),'code='+CFG.OPENING_POST_ENABLED+'; config='+openingSheetFlag);
  const codeStatus=text_(getConfigValue_('WEBAPP_CODE_STATUS','')); const codeOk=['CODE_READY','CODE_READY_POST_UAT','RC_READY','FUNCTIONAL_RC_READY'].indexOf(codeStatus)>=0; add('WEBAPP_CODE_STATUS',codeOk?'PASS':'WARN',codeStatus||'EMPTY');
  add('PERMISSIONS',activePermissionCount_()>0?'PASS':'BLOCK',activePermissionCount_()+' quyền đang hoạt động');

  const errorHeaders=new Set(headerNames_(CFG.SHEETS.ERROR_LOG)); const missingErrorHeaders=requiredErrorLogHeaders_().filter(h=>!errorHeaders.has(h)); add('ERROR_LOG_SCHEMA',missingErrorHeaders.length?'BLOCK':'PASS',missingErrorHeaders.length?('Thiếu: '+missingErrorHeaders.join(', ')):'Đủ schema');
  const payableFormula=sh_(CFG.SHEETS.PAYABLE_VIEW).getRange('A5').getFormula(); add('PAYABLE_READ_MODEL',payableFormula?'PASS':'BLOCK',payableFormula?'Đang dẫn xuất từ Phiếu nhập POSTED':'Thiếu công thức');
  const costFormula=sh_(CFG.SHEETS.COST_VIEW).getRange('B5').getFormula(); add('COST_READ_MODEL',costFormula?'PASS':'BLOCK',costFormula?'Đang dẫn xuất từ Xuất/Trả POSTED':'Thiếu công thức');
  const dup=duplicateMaterialIds_(); add('MASTER_DUPLICATES',dup.length?'WARN':'PASS',dup.length?(dup.length+' Mã VT trùng; giao dịch liên quan bị chặn'):'0');
  const sync=syncHealth_(); add('SOURCE_SYNC',sync.bad?'WARN':'PASS',sync.bad?sync.detail:(sync.total+' nguồn snapshot OK'));
  const opening=openingPreflight_(); add('OPENING_CANDIDATE',opening.invalidCount?'WARN':'PASS','candidate='+opening.candidateCount+'; invalid='+opening.invalidCount+'; postEnabled='+opening.postEnabled);

  const blockCount=checks.filter(x=>x.status==='BLOCK').length,warnCount=checks.filter(x=>x.status==='WARN').length;
  return {status:blockCount?'BLOCK':(warnCount?'WARN':'PASS'),blockCount,warnCount,checks,canDeployPilot:blockCount===0,canGoLive:blockCount===0&&warnCount===0&&CFG.ENVIRONMENT==='PRODUCTION'&&opening.postEnabled};
}
