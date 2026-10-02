# Phase 3D — Kiến trúc hiệu năng

## Target
Browser Web App -> Cloud Run API -> PostgreSQL (Cloud SQL) -> async read-model/export -> Google Sheets báo cáo.

Google Sheets không còn là transaction database. File nguồn Modaviet vẫn READ ONLY trong Pilot.

## Region
Ưu tiên asia-southeast1 (Singapore) cho Cloud Run và PostgreSQL cùng region. Không đặt API và DB khác region.

## Transaction
Mỗi thao tác Nhập/Xuất/Trả = 1 HTTP POST và 1 PostgreSQL transaction.
- Validation trước cấp số chứng từ.
- `client_request_id` unique chống retry/double-click.
- Row locks chống race condition.
- Stock balance cập nhật đồng thời ledger.
- Audit cùng transaction.
- Rollback toàn bộ nếu bất kỳ bước nào lỗi.

## Read models
- v_stock
- v_payable_source
- v_material_cost
Google Sheets/BCTH/AP đọc read model hoặc bản export; không tham gia commit path.
