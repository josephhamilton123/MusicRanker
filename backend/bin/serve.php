<?php

declare(strict_types=1);

$port = getenv('PORT');
if ($port === false || $port === '') {
    $port = '8080';
}
if (!preg_match('/^\d+$/', $port)) {
    fwrite(STDERR, "PORT must be a number.\n");
    exit(1);
}

$public = dirname(__DIR__) . '/public';
$command = sprintf(
    'php -S 0.0.0.0:%s -t %s %s',
    $port,
    escapeshellarg($public),
    escapeshellarg($public . '/router.php'),
);

passthru($command, $exitCode);
exit($exitCode);
