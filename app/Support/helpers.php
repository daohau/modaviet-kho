<?php
declare(strict_types=1);

use KhoNpl\Core\HttpException;

function s(mixed $value): string { return trim((string)($value ?? '')); }
function code(mixed $value): string { return strtoupper(s($value)); }
function n(mixed $value): float { return is_numeric($value) ? (float)$value : 0.0; }
function positive(mixed $value, string $message = 'Số lượng phải > 0'): float { $x = n($value); if ($x <= 0) throw new HttpException($message, 'BLOCK_VALIDATION'); return $x; }
function require_true(bool $condition, string $message, string $codeName = 'BLOCK_VALIDATION', int $status = 400): void { if (!$condition) throw new HttpException($message, $codeName, $status); }
function uuid_id(string $prefix): string { return $prefix . '-' . bin2hex(random_bytes(16)); }
function date_ymd(mixed $value): string { $v = s($value); if (!$v) return date('Y-m-d'); $dt = date_create($v); if (!$dt) throw new HttpException('Ngày không hợp lệ: ' . $v, 'INVALID_DATE'); return $dt->format('Y-m-d'); }
function json_hash(array $payload): string { return hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)); }
