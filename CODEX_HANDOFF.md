# Codex Handoff — Kho Nguyên Phụ Liệu V2

Ngày cập nhật: 2026-09-21  
Mục đích: tài liệu bàn giao để copy project sang máy khác và tiếp tục phát triển bằng Codex.

## 1. Quy tắc đọc tài liệu này

Khi mở project trên máy mới, yêu cầu Codex đọc file này trước khi sửa code. Đây là context làm việc được lưu trong project; nó thay thế phần lớn việc phải giải thích lại lịch sử hội thoại.

Không thể xuất bộ nhớ nội bộ của Codex hoặc toàn bộ lịch sử hội thoại thành một file. Vì vậy cần copy cả source code, database snapshot, Apps Script source và file này.

## 2. Mục tiêu dự án

Đây là bản chuyển đổi ứng dụng Google Apps Script “Kho Nguyên Phụ Liệu V2” sang PHP/MySQL theo MVC, giữ logic nghiệp vụ của Apps Script nhưng đọc dữ liệu từ MySQL snapshot để tốc độ ổn định hơn.

Nguồn nghiệp vụ tham chiếu:

- Google Sheet gốc: https://docs.google.com/spreadsheets/d/1FScHq9lw208KJM9pr-j1uHOCtakklKbBl9bFNBFwMCg/edit?gid=792364582#gid=792364582
- Apps Script đã giải nén: `appscript_source/kho_npl_v2_apps_script/`
- ZIP Apps Script gốc: `appscript_source.zip`
- Workbook snapshot: `source_workbook.xlsx`
- Dữ liệu JSON đã parse: `exports/`, `workbook_summary.json`, `workbook_inventory.json`

Nguyên tắc quan trọng: PHP không ghi ngược vào Google Sheet. Google Sheet/Apps Script chỉ là nguồn tham chiếu và snapshot.

## 3. Kiến trúc hiện tại

```text
Browser
  -> public/index.php
     -> app/Core/Router.php
        -> app/Controllers/ApiController.php
           -> app/Services/*
              -> MySQL/MariaDB qua app/Core/Database.php
  -> views/dashboard.php + public/assets/app.js + public/assets/style.css
```

Thư mục chính:

- `app/Core/`: PDO, router, request/response, exception.
- `app/Controllers/ApiController.php`: ánh xạ API đến service.
- `app/Services/`: logic truy vấn, tồn kho, nhập, xuất, trả, điều chỉnh, mua SX chung, đảo giao dịch, phân quyền.
- `views/dashboard.php`: một dashboard server-rendered, các tab/form và popup.
- `public/assets/app.js`: gọi API, render bảng, xử lý form và modal.
- `public/assets/style.css`: CSS helper bổ sung cho Tailwind.
- `database/schema.sql`: schema chính.
- `database/002_receipt_parity.sql`, `database/003_issue_parity.sql`: migration tương thích lịch sử.
- `tools/import_source.php`: import snapshot JSON vào MySQL.
- `phase3d_backend/`: backend PostgreSQL pilot song song, không phải entry point của ứng dụng PHP hiện tại.

## 4. Chức năng đã có

- Tổng quan/system health, bootstrap, opening preflight, trạng thái đồng bộ.
- Tra cứu tồn kho tổng hợp và tra tồn theo Mã sản phẩm/Mã vật tư đến từng nguồn nhập, NCC và lô.
- Nhập kho theo nhà cung cấp, ĐNMH và dòng ĐNMH.
- Mua SX chung: tìm nhà cung cấp, tự gợi ý khi focus/nhập, tìm vật tư STOCK, thêm vật tư, nhập số lượng/đơn giá/ngày cần, tạo ĐNMH SX chung, danh sách gần đây.
- Xuất kho sản xuất theo reservation/BBSX.
- Trả nguyên phụ liệu từ phiếu xuất.
- Điều chỉnh tồn.
- Tra cứu chứng từ và chi tiết chứng từ.
- Đảo giao dịch POSTED có audit, không xóa/sửa chứng từ gốc.
- Idempotency theo `clientRequestId`.
- Transaction + row lock ở các nghiệp vụ ghi sổ.
- Moving average cost và append-only stock ledger.
- Popup thông báo giữa màn hình.
- Popup xác nhận trước mọi nút `Xóa`; nút `Xóa` nằm bên trái, `Hủy` nằm bên phải.

## 5. UI/UX hiện tại

- Tailwind CSS CDN.
- Font ưu tiên: `Google Sans Flex`, `Google Sans`, `Google Sans Text`, sau đó fallback system font.
- Layout full width, lề trái/phải khoảng 20px.
- Form được chia theo panel/fieldset/step, có helper text, required marker và trạng thái loading khi submit.
- Các script có query `?v=filemtime` để hạn chế cache JavaScript/CSS cũ.
- Khi sửa UI, giữ nguyên các ID mà `public/assets/app.js` đang dùng; đổi ID sẽ làm mất wiring form.

## 6. API hiện tại

API dùng dạng `public/index.php?api=<name>`:

```text
GET  bootstrap
GET  health
GET  opening-preflight
GET  sync-status
GET  open-suppliers
GET  open-prs?supplierId=...
GET  pr-lines?supplierId=...&prCode=...
GET  material-search?q=...&limit=...
GET  common-material-search?q=...&limit=...
GET  supplier-search?q=...&limit=...
GET  common-pr-list?limit=...
POST common-pr-create
GET  reservation-context?executionCode=...
POST reservation-confirm
GET  issue-context?executionCode=...
GET  returnable-issues?executionCode=...
GET  stock?q=...&limit=...
GET  stock-trace?mode=product|material&q=...&limit=...
GET  documents...
GET  document-detail?code=...
GET  adjustment-context?materialId=...
GET  reversal-preview?code=...
POST reverse
POST receipt
POST issue
POST return
POST adjustment
```

Các POST nghiệp vụ phải duy trì `clientRequestId` để chống ghi trùng. Không bỏ transaction, row lock, audit hoặc validation chỉ để làm code ngắn hơn.

## 7. Cài đặt trên máy Windows/XAMPP mới

Yêu cầu đã dùng để phát triển:

- PHP 8.2.x, extension PDO MySQL.
- XAMPP MariaDB/MySQL.
- Node.js 24.x chỉ cần khi parse/kiểm tra một số file XLSX.
- PowerShell.

### Tạo database

Mở XAMPP, bật MySQL. Tạo database và chạy schema:

```powershell
& C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS kho_npl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
Get-Content -Raw database\schema.sql | & C:\xampp\mysql\bin\mysql.exe -u root
```

Nếu dùng database cũ chưa có các cột parity, chạy thêm:

```powershell
Get-Content -Raw database\002_receipt_parity.sql | & C:\xampp\mysql\bin\mysql.exe -u root
Get-Content -Raw database\003_issue_parity.sql | & C:\xampp\mysql\bin\mysql.exe -u root
```

Để chuyển đúng dữ liệu MySQL hiện tại, dùng dump `database/kho_npl_current_2026-09-21.sql`:

```powershell
& C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS kho_npl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
Get-Content -Raw database\kho_npl_current_2026-09-21.sql | & C:\xampp\mysql\bin\mysql.exe -u root kho_npl
```

Dump này là dữ liệu hiện trạng tại thời điểm tạo tài liệu, có thể chứa dữ liệu nghiệp vụ thật; bảo quản và chuyển file an toàn.

### Import snapshot dữ liệu

Chỉ chạy khi cần tạo lại dữ liệu từ workbook; không chạy tùy tiện trên database có giao dịch thật:

```powershell
Remove-Item -Recurse -Force xlsx_unpacked -ErrorAction SilentlyContinue
New-Item -ItemType Directory xlsx_unpacked -Force | Out-Null
tar -xf source_workbook.xlsx -C xlsx_unpacked
node tools\parse_xlsx.mjs xlsx_unpacked exports
& C:\xampp\php\php.exe tools\import_source.php
```

### Chạy ứng dụng

Từ thư mục project:

```powershell
& C:\xampp\php\php.exe -S 127.0.0.1:8088 -t public
```

Mở: http://127.0.0.1:8088/

Hoặc đặt project dưới Apache XAMPP và mở `http://localhost/kho-v1/public/`.

Mặc định database trong `app/Core/Database.php`:

```text
KHO_DB_HOST=127.0.0.1
KHO_DB_PORT=3306
KHO_DB_NAME=kho_npl
KHO_DB_USER=root
KHO_DB_PASS=
KHO_ENV=THU_NGHIEM
```

Có thể dùng biến môi trường để thay đổi; không commit mật khẩu thật vào project.

## 8. Kiểm tra sau khi chuyển máy

```powershell
& C:\xampp\php\php.exe -l views\dashboard.php
& C:\xampp\php\php.exe -l public\index.php
node --check public\assets\app.js
Invoke-WebRequest http://127.0.0.1:8088/ -UseBasicParsing
Invoke-WebRequest "http://127.0.0.1:8088/?api=health" -UseBasicParsing
Invoke-WebRequest "http://127.0.0.1:8088/?api=bootstrap" -UseBasicParsing
```

Kết quả cần có:

- PHP không báo syntax error.
- Node không báo syntax error.
- Trang trả HTTP 200.
- API trả JSON `ok: true`.
- Health thường trả `PASS` nếu MySQL và dữ liệu nền đã sẵn sàng.

## 9. Quyền và an toàn nghiệp vụ

Các role tham chiếu từ Apps Script:

- `WAREHOUSE`: nhập, xuất, trả.
- `PROCUREMENT`, `PRODUCTION_MANAGER`: giữ tồn.
- `PRODUCTION_MANAGER`: điều chỉnh/đảo.
- `ADMIN`, `PILOT_ADMIN`: quyền nghiệp vụ rộng và đồng bộ.
- `ACCOUNTING`, `CEO_VIEW`: xem tổng quan/tra tồn.

Trong bản local hiện tại email người dùng có thể lấy từ `X-User-Email`, fallback là `tungnm@modaviet.vn`. Đây chỉ là cơ chế pilot; khi triển khai thật phải thay bằng đăng nhập/SSO và tắt fallback admin.

Opening Balance đang bị khóa theo nguyên tắc Apps Script. Không tự bật production/cutover khi chưa có kiểm kê, phân quyền và phê duyệt.

## 10. Việc cần làm tiếp

- Chạy regression thực tế cho Nhập kho, Mua SX chung, Xuất kho, Trả NPL, Điều chỉnh và Đảo chứng từ với dữ liệu UAT.
- Kiểm tra UI trên browser thật sau mỗi thay đổi lớn; browser tự động không luôn có sẵn trong môi trường Codex.
- Hoàn thiện đăng nhập/SSO và phân quyền production.
- Xác nhận migration/snapshot theo môi trường triển khai, không reset database giao dịch thật.
- Tối ưu/index thêm nếu benchmark thực tế cho thấy query tồn kho hoặc danh sách chứng từ chậm.

## 11. Hướng dẫn prompt cho Codex trên máy mới

Có thể bắt đầu bằng prompt sau:

```text
Đọc CODEX_HANDOFF.md trước. Đây là project Kho Nguyên Phụ Liệu V2 PHP/MySQL MVC.
Giữ nguyên logic Apps Script, không ghi ngược Google Sheet, không reset dữ liệu thật.
Trước khi sửa hãy kiểm tra file liên quan, sau khi sửa phải chạy PHP lint, node --check và test HTTP/API.
Yêu cầu hiện tại của tôi là: [mô tả việc cần làm].
```

## 12. Khi đóng gói để chuyển máy

Copy toàn bộ thư mục project, đặc biệt các mục sau:

```text
app/
public/
views/
database/
tools/
appscript_source/
exports/
source_workbook.xlsx
CODEX_HANDOFF.md
README.md
```

Có thể bỏ `xlsx_unpacked/` nếu muốn giảm dung lượng vì thư mục này tái tạo được từ `source_workbook.xlsx`. Không bỏ `appscript_source/`, `exports/` hoặc `CODEX_HANDOFF.md` nếu muốn Codex tiếp tục đúng context.
