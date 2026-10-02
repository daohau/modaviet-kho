import { AppError } from '../lib/errors.js';

export async function lockBalance(client, materialId) {
  let { rows } = await client.query(`SELECT * FROM stock_balance WHERE material_id=$1 FOR UPDATE`, [materialId]);
  if (!rows.length) {
    await client.query(`INSERT INTO stock_balance(material_id, physical_qty, stock_value, avg_cost) VALUES ($1,0,0,0) ON CONFLICT DO NOTHING`, [materialId]);
    ({ rows } = await client.query(`SELECT * FROM stock_balance WHERE material_id=$1 FOR UPDATE`, [materialId]));
  }
  return rows[0];
}

export async function receiptStock(client, {materialId, qty, unitPrice, ledger}) {
  if (qty <= 0) return null;
  const bal = await lockBalance(client, materialId);
  const newQty = Number(bal.physical_qty) + qty;
  const newValue = Number(bal.stock_value) + qty * unitPrice;
  const newAvg = newQty === 0 ? 0 : newValue / newQty;
  await client.query(
    `UPDATE stock_balance SET physical_qty=$2, stock_value=$3, avg_cost=$4, updated_at=now() WHERE material_id=$1`,
    [materialId, newQty, newValue, newAvg]
  );
  await client.query(
    `INSERT INTO stock_ledger(transaction_type, transaction_id, transaction_line_id, document_code, material_id,
      qty_in, qty_out, unit_cost, amount_in, amount_out, running_qty, running_value, avg_cost_after,
      order_code, execution_code, product_code, supplier_id, pr_code, created_by, source_environment, source_client_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,0,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PILOT_DB',$18)`,
    [ledger.transactionType, ledger.transactionId, ledger.lineId, ledger.documentCode, materialId,
     qty, unitPrice, qty*unitPrice, newQty, newValue, newAvg, ledger.orderCode, ledger.executionCode,
     ledger.productCode, ledger.supplierId, ledger.prCode, ledger.userEmail, ledger.clientRequestId]
  );
  return { physicalQty: newQty, stockValue: newValue, avgCost: newAvg };
}

export async function issueAllowance(client, materialId, reservationId) {
  const bal = await lockBalance(client, materialId);
  const { rows } = await client.query(
    `SELECT reservation_id, remaining_reserved_qty
     FROM reservation
     WHERE material_id=$1 AND remaining_reserved_qty>0 AND status IN ('CONFIRMED','PARTIAL_ISSUED')
     FOR UPDATE`, [materialId]
  );
  const own = rows.find(r => r.reservation_id === reservationId);
  if (!own) throw new AppError('RESERVATION_NOT_AVAILABLE', 'Reservation không còn khả dụng', 409);
  const otherReserved = rows.filter(r => r.reservation_id !== reservationId)
    .reduce((s,r) => s + Number(r.remaining_reserved_qty), 0);
  const physical = Number(bal.physical_qty);
  const ownRemaining = Number(own.remaining_reserved_qty);
  const sharedAvailable = Math.max(physical - rows.reduce((s,r)=>s+Number(r.remaining_reserved_qty),0), 0);
  const allowed = Math.max(physical - otherReserved, 0);
  return { bal, physical, ownRemaining, sharedAvailable, allowed };
}

export async function issueStock(client, {materialId, qty, ledger}) {
  const bal = await lockBalance(client, materialId);
  const physical = Number(bal.physical_qty);
  const avg = Number(bal.avg_cost);
  if (qty > physical + 1e-9) throw new AppError('BLOCK_NEGATIVE_STOCK', `SL xuất ${qty} vượt tồn vật lý ${physical}`, 409);
  const newQty = physical - qty;
  const amount = qty * avg;
  let newValue = Number(bal.stock_value) - amount;
  if (Math.abs(newValue) < 0.0001) newValue = 0;
  const newAvg = newQty === 0 ? 0 : newValue / newQty;
  await client.query(`UPDATE stock_balance SET physical_qty=$2, stock_value=$3, avg_cost=$4, updated_at=now() WHERE material_id=$1`, [materialId,newQty,newValue,newAvg]);
  await client.query(
    `INSERT INTO stock_ledger(transaction_type, transaction_id, transaction_line_id, document_code, material_id,
      qty_in, qty_out, unit_cost, amount_in, amount_out, running_qty, running_value, avg_cost_after,
      order_code, execution_code, product_code, created_by, source_environment, source_client_request_id)
     VALUES ($1,$2,$3,$4,$5,0,$6,$7,0,$8,$9,$10,$11,$12,$13,$14,$15,'PILOT_DB',$16)`,
    [ledger.transactionType,ledger.transactionId,ledger.lineId,ledger.documentCode,materialId,qty,avg,amount,newQty,newValue,newAvg,
     ledger.orderCode,ledger.executionCode,ledger.productCode,ledger.userEmail,ledger.clientRequestId]
  );
  return {physicalQty:newQty, stockValue:newValue, unitCost:avg, avgCostAfter:newAvg, amount};
}
