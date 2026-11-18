<?php
/**
 * api/rotas/lancamentos.php - o financeiro: contas a pagar e a receber.
 *
 * Regra unica: TODA alteracao de lancamento passa pelas funcoes desta
 * secao (criarLancamento, gravarLancamento e as que usam gravarLancamento).
 * E por isso que o log responde "quem cancelou esta conta?" tambem nos
 * cancelamentos automaticos.
 */

declare(strict_types=1);

function criarLancamento(array $d): int
{
    $tipo = $d['tipo'] ?? 'receber';
    if (!in_array($tipo, valoresDe('tipos_lancamento'), true)) {
        throw new ErroApi(400, 'Tipo de lançamento inválido: ' . $tipo . '. Use "receber" ou "pagar".');
    }
    $status = $d['status'] ?? 'pendente';
    if (!in_array($status, valoresDe('status_lancamento'), true)) {
        throw new ErroApi(400, 'Situação de lançamento inválida: ' . $status);
    }
    $valor = round((float) ($d['valor'] ?? 0), 2);
    if ($valor <= 0) {
        throw new ErroApi(400, 'O valor do lançamento precisa ser maior que zero.');
    }
    conferirTeto($valor, 'O valor do lançamento');
    $parcela = (int) ($d['parcela'] ?? 1);
    $total   = (int) ($d['total_parcelas'] ?? 1);
    if ($parcela < 1 || $total < 1 || $parcela > $total) {
        throw new ErroApi(400, "Parcela {$parcela} de {$total}: a parcela não pode ser maior que o total de parcelas.");
    }
    if (empty($d['vencimento'])) {
        throw new ErroApi(400, 'Informe o vencimento do lançamento.');
    }
    $pagamento = $d['data_pagamento'] ?? null;
    if ($status === 'pago' && !$pagamento) {
        $pagamento = agora();
    }
    executarSql(
        'INSERT INTO lancamentos
            (tipo, descricao, categoria, valor, vencimento, data_pagamento, status, origem,
             venda_id, os_id, entrada_id, cliente_id, fornecedor_id, forma_pagamento,
             forma_pagamento_id, parcela, total_parcelas, observacoes, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$tipo, $d['descricao'], $d['categoria'] ?? null, $valor, $d['vencimento'], $status === 'pendente' ? null : $pagamento,
         $status, $d['origem'] ?? 'manual', $d['venda_id'] ?? null, $d['os_id'] ?? null, $d['entrada_id'] ?? null,
         $d['cliente_id'] ?? null, $d['fornecedor_id'] ?? null, $d['forma_pagamento'] ?? null,
         $d['forma_pagamento_id'] ?? null, $parcela, $total, $d['observacoes'] ?? null, $d['usuario_id'] ?? null]);
    return (int) banco()->lastInsertId();
}

/** Regrava um lancamento inteiro e registra no log o que mudou. */
function gravarLancamento(int $id, array $antes, array $depois, int $usuarioId, ?string $motivo = null): void
{
    executarSql(
        'UPDATE lancamentos
            SET tipo = ?, descricao = ?, categoria = ?, valor = ?, vencimento = ?, data_pagamento = ?, status = ?,
                cliente_id = ?, fornecedor_id = ?, forma_pagamento = ?, forma_pagamento_id = ?, parcela = ?,
                total_parcelas = ?, observacoes = ?
          WHERE id = ?',
        [$depois['tipo'], $depois['descricao'], $depois['categoria'], $depois['valor'], $depois['vencimento'],
         $depois['data_pagamento'], $depois['status'], $depois['cliente_id'], $depois['fornecedor_id'],
         $depois['forma_pagamento'], $depois['forma_pagamento_id'], $depois['parcela'], $depois['total_parcelas'],
         $depois['observacoes'], $id]);
    registrarLogLancamento($id, $antes, $depois, $usuarioId, $motivo);
}

/*
 * Cancela as contas de um documento (venda, OS ou entrada). UMA regra:
 * pendente E paga viram 'cancelado' (a paga e estorno; nunca e apagada).
 * Com $soPendentes, as pagas ficam como estao (venda que mudou de valor
 * depois de recebida).
 */
function cancelarLancamentos(string $coluna, int $documentoId, string $motivo, int $usuarioId, bool $soPendentes = false): int
{
    if (!in_array($coluna, ['venda_id', 'os_id', 'entrada_id', 'pedido_id'], true)) {
        throw new LogicException('Coluna de documento invalida: ' . $coluna);
    }
    $quantos = 0;
    $filtro = $soPendentes ? "status = 'pendente'" : "status <> 'cancelado'";
    foreach (consultar('SELECT * FROM lancamentos WHERE ' . $coluna . ' = ? AND ' . $filtro, [$documentoId]) as $antes) {
        $depois = $antes;
        $depois['status'] = 'cancelado';
        $depois['observacoes'] = trim(($antes['observacoes'] ?? '') . ' [' . $motivo . ']');
        gravarLancamento((int) $antes['id'], $antes, $depois, $usuarioId, $motivo);
        $quantos++;
    }
    return $quantos;
}

/** A venda mudou de cliente: as contas dela acompanham (com log). */
function trocarClienteDosLancamentos(int $vendaId, ?int $clienteId, int $usuarioId): void
{
    foreach (consultar("SELECT * FROM lancamentos WHERE venda_id = ? AND status <> 'cancelado'", [$vendaId]) as $antes) {
        gravarLancamento((int) $antes['id'], $antes, ['cliente_id' => $clienteId] + $antes, $usuarioId, 'cliente da venda alterado');
    }
}

/** A venda mudou de forma depois de parte paga: so as pendentes trocam (com log). */
function trocarFormaDosPendentes(int $vendaId, ?int $formaId, ?string $forma, int $usuarioId): void
{
    foreach (consultar("SELECT * FROM lancamentos WHERE venda_id = ? AND status = 'pendente'", [$vendaId]) as $antes) {
        gravarLancamento((int) $antes['id'], $antes,
            ['forma_pagamento_id' => $formaId, 'forma_pagamento' => $forma] + $antes, $usuarioId, 'forma de pagamento alterada');
    }
}

/* Renomear uma forma atualiza o texto guardado (o id nao muda; nao vai para o log). */
function renomearFormaNosLancamentos(int $formaId, string $nome): void
{
    executarSql('UPDATE lancamentos SET forma_pagamento = ? WHERE forma_pagamento_id = ?', [$nome, $formaId]);
}

/* De onde veio um lancamento automatico, para a mensagem dizer onde mexer. */
function documentoDoLancamento(array $l): string
{
    if ($l['venda_id']) {
        $v = consultarUm('SELECT numero FROM vendas WHERE id = ?', [$l['venda_id']]);
        return 'da venda ' . ($v['numero'] ?? '#' . $l['venda_id']);
    }
    if ($l['os_id']) {
        $o = consultarUm('SELECT numero FROM ordens_servico WHERE id = ?', [$l['os_id']]);
        return 'da ' . ($o['numero'] ?? 'OS #' . $l['os_id']);
    }
    if (!empty($l['pedido_id'])) {
        $p = consultarUm('SELECT numero FROM pedidos WHERE id = ?', [$l['pedido_id']]);
        return 'do pedido de entrada ' . ($p['numero'] ?? '#' . $l['pedido_id']);
    }
    return $l['origem'] === 'entrada' ? 'de uma compra (entrada de estoque)' : 'de um documento';
}

/* O documento de origem ainda vale? (venda concluida, OS entregue) */
function documentoAtivo(array $l): bool
{
    if ($l['venda_id']) {
        return (bool) consultarUm("SELECT id FROM vendas WHERE id = ? AND status = 'concluida'", [$l['venda_id']]);
    }
    if ($l['os_id']) {
        return (bool) consultarUm("SELECT id FROM ordens_servico WHERE id = ? AND status = 'entregue'", [$l['os_id']]);
    }
    return false;
}

/*
 * O que a tela pode oferecer para o lancamento, calculado aqui. O
 * financeiro e so do admin; para os outros perfis tudo e falso.
 */
function permissoesLancamento(array $l, array $usuario): array
{
    $admin = $usuario['perfil'] === 'admin';
    $manual = $l['origem'] === 'manual';
    $ativo = $l['status'] !== 'cancelado';
    return $l + [
        'pode_editar_valor' => $admin && $manual && $ativo,
        'pode_excluir'      => $admin && $manual && $l['status'] === 'pendente',
        'pode_cancelar'     => $admin && $ativo && ($manual || !documentoAtivo($l)),
    ];
}

function lancamentos(?int $id, string $metodo, array $corpo, array $usuario, array $consulta): array
{
    if ($metodo === 'GET' && $id) {
        $lanc = consultarUm('SELECT * FROM lancamentos WHERE id = ?', [$id]);
        if (!$lanc) {
            throw new ErroApi(404, 'Lançamento não encontrado.');
        }
        return [200, ['ok' => true, 'lancamento' => permissoesLancamento($lanc, $usuario),
            'log' => consultar('SELECT g.*, u.nome AS usuario FROM lancamentos_log g
                                  LEFT JOIN usuarios u ON u.id = g.usuario_id
                                 WHERE g.lancamento_id = ? ORDER BY g.id DESC', [$id])]];
    }

    if ($metodo === 'GET') {
        $onde = [];
        $par  = [];
        foreach (['tipo' => 'tipos_lancamento', 'status' => 'status_lancamento'] as $campo => $dominio) {
            $valor = (string) ($consulta[$campo] ?? '');
            if ($valor !== '' && in_array($valor, valoresDe($dominio), true)) {
                $onde[] = 'l.' . $campo . ' = ?';
                $par[]  = $valor;
            }
        }
        if (!empty($consulta['de'])) {
            $onde[] = 'COALESCE(l.vencimento, substr(l.criado_em, 1, 10)) >= ?';
            $par[]  = (string) $consulta['de'];
        }
        if (!empty($consulta['ate'])) {
            $onde[] = 'COALESCE(l.vencimento, substr(l.criado_em, 1, 10)) <= ?';
            $par[]  = (string) $consulta['ate'];
        }
        // l.* traz 'origem'; as permissoes dizem a tela o que travar.
        $itens = consultar(
            'SELECT l.*, c.nome AS cliente, f.nome AS fornecedor, v.numero AS venda_numero, o.numero AS os_numero
               FROM lancamentos l
               LEFT JOIN clientes c ON c.id = l.cliente_id
               LEFT JOIN fornecedores f ON f.id = l.fornecedor_id
               LEFT JOIN vendas v ON v.id = l.venda_id
               LEFT JOIN ordens_servico o ON o.id = l.os_id' . ($onde ? ' WHERE ' . implode(' AND ', $onde) : '') .
            " ORDER BY CASE l.status WHEN 'pendente' THEN 1 ELSE 2 END, COALESCE(l.vencimento, substr(l.criado_em, 1, 10)), l.id",
            $par);
        return [200, ['ok' => true, 'itens' => array_map(fn ($l) => permissoesLancamento($l, $usuario), $itens)]];
    }

    if ($metodo === 'POST') {
        $novo = criarLancamento(dadosLancamento($corpo, null) + ['usuario_id' => (int) $usuario['id']]);
        return [201, ['ok' => true, 'id' => $novo, 'mensagem' => 'Lançamento registrado.']];
    }

    if ($metodo === 'PUT') {
        $id = exigirId($id);
        return emTransacao(function () use ($id, $corpo, $usuario) {
            $atual = consultarUm('SELECT * FROM lancamentos WHERE id = ?', [$id]);
            if (!$atual) {
                throw new ErroApi(404, 'Lançamento não encontrado.');
            }
            // Baixa dada em duas abas: a segunda nao "registra" de novo.
            if (array_keys($corpo) === ['status'] && $corpo['status'] === 'pago' && $atual['status'] === 'pago') {
                throw new ErroApi(409, 'Este lançamento já tinha recebido baixa em ' . dataBr($atual['data_pagamento'])
                    . '. Nada foi alterado.');
            }
            $d = dadosLancamento($corpo, $atual);
            // Lancamento gerado por documento segue o documento.
            if ($atual['origem'] !== 'manual') {
                $doc = documentoDoLancamento($atual);
                if (emCentavos($d['valor']) !== emCentavos($atual['valor']) || $d['tipo'] !== $atual['tipo']) {
                    throw new ErroApi(400, "Este lançamento é {$doc}: o valor e o tipo vêm de lá. "
                        . 'Para mudar, altere o documento (na venda, pelo desconto).');
                }
                if ($atual['status'] === 'cancelado' && $d['status'] !== 'cancelado') {
                    throw new ErroApi(400, "Este lançamento é {$doc} e foi cancelado junto com ele. "
                        . 'Conta cancelada de documento não volta; registre o documento de novo.');
                }
                if ($d['status'] === 'cancelado' && $atual['status'] !== 'cancelado' && documentoAtivo($atual)) {
                    throw new ErroApi(400, "Este lançamento é {$doc}. Para cancelá-lo, cancele o documento: "
                        . 'a conta sai junto e o estoque volta.');
                }
            }
            gravarLancamento($id, $atual, $d, (int) $usuario['id']);
            return [200, ['ok' => true, 'mensagem' => 'Lançamento atualizado.']];
        });
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        $atual = consultarUm('SELECT * FROM lancamentos WHERE id = ?', [$id]);
        if (!$atual) {
            throw new ErroApi(404, 'Lançamento não encontrado.');
        }
        // So se exclui o MANUAL e PENDENTE (o digitado errado, que nunca virou dinheiro).
        if ($atual['origem'] !== 'manual') {
            throw new ErroApi(400, 'Este lançamento é ' . documentoDoLancamento($atual) . ' e não se exclui '
                . 'pelo Financeiro. Cancele ou exclua o documento: a conta sai junto.');
        }
        if ($atual['status'] !== 'pendente') {
            throw new ErroApi(400, $atual['status'] === 'pago'
                ? 'Lançamento já quitado não se exclui: mude a situação para "cancelado". O estorno fica no histórico.'
                : 'Lançamento cancelado não se exclui: ele é o registro de que a conta existiu.');
        }
        executarSql('DELETE FROM lancamentos WHERE id = ?', [$id]);
        return [200, ['ok' => true, 'mensagem' => 'Lançamento excluído.']];
    }

    throw new ErroApi(405, 'Método não permitido para /api/lancamentos.');
}

/*
 * Grava no log o que mudou de fato: so os campos de dinheiro e de quem
 * paga/recebe, com nomes (nao ids). Cancelamento automatico ganha a
 * linha "Motivo".
 */
function registrarLogLancamento(int $id, array $antes, array $depois, int $usuarioId, ?string $motivo = null): void
{
    $vigiados = ['valor' => 'Valor', 'vencimento' => 'Vencimento', 'status' => 'Situação', 'tipo' => 'Tipo',
                 'parcela' => 'Parcela', 'total_parcelas' => 'Total de parcelas', 'cliente_id' => 'Cliente',
                 'fornecedor_id' => 'Fornecedor', 'forma_pagamento_id' => 'Forma de pagamento'];
    $nomeDe = ['cliente_id' => 'clientes', 'fornecedor_id' => 'fornecedores', 'forma_pagamento_id' => 'formas_pagamento'];
    $legivel = function (string $campo, $valor) use ($nomeDe) {
        if ($valor === null || $valor === '') {
            return '—';
        }
        if ($campo === 'valor') {
            return moedaBr((float) $valor);
        }
        if (isset($nomeDe[$campo])) {
            return consultarUm('SELECT nome FROM ' . $nomeDe[$campo] . ' WHERE id = ?', [$valor])['nome'] ?? ('#' . $valor);
        }
        return (string) $valor;
    };
    $gravou = false;
    foreach ($vigiados as $campo => $rotulo) {
        $de = $antes[$campo] ?? null;
        $para = $depois[$campo] ?? null;
        if ((string) $de === (string) $para || (is_numeric($de) && is_numeric($para) && (float) $de === (float) $para)) {
            continue;
        }
        executarSql('INSERT INTO lancamentos_log (lancamento_id, campo, valor_antes, valor_depois, usuario_id) VALUES (?, ?, ?, ?, ?)',
            [$id, $rotulo, $legivel($campo, $de), $legivel($campo, $para), $usuarioId]);
        $gravou = true;
    }
    if ($gravou && $motivo !== null) {
        executarSql('INSERT INTO lancamentos_log (lancamento_id, campo, valor_antes, valor_depois, usuario_id) VALUES (?, ?, ?, ?, ?)',
            [$id, 'Motivo', '—', $motivo, $usuarioId]);
    }
}

/* Corpo de um lancamento manual (POST) ou de uma edicao (PUT, que preserva o que nao veio). */
function dadosLancamento(array $corpo, ?array $atual): array
{
    [$formaId, $formaNome] = formaDePagamento($corpo, $atual);
    $tipo = txt($corpo, 'tipo') ?? ($atual['tipo'] ?? 'receber');
    if (!in_array($tipo, valoresDe('tipos_lancamento'), true)) {
        throw new ErroApi(400, 'Tipo inválido: use "receber" ou "pagar".');
    }
    $status = txt($corpo, 'status') ?? ($atual['status'] ?? 'pendente');
    if (!in_array($status, valoresDe('status_lancamento'), true)) {
        throw new ErroApi(400, 'Situação inválida: ' . $status . '. Use pendente, pago ou cancelado.');
    }
    $valor = dinheiro($corpo, 'valor', 'Valor', (float) ($atual['valor'] ?? 0));
    if ($valor <= 0) {
        throw new ErroApi(400, 'O valor do lançamento precisa ser maior que zero.');
    }
    $vencimento = array_key_exists('vencimento', $corpo) ? dataDoCorpo($corpo, 'vencimento', 'Vencimento') : ($atual['vencimento'] ?? null);
    if (!$vencimento) {
        throw new ErroApi(400, 'Informe o vencimento do lançamento.');
    }
    $total   = inteiro($corpo, 'total_parcelas', 'Total de parcelas', 1, 999, (int) ($atual['total_parcelas'] ?? 1));
    $parcela = inteiro($corpo, 'parcela', 'Parcela', 1, 999, (int) ($atual['parcela'] ?? 1));
    if ($parcela > $total) {
        throw new ErroApi(400, "Parcela {$parcela} de {$total}: a parcela não pode ser maior que o total de parcelas.");
    }
    // Baixa carimba a data; voltar a pendente limpa; cancelado guarda a que tinha.
    $pagamento = dataDoCorpo($corpo, 'data_pagamento', 'Data do pagamento', true) ?? ($atual['data_pagamento'] ?? null);
    if ($status === 'pago' && !$pagamento) {
        $pagamento = agora();
    }
    if ($status === 'pendente') {
        $pagamento = null;
    }
    $clienteId = array_key_exists('cliente_id', $corpo) ? idDoCatalogo($corpo, 'cliente_id', null)
               : (isset($atual['cliente_id']) ? (int) $atual['cliente_id'] : null);
    if ($clienteId) {
        exigirExistente('clientes', $clienteId, 'Cliente informado não existe.');
    }
    $fornecedorId = array_key_exists('fornecedor_id', $corpo) ? idDoCatalogo($corpo, 'fornecedor_id', null)
                  : (isset($atual['fornecedor_id']) ? (int) $atual['fornecedor_id'] : null);
    if ($fornecedorId) {
        exigirExistente('fornecedores', $fornecedorId, 'Fornecedor informado não existe.');
    }
    return [
        'tipo' => $tipo,
        'descricao' => $atual === null ? obrigatorio($corpo, 'descricao') : (txt($corpo, 'descricao') ?? $atual['descricao']),
        'categoria' => listaOu('categorias_lancamento', $corpo, 'categoria', $atual), 'valor' => $valor, 'vencimento' => $vencimento,
        'data_pagamento' => $pagamento, 'status' => $status, 'origem' => $atual['origem'] ?? 'manual',
        'venda_id' => $atual['venda_id'] ?? null, 'os_id' => $atual['os_id'] ?? null, 'entrada_id' => $atual['entrada_id'] ?? null,
        'cliente_id' => $clienteId, 'fornecedor_id' => $fornecedorId, 'forma_pagamento' => $formaNome,
        'forma_pagamento_id' => $formaId, 'parcela' => $parcela, 'total_parcelas' => $total,
        'observacoes' => txtOu($corpo, 'observacoes', $atual),
    ];
}
