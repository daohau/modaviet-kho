function doGet() {
  const t=HtmlService.createTemplateFromFile('index');
  t.appTitle='Kho Nguyên Phụ Liệu V2';
  return t.evaluate().setTitle('Kho NPL V2').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include_(name){return HtmlService.createHtmlOutputFromFile(name).getContent();}

function apiBootstrap(){
  const access=getUserAccess_();
  return {environment:CFG.ENVIRONMENT,user:access.email,roles:access.roles,pilotFallback:access.pilotFallback,opening:openingPreflight_(),health:systemHealth_(),codeStatus:getConfigValue_('WEBAPP_CODE_STATUS',''),deployStatus:getConfigValue_('WEBAPP_DEPLOY_STATUS',''),runtimeVersion:getConfigValue_('WEBAPP_RUNTIME_VERSION',''),suppliers:listOpenSuppliers_().slice(0,300),syncStatus:getSyncStatus_()};
}
function apiListOpenPrs(supplierId){return listOpenPrs_(supplierId);}
function apiGetPrLines(supplierId,prCode){return getOpenPrLines_(supplierId,prCode);}
function apiCreateAndPostReceipt(payload){return createAndPostReceipt(payload);}
function apiReservationContext(executionCode){return getReservationContext_(executionCode);}
function apiConfirmReservations(payload){return confirmReservations(payload);}
function apiIssueContext(executionCode){return getIssueContext_(code_(executionCode));}
function apiCreateAndPostIssue(payload){return createAndPostIssue(payload);}
function apiReturnableIssues(executionCode){return getReturnableIssueLines_(code_(executionCode));}
function apiCreateAndPostReturn(payload){return createAndPostReturn(payload);}
function apiSearchStock(query){return stockSearch_(query,100);}
function apiAdjustmentContext(materialId){return getAdjustmentMaterialContext_(materialId);}
function apiCreateAndPostAdjustment(payload){return createAndPostAdjustment(payload);}
function apiListDocuments(filters){return listDocuments_(filters);}
function apiDocumentDetail(documentCode){return getDocumentDetail_(documentCode);}
function apiReversalPreview(documentCode){return getReversalPreview_(documentCode);}
function apiReversePostedDocument(payload){return reversePostedDocument(payload);}
function apiSyncAll(){return syncAllNow();}
function apiInstallSyncTriggers(){return installSyncTriggers();}
function apiSyncStatus(){canAdmin_();return getSyncStatus_();}
function apiOpeningPreflight(){return openingPreflight_();}
function apiSystemHealth(){return systemHealth_();}
