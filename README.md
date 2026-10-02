# Kho NPL V2 — PHP/MySQL MVC

Bản chuyển đổi từ Apps Script của workbook `MODAVIET - KHO NGUYÊN PHỤ LIỆU V2 - PRODUCTION CANDIDATE - TUNGNM`.

Giao diện sử dụng Tailwind CSS utility classes, font Google Sans và layout full-width với lề trái/phải 20px.

Tài liệu bàn giao đầy đủ cho Codex và máy phát triển khác: xem [CODEX_HANDOFF.md](CODEX_HANDOFF.md).

## Đã chuyển đổi

- Bootstrap, health check, phân quyền và trạng thái Opening Balance.
- Tra cứu tồn kho tổng hợp và tra tồn theo Mã sản phẩm/Mã vật tư đến từng nguồn nhập, NCC và lô.
- ĐNMH chờ nhận: NCC → phiếu → dòng hàng.
- Mua SX chung: tìm vật tư, tạo ĐNMH SX chung, theo dõi danh sách gần đây và tự động đưa vào luồng Nhập kho.
- Nhập kho, giữ tồn/phân bổ, xuất sản xuất, trả NPL, điều chỉnh tồn.
- Danh sách/chi tiết chứng từ và đảo chứng từ.
- Khóa giao dịch bằng transaction + row lock; moving average cost; append-only stock ledger; idempotency theo `clientRequestId`.
- Dữ liệu Google Sheet được snapshot vào MySQL; request web không đọc Google Sheet nên tốc độ ổn định hơn.

## Chạy nhanh trên XAMPP

1. Bật Apache và MySQL trong XAMPP.
2. Tạo schema:

   ```powershell
   Get-Content -Raw database\schema.sql | & C:\xampp\mysql\bin\mysql.exe -u root
   ```

3. Nếu cần tạo lại dữ liệu snapshot từ file XLSX:

   ```powershell
   Remove-Item -Recurse -Force xlsx_unpacked -ErrorAction SilentlyContinue
   New-Item -ItemType Directory xlsx_unpacked -Force | Out-Null
   tar -xf source_workbook.xlsx -C xlsx_unpacked
   node tools\parse_xlsx.mjs xlsx_unpacked exports
   & C:\xampp\php\php.exe tools\import_source.php
   ```

4. Truy cập `http://localhost/kho-v1/public/`, hoặc chạy thử:

   ```powershell
   & C:\xampp\php\php.exe -S 127.0.0.1:8088 -t public
   ```

   Sau đó mở `http://127.0.0.1:8088/`.

## Cấu hình production

Có thể dùng biến môi trường `KHO_DB_HOST`, `KHO_DB_PORT`, `KHO_DB_NAME`, `KHO_DB_USER`, `KHO_DB_PASS`, `KHO_ENV=PRODUCTION`.

Trong bản thử nghiệm, email người dùng lấy từ header `X-User-Email` hoặc mặc định `tungnm@modaviet.vn`. Khi đưa vào vận hành cần thay bằng đăng nhập/SSO thật và không dùng fallback `PILOT_ADMIN`.

## Nguồn Apps Script đã đọc

Mã nguồn Apps Script đã được tải từ ZIP được workbook tham chiếu và lưu tại `appscript_source\kho_npl_v2_apps_script`. Bản ZIP gốc là `appscript_source.zip`; file phiên bản nguồn là `2.3.2-functional-rc-doc-lookup`.

Workbook gốc chỉ được dùng làm nguồn snapshot. PHP không ghi ngược vào Google Sheet.

## Ghi chú cutover

Trong workbook, Opening Balance vẫn đang `LOCKED`, dữ liệu giao dịch hiện hữu trong snapshot chỉ có phần sổ kho đầu kỳ. Vì vậy `health.canGoLive` vẫn trả `false` cho đến khi hoàn tất phân quyền production, kiểm kê và chốt tồn đầu kỳ theo quy trình của workbook.
