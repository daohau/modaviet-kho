# MODAVIET Kho NPL V2 — Phase 3D Backend Pilot

Backend PostgreSQL được dựng song song với Apps Script UAT reference.

## Nguyên tắc an toàn
- PILOT_DB only.
- Không ghi file nguồn Modaviet.
- Không bật Opening Balance.
- Không cutover khi chưa regression 8/8 + benchmark p95 <= 1.5s.

## Local / Cloud Run
1. Tạo PostgreSQL database.
2. Copy `.env.example` -> env vars.
3. `npm install`
4. `npm run migrate`
5. `npm start`
6. `GET /healthz`, `GET /readyz`

## Cloud Run đề xuất
- Region: asia-southeast1
- min instances: 1
- concurrency: bắt đầu 20, benchmark rồi điều chỉnh
- CPU: 1 vCPU, RAM 512Mi–1Gi Pilot
- DB cùng region; dùng connection pool.

## API chính
- POST /v1/receipts
- POST /v1/issues
- POST /v1/returns
- GET /v1/catalog/*
- GET /v1/stock/:materialId

Mỗi POST cần `clientRequestId`; server bảo đảm idempotency và transaction atomic.

## Automated UAT/benchmark
- `npm run seed -- uat_baseline` → reset Pilot DB to isolated UAT baseline.
- `npm run regression` → automated core TC02–TC08 + idempotency/reconciliation.
- `npm run seed -- benchmark` → create 300 isolated receipt lines.
- `npm run benchmark:post` → 100 real POST transactions and p50/p95/p99.

The Pilot DB dataset is synthetic and must never be connected to production cutover until approved.
