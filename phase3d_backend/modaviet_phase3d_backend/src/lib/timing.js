export function nowNs() { return process.hrtime.bigint(); }
export function elapsedMs(start) { return Number(process.hrtime.bigint() - start) / 1e6; }
export function roundMs(n) { return Math.round(n * 10) / 10; }
