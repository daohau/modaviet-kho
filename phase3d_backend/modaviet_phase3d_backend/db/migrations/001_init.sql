BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_user_role (
  email text NOT NULL,
  role_code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(email, role_code)
);

CREATE TABLE IF NOT EXISTS material (
  material_id text PRIMARY KEY,
  material_name text NOT NULL,
  uom text NOT NULL,
  item_class text NOT NULL DEFAULT 'STOCK' CHECK(item_class IN('STOCK','NON_STOCK','SERVICE')),
  is_active boolean NOT NULL DEFAULT true,
  source_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier (
  supplier_id text PRIMARY KEY,
  supplier_display_name text NOT NULL,
  legal_name text,
  tax_code text,
  is_active boolean NOT NULL DEFAULT true,
  source_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_product_snapshot (
  product_code text PRIMARY KEY,
  order_code text,
  execution_code text NOT NULL,
  execution_type text,
  product_name text,
  production_qty numeric(18,4),
  status text,
  source_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_request_line (
  pr_ref_key text PRIMARY KEY,
  pr_code text NOT NULL,
  pr_date date NOT NULL,
  supplier_id text NOT NULL REFERENCES supplier(supplier_id),
  supplier_display_name text,
  order_code text,
  execution_code text,
  product_code text,
  material_id text NOT NULL REFERENCES material(material_id),
  material_name text,
  uom text,
  ordered_qty numeric(18,4) NOT NULL CHECK(ordered_qty>=0),
  received_qty numeric(18,4) NOT NULL DEFAULT 0 CHECK(received_qty>=0),
  remaining_qty numeric(18,4) NOT NULL CHECK(remaining_qty>=0),
  estimated_unit_price numeric(18,4) NOT NULL DEFAULT 0,
  required_date date,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'OPEN',
  source_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pr_supplier_open ON purchase_request_line(supplier_id,pr_date DESC) WHERE remaining_qty>0;
CREATE INDEX IF NOT EXISTS idx_pr_code_open ON purchase_request_line(pr_code) WHERE remaining_qty>0;
CREATE INDEX IF NOT EXISTS idx_pr_execution ON purchase_request_line(execution_code);

CREATE TABLE IF NOT EXISTS stock_balance (
  material_id text PRIMARY KEY REFERENCES material(material_id),
  physical_qty numeric(18,4) NOT NULL DEFAULT 0 CHECK(physical_qty>=0),
  stock_value numeric(20,4) NOT NULL DEFAULT 0,
  avg_cost numeric(20,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reservation (
  reservation_id text PRIMARY KEY,
  order_code text,
  execution_code text NOT NULL,
  product_code text NOT NULL,
  material_id text NOT NULL REFERENCES material(material_id),
  required_qty numeric(18,4) NOT NULL,
  suggested_reserved_qty numeric(18,4) NOT NULL DEFAULT 0,
  confirmed_reserved_qty numeric(18,4) NOT NULL DEFAULT 0,
  issued_qty numeric(18,4) NOT NULL DEFAULT 0,
  released_qty numeric(18,4) NOT NULL DEFAULT 0,
  remaining_reserved_qty numeric(18,4) NOT NULL DEFAULT 0 CHECK(remaining_reserved_qty>=0),
  priority integer NOT NULL DEFAULT 100,
  required_date date,
  status text NOT NULL DEFAULT 'CONFIRMED',
  source_requirement_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_res_execution_open ON reservation(execution_code,priority) WHERE remaining_reserved_qty>0;
CREATE INDEX IF NOT EXISTS idx_res_material_open ON reservation(material_id) WHERE remaining_reserved_qty>0;

CREATE TABLE IF NOT EXISTS document_counter (
  doc_type text NOT NULL,
  doc_date date NOT NULL,
  last_no integer NOT NULL,
  PRIMARY KEY(doc_type,doc_date)
);
CREATE TABLE IF NOT EXISTS idempotency_request (
  client_request_id text PRIMARY KEY,
  operation text NOT NULL,
  user_email text NOT NULL,
  request_hash text,
  status text NOT NULL CHECK(status IN('PROCESSING','DONE')),
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS receipt_header (
  receipt_id text PRIMARY KEY, receipt_code text UNIQUE NOT NULL, receipt_date date NOT NULL,
  supplier_id text NOT NULL REFERENCES supplier(supplier_id), supplier_name_snapshot text,
  delivery_note_no text, delivered_by text, status text NOT NULL, price_status text NOT NULL DEFAULT 'PROVISIONAL',
  received_by text NOT NULL, posted_by text, posted_at timestamptz, client_request_id text UNIQUE NOT NULL,
  note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS receipt_line (
  receipt_line_id text PRIMARY KEY, receipt_id text NOT NULL REFERENCES receipt_header(receipt_id), receipt_code text NOT NULL,
  pr_ref_key text NOT NULL REFERENCES purchase_request_line(pr_ref_key), pr_code text NOT NULL,
  order_code text, execution_code text, product_code text, material_id text NOT NULL REFERENCES material(material_id),
  material_name_snapshot text, uom_snapshot text, ordered_qty numeric(18,4), previous_received_qty numeric(18,4), remaining_before_receipt numeric(18,4),
  delivered_qty numeric(18,4), accepted_qty numeric(18,4), rejected_qty numeric(18,4), expected_unit_price numeric(20,4), actual_unit_price numeric(20,4), management_amount numeric(20,4),
  quality_status text, over_receipt_qty numeric(18,4), over_receipt_reason text, item_class text, lot_no text
);
CREATE INDEX IF NOT EXISTS idx_receipt_line_pr ON receipt_line(pr_ref_key);

CREATE TABLE IF NOT EXISTS issue_header (
  issue_id text PRIMARY KEY, issue_code text UNIQUE NOT NULL, issue_date date NOT NULL, issue_type text NOT NULL,
  order_code text, execution_code text NOT NULL, department text, receiver text, status text NOT NULL,
  issued_by text NOT NULL, posted_by text, posted_at timestamptz, client_request_id text UNIQUE NOT NULL,
  note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS issue_line (
  issue_line_id text PRIMARY KEY, issue_id text NOT NULL REFERENCES issue_header(issue_id), issue_code text NOT NULL,
  reservation_id text NOT NULL REFERENCES reservation(reservation_id), product_code text, material_id text NOT NULL REFERENCES material(material_id),
  bom_required_qty numeric(18,4), previous_issued_qty numeric(18,4), remaining_bom_qty numeric(18,4), physical_stock_before numeric(18,4), available_stock_before numeric(18,4),
  issue_qty numeric(18,4) NOT NULL, management_unit_cost numeric(20,6) NOT NULL, management_amount numeric(20,4) NOT NULL,
  over_bom_qty numeric(18,4) DEFAULT 0, over_bom_reason text
);
CREATE INDEX IF NOT EXISTS idx_issue_line_material ON issue_line(material_id);

CREATE TABLE IF NOT EXISTS production_return (
  return_id text PRIMARY KEY, return_code text UNIQUE NOT NULL, return_date date NOT NULL,
  source_issue_line_id text NOT NULL REFERENCES issue_line(issue_line_id), order_code text, execution_code text, product_code text,
  material_id text NOT NULL REFERENCES material(material_id), return_qty numeric(18,4) NOT NULL,
  unit_cost numeric(20,6) NOT NULL, amount numeric(20,4) NOT NULL, return_condition text,
  usable_stock_qty numeric(18,4) NOT NULL DEFAULT 0, scrap_qty numeric(18,4) NOT NULL DEFAULT 0,
  returned_by text, received_by text, status text NOT NULL, posted_at timestamptz, note text,
  client_request_id text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_return_source ON production_return(source_issue_line_id) WHERE status='POSTED';

CREATE TABLE IF NOT EXISTS stock_ledger (
  ledger_id bigserial PRIMARY KEY, posted_at timestamptz NOT NULL DEFAULT now(), transaction_type text NOT NULL,
  transaction_id text NOT NULL, transaction_line_id text NOT NULL, document_code text NOT NULL,
  material_id text NOT NULL REFERENCES material(material_id), qty_in numeric(18,4) NOT NULL DEFAULT 0,
  qty_out numeric(18,4) NOT NULL DEFAULT 0, unit_cost numeric(20,6) NOT NULL DEFAULT 0,
  amount_in numeric(20,4) NOT NULL DEFAULT 0, amount_out numeric(20,4) NOT NULL DEFAULT 0,
  running_qty numeric(18,4) NOT NULL, running_value numeric(20,4) NOT NULL, avg_cost_after numeric(20,6) NOT NULL,
  order_code text, execution_code text, product_code text, supplier_id text, pr_code text,
  created_by text NOT NULL, source_environment text NOT NULL, source_client_request_id text NOT NULL,
  UNIQUE(transaction_type,transaction_line_id)
);
CREATE INDEX IF NOT EXISTS idx_ledger_material_time ON stock_ledger(material_id,posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_execution ON stock_ledger(execution_code,posted_at);

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id bigserial PRIMARY KEY, timestamp timestamptz NOT NULL DEFAULT now(), user_email text NOT NULL,
  action text NOT NULL, object_type text NOT NULL, object_id text NOT NULL,
  old_value text, new_value text, reason text, client_request_id text, environment text NOT NULL DEFAULT 'PILOT_DB'
);
CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_log(object_type,object_id,timestamp);

CREATE OR REPLACE VIEW v_stock AS
SELECT b.material_id,m.material_name,m.uom,b.physical_qty,
       COALESCE(r.reserved_qty,0) AS reserved_qty,
       b.physical_qty-COALESCE(r.reserved_qty,0) AS available_qty,
       b.avg_cost,b.stock_value,b.updated_at
FROM stock_balance b JOIN material m ON m.material_id=b.material_id
LEFT JOIN (SELECT material_id,SUM(remaining_reserved_qty) AS reserved_qty FROM reservation WHERE remaining_reserved_qty>0 GROUP BY material_id) r USING(material_id);

CREATE OR REPLACE VIEW v_payable_source AS
SELECT rl.receipt_line_id,rh.receipt_code,rh.receipt_date,rh.supplier_id,rh.supplier_name_snapshot,
       rl.order_code,rl.execution_code,rl.product_code,rl.material_id,rl.material_name_snapshot,rl.uom_snapshot,
       rl.accepted_qty,rl.actual_unit_price,rl.management_amount AS amount,rl.pr_code,rh.price_status,
       'OPEN'::text AS payable_status
FROM receipt_line rl JOIN receipt_header rh ON rh.receipt_id=rl.receipt_id
WHERE rh.status='POSTED' AND rl.accepted_qty>0;

CREATE OR REPLACE VIEW v_material_cost AS
WITH i AS (
 SELECT ih.order_code,ih.execution_code,il.product_code,il.material_id,SUM(il.issue_qty) issued_qty,SUM(il.management_amount) issued_amount
 FROM issue_line il JOIN issue_header ih ON ih.issue_id=il.issue_id WHERE ih.status='POSTED'
 GROUP BY ih.order_code,ih.execution_code,il.product_code,il.material_id
), r AS (
 SELECT pr.order_code,pr.execution_code,pr.product_code,pr.material_id,SUM(pr.usable_stock_qty) returned_usable_qty,SUM(pr.usable_stock_qty*pr.unit_cost) return_amount
 FROM production_return pr WHERE pr.status='POSTED' GROUP BY pr.order_code,pr.execution_code,pr.product_code,pr.material_id
)
SELECT i.order_code,i.execution_code,i.product_code,i.material_id,i.issued_qty,COALESCE(r.returned_usable_qty,0) returned_usable_qty,
       i.issued_qty-COALESCE(r.returned_usable_qty,0) net_consumed_qty,
       i.issued_amount-COALESCE(r.return_amount,0) material_cost
FROM i LEFT JOIN r USING(order_code,execution_code,product_code,material_id);
COMMIT;
