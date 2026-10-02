<?php
declare(strict_types=1);

namespace KhoNpl\Services;

use KhoNpl\Core\Database;
use KhoNpl\Core\HttpException;

final class IssueService
{
    private const EPSILON = 1.0E-9;

    public function __construct(
        private readonly \PDO $db,
        private readonly AuthService $auth,
        private readonly InventoryService $inventory
    ) {}

    public function createAndPost(string $email, array $payload): array
    {
        $this->auth->require($email, ['WAREHOUSE']);
        $execution = code($payload['executionCode'] ?? '');
        $issueDate = date_ymd($payload['issueDate'] ?? null);
        $clientId = s($payload['clientRequestId'] ?? '') ?: uuid_id('REQ');
        $selected = array_values(array_filter(
            (array)($payload['lines'] ?? []),
            fn(mixed $line): bool => is_array($line) && n($line['issueQty'] ?? 0) > 0
        ));

        require_true($execution !== '', 'Thiếu Mã biên bản/BBSX');
        require_true((bool)$selected, 'Chưa có dòng xuất');

        try {
            return Database::transaction(function () use ($email, $payload, $execution, $issueDate, $clientId, $selected): array {
                $idempotent = $this->beginIdempotency($clientId, $email, $payload);
                if ($idempotent !== null) return $idempotent;

                $reservationIds = [];
                foreach ($selected as $line) {
                    $reservationId = s($line['reservationId'] ?? '');
                    require_true($reservationId !== '', 'Thiếu reservation_id');
                    require_true(
                        !isset($reservationIds[$reservationId]),
                        'Reservation bị lặp trong cùng phiếu: ' . $reservationId,
                        'BLOCK_DUPLICATE_RESERVATION'
                    );
                    $reservationIds[$reservationId] = true;
                }

                $reservations = $this->loadReservations(array_keys($reservationIds));
                require_true(
                    count($reservations) === count($reservationIds),
                    'Có Reservation không tồn tại',
                    'RESERVATION_NOT_FOUND',
                    404
                );

                $issueId = uuid_id('ISS');
                $issueCode = $this->nextIssueCode();
                $issueType = s($payload['issueType'] ?? '') ?: 'PRODUCTION';
                $orderCode = s($payload['orderCode'] ?? '') ?: $execution;
                $department = s($payload['department'] ?? '') ?: 'SẢN XUẤT';

                $draftLines = [];
                foreach ($selected as $index => $input) {
                    $reservation = $reservations[s($input['reservationId'])];
                    require_true(
                        code($reservation['execution_code']) === $execution,
                        'Reservation không thuộc BBSX đã chọn',
                        'RESERVATION_EXECUTION_MISMATCH'
                    );
                    require_true(
                        in_array($reservation['status'], ['CONFIRMED', 'PARTIAL_ISSUED'], true) && n($reservation['remaining_reserved_qty']) > self::EPSILON,
                        'Reservation không còn hiệu lực: ' . $reservation['reservation_id'],
                        'RESERVATION_NOT_ACTIVE',
                        409
                    );

                    $material = $this->loadMaterial((string)$reservation['material_id']);
                    $allowance = $this->inventory->allowance((string)$reservation['material_id'], (string)$reservation['reservation_id'], true);
                    $qty = n($input['issueQty'] ?? 0);
                    $remainingBom = max(n($reservation['required_qty']) - n($reservation['issued_qty']), 0);
                    $varianceReason = s($input['varianceReason'] ?? '');
                    $errors = $this->validateLine($qty, $allowance, $remainingBom, $varianceReason);
                    require_true(!$errors, 'Dòng ' . ($index + 1) . ': ' . implode(' | ', $errors), 'BLOCK_VALIDATION', 409);

                    $draftLines[] = [
                        'issue_line_id' => uuid_id('IL'),
                        'reservation' => $reservation,
                        'material' => $material,
                        'qty' => $qty,
                        'remaining_bom' => $remainingBom,
                        'variance_reason' => $varianceReason,
                        'note' => s($input['note'] ?? ''),
                        'physical_before' => n($allowance['physical']),
                        'available_before' => n($allowance['allowed']),
                        'draft_cost' => n($allowance['avg']),
                    ];
                }

                $this->db->prepare(
                    'INSERT INTO issues(issue_id,issue_code,issue_date,issue_type,order_code,execution_code,department,receiver,status,issued_by,posted_by,posted_at,client_request_id,note,post_engine_status) VALUES(?,?,?,?,?,?,?,?,"DRAFT",?,NULL,NULL,?,?,NULL)'
                )->execute([
                    $issueId, $issueCode, $issueDate, $issueType, $orderCode, $execution,
                    $department, s($payload['receiver'] ?? ''), $email, $clientId, s($payload['note'] ?? '')
                ]);

                $insertLine = $this->db->prepare(
                    'INSERT INTO issue_lines(issue_line_id,issue_id,issue_code,reservation_id,product_code,material_id,material_name_snapshot,uom_snapshot,bom_required_qty,previous_issued_qty,remaining_bom_qty,physical_stock_before,available_stock_before,issue_qty,management_unit_cost,management_amount,variance_vs_bom,variance_reason,note,validation_status,validation_message,line_can_post,issue_status_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,"DRAFT")'
                );
                foreach ($draftLines as $line) {
                    $reservation = $line['reservation'];
                    $material = $line['material'];
                    $insertLine->execute([
                        $line['issue_line_id'], $issueId, $issueCode, $reservation['reservation_id'],
                        $reservation['product_code'], $reservation['material_id'], $material['material_name'],
                        $material['uom'], $reservation['required_qty'], $reservation['issued_qty'],
                        $line['remaining_bom'], $line['physical_before'], $line['available_before'],
                        $line['qty'], $line['draft_cost'], $line['qty'] * $line['draft_cost'],
                        max($line['qty'] - $line['remaining_bom'], 0), $line['variance_reason'], $line['note']
                    ]);
                }
                $this->audit($email, 'CREATE_ISSUE', $issueId, $clientId, 'Tạo phiếu nháp', '', 'DRAFT');

                // Apps Script kiểm tra lại toàn bộ dòng theo tồn và Reservation ngay trước khi ghi ledger.
                foreach ($draftLines as $index => $line) {
                    $reservation = $line['reservation'];
                    $allowance = $this->inventory->allowance((string)$reservation['material_id'], (string)$reservation['reservation_id'], true);
                    $errors = $this->validateLine($line['qty'], $allowance, $line['remaining_bom'], $line['variance_reason']);
                    require_true(!$errors, 'Dòng chưa ghi sổ ' . ($index + 1) . ': ' . implode(' | ', $errors), 'BLOCK_VALIDATION', 409);
                }

                $ledgerRows = 0;
                $resultLines = [];
                foreach ($draftLines as $line) {
                    $reservation = $line['reservation'];
                    $balance = $this->inventory->balance((string)$reservation['material_id'], true);
                    $movement = $this->inventory->movement([
                        'ledger_id' => 'LG-' . $line['issue_line_id'],
                        'transaction_date' => $issueDate,
                        'transaction_type' => $issueType === 'PRODUCTION' ? 'XUAT_SX' : 'XUAT_' . $issueType,
                        'transaction_id' => $issueId,
                        'transaction_line_id' => $line['issue_line_id'],
                        'document_code' => $issueCode,
                        'material_id' => $reservation['material_id'],
                        'qty_in' => 0,
                        'qty_out' => $line['qty'],
                        'unit_cost' => $balance['avg'],
                        'order_code' => $orderCode,
                        'execution_code' => $execution,
                        'product_code' => $reservation['product_code'],
                        'created_by' => $email,
                        'client_request_id' => $clientId,
                    ]);
                    $this->db->prepare(
                        'UPDATE issue_lines SET management_unit_cost=?,management_amount=?,validation_status="OK",validation_message="",line_can_post=1,issue_status_ref="POSTED" WHERE issue_line_id=?'
                    )->execute([$movement['unitCost'], $movement['amountOut'], $line['issue_line_id']]);
                    $ledgerRows++;
                    $resultLines[] = [
                        'issueLineId' => $line['issue_line_id'],
                        'materialId' => $reservation['material_id'],
                        'issueQty' => $line['qty'],
                    ];
                }

                foreach (array_keys($reservationIds) as $reservationId) $this->recalculateReservation($reservationId);

                $this->audit($email, 'POST_ISSUE', $issueId, $clientId, 'POST hợp lệ', 'DRAFT', 'POSTED');
                $this->db->prepare(
                    'UPDATE issues SET status="POSTED",posted_by=?,posted_at=NOW(),post_engine_status="DA_GHI_SO" WHERE issue_id=?'
                )->execute([$email, $issueId]);

                $response = [
                    'issueId' => $issueId,
                    'issueCode' => $issueCode,
                    'clientRequestId' => $clientId,
                    'lineCount' => count($draftLines),
                    'idempotentDraft' => false,
                    'ok' => true,
                    'idempotent' => false,
                    'ledgerRows' => $ledgerRows,
                    'lines' => $resultLines,
                ];
                $this->finishIdempotency($clientId, $response);
                return $response;
            });
        } catch (\Throwable $error) {
            $this->logError($email, $clientId, $error);
            throw $error;
        }
    }

    private function loadReservations(array $ids): array
    {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $statement = $this->db->prepare("SELECT * FROM reservations WHERE reservation_id IN ($placeholders) FOR UPDATE");
        $statement->execute($ids);
        $rows = [];
        foreach ($statement->fetchAll() as $row) $rows[$row['reservation_id']] = $row;
        return $rows;
    }

    private function loadMaterial(string $materialId): array
    {
        $statement = $this->db->prepare('SELECT material_id,material_name,uom,item_class FROM materials WHERE material_id=? AND is_active=1');
        $statement->execute([$materialId]);
        $material = $statement->fetch();
        require_true((bool)$material, 'Không tìm thấy Mã vật tư: ' . $materialId, 'MATERIAL_NOT_FOUND', 404);
        return $material;
    }

    private function validateLine(float $qty, array $allowance, float $remainingBom, string $varianceReason): array
    {
        $errors = [];
        if ($qty <= 0) $errors[] = 'SL xuất phải > 0';
        if ($qty > n($allowance['physical']) + self::EPSILON) $errors[] = 'SL xuất lớn hơn tồn vật lý';
        if ($qty > n($allowance['allowed']) + self::EPSILON) $errors[] = 'SL xuất vượt phần khả dụng cho đơn này';
        if ($qty > $remainingBom + self::EPSILON && $varianceReason === '') $errors[] = 'Xuất vượt BOM nhưng thiếu lý do';
        return $errors;
    }

    private function recalculateReservation(string $reservationId): void
    {
        $statement = $this->db->prepare('SELECT confirmed_reserved_qty,released_qty FROM reservations WHERE reservation_id=? FOR UPDATE');
        $statement->execute([$reservationId]);
        $reservation = $statement->fetch();
        if (!$reservation) return;

        $statement = $this->db->prepare('SELECT COALESCE(SUM(issue_qty),0) FROM issue_lines WHERE reservation_id=? AND issue_status_ref="POSTED"');
        $statement->execute([$reservationId]);
        $postedIssued = n($statement->fetchColumn());
        $remaining = max(n($reservation['confirmed_reserved_qty']) - $postedIssued - n($reservation['released_qty']), 0);
        $status = $remaining <= self::EPSILON ? 'CLOSED' : ($postedIssued > self::EPSILON ? 'PARTIAL_ISSUED' : 'CONFIRMED');
        $this->db->prepare('UPDATE reservations SET issued_qty=?,remaining_reserved_qty=?,status=?,updated_at=NOW() WHERE reservation_id=?')
            ->execute([$postedIssued, $remaining, $status, $reservationId]);
    }

    private function nextIssueCode(): string
    {
        $now = new \DateTimeImmutable('now', new \DateTimeZone('Asia/Ho_Chi_Minh'));
        $date = $now->format('Y-m-d');
        $this->db->prepare('INSERT INTO document_sequences(doc_type,doc_date,last_no) VALUES("ISSUE",?,1) ON DUPLICATE KEY UPDATE last_no=last_no+1')
            ->execute([$date]);
        $statement = $this->db->prepare('SELECT last_no FROM document_sequences WHERE doc_type="ISSUE" AND doc_date=? FOR UPDATE');
        $statement->execute([$date]);
        return 'PX' . $now->format('ymd') . '-' . str_pad((string)$statement->fetchColumn(), 3, '0', STR_PAD_LEFT);
    }

    private function beginIdempotency(string $clientId, string $email, array $payload): ?array
    {
        $statement = $this->db->prepare('SELECT operation,request_hash,status,response_json FROM idempotency_requests WHERE client_request_id=? FOR UPDATE');
        $statement->execute([$clientId]);
        $row = $statement->fetch();
        $hash = json_hash($payload);
        if ($row) {
            require_true($row['operation'] === 'ISSUE_POST', 'client_request_id đã được dùng cho nghiệp vụ khác', 'BLOCK_TRUNG_YEU_CAU', 409);
            require_true(hash_equals((string)$row['request_hash'], $hash), 'client_request_id đã được dùng với nội dung khác', 'BLOCK_TRUNG_YEU_CAU', 409);
            if ($row['status'] === 'DONE') {
                $response = json_decode((string)$row['response_json'], true) ?: [];
                $response['idempotent'] = true;
                return $response;
            }
            throw new HttpException('Yêu cầu đang được xử lý', 'REQUEST_IN_PROGRESS', 409);
        }

        $existing = $this->db->prepare('SELECT issue_id,issue_code,status FROM issues WHERE client_request_id=? FOR UPDATE');
        $existing->execute([$clientId]);
        if ($issue = $existing->fetch()) {
            return [
                'ok' => $issue['status'] === 'POSTED',
                'idempotent' => true,
                'issueId' => $issue['issue_id'],
                'issueCode' => $issue['issue_code'],
                'clientRequestId' => $clientId,
            ];
        }

        $this->db->prepare('INSERT INTO idempotency_requests(client_request_id,operation,user_email,request_hash,status) VALUES(?,?,?,? ,"PROCESSING")')
            ->execute([$clientId, 'ISSUE_POST', $email, $hash]);
        return null;
    }

    private function finishIdempotency(string $clientId, array $response): void
    {
        $this->db->prepare('UPDATE idempotency_requests SET status="DONE",response_json=?,completed_at=NOW() WHERE client_request_id=?')
            ->execute([json_encode($response, JSON_UNESCAPED_UNICODE), $clientId]);
    }

    private function audit(string $email, string $action, string $issueId, string $clientId, string $reason, string $old, string $new): void
    {
        $this->db->prepare('INSERT INTO audit_logs(user_email,action,object_type,object_id,old_value,new_value,reason,client_request_id,environment) VALUES(?,? ,"ISSUE",?,?,?,?,?,?)')
            ->execute([$email, $action, $issueId, $old, $new, $reason, $clientId, getenv('KHO_ENV') ?: 'THU_NGHIEM']);
    }

    private function logError(string $email, string $clientId, \Throwable $error): void
    {
        try {
            $code = $error instanceof HttpException ? $error->codeName : 'RUNTIME_ERROR';
            $this->db->prepare('INSERT INTO error_logs(user_email,function_name,object_type,client_request_id,error_code,error_message,stack_or_context) VALUES(?,"createAndPostIssue","ISSUE",?,?,?,?)')
                ->execute([$email, $clientId, $code, $error->getMessage(), $error->getTraceAsString()]);
        } catch (\Throwable) {}
    }
}
