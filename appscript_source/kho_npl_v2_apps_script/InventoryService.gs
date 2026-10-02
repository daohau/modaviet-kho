function getCurrentBalances_() {
  const data = sheetObjects_(CFG.SHEETS.LEDGER);
  const balances = new Map();
  data.rows.forEach(r => {
    const o = r.obj; const material = text_(o.material_id); if (!material) return;
    const prev = balances.get(material) || {qty:0, value:0, avg:0};
    prev.qty += num_(o.qty_in) - num_(o.qty_out);
    prev.value += num_(o.amount_in) - num_(o.amount_out);
    if (Math.abs(prev.qty) < 1e-9) { prev.qty = 0; if (Math.abs(prev.value) < 1) prev.value = 0; }
    prev.avg = prev.qty ? prev.value / prev.qty : 0;
    balances.set(material, prev);
  });
  return balances;
}

function getReservationRows_() {
  return sheetObjects_(CFG.SHEETS.RESERVATION).rows;
}

function reservationTotalsByMaterial_() {
  const totals = new Map();
  getReservationRows_().forEach(r => {
    const o = r.obj; const status = text_(o.status);
    if (status === 'CANCELLED' || status === 'CLOSED') return;
    const material = text_(o.material_id); if (!material) return;
    totals.set(material, (totals.get(material) || 0) + num_(o.remaining_reserved_qty));
  });
  return totals;
}

function findReservation_(reservationId) {
  return findOne_(CFG.SHEETS.RESERVATION, 'reservation_id', reservationId);
}

function issueAllowance_(materialId, reservationId, balances, reservationTotals) {
  const physical = (balances.get(materialId) || {qty:0}).qty;
  const totalReserved = reservationTotals.get(materialId) || 0;
  const globalAvailable = Math.max(physical - totalReserved, 0);
  let ownReserved = 0;
  if (reservationId) {
    const res = findReservation_(reservationId);
    if (res) ownReserved = num_(res.obj.remaining_reserved_qty);
  }
  return {physical, totalReserved, globalAvailable, ownReserved, allowed:Math.min(physical, globalAvailable + ownReserved)};
}

function buildReceiptLedgerRows_(header, lines) {
  const balances = getCurrentBalances_(); const out = [];
  lines.forEach(line => {
    if (text_(line.item_class) !== CFG.ITEM_CLASS.STOCK) return;
    const qty = num_(line.accepted_qty); if (qty <= 0) return;
    const unitCost = num_(line.actual_unit_price); const amount = qty * unitCost;
    const material = text_(line.material_id); const prev = balances.get(material) || {qty:0,value:0,avg:0};
    const nextQty = prev.qty + qty; const nextValue = prev.value + amount; const avg = nextQty ? nextValue / nextQty : 0;
    balances.set(material,{qty:nextQty,value:nextValue,avg});
    out.push({ledger_id:'LG-'+line.receipt_line_id, posted_at:new Date(), transaction_date:header.receipt_date, transaction_type:'NHAP_MUA', transaction_id:header.receipt_id, transaction_line_id:line.receipt_line_id, document_code:header.receipt_code, material_id:material, qty_in:qty, qty_out:0, unit_cost:unitCost, amount_in:amount, amount_out:0, running_qty:nextQty, running_value:nextValue, avg_cost_after:avg, order_code:line.order_code || '', execution_code:line.execution_code || '', product_code:line.product_code || '', supplier_id:header.supplier_id, pr_code:line.pr_code || '', created_by:activeUser_(), source_environment:CFG.ENVIRONMENT, source_client_request_id:header.client_request_id});
  });
  return out;
}

function buildIssueLedgerRows_(header, lines) {
  const balances = getCurrentBalances_(); const out = [];
  lines.forEach(line => {
    const qty = num_(line.issue_qty); if (qty <= 0) return;
    const material = text_(line.material_id); const prev = balances.get(material) || {qty:0,value:0,avg:0};
    if (qty > prev.qty + 1e-9) throw new Error('BLOCK_AM_KHO: '+material+' chỉ còn '+prev.qty+', yêu cầu '+qty);
    const unitCost = prev.avg || 0; const amount = qty * unitCost;
    const nextQty = prev.qty - qty; const nextValue = prev.value - amount; const avg = nextQty ? nextValue / nextQty : 0;
    balances.set(material,{qty:nextQty,value:nextValue,avg});
    out.push({ledger_id:'LG-'+line.issue_line_id, posted_at:new Date(), transaction_date:header.issue_date, transaction_type:header.issue_type === 'PRODUCTION' ? 'XUAT_SX' : 'XUAT_'+text_(header.issue_type), transaction_id:header.issue_id, transaction_line_id:line.issue_line_id, document_code:header.issue_code, material_id:material, qty_in:0, qty_out:qty, unit_cost:unitCost, amount_in:0, amount_out:amount, running_qty:nextQty, running_value:nextValue, avg_cost_after:avg, order_code:header.order_code || '', execution_code:header.execution_code || '', product_code:line.product_code || '', supplier_id:'', pr_code:'', created_by:activeUser_(), source_environment:CFG.ENVIRONMENT, source_client_request_id:header.client_request_id});
    line.management_unit_cost = unitCost; line.management_amount = amount;
  });
  return out;
}

function buildReturnLedgerRow_(ret) {
  const usable = num_(ret.usable_stock_qty); if (usable <= 0) return null;
  const balances = getCurrentBalances_(); const material = text_(ret.material_id); const prev = balances.get(material) || {qty:0,value:0,avg:0};
  const unitCost = num_(ret.unit_cost); const amount = usable * unitCost;
  const nextQty = prev.qty + usable; const nextValue = prev.value + amount; const avg = nextQty ? nextValue / nextQty : 0;
  return {ledger_id:'LG-'+ret.return_id, posted_at:new Date(), transaction_date:ret.return_date, transaction_type:'TRA_SX', transaction_id:ret.return_id, transaction_line_id:ret.return_id, document_code:ret.return_code, material_id:material, qty_in:usable, qty_out:0, unit_cost:unitCost, amount_in:amount, amount_out:0, running_qty:nextQty, running_value:nextValue, avg_cost_after:avg, order_code:ret.order_code || '', execution_code:ret.execution_code || '', product_code:ret.product_code || '', supplier_id:'', pr_code:'', created_by:activeUser_(), source_environment:CFG.ENVIRONMENT, source_client_request_id:ret.client_request_id};
}

function consumeReservation_(reservationId, qty) {
  if (!reservationId || qty <= 0) return;
  const res = findReservation_(reservationId); if (!res) throw new Error('Không tìm thấy Reservation: '+reservationId);
  const o = res.obj; const newIssued = num_(o.issued_qty) + qty; const remaining = Math.max(num_(o.confirmed_reserved_qty) - newIssued - num_(o.released_qty),0);
  patchRow_(CFG.SHEETS.RESERVATION,res.row,{issued_qty:newIssued, remaining_reserved_qty:remaining, status:remaining <= 1e-9 ? 'CLOSED' : (newIssued > 0 ? 'PARTIAL_ISSUED':'CONFIRMED'), updated_at:new Date()});
}

function recalculateReservation_(reservationId) {
  if(!reservationId) return;
  const res=findReservation_(reservationId); if(!res)return;
  const postedIssued=objectsWhere_(CFG.SHEETS.ISSUE_L,o=>text_(o.reservation_id)===text_(reservationId)&&text_(o.issue_status_ref)==='POSTED').reduce((s,o)=>s+num_(o.issue_qty),0);
  const remaining=Math.max(num_(res.obj.confirmed_reserved_qty)-postedIssued-num_(res.obj.released_qty),0);
  patchRow_(CFG.SHEETS.RESERVATION,res.row,{issued_qty:postedIssued,remaining_reserved_qty:remaining,status:remaining<=1e-9?'CLOSED':(postedIssued>0?'PARTIAL_ISSUED':'CONFIRMED'),updated_at:new Date()});
}
