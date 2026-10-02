<?php
declare(strict_types=1);

namespace KhoNpl\Services;

use KhoNpl\Core\HttpException;

final class QueryService
{
    public function __construct(private readonly \PDO $db, private readonly AuthService $auth, private readonly InventoryService $inventory) {}

    public function bootstrap(string $email): array
    {
        $access=$this->auth->access($email);return ['environment'=>getenv('KHO_ENV')?:'THU_NGHIEM','user'=>$access['email'],'roles'=>$access['roles'],'pilotFallback'=>$access['pilotFallback'],'opening'=>$this->openingPreflight(),'health'=>$this->health(),'suppliers'=>$this->openSuppliers(),'syncStatus'=>$this->syncStatus()];
    }

    public function openSuppliers(): array
    { $sql="SELECT supplier_id,supplier_name,COUNT(*) open_lines,COUNT(DISTINCT pr_code) open_pr_count FROM purchase_request_lines WHERE operational_active_flag=1 AND remaining_qty>0 GROUP BY supplier_id,supplier_name UNION ALL SELECT h.supplier_id,h.supplier_name_snapshot,COUNT(l.common_pr_line_id),COUNT(DISTINCT h.common_pr_code) FROM common_purchase_requests h JOIN common_purchase_request_lines l ON l.common_pr_id=h.common_pr_id WHERE h.status='OPEN' AND l.remaining_qty>0 GROUP BY h.supplier_id,h.supplier_name_snapshot ORDER BY supplier_name LIMIT 300";$rows=$this->db->query($sql)->fetchAll();$map=[];foreach($rows as $r){$key=(string)$r['supplier_id'];if(!isset($map[$key]))$map[$key]=['supplierId'=>$key,'supplierName'=>$r['supplier_name'],'openLines'=>0,'openPrCount'=>0];$map[$key]['openLines']+=(int)$r['open_lines'];$map[$key]['openPrCount']+=(int)$r['open_pr_count'];}return array_values($map); }

    public function openPrs(string $supplierId): array
    { $st=$this->db->prepare("SELECT pr_code,MIN(pr_date) pr_date,supplier_id,MAX(supplier_name) supplier_name,COUNT(*) line_count,SUM(remaining_qty) remaining_qty FROM purchase_request_lines WHERE operational_active_flag=1 AND remaining_qty>0 AND supplier_id=? GROUP BY pr_code,supplier_id UNION ALL SELECT h.common_pr_code,h.request_date,h.supplier_id,h.supplier_name_snapshot,COUNT(l.common_pr_line_id),SUM(l.remaining_qty) FROM common_purchase_requests h JOIN common_purchase_request_lines l ON l.common_pr_id=h.common_pr_id WHERE h.status='OPEN' AND l.remaining_qty>0 AND h.supplier_id=? GROUP BY h.common_pr_code,h.request_date,h.supplier_id,h.supplier_name_snapshot ORDER BY pr_date DESC");$st->execute([$supplierId,$supplierId]);return array_map(fn($r)=>['prCode'=>$r['pr_code'],'prDate'=>$r['pr_date'],'supplierId'=>$r['supplier_id'],'supplierName'=>$r['supplier_name'],'lineCount'=>(int)$r['line_count'],'remainingQty'=>n($r['remaining_qty'])],$st->fetchAll()); }

    public function prLines(string $supplierId,string $prCode): array
    { $st=$this->db->prepare("SELECT pr_ref_key,pr_code,order_code,execution_code,product_code,material_id,material_name,uom,ordered_qty,received_qty,remaining_qty,estimated_unit_price,required_date,'STANDARD' source_type FROM purchase_request_lines WHERE operational_active_flag=1 AND remaining_qty>0 AND supplier_id=? AND pr_code=? UNION ALL SELECT l.pr_ref_key,h.common_pr_code,'','SX_CHUNG','',l.material_id,l.material_name_snapshot,l.uom_snapshot,l.ordered_qty,l.received_qty,l.remaining_qty,l.estimated_unit_price,l.required_date,'COMMON' FROM common_purchase_request_lines l JOIN common_purchase_requests h ON h.common_pr_id=l.common_pr_id WHERE h.status='OPEN' AND l.remaining_qty>0 AND h.supplier_id=? AND h.common_pr_code=? ORDER BY pr_ref_key");$st->execute([$supplierId,$prCode,$supplierId,$prCode]);return array_map(fn($r)=>['prRefKey'=>$r['pr_ref_key'],'prCode'=>$r['pr_code'],'orderCode'=>$r['order_code'],'executionCode'=>$r['execution_code'],'productCode'=>$r['product_code'],'materialId'=>$r['material_id'],'materialName'=>$r['material_name'],'uom'=>$r['uom'],'orderedQty'=>n($r['ordered_qty']),'receivedQty'=>n($r['received_qty']),'remainingQty'=>n($r['remaining_qty']),'estimatedUnitPrice'=>n($r['estimated_unit_price']),'requiredDate'=>$r['required_date'],'sourceType'=>$r['source_type']],$st->fetchAll()); }

    public function issueContext(string $email,string $execution): array
    { $this->auth->require($email,['WAREHOUSE']);$execution=code($execution);$st=$this->db->prepare("SELECT r.*,m.material_name,m.uom,b.physical_qty,b.avg_cost FROM reservations r JOIN materials m ON m.material_id=r.material_id LEFT JOIN stock_balances b ON b.material_id=r.material_id WHERE r.execution_code=? AND r.status IN ('CONFIRMED','PARTIAL_ISSUED') AND r.remaining_reserved_qty>0 ORDER BY r.product_code,r.material_id");$st->execute([$execution]);$out=[];foreach($st->fetchAll()as$r){$a=$this->inventory->allowance($r['material_id'],$r['reservation_id']);$out[]=['reservationId'=>$r['reservation_id'],'executionCode'=>$r['execution_code'],'productCode'=>$r['product_code'],'materialId'=>$r['material_id'],'materialName'=>$r['material_name'],'uom'=>$r['uom'],'requiredQty'=>n($r['required_qty']),'issuedQty'=>n($r['issued_qty']),'remainingBomQty'=>max(n($r['required_qty'])-n($r['issued_qty']),0),'remainingReservedQty'=>n($r['remaining_reserved_qty']),'physicalStock'=>$a['physical'],'globalAvailable'=>$a['globalAvailable'],'allowedForThisOrder'=>$a['allowed'],'avgCost'=>n($r['avg_cost'])];}return$out; }

    public function returnable(string $email,string $execution): array
    { $this->auth->require($email,['WAREHOUSE']);$st=$this->db->prepare("SELECT il.issue_line_id,i.issue_code,i.issue_date,i.execution_code,il.product_code,il.material_id,il.material_name_snapshot,il.uom_snapshot,il.issue_qty,il.management_unit_cost,COALESCE(SUM(CASE WHEN r.status='POSTED' THEN r.return_qty ELSE 0 END),0) returned_qty FROM issue_lines il JOIN issues i ON i.issue_id=il.issue_id LEFT JOIN production_returns r ON r.source_issue_line_id=il.issue_line_id WHERE i.status='POSTED' AND i.execution_code=? GROUP BY il.issue_line_id,i.issue_code,i.issue_date,i.execution_code,il.product_code,il.material_id,il.material_name_snapshot,il.uom_snapshot,il.issue_qty,il.management_unit_cost HAVING il.issue_qty- returned_qty>0");$st->execute([code($execution)]);return array_map(fn($r)=>['issueLineId'=>$r['issue_line_id'],'issueCode'=>$r['issue_code'],'issueDate'=>$r['issue_date'],'executionCode'=>$r['execution_code'],'productCode'=>$r['product_code'],'materialId'=>$r['material_id'],'materialName'=>$r['material_name_snapshot'],'uom'=>$r['uom_snapshot'],'issuedQty'=>n($r['issue_qty']),'returnedQty'=>n($r['returned_qty']),'returnableQty'=>n($r['issue_qty'])-n($r['returned_qty']),'unitCost'=>n($r['management_unit_cost'])],$st->fetchAll()); }

    public function stock(string $query='',int $limit=100): array
    { $limit=max(1,min($limit,200));$like='%'.strtolower($query).'%';$st=$this->db->prepare("SELECT material_id,material_name,uom,item_class,physical_qty,reserved_qty,available_qty,avg_cost,stock_value FROM v_stock WHERE LOWER(CONCAT(material_id,' ',material_name)) LIKE ? ORDER BY material_id LIMIT $limit");$st->execute([$like]);return array_map(fn($r)=>['materialId'=>$r['material_id'],'materialName'=>$r['material_name'],'uom'=>$r['uom'],'itemClass'=>$r['item_class'],'onHand'=>n($r['physical_qty']),'reserved'=>n($r['reserved_qty']),'available'=>n($r['available_qty']),'avgCost'=>n($r['avg_cost']),'stockValue'=>n($r['stock_value'])],$st->fetchAll()); }

    public function stockTrace(string $email,string $mode,string $query,int $limit=300): array
    {
        $this->auth->access($email);
        $mode=strtolower(trim($mode));
        require_true(in_array($mode,['product','material'],true),'Kiểu tra tồn không hợp lệ','INVALID_STOCK_TRACE_MODE',422);
        $query=code($query);
        require_true($query!=='','Vui lòng nhập '.($mode==='product'?'Mã sản phẩm':'Mã vật tư'),'STOCK_TRACE_QUERY_REQUIRED',422);
        $limit=max(1,min($limit,500));
        $filter=$mode==='product'
            ? "UPPER(COALESCE(source_product_code,'')) LIKE ?"
            : "UPPER(CONCAT(material_id,' ',material_name)) LIKE ?";
        $sql="WITH inbound AS (
                SELECT l.ledger_id,l.posted_at,l.transaction_date source_date,l.transaction_line_id source_receipt_line_id,
                       l.document_code source_receipt_code,l.material_id,m.material_name,m.uom,
                       CASE
                         WHEN l.transaction_type='OPENING_BALANCE' THEN 'OPENING'
                         WHEN l.transaction_type='NHAP_MUA' THEN 'PURCHASE'
                         WHEN l.transaction_type='TRA_SX' THEN 'RETURN'
                         WHEN l.transaction_type='DIEU_CHINH_TANG' THEN 'ADJUSTMENT'
                         WHEN l.transaction_type LIKE 'DAO_%' THEN 'REVERSAL'
                         ELSE l.transaction_type
                       END source_type,
                       COALESCE(NULLIF(rl.pr_code,''),NULLIF(l.pr_code,''),'') pr_code,
                       COALESCE(NULLIF(rh.supplier_id,''),NULLIF(l.supplier_id,''),'') source_supplier_id,
                       COALESCE(NULLIF(rh.supplier_name_snapshot,''),NULLIF(s.supplier_display_name,''),'') source_supplier_name,
                       CASE
                         WHEN NULLIF(rl.lot_no,'') IS NOT NULL THEN rl.lot_no
                         WHEN l.transaction_type='OPENING_BALANCE' THEN 'TỒN ĐẦU'
                         WHEN l.transaction_type='TRA_SX' THEN 'TRẢ SẢN XUẤT'
                         WHEN l.transaction_type='DIEU_CHINH_TANG' THEN 'ĐIỀU CHỈNH TĂNG'
                         WHEN l.transaction_type LIKE 'DAO_%' THEN 'ĐẢO GIAO DỊCH'
                         ELSE ''
                       END source_lot_no,
                       COALESCE(NULLIF(rl.execution_code,''),NULLIF(pr.execution_code,''),NULLIF(l.execution_code,''),'') source_execution_code,
                       COALESCE(NULLIF(rl.product_code,''),NULLIF(pr.product_code,''),NULLIF(l.product_code,''),'') source_product_code,
                       l.qty_in received_qty,l.unit_cost
                FROM stock_ledger l
                JOIN materials m ON m.material_id=l.material_id
                LEFT JOIN receipt_lines rl ON rl.receipt_line_id=l.transaction_line_id AND l.transaction_type='NHAP_MUA'
                LEFT JOIN receipts rh ON rh.receipt_id=rl.receipt_id
                LEFT JOIN suppliers s ON s.supplier_id=l.supplier_id
                LEFT JOIN production_returns pr ON pr.return_id=l.transaction_line_id AND l.transaction_type='TRA_SX'
                WHERE l.qty_in>0
            ), ranked AS (
                SELECT i.*,
                       SUM(i.received_qty) OVER (
                           PARTITION BY i.material_id
                           ORDER BY i.source_date,i.posted_at,i.ledger_id
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                       ) cumulative_in
                FROM inbound i
            ), outbound AS (
                SELECT material_id,SUM(qty_out) outbound_qty
                FROM stock_ledger
                GROUP BY material_id
            ), lot_balances AS (
                SELECT r.*,
                       GREATEST(r.received_qty-GREATEST(COALESCE(o.outbound_qty,0)-(r.cumulative_in-r.received_qty),0),0) on_hand_lot
                FROM ranked r
                LEFT JOIN outbound o ON o.material_id=r.material_id
            )
            SELECT source_receipt_line_id,material_id,material_name,uom,source_type,source_receipt_code,source_date,
                   pr_code,source_supplier_id,source_supplier_name,source_lot_no,source_execution_code,source_product_code,
                   received_qty,received_qty-on_hand_lot consumed_qty,on_hand_lot,unit_cost,on_hand_lot*unit_cost lot_value
            FROM lot_balances
            WHERE on_hand_lot>0 AND $filter
            ORDER BY material_id,source_date,source_receipt_code,source_receipt_line_id
            LIMIT $limit";
        $st=$this->db->prepare($sql);
        $st->execute(['%'.$query.'%']);
        $details=array_map(fn($r)=>[
            'sourceReceiptLineId'=>$r['source_receipt_line_id'],
            'materialId'=>$r['material_id'],
            'materialName'=>$r['material_name'],
            'uom'=>$r['uom'],
            'sourceType'=>$r['source_type'],
            'sourceReceiptCode'=>$r['source_receipt_code'],
            'sourceReceiptDate'=>$r['source_date'],
            'prCode'=>$r['pr_code'],
            'sourceSupplierId'=>$r['source_supplier_id'],
            'sourceSupplierName'=>$r['source_supplier_name'],
            'sourceLotNo'=>$r['source_lot_no'],
            'sourceExecutionCode'=>$r['source_execution_code'],
            'sourceProductCode'=>$r['source_product_code'],
            'receivedQty'=>n($r['received_qty']),
            'consumedQty'=>n($r['consumed_qty']),
            'onHandLot'=>n($r['on_hand_lot']),
            'unitCost'=>n($r['unit_cost']),
            'lotValue'=>n($r['lot_value']),
        ],$st->fetchAll());

        $materialIds=array_values(array_unique(array_column($details,'materialId')));
        if($mode==='product'&&count($materialIds)===0){
            $summary=[];
        }elseif($mode==='product'){
            $placeholders=implode(',',array_fill(0,count($materialIds),'?'));
            $summarySt=$this->db->prepare("SELECT material_id,material_name,uom,physical_qty,reserved_qty,available_qty,avg_cost,stock_value FROM v_stock WHERE material_id IN ($placeholders) ORDER BY material_id");
            $summarySt->execute($materialIds);
            $summary=$summarySt->fetchAll();
        }else{
            $summarySt=$this->db->prepare('SELECT material_id,material_name,uom,physical_qty,reserved_qty,available_qty,avg_cost,stock_value FROM v_stock WHERE UPPER(CONCAT(material_id," ",material_name)) LIKE ? ORDER BY material_id LIMIT 200');
            $summarySt->execute(['%'.$query.'%']);
            $summary=$summarySt->fetchAll();
        }
        $summary=array_map(fn($r)=>[
            'materialId'=>$r['material_id'],
            'materialName'=>$r['material_name'],
            'uom'=>$r['uom'],
            'onHand'=>n($r['physical_qty']),
            'reserved'=>n($r['reserved_qty']),
            'available'=>n($r['available_qty']),
            'avgCost'=>n($r['avg_cost']),
            'stockValue'=>n($r['stock_value']),
        ],$summary);
        return ['mode'=>$mode,'query'=>$query,'details'=>$details,'summary'=>$summary,'detailCount'=>count($details),'summaryCount'=>count($summary)];
    }

    public function materialSearch(string $query='',int $limit=30): array
    { $limit=max(1,min($limit,100));$like='%'.strtolower($query).'%';$st=$this->db->prepare("SELECT material_id,material_name,uom,item_class FROM materials WHERE is_active=1 AND LOWER(CONCAT(material_id,' ',material_name)) LIKE ? ORDER BY material_id LIMIT $limit");$st->execute([$like]);return array_map(fn($r)=>['materialId'=>$r['material_id'],'materialName'=>$r['material_name'],'uom'=>$r['uom'],'itemClass'=>$r['item_class']],$st->fetchAll()); }

    public function commonMaterialSearch(string $email,string $query='',int $limit=30): array
    { $this->auth->require($email,['PROCUREMENT']);$limit=max(1,min($limit,100));$like='%'.strtolower(trim($query)).'%';$st=$this->db->prepare("SELECT material_id,material_name,uom,item_class FROM materials WHERE is_active=1 AND item_class='STOCK' AND LOWER(CONCAT(material_id,' ',material_name)) LIKE ? ORDER BY material_id LIMIT $limit");$st->execute([$like]);return array_map(fn($r)=>['materialId'=>$r['material_id'],'materialName'=>$r['material_name'],'uom'=>$r['uom'],'itemClass'=>$r['item_class']],$st->fetchAll()); }

    public function supplierSearch(string $query='',int $limit=20): array
    { $limit=max(1,min($limit,100));$needle=strtolower(trim($query));$like='%'.$needle.'%';$st=$this->db->prepare("SELECT supplier_id,supplier_short_code,supplier_display_name FROM suppliers WHERE is_active=1 AND LOWER(CONCAT(supplier_id,' ',supplier_short_code,' ',supplier_display_name)) LIKE ? ORDER BY CASE WHEN LOWER(supplier_id)=? THEN 0 WHEN LOWER(supplier_short_code)=? OR LOWER(supplier_display_name)=? THEN 1 ELSE 2 END,supplier_display_name,supplier_id LIMIT $limit");$st->execute([$like,$needle,$needle,$needle]);return array_map(fn($r)=>['supplierId'=>$r['supplier_id'],'supplierShortCode'=>$r['supplier_short_code'],'supplierName'=>$r['supplier_display_name']],$st->fetchAll()); }

    public function commonPurchaseRequests(string $email,int $limit=50): array
    { $this->auth->access($email);$limit=max(1,min($limit,100));$st=$this->db->query("SELECT h.common_pr_id,h.common_pr_code,h.request_date,h.supplier_id,h.supplier_name_snapshot,h.required_date,h.status,h.requested_by,h.note,h.client_request_id,h.line_count,h.estimated_amount,COALESCE(SUM(CASE WHEN l.remaining_qty>0 THEN 1 ELSE 0 END),0) open_lines,COALESCE(SUM(l.remaining_qty),0) remaining_qty FROM common_purchase_requests h LEFT JOIN common_purchase_request_lines l ON l.common_pr_id=h.common_pr_id GROUP BY h.common_pr_id ORDER BY h.created_at DESC LIMIT $limit");return array_map(fn($r)=>['commonPrId'=>$r['common_pr_id'],'commonPrCode'=>$r['common_pr_code'],'requestDate'=>$r['request_date'],'supplierId'=>$r['supplier_id'],'supplierName'=>$r['supplier_name_snapshot'],'requiredDate'=>$r['required_date'],'status'=>$r['status'],'requestedBy'=>$r['requested_by'],'note'=>$r['note'],'clientRequestId'=>$r['client_request_id'],'lineCount'=>(int)$r['line_count'],'openLines'=>(int)$r['open_lines'],'remainingQty'=>n($r['remaining_qty']),'estimatedAmount'=>n($r['estimated_amount'])],$st->fetchAll()); }

    public function documents(string $email,array $f): array
    { $this->auth->access($email);$out=[];$queries=[['RECEIPT','SELECT r.receipt_code code,r.receipt_date date,r.status,r.received_by user_email,r.supplier_id,COALESCE(SUM(rl.accepted_qty),0) qty,GROUP_CONCAT(DISTINCT rl.material_id SEPARATOR ", ") materials,GROUP_CONCAT(DISTINCT rl.execution_code SEPARATOR ", ") executions FROM receipts r LEFT JOIN receipt_lines rl ON rl.receipt_id=r.receipt_id GROUP BY r.receipt_id'],['ISSUE','SELECT i.issue_code code,i.issue_date date,i.status,i.issued_by user_email,"" supplier_id,SUM(il.issue_qty) qty,GROUP_CONCAT(DISTINCT il.material_id SEPARATOR ", ") materials,i.execution_code executions FROM issues i LEFT JOIN issue_lines il ON il.issue_id=i.issue_id GROUP BY i.issue_id'],['RETURN','SELECT r.return_code code,r.return_date date,r.status,r.received_by user_email,"" supplier_id,r.return_qty qty,r.material_id materials,r.execution_code executions FROM production_returns r'],['ADJUSTMENT','SELECT a.adjustment_code code,a.adjustment_date date,a.status,a.posted_by user_email,"" supplier_id,a.qty,a.material_id materials,"" executions FROM adjustments a']];foreach($queries as[$type,$sql]){foreach($this->db->query($sql)->fetchAll()as$r){$r['documentType']=$type;$r['documentTypeLabel']=['RECEIPT'=>'Nhập kho','ISSUE'=>'Xuất kho','RETURN'=>'Trả NPL','ADJUSTMENT'=>'Điều chỉnh'][$type];$r['qty']=n($r['qty']);$out[]=$r;}}$out=array_filter($out,function($r)use($f){if(($f['documentType']??'')&&$r['documentType']!==code($f['documentType']))return false;if(($f['status']??'')&&$r['status']!==code($f['status']))return false;if(($f['documentCode']??'')&&stripos($r['code'],s($f['documentCode']))===false)return false;if(($f['executionCode']??'')&&stripos((string)$r['executions'],s($f['executionCode']))===false)return false;if(($f['materialId']??'')&&stripos((string)$r['materials'],s($f['materialId']))===false)return false;if(($f['supplierId']??'')&&stripos((string)$r['supplier_id'],s($f['supplierId']))===false)return false;if(($f['userEmail']??'')&&stripos((string)$r['user_email'],s($f['userEmail']))===false)return false;if(($f['dateFrom']??'')&&$r['date']<date_ymd($f['dateFrom']))return false;if(($f['dateTo']??'')&&$r['date']>date_ymd($f['dateTo']))return false;return true;});usort($out,fn($a,$b)=>strcmp((string)$b['date'],(string)$a['date'])?:strcmp($b['code'],$a['code']));return array_slice(array_values($out),0,max(1,min((int)($f['limit']??50),100))); }

    public function documentDetail(string $email,string $code): array
    { $this->auth->access($email);$code=code($code);$list=$this->documents($email,['documentCode'=>$code,'limit'=>1]);require_true((bool)$list,'Không tìm thấy chứng từ: '.$code,'DOCUMENT_NOT_FOUND',404);$doc=$list[0];$lines=[];if($doc['documentType']==='RECEIPT'){$st=$this->db->prepare('SELECT material_id,material_name_snapshot material_name,execution_code,product_code,accepted_qty qty,actual_unit_price unit_cost,management_amount amount FROM receipt_lines WHERE receipt_code=?');$st->execute([$code]);$lines=$st->fetchAll();}elseif($doc['documentType']==='ISSUE'){$st=$this->db->prepare('SELECT material_id,material_name_snapshot material_name,? execution_code,product_code,issue_qty qty,management_unit_cost unit_cost,management_amount amount FROM issue_lines WHERE issue_code=?');$st->execute([$doc['executions'],$code]);$lines=$st->fetchAll();}elseif($doc['documentType']==='RETURN'){$st=$this->db->prepare('SELECT material_id,material_id material_name,execution_code,product_code,return_qty qty,unit_cost,amount FROM production_returns WHERE return_code=?');$st->execute([$code]);$lines=$st->fetchAll();}else{$st=$this->db->prepare('SELECT material_id,material_id material_name,"" execution_code,"" product_code,qty,unit_cost,amount,adjustment_type source_action,reference_transaction_id FROM adjustments WHERE adjustment_code=?');$st->execute([$code]);$lines=$st->fetchAll();}$doc['lines']=$lines;return$doc; }

    public function openingPreflight(): array
    { $ready=(int)$this->db->query("SELECT COUNT(*) FROM stock_ledger WHERE transaction_type='OPENING_BALANCE'")->fetchColumn();return['postEnabled'=>false,'candidateCount'=>(int)$this->db->query('SELECT COUNT(*) FROM materials')->fetchColumn(),'invalidCount'=>0,'postedOpeningRows'=>$ready,'status'=>'LOCKED']; }

    public function syncStatus(): array
    { return $this->db->query('SELECT source_code sourceCode,file_title fileTitle,sheet_name sheetName,mode,last_sync_at lastSync,sync_status status FROM source_syncs ORDER BY source_code')->fetchAll(); }

    public function health(): array
    { $checks=[];$add=function($c,$s,$d)use(&$checks){$checks[]=['code'=>$c,'status'=>$s,'detail'=>$d];};$add('DATABASE','PASS','MariaDB kết nối OK');$add('SOURCE_WRITE_ALLOWED','PASS','Ứng dụng PHP không ghi ngược Google Sheet');$add('OPENING_LOCK','PASS','Opening Balance đang khóa');$perm=(int)$this->db->query('SELECT COUNT(*) FROM user_roles WHERE is_active=1')->fetchColumn();$add('PERMISSIONS',$perm?'PASS':'BLOCK',$perm.' quyền đang hoạt động');$mat=(int)$this->db->query('SELECT COUNT(*) FROM materials WHERE is_active=1')->fetchColumn();$add('MATERIAL_MASTER',$mat?'PASS':'BLOCK',$mat.' vật tư active');$sync=(int)$this->db->query('SELECT COUNT(*) FROM source_syncs WHERE sync_status LIKE "OK%"')->fetchColumn();$add('SOURCE_SYNC',$sync?'PASS':'WARN',$sync.' nguồn snapshot OK');$block=count(array_filter($checks,fn($x)=>$x['status']==='BLOCK'));$warn=count(array_filter($checks,fn($x)=>$x['status']==='WARN'));return['status'=>$block?'BLOCK':($warn?'WARN':'PASS'),'blockCount'=>$block,'warnCount'=>$warn,'checks'=>$checks,'canGoLive'=>false]; }
}
