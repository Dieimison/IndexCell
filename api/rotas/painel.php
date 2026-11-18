<?php
/**
 * api/rotas/painel.php - /resumo, /financeiro e /relatorios.
 *
 * Receita e custo saem SEMPRE da view vw_receitas (e os itens vendidos de
 * vw_itens_faturados). As duas leem vw_faturamentos, o unico lugar que
 * decide o que e faturamento e se ele e de balcao ou de oficina - a OS
 * entregue que gerou venda conta uma vez so, pela venda. Consulta nova de
 * receita: leia a view; nao escreva o JOIN de novo.
 */

declare(strict_types=1);

/* Estoque parado: SQL_ESTOQUE_PARADO (api/nucleo.php), sobre a vw_entradas. */

/*
 * O servidor e a fonte dos numeros do painel: cards de celular por
 * situacao e o total de OS em andamento. A tela le estes campos e nao
 * recalcula (CONTRATO: resumo.cards, resumo.os_em_andamento).
 */
function resumo(array $usuario): array
{
    $cards = [];
    foreach (['ready', 'processamento', 'check', 'total'] as $s) {
        $cards[$s] = ['quantidade' => 0, 'investido' => 0.0, 'venda' => 0.0];
    }

    // Cards dos CELULARES, como as tabelas embaixo deles.
    foreach (consultar(
        "SELECT situacao,
                COALESCE(SUM(saldo), 0)                          AS quantidade,
                COALESCE(SUM(valor_investimento * saldo), 0)     AS investido,
                COALESCE(SUM(valor_venda        * saldo), 0)     AS venda
           FROM vw_entradas
          WHERE tipo = 'celular' AND " . SQL_ESTOQUE_PARADO . "
          GROUP BY situacao"
    ) as $l) {
        $cards[$l['situacao']] = ['quantidade' => (int) $l['quantidade'],
                                  'investido' => round((float) $l['investido'], 2),
                                  'venda' => round((float) $l['venda'], 2)];
        $cards['total']['quantidade'] += (int) $l['quantidade'];
        $cards['total']['investido']  = round($cards['total']['investido'] + (float) $l['investido'], 2);
        $cards['total']['venda']      = round($cards['total']['venda'] + (float) $l['venda'], 2);
    }

    $porStatus = [];
    foreach (consultar('SELECT status, COUNT(*) AS q FROM ordens_servico GROUP BY status') as $l) {
        $porStatus[$l['status']] = (int) $l['q'];
    }
    $emAndamento = 0;
    foreach (STATUS_OS_EM_ANDAMENTO as $s) {
        $emAndamento += $porStatus[$s] ?? 0;
    }

    $proximo = consultarUm(
        "SELECT id, item AS modelo, valor_investimento, valor_venda, observacoes, data_entrada
           FROM vw_entradas
          WHERE situacao = 'processamento' AND tipo = 'celular' AND saldo > 0
          ORDER BY data_entrada LIMIT 1");

    // A proxima a CONSERTAR: as em andamento menos a 'pronta'.
    $naBancada = array_values(array_diff(STATUS_OS_EM_ANDAMENTO, ['pronta']));
    $proximaOs = consultarUm(
        'SELECT os.id, os.numero, os.status, os.data_previsao, c.nome AS cliente, ' . sqlNomeAparelho('a') . ' AS aparelho
           FROM ordens_servico os
           JOIN clientes c ON c.id = os.cliente_id
           LEFT JOIN aparelhos a ON a.id = os.aparelho_id
          WHERE os.status IN (' . vagas($naBancada) . ")
          ORDER BY CASE os.status WHEN 'em_reparo' THEN 1 WHEN 'aprovada' THEN 2 ELSE 3 END, os.data_entrada
          LIMIT 1", $naBancada);

    // Custo e lucro sao do dono: tecnico e balcao veem quantidade e preco.
    if ($usuario['perfil'] !== 'admin') {
        foreach (array_keys($cards) as $k) {
            unset($cards[$k]['investido']);
        }
        if ($proximo) {
            unset($proximo['valor_investimento']);
        }
    }

    return ['cards' => $cards, 'os' => (object) $porStatus, 'os_em_andamento' => $emAndamento,
            'proximo' => $proximo, 'proxima_os' => $proximaOs];
}

function arredondar(array $linha): array
{
    foreach ($linha as $k => $v) {
        $linha[$k] = is_float($v) ? round($v, 2) : $v;
    }
    return $linha;
}

/*
 * CONTRATO: financeiro.os.os_abertas e a fonte do "OS em andamento" do
 * Financeiro (conta com STATUS_OS_EM_ANDAMENTO).
 */
function financeiro(): array
{
    $est = arredondar(consultarUm(
        'SELECT COALESCE(SUM(valor_investimento * saldo), 0) AS investido_parado,
                COALESCE(SUM(valor_venda * saldo), 0)        AS venda_prevista,
                COALESCE(SUM(saldo), 0)                      AS unidades_paradas
           FROM vw_entradas
          WHERE ' . SQL_ESTOQUE_PARADO));

    // Faturamento: tudo da vw_receitas (sem dupla contagem por construcao).
    $fat = arredondar(consultarUm(
        "SELECT COALESCE(SUM(CASE WHEN origem = 'venda' THEN receita END), 0)    AS receita_vendas,
                COALESCE(SUM(CASE WHEN origem = 'venda' THEN custo END), 0)      AS custo_vendas,
                COALESCE(SUM(CASE WHEN origem = 'venda' THEN quantidade END), 0) AS quantidade,
                COALESCE(SUM(CASE WHEN origem = 'os' AND venda_id IS NOT NULL THEN receita END), 0)    AS receita_os_venda,
                COALESCE(SUM(CASE WHEN origem = 'os' AND venda_id IS NOT NULL THEN custo END), 0)      AS custo_os_venda,
                COALESCE(SUM(CASE WHEN origem = 'os' AND venda_id IS NOT NULL THEN quantidade END), 0) AS qtd_os_venda,
                COALESCE(SUM(CASE WHEN origem = 'os' THEN receita END), 0) AS receita_os,
                COALESCE(SUM(CASE WHEN origem = 'os' THEN custo END), 0)   AS custo_os
           FROM vw_receitas"));

    $andamento = vagas(STATUS_OS_EM_ANDAMENTO);
    $os = consultarUm(
        "SELECT COUNT(CASE WHEN status = 'entregue' THEN 1 END)                     AS os_entregues,
                COALESCE(SUM(CASE WHEN status IN ($andamento) THEN valor_orcamento END), 0) AS a_receber,
                COUNT(CASE WHEN status IN ($andamento) THEN 1 END)                  AS os_abertas
           FROM ordens_servico", array_merge(STATUS_OS_EM_ANDAMENTO, STATUS_OS_EM_ANDAMENTO));

    $hoje = date('Y-m-d');
    $lanc = arredondar(consultarUm(
        "SELECT COALESCE(SUM(CASE WHEN tipo='receber' AND status='pendente' THEN valor END), 0) AS a_receber,
                COALESCE(SUM(CASE WHEN tipo='pagar'   AND status='pendente' THEN valor END), 0) AS a_pagar,
                COALESCE(SUM(CASE WHEN tipo='receber' AND status='pago'     THEN valor END), 0) AS recebido,
                COALESCE(SUM(CASE WHEN tipo='pagar'   AND status='pago'     THEN valor END), 0) AS pago,
                COALESCE(SUM(CASE WHEN tipo='receber' AND status='pendente'
                                   AND vencimento IS NOT NULL AND vencimento < ? THEN valor END), 0) AS vencido_receber,
                COALESCE(SUM(CASE WHEN tipo='pagar'   AND status='pendente'
                                   AND vencimento IS NOT NULL AND vencimento < ? THEN valor END), 0) AS vencido_pagar
           FROM lancamentos", [$hoje, $hoje]));

    $mensal = consultar(
        "SELECT substr(dia, 1, 7) AS mes,
                ROUND(COALESCE(SUM(CASE WHEN origem = 'venda' THEN receita END), 0), 2) AS vendas,
                ROUND(COALESCE(SUM(CASE WHEN origem = 'os' THEN receita END), 0), 2)    AS os,
                ROUND(COALESCE(SUM(receita), 0), 2)                                     AS total,
                SUM(quantidade)                                                         AS quantidade
           FROM vw_receitas
          WHERE dia IS NOT NULL
          GROUP BY mes ORDER BY mes DESC LIMIT 12");

    $vend = ['receita_vendas' => $fat['receita_vendas'], 'custo_vendas' => $fat['custo_vendas'],
             'quantidade' => (int) $fat['quantidade'], 'receita_os_venda' => $fat['receita_os_venda'],
             'custo_os_venda' => $fat['custo_os_venda'], 'qtd_os_venda' => (int) $fat['qtd_os_venda']];
    $osSaida = ['receita_os' => $fat['receita_os'], 'custo_pecas' => $fat['custo_os'],
                'os_entregues' => (int) $os['os_entregues'], 'a_receber' => round((float) $os['a_receber'], 2),
                'os_abertas' => (int) $os['os_abertas']];

    return [
        'estoque'                => $est,
        'vendas'                 => $vend,
        'os'                     => $osSaida,
        'lancamentos'            => $lanc,
        'mensal'                 => $mensal,
        'lucro_previsto_estoque' => round($est['venda_prevista'] - $est['investido_parado'], 2),
        'lucro_vendas'           => round($vend['receita_vendas'] - $vend['custo_vendas'], 2),
        'lucro_os'               => round($osSaida['receita_os'] - $osSaida['custo_pecas'], 2),
        'saldo_previsto'         => round($lanc['a_receber'] - $lanc['a_pagar'], 2),
    ];
}

/*
 * Series diarias dos graficos. A conta do DRE (receita - custo -
 * despesas) e da tela, sobre a serie diaria, porque e la que existem o
 * filtro de periodo e o de origem. Despesa = lancamento a pagar de origem
 * MANUAL, mais o custo do que saiu de BRINDE (a compra de estoque vira
 * custo quando o item vende; o brinde nao vende, entao o custo dele entra
 * aqui, pelo dia do brinde e pelo custo da entrada).
 */
const SQL_BRINDES = "SELECT substr(m.criado_em, 1, 10) AS dia,
                            ROUND(COALESCE(SUM(e.valor_investimento * m.quantidade), 0), 2) AS total, COUNT(*) AS quantidade
                       FROM movimentacoes m
                       JOIN entradas e ON e.id = m.entrada_id
                      WHERE m.motivo = 'brinde' AND m.tipo = 'saida' AND m.criado_em >= ?
                      GROUP BY dia";
const CATEGORIA_BRINDE = 'Brinde / cortesia';

function relatorios(): array
{
    // 12 meses-calendario fechados, contados do DIA 1.
    $desde = (new DateTimeImmutable(date('Y-m-01')))->modify('-11 months')->format('Y-m-d');

    $porDia = [];
    $noDia = function (string $dia, string $campo, $valor) use (&$porDia): void {
        if ($dia === '') {
            return;
        }
        $porDia[$dia] ??= ['receita_vendas' => 0.0, 'custo_vendas' => 0.0, 'receita_os' => 0.0,
                           'custo_os' => 0.0, 'despesas' => 0.0, 'recebido' => 0.0,
                           'pago' => 0.0, 'quantidade' => 0, 'qtd_os' => 0];
        $porDia[$dia][$campo] += $valor;
    };

    foreach (consultar(
        'SELECT dia, origem, SUM(receita) AS receita, SUM(custo) AS custo, SUM(quantidade) AS quantidade
           FROM vw_receitas WHERE dia >= ? GROUP BY dia, origem', [$desde]) as $l) {
        $balcao = $l['origem'] === 'venda';
        $noDia($l['dia'], $balcao ? 'receita_vendas' : 'receita_os', (float) $l['receita']);
        $noDia($l['dia'], $balcao ? 'custo_vendas' : 'custo_os', (float) $l['custo']);
        $noDia($l['dia'], $balcao ? 'quantidade' : 'qtd_os', (int) $l['quantidade']);
    }

    // Despesa entra pela data em que foi PAGA; ainda sem baixa, pelo vencimento.
    foreach (consultar(
        "SELECT substr(COALESCE(data_pagamento, vencimento), 1, 10) AS dia, COALESCE(SUM(valor), 0) AS total
           FROM lancamentos
          WHERE tipo = 'pagar' AND origem = 'manual' AND status <> 'cancelado'
            AND COALESCE(data_pagamento, vencimento) >= ?
          GROUP BY dia", [$desde]) as $l) {
        $noDia((string) $l['dia'], 'despesas', (float) $l['total']);
    }
    $brindes = consultar(SQL_BRINDES, [$desde]);
    foreach ($brindes as $l) {
        $noDia((string) $l['dia'], 'despesas', (float) $l['total']);
    }

    foreach (consultar(
        "SELECT substr(data_pagamento, 1, 10) AS dia, tipo, COALESCE(SUM(valor), 0) AS total
           FROM lancamentos WHERE status = 'pago' AND data_pagamento >= ? GROUP BY dia, tipo", [$desde]) as $l) {
        $noDia((string) $l['dia'], $l['tipo'] === 'receber' ? 'recebido' : 'pago', (float) $l['total']);
    }

    ksort($porDia);
    $diario = [];
    foreach ($porDia as $dia => $d) {
        $diario[] = ['dia' => $dia] + arredondar($d);
    }

    // O que mais vendeu: linhas por dia/tipo/origem; a tela corta e agrupa.
    $itens = consultar(
        'SELECT dia, descricao, tipo, origem, SUM(unidades) AS unidades,
                ROUND(SUM(receita), 2) AS receita, ROUND(SUM(custo), 2) AS custo,
                ROUND(SUM(receita) - SUM(custo), 2) AS lucro
           FROM vw_itens_faturados WHERE dia >= ?
          GROUP BY dia, descricao, tipo, origem', [$desde]);

    // Contas a vencer: a janela maior de uma vez; o vencido entra junto.
    $vencendo = consultar(
        "SELECT l.id, l.tipo, l.descricao, l.valor, l.vencimento, l.categoria,
                CAST(julianday(l.vencimento) - julianday(?) AS INTEGER) AS dias,
                COALESCE(c.nome, f.nome) AS quem
           FROM lancamentos l
           LEFT JOIN clientes     c ON c.id = l.cliente_id
           LEFT JOIN fornecedores f ON f.id = l.fornecedor_id
          WHERE l.status = 'pendente' AND l.vencimento IS NOT NULL AND l.vencimento <= ?
          ORDER BY l.vencimento",
        [date('Y-m-d'), date('Y-m-d', strtotime('+' . JANELA_VENCIMENTOS . ' days'))]);

    // Como o cliente pagou: a vw_receitas ja abre o pagamento dividido por forma.
    $pagamentos = consultar(
        'SELECT dia, forma, origem, ROUND(SUM(receita), 2) AS total, SUM(quantidade) AS quantidade
           FROM vw_receitas WHERE dia >= ? GROUP BY dia, forma, origem', [$desde]);

    // Mesmo filtro do DRE: despesa manual e o brinde, numa categoria propria.
    $despesasPorCategoria = consultar(
        "SELECT substr(COALESCE(data_pagamento, vencimento), 1, 10) AS dia,
                COALESCE(NULLIF(TRIM(categoria), ''), 'Sem categoria') AS categoria,
                ROUND(COALESCE(SUM(valor), 0), 2) AS total, COUNT(*) AS quantidade
           FROM lancamentos
          WHERE tipo = 'pagar' AND origem = 'manual' AND status <> 'cancelado'
            AND COALESCE(data_pagamento, vencimento) >= ?
          GROUP BY dia, categoria", [$desde]);
    foreach ($brindes as $l) {
        $despesasPorCategoria[] = ['dia' => $l['dia'], 'categoria' => CATEGORIA_BRINDE,
                                   'total' => $l['total'], 'quantidade' => $l['quantidade']];
    }

    // O que saiu do estoque mas ainda esta dentro de uma OS em andamento.
    $alocado = consultar(
        'SELECT oi.descricao, SUM(oi.quantidade) AS unidades,
                ROUND(SUM(oi.custo_unitario * oi.quantidade), 2) AS custo,
                ROUND(SUM(oi.subtotal), 2) AS cobrado,
                COUNT(DISTINCT oi.os_id) AS ordens, GROUP_CONCAT(DISTINCT o.numero) AS numeros
           FROM os_itens oi
           JOIN ordens_servico o ON o.id = oi.os_id
          WHERE o.status IN (' . vagas(STATUS_OS_EM_ANDAMENTO) . ') AND oi.entrada_id IS NOT NULL
          GROUP BY oi.descricao ORDER BY custo DESC', STATUS_OS_EM_ANDAMENTO);

    // Dinheiro parado na prateleira, por dia de ENTRADA e tipo.
    $estoque = consultar(
        'SELECT substr(data_entrada, 1, 10) AS dia, tipo, SUM(saldo) AS unidades,
                ROUND(SUM(valor_investimento * saldo), 2) AS investido,
                ROUND(SUM(valor_venda        * saldo), 2) AS venda_prevista
           FROM vw_entradas
          WHERE ' . SQL_ESTOQUE_PARADO . '
          GROUP BY dia, tipo');

    return [
        'diario'     => $diario,
        'desde'      => $desde,
        'ate'        => date('Y-m-d'),
        'itens'      => $itens,
        'vencendo'   => $vencendo,
        'estoque'    => $estoque,
        'alocado'    => $alocado,
        'pagamentos' => $pagamentos,
        'despesas_categoria' => $despesasPorCategoria,
    ];
}

/*
 * A tela de entrada do PDV (v8): o dia de hoje, as ultimas OS e, para o
 * admin, a fila da loja online. Todos os perfis: nada de custo nem lucro.
 * "Hoje" e o relogio da loja; venda cancelada nao conta.
 */
function painelDoPdv(array $usuario): array
{
    $hoje = date('Y-m-d');
    $vendas = consultarUm("SELECT COUNT(*) AS q, COALESCE(SUM(valor_total), 0) AS t FROM vendas
                            WHERE status = 'concluida' AND substr(data_venda, 1, 10) = ?", [$hoje]);
    $os = ['prontas' => 0, 'em_andamento' => 0];
    foreach (consultar('SELECT status, COUNT(*) AS q FROM ordens_servico GROUP BY status') as $l) {
        if ($l['status'] === 'pronta') {
            $os['prontas'] = (int) $l['q'];
        }
        if (in_array($l['status'], STATUS_OS_EM_ANDAMENTO, true)) {
            $os['em_andamento'] += (int) $l['q'];
        }
    }
    $ultimas = array_map(function ($o) {
        return ['id' => (int) $o['id'], 'numero' => $o['numero'], 'status' => $o['status'],
                'status_rotulo' => rotuloDe('status_os', $o['status']), 'data_entrada' => $o['data_entrada'],
                'cliente' => $o['cliente'], 'aparelho' => $o['aparelho'],
                'valor' => (float) $o['valor_final'] > 0 ? (float) $o['valor_final'] : (float) $o['valor_orcamento']];
    }, consultar('SELECT os.id, os.numero, os.status, os.data_entrada, os.valor_final, os.valor_orcamento,
                         c.nome AS cliente, ' . sqlNomeAparelho('a') . ' AS aparelho
                    FROM ordens_servico os
                    JOIN clientes c ON c.id = os.cliente_id
                    LEFT JOIN aparelhos a ON a.id = os.aparelho_id
                   ORDER BY os.data_entrada DESC, os.id DESC LIMIT 6'));

    $saida = ['hoje' => $hoje, 'vendas_hoje' => ['quantidade' => (int) $vendas['q'], 'total' => round((float) $vendas['t'], 2)],
              'os' => $os, 'ultimas_os' => $ultimas];
    if ($usuario['perfil'] === 'admin') {
        expirarEncomendas();
        $loja = ['a_pagar' => 0, 'a_enviar' => 0];
        foreach (consultar('SELECT status, COUNT(*) AS q FROM encomendas GROUP BY status') as $l) {
            if ($l['status'] === 'aguardando_pagamento') {
                $loja['a_pagar'] = (int) $l['q'];
            } elseif (in_array($l['status'], ['pago', 'separacao'], true)) {
                $loja['a_enviar'] += (int) $l['q'];
            }
        }
        $saida['loja'] = $loja;
    }
    return $saida;
}
