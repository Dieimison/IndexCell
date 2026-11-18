<?php
/**
 * api/rotas/fiscal.php - cadastros fiscais (v7). O sistema ainda NAO emite
 * nota nem calcula imposto: aqui moram os dados que a nota vai precisar e
 * que o pedido de entrada ja usa (CFOP e natureza de operacao).
 *
 *   GET  /fiscal                  dados fiscais da empresa atual + historico (admin)
 *   PUT  /fiscal/{empresa_id}     grava e registra cada campo mudado (admin)
 *   GET  /cfops                   tabela de CFOP com a configuracao da empresa (todos leem)
 *   POST /cfops                   {codigo, descricao}: CFOP que faltava (admin; oficial = 0)
 *   PUT  /cfops/{codigo}          configuracao da empresa (permitido, estoque, financeiro,
 *                                 observacao); descricao so dos nao oficiais (admin)
 *   GET  /naturezas               naturezas de operacao (todos leem)
 *   POST /naturezas, PUT /naturezas/{id}   (admin)
 */

declare(strict_types=1);

/* CRT da NF-e pelo regime: 1 Simples, 2 Simples com excesso de sublimite,
   3 regime normal, 4 MEI (NT 2024.001 - conferir com o contador). */
function crtDoRegime(?string $regime): ?int
{
    return ['mei' => 4, 'simples' => 1, 'simples_excesso' => 2, 'presumido' => 3, 'real' => 3][$regime ?? ''] ?? null;
}

/** Os dados fiscais da empresa (linha vazia se ainda nao gravou). */
function dadosFiscais(int $empresaId): array
{
    $f = consultarUm('SELECT * FROM empresa_fiscal WHERE empresa_id = ?', [$empresaId]);
    if (!$f) {
        $f = ['empresa_id' => $empresaId, 'regime' => null, 'ie' => null, 'im' => null, 'cnae' => null, 'logradouro' => null,
              'numero' => null, 'complemento' => null, 'bairro' => null, 'cep' => null, 'municipio_ibge' => null,
              'municipio' => null, 'uf' => null, 'telefone' => null, 'ambiente' => 'homologacao',
              'atualizado_em' => null, 'usuario_id' => null];
    }
    $f['crt'] = crtDoRegime($f['regime']);
    return $f;
}

const CAMPOS_FISCAIS = ['regime', 'ie', 'im', 'cnae', 'logradouro', 'numero', 'complemento', 'bairro', 'cep',
                        'municipio_ibge', 'municipio', 'uf', 'telefone', 'ambiente'];

function fiscal(?int $id, string $metodo, array $corpo, array $usuario): array
{
    $empresa = $id ? consultarUm('SELECT id, nome FROM empresas WHERE id = ?', [$id]) : empresaAtual();
    if (!$empresa) {
        throw new ErroApi(404, 'Empresa não encontrada.');
    }
    $empresaId = (int) $empresa['id'];
    if ($metodo === 'GET') {
        $historico = consultar(
            'SELECT h.campo, h.antes, h.depois, h.momento, u.nome AS usuario FROM empresa_fiscal_historico h
               LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.empresa_id = ? ORDER BY h.id DESC LIMIT 40', [$empresaId]);
        return [200, ['ok' => true, 'empresa' => $empresa, 'fiscal' => dadosFiscais($empresaId), 'historico' => $historico]];
    }
    exigir($metodo === 'PUT');
    exigirId($id);

    $atual = dadosFiscais($empresaId);
    $novo = [];
    foreach (CAMPOS_FISCAIS as $campo) {
        $novo[$campo] = array_key_exists($campo, $corpo) ? txt($corpo, $campo) : $atual[$campo];
    }
    $novo['ambiente'] = $novo['ambiente'] ?? 'homologacao';
    foreach (['regime' => 'regimes', 'uf' => 'ufs', 'ambiente' => 'ambientes'] as $campo => $dominio) {
        if ($novo[$campo] !== null && !in_array($novo[$campo], valoresDe($dominio), true)) {
            throw new ErroApi(400, rotulo($campo) . ' inválido: ' . $novo[$campo] . '.');
        }
    }
    if ($novo['municipio_ibge'] !== null && !preg_match('/^\d{7}$/', $novo['municipio_ibge'])) {
        throw new ErroApi(400, 'O código IBGE do município tem 7 números (por exemplo 3550308 para São Paulo).');
    }
    if ($novo['cep'] !== null) {
        $cep = preg_replace('/\D/', '', $novo['cep']);
        if (strlen($cep) !== 8) {
            throw new ErroApi(400, 'O CEP tem 8 números.');
        }
        $novo['cep'] = $cep;
    }
    if ($novo['ie'] !== null) {
        $ie = strtoupper(preg_replace('/[\s.\/-]/', '', $novo['ie']));
        if ($ie !== 'ISENTO' && !preg_match('/^[0-9A-Z]{2,14}$/', $ie)) {
            throw new ErroApi(400, 'Inscrição estadual: só números (sem pontos) ou ISENTO. O formato exato varia por estado.');
        }
        $novo['ie'] = $ie;
    }
    if ($novo['ambiente'] === 'producao' && $atual['ambiente'] !== 'producao') {
        // Emissao ainda nao existe: producao agora so confundiria quem olha.
        throw new ErroApi(400, 'O sistema ainda não emite nota: o ambiente fica em homologação até a etapa de emissão.');
    }

    return emTransacao(function () use ($empresaId, $atual, $novo, $usuario) {
        $mudou = [];
        foreach (CAMPOS_FISCAIS as $campo) {
            if ((string) ($atual[$campo] ?? '') !== (string) ($novo[$campo] ?? '')) {
                $mudou[] = $campo;
                executarSql('INSERT INTO empresa_fiscal_historico (empresa_id, campo, antes, depois, usuario_id) VALUES (?, ?, ?, ?, ?)',
                            [$empresaId, $campo, $atual[$campo], $novo[$campo], $usuario['id']]);
            }
        }
        if (!$mudou) {
            return [200, ['ok' => true, 'fiscal' => dadosFiscais($empresaId), 'mensagem' => 'Nada mudou.']];
        }
        $colunas = CAMPOS_FISCAIS;
        executarSql('INSERT INTO empresa_fiscal (empresa_id, ' . implode(', ', $colunas) . ', usuario_id, atualizado_em)
                     VALUES (?, ' . vagas($colunas) . ', ?, ?)
                     ON CONFLICT (empresa_id) DO UPDATE SET ' . implode(', ', array_map(fn ($c) => "{$c} = excluded.{$c}", $colunas))
                     . ', usuario_id = excluded.usuario_id, atualizado_em = excluded.atualizado_em',
                    array_merge([$empresaId], array_map(fn ($c) => $novo[$c], $colunas), [$usuario['id'], agora()]));
        return [200, ['ok' => true, 'fiscal' => dadosFiscais($empresaId),
                      'mensagem' => 'Dados fiscais gravados (' . count($mudou) . ' campo(s) mudaram).']];
    });
}

// ------------------------------------------------------------------
// CFOP
// ------------------------------------------------------------------
/** Sentido e alcance pelo 1o digito. */
function sobreCfop(string $codigo): array
{
    $d = $codigo[0] ?? '';
    return [
        'sentido' => in_array($d, ['1', '2', '3'], true) ? 'entrada' : 'saida',
        'alcance' => ['1' => 'no estado', '2' => 'de outro estado', '3' => 'do exterior',
                      '5' => 'no estado', '6' => 'para outro estado', '7' => 'para o exterior'][$d] ?? '',
    ];
}

/** O CFOP com a configuracao da empresa (padrao quando nao configurado). */
function cfopDaEmpresa(string $codigo, ?int $empresaId = null): ?array
{
    $empresaId = $empresaId ?? (int) (empresaAtual()['id'] ?? 0);
    $c = consultarUm(
        'SELECT c.codigo, c.descricao, c.oficial, ce.permitido, ce.movimenta_estoque, ce.gera_financeiro, ce.observacao,
                CASE WHEN ce.cfop IS NULL THEN 0 ELSE 1 END AS configurado
           FROM cfops c LEFT JOIN cfop_empresa ce ON ce.cfop = c.codigo AND ce.empresa_id = ?
          WHERE c.codigo = ?', [$empresaId, $codigo]);
    if (!$c) {
        return null;
    }
    $c['permitido'] = $c['permitido'] === null ? 1 : (int) $c['permitido'];
    if (!(int) $c['configurado']) {
        // Sem configuracao da loja: o efeito e o da natureza que usa este CFOP (a ligada primeiro).
        $n = consultarUm('SELECT movimenta_estoque, gera_financeiro FROM naturezas_operacao
                           WHERE cfop_interno = ? OR cfop_interestadual = ? ORDER BY ativa DESC, id LIMIT 1', [$codigo, $codigo]);
        $c['movimenta_estoque'] = $n['movimenta_estoque'] ?? 'nao';
        $c['gera_financeiro'] = $n['gera_financeiro'] ?? 'nao';
    }
    return $c + sobreCfop($codigo);
}

function cfops(?int $id, string $metodo, array $corpo, array $usuario): array
{
    $empresaId = (int) (empresaAtual()['id'] ?? 0);
    if ($metodo === 'GET') {
        if ($id) {
            $c = cfopDaEmpresa(str_pad((string) $id, 4, '0', STR_PAD_LEFT), $empresaId);
            if (!$c) {
                throw new ErroApi(404, 'CFOP não cadastrado.');
            }
            return [200, ['ok' => true, 'cfop' => $c]];
        }
        $lista = array_map(fn ($c) => cfopDaEmpresa($c['codigo'], $empresaId),
                           consultar('SELECT codigo FROM cfops ORDER BY codigo'));
        return [200, ['ok' => true, 'itens' => $lista]];
    }
    if ($usuario['perfil'] !== 'admin') {
        throw new ErroApi(403, 'Só o administrador mexe no cadastro de CFOP.');
    }

    if ($metodo === 'POST') {
        $codigo = preg_replace('/\D/', '', (string) ($corpo['codigo'] ?? ''));
        if (!preg_match('/^[123567]\d{3}$/', $codigo)) {
            throw new ErroApi(400, 'CFOP tem 4 números e começa com 1, 2 ou 3 (entrada) ou 5, 6 ou 7 (saída). Ex.: 1.102.');
        }
        $descricao = obrigatorio($corpo, 'descricao', 'Descrição');
        if (consultarUm('SELECT codigo FROM cfops WHERE codigo = ?', [$codigo])) {
            throw new ErroApi(400, 'O CFOP ' . formatarCfop($codigo) . ' já está cadastrado.');
        }
        executarSql('INSERT INTO cfops (codigo, descricao, oficial) VALUES (?, ?, 0)', [$codigo, $descricao]);
        return [201, ['ok' => true, 'cfop' => cfopDaEmpresa($codigo, $empresaId),
                      'mensagem' => 'CFOP ' . formatarCfop($codigo) . ' cadastrado. Confira a descrição com a tabela oficial.']];
    }

    if ($metodo === 'PUT') {
        $codigo = str_pad((string) exigirId($id), 4, '0', STR_PAD_LEFT);
        $atual = cfopDaEmpresa($codigo, $empresaId);
        if (!$atual) {
            throw new ErroApi(404, 'CFOP não cadastrado.');
        }
        if (array_key_exists('descricao', $corpo) && txt($corpo, 'descricao') !== $atual['descricao']) {
            if ((int) $atual['oficial'] === 1) {
                throw new ErroApi(400, 'A descrição de um CFOP oficial não muda. Use o campo Observação para a anotação da loja.');
            }
            executarSql('UPDATE cfops SET descricao = ? WHERE codigo = ?', [obrigatorio($corpo, 'descricao', 'Descrição'), $codigo]);
        }
        $estoque = txt($corpo, 'movimenta_estoque') ?? ($atual['movimenta_estoque'] ?? 'nao');
        $financeiro = txt($corpo, 'gera_financeiro') ?? ($atual['gera_financeiro'] ?? 'nao');
        if (!in_array($estoque, valoresDe('efeitos_estoque'), true) || !in_array($financeiro, valoresDe('efeitos_financeiro'), true)) {
            throw new ErroApi(400, 'Efeito no estoque ou no financeiro inválido.');
        }
        $sentido = sobreCfop($codigo)['sentido'];
        if (($sentido === 'entrada' && $estoque === 'sai') || ($sentido === 'saida' && $estoque === 'entra')) {
            throw new ErroApi(400, 'CFOP de ' . $sentido . ' não pode ' . ($estoque === 'sai' ? 'tirar do' : 'pôr no') . ' estoque.');
        }
        $permitido = array_key_exists('permitido', $corpo) ? (int) (bool) $corpo['permitido'] : (int) $atual['permitido'];
        executarSql('INSERT INTO cfop_empresa (empresa_id, cfop, permitido, movimenta_estoque, gera_financeiro, observacao, atualizado_em)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT (empresa_id, cfop) DO UPDATE SET permitido = excluded.permitido,
                        movimenta_estoque = excluded.movimenta_estoque, gera_financeiro = excluded.gera_financeiro,
                        observacao = excluded.observacao, atualizado_em = excluded.atualizado_em',
                    [$empresaId, $codigo, $permitido, $estoque, $financeiro, txtOu($corpo, 'observacao', $atual), agora()]);
        return [200, ['ok' => true, 'cfop' => cfopDaEmpresa($codigo, $empresaId), 'mensagem' => 'CFOP ' . formatarCfop($codigo) . ' gravado.']];
    }
    throw new ErroApi(405, 'CFOP não se exclui: desmarque "permitido" para a loja não usar.');
}

function formatarCfop(string $c): string
{
    return strlen($c) === 4 ? $c[0] . '.' . substr($c, 1) : $c;
}

// ------------------------------------------------------------------
// Naturezas de operacao
// ------------------------------------------------------------------
function naturezas(?int $id, string $metodo, array $corpo, array $usuario): array
{
    if ($metodo === 'GET') {
        if ($id) {
            $n = consultarUm('SELECT * FROM naturezas_operacao WHERE id = ?', [$id]);
            if (!$n) {
                throw new ErroApi(404, 'Natureza de operação não encontrada.');
            }
            return [200, ['ok' => true, 'item' => $n]];
        }
        return [200, ['ok' => true, 'itens' => consultar('SELECT * FROM naturezas_operacao ORDER BY sentido, ativa DESC, descricao')]];
    }
    if ($usuario['perfil'] !== 'admin') {
        throw new ErroApi(403, 'Só o administrador mexe nas naturezas de operação.');
    }
    exigir(in_array($metodo, ['POST', 'PUT'], true));
    $atual = null;
    if ($metodo === 'PUT') {
        $atual = consultarUm('SELECT * FROM naturezas_operacao WHERE id = ?', [exigirId($id)]);
        if (!$atual) {
            throw new ErroApi(404, 'Natureza de operação não encontrada.');
        }
    }
    $d = [
        'codigo' => strtoupper((string) preg_replace('/[^A-Za-z0-9_]/', '_', (string) (txtOu($corpo, 'codigo', $atual) ?? ''))),
        'descricao' => txtOu($corpo, 'descricao', $atual),
        'sentido' => txtOu($corpo, 'sentido', $atual) ?? 'entrada',
        'finalidade' => txtOu($corpo, 'finalidade', $atual) ?? 'normal',
        'cfop_interno' => txtOu($corpo, 'cfop_interno', $atual),
        'cfop_interestadual' => txtOu($corpo, 'cfop_interestadual', $atual),
        'movimenta_estoque' => txtOu($corpo, 'movimenta_estoque', $atual) ?? 'nao',
        'gera_financeiro' => txtOu($corpo, 'gera_financeiro', $atual) ?? 'nao',
        'exige_fornecedor' => array_key_exists('exige_fornecedor', $corpo) ? (int) (bool) $corpo['exige_fornecedor'] : (int) ($atual['exige_fornecedor'] ?? 1),
        'ativa' => array_key_exists('ativa', $corpo) ? (int) (bool) $corpo['ativa'] : (int) ($atual['ativa'] ?? 1),
    ];
    if ($d['codigo'] === '' || $d['descricao'] === null) {
        throw new ErroApi(400, 'Código e descrição da natureza são obrigatórios.');
    }
    foreach (['sentido' => 'sentidos', 'finalidade' => 'finalidades', 'movimenta_estoque' => 'efeitos_estoque',
              'gera_financeiro' => 'efeitos_financeiro'] as $campo => $dominio) {
        if (!in_array($d[$campo], valoresDe($dominio), true)) {
            throw new ErroApi(400, rotulo($campo) . ' inválido: ' . $d[$campo] . '.');
        }
    }
    foreach (['cfop_interno' => ['1', '5'], 'cfop_interestadual' => ['2', '6']] as $campo => $digitos) {
        if ($d[$campo] === null) {
            continue;
        }
        $d[$campo] = preg_replace('/\D/', '', $d[$campo]);
        if (!consultarUm('SELECT codigo FROM cfops WHERE codigo = ?', [$d[$campo]])) {
            throw new ErroApi(400, 'O CFOP ' . formatarCfop($d[$campo]) . ' não está cadastrado. Cadastre em Fiscal > CFOP.');
        }
        $esperado = $d['sentido'] === 'entrada' ? $digitos[0] : $digitos[1];
        if ($d[$campo][0] !== $esperado) {
            throw new ErroApi(400, 'O CFOP ' . formatarCfop($d[$campo]) . ' não serve aqui: ' . ($campo === 'cfop_interno' ? 'dentro do estado' : 'de outro estado')
                . ', em operação de ' . $d['sentido'] . ', o CFOP começa com ' . $esperado . '.');
        }
    }
    if (consultarUm('SELECT id FROM naturezas_operacao WHERE codigo = ? AND id <> ?', [$d['codigo'], $atual['id'] ?? 0])) {
        throw new ErroApi(400, 'Já existe uma natureza com o código ' . $d['codigo'] . '.');
    }
    $colunas = array_keys($d);
    if ($metodo === 'POST') {
        executarSql('INSERT INTO naturezas_operacao (' . implode(', ', $colunas) . ') VALUES (' . vagas($colunas) . ')', array_values($d));
        return [201, ['ok' => true, 'id' => (int) banco()->lastInsertId(), 'mensagem' => 'Natureza de operação cadastrada.']];
    }
    executarSql('UPDATE naturezas_operacao SET ' . implode(' = ?, ', $colunas) . ' = ? WHERE id = ?', array_merge(array_values($d), [$atual['id']]));
    return [200, ['ok' => true, 'mensagem' => 'Natureza de operação atualizada.']];
}
