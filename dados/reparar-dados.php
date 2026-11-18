<?php
/**
 * dados/reparar-dados.php - lista (e, se pedido, corrige) dados tortos
 * gravados pelas versoes antigas, antes das travas de hoje.
 *
 * Uso (na pasta do projeto, DEPOIS do aplicar-estrutura.php):
 *   php dados/reparar-dados.php             so LISTA o que acharia; nao muda nada
 *   php dados/reparar-dados.php --aplicar   faz copia de seguranca e corrige
 *
 * O que corrige:
 *   1. celular com situacao 'vendido', saldo 1 e nenhuma venda concluida
 *      (o "excluir venda" antigo devolvia o saldo e esquecia a situacao:
 *      o aparelho sumia de todas as listas) -> volta para 'ready'
 *   2. lancamento de compra com valor R$ 0,00 (a compra de custo zero
 *      gerava conta de zero) -> 'cancelado', com o motivo no log
 *   4. senha de desbloqueio guardada de aparelho cuja OS ja fechou
 *      (entregue, cancelada ou recusada) e sem outra OS aberta -> apagada
 *      (o aparelho ja voltou ao cliente; e a I15 do testes\integridade.php)
 *
 * O que so LISTA (precisa de gente olhando, nao tem conserto automatico):
 *   3. IMEI fora do padrao (15 digitos) ou repetido entre celulares
 *
 * Usa o mesmo banco da API (INDEX_CELULARES_DB, ou dados/index.sqlite).
 * Mostra so ids e contagens - nenhum dado pessoal.
 */

declare(strict_types=1);

require __DIR__ . '/../api/api.php';

$aplicar = in_array('--aplicar', $argv, true);

try {
    $celulares = consultar(
        "SELECT e.id, s.saldo FROM entradas e
           JOIN vw_entradas_saldo s ON s.entrada_id = e.id
          WHERE e.tipo = 'celular' AND e.situacao = 'vendido' AND s.saldo > 0
            AND NOT EXISTS (SELECT 1 FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id
                             WHERE vi.entrada_id = e.id AND v.status = 'concluida')
          ORDER BY e.id"
    );
    $zerados = consultar(
        "SELECT * FROM lancamentos WHERE origem = 'entrada' AND valor <= 0 AND status <> 'cancelado' ORDER BY id"
    );
    $senhas = consultar(
        "SELECT a.id FROM aparelhos a
          WHERE a.senha_aparelho IS NOT NULL
            AND EXISTS (SELECT 1 FROM ordens_servico o WHERE o.aparelho_id = a.id)
            AND NOT EXISTS (SELECT 1 FROM ordens_servico o WHERE o.aparelho_id = a.id
                             AND o.status IN (" . vagas(STATUS_OS_EM_ANDAMENTO) . "))
          ORDER BY a.id", STATUS_OS_EM_ANDAMENTO);
    $imeiRuim = consultar(
        "SELECT id FROM entradas
          WHERE tipo = 'celular' AND imei IS NOT NULL AND TRIM(imei) <> ''
            AND (length(imei) <> 15 OR imei GLOB '*[^0-9]*'
                 OR imei IN (SELECT imei FROM entradas WHERE tipo = 'celular' AND imei IS NOT NULL
                              GROUP BY imei HAVING COUNT(*) > 1))
          ORDER BY id"
    );

    echo "1. celular 'vendido' ainda no estoque, sem venda: " . count($celulares) .
         ($celulares ? ' (entradas ' . implode(', ', array_column($celulares, 'id')) . ')' : '') . "\n";
    echo "2. conta de compra com valor R$ 0,00:             " . count($zerados) .
         ($zerados ? ' (lançamentos ' . implode(', ', array_column($zerados, 'id')) . ')' : '') . "\n";
    echo "4. senha de aparelho em OS já fechada:            " . count($senhas) .
         ($senhas ? ' (aparelhos ' . implode(', ', array_column($senhas, 'id')) . ')' : '') . "\n";
    echo "3. IMEI fora do padrão ou repetido (só lista):     " . count($imeiRuim) .
         ($imeiRuim ? ' (entradas ' . implode(', ', array_column($imeiRuim, 'id')) . ')' : '') . "\n";

    if (!$aplicar) {
        echo "\nNada foi alterado. Para corrigir 1, 2 e 4: php dados/reparar-dados.php --aplicar\n";
        exit(0);
    }
    if (!$celulares && !$zerados && !$senhas) {
        echo "\nNada a corrigir.\n";
        exit(0);
    }

    $copia = pastaDeBackups() . DIRECTORY_SEPARATOR . basename(caminhoBanco()) . '.antes-reparo-' . date('Ymd-His');
    if (!copy(caminhoBanco(), $copia)) {
        throw new RuntimeException('não consegui gravar a cópia de segurança; nada foi alterado.');
    }
    echo "\nCópia de segurança: " . basename($copia) . "\n";

    $admin = consultarUm("SELECT id FROM usuarios WHERE perfil = 'admin' AND ativo = 1 ORDER BY id LIMIT 1");
    $quem  = (int) ($admin['id'] ?? 0);

    emTransacao(function () use ($celulares, $zerados, $senhas, $quem) {
        foreach ($senhas as $a) {
            executarSql('UPDATE aparelhos SET senha_aparelho = NULL WHERE id = ?', [$a['id']]);
        }
        foreach ($celulares as $c) {
            executarSql("UPDATE entradas SET situacao = 'ready', data_venda = NULL WHERE id = ?", [$c['id']]);
        }
        // Pela funcao de lancamento: a mudanca fica no log, com o motivo.
        foreach ($zerados as $antes) {
            $depois = $antes;
            $depois['status'] = 'cancelado';
            $depois['observacoes'] = trim(($antes['observacoes'] ?? '') . ' [compra de R$ 0,00]');
            gravarLancamento((int) $antes['id'], $antes, $depois, $quem, 'reparo de dados: compra de R$ 0,00');
        }
    });
    echo 'Corrigido: ' . count($celulares) . ' celular(es) de volta à prateleira, ' .
         count($zerados) . ' conta(s) de R$ 0,00 cancelada(s), ' . count($senhas) . " senha(s) de aparelho apagada(s).\n";
} catch (ErroApi $e) {
    fwrite(STDERR, 'FALHOU: ' . $e->getMessage() . "\n");
    exit(1);
} catch (Throwable $e) {
    fwrite(STDERR, 'FALHOU: ' . $e->getMessage() . " (nada foi alterado)\n");
    exit(1);
}
