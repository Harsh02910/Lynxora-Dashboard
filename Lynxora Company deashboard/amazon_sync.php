<?php
/**
 * Lynxora — Amazon SP-API Proxy
 * Deploy this file to your Hostinger server alongside index.html
 * 
 * Endpoints:
 *   POST /amazon_sync.php?action=get_orders
 *   Body JSON: { sellerId, clientId, clientSecret, refreshToken, marketplace, createdAfter? }
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'POST method required']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$action = $_GET['action'] ?? 'get_orders';
$sellerId     = $input['sellerId'] ?? '';
$clientId     = $input['clientId'] ?? '';
$clientSecret = $input['clientSecret'] ?? '';
$refreshToken = $input['refreshToken'] ?? '';
$marketplace  = $input['marketplace'] ?? 'amazon.in';
$createdAfter = $input['createdAfter'] ?? date('Y-m-d\TH:i:s\Z', strtotime('-7 days'));

if (!$sellerId || !$clientId || !$clientSecret || !$refreshToken) {
    echo json_encode(['error' => 'Missing required credentials (sellerId, clientId, clientSecret, refreshToken)']);
    exit;
}

// Marketplace endpoints
$marketplaceMap = [
    'amazon.in'  => ['endpoint' => 'https://sellingpartnerapi-fe.amazon.com', 'marketplaceId' => 'A21TJRUUN4KGV'],
    'amazon.com' => ['endpoint' => 'https://sellingpartnerapi-na.amazon.com', 'marketplaceId' => 'ATVPDKIKX0DER'],
];

$mpConfig = $marketplaceMap[$marketplace] ?? $marketplaceMap['amazon.in'];

// ── Step 1: Exchange Refresh Token for Access Token ──
function getAccessToken($clientId, $clientSecret, $refreshToken) {
    $ch = curl_init('https://api.amazon.com/auth/o2/token');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_POSTFIELDS => http_build_query([
            'grant_type'    => 'refresh_token',
            'refresh_token' => $refreshToken,
            'client_id'     => $clientId,
            'client_secret' => $clientSecret,
        ]),
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        return ['error' => 'Token exchange failed (HTTP ' . $httpCode . ')', 'response' => $response];
    }

    $data = json_decode($response, true);
    return $data['access_token'] ?? ['error' => 'No access_token in response'];
}

// ── Step 2: Fetch Orders from SP-API ──
function fetchOrders($endpoint, $accessToken, $marketplaceId, $createdAfter) {
    $url = $endpoint . '/orders/v0/orders?' . http_build_query([
        'MarketplaceIds' => $marketplaceId,
        'CreatedAfter'   => $createdAfter,
        'OrderStatuses'  => 'Unshipped,PartiallyShipped,Shipped',
        'MaxResultsPerPage' => 50,
    ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => [
            'x-amz-access-token: ' . $accessToken,
            'Content-Type: application/json',
        ],
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        return ['error' => 'Orders API failed (HTTP ' . $httpCode . ')', 'response' => $response];
    }

    return json_decode($response, true);
}

// ── Step 3: Fetch Order Items for each order ──
function fetchOrderItems($endpoint, $accessToken, $orderId) {
    $url = $endpoint . '/orders/v0/orders/' . $orderId . '/orderItems';

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'x-amz-access-token: ' . $accessToken,
            'Content-Type: application/json',
        ],
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        return ['error' => 'Order items API failed (HTTP ' . $httpCode . ')'];
    }

    return json_decode($response, true);
}

// ── Main Execution ──
try {
    if ($action === 'test') {
        $token = getAccessToken($clientId, $clientSecret, $refreshToken);
        if (is_array($token) && isset($token['error'])) {
            echo json_encode(['success' => false, 'error' => $token['error']]);
        } else {
            echo json_encode(['success' => true, 'message' => 'Connection successful!']);
        }
        exit;
    }

    // Get access token
    $accessToken = getAccessToken($clientId, $clientSecret, $refreshToken);
    if (is_array($accessToken) && isset($accessToken['error'])) {
        echo json_encode(['success' => false, 'error' => $accessToken['error']]);
        exit;
    }

    // Fetch orders
    $ordersResult = fetchOrders($mpConfig['endpoint'], $accessToken, $mpConfig['marketplaceId'], $createdAfter);
    if (isset($ordersResult['error'])) {
        echo json_encode(['success' => false, 'error' => $ordersResult['error']]);
        exit;
    }

    $orders = $ordersResult['payload']['Orders'] ?? [];
    $processedOrders = [];

    foreach ($orders as $order) {
        $orderId = $order['AmazonOrderId'] ?? '';
        $orderDate = $order['PurchaseDate'] ?? '';
        $orderStatus = $order['OrderStatus'] ?? '';
        $orderTotal = 0;
        $currency = 'INR';

        if (isset($order['OrderTotal'])) {
            $orderTotal = floatval($order['OrderTotal']['Amount'] ?? 0);
            $currency = $order['OrderTotal']['CurrencyCode'] ?? 'INR';
        }

        // Fetch order items
        $itemsResult = fetchOrderItems($mpConfig['endpoint'], $accessToken, $orderId);
        $items = $itemsResult['payload']['OrderItems'] ?? [];

        foreach ($items as $item) {
            $processedOrders[] = [
                'orderId'   => $orderId,
                'product'   => $item['Title'] ?? ($item['SellerSKU'] ?? 'Unknown Product'),
                'sku'       => $item['SellerSKU'] ?? '',
                'asin'      => $item['ASIN'] ?? '',
                'quantity'  => intval($item['QuantityOrdered'] ?? 1),
                'amount'    => floatval($item['ItemPrice']['Amount'] ?? $orderTotal),
                'currency'  => $item['ItemPrice']['CurrencyCode'] ?? $currency,
                'status'    => $orderStatus,
                'date'      => substr($orderDate, 0, 10),
            ];
        }

        // Rate limit: sleep 200ms between order item requests
        usleep(200000);
    }

    echo json_encode([
        'success'    => true,
        'sellerId'   => $sellerId,
        'orderCount' => count($processedOrders),
        'orders'     => $processedOrders,
        'syncedAt'   => date('Y-m-d H:i:s'),
    ]);

} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
