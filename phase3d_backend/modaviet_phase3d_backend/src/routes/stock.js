import { pool } from '../lib/db.js';
export async function stockRoutes(app){
  app.get('/v1/stock/:materialId',async(request)=>{const {rows}=await pool.query(`SELECT b.material_id,m.material_name,m.uom,b.physical_qty,COALESCE((SELECT SUM(remaining_reserved_qty) FROM reservation r WHERE r.material_id=b.material_id AND r.remaining_reserved_qty>0),0) AS reserved_qty,b.physical_qty-COALESCE((SELECT SUM(remaining_reserved_qty) FROM reservation r WHERE r.material_id=b.material_id AND r.remaining_reserved_qty>0),0) AS available_qty,b.avg_cost,b.stock_value,b.updated_at FROM stock_balance b JOIN material m ON m.material_id=b.material_id WHERE b.material_id=$1`,[request.params.materialId]); return rows[0]||null;});
}
