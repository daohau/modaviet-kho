function appendAudit_(action, objectType, objectId, clientRequestId, reason, oldValue, newValue) {
  appendObjects_(CFG.SHEETS.AUDIT, [{
    audit_id: Utilities.getUuid(), timestamp: new Date(), user_email: activeUser_(),
    action, object_type: objectType, object_id: objectId, field_name: '',
    old_value: oldValue || '', new_value: newValue || '', reason: reason || '',
    client_request_id: clientRequestId || '', environment: CFG.ENVIRONMENT
  }]);
}

function errorCodeFrom_(err) {
  const msg = err && err.message ? String(err.message) : String(err || '');
  const m = msg.match(/^([A-Z0-9_]+):/);
  return m ? m[1] : 'RUNTIME_ERROR';
}

function logError_(fnName, err, objectId, objectType, clientRequestId) {
  try {
    const msg = err && err.message ? String(err.message) : String(err || '');
    appendObjects_(CFG.SHEETS.ERROR_LOG, [{
      error_id: uuid_('ERR'),
      timestamp: new Date(),
      user_email: activeUser_(),
      function_name: fnName || '',
      object_type: objectType || '',
      object_id: objectId || '',
      client_request_id: clientRequestId || '',
      error_code: errorCodeFrom_(err),
      error_message: msg,
      stack_or_context: err && err.stack ? String(err.stack) : '',
      status: 'OPEN'
    }]);
  } catch (_) {}
}

function appendAuditOnce_(action, objectType, objectId, clientRequestId, reason, oldValue, newValue) {
  const exists=objectsWhere_(CFG.SHEETS.AUDIT,o=>text_(o.action)===text_(action)&&text_(o.object_type)===text_(objectType)&&text_(o.object_id)===text_(objectId)&&text_(o.client_request_id)===text_(clientRequestId));
  if(exists.length) return false;
  appendAudit_(action,objectType,objectId,clientRequestId,reason,oldValue,newValue); return true;
}
