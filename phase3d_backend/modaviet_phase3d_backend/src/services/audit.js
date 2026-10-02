export async function audit(client, {userEmail, action, objectType, objectId, clientRequestId, reason, oldValue = null, newValue = null}) {
  await client.query(
    `INSERT INTO audit_log(user_email, action, object_type, object_id, old_value, new_value, reason, client_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [userEmail, action, objectType, objectId, oldValue, newValue, reason, clientRequestId]
  );
}
