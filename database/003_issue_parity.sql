USE kho_npl;

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD COLUMN IF NOT EXISTS post_engine_status VARCHAR(40) NULL AFTER updated_at;

ALTER TABLE issue_lines
  ADD COLUMN IF NOT EXISTS validation_status VARCHAR(30) NULL AFTER note,
  ADD COLUMN IF NOT EXISTS validation_message VARCHAR(1000) NULL AFTER validation_status,
  ADD COLUMN IF NOT EXISTS line_can_post TINYINT(1) NULL AFTER validation_message,
  ADD COLUMN IF NOT EXISTS issue_status_ref VARCHAR(40) NOT NULL DEFAULT 'DRAFT' AFTER line_can_post;

UPDATE issue_lines il
JOIN issues i ON i.issue_id=il.issue_id
SET il.issue_status_ref=i.status,
    il.validation_status=IF(i.status IN ('POSTED','REVERSED'),'OK',il.validation_status),
    il.validation_message=IF(i.status IN ('POSTED','REVERSED'),'',il.validation_message),
    il.line_can_post=IF(i.status IN ('POSTED','REVERSED'),1,il.line_can_post)
WHERE il.issue_status_ref='DRAFT' AND i.status<>'DRAFT';

UPDATE issues
SET post_engine_status=CASE status WHEN 'POSTED' THEN 'DA_GHI_SO' WHEN 'REVERSED' THEN 'DA_DAO' ELSE post_engine_status END
WHERE post_engine_status IS NULL;
