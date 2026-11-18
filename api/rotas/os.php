<?php
/**
 * api/rotas/os.php - ordens de servico: itens, valores, pagamento dividido,
 * entrega (que gera a venda) e o vaivem de status.
 */

declare(strict_types=1);

/*
 * A REGRA da mao de obra e do valor final - a mesma funcao pura que a tela
 * implementa (Dashboard) e que testes/casos/mao-de-obra.json confere dos
 * dois lados. Entra em reais, conta em centavos inteiros:
 *
 *   mao   = servicos > 0 ? servicos
 *         : (mao_digitada ?? (orcamento > 0 ? max(0, orcamento - pecas) : 0))
 *   final = final_digitado ?? ((pecas + mao) > 0 ? pecas + mao : orcamento)
 *
 * "Digitado" = o campo veio no corpo (POST), ou o valor ja gravado (PUT
 * parcial preserva). null = nao digitado.
 */
function calcularValoresOs(array $e): array
{
    $c = fn ($v) => $v === null ? null : emCentavos($v);
    $orcamento = $c($e['orcamento'] ?? 0) ?? 0;
    $pecas     = $c($e['pecas'] ?? 0) ?? 0;
    $servicos  = $c($e['servicos'] ?? 0) ?? 0;
    $maoDig    = $c($e['mao_digitada'] ?? null);
    $finalDig  = $c($e['final_digitado'] ?? null);

    $mao = $servicos > 0 ? $servicos : ($maoDig ?? ($orcamento > 0 ? max(0, $orcamento - $pecas) : 0));
    $final = $finalDig ?? (($pecas + $mao) > 0 ? $pecas + $mao : $orcamento);
    return ['mao' => $mao / 100, 'final' => $final / 100];
}

/* Os valores da OS a partir do corpo: monta a entrada da regra e aplica. */
function valoresOs(array $corpo, ?array $atual, float $pecas, float $servicos): array
{
    $digitado = function (string $campo, string $rotulo, string $coluna) use ($corpo, $atual): ?float {
        if (array_key_exists($campo, $corpo)) {
            return veio($corpo, $campo) ? dinheiro($corpo, $campo, $rotulo) : null;
        }
        return $atual !== null ? (float) $atual[$coluna] : null;
    };
    $orcamento = $digitado('valor_orcamento', 'Orçamento', 'valor_orcamento') ?? 0.0;
    $v = calcularValoresOs([
        'orcamento' => $orcamento, 'pecas' => $pecas, 'servicos' => $servicos,
        'mao_digitada' => $digitado('valor_mao_obra', 'Mão de obra', 'valor_mao_obra'),
        'final_digitado' => $digitado('valor_final', 'Valor final', 'valor_final'),
    ]);
    conferirTeto($v['final'], 'O valor final da OS');
    return ['orcamento' => $orcamento, 'pecas' => round($pecas, 2), 'mao_obra' => $v['mao'], 'final' => $v['final']];
}

/*
 * A OS como a API devolve. A senha de desbloqueio NAO vai nas listagens;
 * no GET de uma OS so vai enquanto ela esta em andamento.
 */
function sqlOs(): string
{
    return "SELECT os.*, c.nome AS cliente, c.telefone AS cliente_telefone,
                       a.modelo_id AS modelo_id, a.marca AS marca, a.modelo AS modelo, a.imei AS imei,
                       a.cor AS cor, a.senha_aparelho AS senha_aparelho, a.acessorios AS acessorios,
                       " . sqlNomeAparelho('a') . " AS aparelho,
                       (SELECT COUNT(*) FROM lancamentos l
                         WHERE l.status = 'pago' AND l.tipo = 'receber'
                           AND (l.venda_id = os.venda_id OR l.os_id = os.id)) AS pagamentos_recebidos
                  FROM ordens_servico os
                  JOIN clientes c ON c.id = os.cliente_id
                  LEFT JOIN aparelhos a ON a.id = os.aparelho_id";
}

/*
 * O que a tela pode oferecer para esta OS, calculado aqui. Cancelada e
 * final (nenhum status). Entregue com dinheiro ja recebido: sair de
 * "entregue" estornaria o pagamento, e estorno e so do admin.
 */
function permissoesOs(array $o, array $usuario): array
{
    $admin = $usuario['perfil'] === 'admin';
    $recebido = (int) ($o['pagamentos_recebidos'] ?? 0) > 0;
    if ($o['status'] === 'cancelada') {
        $permitidos = [];
    } elseif ($o['status'] === 'entregue' && $recebido && !$admin) {
        $permitidos = ['entregue'];
    } else {
        $permitidos = valoresDe('status_os');
    }
    return $o + [
        'status_permitidos' => $permitidos,
        'pode_cancelar'     => in_array('cancelada', $permitidos, true) && $o['status'] !== 'cancelada',
        'pode_editar_valor' => !in_array($o['status'], ['cancelada', 'entregue'], true),
        'pode_excluir'      => $admin,
    ];
}

function ordens(?int $id, string $metodo, array $corpo, array $usuario): array
{
    if ($metodo === 'GET') {
        if ($id) {
            $item = consultarUm(sqlOs() . ' WHERE os.id = ?', [$id]);
            if (!$item) {
                throw new ErroApi(404, 'Ordem de serviço não encontrada.');
            }
            if (!in_array($item['status'], STATUS_OS_EM_ANDAMENTO, true)) {
                $item['senha_aparelho'] = null;
            }
            $item = permissoesOs($item, $usuario);
            $item['historico'] = consultar('SELECT h.*, u.nome AS usuario_nome FROM os_historico h
                                              LEFT JOIN usuarios u ON u.id = h.usuario_id
                                             WHERE h.os_id = ? ORDER BY h.id', [$id]);
            $item['lista_itens'] = array_map(fn ($l) => semCusto($l, $usuario), itensDaOs($id));
            $item['pagamentos']  = pagamentosDaOs($id);
            return [200, ['ok' => true, 'os' => $item]];
        }
        $itens = consultar(sqlOs() . " ORDER BY CASE os.status WHEN 'entregue' THEN 2 WHEN 'cancelada' THEN 3
                                                          WHEN 'recusada' THEN 3 ELSE 1 END, os.data_entrada DESC");
        return [200, ['ok' => true, 'itens' => array_map(function ($o) use ($usuario) {
            unset($o['senha_aparelho']);
            return permissoesOs($o, $usuario);
        }, $itens)]];
    }

    if ($metodo === 'POST') {
        return criarOs($corpo, $usuario);
    }
    if ($metodo === 'PUT') {
        return atualizarOs($id, $corpo, $usuario);
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        return emTransacao(function () use ($id, $usuario) {
            $alvo = consultarUm('SELECT aparelho_id, venda_id FROM ordens_servico WHERE id = ?', [$id]);
            if (!$alvo) {
                throw new ErroApi(404, 'Ordem de serviço não encontrada.');
            }
            $pecas = array_column(consultar('SELECT entrada_id FROM os_itens WHERE os_id = ?', [$id]), 'entrada_id');
            if ($alvo['venda_id']) {
                desfazerVendaDaOs((int) $alvo['venda_id'], $id, $usuario, 'OS excluída');
            }
            cancelarLancamentos('os_id', $id, 'OS excluída', (int) $usuario['id']);   // fluxo antigo, sem venda
            executarSql('DELETE FROM ordens_servico WHERE id = ?', [$id]);           // itens, pagamentos, historico: CASCADE
            if ($alvo['aparelho_id']
                && (int) consultarUm('SELECT COUNT(*) AS q FROM ordens_servico WHERE aparelho_id = ?', [$alvo['aparelho_id']])['q'] === 0) {
                executarSql('DELETE FROM aparelhos WHERE id = ?', [$alvo['aparelho_id']]);
            }
            conferirImeiNoEstoque($pecas, 'excluir esta OS');
            return [200, ['ok' => true, 'mensagem' => 'Ordem de serviço excluída.']];
        });
    }

    throw new ErroApi(405, 'Método não permitido para /api/os.');
}

/** Itens (pecas e servicos) de uma OS, com o saldo atual da entrada. */
function itensDaOs(int $osId): array
{
    return consultar('SELECT oi.*, e.item AS item_estoque, e.tipo AS item_tipo, e.saldo, sv.nome AS servico_nome
                        FROM os_itens oi
                        LEFT JOIN vw_entradas e  ON e.id  = oi.entrada_id
                        LEFT JOIN servicos    sv ON sv.id = oi.servico_id
                       WHERE oi.os_id = ? ORDER BY oi.id', [$osId]);
}

/*
 * Os itens do corpo sao os gravados? A tela manda a lista inteira a cada
 * Salvar; com a OS travada, lista igual passa e diferente e recusada.
 */
function mesmosItensDaOs(int $osId, array $itens): bool
{
    $comPreco = true;
    foreach ($itens as $i) {
        if (!is_array($i) || !veio($i, 'valor_unitario')) {
            $comPreco = false;
        }
    }
    $chave = function (array $i) use ($comPreco): string {
        $entrada = (int) ($i['entrada_id'] ?? 0);
        $texto   = $entrada ? '' : normalizarNome(is_scalar($i['descricao'] ?? null) ? (string) $i['descricao'] : '');
        $preco   = $comPreco ? (string) emCentavos(lerDinheiro($i['valor_unitario'] ?? null) ?? -1) : '*';
        $qtd     = is_numeric($i['quantidade'] ?? null) ? (string) (0 + $i['quantidade']) : '1';
        return $entrada . '|' . (int) ($i['servico_id'] ?? 0) . '|' . $texto . '|' . $qtd . '|' . $preco;
    };
    $novos = [];
    foreach ($itens as $i) {
        if (!is_array($i)) {
            return false;
        }
        $novos[] = $chave($i);
    }
    $gravados = array_map($chave, consultar('SELECT * FROM os_itens WHERE os_id = ?', [$osId]));
    sort($novos);
    sort($gravados);
    return $novos === $gravados;
}

/* Grava as linhas da OS (ja conferidas) e devolve os totais de pecas e servicos. */
function gravarLinhasDaOs(int $osId, array $linhas): array
{
    $pecas = $servicos = 0.0;
    executarSql('DELETE FROM os_itens WHERE os_id = ?', [$osId]);
    foreach ($linhas as $l) {
        if (empty($l['servico_id'])) {
            $pecas += $l['subtotal'];
        } else {
            $servicos += $l['subtotal'];
        }
        executarSql('INSERT INTO os_itens (os_id, entrada_id, servico_id, descricao, quantidade, valor_unitario, custo_unitario, subtotal)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$osId, $l['entrada_id'], $l['servico_id'] ?? null, $l['descricao'], $l['quantidade'], $l['unitario'], $l['custo'], $l['subtotal']]);
    }
    return ['pecas' => round($pecas, 2), 'servicos' => round($servicos, 2)];
}

function somasDaOs(int $osId): array
{
    $l = consultarUm('SELECT COALESCE(SUM(CASE WHEN servico_id IS NULL THEN subtotal ELSE 0 END), 0) AS pecas,
                             COALESCE(SUM(CASE WHEN servico_id IS NULL THEN 0 ELSE subtotal END), 0) AS servicos
                        FROM os_itens WHERE os_id = ?', [$osId]);
    return ['pecas' => round((float) $l['pecas'], 2), 'servicos' => round((float) $l['servicos'], 2)];
}

/* O aparelho da OS: modelo do catalogo; campo que nao veio continua. */
function aparelhoDaOs(array $corpo, int $clienteId, ?int $aparelhoId): ?int
{
    $modeloId = idDoCatalogo($corpo, 'modelo_id', null);
    if (!$modeloId && txt($corpo, 'modelo_nome')) {
        $modeloId = acharOuCriarModelo(txt($corpo, 'modelo_nome'), txt($corpo, 'marca'), txt($corpo, 'armazenamento'));
    }
    if (!$modeloId) {
        return $aparelhoId;
    }
    $modelo = consultarUm('SELECT * FROM modelos WHERE id = ?', [$modeloId]);
    if (!$modelo) {
        throw new ErroApi(400, 'Modelo informado não existe.');
    }
    if ($aparelhoId) {
        $atual = consultarUm('SELECT * FROM aparelhos WHERE id = ?', [$aparelhoId]);
        executarSql('UPDATE aparelhos SET cliente_id = ?, modelo_id = ?, marca = ?, modelo = ?, cor = ?, imei = ?,
                            senha_aparelho = ?, acessorios = ? WHERE id = ?',
            [$clienteId, $modeloId, $modelo['marca'], $modelo['modelo'], listaOu('cores', $corpo, 'cor', $atual), txtOu($corpo, 'imei', $atual),
             txtOu($corpo, 'senha_aparelho', $atual), txtOu($corpo, 'acessorios', $atual), $aparelhoId]);
        return $aparelhoId;
    }
    executarSql('INSERT INTO aparelhos (cliente_id, modelo_id, marca, modelo, cor, imei, senha_aparelho, acessorios)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$clienteId, $modeloId, $modelo['marca'], $modelo['modelo'], valorDaLista('cores', txt($corpo, 'cor')), txt($corpo, 'imei'),
         txt($corpo, 'senha_aparelho'), txt($corpo, 'acessorios')]);
    return (int) banco()->lastInsertId();
}

/*
 * Senha de desbloqueio e dado sensivel do cliente: ao entregar ou cancelar
 * a OS ela e apagada (se nenhuma outra OS em andamento usa o aparelho).
 * Devolve a frase para o historico, ou ''.
 */
function apagarSenhaDoAparelho(int $osId): string
{
    $os = consultarUm('SELECT o.aparelho_id, a.senha_aparelho FROM ordens_servico o JOIN aparelhos a ON a.id = o.aparelho_id
                        WHERE o.id = ?', [$osId]);
    if (!$os || $os['senha_aparelho'] === null) {
        return '';
    }
    $outras = (int) consultarUm('SELECT COUNT(*) AS q FROM ordens_servico WHERE aparelho_id = ? AND id <> ? AND status IN ('
        . vagas(STATUS_OS_EM_ANDAMENTO) . ')', array_merge([$os['aparelho_id'], $osId], STATUS_OS_EM_ANDAMENTO))['q'];
    if ($outras > 0) {
        return '';
    }
    executarSql('UPDATE aparelhos SET senha_aparelho = NULL WHERE id = ?', [$os['aparelho_id']]);
    return 'Senha do aparelho apagada.';
}

function criarOs(array $corpo, array $usuario): array
{
    $status = txt($corpo, 'status') ?? 'aberta';
    if (!in_array($status, valoresDe('status_os'), true)) {
        throw new ErroApi(400, 'Status inválido: ' . $status);
    }
    $clienteId   = idDoCatalogo($corpo, 'cliente_id', null);
    $clienteNovo = txt($corpo, 'cliente_nome', 'Cliente');
    if (!$clienteId && !$clienteNovo) {
        throw new ErroApi(400, 'Escolha o cliente na lista, ou digite o nome para cadastrar na hora.');
    }
    if ($clienteId) {
        exigirExistente('clientes', $clienteId, 'Cliente informado não existe.');
    }
    if (!idDoCatalogo($corpo, 'modelo_id', null) && !txt($corpo, 'modelo_nome')) {
        throw new ErroApi(400, 'Escolha o modelo do celular (ou cadastre um novo).');
    }
    $itens = $corpo['itens'] ?? [];
    if (!is_array($itens)) {
        throw new ErroApi(400, 'Os itens da OS precisam vir como uma lista.');
    }
    $entrega = dataDoCorpo($corpo, 'data_entrega', 'Data de entrega', true);
    if ($status === 'entregue' && !$entrega) {
        $entrega = agora();
    }
    $entrada  = dataDoCorpo($corpo, 'data_entrada', 'Data de entrada', true) ?? agora();
    $garantia = inteiro($corpo, 'garantia_dias', 'Garantia (dias)', 0, GARANTIA_MAXIMA, GARANTIA_PADRAO);
    [$formaId, $formaNome] = formaDePagamento($corpo);

    return emTransacao(function () use ($corpo, $usuario, $status, $clienteId, $clienteNovo, $itens, $entrega, $entrada,
                                       $garantia, $formaId, $formaNome) {
        if (!$clienteId) {
            $clienteId = acharOuCriarCliente($clienteNovo, txt($corpo, 'cliente_telefone', 'Telefone'));
        }
        $aparelhoId = aparelhoDaOs($corpo, $clienteId, null);
        executarSql(
            'INSERT INTO ordens_servico (numero, cliente_id, aparelho_id, tecnico_id, defeito_relatado, diagnostico,
                 servico_executado, status, valor_orcamento, valor_pecas, valor_mao_obra, valor_final, forma_pagamento,
                 forma_pagamento_id, data_entrada, data_previsao, data_entrega, garantia_dias, observacoes, atualizado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)',
            [proximoNumero('ordens_servico', 'OS', $entrada), $clienteId, $aparelhoId, $usuario['id'],
             txt($corpo, 'defeito_relatado'), txt($corpo, 'diagnostico'), txt($corpo, 'servico_executado'), $status,
             $formaNome, $formaId, $entrada, dataDoCorpo($corpo, 'data_previsao', 'Previsão', true), $entrega, $garantia,
             txt($corpo, 'observacoes'), carimbo()]);
        $osId = (int) banco()->lastInsertId();

        $linhas = prepararItensDeSaida($itens);
        $somas  = gravarLinhasDaOs($osId, $linhas);
        $v      = valoresOs($corpo, null, $somas['pecas'], $somas['servicos']);
        executarSql('UPDATE ordens_servico SET valor_orcamento = ?, valor_pecas = ?, valor_mao_obra = ?, valor_final = ? WHERE id = ?',
            [$v['orcamento'], $v['pecas'], $v['mao_obra'], $v['final'], $osId]);
        if (array_key_exists('pagamentos', $corpo)) {
            gravarPagamentosDaOs($osId, conferirPagamentos($corpo['pagamentos'], $v['final']));
        }
        $nota = in_array($status, STATUS_OS_APAGA_SENHA, true) ? apagarSenhaDoAparelho($osId) : '';
        registrarHistorico($osId, (int) $usuario['id'], null, $status, trim('Ordem de serviço criada. ' . $nota));
        conferirSaldos(array_column($linhas, 'entrada_id'));
        if ($status === 'entregue') {
            gerarVendaDaOs($osId, $usuario);
        }
        $versao = consultarUm('SELECT atualizado_em FROM ordens_servico WHERE id = ?', [$osId])['atualizado_em'];
        return [201, ['ok' => true, 'id' => $osId, 'atualizado_em' => $versao, 'mensagem' => 'Ordem de serviço criada.']];
    });
}

/*
 * Entregar a OS gera a venda dela (a peca volta a prateleira na view e sai
 * pela venda). A venda fecha EXATAMENTE com o valor final: abaixo da soma
 * vira desconto; acima vira a linha "Acrescimo"; lancamentos por forma com
 * o centavo na ultima. Valor final 0 (garantia, cortesia) NAO gera venda:
 * as pecas ja saem pela propria OS - a mesma regra da venda de balcao, que
 * nao aceita total 0.
 */
function gerarVendaDaOs(int $osId, array $usuario): ?int
{
    $os = consultarUm('SELECT * FROM ordens_servico WHERE id = ?', [$osId]);
    if (!$os || $os['venda_id']) {
        return $os['venda_id'] ?? null;
    }
    $total = round((float) $os['valor_final'], 2);
    if ($total <= 0) {
        return null;
    }
    $itens   = consultar('SELECT * FROM os_itens WHERE os_id = ? ORDER BY id', [$osId]);
    $maoObra = round((float) $os['valor_mao_obra'], 2);
    $nome    = $os['numero'] ?? ('OS #' . $osId);

    $linhas = [];
    $temServico = false;
    foreach ($itens as $i) {
        $linhas[] = ['entrada_id' => $i['entrada_id'], 'descricao' => $i['descricao'], 'quantidade' => (int) $i['quantidade'],
                     'unitario' => (float) $i['valor_unitario'], 'custo' => (float) $i['custo_unitario'], 'subtotal' => (float) $i['subtotal']];
        $temServico = $temServico || !empty($i['servico_id']);
    }
    // Com servicos lancados, a mao de obra JA esta nos itens.
    $linhaAvulsa = fn (string $texto, float $valor) => ['entrada_id' => null, 'descricao' => $texto, 'quantidade' => 1,
                                                       'unitario' => $valor, 'custo' => 0.0, 'subtotal' => $valor];
    if ($maoObra > 0 && !$temServico) {
        $linhas[] = $linhaAvulsa('Mão de obra — ' . $nome, $maoObra);
    }
    $bruto = round(array_sum(array_column($linhas, 'subtotal')), 2);
    if ($total > $bruto) {
        $linhas[] = $linhaAvulsa(($bruto > 0 ? 'Acréscimo no valor final — ' : 'Serviço — ') . $nome, round($total - $bruto, 2));
        $bruto = $total;
    }
    $data = $os['data_entrega'] ?: agora();
    $vendaId = gravarVenda(['cliente_id' => $os['cliente_id'], 'usuario_id' => $usuario['id'], 'bruto' => $bruto,
        'desconto' => round($bruto - $total, 2), 'total' => $total,
        'custo' => round(array_sum(array_map(fn ($l) => $l['custo'] * $l['quantidade'], $linhas)), 2),
        'forma' => $os['forma_pagamento'], 'forma_id' => $os['forma_pagamento_id'] ?? null, 'parcelas' => 1,
        'data' => $data, 'observacoes' => 'Gerada pela ' . $nome], $linhas);
    executarSql('UPDATE ordens_servico SET venda_id = ? WHERE id = ?', [$vendaId, $osId]);
    conferirSaldos(array_column($linhas, 'entrada_id'));

    // A conta a receber e da venda: uma por forma do pagamento dividido.
    // "Como o cliente pagou" e o que ele pagou na entrega: forma que nao e a
    // prazo, em 1 parcela, nasce paga - o "Ja recebi" da venda de balcao.
    // A prazo (fiado, boleto) e parcelado ficam pendentes. Sem pagamento
    // informado, ninguem disse que recebeu: fica pendente.
    $clienteId = $os['cliente_id'] === null ? null : (int) $os['cliente_id'];
    $dia = substr((string) $data, 0, 10);
    $formas = pagamentosDaOs($osId);
    if ($formas) {
        // OS antiga pode somar 99,99: a sobra vai para a ultima forma.
        $sobra = emCentavos($total) - array_sum(array_map(fn ($p) => emCentavos($p['valor']), $formas));
        $ultima = count($formas) - 1;
        foreach ($formas as $k => $p) {
            $parcelas = max(1, (int) $p['parcelas']);
            gerarLancamentosDaVenda($vendaId, (emCentavos($p['valor']) + ($k === $ultima ? $sobra : 0)) / 100,
                $parcelas, $p['forma'], $p['forma_pagamento_id'] === null ? null : (int) $p['forma_pagamento_id'],
                $clienteId, $dia, (int) $usuario['id'], $parcelas === 1 && $p['forma_tipo'] !== 'prazo');
        }
    } else {
        gerarLancamentosDaVenda($vendaId, $total, 1, $os['forma_pagamento'],
            $os['forma_pagamento_id'] === null ? null : (int) $os['forma_pagamento_id'], $clienteId, $dia, (int) $usuario['id'], false);
    }
    return $vendaId;
}

/*
 * Desfaz a venda de uma OS (saiu de "entregue" ou foi excluida): contas
 * canceladas (a paga e estorno - so admin), celular de volta a prateleira,
 * itens por CASCADE.
 */
function desfazerVendaDaOs(int $vendaId, int $osId, array $usuario, string $motivo): void
{
    $recebido = (int) consultarUm("SELECT COUNT(*) AS q FROM lancamentos WHERE venda_id = ? AND status = 'pago'", [$vendaId])['q'];
    if ($recebido > 0 && $usuario['perfil'] !== 'admin') {
        throw new ErroApi(403, 'Esta OS já foi paga pelo cliente: tirar de "entregue" estornaria o pagamento. '
            . 'Só o administrador pode fazer isso.');
    }
    cancelarLancamentos('venda_id', $vendaId, $motivo, (int) $usuario['id']);
    devolverCelularesAPrateleira($vendaId, $motivo === 'OS excluída' ? 'excluir esta OS' : 'tirar esta OS de "entregue"');
    executarSql('UPDATE ordens_servico SET venda_id = NULL WHERE id = ?', [$osId]);
    executarSql('DELETE FROM vendas WHERE id = ?', [$vendaId]);
}

function atualizarOs(?int $id, array $corpo, array $usuario): array
{
    $id = exigirId($id);
    return emTransacao(function () use ($id, $corpo, $usuario) {
        $atual = consultarUm('SELECT * FROM ordens_servico WHERE id = ?', [$id]);
        if (!$atual) {
            throw new ErroApi(404, 'Ordem de serviço não encontrada.');
        }
        // Versao: a tela devolve o atualizado_em que leu; diferente = 409.
        $versao = $corpo['atualizado_em'] ?? null;
        if ($versao !== null && $versao !== '' && (string) $versao !== (string) $atual['atualizado_em']) {
            throw new ErroApi(409, 'Esta OS foi alterada por outra pessoa depois que você abriu. Nada foi gravado. Use Recarregar e confira.');
        }
        $status = txt($corpo, 'status') ?? $atual['status'];
        if (!in_array($status, valoresDe('status_os'), true)) {
            throw new ErroApi(400, 'Status inválido: ' . $status);
        }
        $mudouStatus = $status !== $atual['status'];
        if ($atual['status'] === 'cancelada' && $mudouStatus) {
            throw new ErroApi(400, 'OS cancelada não pode ser reaberta. Abra uma nova ordem de serviço.');
        }

        $itensMudaram = false;
        if (array_key_exists('itens', $corpo)) {
            if (!is_array($corpo['itens'])) {
                throw new ErroApi(400, 'Os itens da OS precisam vir como uma lista.');
            }
            $itensMudaram = !mesmosItensDaOs($id, $corpo['itens']);
        }
        if ($itensMudaram) {
            if ($atual['status'] === 'cancelada') {
                throw new ErroApi(400, 'OS cancelada não pode ser alterada.');
            }
            if (in_array($atual['status'], STATUS_OS_ITENS_TRAVADOS, true) && in_array($status, STATUS_OS_ITENS_TRAVADOS, true)) {
                throw new ErroApi(400, 'Com a OS "' . rotuloDe('status_os', $atual['status']) . '" as peças e os serviços ficam '
                    . 'travados. Volte o status para "Em reparo" para mexer nos itens.');
            }
        }

        // Saiu de "entregue": a venda gerada e desfeita ANTES de mexer nos itens.
        if ($atual['status'] === 'entregue' && $status !== 'entregue' && $atual['venda_id']) {
            desfazerVendaDaOs((int) $atual['venda_id'], $id, $usuario, 'OS reaberta');
            $atual['venda_id'] = null;
        }
        // Cancelar/recusar OS antiga com conta ja recebida tambem e estorno.
        if (in_array($status, STATUS_OS_SEM_BAIXA, true) && $mudouStatus && $usuario['perfil'] !== 'admin'
            && consultarUm("SELECT id FROM lancamentos WHERE os_id = ? AND status = 'pago'", [$id])) {
            throw new ErroApi(403, 'Esta OS já foi paga pelo cliente: cancelar estornaria o pagamento. Só o administrador pode fazer isso.');
        }

        $antigas = array_column(consultar('SELECT entrada_id FROM os_itens WHERE os_id = ?', [$id]), 'entrada_id');
        $novas = [];
        if ($itensMudaram) {
            // Se a OS segura as pecas dela (a regra e da vw_saidas_estoque), elas voltam para a conta.
            $linhas = prepararItensDeSaida($corpo['itens'], $id);
            $somas  = gravarLinhasDaOs($id, $linhas);
            $novas  = array_column($linhas, 'entrada_id');
        } else {
            $somas = somasDaOs($id);
        }

        $v = valoresOs($corpo, $atual, $somas['pecas'], $somas['servicos']);
        $mudouValor = emCentavos($v['final']) !== emCentavos($atual['valor_final'])
            || emCentavos($v['mao_obra']) !== emCentavos($atual['valor_mao_obra'])
            || emCentavos($v['orcamento']) !== emCentavos($atual['valor_orcamento']);
        if ($mudouValor && in_array($atual['status'], ['cancelada', 'entregue'], true) && $status === $atual['status']) {
            throw new ErroApi(400, $atual['status'] === 'entregue'
                ? 'OS entregue já virou venda: os valores não mudam. Volte o status (a venda é desfeita) e entregue de novo.'
                : 'OS cancelada não pode ser alterada.');
        }

        // Pagamento dividido: qualquer mudanca do valor final confere de novo o gravado.
        if (array_key_exists('pagamentos', $corpo)) {
            $prontas = conferirPagamentos($corpo['pagamentos'], $v['final']);
            if ($atual['status'] === 'entregue' && $status === 'entregue' && !mesmosPagamentos($id, $prontas)) {
                throw new ErroApi(400, 'OS entregue já gerou as contas a receber: o pagamento não muda. '
                    . 'Volte o status (a venda é desfeita) e entregue de novo.');
            }
            gravarPagamentosDaOs($id, $prontas);
        } elseif (emCentavos($v['final']) !== emCentavos($atual['valor_final'])) {
            $gravado = consultarUm('SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS soma FROM os_pagamentos WHERE os_id = ?', [$id]);
            if ((int) $gravado['n'] > 0 && abs(emCentavos($gravado['soma']) - emCentavos($v['final'])) > emCentavos(TOLERANCIA_CENTAVO)) {
                throw new ErroApi(400, sprintf('O valor final mudou de %s para %s, e o pagamento dividido gravado soma %s. '
                    . 'Refaça a divisão do pagamento antes de salvar.',
                    moedaBr((float) $atual['valor_final']), moedaBr($v['final']), moedaBr((float) $gravado['soma'])));
            }
        }

        // Cliente: sem escolha nova e sem nome digitado, fica o que estava.
        $clienteId = veio($corpo, 'cliente_id') ? idDoCatalogo($corpo, 'cliente_id', null) : null;
        $clienteNovo = txt($corpo, 'cliente_nome', 'Cliente');
        if (!$clienteId && !$clienteNovo) {
            $clienteId = (int) $atual['cliente_id'];
        }
        if ($clienteId) {
            exigirExistente('clientes', $clienteId, 'Cliente informado não existe.');
        } else {
            $clienteId = acharOuCriarCliente($clienteNovo, txt($corpo, 'cliente_telefone', 'Telefone'));
        }
        $aparelhoId = aparelhoDaOs($corpo, $clienteId, $atual['aparelho_id'] ? (int) $atual['aparelho_id'] : null);
        [$formaId, $formaNome] = formaDePagamento($corpo, $atual);

        $entrega = dataDoCorpo($corpo, 'data_entrega', 'Data de entrega', true) ?? $atual['data_entrega'];
        if ($status === 'entregue' && $mudouStatus && !array_key_exists('data_entrega', $corpo)) {
            $entrega = agora();
        }
        $garantia = inteiro($corpo, 'garantia_dias', 'Garantia (dias)', 0, GARANTIA_MAXIMA, (int) $atual['garantia_dias']);
        $previsao = array_key_exists('data_previsao', $corpo) ? dataDoCorpo($corpo, 'data_previsao', 'Previsão', true) : $atual['data_previsao'];

        executarSql(
            'UPDATE ordens_servico
                SET cliente_id = ?, aparelho_id = ?, defeito_relatado = ?, diagnostico = ?, servico_executado = ?, status = ?,
                    valor_orcamento = ?, valor_pecas = ?, valor_mao_obra = ?, valor_final = ?, forma_pagamento = ?,
                    forma_pagamento_id = ?, data_previsao = ?, data_entrega = ?, garantia_dias = ?, observacoes = ?, atualizado_em = ?
              WHERE id = ?',
            [$clienteId, $aparelhoId, txtOu($corpo, 'defeito_relatado', $atual), txtOu($corpo, 'diagnostico', $atual),
             txtOu($corpo, 'servico_executado', $atual), $status, $v['orcamento'], $v['pecas'], $v['mao_obra'], $v['final'],
             $formaNome, $formaId, $previsao, $entrega, $garantia, txtOu($corpo, 'observacoes', $atual), carimbo(), $id]);

        if ($mudouStatus) {
            $nota = in_array($status, STATUS_OS_APAGA_SENHA, true) ? apagarSenhaDoAparelho($id) : '';
            $comentario = trim((txt($corpo, 'comentario') ?? '') . ' ' . $nota);
            registrarHistorico($id, (int) $usuario['id'], $atual['status'], $status, $comentario === '' ? null : $comentario);
            if ($status === 'entregue') {
                gerarVendaDaOs($id, $usuario);
            }
            if (in_array($status, STATUS_OS_SEM_BAIXA, true)) {
                cancelarLancamentos('os_id', $id, 'OS ' . $status, (int) $usuario['id']);
            }
        }
        // Ultima barreira (inclui "recusada -> em reparo" com a peca ja vendida).
        conferirSaldos(array_merge($antigas, $novas),
            'A peça desta OS já foi usada em outro lugar; troque o item ou dê entrada de mais unidades.');
        conferirImeiNoEstoque(array_merge($antigas, $novas), 'salvar esta OS');

        $novaVersao = consultarUm('SELECT atualizado_em FROM ordens_servico WHERE id = ?', [$id])['atualizado_em'];
        return [200, ['ok' => true, 'atualizado_em' => $novaVersao, 'mensagem' => 'Ordem de serviço atualizada.']];
    });
}

function registrarHistorico(int $osId, int $usuarioId, ?string $de, string $para, ?string $comentario): void
{
    executarSql('INSERT INTO os_historico (os_id, usuario_id, status_de, status_para, comentario) VALUES (?, ?, ?, ?, ?)',
        [$osId, $usuarioId, $de, $para, $comentario]);
}

// ------------------------------------------------------------------
// Pagamento dividido da OS
// ------------------------------------------------------------------
function pagamentosDaOs(int $osId): array
{
    return consultar('SELECT p.*, COALESCE(f.nome, p.forma_pagamento) AS forma, f.tipo AS forma_tipo FROM os_pagamentos p
                        LEFT JOIN formas_pagamento f ON f.id = p.forma_pagamento_id
                       WHERE p.os_id = ? ORDER BY p.id', [$osId]);
}

/*
 * Le as linhas de pagamento, confere e devolve prontas. A soma TEM de
 * bater com o valor final (um centavo de folga, que vai para a ultima
 * linha - a soma gravada fica exata).
 */
function conferirPagamentos($linhas, float $valorFinal): array
{
    if (!is_array($linhas)) {
        throw new ErroApi(400, 'Os pagamentos da OS precisam vir como uma lista de valores e formas.');
    }
    $prontas = [];
    $soma = 0;
    foreach ($linhas as $linha) {
        if (!is_array($linha)) {
            throw new ErroApi(400, 'Cada pagamento precisa ter forma e valor.');
        }
        $formaId = idDoCatalogo($linha, 'forma_pagamento_id', null);
        $valor = dinheiro($linha, 'valor', 'Valor do pagamento', 0.0);
        if ($valor <= 0) {
            // Forma escolhida sem valor nao some em silencio: o Pix escolhido
            // e esquecido sem o valor era um pagamento que ninguem registrou.
            if ($formaId) {
                throw new ErroApi(400, 'Informe o valor de cada forma de pagamento escolhida.');
            }
            continue;   // linha toda em branco na tela
        }
        if (!$formaId) {
            throw new ErroApi(400, 'Escolha a forma de pagamento de cada valor lançado.');
        }
        $forma = consultarUm('SELECT nome FROM formas_pagamento WHERE id = ?', [$formaId]);
        if (!$forma) {
            throw new ErroApi(400, 'Forma de pagamento informada não existe.');
        }
        $parcelas = inteiro($linha, 'parcelas', 'Parcelas', 1, PARCELAS_MAX, 1);
        conferirParcelamento($valor, $parcelas, false);
        $soma += emCentavos($valor);
        $prontas[] = ['forma_pagamento_id' => $formaId, 'forma_pagamento' => $forma['nome'], 'valor' => $valor, 'parcelas' => $parcelas];
    }
    if (!$prontas) {
        return [];
    }
    $diferenca = emCentavos($valorFinal) - $soma;
    if (abs($diferenca) > emCentavos(TOLERANCIA_CENTAVO)) {
        throw new ErroApi(400, sprintf('Os pagamentos somam %s e o valor final da OS é %s. A diferença é de %s - ajuste os valores até fechar.',
            moedaBr($soma / 100), moedaBr($valorFinal), moedaBr(abs($diferenca) / 100)));
    }
    if ($diferenca !== 0) {
        $ultima = count($prontas) - 1;
        $prontas[$ultima]['valor'] = round($prontas[$ultima]['valor'] + $diferenca / 100, 2);
    }
    return $prontas;
}

function mesmosPagamentos(int $osId, array $prontas): bool
{
    $chave = fn ($p) => (int) $p['forma_pagamento_id'] . '|' . emCentavos($p['valor']) . '|' . (int) $p['parcelas'];
    $gravadas = array_map($chave, pagamentosDaOs($osId));
    $novas = array_map($chave, $prontas);
    sort($gravadas);
    sort($novas);
    return $gravadas === $novas;
}

/*
 * Grava a divisao. As colunas de forma da OS guardam a PRIMEIRA forma, para
 * as telas antigas; a verdade inteira esta em os_pagamentos.
 */
function gravarPagamentosDaOs(int $osId, array $prontas): void
{
    executarSql('DELETE FROM os_pagamentos WHERE os_id = ?', [$osId]);
    if ($prontas) {
        executarSql('UPDATE ordens_servico SET forma_pagamento = ?, forma_pagamento_id = ? WHERE id = ?',
            [$prontas[0]['forma_pagamento'], $prontas[0]['forma_pagamento_id'], $osId]);
    }
    foreach ($prontas as $p) {
        executarSql('INSERT INTO os_pagamentos (os_id, forma_pagamento_id, forma_pagamento, valor, parcelas) VALUES (?, ?, ?, ?, ?)',
            [$osId, $p['forma_pagamento_id'], $p['forma_pagamento'], $p['valor'], $p['parcelas']]);
    }
}
