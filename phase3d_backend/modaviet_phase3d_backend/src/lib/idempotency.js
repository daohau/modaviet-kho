import { AppError } from './errors.js';

export async function beginIdempotent(client, { key, operation, userEmail, requestHash = null }) {
  if (!key) throw new AppError('CLIENT_REQUEST_ID_REQUIRED', 'Thiếu client_request_id', 400);
  const { rows } = await client.query(
    `INSERT INTO idempotency_request(client_request_id, operation, user_email, request_hash, status)
     VALUES ($1,$2,$3,$4,'PROCESSING')
     ON CONFLICT (client_request_id) DO NOTHING
     RETURNING client_request_id`,
    [key, operation, userEmail, requestHash]
  );
  if (rows.length) return { reused: false };
  const existing = await client.query(
    `SELECT status, response_json, operation FROM idempotency_request WHERE client_request_id=$1 FOR UPDATE`, [key]
  );
  const row = existing.rows[0];
  if (!row) throw new AppError('IDEMPOTENCY_STATE_ERROR', 'Không đọc được trạng thái chống trùng', 500);
  if (row.operation !== operation) throw new AppError('CLIENT_REQUEST_ID_CONFLICT', 'client_request_id đã dùng cho nghiệp vụ khác', 409);
  if (row.status === 'DONE') return { reused: true, response: row.response_json };
  throw new AppError('REQUEST_IN_PROGRESS', 'Yêu cầu đang được xử lý, vui lòng chờ', 409);
}

export async function finishIdempotent(client, key, response) {
  await client.query(
    `UPDATE idempotency_request SET status='DONE', response_json=$2::jsonb, completed_at=now() WHERE client_request_id=$1`,
    [key, JSON.stringify(response)]
  );
}
