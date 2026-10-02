<?php
declare(strict_types=1);

namespace KhoNpl\Core;

use PDO;
use PDOException;

final class Database
{
    private static ?PDO $pdo = null;

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) return self::$pdo;
        $host = getenv('KHO_DB_HOST') ?: '127.0.0.1';
        $port = getenv('KHO_DB_PORT') ?: '3306';
        $name = getenv('KHO_DB_NAME') ?: 'kho_npl';
        $user = getenv('KHO_DB_USER') ?: 'root';
        $pass = getenv('KHO_DB_PASS') ?: '';
        $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
        self::$pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_PERSISTENT => true,
        ]);
        self::$pdo->exec("SET time_zone = '+07:00'");
        return self::$pdo;
    }

    public static function transaction(callable $callback): mixed
    {
        $pdo = self::connection();
        $pdo->beginTransaction();
        try {
            $result = $callback($pdo);
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }
}
