<?php
declare(strict_types=1);

namespace KhoNpl\Services;

use KhoNpl\Core\HttpException;

final class InventoryService
{
    public function __construct(private readonly \PDO $db) {}

    public function balance(string $materialId, bool $lock = false): array
    {
        $sql = 'SELECT * FROM stock_balances WHERE material_id=?' . ($lock ? ' FOR UPDATE' : '');
        $st = $this->db->prepare($sql); $st->execute([$materialId]); $row = $st->fetch();
        if (!$row) { $this->db->prepare('INSERT IGNORE INTO stock_balances(material_id) VALUES(?)')->execute([$materialId]); $st = $this->db->prepare($sql); $st->execute([$materialId]); $row = $st->fetch(); }
        return ['qty'=>n($row['physical_qty'] ?? 0), 'value'=>n($row['stock_value'] ?? 0), 'avg'=>n($row['avg_cost'] ?? 0)];
    }

    public function reservationTotals(string $materialId = ''): array|float
    {
        $sql = "SELECT material_id,SUM(remaining_reserved_qty) total_reserved FROM reservations WHERE status NOT IN ('CANCELLED','CLOSED') GROUP BY material_id";
        $rows = $this->db->query($sql)->fetchAll(); $map = [];
        foreach ($rows as $row) $map[$row['material_id']] = n($row['total_reserved']);
        return $materialId === '' ? $map : ($map[$materialId] ?? 0.0);
    }

    public function allowance(string $materialId, ?string $reservationId = null, bool $lock = false): array
    {
        $balance = $this->balance($materialId, $lock); $totals = $this->reservationTotals();
        $totalReserved = (float)($totals[$materialId] ?? 0); $own = 0.0;
        if ($reservationId) { $st=$this->db->prepare('SELECT remaining_reserved_qty FROM reservations WHERE reservation_id=?' . ($lock?' FOR UPDATE':'')); $st->execute([$reservationId]); $own=n($st->fetchColumn()); }
        $global = max($balance['qty'] - $totalReserved, 0); return ['physical'=>$balance['qty'], 'totalReserved'=>$totalReserved, 'globalAvailable'=>$global, 'ownReserved'=>$own, 'allowed'=>min($balance['qty'], $global+$own), 'avg'=>$balance['avg']];
    }

    public function movement(array $data): array
    {
        $material = s($data['material_id']); $before = $this->balance($material, true);
        $in = n($data['qty_in']); $out = n($data['qty_out']); $cost = n($data['unit_cost']);
        if ($out > $before['qty'] + 1e-9) throw new HttpException("$material chỉ còn {$before['qty']}, yêu cầu giảm $out", 'BLOCK_AM_KHO', 409);
        $qty = $before['qty'] + $in - $out; $value = $before['value'] + ($in * $cost) - ($out * $cost);
        if ($qty < -1e-9) throw new HttpException("Tồn âm: $material", 'BLOCK_AM_KHO', 409);
        $qty = abs($qty) < 1e-9 ? 0 : $qty; $value = abs($value) < 1e-6 ? 0 : $value; $avg = $qty > 0 ? $value / $qty : 0;
        $this->db->prepare('UPDATE stock_balances SET physical_qty=?,stock_value=?,avg_cost=? WHERE material_id=?')->execute([$qty,$value,$avg,$material]);
        $sql = 'INSERT INTO stock_ledger(ledger_id,posted_at,transaction_date,transaction_type,transaction_id,transaction_line_id,document_code,material_id,qty_in,qty_out,unit_cost,amount_in,amount_out,running_qty,running_value,avg_cost_after,order_code,execution_code,product_code,supplier_id,pr_code,created_by,source_environment,source_client_request_id) VALUES(?,NOW(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
        $this->db->prepare($sql)->execute([$data['ledger_id'], $data['transaction_date'], $data['transaction_type'], $data['transaction_id'], $data['transaction_line_id'], $data['document_code'], $material, $in, $out, $cost, $in*$cost, $out*$cost, $qty, $value, $avg, $data['order_code'] ?? '', $data['execution_code'] ?? '', $data['product_code'] ?? '', $data['supplier_id'] ?? '', $data['pr_code'] ?? '', $data['created_by'], getenv('KHO_ENV') ?: 'THU_NGHIEM', $data['client_request_id']]);
        return ['qty'=>$qty, 'value'=>$value, 'avg'=>$avg, 'unitCost'=>$cost, 'amountIn'=>$in*$cost, 'amountOut'=>$out*$cost];
    }
}
