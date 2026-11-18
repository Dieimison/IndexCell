<?php
// q.php <banco> <sql> - um SELECT no banco de TESTE dos roteiros; uma linha JSON por registro.
$db = new PDO('sqlite:' . $argv[1]);
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$st = $db->query($argv[2]);
foreach (($st->columnCount() ? $st->fetchAll(PDO::FETCH_ASSOC) : []) as $linha) {
    echo json_encode($linha, JSON_UNESCAPED_UNICODE), "\n";
}
