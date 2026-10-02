function nextDocCodeUnlocked_(prefix, propertyPrefix) {
  const day = Utilities.formatDate(new Date(), CFG.TIMEZONE, 'yyMMdd');
  const key = propertyPrefix + '_' + day;
  const props = PropertiesService.getDocumentProperties();
  const next = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(next));
  return prefix + day + '-' + String(next).padStart(3, '0');
}

function nextDocCode_(prefix, propertyPrefix) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try { return nextDocCodeUnlocked_(prefix, propertyPrefix); }
  finally { lock.releaseLock(); }
}

function nextReceiptCode_() { return nextDocCode_('PN', 'RECEIPT_SEQ'); }
function nextIssueCode_() { return nextDocCode_('PX', 'ISSUE_SEQ'); }
function nextReturnCode_() { return nextDocCode_('TL', 'RETURN_SEQ'); }
function nextAdjustmentCode_() { return nextDocCode_('DC', 'ADJ_SEQ'); }
function nextReversalCode_() { return nextDocCode_('RV', 'REV_SEQ'); }
function nextOpeningBatchCode_() { return nextDocCode_('OB', 'OPENING_SEQ'); }

// Chỉ gọi các hàm *Locked_ khi caller đang giữ DocumentLock.
function nextReceiptCodeLocked_() { return nextDocCodeUnlocked_('PN', 'RECEIPT_SEQ'); }
function nextIssueCodeLocked_() { return nextDocCodeUnlocked_('PX', 'ISSUE_SEQ'); }
function nextReturnCodeLocked_() { return nextDocCodeUnlocked_('TL', 'RETURN_SEQ'); }
function nextAdjustmentCodeLocked_() { return nextDocCodeUnlocked_('DC', 'ADJ_SEQ'); }
function nextReversalCodeLocked_() { return nextDocCodeUnlocked_('RV', 'REV_SEQ'); }
function nextOpeningBatchCodeLocked_() { return nextDocCodeUnlocked_('OB', 'OPENING_SEQ'); }

function uuid_(prefix) { return prefix + '-' + Utilities.getUuid(); }
