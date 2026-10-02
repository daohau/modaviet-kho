# Regression trên backend DB

- TC01 Auth positive/negative
- TC02 Receipt normal
- TC03 Partial/reject/over receipt with reason
- TC04 Issue within reservation
- TC05 Block reservation/negative stock
- TC06 Return usable + block over-return
- TC07 Idempotency/double-click same client_request_id
- TC08 Reconcile stock ledger / payable / material cost / audit

Acceptance: 8/8 PASS và p95 POST <= 1500 ms trước khi bàn cutover.
