export async function nextDocumentCode(client, type, dateString) {
  const prefixMap = { RECEIPT: 'PN', ISSUE: 'PX', RETURN: 'TL', ADJUSTMENT: 'DC' };
  const prefix = prefixMap[type];
  if (!prefix) throw new Error('Unsupported document type: ' + type);
  const { rows } = await client.query(
    `INSERT INTO document_counter(doc_type, doc_date, last_no)
     VALUES ($1,$2::date,1)
     ON CONFLICT (doc_type, doc_date)
     DO UPDATE SET last_no = document_counter.last_no + 1
     RETURNING last_no`,
    [type, dateString]
  );
  const d = new Date(dateString + 'T00:00:00Z');
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${prefix}${yy}${mm}${dd}-${String(rows[0].last_no).padStart(3, '0')}`;
}
