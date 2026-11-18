<?php
/**
 * Passo 004 (v3 -> v4):
 *   - formas_pagamento.padrao: a forma pre-escolhida na venda e explicita
 *     (antes era "a primeira da lista", e qualquer forma nova com ordem 0
 *     tomava o lugar). Marca "Dinheiro", ou a primeira por ordem.
 *   - movimentacoes: o motivo "brinde" (brinde/cortesia sai do estoque
 *     com o nome certo, em vez de "perda"). E mudanca de CHECK: o SQLite
 *     nao altera CHECK por ALTER, entao a tabela e reconstruida com a
 *     definicao da v4 escrita aqui.
 */

declare(strict_types=1);

return function (PDO $pdo): array {
    $feito = [];

    if (adicionarColuna($pdo, 'formas_pagamento', 'padrao', 'INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0, 1))')) {
        $feito[] = 'coluna formas_pagamento.padrao';
    }
    if (!(int) $pdo->query('SELECT COUNT(*) FROM formas_pagamento WHERE padrao = 1')->fetchColumn()) {
        $id = $pdo->query("SELECT id FROM formas_pagamento WHERE minusculas(nome) = 'dinheiro' AND ativo = 1 LIMIT 1")->fetchColumn()
           ?: $pdo->query('SELECT id FROM formas_pagamento WHERE ativo = 1 ORDER BY ordem, id LIMIT 1')->fetchColumn();
        if ($id) {
            $pdo->prepare('UPDATE formas_pagamento SET padrao = 1 WHERE id = ?')->execute([$id]);
            $nome = $pdo->query('SELECT nome FROM formas_pagamento WHERE id = ' . (int) $id)->fetchColumn();
            $feito[] = "forma padrão: {$nome}";
        }
    }

    reconstruirTabela($pdo, 'movimentacoes', "CREATE TABLE movimentacoes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entrada_id    INTEGER NOT NULL REFERENCES entradas       (id) ON DELETE CASCADE,
    tipo          TEXT    NOT NULL CHECK (tipo IN ('entrada', 'saida')),
    motivo        TEXT    NOT NULL DEFAULT 'ajuste'
                  CHECK (motivo IN ('garantia', 'retorno', 'devolucao',
                                    'defeito', 'perda', 'brinde', 'ajuste')),
    quantidade    INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),

    os_id         INTEGER REFERENCES ordens_servico (id) ON DELETE SET NULL,
    fornecedor_id INTEGER REFERENCES fornecedores   (id) ON DELETE SET NULL,
    valor         REAL    NOT NULL DEFAULT 0,
    observacoes   TEXT,
    usuario_id    INTEGER REFERENCES usuarios (id),
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
)");
    $feito[] = 'tabela movimentacoes reconstruída (motivo "brinde")';

    return $feito;
};
