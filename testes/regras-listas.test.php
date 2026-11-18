<?php
/**
 * testes/regras-listas.test.php - v6: listas de opcoes, empresa e regras
 * por chave (geral x empresa), com o banco de verdade (temporario).
 *
 *   listas   a grafia vem da lista ("apple" grava "Apple"); valor novo
 *            entra na lista; todo caminho que grava marca/cor/categoria
 *            passa por ela; editar sem mexer nao poe lixo na lista.
 *   chaves   empresa > geral > padrao; historico de cada mudanca;
 *            valor recusado pelo tipo; chave desconhecida recusada.
 *   venda    as quatro regras conferidas NO SERVIDOR (criar e editar),
 *            para balcao; o admin so tem a de cliente obrigatorio.
 *   empresa  CNPJ com digito verificador.
 */

declare(strict_types=1);

require __DIR__ . '/caso.php';

$banco = bancoNovoTemporario(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'index-celulares-testes');
putenv('INDEX_CELULARES_DB=' . $banco);
require __DIR__ . '/../api/api.php';

$admin = ['id' => (int) consultarUm("SELECT id FROM usuarios WHERE usuario = 'admin'")['id'], 'perfil' => 'admin'];
executarSql("INSERT INTO usuarios (usuario, nome, senha_hash, perfil, ativo, trocar_senha) VALUES ('balcao1', 'Balcao Teste', ?, 'balcao', 1, 0)",
            [gerarHash('Balcao-Teste-2026x')]);
$balcao = ['id' => (int) banco()->lastInsertId(), 'perfil' => 'balcao'];
$pix   = (int) consultarUm("SELECT id FROM formas_pagamento WHERE nome = 'Pix'")['id'];
$fiado = (int) consultarUm("SELECT id FROM formas_pagamento WHERE nome = 'Fiado'")['id'];
$cliente = crudCatalogo('clientes', null, 'POST', ['nome' => 'Cliente Regras'], [])[1]['id'];

/** Roda e devolve [codigo, mensagem] (200/201 = gravou). */
$tentar = function (callable $f): array {
    try {
        $r = $f();
        return [$r[0], $r[1]['mensagem'] ?? ''];
    } catch (ErroApi $e) {
        return [$e->codigo, $e->getMessage()];
    }
};
$produto = crudCatalogo('produtos', null, 'POST', ['nome' => 'Pelicula regras'], [])[1]['id'];
$entrada = entradas(null, 'POST', ['tipo' => 'produto', 'produto_id' => $produto, 'quantidade' => 50,
    'valor_investimento' => 10, 'valor_venda' => 100], $admin, [])[1]['id'];
$vender = function (array $usuario, array $extra = []) use ($entrada, $pix, $cliente): array {
    return criarVenda($extra + ['itens' => [['entrada_id' => $entrada, 'quantidade' => 1]], 'forma_pagamento_id' => $pix,
                                'cliente_id' => $cliente, 'pago' => true], $usuario);
};
$regra = function (string $chave, string $escopo, $valor) use ($admin) {
    return chaves(null, 'POST', ['chave' => $chave, 'escopo' => $escopo, 'valor' => $valor], $admin);
};

echo "\nlistas: a grafia vem da lista\n";
caso('valor da lista com outra caixa grava a grafia da lista', fn () =>
    igual([valorDaLista('marcas', 'apple'), valorDaLista('marcas', '  SAMSUNG '), valorDaLista('cores', 'preto')],
          ['Apple', 'Samsung', 'Preto']));
caso('vazio continua vazio (nao entra na lista)', fn () =>
    igual([valorDaLista('marcas', ''), valorDaLista('marcas', '   '), valorDaLista('marcas', null)], [null, null, null]));
caso('valor novo entra na lista; todo em minuscula ganha a 1a maiuscula', function () {
    igual(valorDaLista('marcas', 'nokia'), 'Nokia');
    igual(valorDaLista('marcas', 'NOKIA'), 'Nokia', 'segunda vez acha a mesma');
    igual(valorDaLista('marcas', 'iPhone'), 'iPhone', 'quem escreveu misturado fica como escreveu');
    igual((int) consultarUm("SELECT COUNT(*) n FROM opcoes_lista WHERE lista = 'marcas' AND minusculas(valor) = 'nokia'")['n'], 1);
});
caso('cadastro de modelo: marca e armazenamento passam pela lista', function () {
    $id = crudCatalogo('modelos', null, 'POST', ['marca' => 'motorola', 'modelo' => 'Moto Teste', 'armazenamento' => '128gb'], [])[1]['id'];
    $m = consultarUm('SELECT marca, armazenamento FROM modelos WHERE id = ?', [$id]);
    igual([$m['marca'], $m['armazenamento']], ['Motorola', '128GB']);
});
caso('modelo cadastrado na hora (OS/entrada) tambem passa pela lista', function () {
    $id = acharOuCriarModelo('Redmi Teste', 'xiaomi', '64gb');
    $m = consultarUm('SELECT marca, armazenamento FROM modelos WHERE id = ?', [$id]);
    igual([$m['marca'], $m['armazenamento']], ['Xiaomi', '64GB']);
});
caso('cor do celular na entrada passa pela lista', function () use ($admin) {
    $modelo = acharOuCriarModelo('Cor Teste', 'Apple', '');
    $id = entradas(null, 'POST', ['tipo' => 'celular', 'modelo_id' => $modelo, 'cor' => 'azul', 'imei' => '',
        'valor_investimento' => 100, 'valor_venda' => 200, 'situacao' => 'processamento'], $admin, [])[1]['id'];
    igual(consultarUm('SELECT cor FROM entradas WHERE id = ?', [$id])['cor'], 'Azul');
});
caso('produto: categoria e marca passam pela lista', function () {
    $id = crudCatalogo('produtos', null, 'POST', ['nome' => 'Capa lista', 'categoria' => 'capa', 'marca' => 'samsung'], [])[1]['id'];
    $p = consultarUm('SELECT categoria, marca FROM produtos WHERE id = ?', [$id]);
    igual([$p['categoria'], $p['marca']], ['Capa', 'Samsung']);
});
caso('editar a conta gerada pela venda (categoria "venda") nao poe "venda" na lista', function () use ($vender, $admin) {
    $venda = $vender($admin)[1]['id'];
    $lanc = consultarUm('SELECT * FROM lancamentos WHERE venda_id = ?', [$venda]);
    lancamentos((int) $lanc['id'], 'PUT', ['categoria' => 'venda', 'descricao' => $lanc['descricao']], $admin, []);
    igual((int) consultarUm("SELECT COUNT(*) n FROM opcoes_lista WHERE lista = 'categorias_lancamento' AND valor = 'venda'")['n'], 0);
});

echo "\nlistas: a rota\n";
caso('POST de valor que ja existe devolve o existente (200), sem duplicar', function () use ($balcao) {
    [$codigo, $r] = listas(null, 'POST', ['lista' => 'cores', 'valor' => 'BRANCO'], [], $balcao);
    igual([$codigo, $r['valor']], [200, 'Branco']);
});
caso('POST de valor novo pelo balcao: 201', function () use ($balcao) {
    [$codigo, $r] = listas(null, 'POST', ['lista' => 'cores', 'valor' => 'Lilás'], [], $balcao);
    igual([$codigo, $r['valor']], [201, 'Lilás']);
});
caso('lista desconhecida: 400', fn () => igual($tentar(fn () => listas(null, 'POST', ['lista' => 'senhas', 'valor' => 'x'], [], $GLOBALS['admin']))[0], 400));
caso('balcao nao tira valor da lista (403); admin tira e o GET sem "todas" nao mostra', function () use ($tentar, $balcao, $admin) {
    $id = (int) consultarUm("SELECT id FROM opcoes_lista WHERE lista = 'cores' AND valor = 'Lilás'")['id'];
    igual($tentar(fn () => listas($id, 'PUT', ['ativo' => false], [], $balcao))[0], 403);
    listas($id, 'PUT', ['ativo' => false], [], $admin);
    $cores = array_column(listas(null, 'GET', [], [], $admin)[1]['listas']['cores'], 'valor');
    $todas = array_column(listas(null, 'GET', [], ['todas' => 1], $admin)[1]['listas']['cores'], 'valor');
    igual([in_array('Lilás', $cores, true), in_array('Lilás', $todas, true)], [false, true]);
});
caso('cadastrar de novo um valor desativado devolve ele para a lista', function () use ($balcao) {
    [$codigo, $r] = listas(null, 'POST', ['lista' => 'cores', 'valor' => 'lilás'], [], $balcao);
    igual([$codigo, $r['valor'], (int) consultarUm("SELECT ativo FROM opcoes_lista WHERE valor = 'Lilás'")['ativo']], [200, 'Lilás', 1]);
});

echo "\nchaves: empresa > geral > padrao\n";
caso('sem nada gravado vale o padrao do codigo', fn () =>
    igual(valoresDaChave('venda.exigir_cliente'), ['padrao' => '0', 'geral' => null, 'empresa' => null, 'valor' => '0', 'origem' => 'padrao']));
caso('geral grava e vale', function () use ($regra) {
    $regra('venda.desconto_maximo_balcao', 'geral', 10);
    igual([chave('venda.desconto_maximo_balcao'), valoresDaChave('venda.desconto_maximo_balcao')['origem']], ['10', 'geral']);
});
caso('empresa vence o geral', function () use ($regra) {
    $regra('venda.desconto_maximo_balcao', 'empresa', '20');
    igual([chave('venda.desconto_maximo_balcao'), valoresDaChave('venda.desconto_maximo_balcao')['origem']], ['20', 'empresa']);
});
caso('apagar o da empresa (valor null) volta a valer o geral', function () use ($regra) {
    $regra('venda.desconto_maximo_balcao', 'empresa', null);
    igual([chave('venda.desconto_maximo_balcao'), valoresDaChave('venda.desconto_maximo_balcao')['origem']], ['10', 'geral']);
});
caso('cada mudanca entrou no historico (antes/depois, escopo, quem)', function () use ($admin) {
    $h = consultar("SELECT escopo, antes, depois, usuario_id FROM chaves_historico WHERE chave = 'venda.desconto_maximo_balcao' ORDER BY id");
    igual(array_map(fn ($l) => [$l['escopo'], $l['antes'], $l['depois'], (int) $l['usuario_id']], $h),
          [['geral', null, '10', $admin['id']], ['empresa', null, '20', $admin['id']], ['empresa', '20', null, $admin['id']]]);
});
caso('gravar o mesmo valor nao entra no historico', function () use ($regra) {
    $antes = (int) consultarUm('SELECT COUNT(*) n FROM chaves_historico')['n'];
    $regra('venda.desconto_maximo_balcao', 'geral', '10');
    igual((int) consultarUm('SELECT COUNT(*) n FROM chaves_historico')['n'], $antes);
});
caso('recusas: chave desconhecida, numero fora da faixa, liga que nao e liga, escopo errado', function () use ($tentar, $regra) {
    igual([
        $tentar(fn () => $regra('venda.inventada', 'geral', '1'))[0],
        $tentar(fn () => $regra('venda.desconto_maximo_balcao', 'geral', '101'))[0],
        $tentar(fn () => $regra('venda.desconto_maximo_balcao', 'geral', '5.5'))[0],
        $tentar(fn () => $regra('venda.exigir_cliente', 'geral', 'talvez'))[0],
        $tentar(fn () => $regra('venda.exigir_cliente', 'loja', '1'))[0],
    ], [400, 400, 400, 400, 400]);
});
caso('/config leva as chaves no tipo certo (liga = bool, numero = int)', function () use ($admin) {
    $c = configuracao($admin)['chaves'];
    igual([$c['venda.desconto_maximo_balcao'], $c['venda.exigir_cliente'], $c['venda.alterar_preco_balcao']], [10, false, true]);
});

echo "\nvenda: as regras no servidor\n";
caso('desconto do balcao: acima do limite (geral 10%) = 403; no limite passa', function () use ($tentar, $vender, $balcao) {
    igual([$tentar(fn () => $vender($balcao, ['desconto' => 10.01]))[0], $tentar(fn () => $vender($balcao, ['desconto' => 10]))[0]], [403, 201]);
});
caso('o admin nao tem limite de desconto', fn () => igual($tentar(fn () => $GLOBALS['vender']($GLOBALS['admin'], ['desconto' => 60]))[0], 201));
caso('limite da empresa (25%) vence o geral (10%): 20% passa', function () use ($tentar, $vender, $balcao, $regra) {
    $regra('venda.desconto_maximo_balcao', 'empresa', '25');
    igual($tentar(fn () => $vender($balcao, ['desconto' => 20]))[0], 201);
    $regra('venda.desconto_maximo_balcao', 'empresa', null);
});
caso('editar a venda: balcao aumentando o desconto acima do limite = 403', function () use ($tentar, $vender, $balcao) {
    $id = $vender($balcao, ['pago' => false])[1]['id'];
    igual($tentar(fn () => atualizarVenda($id, ['desconto' => 30], $balcao))[0], 403);
    igual((float) consultarUm('SELECT desconto FROM vendas WHERE id = ?', [$id])['desconto'], 0.0, 'nada gravado');
});
caso('preco travado: balcao com preco diferente da tabela = 403; na tabela passa; admin muda', function () use ($tentar, $vender, $balcao, $admin, $regra, $entrada) {
    $regra('venda.alterar_preco_balcao', 'geral', '0');
    $outroPreco = ['itens' => [['entrada_id' => $entrada, 'quantidade' => 1, 'valor_unitario' => 90]]];
    igual([$tentar(fn () => $vender($balcao, $outroPreco))[0], $tentar(fn () => $vender($balcao))[0],
           $tentar(fn () => $vender($admin, $outroPreco))[0]], [403, 201, 201]);
});
caso('preco travado: item avulso (fora do estoque e dos servicos) so o admin', function () use ($tentar, $vender, $balcao, $admin) {
    $avulso = ['itens' => [['descricao' => 'Servico avulso', 'valor_unitario' => 30]]];
    igual([$tentar(fn () => $vender($balcao, $avulso))[0], $tentar(fn () => $vender($admin, $avulso))[0]], [403, 201]);
});
caso('preco travado: servico do cadastro pelo preco de tabela passa; com outro preco = 403', function () use ($tentar, $vender, $balcao, $regra) {
    $sv = crudCatalogo('servicos', null, 'POST', ['nome' => 'Pelicula aplicada', 'valor_padrao' => 20], [])[1]['id'];
    $comPreco = fn ($v) => ['itens' => [['servico_id' => $sv, 'descricao' => 'Pelicula aplicada', 'valor_unitario' => $v]]];
    igual([$tentar(fn () => $vender($balcao, $comPreco(20)))[0], $tentar(fn () => $vender($balcao, $comPreco(15)))[0]], [201, 403]);
    $regra('venda.alterar_preco_balcao', 'geral', null);
});
caso('a prazo desligado: balcao no fiado = 403; admin pode', function () use ($tentar, $vender, $balcao, $admin, $regra, $fiado) {
    $regra('venda.prazo_balcao', 'geral', '0');
    $noFiado = ['forma_pagamento_id' => $fiado, 'pago' => false];
    igual([$tentar(fn () => $vender($balcao, $noFiado))[0], $tentar(fn () => $vender($admin, $noFiado))[0]], [403, 201]);
    $regra('venda.prazo_balcao', 'geral', null);
});
caso('cliente obrigatorio: sem cliente = 400 para todos, inclusive o admin', function () use ($tentar, $vender, $balcao, $admin, $regra) {
    $regra('venda.exigir_cliente', 'empresa', '1');
    igual([$tentar(fn () => $vender($balcao, ['cliente_id' => null]))[0], $tentar(fn () => $vender($admin, ['cliente_id' => null]))[0],
           $tentar(fn () => $vender($balcao))[0]], [400, 400, 201]);
    $regra('venda.exigir_cliente', 'empresa', null);
});
caso('recusa nao grava nada (nem venda, nem conta, nem baixa de estoque)', function () use ($tentar, $vender, $balcao, $entrada, $regra) {
    $antes = [(int) consultarUm('SELECT COUNT(*) n FROM vendas')['n'], (int) consultarUm('SELECT COUNT(*) n FROM lancamentos')['n'],
              (int) consultarUm('SELECT saldo FROM vw_entradas WHERE id = ?', [$entrada])['saldo']];
    $tentar(fn () => $vender($balcao, ['desconto' => 50]));
    $depois = [(int) consultarUm('SELECT COUNT(*) n FROM vendas')['n'], (int) consultarUm('SELECT COUNT(*) n FROM lancamentos')['n'],
               (int) consultarUm('SELECT saldo FROM vw_entradas WHERE id = ?', [$entrada])['saldo']];
    igual($depois, $antes);
});

echo "\nempresa\n";
caso('CNPJ: digito verificador', fn () =>
    igual([cnpjValido('11222333000181'), cnpjValido('11222333000180'), cnpjValido('00000000000000'), cnpjValido('1122233300018')],
          [true, false, false, false]));
caso('CNPJ alfanumerico (IN RFB 2.229/2024): exemplo oficial 12.ABC.345/01DE-35 valido; DV com letra ou errado nao', fn () =>
    igual([cnpjValido('12ABC34501DE35'), cnpjValido('12ABC34501DE36'), cnpjValido('12ABC34501DE3A'), cnpjValido('12abc34501de35')],
          [true, false, false, false]));
caso('empresa: CNPJ alfanumerico digitado com pontuacao e minuscula grava em maiuscula, sem pontuacao', function () {
    empresa((int) empresaAtual()['id'], 'PUT', ['cnpj' => '12.abc.345/01de-35']);
    igual(empresaAtual()['cnpj'], '12ABC34501DE35');
    empresa((int) empresaAtual()['id'], 'PUT', ['cnpj' => '11.222.333/0001-81']);
});
caso('empresa: CNPJ errado = 400; certo grava so os digitos', function () use ($tentar) {
    $id = (int) empresaAtual()['id'];
    igual($tentar(fn () => empresa($id, 'PUT', ['cnpj' => '11.222.333/0001-80']))[0], 400);
    empresa($id, 'PUT', ['nome' => 'Index Teste', 'cnpj' => '11.222.333/0001-81']);
    igual([empresaAtual()['nome'], empresaAtual()['cnpj']], ['Index Teste', '11222333000181']);
});
caso('empresa sem nome = 400', fn () => igual($tentar(fn () => empresa((int) empresaAtual()['id'], 'PUT', ['nome' => '']))[0], 400));

fim();
