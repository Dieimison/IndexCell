<?php
/**
 * Passo 006 (v5 -> v6):
 *   - opcoes_lista: marca, armazenamento, cor e categoria viram lista para
 *     escolher. Nasce com o vocabulario de partida (o mesmo das sementes)
 *     MAIS tudo que a loja ja escreveu nesses campos, para nada sumir da
 *     lista. Grafias que so mudam em maiuscula/acento ficam uma so (a
 *     primeira que aparece).
 *   - empresas: a loja vira a empresa 1 (nome "Index Celulares"; razao
 *     social e CNPJ o admin completa na tela).
 *   - chaves_geral, chaves_empresa, chaves_historico: as regras por chave.
 *     Nascem vazias: sem valor gravado, vale o de fabrica do codigo.
 * So acrescenta: nenhuma tabela antiga muda e nenhum dado antigo e alterado.
 */

declare(strict_types=1);

return function (PDO $pdo): array {
    $feito = [];

    // As definicoes da v6, escritas aqui (o estrutura.sql so tem a ultima).
    $tabelas = [
        'opcoes_lista' => "CREATE TABLE IF NOT EXISTS opcoes_lista (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    lista     TEXT    NOT NULL
              CHECK (lista IN ('marcas', 'armazenamentos', 'cores',
                               'categorias_produto', 'categorias_lancamento')),
    valor     TEXT    NOT NULL CHECK (length(trim(valor)) > 0),
    ativo     INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
)",
        'empresas' => "CREATE TABLE IF NOT EXISTS empresas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nome         TEXT    NOT NULL,             -- nome fantasia, o da tela
    razao_social TEXT,
    cnpj         TEXT    UNIQUE                -- 14 caracteres sem pontuação: 12 letras/números + 2 dígitos (CNPJ alfanumérico)
                 CHECK (cnpj IS NULL OR (length(cnpj) = 14 AND cnpj NOT GLOB '*[^0-9A-Z]*'
                                         AND substr(cnpj, 13, 2) NOT GLOB '*[^0-9]*')),
    ativo        INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
)",
        'chaves_geral' => "CREATE TABLE IF NOT EXISTS chaves_geral (
    chave         TEXT    PRIMARY KEY,
    valor         TEXT    NOT NULL,
    atualizado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id    INTEGER REFERENCES usuarios (id) ON DELETE SET NULL
)",
        'chaves_empresa' => "CREATE TABLE IF NOT EXISTS chaves_empresa (
    empresa_id    INTEGER NOT NULL REFERENCES empresas (id) ON DELETE CASCADE,
    chave         TEXT    NOT NULL,
    valor         TEXT    NOT NULL,
    atualizado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id    INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
    PRIMARY KEY (empresa_id, chave)
)",
        'chaves_historico' => "CREATE TABLE IF NOT EXISTS chaves_historico (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    escopo     TEXT    NOT NULL CHECK (escopo IN ('geral', 'empresa')),
    empresa_id INTEGER REFERENCES empresas (id) ON DELETE SET NULL,
    chave      TEXT    NOT NULL,
    antes      TEXT,
    depois     TEXT,
    usuario_id INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
    momento    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
)",
    ];
    foreach ($tabelas as $nome => $sql) {
        if (!temTabela($pdo, $nome)) {
            $pdo->exec($sql);
            $feito[] = "tabela {$nome}";
        }
    }
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_opcoes_lista_valor ON opcoes_lista (lista, valor COLLATE NOCASE)');

    if (!(int) $pdo->query('SELECT COUNT(*) FROM empresas')->fetchColumn()) {
        $pdo->exec("INSERT INTO empresas (nome) VALUES ('Index Celulares')");
        $feito[] = 'empresa 1: Index Celulares';
    }

    // Vocabulario: o de partida + o que a loja ja gravou nesses campos.
    $iniciais = [
        'marcas'                => ['Apple', 'Samsung', 'Motorola', 'Xiaomi', 'Realme', 'LG'],
        'armazenamentos'        => ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'],
        'cores'                 => ['Preto', 'Branco', 'Azul', 'Verde', 'Vermelho', 'Rosa', 'Roxo', 'Dourado', 'Prata', 'Grafite'],
        'categorias_produto'    => ['Capa', 'Película', 'Carregador', 'Cabo', 'Fone de ouvido', 'Caixa de som', 'Suporte'],
        'categorias_lancamento' => ['Aluguel', 'Energia', 'Internet', 'Fornecedor', 'Imposto', 'Salário', 'Outros'],
    ];
    $daLoja = [
        'marcas'                => 'SELECT marca AS v FROM modelos UNION ALL SELECT marca FROM produtos',
        'armazenamentos'        => 'SELECT armazenamento AS v FROM modelos',
        'cores'                 => 'SELECT cor AS v FROM entradas UNION ALL SELECT cor FROM aparelhos',
        'categorias_produto'    => 'SELECT categoria AS v FROM produtos',
        'categorias_lancamento' => "SELECT categoria AS v FROM lancamentos WHERE origem = 'manual'",
    ];
    $inserir = $pdo->prepare('INSERT OR IGNORE INTO opcoes_lista (lista, valor) VALUES (?, ?)');
    $existe  = $pdo->prepare('SELECT 1 FROM opcoes_lista WHERE lista = ? AND minusculas(valor) = minusculas(?)');
    $total = 0;
    foreach ($iniciais as $lista => $valores) {
        $gravados = $pdo->query('SELECT TRIM(v) FROM (' . $daLoja[$lista] . ") WHERE TRIM(COALESCE(v, '')) <> '' "
                                . 'GROUP BY TRIM(v) ORDER BY TRIM(v)')->fetchAll(PDO::FETCH_COLUMN);
        foreach (array_merge($valores, $gravados) as $valor) {
            $existe->execute([$lista, $valor]);
            if ($existe->fetchColumn()) {
                continue;
            }
            $inserir->execute([$lista, $valor]);
            $total += $inserir->rowCount();
        }
    }
    $feito[] = "listas de opções: {$total} valor(es)";

    return $feito;
};
