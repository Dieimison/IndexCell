<?php
/*
 * Confere invariantes de negocio direto no banco (somente leitura).
 * Uso: php integridade.php caminho\do\banco.sqlite
 * Imprime so contagens e ids - nenhum dado pessoal.
 */
$db = $argv[1] ?? '';
if (!is_file($db)) { fwrite(STDERR, "banco nao encontrado: $db\n"); exit(2); }
$p = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$p->exec('PRAGMA query_only = 1');

$checks = [
  'I1 saldo negativo em alguma entrada' =>
    "SELECT entrada_id AS id, saldo FROM vw_entradas_saldo WHERE saldo < 0",
  // ADAPTADO-r3 (decisao 4): venda paga que mudou de valor guarda o pago e lanca a diferenca;
  // se o valor novo e menor, a diferenca e uma DEVOLUCAO a pagar ao cliente (tipo 'pagar').
  // O total da venda e o que entra menos o que volta.
  'I2 venda concluida cujo total != a receber - devolucoes, nao cancelados (tolerancia 0,005)' =>
    "SELECT v.id, v.valor_total AS venda,
            ROUND(COALESCE(SUM(CASE WHEN l.tipo = 'receber' THEN l.valor ELSE -l.valor END),0),2) AS lancamentos
       FROM vendas v LEFT JOIN lancamentos l ON l.venda_id = v.id AND l.status <> 'cancelado'
      WHERE v.status = 'concluida' GROUP BY v.id
     HAVING ABS(v.valor_total - COALESCE(SUM(CASE WHEN l.tipo = 'receber' THEN l.valor ELSE -l.valor END),0)) > 0.005",
  'I3 venda com valor_bruto - desconto != valor_total' =>
    "SELECT id, valor_bruto, desconto, valor_total FROM vendas WHERE ABS(valor_bruto - desconto - valor_total) > 0.005",
  'I4 venda com valor_bruto != soma dos itens' =>
    "SELECT v.id, v.valor_bruto, ROUND(SUM(vi.subtotal),2) AS itens FROM vendas v JOIN venda_itens vi ON vi.venda_id = v.id
      GROUP BY v.id HAVING ABS(v.valor_bruto - SUM(vi.subtotal)) > 0.005",
  'I5 OS com pagamentos lancados cuja soma != valor_final (folga 0,011)' =>
    "SELECT o.id, o.status, o.valor_final, ROUND(SUM(p.valor),2) AS pagamentos FROM ordens_servico o JOIN os_pagamentos p ON p.os_id = o.id
      GROUP BY o.id HAVING ABS(o.valor_final - SUM(p.valor)) > 0.011",
  'I6 OS entregue com venda cujo total != valor_final' =>
    "SELECT o.id, o.valor_final, v.valor_total FROM ordens_servico o JOIN vendas v ON v.id = o.venda_id
      WHERE ABS(o.valor_final - v.valor_total) > 0.005",
  'I7 OS entregue com venda_id e venda cancelada (peca volta a prateleira com OS entregue)' =>
    "SELECT o.id FROM ordens_servico o JOIN vendas v ON v.id = o.venda_id WHERE o.status='entregue' AND v.status <> 'concluida'",
  'I8 OS nao-entregue que ainda aponta para venda' =>
    "SELECT id, status FROM ordens_servico WHERE status <> 'entregue' AND venda_id IS NOT NULL",
  'I9 celular marcado vendido com saldo > 0 (sumiu da prateleira)' =>
    "SELECT e.id FROM entradas e JOIN vw_entradas_saldo s ON s.entrada_id = e.id WHERE e.tipo='celular' AND e.situacao='vendido' AND s.saldo > 0",
  'I10 OS com valor_pecas != soma das linhas de peca' =>
    "SELECT o.id, o.valor_pecas, ROUND(COALESCE(SUM(CASE WHEN i.servico_id IS NULL THEN i.subtotal END),0),2) AS itens
       FROM ordens_servico o LEFT JOIN os_itens i ON i.os_id = o.id GROUP BY o.id
      HAVING ABS(o.valor_pecas - COALESCE(SUM(CASE WHEN i.servico_id IS NULL THEN i.subtotal END),0)) > 0.005",
  'I11 lancamento com valor <= 0' =>
    "SELECT id, valor, origem FROM lancamentos WHERE valor <= 0",
  'I12 valores negativos em entradas/itens' =>
    "SELECT 'entrada' AS t, id FROM entradas WHERE valor_investimento < 0 OR valor_venda < 0
     UNION ALL SELECT 'venda_item', id FROM venda_itens WHERE valor_unitario < 0
     UNION ALL SELECT 'os_item', id FROM os_itens WHERE valor_unitario < 0",
  'I13 PRAGMA foreign_key_check' => "PRAGMA foreign_key_check",
  // r3: invariantes das regras novas
  'I14 mais de uma forma de pagamento padrao' =>
    "SELECT COUNT(*) AS padroes FROM formas_pagamento WHERE padrao = 1 HAVING COUNT(*) > 1",
  // ADAPTADO-r4 (item 5): a OS recusada tambem devolve o aparelho - a senha sai junto.
  'I15 senha de desbloqueio guardada em OS entregue/cancelada/recusada (sem outra OS aberta do aparelho)' =>
    "SELECT o.id FROM ordens_servico o JOIN aparelhos a ON a.id = o.aparelho_id
      WHERE o.status IN ('entregue','cancelada','recusada') AND a.senha_aparelho IS NOT NULL
        AND o.id = (SELECT MAX(o2.id) FROM ordens_servico o2 WHERE o2.aparelho_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM ordens_servico o3 WHERE o3.aparelho_id = a.id
                         AND o3.status IN ('aberta','orcamento','aprovada','em_reparo','pronta'))",
  'I16 vw_receitas diferente do faturamento real (vendas concluidas + OS entregue sem venda)' =>
    "SELECT (SELECT ROUND(COALESCE(SUM(receita),0),2) FROM vw_receitas) AS view,
            (SELECT ROUND(COALESCE((SELECT SUM(valor_total) FROM vendas WHERE status='concluida'),0)
                  + COALESCE((SELECT SUM(valor_final) FROM ordens_servico WHERE status='entregue' AND venda_id IS NULL AND data_entrega IS NOT NULL),0),2)) AS real
      WHERE ABS(view - real) > 0.005",
  // r4 (item 1): um aparelho fisico (IMEI) e no maximo uma unidade vendavel.
  'I17 IMEI repetido entre celulares com saldo > 0' =>
    "SELECT GROUP_CONCAT(e.id) AS entradas FROM entradas e JOIN vw_entradas_saldo s ON s.entrada_id = e.id
      WHERE e.tipo = 'celular' AND e.imei IS NOT NULL AND TRIM(e.imei) <> '' AND s.saldo > 0
      GROUP BY e.imei HAVING COUNT(*) > 1",
];

$falhas = 0;
foreach ($checks as $nome => $sql) {
    $linhas = $p->query($sql)->fetchAll();
    $n = count($linhas);
    if ($n) { $falhas++; }
    $amostra = array_slice($linhas, 0, 6);
    printf("%-4s %s: %d%s\n", $n ? 'XX' : 'ok', $nome, $n,
        $n ? '  ex.: ' . json_encode($amostra, JSON_UNESCAPED_UNICODE) : '');
}
echo "\ninvariantes violadas: $falhas de " . count($checks) . "\n";
// ADAPTADO-r3: codigo de saida para o testes\rodar.bat (1 = alguma invariante violada).
exit($falhas ? 1 : 0);
