<?php
/**
 * api/rotas/catalogo.php - os cadastros (clientes, fornecedores, modelos,
 * pecas, produtos, servicos, formas de pagamento).
 *
 * Os sete tem as mesmas quatro operacoes, entao sao UMA funcao,
 * crudCatalogo(), guiada por uma tabela de configuracao (catalogos()).
 * Cada cadastro diz: seus campos e tipos, como e a lista, o que impede
 * excluir, e o que tem de proprio (nome unico, forma padrao...). Corrigir
 * o CRUD e corrigir num lugar so.
 */

declare(strict_types=1);

/*
 * Campos: [tipo, rotulo, opcoes]. Tipos: texto, dinheiro, inteiro (min,
 * max, padrao), ativo (0/1), enum (dominio, padrao), id (tabela, frase).
 * No PUT, campo que nao veio no corpo continua como esta gravado.
 */
function catalogos(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $texto = fn (string $rotulo, bool $obrigatorio = false) => ['texto', $rotulo, ['obrigatorio' => $obrigatorio]];
    $contato = ['nome' => $texto('Nome', true), 'telefone' => $texto('Telefone'), 'documento' => $texto('CPF/CNPJ'),
                'email' => $texto('E-mail'), 'endereco' => $texto('Endereço'), 'observacoes' => $texto('Observações')];
    // v7: o que a nota fiscal pede do item (NCM 8 numeros, CEST 7, origem 0-8).
    $fiscal = ['ncm' => ['digitos', 'NCM', ['tamanho' => 8]], 'cest' => ['digitos', 'CEST', ['tamanho' => 7]],
               'origem' => ['enum', 'Origem da mercadoria', ['dominio' => 'origens_mercadoria', 'opcional' => true]],
               'unidade' => ['unidade', 'Unidade', []], 'gtin' => ['digitos', 'GTIN (código de barras)', ['tamanhos' => [8, 12, 13, 14]]]];

    $c = [
        'clientes' => [
            'tabela' => 'clientes', 'artigo' => 'o', 'nome' => 'Cliente',
            'lista'  => 'SELECT c.*, (SELECT COUNT(*) FROM ordens_servico o WHERE o.cliente_id = c.id) AS ordens FROM clientes c',
            'alias'  => 'c', 'ordem' => 'c.nome',
            'campos' => $contato,
            'conferir' => 'conferirClienteRepetido',
            'usos' => [['SELECT COUNT(*) FROM ordens_servico WHERE cliente_id = :id', '%d ordem(ns) de serviço'],
                       ['SELECT COUNT(*) FROM vendas WHERE cliente_id = :id', '%d venda(s)']],
            'em_uso' => 'Este cliente tem %s e não pode ser excluído - o histórico ficaria sem dono.',
        ],
        'fornecedores' => [
            'tabela' => 'fornecedores', 'artigo' => 'o', 'nome' => 'Fornecedor',
            'lista'  => 'SELECT f.* FROM fornecedores f', 'alias' => 'f', 'ordem' => 'f.nome',
            'campos' => $contato + ['ie' => $texto('Inscrição estadual'),
                                    'uf' => ['enum', 'UF', ['dominio' => 'ufs', 'opcional' => true]]],
            'usos' => [['SELECT COUNT(*) FROM entradas WHERE fornecedor_id = :id', '%d entrada(s)'],
                       ['SELECT COUNT(*) FROM lancamentos WHERE fornecedor_id = :id', '%d conta(s) no financeiro']],
            'em_uso' => 'Este fornecedor tem %s e não pode ser excluído - o histórico ficaria sem dono.',
        ],
        'modelos' => [
            'tabela' => 'modelos', 'artigo' => 'o', 'nome' => 'Modelo',
            'lista'  => 'SELECT m.*, ' . sqlNomeModelo('m') . ' AS nome,
                               (SELECT COUNT(*) FROM entradas  e WHERE e.modelo_id = m.id) AS em_estoque,
                               (SELECT COUNT(*) FROM aparelhos a WHERE a.modelo_id = m.id) AS aparelhos
                          FROM modelos m',
            'alias'  => 'm', 'ordem' => 'm.marca, m.modelo',
            'campos' => ['marca' => ['texto', 'Marca', ['vazio' => '', 'lista' => 'marcas']], 'modelo' => $texto('Modelo', true),
                         'armazenamento' => ['texto', 'Armazenamento', ['vazio' => '', 'lista' => 'armazenamentos']],
                         'observacoes' => $texto('Observações')] + $fiscal,
            'conferir' => 'conferirModeloRepetido',
            'usos' => [['SELECT (SELECT COUNT(*) FROM entradas WHERE modelo_id = :id) + (SELECT COUNT(*) FROM aparelhos WHERE modelo_id = :id)
                                + (SELECT COUNT(*) FROM pecas WHERE modelo_id = :id)', '%d']],
            'em_uso' => 'Este modelo está em uso em %s registro(s) e não pode ser excluído.',
        ],
        'pecas' => [
            'tabela' => 'pecas', 'artigo' => 'a', 'nome' => 'Peça',
            'lista'  => 'SELECT p.*, ' . sqlNomeModelo('m') . ' AS modelo_nome,
                               COALESCE((SELECT SUM(s.saldo) FROM entradas e JOIN vw_entradas_saldo s ON s.entrada_id = e.id
                                          WHERE e.peca_id = p.id), 0) AS saldo
                          FROM pecas p LEFT JOIN modelos m ON m.id = p.modelo_id',
            'alias'  => 'p', 'ordem' => 'p.categoria, p.nome',
            'campos' => ['nome' => $texto('Nome', true), 'categoria' => ['enum', 'Categoria', ['dominio' => 'categorias_peca', 'padrao' => 'outra']],
                         'modelo_id' => ['id', 'Modelo', ['tabela' => 'modelos', 'frase' => 'Modelo informado não existe.']],
                         'codigo' => $texto('Código'), 'observacoes' => $texto('Observações')] + $fiscal,
            'usos' => [['SELECT COUNT(*) FROM entradas WHERE peca_id = :id', '%d entrada(s)']],
            'em_uso' => 'Esta peça tem %s e não pode ser excluída.',
        ],
        'produtos' => [
            'tabela' => 'produtos', 'artigo' => 'o', 'nome' => 'Produto',
            'lista'  => 'SELECT p.*, COALESCE((SELECT SUM(s.saldo) FROM entradas e JOIN vw_entradas_saldo s ON s.entrada_id = e.id
                                                WHERE e.produto_id = p.id), 0) AS saldo
                          FROM produtos p',
            'alias'  => 'p', 'ordem' => 'p.nome',
            'campos' => ['nome' => $texto('Nome', true), 'categoria' => ['texto', 'Categoria', ['lista' => 'categorias_produto']],
                         'marca' => ['texto', 'Marca', ['lista' => 'marcas']],
                         'codigo' => $texto('Código'), 'observacoes' => $texto('Observações')] + $fiscal,
            'usos' => [['SELECT COUNT(*) FROM entradas WHERE produto_id = :id', '%d entrada(s)']],
            'em_uso' => 'Este produto tem %s e não pode ser excluído.',
        ],
        'servicos' => [
            'tabela' => 'servicos', 'artigo' => 'o', 'nome' => 'Serviço',
            'lista'  => 'SELECT s.*, (SELECT COUNT(*) FROM os_itens i WHERE i.servico_id = s.id) AS usos,
                               COALESCE((SELECT SUM(i.subtotal) FROM os_itens i WHERE i.servico_id = s.id), 0) AS faturado
                          FROM servicos s',
            'alias'  => 's', 'ordem' => 's.ativo DESC, s.nome', 'filtro_ativos' => 'ativos', 'nome_unico' => 'o serviço',
            'campos' => ['nome' => $texto('Nome', true), 'descricao' => $texto('Descrição'),
                         'valor_padrao' => ['dinheiro', 'Preço', []],
                         'tempo_medio' => ['inteiro', 'Tempo médio (minutos)', ['min' => 0, 'max' => TEMPO_MEDIO_MAXIMO]],
                         'ativo' => ['ativo', 'Ativo', []]],
            'usos' => [['SELECT COUNT(*) FROM os_itens WHERE servico_id = :id', '%d']],
            'em_uso' => 'Este serviço está em %s ordem(ns) de serviço e não pode ser excluído. '
                      . 'Desative-o: ele some da lista e o histórico continua com o nome do serviço.',
        ],
        'formas-pagamento' => [
            'tabela' => 'formas_pagamento', 'artigo' => 'a', 'nome' => 'Forma de pagamento',
            'lista'  => 'SELECT f.*, ' . implode(' + ', array_map(
                            fn ($t) => "(SELECT COUNT(*) FROM \"{$t}\" x WHERE x.forma_pagamento_id = f.id)", USOS_DA_FORMA))
                      . ' AS usos FROM formas_pagamento f',
            'alias'  => 'f', 'ordem' => 'f.ordem, f.nome', 'filtro_ativos' => 'ativas', 'nome_unico' => 'uma forma de pagamento chamada',
            'campos' => ['nome' => $texto('Nome', true), 'tipo' => ['enum', 'Tipo', ['dominio' => 'tipos_pagamento', 'padrao' => 'vista']],
                         'parcelas_padrao' => ['inteiro', 'Parcelas sugeridas', ['min' => 1, 'max' => PARCELAS_MAX, 'padrao' => 1]],
                         'ativo' => ['ativo', 'Ativa', []],
                         'ordem' => ['inteiro', 'Ordem', ['min' => 0, 'max' => 100000]],
                         'observacoes' => $texto('Observações')],
            'conferir' => 'conferirFormaDePagamento',
            'depois'   => 'depoisDeGravarForma',
            'saida'    => fn (array $f) => ['padrao' => (int) ($f['padrao'] ?? 0) === 1] + $f,
            'usos'     => [['SELECT ' . implode(' + ', array_map(fn ($t) => "(SELECT COUNT(*) FROM \"{$t}\" WHERE forma_pagamento_id = :id)", USOS_DA_FORMA)), '%d']],
            'em_uso'   => 'Esta forma de pagamento está em %s registro(s) e não pode ser excluída. '
                        . 'Desative-a: ela some das listas e o histórico continua correto.',
        ],
    ];
    return $c;
}

/* Onde uma forma pode estar em uso (os_pagamentos entra: a 2a forma de uma OS tambem e uso). */
const USOS_DA_FORMA = ['vendas', 'ordens_servico', 'lancamentos', 'os_pagamentos'];

/** O CRUD de qualquer cadastro, guiado pela configuracao. */
function crudCatalogo(string $nomeRota, ?int $id, string $metodo, array $corpo, array $consulta): array
{
    $cat   = catalogos()[$nomeRota];
    $artigo = $cat['artigo'];
    $naoAchou = $cat['nome'] . ' não encontrad' . $artigo . '.';
    $saida = $cat['saida'] ?? fn (array $l) => $l;

    if ($metodo === 'GET') {
        $sql = $cat['lista'];
        if ($id) {
            $item = consultarUm($sql . ' WHERE ' . $cat['alias'] . '.id = ?', [$id]);
            if (!$item) {
                throw new ErroApi(404, $naoAchou);
            }
            return [200, ['ok' => true, 'item' => $saida($item)]];
        }
        // O filtro de ativos tem UM nome por cadastro, lido aqui as claras.
        if (isset($cat['filtro_ativos']) && !empty($consulta[$cat['filtro_ativos']])) {
            $sql .= ' WHERE ' . $cat['alias'] . '.ativo = 1';
        }
        return [200, ['ok' => true, 'itens' => array_map($saida, consultar($sql . ' ORDER BY ' . $cat['ordem']))]];
    }

    if ($metodo === 'POST' || $metodo === 'PUT') {
        return emTransacao(function () use ($cat, $nomeRota, $id, $metodo, $corpo, $artigo, $naoAchou) {
            $atual = null;
            if ($metodo === 'PUT') {
                $id = exigirId($id);
                $atual = consultarUm('SELECT * FROM "' . $cat['tabela'] . '" WHERE id = ?', [$id]);
                if (!$atual) {
                    throw new ErroApi(404, $naoAchou);
                }
            }
            $dados = lerCamposDoCatalogo($cat['campos'], $corpo, $atual);
            if (isset($cat['nome_unico'])) {
                $igual = consultarUm('SELECT id, nome FROM "' . $cat['tabela'] . '" WHERE minusculas(nome) = minusculas(?) AND id <> ?',
                                     [$dados['nome'], $id ?? 0]);
                if ($igual) {
                    throw new ErroApi(400, 'Já existe ' . $cat['nome_unico'] . ' "' . $igual['nome'] . '".');
                }
            }
            if (isset($cat['conferir'])) {
                $dados = ($cat['conferir'])($dados, $id, $atual, $corpo);
            }

            $colunas = array_keys($dados);
            if ($metodo === 'POST') {
                executarSql('INSERT INTO "' . $cat['tabela'] . '" (' . implode(', ', $colunas) . ') VALUES (' . vagas($colunas) . ')',
                            array_values($dados));
                $id = (int) banco()->lastInsertId();
            } else {
                executarSql('UPDATE "' . $cat['tabela'] . '" SET ' . implode(' = ?, ', $colunas) . ' = ? WHERE id = ?',
                            array_merge(array_values($dados), [$id]));
            }
            if (isset($cat['depois'])) {
                ($cat['depois'])($id, $dados, $atual, $corpo);
            }
            $verbo = $metodo === 'POST' ? 'cadastrad' : 'atualizad';
            return $metodo === 'POST'
                ? [201, ['ok' => true, 'id' => $id, 'mensagem' => $cat['nome'] . ' ' . $verbo . $artigo . '.']]
                : [200, ['ok' => true, 'mensagem' => $cat['nome'] . ' ' . $verbo . $artigo . '.']];
        });
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        if (!consultarUm('SELECT id FROM "' . $cat['tabela'] . '" WHERE id = ?', [$id])) {
            throw new ErroApi(404, $naoAchou);
        }
        $usos = [];
        foreach ($cat['usos'] as [$sql, $frase]) {
            $st = banco()->prepare($sql);
            $st->execute([':id' => $id]);
            $n = (int) $st->fetchColumn();
            if ($n > 0) {
                $usos[] = sprintf($frase, $n);
            }
        }
        if ($usos) {
            throw new ErroApi(400, sprintf($cat['em_uso'], implode(' e ', $usos)));
        }
        if ($nomeRota === 'formas-pagamento') {
            conferirFormaNaoPadrao($id, 'excluir');
        }
        executarSql('DELETE FROM "' . $cat['tabela'] . '" WHERE id = ?', [$id]);
        return [200, ['ok' => true, 'mensagem' => $cat['nome'] . ' excluíd' . $artigo . '.']];
    }

    throw new ErroApi(405, 'Método não permitido para /api/' . $nomeRota . '.');
}

/** Le os campos de um cadastro do corpo (PUT preserva o que nao veio). */
function lerCamposDoCatalogo(array $campos, array $corpo, ?array $atual): array
{
    $dados = [];
    foreach ($campos as $campo => [$tipo, $rotulo, $op]) {
        $veioNoCorpo = array_key_exists($campo, $corpo);
        if (!$veioNoCorpo && $atual !== null) {
            $dados[$campo] = $atual[$campo];
            continue;
        }
        switch ($tipo) {
            case 'texto':
                $valor = !empty($op['obrigatorio']) ? obrigatorio($corpo, $campo, $rotulo) : txt($corpo, $campo, $rotulo);
                if (isset($op['lista'])) {
                    // Grafia da lista ("apple" -> "Apple"); valor novo entra nela.
                    $valor = valorDaLista($op['lista'], $valor);
                }
                $dados[$campo] = $valor ?? ($op['vazio'] ?? null);
                break;
            case 'dinheiro':
                $dados[$campo] = dinheiro($corpo, $campo, $rotulo, 0.0);
                break;
            case 'inteiro':
                $dados[$campo] = inteiro($corpo, $campo, $rotulo, $op['min'], $op['max'], $op['padrao'] ?? null);
                break;
            case 'ativo':
                $dados[$campo] = $veioNoCorpo ? (int) (bool) $corpo[$campo] : 1;
                break;
            case 'digitos':
                // So numeros (pontos e espacos saem); tamanho exato, ou um dos tamanhos.
                $valor = txt($corpo, $campo, $rotulo);
                if ($valor !== null) {
                    $valor = (string) preg_replace('/\D/', '', $valor);
                    $tamanhos = $op['tamanhos'] ?? [$op['tamanho']];
                    if (!in_array(strlen($valor), $tamanhos, true)) {
                        throw new ErroApi(400, $rotulo . ' tem ' . implode(', ', array_slice($tamanhos, 0, -1))
                            . (count($tamanhos) > 1 ? ' ou ' : '') . end($tamanhos) . ' números.');
                    }
                }
                $dados[$campo] = $valor;
                break;
            case 'unidade':
                $dados[$campo] = strtoupper(txt($corpo, $campo, $rotulo) ?? 'UN');
                if (!preg_match('/^[A-Z0-9]{1,6}$/', $dados[$campo])) {
                    throw new ErroApi(400, 'Unidade: até 6 letras, como UN, CX, PC, KIT.');
                }
                break;
            case 'enum':
                if (!empty($op['opcional']) && txt($corpo, $campo, $rotulo) === null) {
                    $dados[$campo] = null;
                    break;
                }
                $valor = txt($corpo, $campo, $rotulo) ?? $op['padrao'];
                if (!in_array($valor, valoresDe($op['dominio']), true)) {
                    throw new ErroApi(400, $rotulo . ' inválid' . ($rotulo === 'Tipo' ? 'o' : 'a') . ': ' . $valor . '.');
                }
                $dados[$campo] = $valor;
                break;
            case 'id':
                $valor = idDoCatalogo($corpo, $campo, null);
                if ($valor) {
                    exigirExistente($op['tabela'], $valor, $op['frase']);
                }
                $dados[$campo] = $valor;
                break;
        }
    }
    return $dados;
}

/*
 * Nome igual nao basta para dizer que e a mesma pessoa (dois "Joao Silva"
 * existem, e sem telefone e normal). Nome igual E o mesmo telefone
 * preenchido, sim: isso e cadastro duplicado.
 */
function conferirClienteRepetido(array $d, ?int $id, ?array $atual, array $corpo): array
{
    $digitos = (string) preg_replace('/\D/', '', (string) $d['telefone']);
    if ($digitos === '') {
        return $d;
    }
    foreach (consultar('SELECT id, nome, telefone FROM clientes WHERE minusculas(nome) = minusculas(?) AND id <> ?',
                       [$d['nome'], $id ?? 0]) as $outro) {
        if ((string) preg_replace('/\D/', '', (string) $outro['telefone']) === $digitos) {
            throw new ErroApi(400, 'Já existe o cliente "' . $outro['nome'] . '" com este telefone. Use o cadastro que já existe.');
        }
    }
    return $d;
}

/** O modelo com este nome (sem acento nem caixa), se existir. */
function modeloIgual(string $marca, string $modelo, string $armazenamento): ?array
{
    return consultarUm(
        'SELECT id FROM modelos WHERE minusculas(marca) = minusculas(?) AND minusculas(modelo) = minusculas(?)
            AND minusculas(armazenamento) = minusculas(?)', [$marca, $modelo, $armazenamento]);
}

function conferirModeloRepetido(array $d, ?int $id, ?array $atual, array $corpo): array
{
    $igual = modeloIgual((string) $d['marca'], (string) $d['modelo'], (string) $d['armazenamento']);
    if ($igual && (int) $igual['id'] !== (int) ($id ?? 0)) {
        throw new ErroApi(400, 'Já existe o modelo "' . nomeModelo($d['marca'], (string) $d['modelo'], $d['armazenamento']) . '".');
    }
    return $d;
}

/*
 * Forma de pagamento:
 *   - forma nova sem ordem nasce DEPOIS da ultima (ordem 0 a punha no
 *     topo e ela virava a pre-escolhida de toda venda);
 *   - a forma padrao nao pode ser desativada sem escolher outra.
 */
function conferirFormaDePagamento(array $d, ?int $id, ?array $atual, array $corpo): array
{
    if ($atual === null && empty($d['ordem'])) {
        $d['ordem'] = (int) consultarUm('SELECT COALESCE(MAX(ordem), 0) AS m FROM formas_pagamento')['m'] + 10;
    }
    $d['ordem'] = (int) ($d['ordem'] ?? 0);
    if ($atual !== null && (int) $d['ativo'] === 0 && (int) $atual['padrao'] === 1 && empty($corpo['padrao'])) {
        conferirFormaNaoPadrao((int) $atual['id'], 'desativar');
    }
    return $d;
}

/*
 * A forma padrao vale para a loja inteira (e a pre-escolhida de toda
 * venda): so o admin escolhe (r4). Mandar padrao:true para a forma que JA
 * e a padrao nao muda nada e passa - a tela pode reenviar o formulario.
 */
function conferirQuemEscolhePadrao(?int $id, string $metodo, array $corpo, array $usuario): void
{
    if ($usuario['perfil'] === 'admin' || !in_array($metodo, ['POST', 'PUT'], true) || empty($corpo['padrao'])) {
        return;
    }
    $jaEPadrao = $metodo === 'PUT' && $id
        && (int) (consultarUm('SELECT padrao FROM formas_pagamento WHERE id = ?', [$id])['padrao'] ?? 0) === 1;
    if (!$jaEPadrao) {
        throw new ErroApi(403, 'Só o administrador escolhe a forma de pagamento padrão da loja.');
    }
}

function conferirFormaNaoPadrao(int $id, string $acao): void
{
    if ((int) (consultarUm('SELECT padrao FROM formas_pagamento WHERE id = ?', [$id])['padrao'] ?? 0) === 1) {
        throw new ErroApi(400, "Esta é a forma de pagamento padrão. Marque outra como padrão antes de {$acao} esta.");
    }
}

/*
 * Depois de gravar uma forma: {padrao: true} faz dela a padrao (e so
 * ela); renomear atualiza o texto guardado nos documentos que apontam
 * para ela - senao a venda antiga mostraria o nome velho.
 */
function depoisDeGravarForma(int $id, array $d, ?array $atual, array $corpo): void
{
    if (!empty($corpo['padrao'])) {
        if ((int) $d['ativo'] === 0) {
            throw new ErroApi(400, 'A forma padrão precisa estar ativa.');
        }
        executarSql('UPDATE formas_pagamento SET padrao = 0 WHERE padrao = 1 AND id <> ?', [$id]);
        executarSql('UPDATE formas_pagamento SET padrao = 1 WHERE id = ?', [$id]);
    }
    if ($atual !== null && $d['nome'] !== $atual['nome']) {
        foreach (['vendas', 'ordens_servico', 'os_pagamentos'] as $t) {
            executarSql('UPDATE "' . $t . '" SET forma_pagamento = ? WHERE forma_pagamento_id = ?', [$d['nome'], $id]);
        }
        renomearFormaNosLancamentos($id, $d['nome']);
    }
}

/*
 * Le a forma de pagamento de um corpo e devolve [id, nome]. A tela manda
 * o id; o nome vai junto na coluna de texto (legivel sem JOIN).
 */
function formaDePagamento(array $corpo, ?array $atual = null): array
{
    if (!array_key_exists('forma_pagamento_id', $corpo)) {
        return [isset($atual['forma_pagamento_id']) ? (int) $atual['forma_pagamento_id'] : null,
                $atual['forma_pagamento'] ?? null];
    }
    $id = idDoCatalogo($corpo, 'forma_pagamento_id', null);
    if (!$id) {
        return [null, null];
    }
    $forma = consultarUm('SELECT nome FROM formas_pagamento WHERE id = ?', [$id]);
    if (!$forma) {
        throw new ErroApi(400, 'Forma de pagamento informada não existe.');
    }
    return [$id, $forma['nome']];
}

// ------------------------------------------------------------------
// Nomes montados (um jeito so) e cadastros feitos na hora
// ------------------------------------------------------------------
/* Nome cheio do modelo: "Apple iPhone 11 128GB". */
function sqlNomeModelo(string $m): string
{
    return "TRIM(TRIM(COALESCE({$m}.marca, '') || ' ' || COALESCE({$m}.modelo, '')) || ' ' || COALESCE({$m}.armazenamento, ''))";
}

/* Nome do aparelho do cliente (marca + modelo copiados na abertura da OS). */
function sqlNomeAparelho(string $a): string
{
    return "TRIM(COALESCE({$a}.marca, '') || ' ' || COALESCE({$a}.modelo, ''))";
}

function nomeModelo(?string $marca, string $modelo, ?string $armazenamento): string
{
    return trim(trim(((string) $marca) . ' ' . $modelo) . ' ' . ((string) $armazenamento));
}

/* Acha o modelo no catalogo ou cadastra na hora (atalho da OS e da entrada). */
function acharOuCriarModelo(?string $modelo, ?string $marca = null, ?string $armazenamento = null): ?int
{
    $modelo = $modelo === null ? '' : trim($modelo);
    if ($modelo === '') {
        return null;
    }
    $marca = valorDaLista('marcas', $marca) ?? '';
    $armazenamento = valorDaLista('armazenamentos', $armazenamento) ?? '';
    $achado = modeloIgual($marca, $modelo, $armazenamento);
    if ($achado) {
        return (int) $achado['id'];
    }
    executarSql('INSERT INTO modelos (marca, modelo, armazenamento) VALUES (?, ?, ?)', [$marca, $modelo, $armazenamento]);
    return (int) banco()->lastInsertId();
}

/*
 * Cliente cadastrado ali na OS. Com telefone, procura pelo telefone (so os
 * digitos); sem telefone, pelo nome exato (sem acento nem caixa).
 */
function acharOuCriarCliente(?string $nome, ?string $telefone = null): ?int
{
    $nome = $nome === null ? '' : trim($nome);
    if ($nome === '') {
        return null;
    }
    $telefone = $telefone === null ? '' : trim($telefone);
    $digitos  = preg_replace('/\D/', '', $telefone);
    if ($digitos !== '') {
        $achado = consultarUm(
            "SELECT id FROM clientes
              WHERE replace(replace(replace(replace(replace(
                    COALESCE(telefone, ''), ' ', ''), '(', ''), ')', ''), '-', ''), '.', '') = ?", [$digitos]);
    } else {
        $achado = consultarUm('SELECT id FROM clientes WHERE minusculas(nome) = minusculas(?)', [$nome]);
    }
    if ($achado) {
        return (int) $achado['id'];
    }
    executarSql('INSERT INTO clientes (nome, telefone) VALUES (?, ?)', [$nome, $telefone !== '' ? $telefone : null]);
    return (int) banco()->lastInsertId();
}

/* Peca e produto criados na hora pela tela de Entrada (um INSERT cada, so aqui). */
function criarPeca(array $dados): int
{
    $categoria = in_array($dados['categoria'] ?? 'outra', valoresDe('categorias_peca'), true) ? $dados['categoria'] : 'outra';
    if (!empty($dados['modelo_id'])) {
        exigirExistente('modelos', (int) $dados['modelo_id'], 'Modelo informado não existe.');
    }
    executarSql('INSERT INTO pecas (nome, categoria, modelo_id) VALUES (?, ?, ?)',
        [$dados['nome'], $categoria, $dados['modelo_id'] ?? null]);
    return (int) banco()->lastInsertId();
}

function criarProduto(array $dados): int
{
    executarSql('INSERT INTO produtos (nome, categoria, marca) VALUES (?, ?, ?)',
        [$dados['nome'], valorDaLista('categorias_produto', $dados['categoria'] ?? null), valorDaLista('marcas', $dados['marca'] ?? null)]);
    return (int) banco()->lastInsertId();
}

/** Le um id de catalogo do corpo, aceitando "" e 0 como "nao informado". */
function idDoCatalogo(array $corpo, string $campo, $padrao): ?int
{
    if (!array_key_exists($campo, $corpo)) {
        return $padrao === null ? null : (int) $padrao;
    }
    $valor = $corpo[$campo];
    if ($valor === '' || $valor === null) {
        return null;
    }
    if (!is_scalar($valor)) {
        throw new ErroApi(400, 'O campo "' . $campo . '" precisa ser o número de um registro.');
    }
    return (int) $valor === 0 ? null : (int) $valor;
}

/** 400 com a mensagem dada se o id nao existe na tabela (lista fechada). */
function exigirExistente(string $tabela, int $id, string $mensagem): void
{
    if (!in_array($tabela, ['clientes', 'fornecedores', 'modelos', 'pecas', 'produtos', 'servicos',
                            'formas_pagamento', 'ordens_servico', 'entradas'], true)) {
        throw new LogicException('Tabela fora da lista: ' . $tabela);
    }
    if (!consultarUm('SELECT id FROM "' . $tabela . '" WHERE id = ?', [$id])) {
        throw new ErroApi(400, $mensagem);
    }
}
