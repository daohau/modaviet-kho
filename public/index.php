<?php
declare(strict_types=1);

require_once __DIR__ . '/../app/Core/Database.php';
require_once __DIR__ . '/../app/Core/HttpException.php';
require_once __DIR__ . '/../app/Core/Request.php';
require_once __DIR__ . '/../app/Core/Response.php';
require_once __DIR__ . '/../app/Core/Router.php';
require_once __DIR__ . '/../app/Support/helpers.php';
require_once __DIR__ . '/../app/Services/AuthService.php';
require_once __DIR__ . '/../app/Services/InventoryService.php';
require_once __DIR__ . '/../app/Services/QueryService.php';
require_once __DIR__ . '/../app/Services/TransactionService.php';
require_once __DIR__ . '/../app/Services/ReceiptService.php';
require_once __DIR__ . '/../app/Services/IssueService.php';
require_once __DIR__ . '/../app/Services/CommonPurchaseService.php';
require_once __DIR__ . '/../app/Services/ReversalService.php';
require_once __DIR__ . '/../app/Controllers/ApiController.php';

use KhoNpl\Core\Router;

if (isset($_GET['api'])) { (new Router())->dispatch(); }
require __DIR__ . '/../views/dashboard.php';
