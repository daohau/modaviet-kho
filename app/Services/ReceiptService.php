<?php
declare(strict_types=1);

namespace KhoNpl\Services;

use KhoNpl\Core\Database;
use KhoNpl\Core\HttpException;

final class ReceiptService
{
    public function __construct(private readonly \PDO $db, private readonly AuthService $auth, private readonly InventoryService $inventory) {}

    public function createAndPost(string $email, array $payload): array
    {
        $this->auth->require($email, ['WAREHOUSE']);
        $supplierId=s($payload['supplierId']??'');
        $clientId=s($payload['clientRequestId']??'')?:uuid_id('REQ');
        $receiptDate=date_ymd($payload['receiptDate']??null);
        $selected=array_values(array_filter((array)($payload['lines']??[]),fn($x)=>n($x['deliveredQty']??0)>0||n($x['acceptedQty']??0)>0));
        require_true($supplierId!=='','Thiếu NCC');
        require_true((bool)$selected,'Chưa nhập dòng hàng nhận');

        try {
            return Database::transaction(function()use($email,$payload,$supplierId,$clientId,$receiptDate,$selected){
                $idem=$this->beginIdempotency($clientId,$email,$payload);
                if($idem!==null)return $idem;

                $supplierStmt=$this->db->prepare('SELECT * FROM suppliers WHERE supplier_id=? AND is_active=1 FOR UPDATE');
                $supplierStmt->execute([$supplierId]);$supplier=$supplierStmt->fetch();
                require_true((bool)$supplier,'NCC không có trong danh mục: '.$supplierId,'SUPPLIER_NOT_FOUND',404);

                $keys=[];$seen=[];
                foreach($selected as $line){$key=s($line['prRefKey']??'');require_true($key!=='','Thiếu pr_ref_key');require_true(!isset($seen[$key]),'Dòng ĐNMH bị lặp trong cùng phiếu: '.$key,'BLOCK_DUPLICATE_PR_LINE');$seen[$key]=true;$keys[]=$key;}
                $sources=$this->loadSources($keys);
                require_true(count($sources)===count($keys),'Có dòng ĐNMH không tồn tại hoặc không còn mở','PR_LINE_NOT_FOUND',404);

                $receiptId=uuid_id('REC');$draftLines=[];$errors=[];
                foreach($selected as $index=>$input){
                    $src=$sources[s($input['prRefKey'])];
                    require_true(s($src['supplier_id'])===$supplierId,'Dòng ĐNMH không thuộc NCC đã chọn','PR_SUPPLIER_MISMATCH');
                    require_true(n($src['remaining_qty'])>0,'Dòng ĐNMH đã nhận đủ: '.$src['pr_ref_key'],'PR_ALREADY_COMPLETE');
                    $materialStmt=$this->db->prepare('SELECT material_id,item_class FROM materials WHERE material_id=?');$materialStmt->execute([$src['material_id']]);$material=$materialStmt->fetch();
                    $delivered=n($input['deliveredQty']??0);$accepted=n($input['acceptedQty']??0);$price=array_key_exists('actualUnitPrice',$input)&&$input['actualUnitPrice']!==''&&$input['actualUnitPrice']!==null?n($input['actualUnitPrice']):n($src['estimated_unit_price']);$quality=s($input['qualityStatus']??'')?:'ACCEPTED';$rejected=max($delivered-$accepted,0);$over=max($accepted-n($src['remaining_qty']),0);$itemClass=s($material['item_class']??'')?:'STOCK';
                    $lineErrors=$this->validateLine($delivered,$accepted,n($src['remaining_qty']),$price,$quality,s($input['overReceiptReason']??''),s($src['material_id']),$itemClass);
                    if($lineErrors)$errors[]='Dòng '.($index+1).': '.implode('; ',$lineErrors);
                    $draftLines[]=['receipt_line_id'=>uuid_id('RL'),'src'=>$src,'delivered'=>$delivered,'accepted'=>$accepted,'rejected'=>$rejected,'price'=>$price,'quality'=>$quality,'over'=>$over,'over_reason'=>s($input['overReceiptReason']??''),'item_class'=>$itemClass,'lot_no'=>s($input['lotNo']??''),'note'=>s($input['note']??'')];
                }
                require_true(!$errors,'BLOCK_VALIDATION: '.implode(' | ',$errors),'BLOCK_VALIDATION');

                $receiptCode=$this->nextReceiptCode();
                $this->db->prepare('INSERT INTO receipts(receipt_id,receipt_code,receipt_date,supplier_id,supplier_name_snapshot,delivery_note_no,invoice_no,invoice_date,delivered_by,status,price_status,received_by,posted_by,posted_at,client_request_id,note,post_engine_status) VALUES(?,?,?,?,?,?,?,?,?,"DRAFT","PROVISIONAL",?,NULL,NULL,?,?,NULL)')->execute([$receiptId,$receiptCode,$receiptDate,$supplierId,s($supplier['supplier_display_name'])?:s($supplier['supplier_short_code']),s($payload['deliveryNoteNo']??''),s($payload['invoiceNo']??''),($payload['invoiceDate']??'')!==''?date_ymd($payload['invoiceDate']):null,s($payload['deliveredBy']??''),$email,$clientId,s($payload['note']??'')]);
                $insert=$this->db->prepare('INSERT INTO receipt_lines(receipt_line_id,receipt_id,receipt_code,pr_ref_key,pr_code,order_code,execution_code,product_code,material_id,material_name_snapshot,uom_snapshot,ordered_qty,previous_received_qty,remaining_before_receipt,delivered_qty,accepted_qty,rejected_qty,expected_unit_price,actual_unit_price,management_amount,quality_status,over_receipt_qty,over_receipt_reason,item_class,lot_no,note,validation_status,validation_message,can_post,receipt_status_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,"DRAFT")');
                foreach($draftLines as $line){$src=$line['src'];$insert->execute([$line['receipt_line_id'],$receiptId,$receiptCode,$src['pr_ref_key'],$src['pr_code'],$src['order_code'],$src['execution_code'],$src['product_code'],$src['material_id'],$src['material_name'],$src['uom'],$src['ordered_qty'],$src['received_qty'],$src['remaining_qty'],$line['delivered'],$line['accepted'],$line['rejected'],$src['estimated_unit_price'],$line['price'],$line['accepted']*$line['price'],$line['quality'],$line['over'],$line['over_reason'],$line['item_class'],$line['lot_no'],$line['note']]);}
                $this->audit($email,'CREATE_RECEIPT',$receiptId,$clientId,'Tạo phiếu nháp','','DRAFT');

                $ledgerRows=0;$commonIds=[];
                foreach($draftLines as $line){$src=$line['src'];if($line['item_class']==='STOCK'&&$line['accepted']>0){$this->inventory->movement(['ledger_id'=>'LG-'.$line['receipt_line_id'],'transaction_date'=>$receiptDate,'transaction_type'=>'NHAP_MUA','transaction_id'=>$receiptId,'transaction_line_id'=>$line['receipt_line_id'],'document_code'=>$receiptCode,'material_id'=>$src['material_id'],'qty_in'=>$line['accepted'],'qty_out'=>0,'unit_cost'=>$line['price'],'order_code'=>$src['order_code'],'execution_code'=>$src['execution_code'],'product_code'=>$src['product_code'],'supplier_id'=>$supplierId,'pr_code'=>$src['pr_code'],'created_by'=>$email,'client_request_id'=>$clientId]);$ledgerRows++;}
                    $newReceived=n($src['received_qty'])+$line['accepted'];$remaining=max(n($src['ordered_qty'])-$newReceived,0);$status=$newReceived>n($src['ordered_qty'])?'OVER_RECEIPT':($remaining<1e-9?'COMPLETE':'PARTIAL');
                    if($src['source_type']==='COMMON'){$this->db->prepare('UPDATE common_purchase_request_lines SET received_qty=?,remaining_qty=?,line_status=? WHERE pr_ref_key=?')->execute([$newReceived,$remaining,$status,$src['pr_ref_key']]);$commonIds[$src['common_pr_id']]=true;}else{$this->db->prepare('UPDATE purchase_request_lines SET received_qty=?,remaining_qty=?,line_status=? WHERE pr_ref_key=?')->execute([$newReceived,$remaining,$status,$src['pr_ref_key']]);}
                }
                foreach(array_keys($commonIds)as$commonId){$this->db->prepare('UPDATE common_purchase_requests SET status=IF((SELECT COALESCE(SUM(remaining_qty),0) FROM common_purchase_request_lines WHERE common_pr_id=?)=0,"COMPLETE","OPEN") WHERE common_pr_id=?')->execute([$commonId,$commonId]);}
                $this->db->prepare('UPDATE receipt_lines SET validation_status="OK",validation_message="",can_post=1,receipt_status_ref="POSTED" WHERE receipt_id=?')->execute([$receiptId]);
                $this->audit($email,'POST_RECEIPT',$receiptId,$clientId,'POST hợp lệ','DRAFT','POSTED');
                $this->db->prepare('UPDATE receipts SET status="POSTED",posted_by=?,posted_at=NOW(),updated_at=NOW(),post_engine_status="DA_GHI_SO" WHERE receipt_id=?')->execute([$email,$receiptId]);
                $response=['receiptId'=>$receiptId,'receiptCode'=>$receiptCode,'clientRequestId'=>$clientId,'lineCount'=>count($draftLines),'idempotentDraft'=>false,'ok'=>true,'idempotent'=>false,'ledgerRows'=>$ledgerRows,'payableReadModel'=>'v_payable_source','lines'=>array_map(fn($line)=>['receiptLineId'=>$line['receipt_line_id'],'materialId'=>$line['src']['material_id'],'acceptedQty'=>$line['accepted']],$draftLines)];
                $this->db->prepare('UPDATE idempotency_requests SET status="DONE",response_json=?,completed_at=NOW() WHERE client_request_id=?')->execute([json_encode($response,JSON_UNESCAPED_UNICODE),$clientId]);
                return $response;
            });
        }catch(\Throwable $e){$this->logError($email,$clientId,$e);throw $e;}
    }

    private function beginIdempotency(string $clientId,string $email,array $payload): ?array
    {
        $stmt=$this->db->prepare('SELECT operation,user_email,request_hash,status,response_json FROM idempotency_requests WHERE client_request_id=? FOR UPDATE');$stmt->execute([$clientId]);$row=$stmt->fetch();$hash=json_hash($payload);
        if($row){require_true($row['operation']==='RECEIPT_POST','client_request_id đã được dùng cho nghiệp vụ khác','BLOCK_TRUNG_YEU_CAU',409);require_true(hash_equals((string)$row['request_hash'],$hash),'client_request_id đã được dùng với nội dung khác','BLOCK_TRUNG_YEU_CAU',409);if($row['status']==='DONE'){$response=json_decode((string)$row['response_json'],true)?:[];$response['idempotent']=true;return$response;}throw new HttpException('Yêu cầu đang được xử lý','REQUEST_IN_PROGRESS',409);}
        $existing=$this->db->prepare('SELECT receipt_id,receipt_code,status FROM receipts WHERE client_request_id=? FOR UPDATE');$existing->execute([$clientId]);if($receipt=$existing->fetch())return['ok'=>$receipt['status']==='POSTED','idempotent'=>true,'receiptId'=>$receipt['receipt_id'],'receiptCode'=>$receipt['receipt_code'],'clientRequestId'=>$clientId];
        $this->db->prepare('INSERT INTO idempotency_requests(client_request_id,operation,user_email,request_hash,status) VALUES(?,?,?,?,"PROCESSING")')->execute([$clientId,'RECEIPT_POST',$email,$hash]);return null;
    }

    private function loadSources(array $keys): array
    {
        $in=implode(',',array_fill(0,count($keys),'?'));$rows=[];
        $stmt=$this->db->prepare("SELECT *, 'STANDARD' source_type, NULL common_pr_id FROM purchase_request_lines WHERE pr_ref_key IN ($in) AND operational_active_flag=1 AND remaining_qty>0 FOR UPDATE");$stmt->execute($keys);foreach($stmt->fetchAll()as$row)$rows[$row['pr_ref_key']]=$row;
        $stmt=$this->db->prepare("SELECT l.pr_ref_key,l.common_pr_code pr_code,'' order_code,'SX_CHUNG' execution_code,'' product_code,l.material_id,l.material_name_snapshot material_name,l.uom_snapshot uom,l.ordered_qty,l.received_qty,l.remaining_qty,l.estimated_unit_price,h.supplier_id,h.common_pr_id,'COMMON' source_type FROM common_purchase_request_lines l JOIN common_purchase_requests h ON h.common_pr_id=l.common_pr_id WHERE l.pr_ref_key IN ($in) AND h.status='OPEN' AND l.remaining_qty>0 FOR UPDATE");$stmt->execute($keys);foreach($stmt->fetchAll()as$row)$rows[$row['pr_ref_key']]=$row;
        return $rows;
    }

    private function validateLine(float $delivered,float $accepted,float $remaining,float $price,string $quality,string $overReason,string $materialId,string $itemClass): array
    {
        $errors=[];$rejected=max($delivered-$accepted,0);$over=max($accepted-$remaining,0);
        if($delivered<0)$errors[]='SL giao < 0';if($accepted<0)$errors[]='SL đạt < 0';if($accepted>$delivered)$errors[]='SL đạt lớn hơn SL giao';if($price<0)$errors[]='Đơn giá < 0';if($over>0&&$overReason==='')$errors[]='Nhận vượt nhưng thiếu lý do';if($rejected>0&&$quality==='ACCEPTED')$errors[]='Có hàng loại nhưng trạng thái = ACCEPTED';if($accepted===0.0&&$delivered>0&&$quality!=='REJECTED')$errors[]='Không nhận hàng đạt nhưng chưa đánh dấu REJECTED';if($accepted>0&&$rejected>0&&$quality!=='PARTIAL_REJECT')$errors[]='Có hàng đạt + hàng loại nhưng chưa đánh dấu PARTIAL_REJECT';if($materialId===''&&$itemClass==='STOCK')$errors[]='Thiếu Mã vật tư';return$errors;
    }

    private function nextReceiptCode(): string
    {
        $today=date('Y-m-d');$this->db->prepare('INSERT INTO document_sequences(doc_type,doc_date,last_no) VALUES("RECEIPT",?,1) ON DUPLICATE KEY UPDATE last_no=last_no+1')->execute([$today]);$stmt=$this->db->prepare('SELECT last_no FROM document_sequences WHERE doc_type="RECEIPT" AND doc_date=? FOR UPDATE');$stmt->execute([$today]);return 'PN'.date('ymd').'-'.str_pad((string)$stmt->fetchColumn(),3,'0',STR_PAD_LEFT);
    }

    private function audit(string $email,string $action,string $receiptId,string $clientId,string $reason,string $old,string $new): void
    { $this->db->prepare('INSERT INTO audit_logs(user_email,action,object_type,object_id,old_value,new_value,reason,client_request_id,environment) VALUES(?,?,"RECEIPT",?,?,?,?,?,?)')->execute([$email,$action,$receiptId,$old,$new,$reason,$clientId,getenv('KHO_ENV')?:'THU_NGHIEM']); }

    private function logError(string $email,string $clientId,\Throwable $e): void
    { try{$code=$e instanceof HttpException?$e->codeName:'RUNTIME_ERROR';$this->db->prepare('INSERT INTO error_logs(user_email,function_name,object_type,client_request_id,error_code,error_message,stack_or_context) VALUES(?,"createAndPostReceipt","RECEIPT",?,?,?,?)')->execute([$email,$clientId,$code,$e->getMessage(),$e->getTraceAsString()]);}catch(\Throwable){} }
}
