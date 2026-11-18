<?php
/**
 * testes/relatorios.test.php - a receita sem dupla contagem, no SQL de
 * verdade (vw_faturamentos/vw_receitas, lidas por relatorios() e
 * financeiro()). O teste do front so soma o que ja veio separado; quem
 * separa balcao de oficina e esta parte, e e ela que este teste exercita.
 *
 * Monta, num banco novo temporario, pelas funcoes da propria API:
 *   - venda de balcao de 100 (custo 40)
 *   - OS entregue com peca 50 (custo 20) + servico 80, paga 100 Pix + 30 debito
 *     -> gera a venda de 130, que NAO pode contar como balcao nem duas vezes
 *   - OS antiga entregue SEM venda, de 70 (gravada como no fluxo antigo)
 *   - OS de garantia entregue com valor final 0 (nao gera venda)
 *   - venda cancelada de 999 (nao conta)
 *
 * Uso: php testes/relatorios.test.php
 */

declare(strict_types=1);

require __DIR__ . '/caso.php';

$banco = bancoNovoTemporario(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'index-celulares-testes');
putenv('INDEX_CELULARES_DB=' . $banco);
require __DIR__ . '/../api/api.php';

$u = ['id' => (int) consultarUm("SELECT id FROM usuarios WHERE usuario = 'admin'")['id'], 'perfil' => 'admin'];
$hoje = date('Y-m-d');
$cliente = crudCatalogo('clientes', null, 'POST', ['nome' => 'Cliente Relatorio'], [])[1]['id'];
$pix = (int) consultarUm("SELECT id FROM formas_pagamento WHERE nome = 'Pix'")['id'];
$debito = (int) consultarUm("SELECT id FROM formas_pagamento WHERE nome = 'Cartão de débito'")['id'];
$servico = (int) consultarUm("SELECT id FROM servicos WHERE nome = 'Troca de tela'")['id'];
$entrada = function (float $custo, float $venda) use ($u): int {
    $peca = crudCatalogo('pecas', null, 'POST', ['nome' => 'Peca ' . mt_rand(), 'categoria' => 'tela'], [])[1]['id'];
    return entradas(null, 'POST', ['tipo' => 'peca', 'peca_id' => $peca, 'quantidade' => 5,
        'valor_investimento' => $custo, 'valor_venda' => $venda], $u, [])[1]['id'];
};

// balcao 100, custo 40
$e1 = $entrada(40, 100);
criarVenda(['itens' => [['entrada_id' => $e1, 'quantidade' => 1]], 'forma_pagamento_id' => $pix, 'pago' => true], $u);
// OS 130 (peca 50 custo 20 + servico 80), pagamento dividido 100 Pix + 30 debito
$e2 = $entrada(20, 50);
$os = criarOs(['cliente_id' => $cliente, 'modelo_nome' => 'Modelo Rel', 'status' => 'entregue',
    'itens' => [['entrada_id' => $e2, 'quantidade' => 1, 'valor_unitario' => 50],
                ['servico_id' => $servico, 'descricao' => 'Troca de tela', 'quantidade' => 1, 'valor_unitario' => 80]],
    'pagamentos' => [['forma_pagamento_id' => $pix, 'valor' => 100], ['forma_pagamento_id' => $debito, 'valor' => 30]]], $u)[1]['id'];
// OS antiga sem venda (como o fluxo antigo gravava): 70, peca de custo 10
$e3 = $entrada(10, 40);
$antiga = criarOs(['cliente_id' => $cliente, 'modelo_nome' => 'Modelo Rel', 'valor_mao_obra' => 30,
    'itens' => [['entrada_id' => $e3, 'quantidade' => 1, 'valor_unitario' => 40]]], $u)[1]['id'];
executarSql("UPDATE ordens_servico SET status = 'entregue', data_entrega = ? WHERE id = ?", [agora(), $antiga]);
// OS de garantia: valor final 0 -> nao gera venda
$e4 = $entrada(15, 45);
$garantia = criarOs(['cliente_id' => $cliente, 'modelo_nome' => 'Modelo Rel', 'status' => 'entregue', 'valor_final' => 0,
    'itens' => [['entrada_id' => $e4, 'quantidade' => 1, 'valor_unitario' => 45]]], $u)[1]['id'];
// venda cancelada
$c = criarVenda(['itens' => [['descricao' => 'Cancelada', 'valor_unitario' => 999]]], $u)[1]['id'];
atualizarVenda($c, ['status' => 'cancelada'], $u);

$rel = relatorios();
$dia = array_values(array_filter($rel['diario'], fn ($d) => $d['dia'] === $hoje))[0] ?? [];

echo "relatorios: receita sem dupla contagem\n";
caso('balcao = so a venda de balcao (100), custo 40, 1 venda', fn () =>
    igual([emCentavos($dia['receita_vendas'] ?? 0), emCentavos($dia['custo_vendas'] ?? 0), $dia['quantidade'] ?? 0], [10000, 4000, 1]));
caso('oficina = venda gerada pela OS (130) + OS antiga (70) + garantia (0) = 200; custo 20 + 10 + 15', fn () =>
    igual([emCentavos($dia['receita_os'] ?? 0), emCentavos($dia['custo_os'] ?? 0)], [20000, 4500]));
caso('a OS entregue com venda conta UMA vez (3 documentos de oficina: venda da OS, OS antiga, garantia)', fn () =>
    igual($dia['qtd_os'] ?? 0, 3));
caso('a venda gerada pela OS nao aparece como balcao no ranking', function () use ($rel, $hoje) {
    $troca = array_values(array_filter($rel['itens'], fn ($i) => $i['descricao'] === 'Troca de tela' && $i['dia'] === $hoje));
    igual([count($troca), $troca[0]['origem'] ?? null, emCentavos($troca[0]['receita'] ?? 0)], [1, 'os', 8000]);
});
caso('rosca: o pagamento dividido entra 100 Pix + 30 debito (oficina); o balcao 100 Pix', function () use ($rel, $hoje) {
    $m = [];
    foreach ($rel['pagamentos'] as $p) {
        if ($p['dia'] === $hoje) {
            $m[$p['origem'] . '/' . $p['forma']] = emCentavos($p['total']);
        }
    }
    igual([$m['venda/Pix'] ?? 0, $m['os/Pix'] ?? 0, $m['os/Cartão de débito'] ?? 0], [10000, 10000, 3000]);
});
caso('vw_receitas soma o mesmo que o faturamento real (vendas concluidas + OS sem venda)', function () {
    $receitas = emCentavos(consultarUm('SELECT SUM(receita) AS s FROM vw_receitas')['s']);
    $real = emCentavos(consultarUm("SELECT SUM(valor_total) AS s FROM vendas WHERE status = 'concluida'")['s'])
          + emCentavos(consultarUm("SELECT SUM(valor_final) AS s FROM ordens_servico WHERE status = 'entregue' AND venda_id IS NULL")['s']);
    igual($receitas, $real);
});

echo "\nfinanceiro: os mesmos numeros\n";
$fin = financeiro();
caso('receita de balcao 100 e de oficina 200', fn () =>
    igual([emCentavos($fin['vendas']['receita_vendas']), emCentavos($fin['os']['receita_os'])], [10000, 20000]));
caso('OS de valor final 0 nao gerou venda e a peca saiu pela OS', function () use ($garantia, $e4) {
    igual([consultarUm('SELECT venda_id FROM ordens_servico WHERE id = ?', [$garantia])['venda_id'],
           (int) consultarUm('SELECT saldo FROM vw_entradas WHERE id = ?', [$e4])['saldo']], [null, 4]);
});
caso('a peca da OS com venda saiu uma vez so (saldo 4 de 5)', fn () =>
    igual((int) consultarUm('SELECT saldo FROM vw_entradas WHERE id = ?', [$e2])['saldo'], 4));

echo "\nOS entregue: \"Como o cliente pagou\" e dinheiro recebido\n";
$contasDaOs = fn (int $osId) => consultar(
    'SELECT l.forma_pagamento, l.status, l.valor FROM lancamentos l
       JOIN ordens_servico o ON o.venda_id = l.venda_id WHERE o.id = ? ORDER BY l.id', [$osId]);
caso('OS paga 100 Pix + 30 debito: as duas contas nascem PAGAS', fn () =>
    igual(array_map(fn ($l) => [$l['forma_pagamento'], $l['status']], $contasDaOs($os)),
          [['Pix', 'pago'], ['Cartão de débito', 'pago']]));
$fiado = (int) consultarUm("SELECT id FROM formas_pagamento WHERE nome = 'Fiado'")['id'];
$e5 = $entrada(5, 25);
$osFiado = criarOs(['cliente_id' => $cliente, 'modelo_nome' => 'Modelo Rel', 'status' => 'entregue',
    'itens' => [['entrada_id' => $e5, 'quantidade' => 1, 'valor_unitario' => 25]],
    'pagamentos' => [['forma_pagamento_id' => $pix, 'valor' => 15], ['forma_pagamento_id' => $fiado, 'valor' => 10]]], $u)[1]['id'];
caso('OS paga 15 Pix + 10 fiado: o Pix nasce pago, o fiado fica PENDENTE', fn () =>
    igual(array_map(fn ($l) => [$l['forma_pagamento'], $l['status'], emCentavos($l['valor'])], $contasDaOs($osFiado)),
          [['Pix', 'pago', 1500], ['Fiado', 'pendente', 1000]]));
$e6 = $entrada(5, 30);
$osSemPagamento = criarOs(['cliente_id' => $cliente, 'modelo_nome' => 'Modelo Rel', 'status' => 'entregue',
    'itens' => [['entrada_id' => $e6, 'quantidade' => 1, 'valor_unitario' => 30]]], $u)[1]['id'];
caso('OS entregue sem "Como o cliente pagou": a conta fica PENDENTE (ninguem disse que recebeu)', fn () =>
    igual(array_column($contasDaOs($osSemPagamento), 'status'), ['pendente']));

echo "\nranking: a receita do item ja com o desconto\n";
$e7 = $entrada(10, 60);
$e8 = $entrada(10, 40);
criarVenda(['itens' => [['entrada_id' => $e7, 'quantidade' => 1, 'valor_unitario' => 60],
                        ['entrada_id' => $e8, 'quantidade' => 1, 'valor_unitario' => 40]],
            'desconto' => 10, 'forma_pagamento_id' => $pix, 'pago' => true], $u);
$e9 = $entrada(8, 50);
$osDesconto = criarOs(['cliente_id' => $cliente, 'modelo_nome' => 'Modelo Rel', 'status' => 'entregue', 'valor_final' => 40,
    'itens' => [['entrada_id' => $e9, 'quantidade' => 1, 'valor_unitario' => 50]],
    'pagamentos' => [['forma_pagamento_id' => $pix, 'valor' => 40]]], $u)[1]['id'];
$rel = relatorios();
$noRanking = function (int $entradaId) use ($rel, $hoje): ?int {
    $nome = consultarUm('SELECT item FROM vw_entradas WHERE id = ?', [$entradaId])['item'];
    $l = array_values(array_filter($rel['itens'], fn ($i) => $i['descricao'] === $nome && $i['dia'] === $hoje));
    return $l ? emCentavos($l[0]['receita']) : null;
};
caso('venda 60 + 40 com 10 de desconto: o ranking conta 54 e 36 (antes 60 e 40)', fn () =>
    igual([$noRanking($e7), $noRanking($e8)], [5400, 3600]));
caso('OS de peca 50 com valor final 40: o ranking conta a peca por 40', fn () =>
    igual($noRanking($e9), 4000));
caso('a garantia (valor final 0) nao entra no ranking como 45', fn () =>
    igual($noRanking($e4), 0));
caso('o ranking do dia soma o mesmo que a receita do dia, menos a mao de obra avulsa', function () use ($rel, $hoje) {
    $ranking = array_sum(array_map(fn ($i) => emCentavos($i['receita']),
        array_filter($rel['itens'], fn ($i) => $i['dia'] === $hoje)));
    $dia = array_values(array_filter($rel['diario'], fn ($d) => $d['dia'] === $hoje))[0];
    // a OS antiga (70) tem 30 de mao de obra digitada, que nao e item
    igual($ranking, emCentavos($dia['receita_vendas']) + emCentavos($dia['receita_os']) - 3000);
});

echo "\nbrinde: o custo do item vira despesa\n";
$despesasHoje = fn (array $r) => emCentavos(array_values(array_filter($r['diario'], fn ($d) => $d['dia'] === $hoje))[0]['despesas'] ?? 0);
$antes = $despesasHoje($rel);
$e10 = $entrada(12.5, 30);
$mov = movimentacoes(null, 'POST', ['entrada_id' => $e10, 'motivo' => 'brinde', 'quantidade' => 2], $u, [])[1]['id'];
$rel = relatorios();
caso('brinde de 2 unidades de custo 12,50: as despesas do dia sobem 25', fn () =>
    igual($despesasHoje($rel) - $antes, 2500));
caso('a rosca de despesas mostra "Brinde / cortesia" com 25', function () use ($rel, $hoje) {
    $b = array_values(array_filter($rel['despesas_categoria'], fn ($d) => $d['dia'] === $hoje && $d['categoria'] === 'Brinde / cortesia'));
    igual([count($b), emCentavos($b[0]['total'] ?? 0)], [1, 2500]);
});
movimentacoes($mov, 'DELETE', [], $u, []);
caso('desfeito o brinde, a despesa sai junto', fn () => igual($despesasHoje(relatorios()), $antes));
caso('perda NAO entra como despesa de brinde', function () use ($entrada, $u, $despesasHoje, $antes) {
    $e = $entrada(9, 20);
    movimentacoes(null, 'POST', ['entrada_id' => $e, 'motivo' => 'perda', 'quantidade' => 1], $u, []);
    igual($despesasHoje(relatorios()), $antes);
});

@unlink($banco);
fim();
