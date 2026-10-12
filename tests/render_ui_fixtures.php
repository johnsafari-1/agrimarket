<?php
define('ROOT_PATH', dirname(__DIR__)); define('APP_NAME','AgriMarket');
require ROOT_PATH . '/app/support/helpers.php'; require ROOT_PATH . '/app/support/ui.php';
class PreviewStatement extends PDOStatement { public function __construct(){} public function execute(?array $params=null):bool{return true;} public function fetch(int $mode=PDO::FETCH_DEFAULT,int $orientation=PDO::FETCH_ORI_NEXT,int $offset=0):mixed{return ['c'=>0];} }
class PreviewPDO extends PDO {public function __construct(){} public function prepare(string $query,array $options=[]):PDOStatement|false{return new PreviewStatement();}}
if (!is_dir(__DIR__.'/ui-artifacts')) mkdir(__DIR__.'/ui-artifacts', 0700);
$pdo=new PreviewPDO(); $_SESSION=['user_id'=>4,'full_name'=>'Peter Otieno','role'=>'Buyer']; $_SERVER['SCRIPT_NAME']='order.php';
$page_title='Order tracking';$order=['order_id'=>1084,'status'=>'Shipped','order_date'=>'2026-10-12 14:20:00','buyer_name'=>'Peter Otieno','estimated_delivery_date'=>'2026-10-14','estimated_delivery_window'=>'Morning','delivery_address'=>"Nakuru town\nKenyatta Avenue, near the market",'total_amount'=>1650];
$id=1084;$is_owner=true;$statuses=['Pending','Confirmed','Shipped','Delivered'];$current_index=2;
$items=[['product_name'=>'Fresh Irish potatoes','farmer_name'=>'John Kiprop','farmer_id'=>2,'quantity'=>10,'unit'=>'kg','unit_price'=>80],['product_name'=>'Fresh maize','farmer_name'=>'John Kiprop','farmer_id'=>2,'quantity'=>10,'unit'=>'kg','unit_price'=>55],['product_name'=>'Sukuma wiki','farmer_name'=>'Mary Wanjiku','farmer_id'=>3,'quantity'=>10,'unit'=>'bunch','unit_price'=>30]];
$events=[['status'=>'Pending','note'=>'Order placed.','event_epoch'=>strtotime('2026-10-12 14:20')],['status'=>'Confirmed','note'=>'Harvest checked. Your produce is being prepared.','event_epoch'=>strtotime('2026-10-12 15:10')],['status'=>'Shipped','note'=>'Dispatched from Nakuru. Your farmer will contact you before arrival.','event_epoch'=>strtotime('2026-10-13 08:30')]];
$txns=[['payment_method'=>'Cash on Delivery','payment_status'=>'Pending','amount'=>'1650.00']];
ob_start(); include ROOT_PATH . '/resources/views/layout/header.php';include ROOT_PATH . '/resources/views/orders/show.php';include ROOT_PATH . '/resources/views/layout/footer.php';file_put_contents(__DIR__.'/ui-artifacts/order.html',ob_get_clean());
$snapshot=['id'=>1084,'status'=>'Shipped','expected_date'=>'2026-10-14','expected_window'=>'Morning','events'=>array_map(fn($e)=>['status'=>$e['status'],'note'=>$e['note'],'at'=>date(DATE_ATOM,$e['event_epoch'])],$events),'payments'=>$txns];file_put_contents(__DIR__.'/ui-artifacts/snapshot.json',json_encode($snapshot));
$_SESSION=[];$active_tab='login';$flash=null;$errors=[];$reg_errors=[];$reg_old=[];ob_start();include ROOT_PATH . '/resources/views/auth/login.php';file_put_contents(__DIR__.'/ui-artifacts/login.html',ob_get_clean());
