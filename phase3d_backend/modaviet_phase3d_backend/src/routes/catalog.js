import { pool } from '../lib/db.js';

export async function catalogRoutes(app) {
  app.get('/v1/catalog/suppliers/open-pr', async () => {
    const {rows}=await pool.query(`SELECT supplier_id,supplier_display_name,COUNT(DISTINCT pr_code)::int AS open_pr_count FROM purchase_request_line WHERE remaining_qty>0 GROUP BY supplier_id,supplier_display_name ORDER BY supplier_display_name`); return {items:rows};
  });
  app.get('/v1/catalog/prs', async (request) => {
    const supplierId=String(request.query?.supplierId||''); const {rows}=await pool.query(`SELECT pr_code,MIN(pr_date) AS pr_date,COUNT(*)::int AS line_count FROM purchase_request_line WHERE supplier_id=$1 AND remaining_qty>0 GROUP BY pr_code ORDER BY MIN(pr_date) DESC,pr_code`,[supplierId]); return {items:rows};
  });
  app.get('/v1/catalog/prs/:prCode/lines', async (request) => {
    const {rows}=await pool.query(`SELECT pr_ref_key,pr_code,order_code,execution_code,product_code,material_id,material_name,uom,ordered_qty,received_qty,remaining_qty,estimated_unit_price,status FROM purchase_request_line WHERE pr_code=$1 AND remaining_qty>0 ORDER BY required_date NULLS LAST,pr_ref_key`,[request.params.prCode]); return {items:rows};
  });
  app.get('/v1/catalog/reservations/:executionCode', async (request) => {
    const code=String(request.params.executionCode||'').trim().toUpperCase(); const {rows}=await pool.query(`SELECT r.*,m.material_name,m.uom,s.physical_qty,s.avg_cost,(s.physical_qty-COALESCE((SELECT SUM(r2.remaining_reserved_qty) FROM reservation r2 WHERE r2.material_id=r.material_id AND r2.reservation_id<>r.reservation_id AND r2.remaining_reserved_qty>0),0)) AS allowed_qty FROM reservation r JOIN material m ON m.material_id=r.material_id LEFT JOIN stock_balance s ON s.material_id=r.material_id WHERE upper(r.execution_code)=upper($1) AND r.remaining_reserved_qty>0 ORDER BY r.priority,r.product_code,r.material_id`,[code]); return {executionCode:code,items:rows};
  });
  app.get('/v1/catalog/returnable/:executionCode', async (request) => {
    const code=String(request.params.executionCode||'').trim().toUpperCase(); const {rows}=await pool.query(`SELECT il.issue_line_id,ih.issue_code,il.product_code,il.material_id,m.material_name,il.issue_qty,COALESCE(x.returned_qty,0) AS returned_qty,il.issue_qty-COALESCE(x.returned_qty,0) AS returnable_qty,il.management_unit_cost FROM issue_line il JOIN issue_header ih ON ih.issue_id=il.issue_id JOIN material m ON m.material_id=il.material_id LEFT JOIN (SELECT source_issue_line_id,SUM(return_qty) returned_qty FROM production_return WHERE status='POSTED' GROUP BY source_issue_line_id)x ON x.source_issue_line_id=il.issue_line_id WHERE upper(ih.execution_code)=upper($1) AND ih.status='POSTED' AND il.issue_qty-COALESCE(x.returned_qty,0)>0 ORDER BY ih.issue_date,ih.issue_code`,[code]); return {executionCode:code,items:rows};
  });
}
