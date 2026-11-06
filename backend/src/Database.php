<?php

declare(strict_types=1);

namespace App;

use PDO;

final class Database
{
    public static function connect(): PDO
    {
        $name = self::env('DB_NAME', 'musicranker');
        self::assertIdentifier($name);

        return self::pdo(sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            self::env('DB_HOST', '127.0.0.1'),
            self::env('DB_PORT', '3306'),
            $name
        ));
    }

    public static function server(): PDO
    {
        return self::pdo(sprintf(
            'mysql:host=%s;port=%s;charset=utf8mb4',
            self::env('DB_HOST', '127.0.0.1'),
            self::env('DB_PORT', '3306')
        ));
    }

    public static function env(string $key, string $default = ''): string
    {
        $value = $_ENV[$key] ?? $_SERVER[$key] ?? getenv($key);
        if ($value === false || $value === null || $value === '') {
            return $default;
        }

        return (string) $value;
    }

    public static function assertIdentifier(string $name): void
    {
        if (!preg_match('/^[A-Za-z0-9_]+$/', $name)) {
            throw new \InvalidArgumentException('Invalid database name.');
        }
    }

    private static function pdo(string $dsn): PDO
    {
        return new PDO($dsn, self::env('DB_USER', 'musicranker'), self::env('DB_PASS', ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
}
