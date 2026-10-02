import crypto from 'node:crypto';
import { z } from 'zod';
import { withTx } from '../lib/db.js';
import { AppError, assertApp } from '../lib/errors.js';
import { beginIdempotent, finishIdempotent } from '../lib/idempotency.js';
import { requireRole } from '../lib/auth.js';
import { nextDocumentCode } from './document-code.js';
import { audit } from './audit.js';
import { receiptStock, issueAllowance, issueStock, lockBalance } from './stock.js';

const qty = z.coerce.number().positive();
const nonNeg = z.coerce.number().nonnegative();
const dateYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const receiptSchema = z.object({
  clientRequestId: z.string().min(8),
  receiptDate: dateYmd,
  supplierId: z.string().min(1),
  deliveryNoteNo: z.string().optional().default(''),
  deliveredBy: z.string().optional().default(''),
  note: z.string().optional().default(''),
  lines: z.array(z.object({
    prRefKey: z.string().min(1), deliveredQty: qty, acceptedQty: nonNeg,
    actualUnitPrice: nonNeg, qualityStatus: z.string().optional().default('ACCEPTED'),
    overReceiptReason: z.string().optional().default(''), lotNo: z.string().optional().default('')
  })).min(1)
});

const issueSchema = z.object({
  clientRequestId: z.string().min(8), issueDate: dateYmd,
  executionCode: z.string().min(1).transform(v=>v.trim().toUpperCase()),
  receiver: z.string().min(1), note: z.string().optional().default(''),
  lines: z.array(z.object({ reservationId:z.string().min(1), issueQty:qty, overBomReason:z.string().optional().default('') })).min(1)
});

const returnSchema = z.object({
  clientRequestId:z.string().min(8), returnDate:dateYmd, sourceIssueLineId:z.string().min(1),
  returnQty:qty, usableQty:nonNeg, scrapQty:nonNeg, returnedBy:z.string().min(1), note:z.string().optional().default('')
});

function hashPayload(payload) { return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
function uuid(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

export async function postReceiptAtomic(user, raw) {
  const payload = receiptSchema.parse(raw);
  return withTx(async client => {
    await requireRole(client, user.email, ['WAREHOUSE','PILOT_ADMIN','ADMIN']);
    const idem = await beginIdempotent(client,{key:payload.clientRequestId,operation:'RECEIPT_POST',userEmail:user.email,requestHash:hashPayload(payload)});
    if (idem.reused) return idem.response;
    const sup = await client.query(`SELECT * FROM supplier WHERE supplier_id=$1 AND is_active=TRUE`,[payload.supplierId]);
    assertApp(sup.rows.length===1,'SUPPLIER_NOT_FOUND','Không tìm thấy NCC đang hoạt động',404);
    const refs = payload.lines.map(x=>x.prRefKey);
    assertApp(new Set(refs).size===refs.length,'BLOCK_DUPLICATE_PR_LINE','Dòng ĐNMH bị lặp trong cùng phiếu');
    const pr = await client.query(`SELECT * FROM purchase_request_line WHERE pr_ref_key = ANY($1::text[]) FOR UPDATE`,[refs]);
    assertApp(pr.rows.length===refs.length,'PR_LINE_NOT_FOUND','Có dòng ĐNMH không tồn tại',404);
    const byKey = new Map(pr.rows.map(r=>[r.pr_ref_key,r]));
    for (const line of payload.lines) {
      const src=byKey.get(line.prRefKey);
      assertApp(src.supplier_id===payload.supplierId,'PR_SUPPLIER_MISMATCH','Dòng ĐNMH không thuộc NCC đã chọn');
      assertApp(Number(src.remaining_qty)>0,'PR_ALREADY_COMPLETE','Dòng ĐNMH đã nhận đủ');
      assertApp(line.acceptedQty<=line.deliveredQty,'BLOCK_VALIDATION','SL đạt không được vượt SL giao');
      const over=Math.max(line.acceptedQty-Number(src.remaining_qty),0);
      assertApp(over<=0 || line.overReceiptReason.trim().length>0,'OVER_RECEIPT_REASON_REQUIRED','Nhận vượt cần lý do');
      const rejected=line.deliveredQty-line.acceptedQty;
      if (rejected>0) assertApp(line.qualityStatus==='PARTIAL_REJECT' || line.qualityStatus==='REJECTED','QUALITY_STATUS_REQUIRED','Có hàng loại phải chọn PARTIAL_REJECT/REJECTED');
    }
    const code=await nextDocumentCode(client,'RECEIPT',payload.receiptDate);
    const receiptId=uuid('REC');
    await client.query(`INSERT INTO receipt_header(receipt_id,receipt_code,receipt_date,supplier_id,supplier_name_snapshot,delivery_note_no,delivered_by,status,price_status,received_by,posted_by,posted_at,client_request_id,note)
      VALUES($1,$2,$3,$4,$5,$6,$7,'POSTED','PROVISIONAL',$8,$8,now(),$9,$10)`,
      [receiptId,code,payload.receiptDate,payload.supplierId,sup.rows[0].supplier_display_name,payload.deliveryNoteNo,payload.deliveredBy,user.email,payload.clientRequestId,payload.note]);
    const lineResults=[];
    for (const line of payload.lines) {
      const src=byKey.get(line.prRefKey); const lineId=uuid('RL');
      const rejected=line.deliveredQty-line.acceptedQty; const over=Math.max(line.acceptedQty-Number(src.remaining_qty),0);
      const item=await client.query(`SELECT item_class,material_name,uom FROM material WHERE material_id=$1 AND is_active=TRUE`,[src.material_id]);
      assertApp(item.rows.length===1,'MATERIAL_NOT_FOUND','Mã vật tư không tồn tại/đã khóa',404);
      const m=item.rows[0]; const amount=line.acceptedQty*line.actualUnitPrice;
      await client.query(`INSERT INTO receipt_line(receipt_line_id,receipt_id,receipt_code,pr_ref_key,pr_code,order_code,execution_code,product_code,material_id,material_name_snapshot,uom_snapshot,ordered_qty,previous_received_qty,remaining_before_receipt,delivered_qty,accepted_qty,rejected_qty,expected_unit_price,actual_unit_price,management_amount,quality_status,over_receipt_qty,over_receipt_reason,item_class,lot_no)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
       [lineId,receiptId,code,src.pr_ref_key,src.pr_code,src.order_code,src.execution_code,src.product_code,src.material_id,m.material_name,m.uom,src.ordered_qty,src.received_qty,src.remaining_qty,line.deliveredQty,line.acceptedQty,rejected,src.estimated_unit_price,line.actualUnitPrice,amount,line.qualityStatus,over,line.overReceiptReason,m.item_class,line.lotNo]);
      const newReceived=Number(src.received_qty)+line.acceptedQty; const remaining=Math.max(Number(src.ordered_qty)-newReceived,0);
      const status=newReceived>Number(src.ordered_qty)?'NHAN_VUOT':(remaining===0?'COMPLETE':'PARTIAL');
      await client.query(`UPDATE purchase_request_line SET received_qty=$2, remaining_qty=$3, status=$4, updated_at=now() WHERE pr_ref_key=$1`,[src.pr_ref_key,newReceived,remaining,status]);
      let stock=null;
      if(m.item_class==='STOCK' && line.acceptedQty>0) stock=await receiptStock(client,{materialId:src.material_id,qty:line.acceptedQty,unitPrice:line.actualUnitPrice,ledger:{transactionType:'NHAP_MUA',transactionId:receiptId,lineId,documentCode:code,orderCode:src.order_code,executionCode:src.execution_code,productCode:src.product_code,supplierId:payload.supplierId,prCode:src.pr_code,userEmail:user.email,clientRequestId:payload.clientRequestId}});
      lineResults.push({receiptLineId:lineId,materialId:src.material_id,acceptedQty:line.acceptedQty,stock});
    }
    await audit(client,{userEmail:user.email,action:'POST_RECEIPT',objectType:'RECEIPT',objectId:receiptId,clientRequestId:payload.clientRequestId,reason:'POST hợp lệ',oldValue:'',newValue:'POSTED'});
    const response={ok:true,receiptId,receiptCode:code,lineCount:lineResults.length,lines:lineResults};
    await finishIdempotent(client,payload.clientRequestId,response); return response;
  });
}

export async function postIssueAtomic(user, raw) {
  const payload=issueSchema.parse(raw);
  return withTx(async client=>{
    await requireRole(client,user.email,['WAREHOUSE','PILOT_ADMIN','ADMIN']);
    const idem=await beginIdempotent(client,{key:payload.clientRequestId,operation:'ISSUE_POST',userEmail:user.email,requestHash:hashPayload(payload)}); if(idem.reused)return idem.response;
    const ids=payload.lines.map(x=>x.reservationId); assertApp(new Set(ids).size===ids.length,'BLOCK_DUPLICATE_RESERVATION','Reservation bị lặp');
    const reservations=await client.query(`SELECT * FROM reservation WHERE reservation_id=ANY($1::text[]) FOR UPDATE`,[ids]);
    assertApp(reservations.rows.length===ids.length,'RESERVATION_NOT_FOUND','Có Reservation không tồn tại',404);
    const map=new Map(reservations.rows.map(r=>[r.reservation_id,r]));
    for(const line of payload.lines){const r=map.get(line.reservationId);assertApp(r.execution_code.toUpperCase()===payload.executionCode,'RESERVATION_EXECUTION_MISMATCH','Reservation không thuộc BBSX đã chọn'); const a=await issueAllowance(client,r.material_id,r.reservation_id); assertApp(line.issueQty<=a.allowed+1e-9,'BLOCK_RESERVATION_LIMIT',`SL xuất ${line.issueQty} vượt Được xuất ${a.allowed}`,409); assertApp(line.issueQty<=a.physical+1e-9,'BLOCK_NEGATIVE_STOCK',`SL xuất ${line.issueQty} vượt tồn vật lý ${a.physical}`,409);}
    const code=await nextDocumentCode(client,'ISSUE',payload.issueDate); const issueId=uuid('ISS');
    await client.query(`INSERT INTO issue_header(issue_id,issue_code,issue_date,issue_type,order_code,execution_code,department,receiver,status,issued_by,posted_by,posted_at,client_request_id,note)
      VALUES($1,$2,$3,'PRODUCTION',$4,$4,'SẢN XUẤT',$5,'POSTED',$6,$6,now(),$7,$8)`,[issueId,code,payload.issueDate,payload.executionCode,payload.receiver,user.email,payload.clientRequestId,payload.note]);
    const out=[];
    for(const line of payload.lines){const r=map.get(line.reservationId); const a=await issueAllowance(client,r.material_id,r.reservation_id); assertApp(line.issueQty<=a.allowed+1e-9,'BLOCK_RESERVATION_LIMIT','Reservation thay đổi trong lúc ghi sổ',409); const issueLineId=uuid('IL'); const stock=await issueStock(client,{materialId:r.material_id,qty:line.issueQty,ledger:{transactionType:'XUAT_SX',transactionId:issueId,lineId:issueLineId,documentCode:code,orderCode:r.order_code,executionCode:r.execution_code,productCode:r.product_code,userEmail:user.email,clientRequestId:payload.clientRequestId}}); const newIssued=Number(r.issued_qty)+line.issueQty; const remain=Math.max(Number(r.confirmed_reserved_qty)-newIssued-Number(r.released_qty),0); const status=remain===0?'CLOSED':'PARTIAL_ISSUED'; await client.query(`INSERT INTO issue_line(issue_line_id,issue_id,issue_code,reservation_id,product_code,material_id,bom_required_qty,previous_issued_qty,remaining_bom_qty,physical_stock_before,available_stock_before,issue_qty,management_unit_cost,management_amount,over_bom_qty,over_bom_reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[issueLineId,issueId,code,r.reservation_id,r.product_code,r.material_id,r.required_qty,r.issued_qty,Math.max(Number(r.required_qty)-Number(r.issued_qty),0),a.physical,a.allowed,line.issueQty,stock.unitCost,stock.amount,Math.max(newIssued-Number(r.required_qty),0),line.overBomReason]); await client.query(`UPDATE reservation SET issued_qty=$2, remaining_reserved_qty=$3, status=$4, updated_at=now() WHERE reservation_id=$1`,[r.reservation_id,newIssued,remain,status]); out.push({issueLineId,materialId:r.material_id,issueQty:line.issueQty,stock});}
    await audit(client,{userEmail:user.email,action:'POST_ISSUE',objectType:'ISSUE',objectId:issueId,clientRequestId:payload.clientRequestId,reason:'POST hợp lệ',newValue:'POSTED'}); const response={ok:true,issueId,issueCode:code,lines:out}; await finishIdempotent(client,payload.clientRequestId,response); return response;
  });
}

export async function postReturnAtomic(user, raw) {
  const payload=returnSchema.parse(raw);
  assertApp(Math.abs(payload.usableQty+payload.scrapQty-payload.returnQty)<1e-9,'BLOCK_VALIDATION','SL usable + scrap phải bằng SL trả');
  return withTx(async client=>{
    await requireRole(client,user.email,['WAREHOUSE','PILOT_ADMIN','ADMIN']); const idem=await beginIdempotent(client,{key:payload.clientRequestId,operation:'RETURN_POST',userEmail:user.email,requestHash:hashPayload(payload)}); if(idem.reused)return idem.response;
    const q=await client.query(`SELECT il.*, ih.order_code, ih.execution_code, ih.status AS issue_status FROM issue_line il JOIN issue_header ih ON ih.issue_id=il.issue_id WHERE il.issue_line_id=$1 FOR UPDATE OF il`,[payload.sourceIssueLineId]); assertApp(q.rows.length===1,'ISSUE_LINE_NOT_FOUND','Không tìm thấy dòng xuất nguồn',404); const src=q.rows[0]; assertApp(src.issue_status==='POSTED','SOURCE_ISSUE_NOT_POSTED','Phiếu xuất nguồn chưa POSTED');
    const prior=await client.query(`SELECT COALESCE(SUM(return_qty),0) AS qty FROM production_return WHERE source_issue_line_id=$1 AND status='POSTED'`,[payload.sourceIssueLineId]); const remaining=Number(src.issue_qty)-Number(prior.rows[0].qty); assertApp(payload.returnQty<=remaining+1e-9,'BLOCK_RETURN_OVER_ISSUED',`SL trả ${payload.returnQty} vượt còn có thể trả ${remaining}`,409);
    const code=await nextDocumentCode(client,'RETURN',payload.returnDate); const returnId=uuid('RET'); const unitCost=Number(src.management_unit_cost); await client.query(`INSERT INTO production_return(return_id,return_code,return_date,source_issue_line_id,order_code,execution_code,product_code,material_id,return_qty,unit_cost,amount,return_condition,usable_stock_qty,scrap_qty,returned_by,received_by,status,posted_at,note,client_request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'POSTED',now(),$17,$18)`,[returnId,code,payload.returnDate,payload.sourceIssueLineId,src.order_code,src.execution_code,src.product_code,src.material_id,payload.returnQty,unitCost,payload.returnQty*unitCost,payload.usableQty>0&&payload.scrapQty>0?'PARTIAL':(payload.usableQty>0?'USABLE':'SCRAP'),payload.usableQty,payload.scrapQty,payload.returnedBy,user.email,payload.note,payload.clientRequestId]);
    let stock=null; if(payload.usableQty>0) stock=await receiptStock(client,{materialId:src.material_id,qty:payload.usableQty,unitPrice:unitCost,ledger:{transactionType:'TRA_SX',transactionId:returnId,lineId:returnId,documentCode:code,orderCode:src.order_code,executionCode:src.execution_code,productCode:src.product_code,supplierId:null,prCode:null,userEmail:user.email,clientRequestId:payload.clientRequestId}});
    await audit(client,{userEmail:user.email,action:'POST_RETURN',objectType:'RETURN',objectId:returnId,clientRequestId:payload.clientRequestId,reason:'POST hợp lệ',newValue:'POSTED'}); const response={ok:true,returnId,returnCode:code,usableQty:payload.usableQty,scrapQty:payload.scrapQty,stock}; await finishIdempotent(client,payload.clientRequestId,response); return response;
  });
}
