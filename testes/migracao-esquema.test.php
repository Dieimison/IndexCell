<?php
/**
 * testes/migracao-esquema.test.php - prova que o migrador NUNCA responde
 * "Pronto" sem aplicar uma mudanca de esquema (o furo da banca: mudar
 * DEFAULT/CHECK de uma coluna e o migrador gravar a versao nova sem mudar
 * a tabela).
 *
 * Numa COPIA do projeto (api/nucleo.php + dados/), muda
 * ordens_servico.garantia_dias de "DEFAULT 90" para
 * "DEFAULT 30 CHECK (garantia_dias <= 3650)" e confere:
 *   A. sem subir a versao: o banco ja na versao atual NAO confere -> falha
 *      (codigo 1), nada muda;
 *   B. subindo a versao sem escrever o passo: falha "falta o passo";
 *   C. com o passo NNN que reconstroi a tabela: aplica, o banco fica com
 *      DEFAULT 30 e o CHECK, igual ao banco novo, os dados e o contador do
 *      AUTOINCREMENT ficam; a 2a vez diz "Nada a fazer".
 *
 * Uso: php testes/migracao-esquema.test.php
 */

declare(strict_types=1);

require __DIR__ . '/caso.php';

$raiz  = dirname(__DIR__);
$copia = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'index-celulares-esquema-' . getmypid();
foreach (['api', 'dados', 'dados/migracoes'] as $d) {
    @mkdir("{$copia}/{$d}", 0777, true);
}
copy("{$raiz}/api/nucleo.php", "{$copia}/api/nucleo.php");
foreach (['aplicar-estrutura.php', 'estrutura.sql'] as $f) {
    copy("{$raiz}/dados/{$f}", "{$copia}/dados/{$f}");
}
foreach (glob("{$raiz}/dados/migracoes/*.php") as $f) {
    copy($f, "{$copia}/dados/migracoes/" . basename($f));
}
putenv("INDEX_CELULARES_BACKUPS={$copia}/backups");

require "{$copia}/api/nucleo.php";
$versao = VERSAO_BANCO;
$banco  = "{$copia}/dados/loja.sqlite";

function instalar(string $copia, string $banco): array
{
    exec('"' . PHP_BINARY . "\" \"{$copia}/dados/aplicar-estrutura.php\" \"{$banco}\" 2>&1", $saida, $rc);
    return [$rc, implode("\n", $saida)];
}
function lerBanco(string $banco): PDO
{
    $p = new PDO('sqlite:' . $banco);
    $p->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    return $p;
}
function padraoGarantia(PDO $p): ?string
{
    foreach ($p->query('PRAGMA table_info(ordens_servico)') as $c) {
        if ($c['name'] === 'garantia_dias') {
            return $c['dflt_value'];
        }
    }
    return null;
}

// Banco da versao atual com uma OS gravada (id 7, para conferir o contador).
[$rc] = instalar($copia, $banco);
$p = lerBanco($banco);
$p->exec("INSERT INTO clientes (id, nome) VALUES (1, 'Cliente')");
$p->exec("INSERT INTO ordens_servico (id, numero, cliente_id, status, garantia_dias) VALUES (7, 'OS-2026-0007', 1, 'aberta', 60)");
$p = null;
caso('banco da versao atual instalado', fn () => igual($rc, 0));

// A mudanca de esquema de teste.
$sql = (string) file_get_contents("{$copia}/dados/estrutura.sql");
$novoSql = str_replace('garantia_dias    INTEGER NOT NULL DEFAULT 90,',
                       'garantia_dias    INTEGER NOT NULL DEFAULT 30 CHECK (garantia_dias <= 3650),', $sql);
caso('a mudanca de teste foi aplicada ao estrutura.sql da copia', fn () => verdade($novoSql !== $sql, 'linha nao achada'));
file_put_contents("{$copia}/dados/estrutura.sql", $novoSql);

// A. mesma versao: tem de FALHAR (antes: "Nada a fazer").
[$rc, $saida] = instalar($copia, $banco);
caso('A. sem subir a versao: falha com codigo 1 e diz que nao confere', fn () =>
    verdade($rc === 1 && str_contains($saida, 'não confere'), "rc={$rc}: " . mb_substr($saida, 0, 300)));
caso('A. ... e o banco nao mudou (DEFAULT 90, versao igual)', fn () =>
    igual([padraoGarantia(lerBanco($banco)), (int) lerBanco($banco)->query('PRAGMA user_version')->fetchColumn()], ['90', $versao]));

// B. versao nova sem passo: tem de FALHAR (antes: "Pronto (versao 4)").
$nucleo = (string) file_get_contents("{$copia}/api/nucleo.php");
file_put_contents("{$copia}/api/nucleo.php", str_replace("const VERSAO_BANCO = {$versao};", 'const VERSAO_BANCO = ' . ($versao + 1) . ';', $nucleo));
[$rc, $saida] = instalar($copia, $banco);
caso('B. versao nova sem passo: falha com codigo 1 ("falta o passo")', fn () =>
    verdade($rc === 1 && str_contains($saida, 'falta o passo'), "rc={$rc}: " . mb_substr($saida, 0, 300)));
caso('B. ... e o banco nao mudou', fn () => igual(padraoGarantia(lerBanco($banco)), '90'));

// C. com o passo que reconstroi a tabela: aplica.
preg_match('/CREATE TABLE IF NOT EXISTS ordens_servico \(.*?\n\);/s', $novoSql, $m);
$ddl = str_replace('IF NOT EXISTS ', '', rtrim($m[0] ?? '', ';'));
$num = sprintf('%03d', $versao + 1);
file_put_contents("{$copia}/dados/migracoes/{$num}-garantia-teste.php",
    "<?php\nreturn function (PDO \$pdo): array {\n    reconstruirTabela(\$pdo, 'ordens_servico', " . var_export($ddl, true)
    . ");\n    return ['ordens_servico com DEFAULT 30 e CHECK'];\n};\n");
[$rc, $saida] = instalar($copia, $banco);
caso('C. com o passo de reconstruir: codigo 0 e "Pronto"', fn () =>
    verdade($rc === 0 && str_contains($saida, 'Pronto'), "rc={$rc}: " . mb_substr($saida, 0, 600)));
$p = lerBanco($banco);
caso('C. ... o banco tem DEFAULT 30 e o CHECK novo', fn () => verdade(padraoGarantia($p) === '30'
    && str_contains((string) $p->query("SELECT sql FROM sqlite_master WHERE name = 'ordens_servico'")->fetchColumn(), 'garantia_dias <= 3650'),
    'DEFAULT/CHECK nao aplicados'));
caso('C. ... os dados e o contador ficaram (OS 7 com garantia 60; proxima OS nasce 8)', function () use ($p) {
    $os = $p->query('SELECT id, garantia_dias FROM ordens_servico')->fetchAll();
    $p->exec("INSERT INTO ordens_servico (numero, cliente_id) VALUES ('OS-2026-0008', 1)");
    igual([$os, (int) $p->query('SELECT MAX(id) FROM ordens_servico')->fetchColumn()], [[['id' => 7, 'garantia_dias' => 60]], 8]);
});
caso('C. ... o CHECK novo vale de verdade', function () use ($p) {
    try {
        $p->exec("INSERT INTO ordens_servico (numero, cliente_id, garantia_dias) VALUES ('X', 1, 99999)");
        throw new RuntimeException('aceitou garantia 99999');
    } catch (PDOException $e) {
        verdade(str_contains($e->getMessage(), 'CHECK'), $e->getMessage());
    }
});
$p = null;
[$rc, $saida] = instalar($copia, $banco);
caso('C. 2a vez: "Nada a fazer"', fn () => verdade($rc === 0 && str_contains($saida, 'Nada a fazer'), mb_substr($saida, 0, 300)));

// Limpeza da copia.
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($copia, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
foreach ($it as $f) {
    $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
}
@rmdir($copia);
fim();
