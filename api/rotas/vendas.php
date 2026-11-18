<?php
/**
 * api/rotas/vendas.php - saida de estoque (regra comum a venda e OS) e
 * vendas: criar, editar (desconto, forma, cliente, cancelar) e excluir.
 */

declare(strict_types=1);

// ------------------------------------------------------------------
// Saida de estoque (venda e OS usam a mesma regra)
// ------------------------------------------------------------------
/* Le e confere UMA linha (do estoque ou avulsa). Saldo: prepararItensDeSaida. */
function itemDeSaida(array $item): array
{
    $entradaId  = idDoCatalogo($item, 'entrada_id', null);
    $quantidade = inteiro($item, 'quantidade', 'Quantidade', 1, QUANTIDADE_MAXIMA, 1);

    if (!$entradaId) {
        $descricao = txt($item, 'descricao', 'Descrição') ?? '';
        if ($descricao === '') {
            throw new ErroApi(400, 'Todo item precisa de uma entrada do estoque ou de uma descrição.');
        }
        $servicoId = idDoCatalogo($item, 'servico_id', null);
        $tabela = null;
        if ($servicoId) {
            exigirExistente('servicos', $servicoId, 'Serviço informado não existe.');
            $tabela = (float) consultarUm('SELECT valor_padrao FROM servicos WHERE id = ?', [$servicoId])['valor_padrao'];
        }
        return ['entrada_id' => null, 'servico_id' => $servicoId, 'descricao' => $descricao, 'quantidade' => $quantidade,
                'unitario' => dinheiro($item, 'valor_unitario', 'Preço', 0.0),
                'tabela' => $tabela,   // o preco do cadastro do servico (regra venda.alterar_preco_balcao)
                'custo' => dinheiro($item, 'custo_unitario', 'Custo', 0.0), 'item' => $descricao];
    }

    $entrada = consultarUm('SELECT * FROM vw_entradas WHERE id = ?', [$entradaId]);
    if (!$entrada) {
        throw new ErroApi(400, 'Item do estoque não encontrado (entrada #' . $entradaId . ').');
    }
    if ($entrada['tipo'] === 'celular' && $quantidade > 1) {
        throw new ErroApi(400, 'Celular é unitário: "' . $entrada['item'] . '" sai com quantidade 1.');
    }
    return ['entrada_id' => $entradaId, 'servico_id' => null,
            'descricao' => txt($item, 'descricao', 'Descrição') ?? (string) $entrada['item'],
            'quantidade' => $quantidade,
            'unitario' => dinheiro($item, 'valor_unitario', 'Preço', (float) $entrada['valor_venda']),
            // O preco cadastrado (regra venda.alterar_preco_balcao); sem preco de venda, a tela sugere o custo.
            'tabela' => (float) $entrada['valor_venda'] > 0 ? (float) $entrada['valor_venda'] : (float) $entrada['valor_investimento'],
            'custo' => (float) $entrada['valor_investimento'],
            'item' => (string) $entrada['item'], 'saldo' => (int) $entrada['saldo']];
}

/*
 * Confere TODAS as linhas antes de gravar, e o saldo pela SOMA das linhas
 * de cada entrada (linha por linha, 1 + 1 com saldo 1 passava). A OS em
 * edicao ($osEmEdicao) devolve para a conta as pecas que ela SEGURA hoje -
 * e quem diz se segura e a vw_saidas_estoque (a mesma regra do saldo).
 */
function prepararItensDeSaida(array $itens, ?int $osEmEdicao = null): array
{
    $linhas = [];
    $pedido = [];
    $info   = [];
    foreach ($itens as $item) {
        if (!is_array($item)) {
            throw new ErroApi(400, 'Cada item precisa ter uma entrada do estoque ou uma descrição.');
        }
        $linha = itemDeSaida($item);
        $linha['subtotal'] = round($linha['unitario'] * $linha['quantidade'], 2);
        if ($linha['entrada_id']) {
            $e = $linha['entrada_id'];
            $pedido[$e] = ($pedido[$e] ?? 0) + $linha['quantidade'];
            $info[$e]   = [$linha['item'], $linha['saldo']];
        }
        $linhas[] = $linha;
    }
    foreach ($pedido as $entradaId => $quantidade) {
        [$nome, $disponivel] = $info[$entradaId];
        if ($osEmEdicao !== null) {
            $disponivel += (int) consultarUm(
                "SELECT COALESCE(SUM(quantidade), 0) AS q FROM vw_saidas_estoque WHERE origem = 'os' AND entrada_id = ? AND os_id = ?",
                [$entradaId, $osEmEdicao])['q'];
        }
        // v8: o que uma encomenda da loja online segura (aguardando pagamento) nao sai pelo balcao.
        $reservado = reservadoNaLoja((int) $entradaId);
        if ($quantidade > $disponivel - $reservado) {
            throw new ErroApi(400, 'Saldo insuficiente de "' . $nome . '": pedido ' . $quantidade . ', disponível '
                . max(0, $disponivel - $reservado) . '.' . ($reservado > 0
                    ? ' ' . $reservado . ' unidade(s) estão reservadas por encomenda da loja online aguardando pagamento.' : ''));
        }
    }
    return $linhas;
}

/* Numero do documento: PREFIXO-AAAA-NNNN, sequencia por ano. */
function proximoNumero(string $tabela, string $prefixo, ?string $data = null): string
{
    if (!in_array($tabela, ['vendas', 'ordens_servico', 'pedidos', 'encomendas'], true)) {
        throw new LogicException('Tabela sem numeracao: ' . $tabela);
    }
    $inicio = $prefixo . '-' . substr($data ?? agora(), 0, 4) . '-';
    $linha  = consultarUm('SELECT COALESCE(MAX(CAST(substr(numero, ?) AS INTEGER)), 0) AS ultimo FROM "' . $tabela . '" WHERE numero LIKE ?',
                          [strlen($inicio) + 1, $inicio . '%']);
    return $inicio . str_pad((string) ((int) $linha['ultimo'] + 1), 4, '0', STR_PAD_LEFT);
}

/*
 * Grava uma venda e as linhas dela: o UNICO INSERT de venda do sistema
 * (venda de balcao e venda gerada pela OS). Tira da prateleira o celular
 * vendido. Quem chama confere o saldo DEPOIS de ligar tudo (na OS, so
 * depois de a OS apontar para a venda - antes disso a peca conta duas vezes).
 */
function gravarVenda(array $v, array $linhas): int
{
    executarSql(
        'INSERT INTO vendas (numero, cliente_id, usuario_id, valor_bruto, desconto, valor_total, custo_total,
                             forma_pagamento, forma_pagamento_id, parcelas, status, data_venda, observacoes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [proximoNumero('vendas', 'VD', $v['data']), $v['cliente_id'], $v['usuario_id'], $v['bruto'], $v['desconto'],
         $v['total'], $v['custo'], $v['forma'], $v['forma_id'], $v['parcelas'], 'concluida', $v['data'], $v['observacoes']]);
    $vendaId = (int) banco()->lastInsertId();
    foreach ($linhas as $l) {
        executarSql(
            'INSERT INTO venda_itens (venda_id, entrada_id, descricao, quantidade, valor_unitario, custo_unitario, subtotal)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$vendaId, $l['entrada_id'], $l['descricao'], $l['quantidade'], $l['unitario'], $l['custo'], $l['subtotal']]);
    }
    tirarCelularesDaPrateleira($vendaId, $v['data']);
    return $vendaId;
}

// ------------------------------------------------------------------
// Vendas
// ------------------------------------------------------------------
const SQL_VENDA = "SELECT v.*, o.numero AS os_numero, o.id AS os_id,
                          (SELECT COUNT(*) FROM lancamentos l
                            WHERE l.venda_id = v.id AND l.tipo = 'receber' AND l.status = 'pago') AS parcelas_pagas
                     FROM vw_vendas v
                     LEFT JOIN ordens_servico o ON o.venda_id = v.id";

/*
 * O que a tela pode oferecer para esta venda, calculado aqui (a tela so
 * le). Cancelar venda ja recebida e estorno: so admin.
 */
function permissoesVenda(array $v, array $usuario): array
{
    $admin = $usuario['perfil'] === 'admin';
    $deOs = !empty($v['os_id']);
    $concluida = $v['status'] === 'concluida';
    $paga = (int) ($v['parcelas_pagas'] ?? 0) > 0;
    return $v + [
        'pode_editar_valor' => $concluida && !$deOs,
        'pode_cancelar'     => $concluida && !$deOs && (!$paga || $admin),
        'pode_excluir'      => $admin && !$deOs,
    ];
}

/* Custo e lucro sao do dono: tecnico e balcao nao recebem. */
function semCusto(array $linha, array $usuario, array $campos = ['custo_total', 'lucro', 'custo_unitario']): array
{
    if ($usuario['perfil'] !== 'admin') {
        foreach ($campos as $c) {
            unset($linha[$c]);
        }
    }
    return $linha;
}

function vendas(?int $id, string $metodo, array $corpo, array $usuario): array
{
    if ($metodo === 'GET') {
        $preparar = fn (array $v) => semCusto(permissoesVenda($v, $usuario), $usuario);
        if ($id) {
            $venda = consultarUm(SQL_VENDA . ' WHERE v.id = ?', [$id]);
            if (!$venda) {
                throw new ErroApi(404, 'Venda não encontrada.');
            }
            $venda = $preparar($venda);
            $venda['lista_itens'] = array_map(fn ($l) => semCusto($l, $usuario),
                consultar('SELECT * FROM venda_itens WHERE venda_id = ? ORDER BY id', [$id]));
            $venda['lancamentos'] = array_map(fn ($l) => permissoesLancamento($l, $usuario),
                consultar('SELECT * FROM lancamentos WHERE venda_id = ? ORDER BY parcela, id', [$id]));
            return [200, ['ok' => true, 'venda' => $venda]];
        }
        return [200, ['ok' => true, 'itens' => array_map($preparar, consultar(SQL_VENDA . ' ORDER BY v.data_venda DESC, v.id DESC'))]];
    }

    if ($metodo === 'POST') {
        return criarVenda($corpo, $usuario);
    }
    if ($metodo === 'PUT') {
        return atualizarVenda($id, $corpo, $usuario);
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        return emTransacao(function () use ($id, $usuario) {
            if (!consultarUm('SELECT id FROM vendas WHERE id = ?', [$id])) {
                throw new ErroApi(404, 'Venda não encontrada.');
            }
            $osLigada = consultarUm('SELECT id, numero FROM ordens_servico WHERE venda_id = ?', [$id]);
            if ($osLigada) {
                $nome = $osLigada['numero'] ?: ('OS #' . $osLigada['id']);
                throw new ErroApi(400, "Esta venda foi gerada pela {$nome} e não pode ser excluída sozinha. "
                    . 'Para tirar o faturamento, mude o status da OS de "entregue" para outro: a venda sai junto e a '
                    . 'peça volta a ficar reservada na ordem. Para a peça voltar para a prateleira, exclua a OS.');
            }
            $encomenda = consultarUm('SELECT numero FROM encomendas WHERE venda_id = ?', [$id]);
            if ($encomenda) {
                throw new ErroApi(400, 'Esta venda veio da encomenda ' . $encomenda['numero'] . ' da loja online e não pode ser '
                    . 'excluída. Para desfazer, cancele a encomenda em Loja online: a venda é cancelada junto e o cliente vê no rastreio.');
            }
            // Conta vira 'cancelado' (nunca apagada) e o celular volta a prateleira.
            cancelarLancamentos('venda_id', $id, 'venda excluída', (int) $usuario['id']);
            devolverCelularesAPrateleira($id, 'excluir esta venda');
            executarSql('DELETE FROM vendas WHERE id = ?', [$id]);
            return [200, ['ok' => true, 'mensagem' => 'Venda excluída e itens devolvidos ao estoque.']];
        });
    }

    throw new ErroApi(405, 'Método não permitido para /api/vendas.');
}

/* Parcelas inteiras de 1 a PARCELAS_MAX, nenhuma abaixo de R$ 0,01, e "a vista" so com 1. */
function conferirParcelamento(float $total, int $parcelas, bool $pago): void
{
    if ($pago && $parcelas > 1) {
        throw new ErroApi(400, '"Já recebi à vista" vale só para pagamento em 1 parcela. Parcelado, cada '
            . 'parcela fica a receber e recebe baixa no Financeiro quando for paga.');
    }
    if (intdiv(emCentavos($total), $parcelas) < 1) {
        throw new ErroApi(400, sprintf('%s em %d parcelas daria parcela menor que R$ 0,01. Diminua o número de parcelas.',
            moedaBr($total), $parcelas));
    }
}

/*
 * As regras por chave que valem para a venda (Admin > Regras; valores em
 * api/rotas/admin.php). "Cliente obrigatorio" vale para todos; as outras
 * limitam balcao e tecnico - o administrador nao tem limite. Sao conferidas
 * AQUI, no servidor: a tela so mostra o limite para ninguem ser pego de
 * surpresa. $linhas null = edicao (os itens nao mudam depois de gravados).
 */
function conferirRegrasDaVenda(array $usuario, float $bruto, float $desconto, ?int $clienteId, ?int $formaId, ?array $linhas): void
{
    if (!$clienteId && chaveLigada('venda.exigir_cliente')) {
        throw new ErroApi(400, 'Escolha o cliente: nesta loja toda venda é feita com o cliente identificado.');
    }
    if ($usuario['perfil'] === 'admin') {
        return;
    }
    $maximo = chaveNumero('venda.desconto_maximo_balcao');
    if ($maximo < 100 && emCentavos($desconto) > emCentavos($bruto * $maximo / 100)) {
        throw new ErroApi(403, sprintf('Desconto acima do permitido para o seu perfil: até %d%%, ou seja, %s nesta venda. '
            . 'Para mais, peça a um administrador.', $maximo, moedaBr(round($bruto * $maximo / 100, 2))));
    }
    if ($formaId && !chaveLigada('venda.prazo_balcao')
        && (consultarUm('SELECT tipo FROM formas_pagamento WHERE id = ?', [$formaId])['tipo'] ?? null) === 'prazo') {
        throw new ErroApi(403, 'Venda a prazo (fiado, boleto) só com o administrador nesta loja.');
    }
    if ($linhas !== null && !chaveLigada('venda.alterar_preco_balcao')) {
        foreach ($linhas as $l) {
            if (!$l['entrada_id'] && empty($l['servico_id'])) {
                throw new ErroApi(403, 'Item fora do estoque e fora do cadastro de serviços (avulso) só o administrador lança nesta loja.');
            }
            if (emCentavos($l['unitario']) !== emCentavos($l['tabela'])) {
                throw new ErroApi(403, sprintf('O preço de "%s" é %s. Nesta loja só o administrador muda o preço: '
                    . 'para vender mais barato, use o desconto.', $l['item'], moedaBr($l['tabela'])));
            }
        }
    }
}

function criarVenda(array $corpo, array $usuario): array
{
    $itens = $corpo['itens'] ?? [];
    if (!is_array($itens) || count($itens) === 0) {
        throw new ErroApi(400, 'A venda precisa de pelo menos um item.');
    }
    $clienteId = idDoCatalogo($corpo, 'cliente_id', null);
    if ($clienteId) {
        exigirExistente('clientes', $clienteId, 'Cliente informado não existe.');
    }

    $linhas = prepararItensDeSaida($itens);
    $bruto = round(array_sum(array_column($linhas, 'subtotal')), 2);
    $custo = round(array_sum(array_map(fn ($l) => $l['custo'] * $l['quantidade'], $linhas)), 2);
    conferirTeto($bruto, 'O total da venda');

    $desconto = dinheiro($corpo, 'desconto', 'Desconto', 0.0);
    if ($desconto > $bruto) {
        throw new ErroApi(400, 'O desconto precisa estar entre zero e o valor da venda (' . moedaBr($bruto) . ').');
    }
    $total = round($bruto - $desconto, 2);
    if ($total <= 0) {
        // A mesma regra da OS: nada de venda de R$ 0,00. Brinde sai pelo estoque.
        throw new ErroApi(400, 'O total da venda ficou em R$ 0,00. Para dar um item de brinde ou cortesia, '
            . 'use Movimentar estoque > Brinde / cortesia.');
    }
    $parcelas = inteiro($corpo, 'parcelas', 'Parcelas', 1, PARCELAS_MAX, 1);
    $pago     = !empty($corpo['pago']);
    conferirParcelamento($total, $parcelas, $pago);

    [$formaId, $forma] = formaDePagamento($corpo);
    conferirRegrasDaVenda($usuario, $bruto, $desconto, $clienteId, $formaId, $linhas);
    $data       = dataDoCorpo($corpo, 'data_venda', 'Data da venda', true) ?? agora();
    $vencimento = dataDoCorpo($corpo, 'vencimento', 'Vencimento') ?? substr($data, 0, 10);

    $vendaId = emTransacao(function () use ($corpo, $usuario, $linhas, $clienteId, $bruto, $desconto, $total, $custo,
                                            $forma, $formaId, $parcelas, $data, $vencimento, $pago) {
        $vendaId = gravarVenda(['cliente_id' => $clienteId, 'usuario_id' => $usuario['id'], 'bruto' => $bruto,
            'desconto' => $desconto, 'total' => $total, 'custo' => $custo, 'forma' => $forma, 'forma_id' => $formaId,
            'parcelas' => $parcelas, 'data' => $data, 'observacoes' => txt($corpo, 'observacoes')], $linhas);
        conferirSaldos(array_column($linhas, 'entrada_id'));
        gerarLancamentosDaVenda($vendaId, $total, $parcelas, $forma, $formaId, $clienteId, $vencimento, (int) $usuario['id'], $pago);
        return $vendaId;
    });
    return [201, ['ok' => true, 'id' => $vendaId, 'mensagem' => 'Venda registrada.']];
}

/*
 * A venda vira dinheiro: uma conta a receber por parcela, de mes em mes,
 * dividida em CENTAVOS (a ultima leva a sobra). A vista com "pago" ja
 * nasce paga. Valor zero nao gera conta.
 */
function gerarLancamentosDaVenda(int $vendaId, float $total, int $parcelas, ?string $forma, ?int $formaId,
                                 ?int $clienteId, string $vencimento, int $usuarioId, bool $pago): void
{
    $centavos = emCentavos($total);
    if ($centavos <= 0) {
        return;
    }
    $numero = consultarUm('SELECT numero FROM vendas WHERE id = ?', [$vendaId])['numero'] ?? ('#' . $vendaId);
    $base   = intdiv($centavos, $parcelas);
    $sobra  = $centavos - $base * $parcelas;
    $quitar = $pago && $parcelas === 1;
    for ($i = 1; $i <= $parcelas; $i++) {
        criarLancamento([
            'tipo' => 'receber', 'descricao' => 'Venda ' . $numero . ($parcelas > 1 ? " ({$i}/{$parcelas})" : ''),
            'categoria' => 'venda', 'valor' => ($base + ($i === $parcelas ? $sobra : 0)) / 100,
            'vencimento' => somarMeses($vencimento, $i - 1),
            'status' => $quitar ? 'pago' : 'pendente', 'data_pagamento' => $quitar ? agora() : null,
            'origem' => 'venda', 'venda_id' => $vendaId, 'cliente_id' => $clienteId,
            'forma_pagamento' => $forma, 'forma_pagamento_id' => $formaId,
            'parcela' => $i, 'total_parcelas' => $parcelas, 'usuario_id' => $usuarioId,
        ]);
    }
}

/*
 * Editar venda: cabecalho (cliente, desconto, forma, observacoes) e status.
 * Os itens nao mudam depois de gravados. Regras:
 *   - cancelada e estado FINAL;
 *   - venda gerada por OS so muda pela OS;
 *   - cancelar venda ja recebida e estorno: so admin;
 *   - mudou valor ou forma:
 *       nada pago ainda -> as parcelas sao refeitas (mesma regra da criacao);
 *       ja tem pago     -> o pago CONTINUA pago. Os pendentes sao cancelados
 *                          e nasce UMA conta: a receber da diferenca (total
 *                          novo maior que o pago) ou a pagar "Devolucao ao
 *                          cliente" (total novo menor que o pago, so admin).
 *     Ninguem precisa "despagar" nada no Financeiro.
 * $pelaEncomenda: quem chama e o cancelamento da encomenda da loja online
 * (api/rotas/loja.php) - so ele cancela a venda que a encomenda gerou.
 */
function atualizarVenda(?int $id, array $corpo, array $usuario, bool $pelaEncomenda = false): array
{
    $id = exigirId($id);
    $admin = $usuario['perfil'] === 'admin';
    return emTransacao(function () use ($id, $corpo, $usuario, $admin, $pelaEncomenda) {
        $atual = consultarUm('SELECT * FROM vendas WHERE id = ?', [$id]);
        if (!$atual) {
            throw new ErroApi(404, 'Venda não encontrada.');
        }
        $status = txt($corpo, 'status') ?? $atual['status'];
        if (!in_array($status, valoresDe('status_venda'), true)) {
            throw new ErroApi(400, 'Status de venda inválido: ' . $status . '. Use concluida ou cancelada.');
        }
        $bruto    = (float) $atual['valor_bruto'];
        $desconto = dinheiro($corpo, 'desconto', 'Desconto', (float) $atual['desconto']);
        if ($desconto > $bruto) {
            throw new ErroApi(400, 'O desconto precisa estar entre zero e o valor dos itens (' . moedaBr($bruto) . ').');
        }
        $total = round($bruto - $desconto, 2);
        $clienteId = array_key_exists('cliente_id', $corpo) ? idDoCatalogo($corpo, 'cliente_id', null)
                   : ($atual['cliente_id'] === null ? null : (int) $atual['cliente_id']);
        if ($clienteId) {
            exigirExistente('clientes', $clienteId, 'Cliente informado não existe.');
        }
        [$formaId, $formaNome] = formaDePagamento($corpo, $atual);

        $mudouValor   = emCentavos($total) !== emCentavos($atual['valor_total']);
        $mudouForma   = (int) $formaId !== (int) $atual['forma_pagamento_id'];
        $mudouCliente = (int) $clienteId !== (int) $atual['cliente_id'];
        $cancelando   = $status === 'cancelada' && $atual['status'] !== 'cancelada';

        if ($atual['status'] === 'cancelada') {
            if ($status !== 'cancelada') {
                throw new ErroApi(400, 'Venda cancelada não pode ser reativada. Registre uma nova venda.');
            }
            if ($mudouValor || $mudouForma || $mudouCliente) {
                throw new ErroApi(400, 'Venda cancelada não pode ser alterada; só as observações mudam.');
            }
        }
        $os = consultarUm('SELECT id, numero FROM ordens_servico WHERE venda_id = ?', [$id]);
        if ($os && ($cancelando || $mudouValor || $mudouForma || $mudouCliente)) {
            throw new ErroApi(400, 'Esta venda foi gerada pela ' . ($os['numero'] ?: 'OS #' . $os['id']) . '. Altere pela ordem de serviço.');
        }
        // v8: venda da loja online cai junto com a encomenda (o cliente ve no rastreio), nunca sozinha.
        $encomenda = consultarUm('SELECT numero FROM encomendas WHERE venda_id = ?', [$id]);
        if ($encomenda && !$pelaEncomenda && ($cancelando || $mudouValor || $mudouCliente)) {
            throw new ErroApi(400, 'Esta venda veio da encomenda ' . $encomenda['numero'] . ' da loja online. Para cancelar ou mudar '
                . 'o valor, use Loja online > Encomendas.');
        }

        // Liquido ja recebido: recebido menos devolucao ja paga.
        $recebido = (float) consultarUm(
            "SELECT COALESCE(SUM(CASE WHEN tipo = 'receber' THEN valor ELSE -valor END), 0) AS v
               FROM lancamentos WHERE venda_id = ? AND status = 'pago'", [$id])['v'];
        if ($cancelando && $recebido > 0 && !$admin) {
            throw new ErroApi(403, 'Só o administrador pode cancelar uma venda que já foi recebida: o dinheiro '
                . 'recebido precisa ser estornado. Peça a um administrador.');
        }
        if (!$cancelando && $atual['status'] === 'concluida' && ($mudouValor || $mudouForma || $mudouCliente)) {
            conferirRegrasDaVenda($usuario, $bruto, $desconto, $clienteId, $mudouForma ? $formaId : null, null);
        }
        $refazer = !$cancelando && $atual['status'] === 'concluida' && ($mudouValor || $mudouForma);
        if ($refazer && $total <= 0) {
            throw new ErroApi(400, 'O desconto não pode zerar a venda. Para desfazer a venda, cancele-a.');
        }
        if ($refazer && emCentavos($recebido) > emCentavos($total) && !$admin) {
            throw new ErroApi(403, 'Esta venda já recebeu ' . moedaBr($recebido) . ' e o valor novo é menor: a diferença '
                . 'teria de ser devolvida ao cliente. Só o administrador pode lançar essa devolução.');
        }
        if ($refazer && $recebido <= 0) {
            conferirParcelamento($total, (int) $atual['parcelas'], false);
        }

        executarSql(
            'UPDATE vendas SET cliente_id = ?, desconto = ?, valor_total = ?, forma_pagamento = ?,
                               forma_pagamento_id = ?, status = ?, observacoes = ?, atualizado_em = ? WHERE id = ?',
            [$clienteId, $desconto, $total, $formaNome, $formaId, $status, txtOu($corpo, 'observacoes', $atual), agora(), $id]);

        $mensagem = 'Venda atualizada.';
        if ($cancelando) {
            // Estado final: TODA conta vira 'cancelado' - a paga tambem (estorno).
            cancelarLancamentos('venda_id', $id, 'venda cancelada', (int) $usuario['id']);
            devolverCelularesAPrateleira($id, 'cancelar esta venda');
            $mensagem = 'Venda cancelada e itens devolvidos ao estoque.';
        } elseif ($refazer) {
            $motivo = $mudouValor ? 'valor da venda alterado' : 'forma de pagamento alterada';
            $primeiro = consultarUm("SELECT MIN(vencimento) AS v FROM lancamentos WHERE venda_id = ? AND status = 'pendente'",
                                    [$id])['v'] ?? null;
            $vencimento = $primeiro ?: substr((string) $atual['data_venda'], 0, 10);
            if ($recebido <= 0) {
                cancelarLancamentos('venda_id', $id, $motivo, (int) $usuario['id']);
                gerarLancamentosDaVenda($id, $total, (int) $atual['parcelas'], $formaNome, $formaId, $clienteId,
                    $vencimento, (int) $usuario['id'], false);
                $mensagem = 'Venda atualizada; as parcelas a receber foram refeitas com o valor novo.';
            } elseif (!$mudouValor) {
                // So a forma mudou: as parcelas pendentes trocam de forma; as pagas ficam como foram pagas.
                trocarFormaDosPendentes($id, $formaId, $formaNome, (int) $usuario['id']);
                $mensagem = 'Venda atualizada; as parcelas a receber passaram para a forma nova (as já pagas ficam como estão).';
            } else {
                $mensagem = acertarVendaJaRecebida($id, $total, $recebido, $formaNome, $formaId, $clienteId,
                    max($vencimento, date('Y-m-d')), (int) $usuario['id'], $motivo);
            }
        } elseif ($mudouCliente) {
            trocarClienteDosLancamentos($id, $clienteId, (int) $usuario['id']);
        }
        return [200, ['ok' => true, 'mensagem' => $mensagem]];
    });
}

/*
 * Venda que ja recebeu dinheiro e mudou de valor: o pago fica como esta;
 * os pendentes saem (com log); nasce UMA conta da diferenca.
 */
function acertarVendaJaRecebida(int $vendaId, float $total, float $recebido, ?string $forma, ?int $formaId,
                                ?int $clienteId, string $vencimento, int $usuarioId, string $motivo): string
{
    cancelarLancamentos('venda_id', $vendaId, $motivo, $usuarioId, true);
    $numero = consultarUm('SELECT numero FROM vendas WHERE id = ?', [$vendaId])['numero'];
    $diferenca = round($total - $recebido, 2);
    $comum = ['categoria' => 'venda', 'vencimento' => $vencimento, 'status' => 'pendente', 'origem' => 'venda',
              'venda_id' => $vendaId, 'cliente_id' => $clienteId, 'forma_pagamento' => $forma,
              'forma_pagamento_id' => $formaId, 'usuario_id' => $usuarioId];
    if (emCentavos($diferenca) > 0) {
        criarLancamento(['tipo' => 'receber', 'descricao' => 'Venda ' . $numero . ' (diferença)', 'valor' => $diferenca] + $comum);
        return 'Venda atualizada. O que já foi recebido (' . moedaBr($recebido) . ') continua recebido; '
             . 'a diferença de ' . moedaBr($diferenca) . ' ficou como conta a receber.';
    }
    if (emCentavos($diferenca) < 0) {
        criarLancamento(['tipo' => 'pagar', 'descricao' => 'Devolução ao cliente — ' . $numero, 'valor' => -$diferenca] + $comum);
        return 'Venda atualizada. Já foram recebidos ' . moedaBr($recebido) . ' e a venda agora vale ' . moedaBr($total)
             . ': foi lançada uma devolução de ' . moedaBr(-$diferenca) . ' ao cliente, a pagar.';
    }
    return 'Venda atualizada. O valor já recebido cobre a venda inteira; não há mais nada a receber.';
}
