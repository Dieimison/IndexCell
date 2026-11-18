<?php
/**
 * dados/migracoes/ferramentas.php - o que os passos de migracao usam.
 *
 * Um passo e um arquivo NNN-assunto.php (NNN = a versao a que ele leva o
 * banco) que devolve uma funcao (PDO $pdo): array com as frases do que
 * fez. O aplicar-estrutura.php roda os passos que faltam, em ordem, numa
 * transacao so, com as chaves estrangeiras desligadas (para poder
 * reconstruir tabela) e conferidas no fim.
 *
 * O SQLite so faz ADD COLUMN por ALTER. Mudou DEFAULT, CHECK, FK ou
 * UNIQUE? E reconstruirTabela(), com a definicao NOVA escrita no proprio
 * passo (o estrutura.sql so tem a ultima versao; o passo tem de continuar
 * certo quando vierem as proximas).
 */

declare(strict_types=1);

function temTabela(PDO $pdo, string $tabela): bool
{
    $st = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    $st->execute([$tabela]);
    return (bool) $st->fetchColumn();
}

function colunasDe(PDO $pdo, string $tabela): array
{
    return array_column($pdo->query('PRAGMA table_info("' . $tabela . '")')->fetchAll(PDO::FETCH_ASSOC), 'name');
}

/** ALTER TABLE ... ADD COLUMN, so se a coluna ainda nao existe. Devolve se acrescentou. */
function adicionarColuna(PDO $pdo, string $tabela, string $coluna, string $definicao): bool
{
    if (!temTabela($pdo, $tabela) || in_array($coluna, colunasDe($pdo, $tabela), true)) {
        return false;
    }
    $pdo->exec('ALTER TABLE "' . $tabela . '" ADD COLUMN ' . $coluna . ' ' . $definicao);
    return true;
}

/*
 * Reconstroi uma tabela com a definicao nova (o roteiro do SQLite):
 * cria "<tabela>__nova", copia os dados (colunas em comum, ou a expressao
 * dada em $expressoes), apaga a velha, renomeia a nova e mantem o contador
 * do AUTOINCREMENT. Indices, views e gatilhos o aplicar-estrutura refaz.
 * Exige as chaves estrangeiras desligadas (o aplicar-estrutura cuida).
 */
function reconstruirTabela(PDO $pdo, string $tabela, string $createSql, array $expressoes = []): void
{
    $nova = $tabela . '__nova';
    $sql = preg_replace('/^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?"?' . preg_quote($tabela, '/') . '"?/i',
                        'CREATE TABLE "' . $nova . '"', $createSql, 1, $trocou);
    if ($trocou !== 1) {
        throw new RuntimeException("reconstruirTabela: a definicao nao comeca com CREATE TABLE {$tabela}");
    }
    $sequencia = $pdo->query("SELECT seq FROM sqlite_sequence WHERE name = " . $pdo->quote($tabela))->fetchColumn();

    $pdo->exec($sql);
    $velhas = colunasDe($pdo, $tabela);
    $destino = [];
    $origem = [];
    foreach (colunasDe($pdo, $nova) as $coluna) {
        if (isset($expressoes[$coluna])) {
            $destino[] = '"' . $coluna . '"';
            $origem[] = $expressoes[$coluna];
        } elseif (in_array($coluna, $velhas, true)) {
            $destino[] = '"' . $coluna . '"';
            $origem[] = '"' . $coluna . '"';
        }
    }
    $pdo->exec('INSERT INTO "' . $nova . '" (' . implode(', ', $destino) . ') SELECT ' . implode(', ', $origem)
             . ' FROM "' . $tabela . '"');
    $pdo->exec('DROP TABLE "' . $tabela . '"');
    $pdo->exec('ALTER TABLE "' . $nova . '" RENAME TO "' . $tabela . '"');
    if ($sequencia !== false) {
        $pdo->prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?')->execute([(int) $sequencia, $tabela]);
    }
}

/*
 * O "sql" de um objeto do sqlite_master, normalizado para comparar
 * banco migrado com banco novo: sem comentarios, sem aspas de nome, sem
 * IF NOT EXISTS e com os espacos padronizados. Qualquer outra diferenca
 * (DEFAULT, CHECK, FK, UNIQUE, ordem de coluna) continua aparecendo.
 */
function normalizarSql(string $sql): string
{
    $sql = preg_replace('/--[^\n]*/', '', $sql);
    $sql = preg_replace('#/\*.*?\*/#s', '', $sql);
    $sql = str_replace('"', '', $sql);
    $sql = preg_replace('/\s+/', ' ', $sql);
    $sql = preg_replace('/\s*([(),;])\s*/', '$1', $sql);
    $sql = preg_replace('/\bIF NOT EXISTS /i', '', $sql);
    return trim($sql);
}

/** Tabelas, indices, views e gatilhos do banco: "tipo nome" => sql normalizado. */
function esquemaNormalizado(PDO $pdo): array
{
    $saida = [];
    foreach ($pdo->query("SELECT type, name, sql FROM sqlite_master
                           WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name")->fetchAll(PDO::FETCH_ASSOC) as $o) {
        $saida[$o['type'] . ' ' . $o['name']] = normalizarSql((string) $o['sql']);
    }
    return $saida;
}
