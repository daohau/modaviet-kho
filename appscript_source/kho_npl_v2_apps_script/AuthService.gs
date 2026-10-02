function getUserAccess_() {
  const email = activeUser_();
  const data = sheetObjects_(CFG.SHEETS.PERMISSIONS);
  const now = new Date();
  const activeRows = data.rows.filter(r => {
    if (!bool_(r.obj.is_active)) return false;
    const from = r.obj.effective_from ? parseDateInput_(r.obj.effective_from) : null;
    const to = r.obj.effective_to ? parseDateInput_(r.obj.effective_to) : null;
    if (from && now < from) return false;
    if (to) {
      const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
      if (now > end) return false;
    }
    return true;
  });
  const roles = activeRows.filter(r => text_(r.obj.user_email).toLowerCase() === email.toLowerCase()).map(r => text_(r.obj.role)).filter(Boolean);

  // Chỉ dùng fallback trong Pilot khi CHƯA có bất kỳ cấu hình quyền nào.
  if (!activeRows.length && CFG.ENVIRONMENT !== 'PRODUCTION') {
    return {email, roles:[CFG.ROLES.PILOT_ADMIN], pilotFallback:true};
  }
  return {email, roles:Array.from(new Set(roles)), pilotFallback:false};
}

function requireRole_(allowedRoles) {
  const access = getUserAccess_();
  const ok = access.roles.some(r => allowedRoles.indexOf(r) >= 0 || r === CFG.ROLES.ADMIN || r === CFG.ROLES.PILOT_ADMIN);
  if (!ok) throw new Error('AUTH_DENIED: Bạn không có quyền thực hiện nghiệp vụ này. Vai trò hiện tại: ' + (access.roles.join(', ') || 'CHƯA CẤP QUYỀN'));
  return access;
}

function canWarehouseTransact_() { return requireRole_([CFG.ROLES.WAREHOUSE]); }
function canPlanMaterial_() { return requireRole_([CFG.ROLES.PROCUREMENT, CFG.ROLES.PRODUCTION_MANAGER]); }
function canAdjustStock_() { return requireRole_([CFG.ROLES.PRODUCTION_MANAGER]); }
function canAdmin_() { return requireRole_([CFG.ROLES.ADMIN]); }
function canAccounting_() { return requireRole_([CFG.ROLES.ACCOUNTING]); }

// Tương thích ngược cho các hàm cũ; nghiệp vụ mới nên dùng helper đúng vai trò ở trên.
function canTransact_() { return canWarehouseTransact_(); }
