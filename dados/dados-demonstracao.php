<?php
/**
 * dados/dados-demonstracao.php - enche o sistema com dados de mentira,
 * para voce ver os relatorios funcionando antes de ter movimento real.
 *
 * Uso (na pasta do projeto):
 *   php dados/dados-demonstracao.php criar     inclui os dados
 *   php dados/dados-demonstracao.php limpar    tira tudo o que ele criou
 *
 * Tudo passa pelas MESMAS funcoes da API (api/api.php): compra com conta a
 * pagar, venda com parcelas, OS com servicos e pagamento dividido, OS
 * entregue gerando a venda dela, baixa no financeiro. Antes o script
 * gravava por SQL cru o fluxo antigo (OS sem venda) e escondia os
 * defeitos do fluxo de hoje; agora, se uma regra da API recusar, a
 * demonstracao para com a mensagem da API e nao grava nada.
 *
 * TUDO o que este script cria leva a marca [DEMO] (observacoes, ou o
 * documento de origem marcado), e o "limpar" apaga exatamente isso -
 * inclusive nas tabelas novas (os_pagamentos, lancamentos_log, formas e
 * servicos criados por ele). Rodar "criar" duas vezes nao duplica: ele
 * limpa antes. Usa o mesmo banco da API (INDEX_CELULARES_DB, ou
 * dados/index.sqlite).
 */

declare(strict_types=1);

require __DIR__ . '/../api/api.php';

const MARCA = '[DEMO]';

$acao = $argv[1] ?? '';
if (!in_array($acao, ['criar', 'limpar'], true)) {
    fwrite(STDERR, "Uso:\n  php dados/dados-demonstracao.php criar\n  php dados/dados-demonstracao.php limpar\n");
    exit(1);
}

/** ids de uma consulta, como lista de inteiros. */
function ids(string $sql, array $p = []): array
{
    return array_map('intval', array_column(consultar($sql, $p), 'id'));
}

/**
 * Apaga o que o script criou. E limpeza em massa de dado de mentira, por
 * isso vai por DELETE direto (inclusive em lancamentos): nada aqui e
 * estorno de dinheiro de verdade.
 */
function limpar(): array
{
    return emTransacao(function () {
        $like = '%' . MARCA . '%';
        $os = ids('SELECT id FROM ordens_servico WHERE observacoes LIKE ?', [$like]);
        $vendas = array_values(array_unique(array_merge(
            ids('SELECT id FROM vendas WHERE observacoes LIKE ?', [$like]),
            $os ? ids('SELECT venda_id AS id FROM ordens_servico WHERE venda_id IS NOT NULL AND id IN (' . implode(',', $os) . ')') : []
        )));
        $entradas = ids('SELECT id FROM entradas WHERE observacoes LIKE ?', [$like]);

        $em = fn (string $col, array $lista) => $lista ? " OR {$col} IN (" . implode(',', $lista) . ')' : '';
        $contagem = [];
        $contagem['lancamentos'] = executarSql('DELETE FROM lancamentos WHERE observacoes LIKE ?' .
            $em('venda_id', $vendas) . $em('os_id', $os) . $em('entrada_id', $entradas), [$like]);
        if ($os) {
            executarSql('UPDATE ordens_servico SET venda_id = NULL WHERE id IN (' . implode(',', $os) . ')');
        }
        $contagem['vendas'] = $vendas ? executarSql('DELETE FROM vendas WHERE id IN (' . implode(',', $vendas) . ')') : 0;
        // os_itens, os_pagamentos e os_historico saem por CASCADE
        $contagem['ordens_servico'] = $os ? executarSql('DELETE FROM ordens_servico WHERE id IN (' . implode(',', $os) . ')') : 0;
        foreach ([
            'aparelhos'        => 'DELETE FROM aparelhos WHERE acessorios LIKE ? AND id NOT IN (SELECT aparelho_id FROM ordens_servico WHERE aparelho_id IS NOT NULL)',
            'entradas'         => 'DELETE FROM entradas WHERE observacoes LIKE ?',   // movimentacoes por CASCADE
            'pecas'            => 'DELETE FROM pecas WHERE observacoes LIKE ?',
            'produtos'         => 'DELETE FROM produtos WHERE observacoes LIKE ?',
            'modelos'          => 'DELETE FROM modelos WHERE observacoes LIKE ? AND id NOT IN (SELECT modelo_id FROM aparelhos WHERE modelo_id IS NOT NULL)',
            'fornecedores'     => 'DELETE FROM fornecedores WHERE observacoes LIKE ?',
            'clientes'         => 'DELETE FROM clientes WHERE observacoes LIKE ?',
            'formas_pagamento' => 'DELETE FROM formas_pagamento WHERE observacoes LIKE ?',
            'servicos'         => 'DELETE FROM servicos WHERE descricao LIKE ? AND id NOT IN (SELECT servico_id FROM os_itens WHERE servico_id IS NOT NULL)',
        ] as $tabela => $sql) {
            $contagem[$tabela] = executarSql($sql, [$like]);
        }
        return $contagem;
    });
}

/** Data de N meses atras, no dia informado. */
function dataDemo(int $mesesAtras, int $dia, string $hora = '10:00:00'): string
{
    return substr(somarMeses(date('Y-m-01'), -$mesesAtras), 0, 8) . sprintf('%02d', min($dia, 28)) . ' ' . $hora;
}

try {
    if ($acao === 'limpar') {
        echo "Limpando os dados de demonstração...\n\n";
        foreach (limpar() as $tabela => $n) {
            if ($n > 0) {
                printf("  %-16s %3d removido(s)\n", $tabela, $n);
            }
        }
        echo "\nPronto. Só sobrou o que você mesmo cadastrou.\n";
        exit(0);
    }

    echo "Tirando dados de demonstração antigos, se houver...\n";
    limpar();
    echo "Criando dados de demonstração pelo fluxo da API...\n";

    $admin = consultarUm("SELECT id FROM usuarios WHERE perfil = 'admin' AND ativo = 1 ORDER BY id LIMIT 1");
    if (!$admin) {
        throw new RuntimeException('não há usuário admin ativo para assinar os registros.');
    }
    $u = ['id' => (int) $admin['id'], 'perfil' => 'admin'];

    /* Chama uma rota da API (cadastro ou entradas) como funcao e devolve o id criado. */
    $criar = function (string $rota, array $corpo) use ($u): int {
        [, $resposta] = $rota === 'entradas' ? entradas(null, 'POST', $corpo, $u, [])
                                              : crudCatalogo($rota, null, 'POST', $corpo, []);
        return (int) $resposta['id'];
    };

    $resultado = emTransacao(function () use ($u, $criar) {
        // ---- cadastros ------------------------------------------------
        $clientes = [];
        foreach ([['Ana Paula Ribeiro', '(00) 99811-2233'], ['Carlos Menezes', '(00) 99722-3344'],
                  ['Juliana Prado', '(00) 99633-4455'], ['Marcos Vinicius', '(00) 99544-5566'],
                  ['Fernanda Lopes', '(00) 99455-6677']] as [$nome, $fone]) {
            $clientes[] = $criar('clientes', ['nome' => $nome, 'telefone' => $fone, 'observacoes' => MARCA . ' cliente de exemplo']);
        }
        $fornecedor = $criar('fornecedores', ['nome' => 'Sul Distribuidora de Peças', 'telefone' => '(00) 3322-1100',
                                              'observacoes' => MARCA . ' fornecedor de exemplo']);

        $modelos = [];
        foreach ([['Apple', 'iPhone 11', '128GB'], ['Apple', 'iPhone 13', '128GB'],
                  ['Samsung', 'Galaxy A54', '256GB'], ['Motorola', 'Moto G84', '256GB'],
                  ['Xiaomi', 'Redmi Note 12', '128GB']] as [$marca, $modelo, $arm]) {
            $modelos[] = [$criar('modelos', ['marca' => $marca, 'modelo' => $modelo . ' (demo)', 'armazenamento' => $arm,
                                            'observacoes' => MARCA]), $marca, $modelo . ' (demo)', $arm];
        }

        // Formas e servicos: usa os do cadastro; o que faltar e criado marcado.
        $forma = function (string $nome) use ($criar): int {
            $f = consultarUm('SELECT id FROM formas_pagamento WHERE minusculas(nome) = minusculas(?)', [$nome]);
            return $f ? (int) $f['id'] : $criar('formas-pagamento', ['nome' => $nome, 'observacoes' => MARCA]);
        };
        $servico = function (string $nome, float $preco) use ($criar): int {
            $s = consultarUm('SELECT id FROM servicos WHERE minusculas(nome) = minusculas(?)', [$nome]);
            return $s ? (int) $s['id'] : $criar('servicos', ['nome' => $nome, 'valor_padrao' => $preco, 'descricao' => MARCA]);
        };
        $formas = ['Pix' => $forma('Pix'), 'Dinheiro' => $forma('Dinheiro'),
                   'Débito' => $forma('Cartão de débito'), 'Crédito' => $forma('Cartão de crédito')];

        // ---- compras: entradas com a conta a pagar ja paga ----------------
        $entrada = fn (array $corpo) => $criar('entradas', $corpo + ['fornecedor_id' => $fornecedor,
            'gerar_conta_pagar' => 'pago', 'forma_pagamento_id' => $formas['Pix']]);

        $lotesPeca = [];
        foreach ([['Tela iPhone 11 Incell', 'tela', 30, 95, 260], ['Bateria iPhone 11', 'bateria', 24, 55, 180],
                  ['Placa de carga Galaxy A54', 'placa_carga', 20, 70, 210], ['Flex de carga Moto G84', 'flex_carga', 18, 45, 160],
                  ['Câmera traseira iPhone 13', 'camera', 14, 120, 340]] as [$nome, $cat, $qtd, $custo, $venda]) {
            $peca = $criar('pecas', ['nome' => $nome, 'categoria' => $cat, 'observacoes' => MARCA]);
            $lotesPeca[] = [$entrada(['tipo' => 'peca', 'peca_id' => $peca, 'quantidade' => $qtd, 'valor_investimento' => $custo,
                'valor_venda' => $venda, 'data_entrada' => dataDemo(11, 10), 'observacoes' => MARCA . ' lote de peças']), (float) $venda];
        }
        $lotesProduto = [];
        foreach ([['Película 3D', 'pelicula', 90, 8, 35], ['Capa antichoque', 'capa', 80, 14, 60],
                  ['Carregador turbo 30W', 'carregador', 60, 32, 95], ['Fone Bluetooth TWS', 'fone', 45, 45, 149]] as [$nome, $cat, $qtd, $custo, $venda]) {
            $prod = $criar('produtos', ['nome' => $nome, 'categoria' => $cat, 'observacoes' => MARCA]);
            $lotesProduto[] = $entrada(['tipo' => 'produto', 'produto_id' => $prod, 'quantidade' => $qtd, 'valor_investimento' => $custo,
                'valor_venda' => $venda, 'data_entrada' => dataDemo(11, 12), 'observacoes' => MARCA . ' lote de acessórios']);
        }

        // Celulares: cada venda pede o seu, comprado no mes anterior (lista
        // fixa acabava no meio do periodo e os ultimos meses ficavam vazios).
        $imei = 356000000000000 + random_int(0, 899999) * 1000;
        $celular = function (int $mesesAtras, int $k, string $situacao = 'ready') use ($entrada, $modelos, &$imei): int {
            [$m, $cor, $custo, $venda, $cond] = [[0, 'Preto', 1450, 2190, 'seminovo'], [1, 'Azul', 2100, 3090, 'seminovo'],
                [2, 'Grafite', 980, 1590, 'novo'], [3, 'Azul', 820, 1390, 'novo'], [4, 'Cinza', 690, 1150, 'seminovo']][$k % 5];
            // IMEI de mentira, mas com o digito verificador certo (a API confere).
            $base = (string) ($imei += 10);   // de 10 em 10: o 15o digito e o verificador
            $base14 = substr($base, 0, 14);
            $digito = 0;
            while (!imeiConfere($base14 . $digito)) {
                $digito++;
            }
            return $entrada(['tipo' => 'celular', 'modelo_id' => $modelos[$m][0], 'imei' => $base14 . $digito, 'cor' => $cor,
                'condicao' => $cond, 'valor_investimento' => $custo, 'valor_venda' => $venda, 'situacao' => $situacao,
                'data_entrada' => dataDemo($mesesAtras, 5), 'observacoes' => MARCA . ' celular de exemplo']);
        };
        foreach ([0, 1, 2, 3, 4] as $k) {      // cinco parados na prateleira hoje
            $celular($k % 3, $k + 3, $k < 2 ? 'check' : 'ready');
        }

        /* Da baixa nas parcelas ja vencidas, como a loja faria no Financeiro. */
        $baixar = function (int $vendaId) use ($u): void {
            foreach (consultar("SELECT id, vencimento FROM lancamentos WHERE venda_id = ? AND status = 'pendente' AND vencimento <= ?",
                               [$vendaId, date('Y-m-d')]) as $l) {
                lancamentos((int) $l['id'], 'PUT', ['status' => 'pago', 'data_pagamento' => $l['vencimento'] . ' 12:00:00'], $u, []);
            }
        };

        // ---- vendas de balcao ----------------------------------------------
        $vendas = 0;
        foreach ([11 => 2, 10 => 3, 9 => 2, 8 => 4, 7 => 3, 6 => 2, 5 => 4, 4 => 3, 3 => 2, 2 => 3, 1 => 3, 0 => 2] as $mes => $quantas) {
            for ($n = 0; $n < $quantas; $n++) {
                $quando = dataDemo($mes, 4 + $n * 6, '14:30:00');
                if (substr($quando, 0, 10) > date('Y-m-d')) {
                    continue;   // o mes corrente ainda nao chegou neste dia
                }
                $credito = $n % 4 === 1;
                [, $r] = criarVenda([
                    'itens' => [['entrada_id' => $celular(min(11, $mes + 1), $vendas)],
                                ['entrada_id' => $lotesProduto[$n % 4], 'quantidade' => 1 + ($n % 2)]],
                    'cliente_id' => $clientes[($vendas + $n) % 5],
                    'desconto' => $n === 2 ? 50 : 0, 'parcelas' => $credito ? 3 : 1, 'pago' => !$credito,
                    'forma_pagamento_id' => $credito ? $formas['Crédito'] : $formas[['Pix', 'Dinheiro', 'Débito'][$n % 3]],
                    'data_venda' => $quando, 'observacoes' => MARCA . ' venda de exemplo',
                ], $u);
                $baixar((int) $r['id']);
                $vendas++;
            }
        }

        // ---- ordens de servico: as entregues viram venda --------------------
        $ordens = 0;
        $defeitos = [['Tela trincada, touch falhando', 'Troca de tela', 0, 180.0],
                     ['Bateria viciada', 'Troca de bateria', 1, 120.0],
                     ['Não carrega', 'Troca de conector de carga', 2, 150.0],
                     ['Conector de carga folgado', 'Troca de conector de carga', 3, 130.0],
                     ['Câmera traseira sem foco', 'Troca de câmera', 4, 200.0]];
        foreach ([11 => 2, 10 => 2, 9 => 3, 8 => 2, 7 => 3, 6 => 2, 5 => 3, 4 => 2, 3 => 3, 2 => 2, 1 => 3, 0 => 2] as $mes => $quantas) {
            for ($n = 0; $n < $quantas; $n++) {
                [$defeito, $nomeServico, $iPeca, $maoObra] = $defeitos[($ordens + $n) % 5];
                [$lote, $precoPeca] = $lotesPeca[$iPeca];
                [, $marca, $modelo, $arm] = $modelos[$iPeca];
                $abertura = dataDemo($mes, 3 + $n * 6, '09:15:00');
                $entrega  = dataDemo($mes, 6 + $n * 6, '17:40:00');
                if (substr($abertura, 0, 10) > date('Y-m-d')) {
                    continue;
                }
                $emAndamento = substr($entrega, 0, 10) > date('Y-m-d') || ($mes === 0 && $n === 1);
                $final = $precoPeca + $maoObra;
                // uma em cada tres e paga metade no Pix, metade no debito
                $pagamentos = $ordens % 3 === 0
                    ? [['forma_pagamento_id' => $formas['Pix'], 'valor' => round($final / 2, 2)],
                       ['forma_pagamento_id' => $formas['Débito'], 'valor' => round($final - round($final / 2, 2), 2)]]
                    : [['forma_pagamento_id' => $formas[['Pix', 'Dinheiro'][$n % 2]], 'valor' => $final]];
                [, $r] = criarOs([
                    'cliente_id' => $clientes[($ordens + 2) % 5],
                    'modelo_nome' => $modelo, 'marca' => $marca, 'armazenamento' => $arm,
                    'cor' => 'Preto', 'acessorios' => MARCA . ' capa e chip',
                    'defeito_relatado' => $defeito, 'diagnostico' => $nomeServico,
                    'itens' => [['entrada_id' => $lote, 'quantidade' => 1, 'valor_unitario' => $precoPeca],
                                ['servico_id' => $servico($nomeServico, $maoObra), 'descricao' => $nomeServico,
                                 'quantidade' => 1, 'valor_unitario' => $maoObra]],
                    'pagamentos' => $pagamentos,
                    'status' => $emAndamento ? 'em_reparo' : 'entregue',
                    'data_entrada' => $abertura, 'data_entrega' => $emAndamento ? null : $entrega,
                    'observacoes' => MARCA . ' ordem de exemplo',
                ], $u);
                $vendaDaOs = consultarUm('SELECT venda_id FROM ordens_servico WHERE id = ?', [(int) $r['id']])['venda_id'];
                if ($vendaDaOs) {
                    $baixar((int) $vendaDaOs);
                }
                $ordens++;
            }
        }

        // ---- despesas fixas: e o que faz o lucro LIQUIDO diferir do bruto ----
        foreach (range(11, 0) as $mes) {
            foreach ([['Aluguel da loja', 'aluguel', 1800.0, 5], ['Energia elétrica', 'energia', 320.0, 10],
                      ['Internet e telefone', 'internet', 190.0, 12]] as [$nome, $cat, $valor, $dia]) {
                $venc = substr(dataDemo($mes, $dia), 0, 10);
                $pago = $venc <= date('Y-m-d');
                lancamentos(null, 'POST', ['tipo' => 'pagar', 'descricao' => $nome, 'categoria' => $cat, 'valor' => $valor,
                    'vencimento' => $venc, 'status' => $pago ? 'pago' : 'pendente',
                    'data_pagamento' => $pago ? $venc . ' 09:00:00' : null,
                    'observacoes' => MARCA . ' despesa fixa de exemplo'], $u, []);
            }
        }
        lancamentos(null, 'POST', ['tipo' => 'pagar', 'descricao' => 'Compra: lote de telas e baterias', 'categoria' => 'fornecedor',
            'valor' => 1490.0, 'vencimento' => date('Y-m-d', strtotime('+8 days')), 'fornecedor_id' => $fornecedor,
            'observacoes' => MARCA . ' conta de exemplo'], $u, []);

        return ['vendas de balcão' => $vendas, 'ordens de serviço' => $ordens];
    });

    echo "\n=== O que foi criado ===\n";
    foreach ($resultado as $o => $n) {
        printf("  %-18s %3d\n", $o, $n);
    }
    foreach (['clientes', 'entradas', 'vendas', 'ordens_servico', 'os_pagamentos', 'lancamentos'] as $t) {
        printf("  %-18s %3d no banco\n", $t, (int) consultarUm('SELECT COUNT(*) AS q FROM "' . $t . '"')['q']);
    }
    echo "\nAbra o sistema e veja a aba Dashboard.\n";
    echo "Para tirar tudo isso depois:  php dados/dados-demonstracao.php limpar\n";
} catch (ErroApi $e) {
    fwrite(STDERR, "A API recusou um dado da demonstração (nada foi gravado): {$e->getMessage()}\n");
    exit(1);
} catch (Throwable $e) {
    fwrite(STDERR, "FALHOU: {$e->getMessage()} (nada foi gravado)\n");
    exit(1);
}
