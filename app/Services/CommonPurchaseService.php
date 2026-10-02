<?php
declare(strict_types=1);

namespace KhoNpl\Services;

use KhoNpl\Core\Database;
use KhoNpl\Core\HttpException;

final class CommonPurchaseService
{
    private const OPERATION = 'COMMON_PURCHASE_CREATE';

    public function __construct(
        private readonly \PDO $db,
        private readonly AuthService $auth
    ) {}

    public function create(string $email, array $payload): array
    {
        $this->auth->require($email, ['PROCUREMENT']);

        $supplierId = s($payload['supplierId'] ?? '');
        $requestDate = date_ymd($payload['requestDate'] ?? null);
        $requiredDate = ($payload['requiredDate'] ?? '') !== ''
            ? date_ymd($payload['requiredDate'])
            : null;
        $note = s($payload['note'] ?? '');
        $clientId = s($payload['clientRequestId'] ?? '') ?: uuid_id('REQ');
        $lines = array_values(array_filter(
            (array)($payload['lines'] ?? []),
            fn($line) => n($line['qty'] ?? 0) > 0
        ));

        require_true($supplierId !== '', 'Thiếu NCC');
        require_true((bool)$lines, 'Chưa thêm vật tư mua SX chung');

        try {
            return Database::transaction(function () use (
                $email,
                $payload,
                $supplierId,
                $requestDate,
                $requiredDate,
                $note,
                $clientId,
                $lines
            ): array {
                $idempotent = $this->beginIdempotency($clientId, $email, $payload);
                if ($idempotent !== null) return $idempotent;

                $supplierStatement = $this->db->prepare(
                    'SELECT supplier_id,supplier_short_code,supplier_display_name
                     FROM suppliers
                     WHERE supplier_id=? AND is_active=1
                     FOR UPDATE'
                );
                $supplierStatement->execute([$supplierId]);
                $supplier = $supplierStatement->fetch();
                require_true(
                    (bool)$supplier,
                    'NCC không có trong danh mục: ' . $supplierId,
                    'SUPPLIER_NOT_FOUND',
                    404
                );
                $supplierName = s($supplier['supplier_display_name'])
                    ?: s($supplier['supplier_short_code'])
                    ?: $supplierId;

                $materialStatement = $this->db->prepare(
                    'SELECT material_id,material_name,uom,item_class
                     FROM materials
                     WHERE material_id=? AND is_active=1'
                );
                $seen = [];
                $prepared = [];
                $estimatedAmount = 0.0;

                foreach ($lines as $index => $line) {
                    $materialId = code($line['materialId'] ?? '');
                    require_true($materialId !== '', 'Dòng ' . ($index + 1) . ': Thiếu Mã vật tư');
                    require_true(
                        !isset($seen[$materialId]),
                        'Vật tư bị lặp trong cùng ĐNMH SX chung: ' . $materialId,
                        'BLOCK_DUPLICATE_MATERIAL'
                    );
                    $seen[$materialId] = true;

                    $materialStatement->execute([$materialId]);
                    $material = $materialStatement->fetch();
                    require_true(
                        (bool)$material,
                        'Không tìm thấy vật tư active: ' . $materialId,
                        'MATERIAL_NOT_FOUND',
                        404
                    );
                    require_true(
                        s($material['item_class']) === 'STOCK',
                        'Chỉ mua SX chung cho vật tư STOCK: ' . $materialId,
                        'INVALID_ITEM_CLASS'
                    );

                    $qty = positive($line['qty'] ?? 0, 'Số lượng phải > 0: ' . $materialId);
                    $unitPrice = n($line['unitPrice'] ?? 0);
                    require_true($unitPrice >= 0, 'Đơn giá không hợp lệ: ' . $materialId);
                    $lineRequiredDate = ($line['requiredDate'] ?? '') !== ''
                        ? date_ymd($line['requiredDate'])
                        : $requiredDate;

                    $prepared[] = [
                        'material' => $material,
                        'qty' => $qty,
                        'unit_price' => $unitPrice,
                        'required_date' => $lineRequiredDate,
                        'note' => s($line['note'] ?? ''),
                    ];
                    $estimatedAmount += $qty * $unitPrice;
                }

                $commonPrId = uuid_id('CPR');
                $commonPrCode = $this->nextCode();
                $this->db->prepare(
                    'INSERT INTO common_purchase_requests(
                        common_pr_id,common_pr_code,request_date,supplier_id,
                        supplier_name_snapshot,required_date,status,requested_by,note,
                        client_request_id,line_count,estimated_amount
                     ) VALUES(?,?,?,?,?,? ,"OPEN",?,?,?,?,?)'
                )->execute([
                    $commonPrId,
                    $commonPrCode,
                    $requestDate,
                    $supplierId,
                    $supplierName,
                    $requiredDate,
                    $email,
                    $note,
                    $clientId,
                    count($prepared),
                    $estimatedAmount,
                ]);

                $insertLine = $this->db->prepare(
                    'INSERT INTO common_purchase_request_lines(
                        common_pr_line_id,common_pr_id,common_pr_code,pr_ref_key,
                        material_id,material_name_snapshot,uom_snapshot,ordered_qty,
                        estimated_unit_price,estimated_amount,received_qty,remaining_qty,
                        line_status,required_date,note
                     ) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,"OPEN",?,?)'
                );
                $responseLines = [];
                foreach ($prepared as $line) {
                    $lineId = uuid_id('CPL');
                    $material = $line['material'];
                    $insertLine->execute([
                        $lineId,
                        $commonPrId,
                        $commonPrCode,
                        $lineId,
                        $material['material_id'],
                        $material['material_name'],
                        $material['uom'],
                        $line['qty'],
                        $line['unit_price'],
                        $line['qty'] * $line['unit_price'],
                        $line['qty'],
                        $line['required_date'],
                        $line['note'],
                    ]);
                    $responseLines[] = [
                        'commonPrLineId' => $lineId,
                        'prRefKey' => $lineId,
                        'materialId' => $material['material_id'],
                        'materialName' => $material['material_name'],
                        'uom' => $material['uom'],
                        'qty' => $line['qty'],
                        'unitPrice' => $line['unit_price'],
                        'requiredDate' => $line['required_date'],
                    ];
                }

                $this->audit($email, $commonPrId, $clientId);

                $response = [
                    'ok' => true,
                    'idempotent' => false,
                    'commonPrId' => $commonPrId,
                    'commonPrCode' => $commonPrCode,
                    'clientRequestId' => $clientId,
                    'requestDate' => $requestDate,
                    'supplierId' => $supplierId,
                    'supplierName' => $supplierName,
                    'status' => 'OPEN',
                    'lineCount' => count($responseLines),
                    'estimatedAmount' => $estimatedAmount,
                    'lines' => $responseLines,
                ];
                $this->db->prepare(
                    'UPDATE idempotency_requests
                     SET status="DONE",response_json=?,completed_at=NOW()
                     WHERE client_request_id=?'
                )->execute([
                    json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    $clientId,
                ]);

                return $response;
            });
        } catch (\Throwable $error) {
            $this->logError($email, $clientId, $error);
            throw $error;
        }
    }

    private function beginIdempotency(string $clientId, string $email, array $payload): ?array
    {
        $hash = json_hash($payload);
        $statement = $this->db->prepare(
            'SELECT operation,user_email,request_hash,status,response_json
             FROM idempotency_requests
             WHERE client_request_id=?
             FOR UPDATE'
        );
        $statement->execute([$clientId]);
        $row = $statement->fetch();

        if ($row) {
            require_true(
                $row['operation'] === self::OPERATION,
                'client_request_id đã được dùng cho nghiệp vụ khác',
                'BLOCK_TRUNG_YEU_CAU',
                409
            );
            require_true(
                hash_equals((string)$row['request_hash'], $hash),
                'client_request_id đã được dùng với nội dung khác',
                'BLOCK_TRUNG_YEU_CAU',
                409
            );
            if ($row['status'] === 'DONE') {
                $response = json_decode((string)$row['response_json'], true) ?: [];
                $response['idempotent'] = true;
                return $response;
            }
            throw new HttpException('Yêu cầu đang được xử lý', 'REQUEST_IN_PROGRESS', 409);
        }

        $existing = $this->db->prepare(
            'SELECT common_pr_id,common_pr_code,request_date,supplier_id,
                    supplier_name_snapshot,status,line_count,estimated_amount
             FROM common_purchase_requests
             WHERE client_request_id=?
             FOR UPDATE'
        );
        $existing->execute([$clientId]);
        if ($header = $existing->fetch()) {
            return [
                'ok' => true,
                'idempotent' => true,
                'commonPrId' => $header['common_pr_id'],
                'commonPrCode' => $header['common_pr_code'],
                'clientRequestId' => $clientId,
                'requestDate' => $header['request_date'],
                'supplierId' => $header['supplier_id'],
                'supplierName' => $header['supplier_name_snapshot'],
                'status' => $header['status'],
                'lineCount' => (int)$header['line_count'],
                'estimatedAmount' => n($header['estimated_amount']),
            ];
        }

        $this->db->prepare(
            'INSERT INTO idempotency_requests(
                client_request_id,operation,user_email,request_hash,status
             ) VALUES(?,?,?,? ,"PROCESSING")'
        )->execute([$clientId, self::OPERATION, $email, $hash]);

        return null;
    }

    private function nextCode(): string
    {
        $now = new \DateTimeImmutable('now', new \DateTimeZone('Asia/Ho_Chi_Minh'));
        $today = $now->format('Y-m-d');
        $this->db->prepare(
            'INSERT INTO document_sequences(doc_type,doc_date,last_no)
             VALUES("COMMON_PR",?,1)
             ON DUPLICATE KEY UPDATE last_no=last_no+1'
        )->execute([$today]);
        $statement = $this->db->prepare(
            'SELECT last_no FROM document_sequences
             WHERE doc_type="COMMON_PR" AND doc_date=?
             FOR UPDATE'
        );
        $statement->execute([$today]);
        return 'SX' . $now->format('ymd') . '-' . str_pad((string)$statement->fetchColumn(), 3, '0', STR_PAD_LEFT);
    }

    private function audit(string $email, string $commonPrId, string $clientId): void
    {
        $this->db->prepare(
            'INSERT INTO audit_logs(
                user_email,action,object_type,object_id,old_value,new_value,
                reason,client_request_id,environment
             ) VALUES(?,"CREATE_COMMON_PR","COMMON_PR",?,"","OPEN",?,?,?)'
        )->execute([
            $email,
            $commonPrId,
            'Tạo ĐNMH SX chung',
            $clientId,
            getenv('KHO_ENV') ?: 'THU_NGHIEM',
        ]);
    }

    private function logError(string $email, string $clientId, \Throwable $error): void
    {
        try {
            $code = $error instanceof HttpException ? $error->codeName : 'RUNTIME_ERROR';
            $this->db->prepare(
                'INSERT INTO error_logs(
                    user_email,function_name,object_type,client_request_id,
                    error_code,error_message,stack_or_context
                 ) VALUES(?,"createCommonPurchaseRequest","COMMON_PR",?,?,?,?)'
            )->execute([
                $email,
                $clientId,
                $code,
                $error->getMessage(),
                $error->getTraceAsString(),
            ]);
        } catch (\Throwable) {
        }
    }
}
