function materialMap_() {
  const map=new Map();
  objectsWhere_(CFG.SHEETS.MATERIAL,o=>text_(o.material_id)).forEach(o=>{
    const id=text_(o.material_id);
    if(!map.has(id)) map.set(id,Object.assign({},o,{__duplicate:false}));
    else map.get(id).__duplicate=true;
  });
  return map;
}

function supplierMap_() {
  const map=new Map(); objectsWhere_(CFG.SHEETS.SUPPLIER,o=>text_(o.supplier_id)).forEach(o=>{ if(!map.has(text_(o.supplier_id))) map.set(text_(o.supplier_id),o); }); return map;
}

function listOpenSuppliers_() {
  const rows=objectsWhere_(CFG.SHEETS.PR_OPEN,o=>bool_(o.operational_active_flag)&&num_(o.remaining_qty)>0&&text_(o.supplier_id));
  const map=new Map(); rows.forEach(o=>{const id=text_(o.supplier_id); if(!map.has(id))map.set(id,{supplierId:id,supplierName:text_(o.supplier_name),openLines:0,prCodes:new Set()}); const x=map.get(id); x.openLines++; x.prCodes.add(text_(o.pr_code));});
  return Array.from(map.values()).map(x=>({supplierId:x.supplierId,supplierName:x.supplierName,openLines:x.openLines,openPrCount:x.prCodes.size})).sort((a,b)=>a.supplierName.localeCompare(b.supplierName,'vi'));
}

function listOpenPrs_(supplierId) {
  const rows=objectsWhere_(CFG.SHEETS.PR_OPEN,o=>bool_(o.operational_active_flag)&&num_(o.remaining_qty)>0&&text_(o.supplier_id)===text_(supplierId));
  const map=new Map(); rows.forEach(o=>{const code=text_(o.pr_code); if(!code)return; if(!map.has(code))map.set(code,{prCode:code,prDate:clientDate_(o.pr_date),supplierId:text_(o.supplier_id),supplierName:text_(o.supplier_name),lineCount:0,remainingQty:0}); const x=map.get(code); x.lineCount++; x.remainingQty+=num_(o.remaining_qty);});
  return Array.from(map.values()).sort((a,b)=>String(b.prDate).localeCompare(String(a.prDate)));
}

function getOpenPrLines_(supplierId,prCode) {
  return objectsWhere_(CFG.SHEETS.PR_OPEN,o=>bool_(o.operational_active_flag)&&num_(o.remaining_qty)>0&&text_(o.supplier_id)===text_(supplierId)&&text_(o.pr_code)===text_(prCode)).map(o=>({prRefKey:text_(o.pr_ref_key),prCode:text_(o.pr_code),orderCode:text_(o.order_code),executionCode:text_(o.execution_code),productCode:text_(o.product_code),materialId:text_(o.material_id),materialName:text_(o.material_name),uom:text_(o.uom),orderedQty:num_(o.ordered_qty),receivedQty:num_(o.received_qty),remainingQty:num_(o.remaining_qty),estimatedUnitPrice:num_(o.estimated_unit_price),requiredDate:clientDate_(o.required_date)}));
}

function stockSearch_(query,limit) {
  const q=text_(query).toLowerCase(); const max=Number(limit||50); const mats=materialMap_(), balances=getCurrentBalances_(), reserved=reservationTotalsByMaterial_(); const out=[];
  mats.forEach((m,id)=>{ if(!bool_(m.is_active))return; const label=(id+' '+text_(m.material_name)).toLowerCase(); if(q&&label.indexOf(q)<0)return; const b=balances.get(id)||{qty:0,value:0,avg:0}; const res=reserved.get(id)||0; out.push({materialId:id,materialName:text_(m.material_name),uom:text_(m.uom),itemClass:text_(m.item_class),masterBlocked:!!m.__duplicate,onHand:b.qty,reserved:res,available:b.qty-res,avgCost:b.avg,stockValue:b.value}); });
  return out.sort((a,b)=>a.materialId.localeCompare(b.materialId)).slice(0,max);
}

function getIssueContext_(executionCode) {
  const execution=code_(executionCode);
  const balances=getCurrentBalances_(), totals=reservationTotalsByMaterial_(), mats=materialMap_();
  return objectsWhere_(CFG.SHEETS.RESERVATION,o=>code_(o.execution_code)===execution&&['CONFIRMED','PARTIAL_ISSUED'].indexOf(text_(o.status))>=0&&num_(o.remaining_reserved_qty)>0).map(o=>{const material=text_(o.material_id),allow=issueAllowance_(material,text_(o.reservation_id),balances,totals),b=balances.get(material)||{avg:0}; const m=mats.get(material)||{}; return {reservationId:text_(o.reservation_id),executionCode:text_(o.execution_code),productCode:text_(o.product_code),materialId:material,materialName:text_(m.material_name)||material,uom:text_(m.uom),requiredQty:num_(o.required_qty),issuedQty:num_(o.issued_qty),remainingBomQty:Math.max(num_(o.required_qty)-num_(o.issued_qty),0),remainingReservedQty:num_(o.remaining_reserved_qty),physicalStock:allow.physical,globalAvailable:allow.globalAvailable,allowedForThisOrder:allow.allowed,avgCost:b.avg};});
}

function getReturnableIssueLines_(executionCode) {
  const execution=code_(executionCode);
  const issueHeaders=new Map(); objectsWhere_(CFG.SHEETS.ISSUE_H,o=>text_(o.status)==='POSTED').forEach(o=>issueHeaders.set(text_(o.issue_id),o));
  const returns=objectsWhere_(CFG.SHEETS.RETURN,o=>text_(o.status)==='POSTED').reduce((m,o)=>{const k=text_(o.source_issue_line_id);m.set(k,(m.get(k)||0)+num_(o.return_qty));return m;},new Map());
  return objectsWhere_(CFG.SHEETS.ISSUE_L,o=>{const h=issueHeaders.get(text_(o.issue_id));return h&&code_(h.execution_code)===execution;}).map(o=>{const h=issueHeaders.get(text_(o.issue_id)); const returned=returns.get(text_(o.issue_line_id))||0; return {issueLineId:text_(o.issue_line_id),issueCode:text_(h.issue_code),issueDate:clientDate_(h.issue_date),executionCode:text_(h.execution_code),productCode:text_(o.product_code),materialId:text_(o.material_id),materialName:text_(o.material_name_snapshot),uom:text_(o.uom_snapshot),issuedQty:num_(o.issue_qty),returnedQty:returned,returnableQty:Math.max(num_(o.issue_qty)-returned,0),unitCost:num_(o.management_unit_cost)};}).filter(x=>x.returnableQty>1e-9);
}
