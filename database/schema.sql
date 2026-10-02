CREATE DATABASE IF NOT EXISTS kho_npl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kho_npl;

CREATE TABLE IF NOT EXISTS app_users (
  email VARCHAR(190) NOT NULL PRIMARY KEY,
  display_name VARCHAR(190) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_roles (
  email VARCHAR(190) NOT NULL,
  role_code VARCHAR(60) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  effective_from DATE NULL,
  effective_to DATE NULL,
  note VARCHAR(500) NULL,
  PRIMARY KEY(email, role_code),
  CONSTRAINT fk_user_roles_user FOREIGN KEY(email) REFERENCES app_users(email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_config (
  config_key VARCHAR(120) NOT NULL PRIMARY KEY,
  config_value TEXT NULL,
  data_type VARCHAR(30) NULL,
  description VARCHAR(500) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS source_syncs (
  source_code VARCHAR(60) NOT NULL PRIMARY KEY,
  file_title VARCHAR(255) NULL,
  file_id VARCHAR(255) NULL,
  sheet_name VARCHAR(255) NULL,
  target_ref VARCHAR(120) NULL,
  mode VARCHAR(30) NULL,
  sync_method VARCHAR(60) NULL,
  notes TEXT NULL,
  last_sync_at DATETIME NULL,
  sync_status VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS materials (
  material_id VARCHAR(120) NOT NULL PRIMARY KEY,
  material_name VARCHAR(255) NOT NULL,
  uom VARCHAR(40) NOT NULL,
  material_group VARCHAR(120) NULL,
  material_type VARCHAR(120) NULL,
  fabric_name VARCHAR(255) NULL,
  color VARCHAR(120) NULL,
  specification VARCHAR(255) NULL,
  fabric_width VARCHAR(60) NULL,
  item_class VARCHAR(30) NOT NULL DEFAULT 'STOCK',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  source_updated_at DATETIME NULL,
  synced_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_material_search(material_name),
  INDEX idx_material_active(is_active, item_class)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id VARCHAR(120) NOT NULL PRIMARY KEY,
  supplier_short_code VARCHAR(190) NULL,
  supplier_display_name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255) NULL,
  tax_code VARCHAR(80) NULL,
  misa_supplier_code VARCHAR(120) NULL,
  misa_supplier_name VARCHAR(255) NULL,
  contact_person VARCHAR(190) NULL,
  phone VARCHAR(80) NULL,
  bank_account VARCHAR(120) NULL,
  bank_name VARCHAR(190) NULL,
  account_holder VARCHAR(190) NULL,
  supplier_group VARCHAR(120) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  synced_at DATETIME NULL,
  INDEX idx_supplier_name(supplier_display_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  product_code VARCHAR(160) NOT NULL PRIMARY KEY,
  contract_code VARCHAR(120) NULL,
  order_code VARCHAR(120) NULL,
  execution_code VARCHAR(120) NOT NULL,
  execution_type VARCHAR(30) NULL,
  product_type_code VARCHAR(60) NULL,
  product_name VARCHAR(255) NULL,
  gender VARCHAR(80) NULL,
  production_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  customer_id VARCHAR(120) NULL,
  customer_name VARCHAR(255) NULL,
  order_name VARCHAR(255) NULL,
  source_status VARCHAR(120) NULL,
  source_row_key VARCHAR(190) NULL,
  synced_at DATETIME NULL,
  INDEX idx_product_execution(execution_code),
  INDEX idx_product_order(order_code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS dmsx_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dmsx_date VARCHAR(40) NULL,
  pr_code VARCHAR(120) NULL,
  execution_code VARCHAR(120) NOT NULL,
  order_name VARCHAR(255) NULL,
  product_code VARCHAR(160) NOT NULL,
  product_name VARCHAR(255) NULL,
  production_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  material_id VARCHAR(120) NOT NULL,
  material_name VARCHAR(255) NULL,
  uom VARCHAR(40) NULL,
  material_type VARCHAR(120) NULL,
  fabric_width VARCHAR(60) NULL,
  bom_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  waste_rate DECIMAL(18,6) NOT NULL DEFAULT 0,
  gross_requirement_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  estimated_unit_price DECIMAL(20,6) NOT NULL DEFAULT 0,
  estimated_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
  supplier_display VARCHAR(255) NULL,
  supplier_id VARCHAR(120) NULL,
  required_fabric_date VARCHAR(40) NULL,
  required_trim_date VARCHAR(40) NULL,
  order_code VARCHAR(120) NULL,
  status_legacy VARCHAR(120) NULL,
  source_row_key VARCHAR(190) NULL,
  synced_at DATETIME NULL,
  INDEX idx_dmsx_exec(execution_code, product_code),
  INDEX idx_dmsx_material(material_id, execution_code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS active_bbsx (
  execution_code VARCHAR(120) NOT NULL,
  product_code VARCHAR(160) NOT NULL,
  source_name VARCHAR(120) NULL,
  source_status VARCHAR(190) NULL,
  synced_at DATETIME NULL,
  is_npl_tracking TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY(execution_code, product_code),
  INDEX idx_active_tracking(execution_code, is_npl_tracking)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_request_lines (
  pr_ref_key VARCHAR(190) NOT NULL PRIMARY KEY,
  pr_code VARCHAR(120) NOT NULL,
  pr_date DATE NULL,
  supplier_id VARCHAR(120) NOT NULL,
  supplier_name VARCHAR(255) NULL,
  order_code VARCHAR(120) NULL,
  execution_code VARCHAR(120) NULL,
  product_code VARCHAR(160) NULL,
  material_id VARCHAR(120) NOT NULL,
  material_name VARCHAR(255) NULL,
  uom VARCHAR(40) NULL,
  gross_requirement_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  reserved_stock_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  net_requirement_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  ordered_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  estimated_unit_price DECIMAL(20,6) NOT NULL DEFAULT 0,
  estimated_amount DECIMAL(20,4) NOT NULL DEFAULT 0,
  received_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  remaining_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  required_date DATE NULL,
  line_status VARCHAR(60) NULL,
  operational_active_flag TINYINT(1) NOT NULL DEFAULT 1,
  source_row_key VARCHAR(190) NULL,
  synced_at DATETIME NULL,
  INDEX idx_pr_open_supplier(supplier_id, remaining_qty, pr_date),
  INDEX idx_pr_code(pr_code, remaining_qty),
  INDEX idx_pr_execution(execution_code)
) ENGINE=InnoDB;

 CREATE TABLE IF NOT EXISTS common_purchase_requests (
  common_pr_id VARCHAR(190) NOT NULL PRIMARY KEY,
  common_pr_code VARCHAR(80) NOT NULL UNIQUE,
  request_date DATE NOT NULL,
  supplier_id VARCHAR(120) NOT NULL,
  supplier_name_snapshot VARCHAR(255) NOT NULL,
  required_date DATE NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'OPEN',
  requested_by VARCHAR(190) NOT NULL,
  note TEXT NULL,
  client_request_id VARCHAR(190) NOT NULL UNIQUE,
  line_count INT NOT NULL DEFAULT 0,
  estimated_amount DECIMAL(22,6) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  closed_by VARCHAR(190) NULL,
  closed_at DATETIME NULL,
  close_reason VARCHAR(500) NULL,
  INDEX idx_common_pr_supplier(supplier_id,status,request_date),
  INDEX idx_common_pr_date(request_date,status)
 ) ENGINE=InnoDB;

 CREATE TABLE IF NOT EXISTS common_purchase_request_lines (
  common_pr_line_id VARCHAR(190) NOT NULL PRIMARY KEY,
  common_pr_id VARCHAR(190) NOT NULL,
  common_pr_code VARCHAR(80) NOT NULL,
  pr_ref_key VARCHAR(190) NOT NULL UNIQUE,
  material_id VARCHAR(120) NOT NULL,
  material_name_snapshot VARCHAR(255) NOT NULL,
  uom_snapshot VARCHAR(40) NOT NULL,
  ordered_qty DECIMAL(18,4) NOT NULL,
  estimated_unit_price DECIMAL(20,6) NOT NULL DEFAULT 0,
  estimated_amount DECIMAL(22,6) NOT NULL DEFAULT 0,
  received_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  remaining_qty DECIMAL(18,4) NOT NULL,
  line_status VARCHAR(40) NOT NULL DEFAULT 'OPEN',
  required_date DATE NULL,
  note VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_common_pr_line_header FOREIGN KEY(common_pr_id) REFERENCES common_purchase_requests(common_pr_id),
  INDEX idx_common_line_open(common_pr_id,line_status,remaining_qty),
  INDEX idx_common_line_material(material_id)
 ) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_balances (
  material_id VARCHAR(120) NOT NULL PRIMARY KEY,
  physical_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  stock_value DECIMAL(22,6) NOT NULL DEFAULT 0,
  avg_cost DECIMAL(22,8) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_balance_material FOREIGN KEY(material_id) REFERENCES materials(material_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reservations (
  reservation_id VARCHAR(190) NOT NULL PRIMARY KEY,
  requirement_key VARCHAR(255) NOT NULL,
  source_requirement_key VARCHAR(255) NULL,
  order_code VARCHAR(120) NULL,
  execution_code VARCHAR(120) NOT NULL,
  product_code VARCHAR(160) NOT NULL,
  material_id VARCHAR(120) NOT NULL,
  required_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  suggested_reserved_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  confirmed_reserved_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  issued_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  released_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  remaining_reserved_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  priority INT NOT NULL DEFAULT 1,
  required_date DATE NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'CONFIRMED',
  confirmed_by VARCHAR(190) NULL,
  confirmed_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reservation_requirement(requirement_key),
  INDEX idx_res_exec(execution_code, status),
  INDEX idx_res_material(material_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS receipts (
  receipt_id VARCHAR(190) NOT NULL PRIMARY KEY,
  receipt_code VARCHAR(80) NOT NULL UNIQUE,
  receipt_date DATE NOT NULL,
  supplier_id VARCHAR(120) NOT NULL,
  supplier_name_snapshot VARCHAR(255) NULL,
  delivery_note_no VARCHAR(190) NULL,
  invoice_no VARCHAR(190) NULL,
  invoice_date DATE NULL,
  delivered_by VARCHAR(190) NULL,
  status VARCHAR(40) NOT NULL,
  price_status VARCHAR(40) NOT NULL DEFAULT 'PROVISIONAL',
  received_by VARCHAR(190) NOT NULL,
  posted_by VARCHAR(190) NULL,
  posted_at DATETIME NULL,
  client_request_id VARCHAR(190) NOT NULL UNIQUE,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  post_engine_status VARCHAR(40) NULL,
  INDEX idx_receipts_date(receipt_date, status),
  INDEX idx_receipts_supplier(supplier_id, receipt_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS receipt_lines (
  receipt_line_id VARCHAR(190) NOT NULL PRIMARY KEY,
  receipt_id VARCHAR(190) NOT NULL,
  receipt_code VARCHAR(80) NOT NULL,
  pr_ref_key VARCHAR(190) NOT NULL,
  pr_code VARCHAR(120) NOT NULL,
  order_code VARCHAR(120) NULL,
  execution_code VARCHAR(120) NULL,
  product_code VARCHAR(160) NULL,
  material_id VARCHAR(120) NOT NULL,
  material_name_snapshot VARCHAR(255) NULL,
  uom_snapshot VARCHAR(40) NULL,
  ordered_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  previous_received_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  remaining_before_receipt DECIMAL(18,4) NOT NULL DEFAULT 0,
  delivered_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  accepted_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  rejected_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  expected_unit_price DECIMAL(20,6) NOT NULL DEFAULT 0,
  actual_unit_price DECIMAL(20,6) NOT NULL DEFAULT 0,
  management_amount DECIMAL(22,6) NOT NULL DEFAULT 0,
  quality_status VARCHAR(50) NOT NULL DEFAULT 'ACCEPTED',
  over_receipt_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  over_receipt_reason VARCHAR(500) NULL,
  item_class VARCHAR(30) NOT NULL DEFAULT 'STOCK',
  lot_no VARCHAR(120) NULL,
  note TEXT NULL,
  validation_status VARCHAR(30) NULL,
  validation_message VARCHAR(1000) NULL,
  can_post TINYINT(1) NULL,
  receipt_status_ref VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_receipt_line_header FOREIGN KEY(receipt_id) REFERENCES receipts(receipt_id),
  INDEX idx_receipt_line_pr(pr_ref_key),
  INDEX idx_receipt_line_material(material_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS issues (
  issue_id VARCHAR(190) NOT NULL PRIMARY KEY,
  issue_code VARCHAR(80) NOT NULL UNIQUE,
  issue_date DATE NOT NULL,
  issue_type VARCHAR(50) NOT NULL DEFAULT 'PRODUCTION',
  order_code VARCHAR(120) NULL,
  execution_code VARCHAR(120) NOT NULL,
  department VARCHAR(190) NULL,
  receiver VARCHAR(190) NOT NULL,
  status VARCHAR(40) NOT NULL,
  issued_by VARCHAR(190) NOT NULL,
  posted_by VARCHAR(190) NULL,
  posted_at DATETIME NULL,
  client_request_id VARCHAR(190) NOT NULL UNIQUE,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  post_engine_status VARCHAR(40) NULL,
  INDEX idx_issue_exec(execution_code, issue_date),
  INDEX idx_issue_date(issue_date, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS issue_lines (
  issue_line_id VARCHAR(190) NOT NULL PRIMARY KEY,
  issue_id VARCHAR(190) NOT NULL,
  issue_code VARCHAR(80) NOT NULL,
  reservation_id VARCHAR(190) NOT NULL,
  product_code VARCHAR(160) NULL,
  material_id VARCHAR(120) NOT NULL,
  material_name_snapshot VARCHAR(255) NULL,
  uom_snapshot VARCHAR(40) NULL,
  bom_required_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  previous_issued_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  remaining_bom_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  physical_stock_before DECIMAL(18,4) NOT NULL DEFAULT 0,
  available_stock_before DECIMAL(18,4) NOT NULL DEFAULT 0,
  issue_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  management_unit_cost DECIMAL(22,8) NOT NULL DEFAULT 0,
  management_amount DECIMAL(22,6) NOT NULL DEFAULT 0,
  variance_vs_bom DECIMAL(18,4) NOT NULL DEFAULT 0,
  variance_reason VARCHAR(500) NULL,
  note TEXT NULL,
  validation_status VARCHAR(30) NULL,
  validation_message VARCHAR(1000) NULL,
  line_can_post TINYINT(1) NULL,
  issue_status_ref VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  CONSTRAINT fk_issue_line_header FOREIGN KEY(issue_id) REFERENCES issues(issue_id),
  INDEX idx_issue_line_reservation(reservation_id),
  INDEX idx_issue_line_material(material_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS production_returns (
  return_id VARCHAR(190) NOT NULL PRIMARY KEY,
  return_code VARCHAR(80) NOT NULL UNIQUE,
  return_date DATE NOT NULL,
  source_issue_line_id VARCHAR(190) NOT NULL,
  order_code VARCHAR(120) NULL,
  execution_code VARCHAR(120) NULL,
  product_code VARCHAR(160) NULL,
  material_id VARCHAR(120) NOT NULL,
  return_qty DECIMAL(18,4) NOT NULL,
  unit_cost DECIMAL(22,8) NOT NULL,
  amount DECIMAL(22,6) NOT NULL,
  return_condition VARCHAR(50) NOT NULL,
  usable_stock_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  scrap_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  returned_by VARCHAR(190) NOT NULL,
  received_by VARCHAR(190) NOT NULL,
  status VARCHAR(40) NOT NULL,
  posted_at DATETIME NULL,
  note TEXT NULL,
  client_request_id VARCHAR(190) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_return_source(source_issue_line_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS adjustments (
  adjustment_id VARCHAR(190) NOT NULL PRIMARY KEY,
  adjustment_code VARCHAR(80) NOT NULL UNIQUE,
  adjustment_date DATE NOT NULL,
  material_id VARCHAR(120) NOT NULL,
  adjustment_type VARCHAR(20) NOT NULL,
  qty DECIMAL(18,4) NOT NULL,
  unit_cost DECIMAL(22,8) NOT NULL,
  amount DECIMAL(22,6) NOT NULL,
  reason_code VARCHAR(80) NOT NULL,
  reason_detail VARCHAR(1000) NOT NULL,
  reference_transaction_id VARCHAR(190) NULL,
  requested_by VARCHAR(190) NOT NULL,
  approved_by VARCHAR(190) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'POSTED',
  posted_by VARCHAR(190) NULL,
  posted_at DATETIME NULL,
  note TEXT NULL,
  client_request_id VARCHAR(190) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_ledger (
  ledger_id VARCHAR(190) NOT NULL PRIMARY KEY,
  posted_at DATETIME NOT NULL,
  transaction_date DATE NOT NULL,
  transaction_type VARCHAR(60) NOT NULL,
  transaction_id VARCHAR(190) NOT NULL,
  transaction_line_id VARCHAR(190) NOT NULL,
  document_code VARCHAR(80) NOT NULL,
  material_id VARCHAR(120) NOT NULL,
  qty_in DECIMAL(18,4) NOT NULL DEFAULT 0,
  qty_out DECIMAL(18,4) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(22,8) NOT NULL DEFAULT 0,
  amount_in DECIMAL(22,6) NOT NULL DEFAULT 0,
  amount_out DECIMAL(22,6) NOT NULL DEFAULT 0,
  running_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  running_value DECIMAL(22,6) NOT NULL DEFAULT 0,
  avg_cost_after DECIMAL(22,8) NOT NULL DEFAULT 0,
  order_code VARCHAR(120) NULL,
  execution_code VARCHAR(120) NULL,
  product_code VARCHAR(160) NULL,
  supplier_id VARCHAR(120) NULL,
  pr_code VARCHAR(120) NULL,
  created_by VARCHAR(190) NOT NULL,
  source_environment VARCHAR(40) NOT NULL DEFAULT 'PRODUCTION',
  source_client_request_id VARCHAR(190) NOT NULL,
  UNIQUE KEY uq_ledger_transaction(transaction_type, transaction_line_id),
  INDEX idx_ledger_material_time(material_id, posted_at),
  INDEX idx_ledger_execution(execution_code, posted_at),
  INDEX idx_ledger_document(document_code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  happened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_email VARCHAR(190) NOT NULL,
  action VARCHAR(100) NOT NULL,
  object_type VARCHAR(60) NOT NULL,
  object_id VARCHAR(190) NOT NULL,
  field_name VARCHAR(120) NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  reason TEXT NULL,
  client_request_id VARCHAR(190) NULL,
  environment VARCHAR(40) NOT NULL DEFAULT 'PRODUCTION',
  INDEX idx_audit_object(object_type, object_id, happened_at),
  INDEX idx_audit_request(client_request_id, action)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS error_logs (
  error_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  happened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_email VARCHAR(190) NULL,
  function_name VARCHAR(120) NULL,
  object_type VARCHAR(60) NULL,
  object_id VARCHAR(190) NULL,
  client_request_id VARCHAR(190) NULL,
  error_code VARCHAR(100) NOT NULL,
  error_message TEXT NOT NULL,
  stack_or_context TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  INDEX idx_error_time(happened_at),
  INDEX idx_error_request(client_request_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS idempotency_requests (
  client_request_id VARCHAR(190) NOT NULL PRIMARY KEY,
  operation VARCHAR(80) NOT NULL,
  user_email VARCHAR(190) NOT NULL,
  request_hash CHAR(64) NULL,
  response_json LONGTEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PROCESSING',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_sequences (
  doc_type VARCHAR(30) NOT NULL,
  doc_date DATE NOT NULL,
  last_no INT NOT NULL DEFAULT 0,
  PRIMARY KEY(doc_type, doc_date)
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW v_stock AS
SELECT m.material_id, m.material_name, m.uom, m.item_class,
       COALESCE(b.physical_qty,0) AS physical_qty,
       COALESCE(r.reserved_qty,0) AS reserved_qty,
       COALESCE(b.physical_qty,0)-COALESCE(r.reserved_qty,0) AS available_qty,
       COALESCE(b.avg_cost,0) AS avg_cost, COALESCE(b.stock_value,0) AS stock_value,
       b.updated_at
FROM materials m
LEFT JOIN stock_balances b ON b.material_id=m.material_id
LEFT JOIN (SELECT material_id,SUM(remaining_reserved_qty) reserved_qty FROM reservations WHERE status NOT IN ('CANCELLED','CLOSED') GROUP BY material_id) r ON r.material_id=m.material_id
WHERE m.is_active=1;

CREATE OR REPLACE VIEW v_payable_source AS
SELECT rl.receipt_line_id,r.receipt_code,r.receipt_date,r.supplier_id,r.supplier_name_snapshot AS supplier_name,
       rl.order_code,rl.execution_code,rl.product_code,rl.material_id,rl.material_name_snapshot AS material_name,
       rl.uom_snapshot AS uom,rl.accepted_qty,rl.actual_unit_price,rl.management_amount AS amount,
       rl.pr_code,r.price_status,'OPEN' AS payable_status
FROM receipt_lines rl JOIN receipts r ON r.receipt_id=rl.receipt_id
WHERE r.status='POSTED' AND rl.accepted_qty>0;

CREATE OR REPLACE VIEW v_material_cost AS
SELECT h.order_code,h.execution_code,i.product_code,i.material_id,
       SUM(i.issue_qty) issued_qty,COALESCE(SUM(ret.returned_usable_qty),0) returned_usable_qty,
       SUM(i.issue_qty)-COALESCE(SUM(ret.returned_usable_qty),0) net_consumed_qty,
       SUM(i.management_amount)-COALESCE(SUM(ret.return_amount),0) material_cost
FROM issue_lines i JOIN issues h ON h.issue_id=i.issue_id
LEFT JOIN (SELECT source_issue_line_id,SUM(usable_stock_qty) returned_usable_qty,SUM(usable_stock_qty*unit_cost) return_amount FROM production_returns WHERE status='POSTED' GROUP BY source_issue_line_id) ret ON ret.source_issue_line_id=i.issue_line_id
WHERE h.status='POSTED'
GROUP BY h.order_code,h.execution_code,i.product_code,i.material_id;
