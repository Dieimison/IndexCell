<?php
/**
 * testes/caso.php - o minimo de "framework" dos testes PHP (o mesmo jeito
 * do testes/front/caso.js):
 *
 *   caso('nome', function () { igual($obtido, $esperado, 'o que e'); });
 *   fim();   // placar; sai com codigo 1 se algo falhou
 *
 * O esperado e escrito a mao (o oraculo), nunca calculado pela funcao testada.
 */

declare(strict_types=1);

$GLOBALS['__casos'] = ['ok' => 0, 'falhas' => []];

function caso(string $nome, callable $funcao): void
{
    try {
        $funcao();
        $GLOBALS['__casos']['ok']++;
        echo "  ok    {$nome}\n";
    } catch (Throwable $e) {
        $GLOBALS['__casos']['falhas'][] = $nome;
        echo "  FALHA {$nome}\n        " . str_replace("\n", "\n        ", $e->getMessage()) . "\n";
    }
}

function igual($obtido, $esperado, string $oque = ''): void
{
    if ($obtido !== $esperado) {
        throw new RuntimeException(($oque ? $oque . ': ' : '') . 'esperado ' . json_encode($esperado, JSON_UNESCAPED_UNICODE)
            . ', veio ' . json_encode($obtido, JSON_UNESCAPED_UNICODE));
    }
}

function verdade(bool $condicao, string $oque): void
{
    if (!$condicao) {
        throw new RuntimeException($oque);
    }
}

function fim(): void
{
    $r = $GLOBALS['__casos'];
    $total = $r['ok'] + count($r['falhas']);
    echo $r['falhas'] ? "\nFALHOU: " . count($r['falhas']) . " de {$total} caso(s): " . implode(' | ', $r['falhas']) . "\n"
                      : "\nOK: {$total} caso(s).\n";
    exit($r['falhas'] ? 1 : 0);
}

/** Cria um banco NOVO num arquivo temporario pelo instalador de verdade; devolve o caminho. */
function bancoNovoTemporario(string $pasta, string $senhaInicial = 'Inicial-Teste-2026'): string
{
    @mkdir($pasta, 0777, true);
    $banco = $pasta . DIRECTORY_SEPARATOR . 'teste-' . getmypid() . '-' . mt_rand(1000, 9999) . '.sqlite';
    $cmd = '"' . PHP_BINARY . '" "' . dirname(__DIR__) . '/dados/aplicar-estrutura.php" "' . $banco . '"';
    putenv('INDEX_CELULARES_SENHA_INICIAL=' . $senhaInicial);
    exec($cmd . ' 2>&1', $saida, $rc);
    if ($rc !== 0) {
        throw new RuntimeException("aplicar-estrutura falhou ({$rc}): " . implode("\n", $saida));
    }
    return $banco;
}
