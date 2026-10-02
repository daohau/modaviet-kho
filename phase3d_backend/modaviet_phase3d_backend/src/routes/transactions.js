import { postReceiptAtomic, postIssueAtomic, postReturnAtomic } from '../services/transaction-service.js';

export async function transactionRoutes(app) {
  app.post('/v1/receipts', async (request) => postReceiptAtomic(request.user, request.body));
  app.post('/v1/issues', async (request) => postIssueAtomic(request.user, request.body));
  app.post('/v1/returns', async (request) => postReturnAtomic(request.user, request.body));
}
