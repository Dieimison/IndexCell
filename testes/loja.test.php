<?php
/**
 * testes/loja.test.php - v8: loja online, num banco novo temporario, pelas
 * funcoes da API (o caminho HTTP, com a sessao do cliente, e do e2e loja.js):
 *
 *   - conferencia dos campos do cliente (CPF, telefone, CEP, senha);
 *   - anuncio: so de item com saldo, preco > 0, foto conferida pelo conteudo;
 *   - encomenda: frete, reserva (o ultimo celular nao sai duas vezes, nem pelo
 *     PDV), loja fechada, prazo de pagamento vencido;
 *   - pagamento: nasce a venda (estoque, celular vendido, conta a receber paga
 *     no Pix, cliente do cadastro), e a entrega anda um passo por vez;
 *   - cancelar a encomenda paga cancela a venda (estorno); a venda nao cai sozinha.
 * Os valores esperados sao escritos a mao.
 */

declare(strict_types=1);

require __DIR__ . '/caso.php';

$banco = bancoNovoTemporario(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'index-celulares-testes');
putenv('INDEX_CELULARES_DB=' . $banco);
require __DIR__ . '/../api/api.php';

$admin = ['id' => (int) consultarUm("SELECT id FROM usuarios WHERE usuario = 'admin'")['id'], 'perfil' => 'admin'];
$tentar = function (callable $f): array {
    try {
        $r = $f();
        return [$r[0], $r[1]['mensagem'] ?? ''];
    } catch (ErroApi $e) {
        return [$e->codigo, $e->getMessage()];
    }
};

// Massa: um celular (1 unidade) e uma capa (5 unidades).
$modelo = crudCatalogo('modelos', null, 'POST', ['marca' => 'Apple', 'modelo' => 'iPhone 13 Loja', 'armazenamento' => '128GB'], [])[1]['id'];
$celular = entradas(null, 'POST', ['tipo' => 'celular', 'modelo_id' => $modelo, 'imei' => '356938035643809', 'cor' => 'Azul',
    'condicao' => 'seminovo', 'situacao' => 'ready', 'valor_investimento' => 1500, 'valor_venda' => 2600], $admin, [])[1]['id'];
$produto = crudCatalogo('produtos', null, 'POST', ['nome' => 'Capa Loja Online', 'categoria' => 'Capa'], [])[1]['id'];
$capa = entradas(null, 'POST', ['tipo' => 'produto', 'produto_id' => $produto, 'quantidade' => 5,
    'valor_investimento' => 10, 'valor_venda' => 40], $admin, [])[1]['id'];
$saldo = fn (int $e) => (int) consultarUm('SELECT saldo FROM vw_entradas WHERE id = ?', [$e])['saldo'];

/** Conta de cliente gravada direto (a criacao pela rota abre sessao: e do e2e). */
function novaConta(string $email): array
{
    executarSql('INSERT INTO loja_contas (email, nome, telefone, senha_hash) VALUES (?, ?, ?, ?)',
                [$email, 'Cliente ' . $email, '11987654321', gerarHash('Cliente-Teste-2026')]);
    return consultarUm('SELECT * FROM loja_contas WHERE id = ?', [(int) banco()->lastInsertId()]);
}
$endereco = ['destinatario' => 'Maria Teste', 'cep' => '01310-100', 'logradouro' => 'Av. Paulista', 'numero' => '1000',
             'bairro' => 'Bela Vista', 'cidade' => 'São Paulo', 'uf' => 'SP'];
$ana = novaConta('ana@teste.com');
$beto = novaConta('beto@teste.com');

echo "\ncampos do cliente\n";
caso('CPF: digitos verificadores conferidos; repetido e curto nao', function () {
    igual([cpfValido('52998224725'), cpfValido('52998224724'), cpfValido('11111111111'), cpfValido('5299822472')],
          [true, false, false, false]);
});
caso('criar conta recusa e-mail torto, telefone sem DDD, CPF errado e senha fraca (com o e-mail na senha)', function () use ($tentar) {
    $base = ['nome' => 'Fulano', 'email' => 'fulano@teste.com', 'telefone' => '(11) 98765-4321', 'senha' => 'Boa-Senha-2026'];
    igual([
        $tentar(fn () => criarContaLoja(['email' => 'fulano@'] + $base))[1],
        $tentar(fn () => criarContaLoja(['telefone' => '98765-4321'] + $base))[1],
        $tentar(fn () => criarContaLoja(['cpf' => '529.982.247-24'] + $base))[1],
        $tentar(fn () => criarContaLoja(['senha' => 'fulano2026x'] + $base))[1],
        $tentar(fn () => criarContaLoja(['senha' => '12345678'] + $base))[1],
    ], [
        'Confira o e-mail: ele precisa ser do jeito nome@provedor.com.',
        'O telefone precisa ter o DDD e o número (10 ou 11 dígitos), como (11) 98765-4321.',
        'Este CPF não confere. Confira os números (ou deixe o campo vazio).',
        'A senha não pode conter o seu e-mail.',
        'A senha precisa ter letras e números.',
    ]);
});
caso('e-mail ja usado (sem diferenca de caixa) e recusado', function () use ($tentar) {
    igual($tentar(fn () => criarContaLoja(['nome' => 'Outra Ana', 'email' => 'ANA@teste.com', 'telefone' => '11987654321',
                                          'senha' => 'Boa-Senha-2026']))[1],
          'Já existe uma conta com este e-mail. Use "Entrar" (ou outro e-mail).');
});
caso('endereco: CEP com mascara vira 8 numeros; UF invalida e campo faltando recusados', function () use ($endereco, $tentar) {
    igual(enderecoDoCorpo($endereco)['cep'], '01310100');
    igual($tentar(function () use ($endereco) { enderecoDoCorpo(['uf' => 'XX'] + $endereco); return [200, []]; })[1],
          'Escolha o estado (UF) do endereço.');
    $semRua = $endereco;
    unset($semRua['logradouro']);
    igual($tentar(function () use ($semRua) { enderecoDoCorpo($semRua); return [200, []]; })[1], 'O campo "Rua" é obrigatório.');
});

echo "\nanuncios\n";
$png = 'data:image/png;base64,' . base64_encode(base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='));
$anuncioCel = null;
$anuncioCapa = null;
caso('anuncio do celular: titulo do estoque e preco da loja; foto PNG aceita pelo conteudo', function () use ($admin, $celular, $png, $tentar, &$anuncioCel) {
    $r = $tentar(fn () => anuncios(null, 'POST', ['entrada_id' => $celular, 'preco' => '2.499,90', 'fotos_novas' => [$png]], $admin));
    igual($r[0], 400, 'preco com milhar e virgula nao e numero valido');
    $r = anuncios(null, 'POST', ['entrada_id' => $celular, 'preco' => '2499,90', 'descricao' => 'Bateria 89%', 'fotos_novas' => [$png]], $admin);
    $anuncioCel = $r[1]['id'];
    $a = anuncios($anuncioCel, 'GET', [], $admin)[1]['anuncio'];
    igual([$r[0], $a['titulo'], $a['preco'], $a['disponivel'], count($a['fotos']), $a['publicado']],
          [201, 'Apple iPhone 13 Loja 128GB', 2499.9, 1, 1, 1]);
});
caso('foto: texto com cara de PNG, SVG e arquivo grande demais sao recusados', function () use ($admin, $capa, $tentar) {
    $falsa = 'data:image/png;base64,' . base64_encode('<script>alert(1)</script>');
    $svg = 'data:image/svg+xml;base64,' . base64_encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    $grande = 'data:image/jpeg;base64,' . base64_encode(str_repeat('a', LOJA_FOTO_BYTES_MAX + 1));
    igual([
        $tentar(fn () => anuncios(null, 'POST', ['entrada_id' => $capa, 'fotos_novas' => [$falsa]], $admin))[1],
        $tentar(fn () => anuncios(null, 'POST', ['entrada_id' => $capa, 'fotos_novas' => [$svg]], $admin))[1],
        $tentar(fn () => anuncios(null, 'POST', ['entrada_id' => $capa, 'fotos_novas' => [$grande]], $admin))[1],
    ], ['O arquivo não é uma foto JPG, PNG ou WEBP válida.', 'A foto precisa ser JPG, PNG ou WEBP.', 'A foto passou de 1 MB. Use uma foto menor.']);
    igual((int) consultarUm('SELECT COUNT(*) AS q FROM anuncios')['q'], 1, 'nada gravado pelas recusas');
});
caso('anuncio da capa com o preco do balcao (40) e no maximo 4 fotos', function () use ($admin, $capa, $png, $tentar, &$anuncioCapa) {
    $r = $tentar(fn () => anuncios(null, 'POST', ['entrada_id' => $capa, 'fotos_novas' => array_fill(0, 5, $png)], $admin));
    igual($r, [400, 'Cada anúncio leva no máximo 4 fotos (este ficaria com 5).']);
    $anuncioCapa = anuncios(null, 'POST', ['entrada_id' => $capa, 'titulo' => 'Capa de silicone'], $admin)[1]['id'];
    igual(anuncios($anuncioCapa, 'GET', [], $admin)[1]['anuncio']['preco'], 40.0);
});
caso('vitrine nao mostra custo, IMEI nem o id do estoque', function () {
    $v = vitrine();
    $a = $v['anuncios'][0];
    igual([isset($a['custo_unitario']), isset($a['imei']), isset($a['entrada_id']), count($v['anuncios']), $v['loja']['aberta']],
          [false, false, false, 2, false]);
});

echo "\nencomendas\n";
$pedirCel = fn (array $conta) => criarEncomenda($conta, ['itens' => [['anuncio_id' => $anuncioCel, 'quantidade' => 1]], 'endereco' => $endereco]);
caso('loja fechada nao aceita encomenda; abrir sem chave PIX e recusado', function () use ($admin, $ana, $pedirCel, $tentar) {
    igual($tentar(fn () => $pedirCel($ana))[1], 'A loja online não está aceitando encomendas agora. Tente mais tarde.');
    igual($tentar(fn () => ajustesDaLoja(null, 'PUT', ['aberta' => 1], $admin))[1],
          'Para abrir a loja online, informe a chave PIX: é por ela que o cliente paga.');
    $r = ajustesDaLoja(null, 'PUT', ['aberta' => 1, 'chave_pix' => 'pix@loja.com', 'frete_fixo' => '25', 'frete_gratis_acima' => '1000',
                                     'prazo_pagamento_horas' => 24, 'prazo_entrega_dias' => 4, 'cidade_origem' => 'Curitiba/PR'], $admin);
    igual($r[1]['ajustes']['aberta'], true);
});
$encAna = null;
caso('encomenda do celular: frete gratis acima de R$ 1.000, numero LJ e o celular fica reservado', function () use ($ana, $pedirCel, $celular, &$encAna) {
    $r = $pedirCel($ana);
    $encAna = $r[1]['id'];
    $e = consultarUm('SELECT * FROM encomendas WHERE id = ?', [$encAna]);
    igual([$r[0], $e['numero'], (float) $e['valor_produtos'], (float) $e['frete'], (float) $e['valor_total'], $e['status'], reservadoNaLoja($celular)],
          [201, 'LJ-' . date('Y') . '-0001', 2499.9, 0.0, 2499.9, 'aguardando_pagamento', 1]);
    igual((int) consultarUm('SELECT COUNT(*) AS q FROM loja_enderecos WHERE conta_id = ?', [$ana['id']])['q'], 1, 'endereco guardado na conta');
});
caso('o mesmo celular nao sai para outra encomenda, nem pelo PDV, enquanto aguarda pagamento', function () use ($beto, $pedirCel, $celular, $tentar) {
    igual($tentar(fn () => $pedirCel($beto))[1], '"Apple iPhone 13 Loja 128GB" acabou de esgotar. Tire-o do carrinho para continuar.');
    igual((int) consultarUm("SELECT COUNT(*) AS q FROM encomendas WHERE conta_id = ?", [$beto['id']])['q'], 0, 'a recusada nao ficou gravada');
    igual($tentar(function () use ($celular) { prepararItensDeSaida([['entrada_id' => $celular, 'quantidade' => 1]]); return [200, []]; })[1],
          'Saldo insuficiente de "Apple iPhone 13 Loja 128GB": pedido 1, disponível 0. 1 unidade(s) estão reservadas por encomenda '
          . 'da loja online aguardando pagamento.');
});
caso('capa: frete fixo de R$ 25 abaixo de R$ 1.000; quantidade alem do que sobra e recusada', function () use ($beto, $anuncioCapa, $endereco, $tentar) {
    $r = criarEncomenda($beto, ['itens' => [['anuncio_id' => $anuncioCapa, 'quantidade' => 2], ['anuncio_id' => $anuncioCapa, 'quantidade' => 1]],
                                'endereco' => $endereco]);
    $e = consultarUm('SELECT * FROM encomendas WHERE id = ?', [$r[1]['id']]);
    igual([(float) $e['valor_produtos'], (float) $e['frete'], (float) $e['valor_total']], [120.0, 25.0, 145.0]);
    igual((int) consultarUm('SELECT quantidade FROM encomenda_itens WHERE encomenda_id = ?', [$e['id']])['quantidade'], 3, 'linhas juntadas');
    igual($tentar(fn () => criarEncomenda($beto, ['itens' => [['anuncio_id' => $anuncioCapa, 'quantidade' => 3]], 'endereco' => $endereco]))[1],
          'De "Capa de silicone" só restam 2 unidade(s). Ajuste a quantidade no carrinho.');
});
caso('prazo vencido: a encomenda cai sozinha e a reserva volta', function () use ($beto, $capa) {
    executarSql("UPDATE encomendas SET pagar_ate = '2000-01-01 00:00:00' WHERE conta_id = ?", [$beto['id']]);
    expirarEncomendas();
    $e = consultarUm('SELECT status, motivo_cancelamento FROM encomendas WHERE conta_id = ?', [$beto['id']]);
    igual([$e['status'], $e['motivo_cancelamento'], reservadoNaLoja($capa)], ['cancelada', MOTIVO_PRAZO_VENCIDO, 0]);
});
caso('cliente nao ve encomenda de outra conta (404)', function () use ($beto, $encAna, $tentar) {
    igual($tentar(fn () => encomendasDoCliente($beto, $encAna, null, 'GET', []))[0], 404);
});

echo "\npagamento e entrega\n";
caso('antes do pagamento a entrega nao anda', function () use ($admin, $encAna, $tentar) {
    igual($tentar(fn () => avancarEncomenda($encAna, [], $admin))[1], 'Confirme o pagamento primeiro: a entrega só anda depois dele.');
});
caso('pagamento: venda no Pix, recebida, celular vendido, cliente criado e previsao de 4 dias', function () use ($admin, $encAna, $celular, $saldo, $ana) {
    $r = confirmarPagamento($encAna, [], $admin);
    $e = consultarUm('SELECT * FROM encomendas WHERE id = ?', [$encAna]);
    $v = consultarUm('SELECT * FROM vendas WHERE id = ?', [$e['venda_id']]);
    $l = consultar('SELECT status, valor, forma_pagamento FROM lancamentos WHERE venda_id = ?', [$e['venda_id']]);
    $conta = consultarUm('SELECT cliente_id FROM loja_contas WHERE id = ?', [$ana['id']]);
    igual([$e['status'], (float) $v['valor_total'], (float) $v['custo_total'], $v['forma_pagamento'], (int) $v['cliente_id'],
           $l, $saldo($celular), consultarUm('SELECT situacao FROM entradas WHERE id = ?', [$celular])['situacao'], reservadoNaLoja($celular),
           $e['previsao_entrega']],
          ['pago', 2499.9, 1500.0, 'Pix', (int) $conta['cliente_id'], [['status' => 'pago', 'valor' => 2499.9, 'forma_pagamento' => 'Pix']],
           0, 'vendido', 0, date('Y-m-d', strtotime('+4 days'))]);
    igual(consultarUm('SELECT nome, email FROM clientes WHERE id = ?', [$conta['cliente_id']]),
          ['nome' => 'Cliente ana@teste.com', 'email' => 'ana@teste.com']);
});
caso('pagamento confirmado duas vezes (clique duplo) nao gera outra venda', function () use ($admin, $encAna, $tentar) {
    igual($tentar(fn () => confirmarPagamento($encAna, [], $admin))[0], 409);
    igual((int) consultarUm("SELECT COUNT(*) AS q FROM vendas WHERE observacoes LIKE '%LJ-%'")['q'], 1);
});
caso('entrega anda um passo por vez; "para" diferente do proximo (clique duplo) e 409', function () use ($admin, $encAna, $tentar) {
    igual(avancarEncomenda($encAna, ['para' => 'separacao'], $admin)[1]['status'], 'separacao');
    igual($tentar(fn () => avancarEncomenda($encAna, ['para' => 'separacao'], $admin))[0], 409);
    avancarEncomenda($encAna, ['para' => 'enviado', 'transportadora' => 'Correios', 'codigo_rastreio' => 'AB123456789BR', 'local' => 'Curitiba/PR'], $admin);
    avancarEncomenda($encAna, ['local' => 'CD São Paulo'], $admin);
    $d = encomendasDoCliente(consultarUm('SELECT * FROM loja_contas WHERE email = ?', ['ana@teste.com']), $encAna, null, 'GET', [])[1]['encomenda'];
    igual([$d['status'], $d['codigo_rastreio'], $d['proximo'], $d['rastreio'], $d['pode_cancelar'],
           array_map(fn ($t) => $t['feito'], $d['trilha']), $d['eventos'][0]['local'], isset($d['eventos'][0]['usuario'])],
          ['em_transito', 'AB123456789BR', 'saiu_entrega', true, false, [true, true, true, true, true, false, false], 'CD São Paulo', false]);
});
caso('a venda da loja nao cancela pela tela de Vendas, nem e excluida', function () use ($admin, $encAna, $tentar) {
    $venda = (int) consultarUm('SELECT venda_id FROM encomendas WHERE id = ?', [$encAna])['venda_id'];
    igual($tentar(fn () => vendas($venda, 'PUT', ['status' => 'cancelada'], $admin))[1],
          'Esta venda veio da encomenda LJ-' . date('Y') . '-0001 da loja online. Para cancelar ou mudar o valor, use Loja online > Encomendas.');
    igual($tentar(fn () => vendas($venda, 'DELETE', [], $admin))[0], 400);
});
caso('cancelar encomenda paga: venda cancelada, recebido estornado, celular de volta a prateleira', function () use ($admin, $encAna, $celular, $saldo, $tentar) {
    igual($tentar(fn () => cancelarEncomenda($encAna, [], $admin))[1], 'O campo "Motivo" é obrigatório.');
    cancelarEncomenda($encAna, ['motivo' => 'Cliente desistiu na entrega.'], $admin);
    $e = consultarUm('SELECT e.status, v.status AS venda FROM encomendas e JOIN vendas v ON v.id = e.venda_id WHERE e.id = ?', [$encAna]);
    $l = consultar('SELECT status FROM lancamentos WHERE venda_id = (SELECT venda_id FROM encomendas WHERE id = ?)', [$encAna]);
    igual([$e['status'], $e['venda'], array_column($l, 'status'), $saldo($celular),
           consultarUm('SELECT situacao FROM entradas WHERE id = ?', [$celular])['situacao']],
          ['cancelada', 'cancelada', ['cancelado'], 1, 'ready']);
});
caso('anuncio com encomenda nao e excluido (so sai da vitrine)', function () use ($admin, $anuncioCel, $tentar) {
    igual($tentar(fn () => anuncios($anuncioCel, 'DELETE', [], $admin))[0], 400);
    anuncios($anuncioCel, 'PUT', ['publicado' => 0], $admin);
    igual(array_column(vitrine()['anuncios'], 'id'), [$GLOBALS['anuncioCapa']]);
});

caso('celular vendido no balcao sai da vitrine sozinho', function () use ($admin, $anuncioCel, $celular) {
    anuncios($anuncioCel, 'PUT', ['publicado' => 1], $admin);
    igual(count(vitrine()['anuncios']), 2, 'publicado de novo, com o celular de volta a prateleira');
    criarVenda(['itens' => [['entrada_id' => $celular, 'quantidade' => 1]]], $admin);
    igual(array_column(vitrine()['anuncios'], 'id'), [$GLOBALS['anuncioCapa']]);
});

echo "\ntela de entrada do PDV e banco de teste\n";
caso('painel do PDV: vendas de hoje (cancelada nao conta); fila da loja so para o admin', function () use ($admin, $capa) {
    $d = painelDoPdv($admin);
    $vendaHoje = criarVenda(['itens' => [['entrada_id' => $capa, 'quantidade' => 1, 'valor_unitario' => 50]]], $admin)[1]['id'];
    $cancelada = criarVenda(['itens' => [['entrada_id' => $capa, 'quantidade' => 1, 'valor_unitario' => 70]]], $admin)[1]['id'];
    vendas($cancelada, 'PUT', ['status' => 'cancelada'], $admin);
    $depois = painelDoPdv($admin);
    igual([$depois['vendas_hoje']['quantidade'] - $d['vendas_hoje']['quantidade'],
           round($depois['vendas_hoje']['total'] - $d['vendas_hoje']['total'], 2), isset($depois['loja']),
           isset(painelDoPdv(['id' => $admin['id'], 'perfil' => 'balcao'])['loja'])],
          [1, 50.0, true, false]);
    verdade($vendaHoje > 0, 'venda criada');
});
caso('"banco de teste" nasce desligado e liga pela regra (Admin > Regras)', function () use ($admin) {
    igual(chaveLigada('sistema.banco_de_teste'), false);
    chaves(null, 'POST', ['chave' => 'sistema.banco_de_teste', 'escopo' => 'geral', 'valor' => '1'], $admin);
    igual(chaveLigada('sistema.banco_de_teste'), true);
    chaves(null, 'POST', ['chave' => 'sistema.banco_de_teste', 'escopo' => 'geral', 'valor' => null], $admin);
    igual(chaveLigada('sistema.banco_de_teste'), false);
});
caso('dados\\homologacao.php: p / p admin, banco de teste (mesmo com a empresa desligando so para ela) e fiscal em homologacao; '
     . 'de novo nao muda nada; o banco da pasta so com --banco-da-pasta', function () {
    $raiz = dirname(__DIR__);
    $pasta = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'index-celulares-homologacao-' . getmypid();
    $antes = getenv('INDEX_CELULARES_BACKUPS');
    putenv('INDEX_CELULARES_BACKUPS=' . $pasta . DIRECTORY_SEPARATOR . 'backups');
    $roda = function (string ...$args) use ($raiz): array {
        exec('"' . PHP_BINARY . '" "' . $raiz . '/dados/homologacao.php" ' . implode(' ', array_map('escapeshellarg', $args)) . ' 2>&1', $saida, $rc);
        return [$rc, implode("\n", $saida)];
    };
    try {
        // A trava vem antes de abrir qualquer coisa: o banco da pasta nem e tocado.
        [$rc, $txt] = $roda($raiz . DIRECTORY_SEPARATOR . 'dados' . DIRECTORY_SEPARATOR . 'index.sqlite');
        verdade($rc === 1 && str_contains($txt, 'banco desta pasta'), 'banco da pasta sem confirmar: recusado: ' . $txt);

        $outro = bancoNovoTemporario($pasta);
        $pdo = abrirSqlite($outro);
        $pdo->exec("INSERT INTO empresa_fiscal (empresa_id, ambiente) VALUES (1, 'producao')");
        $pdo->exec("INSERT INTO chaves_empresa (empresa_id, chave, valor) VALUES (1, 'sistema.banco_de_teste', '0')");
        $pdo = null;
        [$rc, $txt] = $roda($outro);
        igual($rc, 0, 'homologacao rodou: ' . $txt);
        $pdo = abrirSqlite($outro);
        $p = $pdo->query("SELECT * FROM usuarios WHERE usuario = 'p'")->fetch();
        igual([$p['perfil'], (int) $p['ativo'], (int) $p['trocar_senha'], conferirSenha('p', $p['senha_hash'])],
              ['admin', 1, 0, true], 'usuario p');
        igual([$pdo->query("SELECT valor FROM chaves_geral WHERE chave = 'sistema.banco_de_teste'")->fetchColumn(),
               (int) $pdo->query("SELECT COUNT(*) FROM chaves_empresa WHERE chave = 'sistema.banco_de_teste'")->fetchColumn(),
               $pdo->query('SELECT ambiente FROM empresa_fiscal WHERE empresa_id = 1')->fetchColumn()],
              ['1', 0, 'homologacao'], 'regra geral ligada, excecao da empresa fora, fiscal em homologacao');
        igual([(int) $pdo->query("SELECT COUNT(*) FROM chaves_historico WHERE chave = 'sistema.banco_de_teste' AND usuario_id = {$p['id']}")->fetchColumn(),
               (int) $pdo->query("SELECT COUNT(*) FROM empresa_fiscal_historico WHERE campo = 'ambiente' AND depois = 'homologacao' AND usuario_id = {$p['id']}")->fetchColumn()],
              [2, 1], 'historico em nome do p (regra geral + excecao; ambiente fiscal)');
        $pdo = null;
        [$rc, $txt] = $roda($outro);
        verdade($rc === 0 && str_contains($txt, 'nada a mudar'), 'de novo: nada a mudar: ' . $txt);
    } finally {
        putenv($antes === false ? 'INDEX_CELULARES_BACKUPS' : 'INDEX_CELULARES_BACKUPS=' . $antes);
        foreach (array_merge(glob($pasta . '/backups/*') ?: [], glob($pasta . '/*.sqlite*') ?: []) as $f) {
            @unlink($f);
        }
        @rmdir($pasta . '/backups');
        @rmdir($pasta);
    }
});

fim();
