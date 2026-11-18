<?php
/**
 * dados/aplicar-estrutura.php - cria o banco do zero OU leva um banco
 * antigo ate a versao atual (VERSAO_BANCO, em api/nucleo.php). E o UNICO
 * caminho de instalacao e de migracao.
 *
 * Uso (na pasta do projeto):
 *   php dados/aplicar-estrutura.php                  usa dados/index.sqlite
 *   php dados/aplicar-estrutura.php outro.sqlite     outro arquivo
 *   (ou a variavel INDEX_CELULARES_DB, a mesma da API)
 *
 * Banco NOVO: aplica o estrutura.sql inteiro, as sementes e cria o admin
 * com uma senha inicial (troca obrigatoria no 1o acesso).
 *
 * Banco ANTIGO (user_version menor), numa transacao so:
 *   0. copia de seguranca em dados\backups\ (ou INDEX_CELULARES_BACKUPS);
 *   1. apaga views e gatilhos (sao refeitos no fim);
 *   2. roda os passos dados\migracoes\NNN-*.php que faltam, em ordem;
 *   3. refaz indices, views e gatilhos a partir do estrutura.sql;
 *   4. confere as chaves estrangeiras (PRAGMA foreign_key_check);
 *   5. compara o banco com um banco novo feito do estrutura.sql, objeto
 *      por objeto (o "sql" normalizado de tabelas, indices, views e
 *      gatilhos). Qualquer diferenca: nada e gravado e sai com codigo 1.
 *
 * Banco ja na versao atual: so a comparacao do passo 5. Se o estrutura.sql
 * mudou sem um passo de migracao, isto FALHA - nunca diz "Pronto" sem ter
 * aplicado.
 */

declare(strict_types=1);

require __DIR__ . '/../api/nucleo.php';
require __DIR__ . '/migracoes/ferramentas.php';

function falhar(string $mensagem): never
{
    fwrite(STDERR, "FALHOU: {$mensagem}\n");
    exit(1);
}

/** 12 caracteres sem os que confundem na leitura (0/O, 1/l/I), com letra e numero. */
function senhaAleatoria(): string
{
    $letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
    $numeros = '23456789';
    $senha = '';
    for ($i = 0; $i < 10; $i++) {
        $senha .= $letras[random_int(0, strlen($letras) - 1)];
    }
    return $senha . $numeros[random_int(0, 7)] . $numeros[random_int(0, 7)];
}


// ------------------------------------------------------------------
// Conferencias antes de comecar
// ------------------------------------------------------------------
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    falhar("este PHP está sem a extensão pdo_sqlite.\nAbra o php.ini e tire o ponto e vírgula de extension=pdo_sqlite.");
}
if (!function_exists('mb_strtolower')) {
    falhar('este PHP está sem a extensão mbstring (extension=mbstring no php.ini).');
}
$caminhoSql = __DIR__ . '/estrutura.sql';
if (!is_file($caminhoSql)) {
    falhar("não achei o estrutura.sql em {$caminhoSql}");
}
$env = getenv('INDEX_CELULARES_DB');
$caminho = $argv[1] ?? ($env !== false && $env !== '' ? $env : __DIR__ . '/index.sqlite');

[$estrutura, $blocoSementes] = array_pad(explode('-- @@SEMENTES@@', (string) file_get_contents($caminhoSql), 2), 2, '');

// O banco de referencia: o que o estrutura.sql cria do zero, em memoria.
try {
    $ref = abrirSqlite(':memory:');
    $ref->exec($estrutura);
} catch (PDOException $e) {
    falhar('o próprio estrutura.sql tem problema: ' . $e->getMessage());
}
$refEsquema = esquemaNormalizado($ref);
$refTabelas = $ref->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")->fetchAll(PDO::FETCH_COLUMN);
// indices, views e gatilhos na ordem em que o estrutura.sql os cria (uma view le a outra)
$refDerivados = $ref->query("SELECT type, name, sql FROM sqlite_master
                              WHERE type IN ('index', 'view', 'trigger') AND sql IS NOT NULL ORDER BY rowid")->fetchAll(PDO::FETCH_ASSOC);

// Sementes: "@@SEMENTE <tabela>". Tabela que nao existe = falha (antes era ignorada).
$sementes = [];
foreach (preg_split('/^-- @@SEMENTE /m', $blocoSementes) as $k => $trecho) {
    if ($k === 0) {
        continue;
    }
    [$tabela, $sql] = explode("\n", $trecho, 2);
    $tabela = trim($tabela);
    if (!in_array($tabela, $refTabelas, true)) {
        falhar("o estrutura.sql tem uma semente para a tabela \"{$tabela}\", que não existe.");
    }
    $sementes[$tabela] = $sql;
}

// Os passos de migracao: NNN-*.php, NNN = a versao a que levam.
$passos = [];
foreach (glob(__DIR__ . '/migracoes/[0-9][0-9][0-9]-*.php') as $arquivo) {
    $passos[(int) substr(basename($arquivo), 0, 3)] = $arquivo;
}
ksort($passos);

$existia = is_file($caminho) && filesize($caminho) > 0;
try {
    $pdo = abrirSqlite($caminho);
    $versaoAntes = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
    $novo = (int) $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")->fetchColumn() === 0;
} catch (PDOException $e) {
    falhar('não consegui abrir o banco ' . $caminho . ': ' . $e->getMessage()
         . "\nConfira se o arquivo é mesmo o banco do sistema (e não uma cópia corrompida).");
}

/** Diferencas entre o banco e a referencia ("tabela x: ..."). */
function diferencas(PDO $pdo, array $refEsquema): array
{
    $esquema = esquemaNormalizado($pdo);
    $saida = [];
    foreach ($refEsquema + $esquema as $objeto => $_) {
        $a = $refEsquema[$objeto] ?? null;
        $b = $esquema[$objeto] ?? null;
        if ($a !== $b) {
            $saida[] = $a === null ? "{$objeto} sobra no banco"
                     : ($b === null ? "{$objeto} falta no banco" : "{$objeto} é diferente:\n      novo:  {$a}\n      banco: {$b}");
        }
    }
    return $saida;
}

if ($versaoAntes > VERSAO_BANCO) {
    falhar("o banco é da versão {$versaoAntes}, mais nova que a deste sistema (" . VERSAO_BANCO . '). Atualize os arquivos do sistema.');
}

if (!$novo && $versaoAntes === VERSAO_BANCO) {
    echo "Banco encontrado (versão {$versaoAntes}) em {$caminho}\n";
    $dif = diferencas($pdo, $refEsquema);
    if ($dif) {
        falhar("o banco está na versão " . VERSAO_BANCO . " mas não confere com o estrutura.sql:\n  - " . implode("\n  - ", $dif)
             . "\nMudança de tabela precisa de VERSAO_BANCO nova e de um passo em dados\\migracoes\\. Nada foi alterado.");
    }
    echo 'Já está na versão ' . VERSAO_BANCO . " e confere com o estrutura.sql. Nada a fazer.\n";
    exit(0);
}

$feito = [];
$senhaInicial = null;

if ($novo) {
    echo 'Banco novo: criando a estrutura versão ' . VERSAO_BANCO . " em {$caminho}\n";
    try {
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->beginTransaction();
        $pdo->exec($estrutura);
        foreach ($sementes as $sql) {
            $pdo->exec($sql);
        }
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        falhar($e->getMessage());
    }
} else {
    echo "Banco encontrado (versão {$versaoAntes}) em {$caminho}\n";
    for ($v = $versaoAntes + 1; $v <= VERSAO_BANCO; $v++) {
        if ($v >= 3 && !isset($passos[$v])) {
            falhar("falta o passo de migração para a versão {$v} (dados\\migracoes\\" . sprintf('%03d', $v) . "-*.php). Nada foi alterado.");
        }
    }
    // 0. copia de seguranca, em dados\backups\
    try {
        $pasta = pastaDeBackups();
    } catch (RuntimeException $e) {
        falhar($e->getMessage() . '. Nada foi alterado.');
    }
    $copia = $pasta . DIRECTORY_SEPARATOR . basename($caminho) . '.antes-v' . VERSAO_BANCO . '-' . date('Ymd-His');
    if (!copy($caminho, $copia)) {
        falhar('não consegui gravar a cópia de segurança ' . $copia . '. Nada foi alterado.');
    }
    echo "0. Cópia de segurança: {$copia}\n";

    try {
        // Reconstruir tabela exige as chaves desligadas; elas sao conferidas no fim.
        $pdo->exec('PRAGMA foreign_keys = OFF');
        $pdo->beginTransaction();
        // 1. views e gatilhos saem (sao refeitos do estrutura.sql)
        foreach ($pdo->query("SELECT type, name FROM sqlite_master WHERE type IN ('view', 'trigger')")->fetchAll() as $o) {
            $pdo->exec('DROP ' . strtoupper($o['type']) . ' IF EXISTS "' . $o['name'] . '"');
        }
        // 2. os passos que faltam
        foreach ($passos as $v => $arquivo) {
            if ($v > $versaoAntes && $v <= VERSAO_BANCO) {
                $passo = require $arquivo;
                foreach ($passo($pdo) as $frase) {
                    $feito[] = sprintf('v%d: %s', $v, $frase);
                }
            }
        }
        // 3. indices, views e gatilhos a partir do estrutura.sql
        $esquema = esquemaNormalizado($pdo);
        foreach ($pdo->query("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")->fetchAll(PDO::FETCH_COLUMN) as $indice) {
            if (($refEsquema['index ' . $indice] ?? null) !== ($esquema['index ' . $indice] ?? null)) {
                $pdo->exec('DROP INDEX IF EXISTS "' . $indice . '"');
            }
        }
        foreach ($refDerivados as $o) {
            $existe = $pdo->query("SELECT 1 FROM sqlite_master WHERE type = '{$o['type']}' AND name = " . $pdo->quote($o['name']))->fetchColumn();
            if (!$existe) {
                $pdo->exec($o['sql']);
            }
        }
        // 4. chaves estrangeiras
        $quebradas = $pdo->query('PRAGMA foreign_key_check')->fetchAll();
        if ($quebradas) {
            throw new RuntimeException(count($quebradas) . ' ligação(ões) quebrada(s) entre tabelas (PRAGMA foreign_key_check), '
                . 'por exemplo na tabela ' . $quebradas[0]['table'] . '.');
        }
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        falhar($e->getMessage() . "\nNada foi alterado: o banco continua como estava.");
    }
}

try {
    // Usuario admin, se o banco nao tem nenhum.
    if ((int) $pdo->query('SELECT COUNT(*) FROM usuarios')->fetchColumn() === 0) {
        $doAmbiente   = getenv('INDEX_CELULARES_SENHA_INICIAL');
        $senhaInicial = $doAmbiente !== false && $doAmbiente !== '' ? $doAmbiente : senhaAleatoria();
        $pdo->prepare("INSERT INTO usuarios (usuario, nome, senha_hash, perfil, ativo, trocar_senha)
                       VALUES ('admin', 'Administrador', ?, 'admin', 1, 1)")->execute([gerarHash($senhaInicial)]);
        $feito[] = 'usuário admin criado (troca de senha obrigatória no 1º acesso)';
    }
    // 5. o banco confere com um banco novo, objeto por objeto?
    $dif = diferencas($pdo, $refEsquema);
    if ($dif) {
        throw new RuntimeException("o banco não ficou igual ao estrutura.sql:\n  - " . implode("\n  - ", $dif)
            . "\nFalta (ou está errado) um passo em dados\\migracoes\\.");
    }
    $pdo->exec('PRAGMA user_version = ' . VERSAO_BANCO);
    $pdo->commit();
    $pdo->exec('PRAGMA foreign_keys = ON');
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    falhar($e->getMessage() . "\nNada foi alterado: o banco continua como estava.");
}

$integridade = $pdo->query('PRAGMA integrity_check')->fetchColumn();
if ($integridade !== 'ok') {
    falhar("o banco ficou inconsistente (integrity_check = {$integridade}). Volte a cópia de segurança.");
}

if ($feito && !$novo) {
    echo "Feito:\n  - " . implode("\n  - ", $feito) . "\n";
}
echo "\nPronto (versão " . VERSAO_BANCO . "), conferido contra o estrutura.sql. Tabelas:\n";
foreach ($pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN) as $t) {
    printf("  %-24s %d registro(s)\n", $t, (int) $pdo->query('SELECT COUNT(*) FROM "' . $t . '"')->fetchColumn());
}
echo "\nintegridade: ok\n";

if ($senhaInicial !== null) {
    echo "\n==========================================================\n";
    echo "  Usuário inicial:  admin\n";
    echo "  Senha inicial:    {$senhaInicial}\n";
    echo "  Anote agora: ela não aparece de novo. No primeiro acesso\n";
    echo "  o sistema obriga a trocar por uma senha sua.\n";
    echo "==========================================================\n";
}
exit(0);
