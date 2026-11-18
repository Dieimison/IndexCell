<?php
/**
 * testes/pedidos.test.php - v7: cadastros fiscais (empresa, CFOP,
 * naturezas) e pedido de entrada (XML da NF-e, rascunho, confirmar,
 * cancelar), com o banco de verdade (temporario).
 *
 * A NF-e de teste e montada aqui (montarNfe) com a chave de acesso
 * calculada pelo modulo 11: assim da para provar que um digito trocado e
 * recusado. Os valores esperados sao escritos a mao.
 */

declare(strict_types=1);

require __DIR__ . '/caso.php';

$banco = bancoNovoTemporario(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'index-celulares-testes');
putenv('INDEX_CELULARES_DB=' . $banco);
require __DIR__ . '/../api/api.php';

$admin = ['id' => (int) consultarUm("SELECT id FROM usuarios WHERE usuario = 'admin'")['id'], 'perfil' => 'admin'];
executarSql("INSERT INTO usuarios (usuario, nome, senha_hash, perfil, ativo, trocar_senha) VALUES ('balcao1', 'Balcao', ?, 'balcao', 1, 0)",
            [gerarHash('Balcao-Teste-2026x')]);
$balcao = ['id' => (int) banco()->lastInsertId(), 'perfil' => 'balcao'];
$tentar = function (callable $f): array {
    try {
        $r = $f();
        return [$r[0], $r[1]['mensagem'] ?? ''];
    } catch (ErroApi $e) {
        return [$e->codigo, $e->getMessage()];
    }
};

/** DV da chave (modulo 11, pesos 2..9 da direita; ASCII - 48). */
function dvChave(string $chave43): string
{
    $soma = 0;
    $peso = 2;
    for ($i = 42; $i >= 0; $i--) {
        $soma += (ord($chave43[$i]) - 48) * $peso;
        $peso = $peso === 9 ? 2 : $peso + 1;
    }
    $resto = $soma % 11;
    return (string) ($resto < 2 ? 0 : 11 - $resto);
}

/** Uma NF-e de teste: 1 produto (2 un), 1 peca (3 un) e 2 celulares numa linha, com IMEIs. */
function montarNfe(array $o = []): string
{
    $o += ['cnpj' => '11222333000181', 'numero' => 1234, 'mod' => '55', 'tpNF' => '1', 'dest' => '11444777000161',
           'uf' => 'SP', 'qtdProduto' => '2.0000', 'chave' => null];
    $c43 = '35' . '2611' . $o['cnpj'] . $o['mod'] . '001' . str_pad((string) $o['numero'], 9, '0', STR_PAD_LEFT) . '1' . '12345678';
    $chave = $o['chave'] ?? ($c43 . dvChave($c43));
    return '<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe' . $chave . '" versao="4.00">
<ide><cUF>35</cUF><mod>' . $o['mod'] . '</mod><serie>1</serie><nNF>' . $o['numero'] . '</nNF><dhEmi>2026-11-01T10:30:00-03:00</dhEmi><tpNF>' . $o['tpNF'] . '</tpNF></ide>
<emit><CNPJ>' . $o['cnpj'] . '</CNPJ><xNome>DISTRIBUIDORA TESTE LTDA</xNome><enderEmit><UF>' . $o['uf'] . '</UF><fone>1133334444</fone></enderEmit><IE>123456789</IE></emit>
<dest><CNPJ>' . $o['dest'] . '</CNPJ><xNome>LOJA</xNome></dest>
<det nItem="1"><prod><cProd>CAPA-01</cProd><cEAN>7891234567895</cEAN><xProd>CAPA SILICONE A15</xProd><NCM>39269090</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>' . $o['qtdProduto'] . '</qCom><vUnCom>15.00</vUnCom><vProd>30.00</vProd><vDesc>2.00</vDesc></prod></det>
<det nItem="2"><prod><cProd>TELA-A15</cProd><cEAN>SEM GTIN</cEAN><xProd>TELA FRONTAL A15</xProd><NCM>85177099</NCM><CFOP>5102</CFOP><uCom>PC</uCom><qCom>3.0000</qCom><vUnCom>40.00</vUnCom><vProd>120.00</vProd></prod></det>
<det nItem="3"><prod><cProd>CEL-A15</cProd><cEAN>SEM GTIN</cEAN><xProd>SMARTPHONE GALAXY A15 128GB</xProd><NCM>85171300</NCM><CEST>2106400</CEST><CFOP>5405</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>800.00</vUnCom><vProd>1600.00</vProd></prod>
<infAdProd>IMEI 356938035643809 IMEI 490154203237518</infAdProd></det>
<total><ICMSTot><vProd>1750.00</vProd><vDesc>2.00</vDesc><vFrete>20.00</vFrete><vST>30.00</vST><vNF>1798.00</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2026-12-01</dVenc><vDup>899.00</vDup></dup><dup><nDup>002</nDup><dVenc>2027-01-01</dVenc><vDup>899.00</vDup></dup></cobr>
</infNFe></NFe></nfeProc>';
}

echo "\nchave de acesso\n";
caso('chave da NF-e de teste confere; um digito trocado nao', function () {
    $c43 = '352611112223330001815500100000123411234567';
    $c43 = substr('35261111222333000181550010000012341' . '12345678', 0, 43);
    $chave = $c43 . dvChave($c43);
    $trocada = substr($chave, 0, 30) . (string) (((int) $chave[30] + 1) % 10) . substr($chave, 31);
    igual([chaveNfeValida($chave), chaveNfeValida($trocada), chaveNfeValida(substr($chave, 0, 43))], [true, false, false]);
});
caso('chave com CNPJ alfanumerico (ASCII - 48) confere', function () {
    $c43 = '352611' . '12ABC34501DE35' . '55001000001234112345678';
    igual(chaveNfeValida($c43 . dvChave($c43)), true);
});

echo "\nleitura do XML\n";
caso('le itens, totais, duplicatas e IMEIs (outros = ST que soma no total)', function () {
    $n = lerNfeXml(montarNfe());
    igual([$n['numero'], count($n['itens']), $n['itens'][2]['imeis'], $n['valor_total'], $n['valor_outros'], count($n['parcelas']),
           $n['itens'][1]['gtin'], $n['emitente']['uf']],
          ['1234', 3, ['356938035643809', '490154203237518'], 1798.0, 30.0, 2, null, 'SP']);
});
caso('recusa: modelo 65, nota de entrada do emitente, chave adulterada, DOCTYPE, nao-XML, quantidade quebrada', function () use ($tentar) {
    $chaveRuim = str_repeat('1', 44);
    igual([
        $tentar(fn () => lerNfeXml(montarNfe(['mod' => '65'])))[0],
        $tentar(fn () => lerNfeXml(montarNfe(['tpNF' => '0'])))[0],
        $tentar(fn () => lerNfeXml(montarNfe(['chave' => $chaveRuim])))[0],
        $tentar(fn () => lerNfeXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'))[0],
        $tentar(fn () => lerNfeXml('isto nao e xml'))[0],
        $tentar(fn () => lerNfeXml(montarNfe(['qtdProduto' => '1.5000'])))[0],
    ], [400, 400, 400, 400, 400, 400]);
});

caso('chave certa em tudo MENOS no digito verificador: recusada (so a conferencia do DV pega)', function () use ($tentar) {
    // Mesmo CNPJ, modelo e numero da nota: as outras travas passam; so o DV esta errado.
    $c43 = '352611' . '11222333000181' . '55' . '001' . '000001234' . '1' . '12345678';
    $dvErrado = (string) (((int) dvChave($c43) + 1) % 10);
    igual($tentar(fn () => lerNfeXml(montarNfe(['chave' => $c43 . $dvErrado])))[0], 400);
});

echo "\nimportar\n";
$pedidoId = null;
caso('importa: rascunho com fornecedor novo, 2 celulares viram 2 linhas com IMEI, parcelas da nota', function () use ($admin, &$pedidoId) {
    [$codigo, $r] = pedidos(null, 'POST', ['xml' => montarNfe()], $admin, null);
    $pedidoId = $r['id'];
    $p = consultarUm('SELECT * FROM pedidos WHERE id = ?', [$pedidoId]);
    $celulares = consultar("SELECT imei, valor_total FROM pedido_itens WHERE pedido_id = ? AND descricao LIKE 'SMARTPHONE%' ORDER BY ordem", [$pedidoId]);
    igual([$codigo, $p['status'], (float) $p['valor_total'], $p['cfop'], count(consultar('SELECT id FROM pedido_parcelas WHERE pedido_id = ?', [$pedidoId])),
           (int) consultarUm("SELECT COUNT(*) n FROM fornecedores WHERE documento = '11222333000181'")['n']],
          [201, 'rascunho', 1798.0, '1102', 2, 1]);
    // as linhas so viram celular depois que alguem diz o que sao: ate la, 1 linha com os 2 IMEIs
    igual(count($celulares), 1);
});
caso('a mesma nota de novo: recusada', function () use ($tentar, $admin) {
    igual($tentar(fn () => pedidos(null, 'POST', ['xml' => montarNfe()], $admin, null))[0], 400);
});
caso('nota para outro CNPJ (empresa com CNPJ): recusada', function () use ($tentar, $admin) {
    empresa((int) empresaAtual()['id'], 'PUT', ['cnpj' => '11.222.333/0001-81']);
    igual($tentar(fn () => pedidos(null, 'POST', ['xml' => montarNfe(['numero' => 99])], $admin, null))[0], 400);
    empresa((int) empresaAtual()['id'], 'PUT', ['cnpj' => '']);
});

echo "\nconfirmar\n";
/** Liga as linhas importadas ao catalogo: capa e tela novas, celular novo (2 aparelhos). */
$classificar = function (int $id) use ($admin) {
    $p = pedidos($id, 'GET', [], $admin, null)[1]['pedido'];
    $itens = array_map(function ($i) {
        $tipo = str_starts_with($i['descricao'], 'SMART') ? 'celular' : (str_starts_with($i['descricao'], 'TELA') ? 'peca' : 'produto');
        return array_merge($i, ['tipo_item' => $tipo, 'valor_venda' => $tipo === 'celular' ? 1299 : 50]);
    }, $p['lista_itens']);
    return pedidos($id, 'PUT', ['natureza_id' => $p['natureza_id'], 'fornecedor_id' => $p['fornecedor_id'], 'nota_numero' => $p['nota_numero'],
        'nota_serie' => $p['nota_serie'], 'nota_chave' => $p['nota_chave'], 'valor_frete' => $p['valor_frete'], 'valor_outros' => $p['valor_outros'],
        'itens' => $itens, 'parcelas' => $p['parcelas']], $admin, null);
};
caso('linha sem tipo nao confirma (400)', function () use ($tentar, $admin, &$pedidoId) {
    igual($tentar(fn () => pedidos($pedidoId, 'POST', [], $admin, 'confirmar'))[0], 400);
});
caso('celular com 2 unidades vira 2 linhas, cada uma com o seu IMEI', function () use ($classificar, &$pedidoId) {
    $classificar($pedidoId);
    igual(array_column(consultar("SELECT imei FROM pedido_itens WHERE pedido_id = ? AND tipo_item = 'celular' ORDER BY ordem", [$pedidoId]), 'imei'),
          ['356938035643809', '490154203237518']);
});
caso('balcao nao confirma (403) sem a regra ligada', function () use ($tentar, $balcao, &$pedidoId) {
    igual($tentar(fn () => pedidos($pedidoId, 'POST', [], $balcao, 'confirmar'))[0], 403);
});
caso('admin confirma: 4 entradas, custo com desconto e rateio do frete+ST, 2 contas a pagar das duplicatas', function () use ($admin, &$pedidoId) {
    [$codigo] = pedidos($pedidoId, 'POST', [], $admin, 'confirmar');
    $e = consultar("SELECT e.tipo, e.quantidade, e.valor_investimento, e.imei FROM entradas e JOIN pedido_itens i ON i.entrada_id = e.id
                     WHERE i.pedido_id = ? ORDER BY i.ordem", [$pedidoId]);
    // liquidos: capa 28, tela 120, cel 800, cel 800 = 1748; extras 50 (frete 20 + ST 30)
    // capa: 28 + 50*28/1748 = 28 + 0,80 = 28,80 / 2 = 14,40 ; tela: 120 + 3,43 = 123,43 / 3 = 41,14
    // cel1: 800 + 22,88 = 822,88 ; cel2 (fica com a sobra): 800 + 22,89 = 822,89
    igual([$codigo, array_map(fn ($x) => [$x['tipo'], (int) $x['quantidade'], (float) $x['valor_investimento']], $e)],
          [200, [['produto', 2, 14.4], ['peca', 3, 41.14], ['celular', 1, 822.88], ['celular', 1, 822.89]]]);
    $l = consultar('SELECT valor, vencimento, status FROM lancamentos WHERE pedido_id = ? ORDER BY parcela', [$pedidoId]);
    igual(array_map(fn ($x) => [(float) $x['valor'], $x['vencimento'], $x['status']], $l),
          [[899.0, '2026-12-01', 'pendente'], [899.0, '2027-01-01', 'pendente']]);
});
caso('o catalogo aprendeu NCM e o vinculo do fornecedor ficou guardado', function () use (&$pedidoId) {
    $capa = consultarUm("SELECT ncm, gtin FROM produtos WHERE nome = 'CAPA SILICONE A15'");
    igual([$capa['ncm'], $capa['gtin'], (int) consultarUm('SELECT COUNT(*) n FROM vinculos_fornecedor')['n']], ['39269090', '7891234567895', 3]);
});
caso('a proxima nota do mesmo fornecedor ja vem ligada ao catalogo', function () use ($admin) {
    [, $r] = pedidos(null, 'POST', ['xml' => montarNfe(['numero' => 1235])], $admin, null);
    $tipos = array_column(consultar('SELECT tipo_item FROM pedido_itens WHERE pedido_id = ? ORDER BY ordem', [$r['id']]), 'tipo_item');
    igual($tipos, ['produto', 'peca', 'celular', 'celular']);
    pedidos($r['id'], 'DELETE', [], $admin, null);
});
caso('entrada que veio do pedido: nao se exclui nem muda custo pela tela de Entradas', function () use ($tentar, $admin, &$pedidoId) {
    $eid = (int) consultarUm("SELECT entrada_id FROM pedido_itens WHERE pedido_id = ? AND tipo_item = 'peca'", [$pedidoId])['entrada_id'];
    igual([$tentar(fn () => entradas($eid, 'DELETE', [], $admin, []))[0],
           $tentar(fn () => entradas($eid, 'PUT', ['valor_investimento' => 10], $admin, []))[0],
           $tentar(fn () => entradas($eid, 'PUT', ['valor_venda' => 60], $admin, []))[0]], [400, 400, 200]);
});
caso('pedido confirmado nao edita (400)', fn () => igual($tentar(fn () => pedidos($pedidoId, 'PUT', ['natureza_id' => 1], $admin, null))[0], 400));

echo "\ncancelar\n";
caso('cancelar sem motivo: 400; balcao: 403', function () use ($tentar, $admin, $balcao, &$pedidoId) {
    igual([$tentar(fn () => pedidos($pedidoId, 'POST', [], $admin, 'cancelar'))[0],
           $tentar(fn () => pedidos($pedidoId, 'POST', ['motivo' => 'nota errada'], $balcao, 'cancelar'))[0]], [400, 403]);
});
caso('com estoque ja vendido: nao cancela', function () use ($tentar, $admin, &$pedidoId) {
    $eid = (int) consultarUm("SELECT entrada_id FROM pedido_itens WHERE pedido_id = ? AND tipo_item = 'produto'", [$pedidoId])['entrada_id'];
    $venda = criarVenda(['itens' => [['entrada_id' => $eid, 'quantidade' => 1]], 'pago' => true], $admin)[1]['id'];
    igual($tentar(fn () => pedidos($pedidoId, 'POST', ['motivo' => 'nota errada'], $admin, 'cancelar'))[0], 400);
    executarSql('DELETE FROM lancamentos WHERE venda_id = ?', [$venda]);
    executarSql('DELETE FROM vendas WHERE id = ?', [$venda]);
});
caso('com conta paga: nao cancela', function () use ($tentar, $admin, &$pedidoId) {
    $l = (int) consultarUm('SELECT id FROM lancamentos WHERE pedido_id = ? ORDER BY id LIMIT 1', [$pedidoId])['id'];
    executarSql("UPDATE lancamentos SET status = 'pago', data_pagamento = ? WHERE id = ?", [agora(), $l]);
    igual($tentar(fn () => pedidos($pedidoId, 'POST', ['motivo' => 'nota errada'], $admin, 'cancelar'))[0], 400);
    executarSql("UPDATE lancamentos SET status = 'pendente', data_pagamento = NULL WHERE id = ?", [$l]);
});
caso('cancelar desfaz: entradas saem, contas canceladas, a nota pode entrar de novo', function () use ($admin, &$pedidoId) {
    [$codigo] = pedidos($pedidoId, 'POST', ['motivo' => 'nota lançada errada'], $admin, 'cancelar');
    igual([$codigo, (int) consultarUm('SELECT COUNT(*) n FROM pedido_itens WHERE pedido_id = ? AND entrada_id IS NOT NULL', [$pedidoId])['n'],
           array_unique(array_column(consultar('SELECT status FROM lancamentos WHERE pedido_id = ?', [$pedidoId]), 'status'))],
          [200, 0, ['cancelado']]);
    [$c2, $r2] = pedidos(null, 'POST', ['xml' => montarNfe()], $admin, null);
    igual($c2, 201, 'a mesma nota entra de novo depois de cancelada');
    pedidos($r2['id'], 'DELETE', [], $admin, null);
});

echo "\nnaturezas e CFOP\n";
$natureza = fn (string $codigo) => (int) consultarUm('SELECT id FROM naturezas_operacao WHERE codigo = ?', [$codigo])['id'];
$fornecedor = crudCatalogo('fornecedores', null, 'POST', ['nome' => 'Fornecedor RJ', 'uf' => 'RJ'], [])[1]['id'];
$produto = crudCatalogo('produtos', null, 'POST', ['nome' => 'Fone teste'], [])[1]['id'];
$manual = fn (string $nat, array $extra = []) => pedidos(null, 'POST', $extra + ['natureza_id' => $natureza($nat), 'fornecedor_id' => $fornecedor,
    'itens' => [['tipo_item' => 'produto', 'produto_id' => $produto, 'descricao' => 'Fone', 'quantidade' => 4, 'valor_unitario' => 25]]], $admin, null)[1]['id'];
caso('fornecedor de outro estado (empresa em SP): CFOP 2.102', function () use ($admin, $manual) {
    fiscal((int) empresaAtual()['id'], 'PUT', ['uf' => 'SP', 'regime' => 'simples'], $admin);
    igual(consultarUm('SELECT cfop FROM pedidos WHERE id = ?', [$manual('COMPRA_REVENDA')])['cfop'], '2102');
});
caso('bonificacao: entra no estoque e nao gera conta', function () use ($admin, $manual) {
    $id = $manual('BONIFICACAO');
    pedidos($id, 'POST', [], $admin, 'confirmar');
    igual([(int) consultarUm('SELECT COUNT(*) n FROM pedido_itens WHERE pedido_id = ? AND entrada_id IS NOT NULL', [$id])['n'],
           (int) consultarUm('SELECT COUNT(*) n FROM lancamentos WHERE pedido_id = ?', [$id])['n']], [1, 0]);
});
caso('uso e consumo: gera conta e nao mexe no estoque', function () use ($admin, $manual) {
    $id = $manual('USO_CONSUMO');
    pedidos($id, 'POST', [], $admin, 'confirmar');
    igual([(int) consultarUm('SELECT COUNT(*) n FROM pedido_itens WHERE pedido_id = ? AND entrada_id IS NOT NULL', [$id])['n'],
           (float) consultarUm('SELECT SUM(valor) v FROM lancamentos WHERE pedido_id = ?', [$id])['v']], [0, 100.0]);
});
caso('"Já paguei" (v9): a compra digitada confirma com a conta ja paga, hoje', function () use ($admin, $manual) {
    $id = (int) $manual('COMPRA_REVENDA');
    [$codigo, $r] = pedidos($id, 'POST', ['pago' => 1], $admin, 'confirmar');
    $l = consultar('SELECT status, data_pagamento FROM lancamentos WHERE pedido_id = ?', [$id]);
    igual([$codigo, count($l), $l[0]['status'], substr((string) $l[0]['data_pagamento'], 0, 10), str_contains($r['mensagem'], 'já paga')],
          [200, 1, 'pago', date('Y-m-d'), true]);
});
caso('o Estoque (v9) diz de qual entrada veio cada item (lista e item sozinho)', function () use ($admin, $manual) {
    $id = (int) $manual('COMPRA_REVENDA');
    pedidos($id, 'POST', [], $admin, 'confirmar');
    $eid = (int) consultarUm('SELECT entrada_id FROM pedido_itens WHERE pedido_id = ?', [$id])['entrada_id'];
    $numero = consultarUm('SELECT numero FROM pedidos WHERE id = ?', [$id])['numero'];
    $lista = array_values(array_filter(entradas(null, 'GET', [], $admin, [])[1]['itens'], fn ($e) => (int) $e['id'] === $eid));
    igual([$lista[0]['pedido_id'], $lista[0]['pedido'], entradas($eid, 'GET', [], $admin, [])[1]['entrada']['pedido_id']],
          [$id, $numero, $id]);
});
caso('CFOP nao permitido para a loja bloqueia a confirmacao', function () use ($tentar, $admin, $manual) {
    cfops(2102, 'PUT', ['permitido' => false], $admin);
    $id = $manual('COMPRA_REVENDA');
    igual($tentar(fn () => pedidos($id, 'POST', [], $admin, 'confirmar'))[0], 400);
    cfops(2102, 'PUT', ['permitido' => true], $admin);
});
caso('natureza de saida ou desligada nao serve para pedido de entrada', function () use ($tentar, $manual) {
    igual([$tentar(fn () => $manual('VENDA'))[0], $tentar(fn () => $manual('DEVOLUCAO_CLIENTE'))[0]], [400, 400]);
});
caso('CFOP: cadastra o que falta; oficial nao muda descricao; codigo invalido recusado; balcao 403', function () use ($tentar, $admin, $balcao) {
    igual([
        $tentar(fn () => cfops(null, 'POST', ['codigo' => '1.117', 'descricao' => 'Compra para comercialização originada de encomenda para recebimento futuro'], $admin))[0],
        $tentar(fn () => cfops(1102, 'PUT', ['descricao' => 'outra coisa'], $admin))[0],
        $tentar(fn () => cfops(null, 'POST', ['codigo' => '4102', 'descricao' => 'x'], $admin))[0],
        $tentar(fn () => cfops(1102, 'PUT', ['permitido' => false], $balcao))[0],
        $tentar(fn () => cfops(1102, 'PUT', ['movimenta_estoque' => 'sai'], $admin))[0],
    ], [201, 400, 400, 403, 400]);
});
caso('natureza: CFOP do lado errado recusado (entrada com 5.102)', function () use ($tentar, $admin) {
    igual($tentar(fn () => naturezas(null, 'POST', ['codigo' => 'X', 'descricao' => 'X', 'sentido' => 'entrada', 'cfop_interno' => '5102'], $admin))[0], 400);
});

echo "\ndados fiscais da empresa\n";
caso('cada campo mudado entra no historico; CRT sai do regime', function () use ($admin) {
    $f = fiscal(null, 'GET', [], $admin)[1];
    igual([$f['fiscal']['crt'], array_column(array_reverse($f['historico']), 'campo')], [1, ['regime', 'uf']]);
});
caso('recusas: IBGE com 6 numeros, CEP curto, IE com letra solta, ir para producao sem emissao', function () use ($tentar, $admin) {
    $e = (int) empresaAtual()['id'];
    igual([$tentar(fn () => fiscal($e, 'PUT', ['municipio_ibge' => '355030'], $admin))[0],
           $tentar(fn () => fiscal($e, 'PUT', ['cep' => '0131'], $admin))[0],
           $tentar(fn () => fiscal($e, 'PUT', ['ie' => '12.345-X?'], $admin))[0],
           $tentar(fn () => fiscal($e, 'PUT', ['ambiente' => 'producao'], $admin))[0],
           $tentar(fn () => fiscal($e, 'PUT', ['ie' => 'isento', 'cep' => '01310-100', 'municipio_ibge' => '3550308'], $admin))[0]],
          [400, 400, 400, 400, 200]);
});
caso('cadastro do produto: NCM com pontos grava so os numeros; NCM curto recusado', function () use ($tentar) {
    $id = crudCatalogo('produtos', null, 'POST', ['nome' => 'Carregador NCM', 'ncm' => '8504.40.10', 'origem' => '2', 'unidade' => 'un'], [])[1]['id'];
    $p = consultarUm('SELECT ncm, origem, unidade FROM produtos WHERE id = ?', [$id]);
    igual([$p['ncm'], $p['origem'], $p['unidade'], $tentar(fn () => crudCatalogo('produtos', null, 'POST', ['nome' => 'x', 'ncm' => '8504'], []))[0]],
          ['85044010', '2', 'UN', 400]);
});

fim();
