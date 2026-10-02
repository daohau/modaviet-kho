# Performance SLO — Modaviet Kho NPL V2

Mục tiêu người dùng: phản hồi thao tác ghi sổ thông thường trong khoảng 1–1,5 giây.

## SLO Pilot
- End-to-end p50: <= 800 ms
- End-to-end p95: <= 1,500 ms
- API server p95 (header x-modaviet-server-ms): <= 800 ms
- DB transaction p95 mục tiêu: <= 350 ms
- Error rate: < 0.5% trong benchmark không cố ý tạo validation error
- Không cold-start trong giờ làm việc: Cloud Run min instances = 1

## Ngân sách latency
- Browser/UI + serialize: 100 ms
- Network VN -> Singapore -> VN: 200–350 ms mục tiêu
- Auth token verify/cache + routing: 50–150 ms
- Business validation + SQL: 150–350 ms
- Commit + response: 50–150 ms
- Headroom: 300–500 ms

## PASS để đi tiếp
Không cutover nếu 3 vòng benchmark (>=100 POST hợp lệ/vòng) có p95 > 1,500 ms hoặc có duplicate/negative stock/reconciliation mismatch.
