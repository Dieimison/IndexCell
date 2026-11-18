<?php
/**
 * api/rotas/estoque.php - entradas (o que chega na loja), movimentacoes
 * (garantia, perda, brinde...) e a ficha do item.
 *
 * O saldo nunca e gravado: e a vw_entradas_saldo, que le as saidas de
 * vw_saidas_estoque (venda concluida e OS que segura peca). A regra de
 * quando a OS baixa estoque mora SO nessa view.
 */

declare(strict_types=1);

/*
 * Ultima barreira do estoque: depois de gravar, DENTRO da transacao, o
 * saldo de cada entrada mexida tem de continuar >= 0, pela mesma formula
 * do resto do sistema (vw_entradas).
 */
function conferirSaldos(array $entradaIds, ?string $explicacao = null): void
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $entradaIds))));
    if (!$ids) {
        return;
    }
    $negativa = consultarUm(
        'SELECT id, item, saldo FROM vw_entradas WHERE id IN (' . vagas($ids) . ') AND saldo < 0 ORDER BY id LIMIT 1', $ids);
    if ($negativa) {
        throw new ErroApi(400, 'Saldo insuficiente de "' . $negativa['item'] . '": a operação deixaria o estoque em '
            . (int) $negativa['saldo'] . '.' . ($explicacao ? ' ' . $explicacao : ''));
    }
}

/*
 * Celular que vendeu sai da prateleira; celular cuja venda foi desfeita
 * volta. Uma funcao para cada lado, para todos os caminhos.
 */
function tirarCelularesDaPrateleira(int $vendaId, string $data): void
{
    executarSql(
        "UPDATE entradas SET situacao = 'vendido', data_venda = ?
          WHERE tipo = 'celular'
            AND id IN (SELECT entrada_id FROM venda_itens WHERE venda_id = ? AND entrada_id IS NOT NULL)",
        [$data, $vendaId]);
}

/*
 * Um aparelho fisico (um IMEI) e no maximo UMA unidade vendavel. Quando a
 * loja recompra o celular que vendeu, ele entra de novo (outra entrada,
 * mesmo IMEI). Se depois alguem desfaz a venda antiga, a entrada antiga
 * voltaria a ter saldo e o mesmo aparelho viraria duas unidades - por
 * isso a devolucao e recusada (400) e NADA e gravado (quem chama esta
 * numa transacao). Invariante: I17 do testes\integridade.php.
 */
function imeiJaRecomprado(array $entradaIds): ?array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $entradaIds))));
    if (!$ids) {
        return null;
    }
    return consultarUm(
        "SELECT velha.imei, nova.id, nova.item, nova.data_entrada
           FROM entradas velha
           JOIN vw_entradas nova ON nova.tipo = 'celular' AND nova.imei = velha.imei
                                AND nova.id NOT IN (" . vagas($ids) . ") AND nova.saldo > 0
          WHERE velha.id IN (" . vagas($ids) . ") AND velha.tipo = 'celular'
            AND velha.imei IS NOT NULL AND TRIM(velha.imei) <> ''
          ORDER BY nova.id LIMIT 1",
        array_merge($ids, $ids));
}

function recusarImeiRecomprado(array $outra, string $acao): void
{
    throw new ErroApi(400, 'O IMEI ' . $outra['imei'] . ' já voltou ao estoque pela entrada de '
        . dataBr($outra['data_entrada']) . ' (recompra: ' . $outra['item'] . '). Nada foi gravado. '
        . 'Cancele ou ajuste aquela entrada antes de ' . $acao . '.');
}

/*
 * Depois de gravar (dentro da transacao): celular mexido que ficou com
 * saldo > 0 nao pode ter o mesmo IMEI de outro celular com saldo > 0.
 * Cobre os caminhos que nao passam pela venda (movimentacao, OS).
 */
function conferirImeiNoEstoque(array $entradaIds, string $acao): void
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $entradaIds))));
    if (!$ids) {
        return;
    }
    $comSaldo = array_column(consultar(
        "SELECT id FROM vw_entradas WHERE tipo = 'celular' AND saldo > 0 AND id IN (" . vagas($ids) . ')', $ids), 'id');
    $outra = imeiJaRecomprado($comSaldo);
    if ($outra) {
        recusarImeiRecomprado($outra, $acao);
    }
}

function devolverCelularesAPrateleira(int $vendaId, string $acao = 'desfazer esta venda'): void
{
    $celulares = array_column(consultar(
        "SELECT vi.entrada_id FROM venda_itens vi JOIN entradas e ON e.id = vi.entrada_id
          WHERE vi.venda_id = ? AND e.tipo = 'celular'", [$vendaId]), 'entrada_id');
    $outra = imeiJaRecomprado($celulares);
    if ($outra) {
        recusarImeiRecomprado($outra, $acao);
    }
    executarSql(
        "UPDATE entradas SET situacao = 'ready', data_venda = NULL
          WHERE tipo = 'celular' AND situacao = 'vendido'
            AND id IN (SELECT entrada_id FROM venda_itens WHERE venda_id = ? AND entrada_id IS NOT NULL)",
        [$vendaId]);
}

// ------------------------------------------------------------------
// Entradas
// ------------------------------------------------------------------
function entradas(?int $id, string $metodo, array $corpo, array $usuario, array $consulta): array
{
    if ($metodo === 'GET') {
        if ($id) {
            $item = consultarUm('SELECT * FROM vw_entradas WHERE id = ?', [$id]);
            if (!$item) {
                throw new ErroApi(404, 'Entrada não encontrada.');
            }
            $item += documentosDasEntradas()[$id] ?? ['pedido_id' => null, 'pedido' => null];
            return [200, ['ok' => true, 'entrada' => $item]];
        }
        // ?tipo=peca filtra; ?disponivel=1 tira o que ja acabou (venda e OS pedem).
        $onde = [];
        $par  = [];
        $tipo = (string) ($consulta['tipo'] ?? '');
        if ($tipo !== '' && in_array($tipo, valoresDe('tipos_entrada'), true)) {
            $onde[] = 'tipo = ?';
            $par[]  = $tipo;
        }
        if (!empty($consulta['disponivel'])) {
            // Quem manda e o SALDO; a situacao so tira celular de circulacao.
            $onde[] = SQL_ESTOQUE_PARADO;   // api/nucleo.php - a mesma regra do painel
        }
        $itens = consultar('SELECT * FROM vw_entradas' . ($onde ? ' WHERE ' . implode(' AND ', $onde) : '') .
            " ORDER BY CASE situacao WHEN 'processamento' THEN 1 WHEN 'ready' THEN 2 WHEN 'check' THEN 3 ELSE 4 END, item", $par);
        $docs = documentosDasEntradas();
        $itens = array_map(fn ($e) => $e + ($docs[(int) $e['id']] ?? ['pedido_id' => null, 'pedido' => null]), $itens);
        return [200, ['ok' => true, 'itens' => $itens]];
    }

    if ($metodo === 'POST') {
        // Ate tres tabelas (catalogo na hora, entradas, lancamentos), numa transacao.
        return emTransacao(function () use ($corpo, $usuario) {
            $d = dadosEntrada($corpo, null);
            /*
             * A compra vira lancamento no financeiro:
             *   pago -> sai do caixa agora; pagar -> fica pendente; vazio -> nada.
             */
            $comoPagou = txt($corpo, 'gerar_conta_pagar') ?? '';
            if ($comoPagou === '1') {
                $comoPagou = 'pagar';   // formato antigo
            }
            if (!in_array($comoPagou, ['', 'pago', 'pagar'], true)) {
                throw new ErroApi(400, 'Escolha como a compra foi paga: "pago", "pagar" ou deixe em branco.');
            }
            [$formaId, $formaNome] = formaDePagamento($corpo);
            $vencimento = dataDoCorpo($corpo, 'vencimento', 'Vencimento');
            $total = round($d['investimento'] * $d['quantidade'], 2);
            conferirTeto($total, 'O custo total da entrada (quantidade × custo)');

            executarSql(
                'INSERT INTO entradas
                    (tipo, modelo_id, peca_id, produto_id, fornecedor_id, descricao, quantidade,
                     valor_investimento, valor_venda, situacao, imei, cor, condicao,
                     nota_fiscal, observacoes, data_entrada, data_venda)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$d['tipo'], $d['modelo_id'], $d['peca_id'], $d['produto_id'], $d['fornecedor_id'],
                 $d['descricao'], $d['quantidade'], $d['investimento'], $d['venda'], $d['situacao'],
                 $d['imei'], $d['cor'], $d['condicao'], $d['nota_fiscal'], $d['observacoes'],
                 $d['data_entrada'], $d['data_venda']]);
            $novoId = (int) banco()->lastInsertId();
            conferirCelularVendido($novoId);

            $mensagem = 'Entrada registrada.';
            if ($comoPagou !== '') {
                if ($total <= 0) {
                    $mensagem = 'Entrada registrada. Como o custo é zero, nenhuma conta foi lançada.';
                } else {
                    $pago = $comoPagou === 'pago';
                    criarLancamento([
                        'tipo' => 'pagar', 'descricao' => 'Compra: ' . descreverEntrada($novoId), 'categoria' => 'fornecedor',
                        'valor' => $total, 'vencimento' => $vencimento ?? substr($d['data_entrada'], 0, 10),
                        'data_pagamento' => $pago ? $d['data_entrada'] : null, 'status' => $pago ? 'pago' : 'pendente',
                        'origem' => 'entrada', 'entrada_id' => $novoId, 'fornecedor_id' => $d['fornecedor_id'],
                        'forma_pagamento' => $formaNome, 'forma_pagamento_id' => $formaId, 'usuario_id' => $usuario['id'],
                    ]);
                }
            }
            return [201, ['ok' => true, 'id' => $novoId, 'mensagem' => $mensagem]];
        });
    }

    if ($metodo === 'PUT') {
        $id = exigirId($id);
        return emTransacao(function () use ($id, $corpo) {
            $atual = consultarUm('SELECT * FROM entradas WHERE id = ?', [$id]);
            if (!$atual) {
                throw new ErroApi(404, 'Entrada não encontrada.');
            }
            $d = dadosEntrada($corpo, $atual);
            $doPedido = pedidoDaEntrada($id);
            if ($doPedido && ((int) $d['quantidade'] !== (int) $atual['quantidade']
                              || emCentavos($d['investimento']) !== emCentavos($atual['valor_investimento']))) {
                throw new ErroApi(400, 'Esta entrada veio do pedido ' . $doPedido . ': quantidade e custo seguem a nota. '
                    . 'Para corrigir, cancele o pedido e lance de novo.');
            }
            executarSql(
                'UPDATE entradas
                    SET tipo = ?, modelo_id = ?, peca_id = ?, produto_id = ?, fornecedor_id = ?,
                        descricao = ?, quantidade = ?, valor_investimento = ?, valor_venda = ?,
                        situacao = ?, imei = ?, cor = ?, condicao = ?, nota_fiscal = ?,
                        observacoes = ?, data_venda = ?
                  WHERE id = ?',
                [$d['tipo'], $d['modelo_id'], $d['peca_id'], $d['produto_id'], $d['fornecedor_id'],
                 $d['descricao'], $d['quantidade'], $d['investimento'], $d['venda'], $d['situacao'],
                 $d['imei'], $d['cor'], $d['condicao'], $d['nota_fiscal'], $d['observacoes'],
                 $d['data_venda'], $id]);
            // A quantidade nao cai abaixo do que ja saiu: vendas, OS e baixas.
            conferirSaldos([$id], 'A quantidade não pode ficar menor que o que já saiu (vendas, OS e baixas).');
            conferirCelularVendido($id);
            return [200, ['ok' => true, 'mensagem' => 'Entrada atualizada.']];
        });
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        return emTransacao(function () use ($id, $usuario) {
            $s = consultarUm('SELECT * FROM vw_entradas_saldo WHERE entrada_id = ?', [$id]);
            if (!$s) {
                throw new ErroApi(404, 'Entrada não encontrada.');
            }
            $doPedido = pedidoDaEntrada($id);
            if ($doPedido) {
                throw new ErroApi(400, 'Esta entrada veio do pedido ' . $doPedido . '. Para tirar do estoque, cancele o pedido '
                    . '(ele desfaz também as contas a pagar).');
            }
            if ((int) $s['vendido'] > 0 || (int) $s['usado_os'] > 0) {
                throw new ErroApi(400,
                    'Esta entrada já teve saída: ' . (int) $s['vendido'] . ' unidade(s) vendida(s) e '
                    . (int) $s['usado_os'] . ' usada(s) em ordem de serviço. Por isso ela não pode ser '
                    . 'excluída - apagar aqui deixaria a venda e a OS sem o custo do item.');
            }
            $movimentos = (int) consultarUm('SELECT COUNT(*) AS q FROM movimentacoes WHERE entrada_id = ?', [$id])['q'];
            if ($movimentos > 0) {
                throw new ErroApi(400,
                    "Esta entrada já teve saída ou entrada fora de venda ({$movimentos} movimentação(ões): "
                    . 'perda, garantia, brinde, devolução ou ajuste). Excluir apagaria esse histórico. '
                    . 'Para corrigir o estoque, registre uma nova movimentação.');
            }
            // A conta da compra nao some com a entrada: vira 'cancelado'.
            cancelarLancamentos('entrada_id', $id, 'entrada excluída', (int) $usuario['id']);
            executarSql('DELETE FROM entradas WHERE id = ?', [$id]);
            return [200, ['ok' => true, 'mensagem' => 'Entrada excluída.']];
        });
    }

    throw new ErroApi(405, 'Método não permitido para /api/entradas.');
}

/** O numero do pedido confirmado que criou esta entrada, ou null. */
function pedidoDaEntrada(int $entradaId): ?string
{
    $p = consultarUm("SELECT p.numero FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
                       WHERE i.entrada_id = ? AND p.status = 'confirmado'", [$entradaId]);
    return $p['numero'] ?? null;
}

/*
 * O documento de entrada (pedido confirmado) de cada item do estoque, numa
 * consulta so: entrada_id -> [pedido_id, pedido]. O Estoque mostra "Entrada
 * PE-..." e abre o documento; sem documento e lancamento avulso antigo
 * (de antes da v9, quando o Estoque ainda lancava entrada).
 */
function documentosDasEntradas(): array
{
    $mapa = [];
    foreach (consultar("SELECT i.entrada_id, p.id, p.numero FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
                         WHERE i.entrada_id IS NOT NULL AND p.status = 'confirmado'") as $r) {
        $mapa[(int) $r['entrada_id']] = ['pedido_id' => (int) $r['id'], 'pedido' => $r['numero']];
    }
    return $mapa;
}

/* Celular so fica 'vendido' quando saiu de verdade (saldo 0). */
function conferirCelularVendido(int $entradaId): void
{
    $e = consultarUm('SELECT tipo, situacao, saldo FROM vw_entradas WHERE id = ?', [$entradaId]);
    if ($e && $e['tipo'] === 'celular' && $e['situacao'] === 'vendido' && (int) $e['saldo'] > 0) {
        throw new ErroApi(400, 'Este celular ainda está no estoque. Para marcá-lo como vendido, registre a venda '
            . '(Vendas > Nova venda): é ela que tira o aparelho da prateleira.');
    }
}

/*
 * Le e confere o corpo de uma entrada. O tipo decide qual id de catalogo
 * vale e zera os outros dois. No PUT, o que nao veio continua gravado.
 */
function dadosEntrada(array $corpo, ?array $atual): array
{
    $tipo = txt($corpo, 'tipo') ?? ($atual['tipo'] ?? 'celular');
    if (!in_array($tipo, valoresDe('tipos_entrada'), true)) {
        throw new ErroApi(400, 'Tipo de entrada inválido: ' . $tipo . '. Use celular, peça ou produto.');
    }
    $situacao = txt($corpo, 'situacao') ?? ($atual['situacao'] ?? ($tipo === 'celular' ? 'check' : 'ready'));
    if (!in_array($situacao, valoresDe('situacoes'), true)) {
        throw new ErroApi(400, 'Situação inválida: ' . $situacao);
    }

    $modeloId = $pecaId = $produtoId = null;
    if ($tipo === 'celular') {
        $modeloId = idDoCatalogo($corpo, 'modelo_id', $atual['modelo_id'] ?? null);
        if (!$modeloId && txt($corpo, 'modelo_nome')) {
            $modeloId = acharOuCriarModelo(txt($corpo, 'modelo_nome'), txt($corpo, 'marca'), txt($corpo, 'armazenamento'));
        }
        if (!$modeloId) {
            throw new ErroApi(400, 'Escolha o modelo do celular (ou cadastre um novo).');
        }
        exigirExistente('modelos', $modeloId, 'Modelo informado não existe.');
    } elseif ($tipo === 'peca') {
        $pecaId = idDoCatalogo($corpo, 'peca_id', $atual['peca_id'] ?? null);
        if (!$pecaId && txt($corpo, 'peca_nome')) {
            $pecaId = criarPeca(['nome' => txt($corpo, 'peca_nome'), 'categoria' => txt($corpo, 'peca_categoria'),
                                 'modelo_id' => idDoCatalogo($corpo, 'peca_modelo_id', null)]);
        }
        if (!$pecaId) {
            throw new ErroApi(400, 'Escolha a peça (ou cadastre uma nova).');
        }
        exigirExistente('pecas', $pecaId, 'Peça informada não existe.');
    } else {
        $produtoId = idDoCatalogo($corpo, 'produto_id', $atual['produto_id'] ?? null);
        if (!$produtoId && txt($corpo, 'produto_nome')) {
            $produtoId = criarProduto(['nome' => txt($corpo, 'produto_nome'), 'categoria' => txt($corpo, 'produto_categoria'),
                                       'marca' => txt($corpo, 'marca')]);
        }
        if (!$produtoId) {
            throw new ErroApi(400, 'Escolha o produto (ou cadastre um novo).');
        }
        exigirExistente('produtos', $produtoId, 'Produto informado não existe.');
    }

    $fornecedorId = idDoCatalogo($corpo, 'fornecedor_id', $atual['fornecedor_id'] ?? null);
    if ($fornecedorId) {
        exigirExistente('fornecedores', $fornecedorId, 'Fornecedor informado não existe.');
    }

    // Celular e unitario; peca e produto: inteiro >= 1, nada trocado em silencio.
    $quantidade = $tipo === 'celular' ? 1
        : inteiro($corpo, 'quantidade', 'Quantidade', 1, QUANTIDADE_MAXIMA,
                  $atual && $atual['tipo'] !== 'celular' ? (int) $atual['quantidade'] : 1);

    $condicao = $tipo === 'celular' ? txtOu($corpo, 'condicao', $atual) : null;
    if ($condicao !== null && !in_array($condicao, valoresDe('condicoes'), true)) {
        throw new ErroApi(400, 'Condição inválida: ' . $condicao . '. Use novo, seminovo, usado ou defeito.');
    }

    $imei = null;
    if ($tipo === 'celular') {
        $imei = array_key_exists('imei', $corpo) ? txt($corpo, 'imei', 'IMEI') : ($atual['imei'] ?? null);
        // So confere o que mudou: um IMEI antigo fora do padrao nao impede editar o resto.
        if ($imei !== null && $imei !== ($atual['imei'] ?? null)) {
            $imei = conferirImei($imei, $atual ? (int) $atual['id'] : null);
        }
    }

    return [
        'tipo' => $tipo, 'modelo_id' => $modeloId, 'peca_id' => $pecaId, 'produto_id' => $produtoId,
        'fornecedor_id' => $fornecedorId, 'descricao' => txtOu($corpo, 'descricao', $atual), 'quantidade' => $quantidade,
        'investimento' => dinheiro($corpo, 'valor_investimento', 'Custo', (float) ($atual['valor_investimento'] ?? 0)),
        'venda' => dinheiro($corpo, 'valor_venda', 'Preço de venda', (float) ($atual['valor_venda'] ?? 0)),
        'situacao' => $situacao, 'imei' => $imei,
        'cor' => $tipo === 'celular' ? listaOu('cores', $corpo, 'cor', $atual) : null, 'condicao' => $condicao,
        'nota_fiscal' => txtOu($corpo, 'nota_fiscal', $atual), 'observacoes' => txtOu($corpo, 'observacoes', $atual),
        'data_entrada' => $atual['data_entrada'] ?? (dataDoCorpo($corpo, 'data_entrada', 'Data de entrada', true) ?? agora()),
        'data_venda' => $situacao === 'vendido'
            ? (dataDoCorpo($corpo, 'data_venda', 'Data da venda', true) ?? ($atual['data_venda'] ?? agora())) : null,
    ];
}

/** Digito verificador do IMEI (Luhn): o 15o digito confere os 14 primeiros. */
function imeiConfere(string $digitos): bool
{
    $soma = 0;
    for ($i = 0; $i < 15; $i++) {
        $d = (int) $digitos[$i];
        if ($i % 2 === 1) {
            $d *= 2;
            if ($d > 9) {
                $d -= 9;
            }
        }
        $soma += $d;
    }
    return $soma % 10 === 0;
}

/*
 * IMEI: 15 digitos, so numeros, com o digito verificador certo. Repetido
 * so e recusado se o aparelho com esse IMEI AINDA esta no estoque (saldo
 * > 0): a loja de usados recompra o celular que ela mesma vendeu.
 */
function conferirImei(string $imei, ?int $entradaId): string
{
    $digitos = (string) preg_replace('/[\s.\-]/', '', $imei);
    if (!preg_match('/^\d{15}$/', $digitos)) {
        throw new ErroApi(400, 'O IMEI precisa ter 15 dígitos, só números. Ele aparece na caixa do aparelho ou discando *#06#.');
    }
    if (!imeiConfere($digitos)) {
        throw new ErroApi(400, 'Este IMEI não existe: o último dígito (verificador) não confere. '
            . 'Confira na caixa do aparelho ou discando *#06#.');
    }
    $noEstoque = consultarUm(
        "SELECT id, item, data_entrada FROM vw_entradas
          WHERE tipo = 'celular' AND imei = ? AND id <> ? AND saldo > 0 ORDER BY id LIMIT 1",
        [$digitos, $entradaId ?? 0]);
    if ($noEstoque) {
        throw new ErroApi(400, 'Este IMEI já está no estoque: ' . $noEstoque['item'] . ', entrada de '
            . dataBr($noEstoque['data_entrada']) . '.');
    }
    return $digitos;
}

/** Nome legivel de uma entrada, para descricao de lancamento. */
function descreverEntrada(int $entradaId): string
{
    $linha = consultarUm('SELECT item, quantidade FROM vw_entradas WHERE id = ?', [$entradaId]);
    if (!$linha) {
        return 'entrada #' . $entradaId;
    }
    return ((int) $linha['quantidade'] > 1 ? $linha['quantidade'] . 'x ' : '') . (string) $linha['item'];
}

// ------------------------------------------------------------------
// Movimentacoes (garantia, retorno, devolucao, defeito, perda, brinde, ajuste)
// ------------------------------------------------------------------
function movimentacoes(?int $id, string $metodo, array $corpo, array $usuario, array $consulta): array
{
    if ($metodo === 'GET') {
        return [200, ['ok' => true] + historicoDoItem($consulta)];
    }

    if ($metodo === 'POST') {
        $entradaId = idDoCatalogo($corpo, 'entrada_id', null);
        if (!$entradaId) {
            throw new ErroApi(400, 'Escolha o item do estoque que está sendo movimentado.');
        }
        $entrada = consultarUm('SELECT * FROM vw_entradas WHERE id = ?', [$entradaId]);
        if (!$entrada) {
            throw new ErroApi(400, 'Item do estoque não encontrado.');
        }
        $motivo = txt($corpo, 'motivo') ?? 'ajuste';
        if (!in_array($motivo, valoresDe('motivos_movimentacao'), true)) {
            throw new ErroApi(400, 'Motivo inválido: ' . $motivo);
        }
        // O motivo escolhe o lado (dominio); a tela so manda o lado no ajuste.
        $tipo = txt($corpo, 'tipo') ?? DOMINIOS['motivos_movimentacao'][$motivo][1];
        if (!in_array($tipo, ['entrada', 'saida'], true)) {
            throw new ErroApi(400, 'Tipo de movimento inválido: ' . $tipo);
        }
        $quantidade = inteiro($corpo, 'quantidade', 'Quantidade', 1, QUANTIDADE_MAXIMA, 1);
        $valor      = dinheiro($corpo, 'valor', 'Valor', 0.0);
        if ($tipo === 'saida' && $quantidade > (int) $entrada['saldo']) {
            throw new ErroApi(400, 'Saldo insuficiente de "' . $entrada['item'] . '": baixa de ' . $quantidade
                . ', disponível ' . (int) $entrada['saldo'] . '.');
        }
        $osId = idDoCatalogo($corpo, 'os_id', null);
        if ($osId) {
            exigirExistente('ordens_servico', $osId, 'Ordem de serviço informada não existe.');
        }
        $fornecedorId = idDoCatalogo($corpo, 'fornecedor_id', $entrada['fornecedor_id']);
        if ($fornecedorId) {
            exigirExistente('fornecedores', $fornecedorId, 'Fornecedor informado não existe.');
        }
        return emTransacao(function () use ($entradaId, $tipo, $motivo, $quantidade, $osId, $fornecedorId, $valor, $corpo, $usuario, $entrada) {
            executarSql(
                'INSERT INTO movimentacoes (entrada_id, tipo, motivo, quantidade, os_id, fornecedor_id, valor, observacoes, usuario_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$entradaId, $tipo, $motivo, $quantidade, $osId, $fornecedorId, $valor, txt($corpo, 'observacoes'), $usuario['id']]);
            $novo = (int) banco()->lastInsertId();
            conferirSaldos([$entradaId]);
            conferirImeiNoEstoque([$entradaId], 'registrar esta movimentação');
            return [201, ['ok' => true, 'id' => $novo,
                          'mensagem' => 'Movimentação registrada. Saldo de "' . $entrada['item'] . '" atualizado.']];
        });
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        return emTransacao(function () use ($id) {
            $mov = consultarUm('SELECT * FROM movimentacoes WHERE id = ?', [$id]);
            if (!$mov) {
                throw new ErroApi(404, 'Movimentação não encontrada.');
            }
            executarSql('DELETE FROM movimentacoes WHERE id = ?', [$id]);
            conferirSaldos([(int) $mov['entrada_id']],
                'As unidades que esta movimentação trouxe já saíram por venda ou OS; ela não pode ser desfeita.');
            conferirImeiNoEstoque([(int) $mov['entrada_id']], 'desfazer esta movimentação');
            return [200, ['ok' => true, 'mensagem' => 'Movimentação desfeita.']];
        });
    }

    throw new ErroApi(405, 'Método não permitido para /api/movimentacoes.');
}

/*
 * A ficha de um item: tudo o que entrou e saiu, em ordem, com o saldo.
 * Compra, venda, OS e movimentacao numa linha do tempo so; venda e OS vem
 * da vw_saidas_estoque (a mesma regra do saldo). Aceita ?peca_id=,
 * ?produto_id=, ?modelo_id= ou ?entrada_id=.
 */
function historicoDoItem(array $consulta): array
{
    $onde = '';
    $par = [];
    foreach (['peca_id', 'produto_id', 'modelo_id'] as $coluna) {
        if (!empty($consulta[$coluna])) {
            $onde = 'e.' . $coluna . ' = ?';
            $par = [(int) $consulta[$coluna]];
            break;
        }
    }
    if (!$onde && !empty($consulta['entrada_id'])) {
        $onde = 'e.id = ?';
        $par = [(int) $consulta['entrada_id']];
    }
    if (!$onde) {
        throw new ErroApi(400, 'Informe peca_id, produto_id, modelo_id ou entrada_id para ver a ficha do item.');
    }

    $entradas = consultar(
        'SELECT id, item, tipo, quantidade, valor_investimento, valor_venda, data_entrada, fornecedor
           FROM vw_entradas e WHERE ' . $onde . ' ORDER BY data_entrada', $par);
    if (!$entradas) {
        return ['movimentos' => [], 'saldo' => 0, 'item' => null, 'resumo' => zeroResumo()];
    }
    $ids = array_column($entradas, 'id');
    $v = vagas($ids);

    $linhas = consultar(
        "SELECT data, origem, descricao, referencia, quantidade, valor, entrada_id, mov_id, motivo
           FROM (
                SELECT e.data_entrada AS data, 'compra' AS origem, 'Entrada em estoque' AS descricao,
                       COALESCE(f.nome, '') AS referencia, e.quantidade AS quantidade, e.valor_investimento AS valor,
                       e.id AS entrada_id, NULL AS mov_id, NULL AS motivo
                  FROM entradas e LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
                 WHERE e.id IN ($v)
                UNION ALL
                SELECT s.data, s.origem,
                       CASE WHEN s.origem = 'venda' THEN 'Venda ' || COALESCE(vd.numero, '#' || vd.id)
                            ELSE 'OS ' || COALESCE(o.numero, '#' || o.id) END,
                       COALESCE(c1.nome, c2.nome, CASE WHEN s.origem = 'venda' THEN 'Consumidor' ELSE '' END),
                       -s.quantidade, s.valor_unitario, s.entrada_id, NULL, NULL
                  FROM vw_saidas_estoque s
                  LEFT JOIN vendas vd ON vd.id = s.venda_id
                  LEFT JOIN clientes c1 ON c1.id = vd.cliente_id
                  LEFT JOIN ordens_servico o ON o.id = s.os_id
                  LEFT JOIN clientes c2 ON c2.id = o.cliente_id
                 WHERE s.entrada_id IN ($v)
                UNION ALL
                SELECT m.criado_em, m.motivo, '', TRIM(COALESCE('OS ' || o2.numero, '') || ' ' || COALESCE(m.observacoes, '')),
                       CASE WHEN m.tipo = 'entrada' THEN m.quantidade ELSE -m.quantidade END,
                       m.valor, m.entrada_id, m.id, m.motivo
                  FROM movimentacoes m LEFT JOIN ordens_servico o2 ON o2.id = m.os_id
                 WHERE m.entrada_id IN ($v)
           )
          ORDER BY data, mov_id",
        array_merge($ids, $ids, $ids));

    $saldo = 0;
    $resumo = zeroResumo();
    $movimentos = [];
    foreach ($linhas as $l) {
        $q = (int) $l['quantidade'];
        $saldo += $q;
        if ($q > 0) {
            $resumo['entrou'] += $q;
        } else {
            $resumo['saiu'] += -$q;
        }
        $resumo[$l['origem'] === 'compra' ? 'comprado' : 'outros'] += abs($q);
        // O rotulo do motivo vem do dominio (o mesmo que a tela recebe em /config).
        if ($l['motivo'] !== null) {
            $l['descricao'] = rotuloDe('motivos_movimentacao', $l['motivo']);
        }
        unset($l['motivo']);
        $movimentos[] = $l + ['saldo' => $saldo];
    }
    $resumo['saldo'] = $saldo;

    return ['item' => $entradas[0]['item'], 'tipo' => $entradas[0]['tipo'], 'entradas' => $entradas,
            'movimentos' => array_reverse($movimentos), 'saldo' => $saldo, 'resumo' => $resumo];
}

function zeroResumo(): array
{
    return ['entrou' => 0, 'saiu' => 0, 'comprado' => 0, 'outros' => 0, 'saldo' => 0];
}
