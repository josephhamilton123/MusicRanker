<?php

declare(strict_types=1);

namespace App\Services;

use App\HttpException;

final class Http
{
    /**
     * @param list<string> $headers
     * @return array{status: int, body: array<string, mixed>, raw: string}
     */
    public static function request(string $method, string $url, array $headers = [], ?string $body = null): array
    {
        if (!function_exists('curl_init')) {
            throw new HttpException(500, 'The PHP curl extension is required for Spotify.');
        }

        $handle = curl_init($url);
        if ($handle === false) {
            throw new HttpException(502, 'Could not start the Spotify request.');
        }

        $options = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_CAINFO => self::caBundle(),
        ];
        if ($body !== null) {
            $options[CURLOPT_POSTFIELDS] = $body;
        }
        curl_setopt_array($handle, $options);

        $raw = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $error = curl_error($handle);
        curl_close($handle);

        if ($raw === false) {
            throw new HttpException(502, 'Spotify request failed: ' . $error);
        }

        $decoded = json_decode($raw, true);

        return [
            'status' => $status,
            'body' => is_array($decoded) ? $decoded : [],
            'raw' => $raw,
        ];
    }

    private static function caBundle(): string
    {
        $candidates = [
            (string) getenv('CURL_CA_BUNDLE'),
            (string) ini_get('curl.cainfo'),
            dirname(__DIR__, 2) . '/storage/cacert.pem',
        ];
        foreach ($candidates as $path) {
            if ($path !== '' && is_file($path)) {
                return $path;
            }
        }

        throw new HttpException(500, 'PHP has no CA certificate bundle, so Spotify HTTPS cannot be verified.');
    }
}
