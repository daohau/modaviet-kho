BEGIN;
INSERT INTO material(material_id,material_name,uom,item_class) VALUES ('BENCH-MAT','Benchmark material','bộ','STOCK') ON CONFLICT(material_id) DO UPDATE SET is_active=TRUE;
INSERT INTO supplier(supplier_id,supplier_display_name) VALUES ('BENCH-SUP','Benchmark Supplier') ON CONFLICT(supplier_id) DO NOTHING;

-- Cleanup previous benchmark in FK-safe order
DELETE FROM stock_ledger WHERE material_id='BENCH-MAT';
DELETE FROM receipt_line WHERE receipt_id IN (SELECT receipt_id FROM receipt_header WHERE supplier_id='BENCH-SUP');
DELETE FROM receipt_header WHERE supplier_id='BENCH-SUP';
DELETE FROM idempotency_request WHERE client_request_id LIKE 'BENCH-%';
DELETE FROM audit_log WHERE client_request_id LIKE 'BENCH-%';
DELETE FROM purchase_request_line WHERE pr_ref_key LIKE 'BENCH-PR-%';
DELETE FROM document_counter WHERE doc_type='RECEIPT' AND doc_date='2026-09-16';

INSERT INTO stock_balance(material_id,physical_qty,stock_value,avg_cost) VALUES('BENCH-MAT',0,0,0) ON CONFLICT(material_id) DO UPDATE SET physical_qty=0,stock_value=0,avg_cost=0,updated_at=now();
INSERT INTO purchase_request_line(pr_ref_key,pr_code,pr_date,supplier_id,supplier_display_name,execution_code,product_code,material_id,material_name,uom,ordered_qty,received_qty,remaining_qty,estimated_unit_price,status)
SELECT 'BENCH-PR-'||lpad(g::text,4,'0'),'BENCH-260916','2026-09-16','BENCH-SUP','Benchmark Supplier','BENCH-EXEC','BENCH-PROD-'||g,'BENCH-MAT','Benchmark material','bộ',1,0,1,1000,'OPEN'
FROM generate_series(1,300) g;
COMMIT;
