<?php
/**
 * testes/migracoes.php - leva bancos antigos ate a versao atual, 2x cada,
 * SEMPRE em copias, e confere:
 *   - codigo de saida 0 nas duas vezes, e "Nada a fazer" na segunda;
 *   - o banco migrado igual ao banco novo, objeto por objeto (o "sql"
 *     normalizado de sqlite_master: tabelas, indices, views, gatilhos);
 *   - user_version, integrity_check, foreign_key_check;
 *   - nenhuma linha perdida.
 *
 * Bancos usados:
 *   - v2: um banco INSTALADO pelo estrutura.sql da versao 2 (fixtures),
 *     com dados de mentira;
 *   - v3: um banco instalado pelo estrutura.sql da versao 3, com dados;
 *   - opcional: todos os arquivos da pasta INDEX_CELULARES_BANCOS_ANTIGOS
 *     (ex.: a dados\backups\ da loja; os arquivos sao copiados, o original
 *     nunca e aberto para escrita).
 *
 * Uso: php testes/migracoes.php
 */

declare(strict_types=1);

require __DIR__ . '/caso.php';
require __DIR__ . '/../api/nucleo.php';
require __DIR__ . '/../dados/migracoes/ferramentas.php';

$pasta = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'index-celulares-migracoes-' . getmypid();
@mkdir($pasta, 0777, true);
putenv('INDEX_CELULARES_BACKUPS=' . $pasta . DIRECTORY_SEPARATOR . 'backups');

function rodarInstalador(string $banco): array
{
    exec('"' . PHP_BINARY . '" "' . dirname(__DIR__) . '/dados/aplicar-estrutura.php" "' . $banco . '" 2>&1', $saida, $rc);
    return [$rc, implode("\n", $saida)];
}

function contagens(PDO $p): array
{
    $o = [];
    foreach ($p->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")->fetchAll(PDO::FETCH_COLUMN) as $t) {
        $o[$t] = (int) $p->query('SELECT COUNT(*) FROM "' . $t . '"')->fetchColumn();
    }
    return $o;
}

/** Banco instalado por um estrutura.sql antigo, com algumas linhas de cada coisa. */
function bancoAntigo(string $arquivoSql, string $destino): void
{
    @unlink($destino);
    $p = abrirSqlite($destino);
    [$sql] = explode('-- @@SEMENTES@@', (string) file_get_contents($arquivoSql));
    $p->exec($sql);
    $p->exec("INSERT OR IGNORE INTO usuarios (usuario, nome, senha_hash, perfil) VALUES ('velho', 'Velho', 'x', 'admin')");
    $p->exec("INSERT INTO clientes (nome, telefone) VALUES ('Cliente Antigo', '(00) 90000-0000')");
    $p->exec("INSERT INTO modelos (marca, modelo) VALUES ('Marca', 'Antigo')");
    $p->exec("INSERT INTO pecas (nome, categoria) VALUES ('Tela antiga', 'tela')");
    $p->exec("INSERT INTO entradas (tipo, peca_id, quantidade, valor_investimento, valor_venda, situacao) VALUES ('peca', 1, 5, 10, 30, 'ready')");
    $p->exec("INSERT INTO vendas (numero, cliente_id, valor_bruto, valor_total, custo_total, forma_pagamento) VALUES ('VD-2025-0001', 1, 30, 30, 10, 'pix')");
    $p->exec("INSERT INTO venda_itens (venda_id, entrada_id, descricao, quantidade, valor_unitario, custo_unitario, subtotal) VALUES (1, 1, 'Tela', 1, 30, 10, 30)");
    $p->exec("INSERT INTO lancamentos (tipo, descricao, valor, vencimento, origem, venda_id, forma_pagamento) VALUES ('receber', 'Venda VD-2025-0001', 30, '2025-01-10', 'venda', 1, 'PIX')");
    $p->exec("INSERT INTO ordens_servico (numero, cliente_id, status, valor_final, forma_pagamento, data_entrega) VALUES ('OS-2025-0001', 1, 'entregue', 80, 'Dinheiro', '2025-01-11')");
    $p->exec("INSERT INTO movimentacoes (entrada_id, tipo, motivo, quantidade) VALUES (1, 'saida', 'perda', 1)");
}

// O banco novo de referencia (o instalador de verdade, banco vazio).
$novo = $pasta . DIRECTORY_SEPARATOR . 'novo.sqlite';
[$rc] = rodarInstalador($novo);
$refEsquema = esquemaNormalizado(abrirSqlite($novo));

$bancos = [];
bancoAntigo(__DIR__ . '/fixtures/estrutura-v2.sql', $bancos['v2 instalado (fixture)'] = $pasta . DIRECTORY_SEPARATOR . 'v2.sqlite');
bancoAntigo(__DIR__ . '/fixtures/estrutura-v3.sql', $bancos['v3 instalado (fixture)'] = $pasta . DIRECTORY_SEPARATOR . 'v3.sqlite');
(abrirSqlite($bancos['v3 instalado (fixture)']))->exec('PRAGMA user_version = 3');
$antigos = getenv('INDEX_CELULARES_BANCOS_ANTIGOS');
if ($antigos !== false && $antigos !== '' && is_dir($antigos)) {
    foreach (glob(rtrim($antigos, '/\\') . DIRECTORY_SEPARATOR . '*') as $arquivo) {
        if (is_file($arquivo)) {
            copy($arquivo, $copia = $pasta . DIRECTORY_SEPARATOR . 'real-' . basename($arquivo) . '.sqlite');
            $bancos['real ' . basename($arquivo)] = $copia;
        }
    }
}

echo "migracoes: banco novo de referencia (rc {$rc}), " . count($bancos) . " banco(s) antigo(s)\n";
foreach ($bancos as $nome => $banco) {
    $antes = contagens(abrirSqlite($banco));
    [$rc1, $saida1] = rodarInstalador($banco);
    [$rc2, $saida2] = rodarInstalador($banco);
    caso("{$nome}: 1a vez codigo 0", fn () => igual($rc1, 0, mb_substr($saida1, -600)));
    caso("{$nome}: 2a vez codigo 0 e \"Nada a fazer\"", fn () => verdade($rc2 === 0 && str_contains($saida2, 'Nada a fazer'), mb_substr($saida2, -300)));
    $p = abrirSqlite($banco);
    caso("{$nome}: igual ao banco novo, objeto por objeto", function () use ($p, $refEsquema) {
        $esq = esquemaNormalizado($p);
        $dif = [];
        foreach ($refEsquema + $esq as $k => $_) {
            if (($refEsquema[$k] ?? null) !== ($esq[$k] ?? null)) {
                $dif[] = $k;
            }
        }
        igual($dif, [], 'objetos diferentes');
    });
    caso("{$nome}: versao, integridade e chaves", fn () => igual([
        (int) $p->query('PRAGMA user_version')->fetchColumn(), $p->query('PRAGMA integrity_check')->fetchColumn(),
        count($p->query('PRAGMA foreign_key_check')->fetchAll())], [VERSAO_BANCO, 'ok', 0]));
    caso("{$nome}: nenhuma linha perdida", function () use ($p, $antes) {
        $depois = contagens($p);
        $perdas = [];
        foreach ($antes as $t => $n) {
            if (($depois[$t] ?? 0) < $n) {
                $perdas[] = "{$t} {$n} -> " . ($depois[$t] ?? 0);
            }
        }
        igual($perdas, []);
    });
}

foreach (glob($pasta . '/{,backups/}*', GLOB_BRACE) as $f) {
    is_file($f) && @unlink($f);
}
@rmdir($pasta . '/backups');
@rmdir($pasta);
fim();
