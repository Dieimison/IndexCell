<?php
/**
 * testes/nucleo.test.php - regras puras do servidor, sem servidor no ar:
 *   - a regra da mao de obra / valor final contra testes/casos/mao-de-obra.json
 *     (a MESMA tabela que testes/front/os-regras.test.js roda na tela),
 *     inclusive os casos de edicao pelo valoresOs() de verdade (PUT parcial);
 *   - a regra de senha, a normalizacao de nome, o digito do IMEI;
 *   - DEFAULT do esquema igual a constante do PHP;
 *   - os 11 DOMINIOS iguais aos CHECK do banco, nos dois sentidos (r4).
 *
 * Uso: php testes/nucleo.test.php
 */

declare(strict_types=1);

require __DIR__ . '/caso.php';
require __DIR__ . '/../api/api.php';

echo "nucleo: regra da OS (testes/casos/mao-de-obra.json)\n";
$tabela = json_decode((string) file_get_contents(__DIR__ . '/casos/mao-de-obra.json'), true);
caso('a tabela existe e tem pelo menos 15 casos', fn () => verdade(is_array($tabela) && count($tabela) >= 15, 'tabela vazia ou ilegivel'));
/*
 * Caso de EDICAO (formato combinado com o front, r4): "edicao": {"gravado":
 * {"mao": X, "final": Y}}. Ai entrada.mao_digitada/final_digitado e o que a
 * pessoa mexeu DEPOIS de abrir a OS (null = nao mexeu) e vale
 * digitado = entrada ?? gravado. O lado servidor disso e o PUT parcial:
 * campo que nao vem no corpo fica o gravado ($atual) - testado abaixo pelo
 * valoresOs() de verdade, nao por uma copia da regra.
 */
$comEdicao = function (array $c): array {
    $e = $c['entrada'];
    if (isset($c['edicao']['gravado'])) {
        $e['mao_digitada']   = $e['mao_digitada'] ?? $c['edicao']['gravado']['mao'];
        $e['final_digitado'] = $e['final_digitado'] ?? $c['edicao']['gravado']['final'];
    }
    return $e;
};
foreach ($tabela ?: [] as $c) {
    caso($c['nome'], function () use ($c, $comEdicao) {
        $v = calcularValoresOs($comEdicao($c));
        igual([emCentavos($v['mao']), emCentavos($v['final'])],
              [emCentavos($c['esperado']['mao']), emCentavos($c['esperado']['final'])], 'mao/final em centavos');
    });
}
$edicoes = array_values(array_filter($tabela ?: [], fn ($c) => isset($c['edicao']['gravado'])));
caso('a tabela tem casos de edicao (digitado na edicao, A1/M8)', fn () => verdade(count($edicoes) >= 5, 'menos de 5 casos de edicao'));
foreach ($edicoes as $c) {
    caso('PUT parcial: ' . $c['nome'], function () use ($c) {
        $e = $c['entrada'];
        $corpo = ['valor_orcamento' => $e['orcamento']];          // a tela sempre manda o orcamento
        if ($e['mao_digitada'] !== null) {
            $corpo['valor_mao_obra'] = $e['mao_digitada'];
        }
        if ($e['final_digitado'] !== null) {
            $corpo['valor_final'] = $e['final_digitado'];
        }
        $atual = ['valor_orcamento' => $e['orcamento'], 'valor_mao_obra' => $c['edicao']['gravado']['mao'],
                  'valor_final' => $c['edicao']['gravado']['final']];
        $v = valoresOs($corpo, $atual, (float) $e['pecas'], (float) $e['servicos']);
        igual([emCentavos($v['mao_obra']), emCentavos($v['final'])],
              [emCentavos($c['esperado']['mao']), emCentavos($c['esperado']['final'])], 'valoresOs mao/final em centavos');
    });
}

echo "\nnucleo: regra de senha\n";
foreach ([
    ['Usuario-Teste-77', 'tsenha', null],
    ['Senha-Forte-9', 'okfraco', null],
    ['curta1', 'x', 'pelo menos'],
    ['senhasenha', 'gilberto', 'letras e números'],
    ['aaaaaaaa', 'gilberto', 'letras e números'],
    ['12121212', 'gilberto', 'letras e números'],
    ['ab12ab12', 'gilberto', 'repetição'],
    ['balcao12', 'balcao1', 'conter o login'],
    ['balcao1x', 'balcao1', 'conter o login'],
    ['BALCAO1-2026', 'balcao1', 'conter o login'],
    ['senha123', 'gilberto', 'comum'],
    ['Admin2026', 'gilberto', 'comum'],
    ['12345678', 'gilberto', 'letras e números'],
    ['Loja-Index-2026', 'gilberto', null],
] as [$senha, $login, $espera]) {
    caso("senha \"{$senha}\" para o login \"{$login}\"", function () use ($senha, $login, $espera) {
        $r = senhaFraca($senha, $login);
        $espera === null ? igual($r, null, 'deveria aceitar') : verdade($r !== null && str_contains($r, $espera),
            "deveria recusar com \"{$espera}\", veio " . json_encode($r, JSON_UNESCAPED_UNICODE));
    });
}

echo "\nnucleo: nomes, IMEI e moeda\n";
caso('"Cartão de Crédito" e "cartao de credito" sao o mesmo nome', fn () =>
    igual(normalizarNome('  Cartão   de Crédito '), normalizarNome('CARTAO DE CREDITO')));
caso('IMEI com digito certo passa (Luhn)', fn () => igual(imeiConfere('490154203237518'), true));
caso('IMEI com o ultimo digito trocado e recusado', fn () => igual(imeiConfere('490154203237519'), false));
caso('emCentavos devolve centavos inteiros (nome com a unidade)', fn () => igual(emCentavos(0.1 + 0.2), 30));
caso('somarMeses: 31/01 + 1 = 28/02, + 2 = 31/03', fn () =>
    igual([somarMeses('2027-01-31', 1), somarMeses('2027-01-31', 2)], ['2027-02-28', '2027-03-31']));

echo "\nnucleo: DEFAULT do esquema = constante do PHP\n";
$ref = abrirSqlite(':memory:');
[$estrutura] = explode('-- @@SEMENTES@@', (string) file_get_contents(__DIR__ . '/../dados/estrutura.sql'));
$ref->exec($estrutura);
$padrao = function (string $tabela, string $coluna) use ($ref) {
    foreach ($ref->query('PRAGMA table_info("' . $tabela . '")') as $c) {
        if ($c['name'] === $coluna) {
            return $c['dflt_value'];
        }
    }
    return null;
};
caso('ordens_servico.garantia_dias DEFAULT = GARANTIA_PADRAO', fn () =>
    igual((int) $padrao('ordens_servico', 'garantia_dias'), GARANTIA_PADRAO));
/*
 * r4 (item 7): o CHECK do banco e o DOMINIOS do nucleo sao a mesma lista,
 * nos dois sentidos, para TODOS os dominios. Valor novo no DOMINIOS sem o
 * CHECK viraria erro cru do SQLite ao gravar; CHECK novo sem dominio, um
 * valor que a tela nao oferece. Dominio novo sem coluna aqui = falha.
 */
echo "\nnucleo: dominios = CHECK do banco (os dois sentidos)\n";
$colunaDoDominio = [
    'status_os'            => ['ordens_servico', 'status'],
    'status_venda'         => ['vendas', 'status'],
    'status_lancamento'    => ['lancamentos', 'status'],
    'tipos_lancamento'     => ['lancamentos', 'tipo'],
    'tipos_entrada'        => ['entradas', 'tipo'],
    'situacoes'            => ['entradas', 'situacao'],
    'categorias_peca'      => ['pecas', 'categoria'],
    'tipos_pagamento'      => ['formas_pagamento', 'tipo'],
    'condicoes'            => ['entradas', 'condicao'],
    'perfis'               => ['usuarios', 'perfil'],
    'motivos_movimentacao' => ['movimentacoes', 'motivo'],
    'listas'               => ['opcoes_lista', 'lista'],
    'escopos_chave'        => ['chaves_historico', 'escopo'],
    'regimes'              => ['empresa_fiscal', 'regime'],
    'ambientes'            => ['empresa_fiscal', 'ambiente'],
    'ufs'                  => ['fornecedores', 'uf'],
    'efeitos_estoque'      => ['cfop_empresa', 'movimenta_estoque'],
    'efeitos_financeiro'   => ['cfop_empresa', 'gera_financeiro'],
    'sentidos'             => ['naturezas_operacao', 'sentido'],
    'finalidades'          => ['naturezas_operacao', 'finalidade'],
    'status_pedido'        => ['pedidos', 'status'],
    'origens_mercadoria'   => ['produtos', 'origem'],
    'status_encomenda'     => ['encomendas', 'status'],
];
$listaDoCheck = function (string $tabela, string $coluna) use ($ref): array {
    $sql = (string) $ref->query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = " . $ref->quote($tabela))->fetchColumn();
    $n = preg_match_all('/\b' . preg_quote($coluna, '/') . '\s+IN\s*\(([^)]*)\)/', $sql, $m);
    if ($n !== 1) {
        throw new RuntimeException("{$tabela}.{$coluna}: esperava 1 CHECK ... IN (...), achei {$n}");
    }
    preg_match_all("/'([^']*)'/", $m[1][0], $v);
    $lista = $v[1];
    sort($lista);
    return $lista;
};
caso('todo dominio do nucleo tem a sua coluna nesta lista (sao ' . count(DOMINIOS) . ')', fn () =>
    igual(array_values(array_diff(array_keys(DOMINIOS), array_keys($colunaDoDominio))), [], 'dominio sem coluna mapeada'));
foreach ($colunaDoDominio as $dominio => [$tabela, $coluna]) {
    caso("{$dominio} = CHECK de {$tabela}.{$coluna}", function () use ($dominio, $tabela, $coluna, $listaDoCheck) {
        $doDominio = valoresDe($dominio);
        sort($doDominio);
        igual($listaDoCheck($tabela, $coluna), $doDominio, 'valores do CHECK x valoresDe()');
    });
}
caso('os lados dos motivos = CHECK de movimentacoes.tipo', function () use ($listaDoCheck) {
    $lados = array_values(array_unique(array_column(DOMINIOS['motivos_movimentacao'], 1)));
    sort($lados);
    igual($listaDoCheck('movimentacoes', 'tipo'), $lados);
});
caso('a versao do esquema e a do nucleo (e unica)', fn () => verdade(VERSAO_BANCO >= 4, 'VERSAO_BANCO < 4'));

fim();
