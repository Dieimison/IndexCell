<?php
/**
 * testes/estoque.test.php - as regras de estoque que NAO podem ter copia
 * (banca r3, item 6), num banco novo temporario, pelas funcoes da API:
 *
 *   - prepararItensDeSaida(itens, os) devolve para a conta exatamente o que
 *     a OS segura SEGUNDO A vw_saidas_estoque - em cada status da OS;
 *   - "parado no estoque" e uma regra so (SQL_ESTOQUE_PARADO): a lista
 *     /entradas?disponivel=1 e o painel contam as mesmas unidades, e nao
 *     ha outra copia da condicao em api\.
 *
 * Uso: php testes/estoque.test.php
 */

declare(strict_types=1);

require __DIR__ . '/caso.php';

$banco = bancoNovoTemporario(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'index-celulares-testes');
putenv('INDEX_CELULARES_DB=' . $banco);
require __DIR__ . '/../api/api.php';

$u = ['id' => (int) consultarUm("SELECT id FROM usuarios WHERE usuario = 'admin'")['id'], 'perfil' => 'admin'];
$cliente = crudCatalogo('clientes', null, 'POST', ['nome' => 'Cliente Estoque'], [])[1]['id'];
$peca = crudCatalogo('pecas', null, 'POST', ['nome' => 'Tela teste estoque', 'categoria' => 'tela'], [])[1]['id'];
$entrada = entradas(null, 'POST', ['tipo' => 'peca', 'peca_id' => $peca, 'quantidade' => 3,
    'valor_investimento' => 20, 'valor_venda' => 60], $u, [])[1]['id'];

/** Pede $q unidades da entrada como se editasse a OS $os; devolve 'ok' ou a mensagem. */
$pedir = function (int $q, ?int $os) use ($entrada): string {
    try {
        prepararItensDeSaida([['entrada_id' => $entrada, 'quantidade' => $q]], $os);
        return 'ok';
    } catch (ErroApi $e) {
        return $e->getMessage();
    }
};
$segura = fn (int $os) => (int) consultarUm(
    "SELECT COALESCE(SUM(quantidade), 0) AS q FROM vw_saidas_estoque WHERE origem = 'os' AND os_id = ?", [$os])['q'];
$saldo = fn () => (int) consultarUm('SELECT saldo FROM vw_entradas WHERE id = ?', [$entrada])['saldo'];

// OS aberta com 2 das 3 unidades: saldo 1, a OS segura 2.
$os = criarOs(['cliente_id' => $cliente, 'modelo_nome' => 'Modelo Estoque', 'valor_orcamento' => 300,
    'itens' => [['entrada_id' => $entrada, 'quantidade' => 2, 'valor_unitario' => 60]]], $u)[1]['id'];

echo "estoque: a OS em edicao devolve o que a VIEW diz que ela segura\n";
$porStatus = [
    // status gravado direto: o teste e da regra de saldo, nao do fluxo de status
    ['aberta',    null, 2],   // segura
    ['em_reparo', null, 2],
    ['pronta',    null, 2],
    ['recusada',  null, 0],   // nao segura: a peca voltou
    ['cancelada', null, 0],
    ['entregue',  null, 2],   // entregue SEM venda (garantia, final 0) segura
];
foreach ($porStatus as [$status, , $esperaSegurar]) {
    caso("OS {$status}: a view segura {$esperaSegurar} e a edicao devolve isso a conta", function () use ($os, $status, $esperaSegurar, $pedir, $segura, $saldo) {
        executarSql('UPDATE ordens_servico SET status = ?, venda_id = NULL WHERE id = ?', [$status, $os]);
        igual($segura($os), $esperaSegurar, 'vw_saidas_estoque');
        $livre = $saldo();                       // 3 - o que a OS segura
        igual($livre, 3 - $esperaSegurar, 'saldo');
        // cabe exatamente livre + o que ela segura; um a mais e recusado
        igual($pedir($livre + $esperaSegurar, $os), 'ok', 'pedido do tamanho certo');
        verdade(str_contains($pedir($livre + $esperaSegurar + 1, $os), 'Saldo insuficiente'), 'um a mais deveria ser recusado');
    });
}
caso('OS entregue COM venda nao segura (a peca saiu pela venda): a edicao nao devolve nada', function () use ($os, $u, $segura, $pedir, $saldo) {
    executarSql("UPDATE ordens_servico SET status = 'aberta', venda_id = NULL WHERE id = ?", [$os]);
    atualizarOs($os, ['status' => 'entregue', 'valor_final' => 300], $u);
    $venda = consultarUm('SELECT venda_id FROM ordens_servico WHERE id = ?', [$os])['venda_id'];
    verdade($venda !== null, 'a OS entregue deveria ter gerado venda');
    igual([$segura($os), $saldo()], [0, 1], '[segura, saldo]');
    igual($pedir(1, $os), 'ok');
    verdade(str_contains($pedir(2, $os), 'Saldo insuficiente'), '2 deveria ser recusado (so 1 livre)');
});
caso('sem OS em edicao (venda ou OS nova) nada volta para a conta', function () use ($pedir, $saldo) {
    igual($pedir($saldo(), null), 'ok');
    verdade(str_contains($pedir($saldo() + 1, null), 'Saldo insuficiente'), 'um a mais deveria ser recusado');
});

echo "\nestoque: \"parado no estoque\" e uma regra so\n";
caso('/entradas?disponivel=1 e o painel contam as mesmas unidades', function () use ($u) {
    // um celular parado entra; um celular vendido (situacao vendido) nao
    $novoCelular = function (string $imei) use ($u): int {
        return entradas(null, 'POST', ['tipo' => 'celular', 'modelo_nome' => 'Galaxy Teste Estoque', 'imei' => $imei,
            'situacao' => 'ready', 'valor_investimento' => 500, 'valor_venda' => 900], $u, [])[1]['id'];
    };
    $parado  = $novoCelular('490154203237518');
    $vendido = $novoCelular('356938035643809');
    criarVenda(['itens' => [['entrada_id' => $vendido, 'quantidade' => 1]], 'forma_pagamento_id' =>
        (int) consultarUm('SELECT id FROM formas_pagamento WHERE padrao = 1')['id'], 'pago' => true], $u);
    $lista = entradas(null, 'GET', [], $u, ['disponivel' => '1'])[1]['itens'];
    $ids = array_map(fn ($i) => (int) $i['id'], $lista);
    verdade(in_array($parado, $ids, true) && !in_array($vendido, $ids, true), 'celular parado na lista, vendido fora');
    $daLista = array_sum(array_map(fn ($i) => (int) $i['saldo'], $lista));
    igual($daLista, (int) financeiro()['estoque']['unidades_paradas']);
    $celulares = array_sum(array_map(fn ($i) => $i['tipo'] === 'celular' ? (int) $i['saldo'] : 0, $lista));
    igual($celulares, resumo($u)['cards']['total']['quantidade'], 'cards de celular do painel');
});
caso('a condicao so existe em api/nucleo.php (SQL_ESTOQUE_PARADO)', function () {
    $copias = [];
    foreach (glob(__DIR__ . '/../api/{,rotas/}*.php', GLOB_BRACE) as $arq) {
        if (basename($arq) !== 'nucleo.php' && preg_match("/situacao\s*<>\s*'vendido'/", (string) file_get_contents($arq))) {
            $copias[] = basename($arq);
        }
    }
    igual($copias, [], 'arquivos com copia da regra');
});

@unlink($banco);
fim();
