function reservationKey_(executionCode, productCode, materialId) {
  return [code_(executionCode), code_(productCode), text_(materialId)].join('|');
}

function activeProductSetForExecution_(executionCode) {
  const execution = code_(executionCode);
  const set = new Set();
  objectsWhere_(CFG.SHEETS.ACTIVE_BBSX, o => code_(o['Mã biên bản']) === execution && bool_(o['Theo dõi NPL'])).forEach(o => set.add(code_(o['Mã sản phẩm'])));
  return set;
}

function reservationRequirements_(executionCode) {
  const execution = code_(executionCode);
  if (!execution) return [];
  const activeProducts = activeProductSetForExecution_(execution);
  if (!activeProducts.size) return [];
  const groups = new Map();
  objectsWhere_(CFG.SHEETS.DMSX, o => code_(o.execution_code) === execution && activeProducts.has(code_(o.product_code)) && text_(o.material_id) && num_(o.gross_requirement_qty) > 0).forEach(o => {
    const product = code_(o.product_code), material = text_(o.material_id), key = reservationKey_(execution, product, material);
    if (!groups.has(key)) groups.set(key, {
      requirementKey:key, executionCode:execution, orderCode:code_(o.order_code), productCode:product, materialId:material,
      materialName:text_(o.material_name), uom:text_(o.uom), requiredQty:0, sourceRows:[], requiredDates:[]
    });
    const x = groups.get(key); x.requiredQty += num_(o.gross_requirement_qty); x.sourceRows.push(text_(o.source_row_key));
    if (o.required_fabric_date) x.requiredDates.push(o.required_fabric_date);
    if (o.required_trim_date) x.requiredDates.push(o.required_trim_date);
  });
  return Array.from(groups.values()).map(x => {
    let requiredDate = '';
    const dates = x.requiredDates.map(d=>{try{return parseDateInput_(d)}catch(_){return null}}).filter(Boolean).sort((a,b)=>a-b);
    if (dates.length) requiredDate = dates[0];
    x.requiredDate = requiredDate; x.sourceRequirementKey = 'REQ|' + x.requirementKey; delete x.requiredDates;
    return x;
  }).sort((a,b)=>a.productCode.localeCompare(b.productCode)||a.materialId.localeCompare(b.materialId));
}

function activeReservationForKey_(key) {
  const matches = sheetObjects_(CFG.SHEETS.RESERVATION).rows.filter(r => {
    const o = r.obj;
    const same = reservationKey_(o.execution_code, o.product_code, o.material_id) === key;
    return same && ['CANCELLED'].indexOf(text_(o.status)) < 0;
  });
  if (matches.length > 1) throw new Error('RESERVATION_DUPLICATE: Có nhiều Reservation cho ' + key + '. Cần Admin xử lý trước.');
  return matches.length ? matches[0] : null;
}

function getReservationContext_(executionCode) {
  canPlanMaterial_();
  const execution = code_(executionCode);
  if (!execution) throw new Error('Thiếu Mã BBSX/M/SH');
  const reqs = reservationRequirements_(execution);
  if (!reqs.length) throw new Error('NO_ACTIVE_REQUIREMENT: Không có nhu cầu NPL đang theo dõi cho ' + execution + '. Kiểm tra Tiến độ SX/DMSX hoặc đồng bộ dữ liệu.');
  const balances = getCurrentBalances_(), totals = reservationTotalsByMaterial_(), mats = materialMap_();
  const contexts = reqs.map(req => {
    const existing = activeReservationForKey_(req.requirementKey);
    const currentRemaining = existing ? num_(existing.obj.remaining_reserved_qty) : 0;
    const issued = existing ? num_(existing.obj.issued_qty) : 0;
    const released = existing ? num_(existing.obj.released_qty) : 0;
    const physical = (balances.get(req.materialId)||{qty:0}).qty;
    const totalReserved = totals.get(req.materialId)||0;
    const globalAvailable = Math.max(physical-totalReserved,0);
    const remainingRequirement = Math.max(req.requiredQty-issued-released,0);
    const maxRemaining = Math.min(remainingRequirement, currentRemaining+globalAvailable);
    const mat = mats.get(req.materialId)||{};
    return Object.assign({},req,{
      reservationId:existing?text_(existing.obj.reservation_id):'', reservationStatus:existing?text_(existing.obj.status):'CHƯA GIỮ',
      issuedQty:issued, releasedQty:released, currentRemainingReservedQty:currentRemaining,
      physicalStock:physical, totalReserved, globalAvailable, maxRemainingReservedQty:maxRemaining, suggestedRemainingReservedQty:0,
      masterBlocked:!!mat.__duplicate
    });
  });

  // Phân bổ đề xuất theo từng vật tư để tổng đề xuất không bao giờ vượt tồn khả dụng chung.
  // Ưu tiên: ngày cần sớm hơn, sau đó mã sản phẩm. Phần đang giữ hiện tại được bảo toàn trước.
  const byMaterial = new Map();
  contexts.forEach(c=>{ if(!byMaterial.has(c.materialId)) byMaterial.set(c.materialId,[]); byMaterial.get(c.materialId).push(c); });
  byMaterial.forEach(rows=>{
    rows.sort((a,b)=>{
      const da=a.requiredDate instanceof Date?a.requiredDate.getTime():Number.MAX_SAFE_INTEGER;
      const db=b.requiredDate instanceof Date?b.requiredDate.getTime():Number.MAX_SAFE_INTEGER;
      return da-db || a.productCode.localeCompare(b.productCode);
    });
    let pool = rows.length ? rows[0].globalAvailable : 0;
    rows.forEach(c=>{
      const remainingRequirement = Math.max(c.requiredQty-c.issuedQty-c.releasedQty,0);
      const base = Math.min(c.currentRemainingReservedQty, remainingRequirement);
      const needExtra = Math.max(remainingRequirement-base,0);
      const add = Math.min(needExtra,pool);
      c.suggestedRemainingReservedQty = base + add;
      pool -= add;
    });
  });
  return contexts;
}

function confirmReservations(payload) {
  canPlanMaterial_();
  payload = payload || {};
  const execution = code_(payload.executionCode);
  const clientId = text_(payload.clientRequestId)||uuid_('REQ');
  const requested = Array.isArray(payload.lines)?payload.lines:[];
  if (!execution || !requested.length) throw new Error('Thiếu BBSX hoặc dòng giữ tồn');

  const lock=LockService.getDocumentLock(); lock.waitLock(30000);
  try {
    const duplicate=objectsWhere_(CFG.SHEETS.AUDIT,o=>
      text_(o.client_request_id)===clientId && ['CONFIRM_RESERVATION','REALLOCATE_RESERVATION'].indexOf(text_(o.action))>=0
    );
    if(duplicate.length) return {ok:true,idempotent:true,clientRequestId:clientId,updated:0,created:0,context:getReservationContext_(execution)};

    // Tính lại context bên trong lock để không over-reserve khi có nhiều người thao tác đồng thời.
    const context = getReservationContext_(execution);
    const ctxMap = new Map(context.map(x=>[x.requirementKey,x]));
    const changes = requested.map(x=>{
      const key=text_(x.requirementKey), ctx=ctxMap.get(key);
      if(!ctx) throw new Error('Không tìm thấy nhu cầu: '+key);
      if(ctx.masterBlocked) throw new Error('BLOCK_MASTER_DUPLICATE: '+ctx.materialId);
      const desired=num_(x.remainingReservedQty);
      if(desired<0) throw new Error('SL giữ không được âm: '+ctx.materialId);
      if(desired>ctx.maxRemainingReservedQty+1e-9) throw new Error('BLOCK_RESERVATION: '+ctx.materialId+' chỉ có thể giữ tối đa '+ctx.maxRemainingReservedQty+', yêu cầu '+desired);
      return {ctx,desired,delta:desired-ctx.currentRemainingReservedQty};
    });
    const positiveByMaterial=new Map();
    changes.forEach(c=>{if(c.delta>0)positiveByMaterial.set(c.ctx.materialId,(positiveByMaterial.get(c.ctx.materialId)||0)+c.delta);});
    const byMaterialFirst=new Map(); context.forEach(c=>{if(!byMaterialFirst.has(c.materialId))byMaterialFirst.set(c.materialId,c);});
    positiveByMaterial.forEach((sum,material)=>{const base=byMaterialFirst.get(material);if(sum>(base?base.globalAvailable:0)+1e-9)throw new Error('BLOCK_RESERVATION: Tổng tăng giữ '+material+' vượt tồn khả dụng');});

    let updated=0,created=0;
    changes.forEach(c=>{
      const ctx=c.ctx, existing=activeReservationForKey_(ctx.requirementKey), now=new Date();
      if(existing){
        const issued=num_(existing.obj.issued_qty), released=num_(existing.obj.released_qty);
        const newConfirmed=issued+released+c.desired;
        const status=c.desired<=1e-9?(issued>0?'CLOSED':'CANCELLED'):(issued>0?'PARTIAL_ISSUED':'CONFIRMED');
        patchRow_(CFG.SHEETS.RESERVATION,existing.row,{order_code:ctx.orderCode||execution,required_qty:ctx.requiredQty,suggested_reserved_qty:ctx.suggestedRemainingReservedQty,confirmed_reserved_qty:newConfirmed,remaining_reserved_qty:c.desired,required_date:ctx.requiredDate||'',status,confirmed_by:activeUser_(),confirmed_at:now,updated_at:now,source_requirement_key:ctx.sourceRequirementKey});
        appendAudit_('REALLOCATE_RESERVATION','RESERVATION',text_(existing.obj.reservation_id),clientId,'Cập nhật giữ tồn',ctx.currentRemainingReservedQty,c.desired); updated++;
      } else if(c.desired>0){
        const id=uuid_('RES');
        appendObjects_(CFG.SHEETS.RESERVATION,[{reservation_id:id,order_code:ctx.orderCode||execution,execution_code:execution,product_code:ctx.productCode,material_id:ctx.materialId,required_qty:ctx.requiredQty,suggested_reserved_qty:ctx.suggestedRemainingReservedQty,confirmed_reserved_qty:c.desired,issued_qty:0,released_qty:0,remaining_reserved_qty:c.desired,priority:1,required_date:ctx.requiredDate||'',status:'CONFIRMED',confirmed_by:activeUser_(),confirmed_at:now,created_at:now,updated_at:now,source_environment:CFG.ENVIRONMENT,source_requirement_key:ctx.sourceRequirementKey}]);
        appendAudit_('CONFIRM_RESERVATION','RESERVATION',id,clientId,'Xác nhận giữ tồn','0',c.desired); created++;
      }
    });
    SpreadsheetApp.flush();
    return {ok:true,idempotent:false,clientRequestId:clientId,updated,created,context:getReservationContext_(execution)};
  } finally {lock.releaseLock();}
}

