<?php
declare(strict_types=1);

namespace KhoNpl\Controllers;

use KhoNpl\Core\Database;
use KhoNpl\Core\HttpException;
use KhoNpl\Core\Request;
use KhoNpl\Services\AuthService;
use KhoNpl\Services\InventoryService;
use KhoNpl\Services\QueryService;
use KhoNpl\Services\TransactionService;

final class ApiController
{
    public function handle(string $method, string $api, array $payload): mixed
    {
        $db=Database::connection();$auth=new AuthService($db);$inventory=new InventoryService($db);$query=new QueryService($db,$auth,$inventory);$tx=new TransactionService($db,$auth,$inventory);$receipt=new \KhoNpl\Services\ReceiptService($db,$auth,$inventory);$issue=new \KhoNpl\Services\IssueService($db,$auth,$inventory);$common=new \KhoNpl\Services\CommonPurchaseService($db,$auth);$reversal=new \KhoNpl\Services\ReversalService($db,$auth,$inventory);$email=Request::userEmail();
        return match($api) {
            'bootstrap' => $query->bootstrap($email),
            'health' => $query->health(),
            'opening-preflight' => $query->openingPreflight(),
            'sync-status' => $query->syncStatus(),
            'open-suppliers' => $query->openSuppliers(),
            'open-prs' => $query->openPrs((string)Request::query('supplierId','')),
            'pr-lines' => $query->prLines((string)Request::query('supplierId',''),(string)Request::query('prCode','')),
            'material-search' => $query->materialSearch((string)Request::query('q',''),(int)Request::query('limit',30)),
            'common-material-search' => $query->commonMaterialSearch($email,(string)Request::query('q',''),(int)Request::query('limit',30)),
            'supplier-search' => $query->supplierSearch((string)Request::query('q',''),(int)Request::query('limit',20)),
            'common-pr-list' => $query->commonPurchaseRequests($email,(int)Request::query('limit',50)),
            'common-pr-create' => $this->postOnly($method,fn()=> $common->create($email,$payload)),
            'reservation-context' => $tx->reservationContext($email,(string)Request::query('executionCode','')),
            'reservation-confirm' => $this->postOnly($method,fn()=> $tx->confirmReservations($email,$payload)),
            'issue-context' => $query->issueContext($email,(string)Request::query('executionCode','')),
            'returnable-issues' => $query->returnable($email,(string)Request::query('executionCode','')),
            'stock' => $query->stock((string)Request::query('q',''),(int)Request::query('limit',100)),
            'stock-trace' => $query->stockTrace($email,(string)Request::query('mode','product'),(string)Request::query('q',''),(int)Request::query('limit',300)),
            'documents' => $query->documents($email,$_GET),
            'document-detail' => $query->documentDetail($email,(string)Request::query('code','')),
            'adjustment-context' => $this->adjustmentContext($query,(string)Request::query('materialId','')),
            'reversal-preview' => $reversal->preview($email,(string)Request::query('code','')),
            'reverse' => $this->postOnly($method,fn()=> $reversal->reverse($email,$payload)),
            'receipt' => $this->postOnly($method,fn()=> $receipt->createAndPost($email,$payload)),
            'issue' => $this->postOnly($method,fn()=> $issue->createAndPost($email,$payload)),
            'return' => $this->postOnly($method,fn()=> $tx->returnMaterial($email,$payload)),
            'adjustment' => $this->postOnly($method,fn()=> $tx->adjustment($email,$payload)),
            default => throw new HttpException('API không tồn tại: '.$api,'NOT_FOUND',404),
        };
    }

    private function postOnly(string $method, callable $fn): mixed
    { if ($method!=='POST') throw new HttpException('API này chỉ nhận POST','METHOD_NOT_ALLOWED',405); return $fn(); }

    private function adjustmentContext(QueryService $query,string $materialId): array
    { $rows=$query->stock($materialId,5); if(!$rows) throw new HttpException('Không tìm thấy Mã vật tư: '.$materialId,'MATERIAL_NOT_FOUND',404); return $rows[0]; }
}
