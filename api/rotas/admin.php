<?php
/**
 * api/rotas/admin.php - listas de opcoes, empresa e regras por chave.
 *
 *   GET  /listas                  as listas (marcas, cores...) com os valores ativos
 *   POST /listas                  {lista, valor}: acrescenta (qualquer perfil: e o
 *                                 "+ Nova marca" dentro do formulario)
 *   PUT  /listas/{id}             {ativo}: tira da lista ou devolve (so admin)
 *   GET  /chaves                  as regras, com o valor geral, o da empresa e o que vale (admin)
 *   POST /chaves                  {chave, escopo: geral|empresa, valor} - valor null
 *                                 apaga o daquele nivel (passa a herdar) (admin)
 *   GET  /empresa                 a empresa atual (admin)
 *   PUT  /empresa/{id}            {nome, razao_social, cnpj} (admin)
 *
 * Qual valor de uma chave vale (chave()): o da empresa, se houver; senao o
 * geral, se houver; senao o de fabrica (CHAVES, abaixo). Quem aplica a
 * regra e o servidor, na rota que ela protege (vendas.php); a tela le os
 * valores pelo /config so para saber o que mostrar.
 */

declare(strict_types=1);

/*
 * O catalogo das chaves. Chave nova nasce AQUI: a API recusa gravar chave
 * que nao esta nesta lista. O padrao de cada uma e o comportamento que o
 * sistema ja tinha antes de a chave existir - ligar a regra e escolha da loja.
 *   tipo 'liga'   valor '1' ou '0'
 *   tipo 'numero' inteiro entre min e max
 */
const CHAVES = [
    'venda.desconto_maximo_balcao' => [
        'grupo' => 'Vendas e PDV', 'tipo' => 'numero', 'padrao' => '100', 'min' => 0, 'max' => 100,
        'rotulo' => 'Desconto máximo do balcão e do técnico (%)',
        'ajuda'  => 'Maior desconto, em porcentagem do total da venda, que quem não é administrador pode dar. '
                  . '100 = sem limite. O administrador nunca tem limite.',
    ],
    'venda.alterar_preco_balcao' => [
        'grupo' => 'Vendas e PDV', 'tipo' => 'liga', 'padrao' => '1',
        'rotulo' => 'Balcão e técnico podem mudar o preço do item',
        'ajuda'  => 'Desligado, quem não é administrador vende pelo preço cadastrado (na entrada, ou no serviço) e não lança '
                  . 'item avulso. Desconto continua possível, dentro do limite acima.',
    ],
    'venda.exigir_cliente' => [
        'grupo' => 'Vendas e PDV', 'tipo' => 'liga', 'padrao' => '0',
        'rotulo' => 'Venda só com cliente identificado',
        'ajuda'  => 'Ligado, toda venda (inclusive a do PDV) precisa de um cliente escolhido.',
    ],
    'pedido.confirmar_balcao' => [
        'grupo' => 'Entradas', 'tipo' => 'liga', 'padrao' => '0',
        'rotulo' => 'Balcão e técnico podem confirmar a entrada (nota do fornecedor)',
        'ajuda'  => 'Confirmar põe a mercadoria no estoque e cria as contas a pagar. Desligado, só o administrador confirma; '
                  . 'qualquer perfil monta o rascunho e importa o XML. Cancelar é sempre só do administrador.',
    ],
    'venda.prazo_balcao' => [
        'grupo' => 'Vendas e PDV', 'tipo' => 'liga', 'padrao' => '1',
        'rotulo' => 'Balcão e técnico podem vender a prazo (fiado, boleto)',
        'ajuda'  => 'Desligado, as formas de pagamento do tipo "A prazo" só o administrador usa.',
    ],
    'sistema.banco_de_teste' => [
        'grupo' => 'Sistema', 'tipo' => 'liga', 'padrao' => '0',
        'rotulo' => 'Este banco é de teste ou demonstração',
        'ajuda'  => 'Ligado, todas as telas (painel, login e loja online) mostram uma faixa vermelha "Banco de teste", para '
                  . 'ninguém confundir a demonstração com a loja de verdade. Na loja de verdade, deixe desligado.',
    ],
];

// ------------------------------------------------------------------
// Empresa e chaves
// ------------------------------------------------------------------
/** A empresa em que o sistema trabalha: hoje, a ativa de menor id. */
function empresaAtual(): ?array
{
    return consultarUm('SELECT id, nome, razao_social, cnpj FROM empresas WHERE ativo = 1 ORDER BY id LIMIT 1');
}

/** O valor que vale para uma chave: empresa > geral > fabrica. */
function chave(string $nome): string
{
    return valoresDaChave($nome)['valor'];
}

function chaveLigada(string $nome): bool
{
    return chave($nome) === '1';
}

function chaveNumero(string $nome): int
{
    return (int) chave($nome);
}

/** Os tres niveis de uma chave e qual deles venceu. */
function valoresDaChave(string $nome, ?array $empresa = null): array
{
    if (!isset(CHAVES[$nome])) {
        throw new LogicException("Chave desconhecida: {$nome}");
    }
    $empresa = $empresa ?? empresaAtual();
    $geral = consultarUm('SELECT valor FROM chaves_geral WHERE chave = ?', [$nome]);
    $daEmpresa = $empresa
        ? consultarUm('SELECT valor FROM chaves_empresa WHERE empresa_id = ? AND chave = ?', [$empresa['id'], $nome])
        : null;
    $origem = $daEmpresa ? 'empresa' : ($geral ? 'geral' : 'padrao');
    return [
        'padrao'  => CHAVES[$nome]['padrao'],
        'geral'   => $geral['valor'] ?? null,
        'empresa' => $daEmpresa['valor'] ?? null,
        'valor'   => $daEmpresa['valor'] ?? $geral['valor'] ?? CHAVES[$nome]['padrao'],
        'origem'  => $origem,
    ];
}

/** Todas as chaves com o valor que vale, ja no tipo certo (para o /config). */
function chavesEfetivas(): array
{
    $empresa = empresaAtual();
    $saida = [];
    foreach (CHAVES as $nome => $def) {
        $v = valoresDaChave($nome, $empresa)['valor'];
        $saida[$nome] = $def['tipo'] === 'liga' ? $v === '1' : (int) $v;
    }
    return $saida;
}

/** O valor que veio no corpo, conferido pelo tipo da chave, como texto. */
function valorDeChave(string $nome, $valor): string
{
    $def = CHAVES[$nome];
    if ($def['tipo'] === 'liga') {
        if (in_array($valor, [true, 1, '1', 'true', 'sim'], true)) {
            return '1';
        }
        if (in_array($valor, [false, 0, '0', 'false', 'nao', 'não'], true)) {
            return '0';
        }
        throw new ErroApi(400, '"' . $def['rotulo'] . '" é ligado ou desligado.');
    }
    $texto = is_string($valor) ? trim($valor) : (is_int($valor) ? (string) $valor : '');
    if (!preg_match('/^\d+$/', $texto) || (int) $texto < $def['min'] || (int) $texto > $def['max']) {
        throw new ErroApi(400, '"' . $def['rotulo'] . '" precisa ser um número inteiro entre ' . $def['min'] . ' e ' . $def['max'] . '.');
    }
    return (string) (int) $texto;
}

function chaves(?int $id, string $metodo, array $corpo, array $usuario): array
{
    if ($id !== null) {
        throw new ErroApi(404, 'Rota não encontrada.');
    }
    $empresa = empresaAtual();
    if ($metodo === 'GET') {
        $lista = [];
        foreach (CHAVES as $nome => $def) {
            $lista[] = ['chave' => $nome] + $def + valoresDaChave($nome, $empresa);
        }
        $historico = consultar(
            'SELECT h.escopo, h.chave, h.antes, h.depois, h.momento, u.nome AS usuario
               FROM chaves_historico h LEFT JOIN usuarios u ON u.id = h.usuario_id
              ORDER BY h.id DESC LIMIT 30');
        return [200, ['ok' => true, 'empresa' => $empresa, 'chaves' => $lista, 'historico' => $historico]];
    }
    exigir($metodo === 'POST');

    $nome = (string) ($corpo['chave'] ?? '');
    if (!isset(CHAVES[$nome])) {
        throw new ErroApi(400, 'Esta regra não existe: "' . $nome . '".');
    }
    $escopo = (string) ($corpo['escopo'] ?? '');
    if (!in_array($escopo, valoresDe('escopos_chave'), true)) {
        throw new ErroApi(400, 'Diga onde a regra vale: geral ou só desta empresa.');
    }
    if ($escopo === 'empresa' && !$empresa) {
        throw new ErroApi(400, 'Não há empresa ativa cadastrada.');
    }
    $novo = array_key_exists('valor', $corpo) && $corpo['valor'] !== null && $corpo['valor'] !== ''
        ? valorDeChave($nome, $corpo['valor']) : null;

    return emTransacao(function () use ($nome, $escopo, $novo, $empresa, $usuario) {
        $antes = valoresDaChave($nome, $empresa)[$escopo];
        if ($antes === $novo) {
            return [200, ['ok' => true, 'mensagem' => 'Nada mudou.']];
        }
        if ($escopo === 'geral') {
            $novo === null
                ? executarSql('DELETE FROM chaves_geral WHERE chave = ?', [$nome])
                : executarSql('INSERT INTO chaves_geral (chave, valor, usuario_id) VALUES (?, ?, ?)
                               ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, usuario_id = excluded.usuario_id,
                                                                 atualizado_em = datetime(\'now\', \'localtime\')',
                              [$nome, $novo, $usuario['id']]);
        } else {
            $novo === null
                ? executarSql('DELETE FROM chaves_empresa WHERE empresa_id = ? AND chave = ?', [$empresa['id'], $nome])
                : executarSql('INSERT INTO chaves_empresa (empresa_id, chave, valor, usuario_id) VALUES (?, ?, ?, ?)
                               ON CONFLICT (empresa_id, chave) DO UPDATE SET valor = excluded.valor,
                                   usuario_id = excluded.usuario_id, atualizado_em = datetime(\'now\', \'localtime\')',
                              [$empresa['id'], $nome, $novo, $usuario['id']]);
        }
        executarSql('INSERT INTO chaves_historico (escopo, empresa_id, chave, antes, depois, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
                    [$escopo, $escopo === 'empresa' ? $empresa['id'] : null, $nome, $antes, $novo, $usuario['id']]);
        $vale = valoresDaChave($nome, $empresa);
        return [200, ['ok' => true, 'chave' => ['chave' => $nome] + CHAVES[$nome] + $vale,
                      'mensagem' => 'Regra "' . CHAVES[$nome]['rotulo'] . '" gravada.']];
    });
}

/*
 * CNPJ sem pontuacao, numerico ou ALFANUMERICO (IN RFB 2.229/2024: as
 * novas inscricoes, desde julho de 2026, tem letras nas 12 primeiras
 * posicoes). As 2 ultimas sao sempre digitos verificadores, pelo modulo
 * 11; cada caractere vale o seu codigo ASCII menos 48 ("0" = 0, "A" = 17).
 * Exemplo oficial valido: 12.ABC.345/01DE-35.
 */
function cnpjValido(string $cnpj): bool
{
    if (!preg_match('/^[0-9A-Z]{12}\d{2}$/', $cnpj) || preg_match('/^(\d)\1{13}$/', $cnpj)) {
        return false;
    }
    foreach ([12, 13] as $n) {
        $pesos = $n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        $soma = 0;
        for ($i = 0; $i < $n; $i++) {
            $soma += (ord($cnpj[$i]) - 48) * $pesos[$i];
        }
        $resto = $soma % 11;
        if ((int) $cnpj[$n] !== ($resto < 2 ? 0 : 11 - $resto)) {
            return false;
        }
    }
    return true;
}

function empresa(?int $id, string $metodo, array $corpo): array
{
    if ($metodo === 'GET') {
        $e = $id ? consultarUm('SELECT * FROM empresas WHERE id = ?', [$id]) : empresaAtual();
        if (!$e) {
            throw new ErroApi(404, 'Empresa não encontrada.');
        }
        return [200, ['ok' => true, 'empresa' => $e]];
    }
    exigir($metodo === 'PUT');
    $id = exigirId($id);
    $atual = consultarUm('SELECT * FROM empresas WHERE id = ?', [$id]);
    if (!$atual) {
        throw new ErroApi(404, 'Empresa não encontrada.');
    }
    $nome = txtOu($corpo, 'nome', $atual);
    if ($nome === null || $nome === '') {
        throw new ErroApi(400, 'O nome da empresa é obrigatório.');
    }
    $cnpj = $atual['cnpj'];
    if (array_key_exists('cnpj', $corpo)) {
        // Tira ponto, barra, traco e espaco; letra vira maiuscula (CNPJ alfanumerico).
        $cnpj = strtoupper((string) preg_replace('/[\s.\/-]/', '', (string) ($corpo['cnpj'] ?? '')));
        if ($cnpj === '') {
            $cnpj = null;
        } elseif (!cnpjValido($cnpj)) {
            throw new ErroApi(400, 'CNPJ inválido: confira os 14 caracteres (os dois últimos são dígitos de conferência; '
                . 'CNPJ novo pode ter letras nas 12 primeiras posições).');
        } elseif (consultarUm('SELECT id FROM empresas WHERE cnpj = ? AND id <> ?', [$cnpj, $id])) {
            throw new ErroApi(400, 'Já existe outra empresa com este CNPJ.');
        }
    }
    executarSql('UPDATE empresas SET nome = ?, razao_social = ?, cnpj = ? WHERE id = ?',
                [$nome, txtOu($corpo, 'razao_social', $atual), $cnpj, $id]);
    return [200, ['ok' => true, 'empresa' => consultarUm('SELECT * FROM empresas WHERE id = ?', [$id]),
                  'mensagem' => 'Dados da empresa gravados.']];
}

// ------------------------------------------------------------------
// Listas de opcoes
// ------------------------------------------------------------------
/*
 * O valor de um campo de lista do jeito que vai para o banco: com a
 * grafia que ja esta na lista ("apple" grava "Apple") e, se e novo,
 * acrescentado a ela. Vazio continua vazio (null). Todo caminho que grava
 * marca, armazenamento, cor ou categoria passa por aqui - o formulario,
 * o cadastro feito na hora (OS, entrada) e quem chama a API direto.
 */
function valorDaLista(string $lista, ?string $valor): ?string
{
    $valor = $valor === null ? '' : trim((string) preg_replace('/\s+/u', ' ', $valor));
    if ($valor === '') {
        return null;
    }
    $existente = consultarUm('SELECT valor, ativo FROM opcoes_lista WHERE lista = ? AND minusculas(valor) = minusculas(?)',
                             [$lista, $valor]);
    if ($existente) {
        return $existente['valor'];
    }
    if (mb_strlen($valor) > 60) {
        throw new ErroApi(400, 'O valor "' . mb_substr($valor, 0, 60) . '..." é comprido demais para a lista (até 60 letras).');
    }
    // Tudo em minuscula ("nokia") vira "Nokia"; quem escreveu "iPhone" ou "128GB" fica como escreveu.
    if ($valor === mb_strtolower($valor)) {
        $valor = mb_strtoupper(mb_substr($valor, 0, 1)) . mb_substr($valor, 1);
    }
    executarSql('INSERT INTO opcoes_lista (lista, valor) VALUES (?, ?)', [$lista, $valor]);
    return $valor;
}

/*
 * PUT parcial de um campo de lista: o que nao veio, ou veio igual ao
 * gravado, continua como esta (editar uma conta gerada pela venda, com
 * categoria "venda", nao poe "venda" na lista de categorias).
 */
function listaOu(string $lista, array $corpo, string $campo, ?array $atual): ?string
{
    if ($atual !== null && (!array_key_exists($campo, $corpo) || txt($corpo, $campo) === ($atual[$campo] ?? null))) {
        return $atual[$campo] ?? null;
    }
    return valorDaLista($lista, txt($corpo, $campo));
}

function listas(?int $id, string $metodo, array $corpo, array $consulta, array $usuario): array
{
    if ($metodo === 'GET') {
        if ($id !== null) {
            throw new ErroApi(404, 'Rota não encontrada.');
        }
        $todas = !empty($consulta['todas']);
        $saida = array_fill_keys(valoresDe('listas'), []);
        foreach (consultar('SELECT id, lista, valor, ativo FROM opcoes_lista' . ($todas ? '' : ' WHERE ativo = 1')
                           . ' ORDER BY lista, minusculas(valor)') as $l) {
            $saida[$l['lista']][] = ['id' => (int) $l['id'], 'valor' => $l['valor'], 'ativo' => (int) $l['ativo'] === 1];
        }
        return [200, ['ok' => true, 'listas' => $saida]];
    }

    if ($metodo === 'POST') {
        exigir($id === null);
        $lista = (string) ($corpo['lista'] ?? '');
        if (!in_array($lista, valoresDe('listas'), true)) {
            throw new ErroApi(400, 'Lista desconhecida: "' . $lista . '".');
        }
        $digitado = txt($corpo, 'valor', 'Valor');
        if ($digitado === null) {
            throw new ErroApi(400, 'Digite o valor novo.');
        }
        return emTransacao(function () use ($lista, $digitado) {
            $antes = consultarUm('SELECT id, valor, ativo FROM opcoes_lista WHERE lista = ? AND minusculas(valor) = minusculas(?)',
                                 [$lista, $digitado]);
            if ($antes && (int) $antes['ativo'] === 1) {
                return [200, ['ok' => true, 'id' => (int) $antes['id'], 'valor' => $antes['valor'],
                              'mensagem' => '"' . $antes['valor'] . '" já estava na lista.']];
            }
            if ($antes) {
                // Estava desativado: quem cadastra de novo quer de volta.
                executarSql('UPDATE opcoes_lista SET ativo = 1 WHERE id = ?', [$antes['id']]);
                return [200, ['ok' => true, 'id' => (int) $antes['id'], 'valor' => $antes['valor'],
                              'mensagem' => '"' . $antes['valor'] . '" voltou para a lista.']];
            }
            $valor = valorDaLista($lista, $digitado);
            $novo = consultarUm('SELECT id FROM opcoes_lista WHERE lista = ? AND valor = ?', [$lista, $valor]);
            return [201, ['ok' => true, 'id' => (int) $novo['id'], 'valor' => $valor,
                          'mensagem' => '"' . $valor . '" cadastrado na lista.']];
        });
    }

    if ($metodo === 'PUT') {
        if ($usuario['perfil'] !== 'admin') {
            throw new ErroApi(403, 'Só o administrador tira valores das listas.');
        }
        $id = exigirId($id);
        $item = consultarUm('SELECT id, valor FROM opcoes_lista WHERE id = ?', [$id]);
        if (!$item) {
            throw new ErroApi(404, 'Valor não encontrado na lista.');
        }
        if (!array_key_exists('ativo', $corpo)) {
            throw new ErroApi(400, 'Diga se o valor fica na lista (ativo) ou sai.');
        }
        $ativo = (int) (bool) $corpo['ativo'];
        executarSql('UPDATE opcoes_lista SET ativo = ? WHERE id = ?', [$ativo, $id]);
        return [200, ['ok' => true, 'mensagem' => '"' . $item['valor'] . '" ' . ($ativo ? 'voltou para a lista.' : 'saiu da lista. '
            . 'O que já foi gravado com ele não muda.')]];
    }

    throw new ErroApi(405, 'Para tirar um valor da lista, desative-o. Ele não é excluído: o que já foi gravado continua com ele.');
}
