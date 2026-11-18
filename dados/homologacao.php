<?php
/**
 * dados/homologacao.php - coloca um banco em HOMOLOGACAO: o banco que se usa
 * para testar (a copia do banco de uma loja, a demonstracao, o banco do QA).
 * Nunca o banco da loja em uso.
 *
 * Uso (na pasta do projeto):
 *   php dados/homologacao.php <arquivo.sqlite>
 *   php dados/homologacao.php dados/index.sqlite --banco-da-pasta
 *       so numa INSTALACAO de homologacao: na pasta da loja, dados\index.sqlite
 *       e o banco em uso, por isso ele pede a confirmacao.
 *
 * O que faz (pode rodar de novo: so acerta o que falta):
 *   1. leva o banco a versao atual pelo aplicar-estrutura.php (o unico caminho
 *      de migracao; ele confere a estrutura e faz a propria copia se migrar);
 *   2. copia de seguranca em dados\backups\ (ou INDEX_CELULARES_BACKUPS);
 *   3. o acesso rapido p / p: admin, ativo, sem troca obrigatoria de senha;
 *   4. liga a regra "Este banco e de teste ou demonstracao" (faixa vermelha em
 *      todas as telas). So com ela ligada o login aceita a senha fraca do p sem
 *      mandar trocar (login() em api/rotas/acesso.php);
 *   5. ambiente fiscal de toda empresa = homologacao: nota emitida num banco de
 *      teste nunca vai para a producao da SEFAZ.
 * A regra e o fiscal mudam pelas rotas da API (a mesma validacao das telas) e
 * ficam no historico em nome do p.
 *
 * Para um banco SAIR da homologacao: desligue a regra em Empresa e regras >
 * Regras > Sistema e desative o usuario p (Minha conta > Usuarios do sistema).
 */

declare(strict_types=1);

/**
 * Os passos 3 a 5 no banco aberto por banco(). A demonstracao usa a mesma
 * funcao. Devolve o que mudou, uma frase por item (vazio = ja estava pronto).
 */
function colocarEmHomologacao(): array
{
    $feito = [];
    $hash = gerarHash('p');
    $p = consultarUm("SELECT id, perfil, ativo, trocar_senha FROM usuarios WHERE usuario = 'p'");
    if (!$p) {
        executarSql("INSERT INTO usuarios (usuario, nome, senha_hash, perfil, ativo, trocar_senha)
                     VALUES ('p', 'Acesso rápido (homologação)', ?, 'admin', 1, 0)", [$hash]);
        $feito[] = 'usuário p criado (senha p, admin)';
    } else {
        executarSql("UPDATE usuarios SET senha_hash = ?, perfil = 'admin', ativo = 1, trocar_senha = 0 WHERE id = ?", [$hash, $p['id']]);
        if ($p['perfil'] !== 'admin' || (int) $p['ativo'] !== 1 || (int) $p['trocar_senha'] !== 0) {
            $feito[] = 'usuário p acertado (admin, ativo, sem troca de senha)';
        }
    }
    $quem = consultarUm("SELECT id, usuario, nome, perfil FROM usuarios WHERE usuario = 'p'");

    $regra = 'sistema.banco_de_teste';
    if (!chaveLigada($regra)) {
        chaves(null, 'POST', ['chave' => $regra, 'escopo' => 'geral', 'valor' => '1'], $quem);
        if (!chaveLigada($regra)) {
            // A empresa tinha a regra desligada so para ela: sai a excecao.
            chaves(null, 'POST', ['chave' => $regra, 'escopo' => 'empresa', 'valor' => null], $quem);
        }
        if (!chaveLigada($regra)) {
            throw new RuntimeException('a regra "banco de teste" não ficou ligada.');
        }
        $feito[] = 'regra "Este banco é de teste ou demonstração" ligada';
    }

    foreach (consultar("SELECT empresa_id FROM empresa_fiscal WHERE ambiente <> 'homologacao'") as $f) {
        fiscal((int) $f['empresa_id'], 'PUT', ['ambiente' => 'homologacao'], $quem);
        $feito[] = 'ambiente fiscal da empresa ' . $f['empresa_id'] . ' em homologação';
    }
    return $feito;
}

// Incluido por outro script (a demonstracao): so a funcao.
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) !== __FILE__) {
    return;
}

$falhar = function (string $mensagem): never {
    fwrite(STDERR, "FALHOU: {$mensagem}\n");
    exit(1);
};

$args = array_slice($argv, 1);
$daPasta = in_array('--banco-da-pasta', $args, true);
$arquivos = array_values(array_filter($args, fn ($a) => $a !== '--banco-da-pasta'));
if (count($arquivos) !== 1) {
    fwrite(STDERR, "Uso:\n  php dados\\homologacao.php <arquivo.sqlite>\n"
        . "  php dados\\homologacao.php dados\\index.sqlite --banco-da-pasta   (instalação de homologação)\n");
    exit(1);
}

// A trava vem antes de tudo e nao depende de o arquivo existir.
$pasta = realpath(dirname($arquivos[0]));
$alvo = $pasta === false ? $arquivos[0] : $pasta . DIRECTORY_SEPARATOR . basename($arquivos[0]);
$daLoja = __DIR__ . DIRECTORY_SEPARATOR . 'index.sqlite';
$mesmo = PHP_OS_FAMILY === 'Windows' ? strcasecmp($alvo, $daLoja) === 0 : $alvo === $daLoja;
if ($mesmo && !$daPasta) {
    $falhar("este é o banco desta pasta (dados\\index.sqlite): na pasta da loja, é o banco em uso.\n"
        . "Copie o banco e rode no arquivo copiado. Se esta pasta for uma instalação de homologação, confirme:\n"
        . "  php dados\\homologacao.php dados\\index.sqlite --banco-da-pasta");
}
$caminho = realpath($arquivos[0]);
if ($caminho === false || !is_file($caminho)) {
    $falhar("não achei o banco {$arquivos[0]}.");
}

// 1. versao atual (e estrutura conferida) pelo aplicar-estrutura
// fwrite + fflush: o aplicar-estrutura escreve direto no mesmo STDOUT.
fwrite(STDOUT, "1. Estrutura do banco (aplicar-estrutura.php):\n");
fflush(STDOUT);
$proc = proc_open([PHP_BINARY, __DIR__ . '/aplicar-estrutura.php', $caminho], [1 => STDOUT, 2 => STDERR], $pipes);
if (!is_resource($proc) || proc_close($proc) !== 0) {
    $falhar('o aplicar-estrutura.php não terminou bem. Nada da homologação foi feito.');
}

putenv('INDEX_CELULARES_DB=' . $caminho);
require __DIR__ . '/../api/api.php';

// 2. copia de seguranca
try {
    $copia = pastaDeBackups() . DIRECTORY_SEPARATOR . basename($caminho) . '.antes-homologacao-' . date('Ymd-His');
} catch (RuntimeException $e) {
    $falhar($e->getMessage() . '. Nada foi alterado.');
}
if (!copy($caminho, $copia)) {
    $falhar("não consegui gravar a cópia de segurança {$copia}. Nada foi alterado.");
}
echo "2. Cópia de segurança: {$copia}\n";

// 3 a 5
try {
    $feito = colocarEmHomologacao();
} catch (Throwable $e) {
    $falhar($e->getMessage() . "\nA cópia de antes está em {$copia}.");
}
echo "3. " . ($feito ? implode("\n   ", $feito) : 'nada a mudar: o banco já estava em homologação') . "\n";
echo "\nPronto: {$caminho} está em homologação. Entre com  p / p  (admin).\n";
