function validateReceiptLine_(line) {
  const errors=[]; const delivered=num_(line.delivered_qty), accepted=num_(line.accepted_qty), remaining=num_(line.remaining_before_receipt), price=num_(line.actual_unit_price);
  const rejected=Math.max(delivered-accepted,0), over=Math.max(accepted-remaining,0), quality=text_(line.quality_status);
  if (delivered < 0) errors.push('SL giao < 0');
  if (accepted < 0) errors.push('SL đạt < 0');
  if (accepted > delivered) errors.push('SL đạt lớn hơn SL giao');
  if (price < 0) errors.push('Đơn giá < 0');
  if (over > 0 && !text_(line.over_receipt_reason)) errors.push('Nhận vượt nhưng thiếu lý do');
  if (rejected > 0 && quality === 'ACCEPTED') errors.push('Có hàng loại nhưng trạng thái = ACCEPTED');
  if (accepted === 0 && delivered > 0 && quality !== 'REJECTED') errors.push('Không nhận hàng đạt nhưng chưa đánh dấu REJECTED');
  if (accepted > 0 && rejected > 0 && quality !== 'PARTIAL_REJECT') errors.push('Có hàng đạt + hàng loại nhưng chưa đánh dấu PARTIAL_REJECT');
  if (!text_(line.material_id) && text_(line.item_class) === CFG.ITEM_CLASS.STOCK) errors.push('Thiếu Mã vật tư');
  return {ok:!errors.length,errors,rejected,over};
}
function validateReceipt_(header, lines) {
  const errors=[]; if(!header.receipt_id)errors.push('Thiếu receipt_id'); if(!header.client_request_id)errors.push('Thiếu client_request_id'); if(!header.supplier_id)errors.push('Thiếu Mã NCC'); if(!lines.length)errors.push('Phiếu không có dòng chi tiết');
  lines.forEach((line,idx)=>{const v=validateReceiptLine_(line); if(!v.ok)errors.push('Dòng '+(idx+1)+': '+v.errors.join('; '));});
  return {ok:!errors.length,errors};
}

function validateIssueLineAtPost_(line, balances, reservationTotals) {
  const errors=[]; const qty=num_(line.issue_qty); const material=text_(line.material_id); const allowance=issueAllowance_(material,text_(line.reservation_id),balances,reservationTotals);
  if(qty<=0)errors.push('SL xuất phải > 0');
  if(qty>allowance.physical+1e-9)errors.push('SL xuất lớn hơn tồn vật lý');
  if(qty>allowance.allowed+1e-9)errors.push('SL xuất vượt phần khả dụng cho đơn này');
  const remainingBom=num_(line.remaining_bom_qty); if(qty>remainingBom+1e-9 && !text_(line.variance_reason))errors.push('Xuất vượt BOM nhưng thiếu lý do');
  return {ok:!errors.length,errors,allowance};
}

function validateReturnAtPost_(ret) {
  const errors=[]; const qty=num_(ret.return_qty), usable=num_(ret.usable_stock_qty), scrap=num_(ret.scrap_qty);
  if(qty<=0)errors.push('SL trả phải > 0');
  if(Math.abs(usable+scrap-qty)>1e-6)errors.push('SL usable + scrap phải bằng SL trả');
  const src=findOne_(CFG.SHEETS.ISSUE_L,'issue_line_id',ret.source_issue_line_id); if(!src)errors.push('Không tìm thấy dòng xuất nguồn');
  if(src){
    const issueHeader=findOne_(CFG.SHEETS.ISSUE_H,'issue_id',src.obj.issue_id); if(!issueHeader||text_(issueHeader.obj.status)!=='POSTED')errors.push('Phiếu xuất nguồn chưa POSTED');
    const prior=objectsWhere_(CFG.SHEETS.RETURN,o=>text_(o.source_issue_line_id)===text_(ret.source_issue_line_id)&&text_(o.status)==='POSTED'&&text_(o.return_id)!==text_(ret.return_id)).reduce((s,o)=>s+num_(o.return_qty),0);
    if(prior+qty>num_(src.obj.issue_qty)+1e-9)errors.push('Tổng SL trả vượt SL đã xuất');
  }
  return {ok:!errors.length,errors,sourceIssueLine:src?src.obj:null};
}
