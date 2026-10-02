<?php
declare(strict_types=1);

namespace KhoNpl\Core;

final class Request
{
    public static function json(): array
    {
        $raw = file_get_contents('php://input') ?: '';
        $data = json_decode($raw, true);
        return is_array($data) ? $data : $_POST;
    }

    public static function query(string $key, mixed $default = null): mixed
    {
        return $_GET[$key] ?? $default;
    }

    public static function userEmail(): string
    {
        return strtolower(trim((string)($_SERVER['HTTP_X_USER_EMAIL'] ?? $_GET['user'] ?? getenv('KHO_DEV_USER') ?: 'tungnm@modaviet.vn')));
    }
}
