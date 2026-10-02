BEGIN;
TRUNCATE TABLE audit_log, stock_ledger, production_return, issue_line, issue_header, receipt_line, receipt_header,
  idempotency_request, document_counter, reservation, stock_balance, purchase_request_line, order_product_snapshot,
  supplier, material, app_user_role RESTART IDENTITY CASCADE;

INSERT INTO app_user_role(email,role_code) VALUES
('tungnm@modaviet.vn','PILOT_ADMIN');
INSERT INTO material(material_id,material_name,uom,item_class) VALUES
('1BO-POLY06','Bo poly đen','bộ','STOCK'),
('1BO-POLY62','Bo poly xanh bích','bộ','STOCK');
INSERT INTO supplier(supplier_id,supplier_display_name) VALUES ('110733698','CHÂU ANH');
INSERT INTO order_product_snapshot(product_code,order_code,execution_code,execution_type,product_name,production_qty,status) VALUES
('S146926-AP01','S146926','S146926','S','AP01',153,'ACTIVE'),
('S146926-AP02','S146926','S146926','S','AP02',255,'ACTIVE'),
('S307626-AP01','S307626','S307626','S','AP01',420.24,'ACTIVE'),
('S307626-AP02','S307626','S307626','S','AP02',38.38,'ACTIVE');
INSERT INTO purchase_request_line(pr_ref_key,pr_code,pr_date,supplier_id,supplier_display_name,order_code,execution_code,product_code,material_id,material_name,uom,ordered_qty,received_qty,remaining_qty,estimated_unit_price,status) VALUES
('UAT-PR-AP01','140826-CHÂU ANH','2026-08-14','110733698','CHÂU ANH','S307626','S307626','S307626-AP01','1BO-POLY62','Bo poly xanh bích','bộ',420.24,0,420.24,7000,'OPEN'),
('UAT-PR-AP02','140826-CHÂU ANH','2026-08-14','110733698','CHÂU ANH','S307626','S307626','S307626-AP02','1BO-POLY62','Bo poly xanh bích','bộ',38.38,0,38.38,7000,'OPEN');
INSERT INTO stock_balance(material_id,physical_qty,stock_value,avg_cost) VALUES
('1BO-POLY06',355,1065000,3000),('1BO-POLY62',0,0,0);
INSERT INTO reservation(reservation_id,order_code,execution_code,product_code,material_id,required_qty,suggested_reserved_qty,confirmed_reserved_qty,issued_qty,released_qty,remaining_reserved_qty,priority,status) VALUES
('UAT-RES-AP01','S146926','S146926','S146926-AP01','1BO-POLY06',153,153,153,0,0,153,1,'CONFIRMED'),
('UAT-RES-AP02','S146926','S146926','S146926-AP02','1BO-POLY06',255,202,202,0,0,202,2,'CONFIRMED');
COMMIT;
