MODAVIET - KHO NPL V2 - FUNCTIONAL RELEASE CANDIDATE 2.3.0

MỤC TIÊU
- Hoàn thiện nghiệp vụ trước, tối ưu tốc độ/server để giai đoạn sau.
- Không sửa file nguồn Modaviet. Nguồn chỉ READ ONLY/snapshot.
- Không bật Opening Balance trong Pilot.

CHỨC NĂNG WEB APP
1. Tổng quan / System Health.
2. Giữ tồn theo BBSX/M/SH đang hoạt động.
3. Nhập kho theo ĐNMH.
4. Xuất kho theo Reservation.
5. Trả NPL từ sản xuất.
6. Điều chỉnh tồn có kiểm soát.
7. Đảo giao dịch POSTED có audit, không xóa/sửa chứng từ gốc.
8. Tra cứu tồn kho.
9. Đồng bộ nguồn thủ công + cài trigger tự động.

PHÂN QUYỀN
- WAREHOUSE: Nhập / Xuất / Trả.
- PROCUREMENT, PRODUCTION_MANAGER: Giữ tồn.
- PRODUCTION_MANAGER: Điều chỉnh / Đảo.
- ADMIN / PILOT_ADMIN: toàn quyền nghiệp vụ + sync.
- ACCOUNTING / CEO_VIEW: xem Tổng quan / Tra tồn (backend vẫn kiểm tra quyền).

ĐỒNG BỘ NGUỒN
- scheduledSyncFast: DMSX + Tiến độ SX, 10 phút.
- scheduledSyncOrder: Mã sản phẩm, 15 phút.
- scheduledSyncMaster: Vật tư + NCC, 60 phút.
- Chạy installSyncTriggers() một lần hoặc dùng nút Hệ thống > Cài đồng bộ tự động.

OPENING BALANCE
- Engine đã có nhưng KHÓA theo 4 lớp:
  1) CFG.OPENING_POST_ENABLED = true
  2) HT_CẤU HÌNH.OPENING_BALANCE_POST_ENABLED = TRUE
  3) CFG.ENVIRONMENT = PRODUCTION
  4) PILOT_TRANSACTION_MODE = PRODUCTION
- Ngoài ra cần quyền Admin + chuỗi xác nhận cutover.
- Trong bản Pilot hiện tại tuyệt đối không bật.

TRIỂN KHAI 2.3.0
- Copy toàn bộ source hoặc các file changed vào bound Apps Script project Pilot.
- Không đổi SPREADSHEET_ID.
- Deploy phiên bản mới trên deployment /exec hiện tại.
- Chạy smoke/regression cho Reservation, Adjustment, Reversal, Sync trước khi lập Production Candidate.

AN TOÀN BỔ SUNG
- Không đảo điều chỉnh TĂNG nếu Mã VT đã có giao dịch phát sinh sau đó; dùng Điều chỉnh hiện tại thay vì đảo lịch sử.
- Tồn đầu chặn POST khi một Mã VT xuất hiện trùng trong danh sách ứng viên.
- Các quy tắc này nhằm bảo toàn giá bình quân và audit trail.

LƯU Ý
- File Pilot đã có dữ liệu UAT, KHÔNG dùng trực tiếp làm production ledger.
- Sau Functional RC PASS sẽ tạo Production Candidate sạch và thực hiện cutover theo kiểm kê/duyệt tồn đầu.

BỔ SUNG 2.3.2 — TRA CỨU CHỨNG TỪ / UX ĐẢO GIAO DỊCH
- Thêm tab Chứng từ trong Web App. Không yêu cầu nhân viên mở backend Google Sheets để tìm mã phiếu.
- Bộ lọc: Mã chứng từ, loại, trạng thái, từ/đến ngày, BBSX/M/SH, mã vật tư, NCC, người thao tác.
- 50 chứng từ gần nhất hiển thị trực tiếp trên Web App; có nút Xem.
- Người có quyền Điều chỉnh/Đảo có nút Chọn để đảo, tự điền mã chứng từ và tải preview.
- Preview đảo hiển thị rõ Giao dịch gốc và Tác động khi đảo. Ví dụ DC tăng tồn 1 thì preview ghi “Giao dịch gốc: TĂNG TỒN”, “Tác động khi đảo: GIẢM TỒN”.
- Popup ghi sổ thành công có nút Xem chứng từ cho PN/PX/TL/DC/RV.
- Không thay đổi logic Sổ kho, Reservation, giá BQ, Opening Balance hay quyền ghi file nguồn.
