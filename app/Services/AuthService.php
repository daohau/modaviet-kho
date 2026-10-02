<?php
declare(strict_types=1);

namespace KhoNpl\Services;

use KhoNpl\Core\Database;
use KhoNpl\Core\HttpException;

final class AuthService
{
    public function __construct(private readonly \PDO $db) {}

    public function access(string $email): array
    {
        $stmt = $this->db->prepare("SELECT role_code FROM user_roles WHERE email=? AND is_active=1 AND (effective_from IS NULL OR effective_from<=CURRENT_DATE()) AND (effective_to IS NULL OR effective_to>=CURRENT_DATE())");
        $stmt->execute([strtolower(trim($email))]);
        $roles = array_column($stmt->fetchAll(), 'role_code');
        $fallback = false;
        if (!$roles && (getenv('KHO_ENV') ?: 'THU_NGHIEM') !== 'PRODUCTION') { $roles = ['PILOT_ADMIN']; $fallback = true; }
        return ['email' => strtolower(trim($email)), 'roles' => array_values(array_unique($roles)), 'pilotFallback' => $fallback];
    }

    public function require(string $email, array $allowed): array
    {
        $access = $this->access($email);
        $ok = (bool)array_intersect($access['roles'], array_merge($allowed, ['ADMIN', 'PILOT_ADMIN']));
        if (!$ok) throw new HttpException('Bạn không có quyền thực hiện nghiệp vụ này. Vai trò hiện tại: ' . ($access['roles'] ? implode(', ', $access['roles']) : 'CHƯA CẤP QUYỀN'), 'AUTH_DENIED', 403);
        return $access;
    }
}
