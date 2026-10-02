<?php
declare(strict_types=1);

namespace KhoNpl\Core;

final class Router
{
    public function dispatch(): never
    {
        $api = (string)Request::query('api', 'bootstrap');
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $controller = new \KhoNpl\Controllers\ApiController();
        try {
            $result = $controller->handle($method, $api, Request::json());
            Response::ok($result);
        } catch (HttpException $e) {
            Response::json(['ok' => false, 'error' => ['code' => $e->codeName, 'message' => $e->getMessage()]], $e->status);
        } catch (\Throwable $e) {
            error_log($e->__toString());
            Response::json(['ok' => false, 'error' => ['code' => 'RUNTIME_ERROR', 'message' => $e->getMessage()]], 500);
        }
    }
}
