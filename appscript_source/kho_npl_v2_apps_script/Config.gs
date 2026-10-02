const CFG = Object.freeze({
  SPREADSHEET_ID: '1HcJ7BYJp3_we0UX8DcRyM1ek8bcWbsvibKhB9hBKN2A',
  ENVIRONMENT: 'THU_NGHIEM',
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  OPENING_POST_ENABLED: false,
  SHEETS: Object.freeze({
    RECEIPT_H: 'DL_PHIẾU NHẬP',
    RECEIPT_L: 'DL_CHI TIẾT NHẬP',
    ISSUE_H: 'DL_PHIẾU XUẤT',
    ISSUE_L: 'DL_CHI TIẾT XUẤT',
    RETURN: 'DL_TRẢ KHO',
    ADJUSTMENT: 'DL_ĐIỀU CHỈNH',
    RESERVATION: 'DL_GIỮ TỒN',
    LEDGER: 'SỔ_KHO',
    PAYABLE_VIEW: 'RA_NGUỒN CÔNG NỢ',
    COST_VIEW: 'RA_CHI PHÍ VẬT TƯ',
    MATERIAL_STATUS_VIEW: 'RA_TÌNH TRẠNG VẬT TƯ',
    AUDIT: 'NHẬT KÝ THAO TÁC',
    ERROR_LOG: 'HT_NHẬT KÝ LỖI',
    CONFIG: 'HT_CẤU HÌNH',
    PERMISSIONS: 'HT_PHÂN QUYỀN',
    DATA_SOURCES: 'HT_NGUỒN DỮ LIỆU',
    MATERIAL: 'DM_VẬT TƯ',
    SUPPLIER: 'DM_NHÀ CUNG CẤP',
    ORDER_PRODUCT: 'DM_ĐƠN HÀNG SẢN PHẨM',
    DMSX: 'DM_ĐỊNH MỨC SX',
    ACTIVE_BBSX: 'DM_BBSX ĐANG HOẠT ĐỘNG',
    PR_OPEN: 'DM_ĐNMH ĐANG MỞ',
    STOCK_VIEW: '02_TỒN KHO',
    OPENING_CANDIDATE: 'CD_ỨNG VIÊN TỒN ĐẦU'
  }),
  HEADER_ROW: 4,
  DATA_START_ROW: 5,
  RECEIPT_STATUS: Object.freeze({DRAFT:'DRAFT', POSTED:'POSTED', REVERSED:'REVERSED', ERROR:'ERROR'}),
  ISSUE_STATUS: Object.freeze({DRAFT:'DRAFT', POSTED:'POSTED', REVERSED:'REVERSED', ERROR:'ERROR'}),
  RETURN_STATUS: Object.freeze({DRAFT:'DRAFT', POSTED:'POSTED', REVERSED:'REVERSED', ERROR:'ERROR'}),
  ITEM_CLASS: Object.freeze({STOCK:'STOCK', NON_STOCK:'NON_STOCK', SERVICE:'SERVICE'}),
  ROLES: Object.freeze({WAREHOUSE:'WAREHOUSE', PROCUREMENT:'PROCUREMENT', ACCOUNTING:'ACCOUNTING', PRODUCTION_MANAGER:'PRODUCTION_MANAGER', ADMIN:'ADMIN', CEO_VIEW:'CEO_VIEW', PILOT_ADMIN:'PILOT_ADMIN'})
});

function ss_() { return SpreadsheetApp.openById(CFG.SPREADSHEET_ID); }

function sh_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Không tìm thấy sheet: ' + name);
  return sh;
}

function activeUser_() { return Session.getActiveUser().getEmail() || 'PILOT_USER'; }
