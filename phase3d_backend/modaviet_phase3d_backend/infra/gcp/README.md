# Provision GCP Pilot

Yêu cầu: project GCP có Billing, gcloud đã login, quyền tạo Cloud Run/Cloud SQL/Secret Manager.

```bash
export PROJECT_ID=your-project-id
export REGION=asia-southeast1
./infra/gcp/deploy.sh
```

Deploy script cố ý để Cloud Run **không public**. Phase benchmark dùng Cloud Run IAM ở lớp ngoài; app tạm bật `AUTH_BYPASS_FOR_LOCAL=true` để regression gửi `x-user-email`, nhưng request chỉ tới service nếu có IAM invoker. Trước khi UI cho nhân viên dùng, phải đổi sang Google OAuth thật và tắt bypass.

Sau deploy:
1. Dùng Cloud SQL Auth Proxy hoặc Cloud Run Job để chạy migration.
2. `npm run migrate`
3. `npm run seed -- uat_baseline`
4. `API_URL=... npm run regression`
5. `npm run seed -- benchmark`
6. `API_URL=... N=100 npm run benchmark:post`

Không cutover nếu p95 > 1500 ms.
