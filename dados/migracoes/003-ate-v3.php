<?php
/**
 * Passo 003: leva qualquer banco anterior (user_version 0: os bancos da
 * versao 2 e os migrados pelos antigos migrar-formas-pagamento.php e
 * migrar-servicos-pagamentos.php) ate a versao 3.
 *
 *   - colunas acrescentadas depois da primeira versao das tabelas;
 *   - tabelas novas da v3, com a definicao DA v3 escrita aqui;
 *   - dados: formas de pagamento a partir do texto ja gravado, servicos
 *     de partida e uma linha de pagamento para cada OS antiga.
 *
 * Indices, views e gatilhos nao sao feitos aqui: o aplicar-estrutura
 * refaz todos a partir do estrutura.sql no fim.
 */

declare(strict_types=1);

return function (PDO $pdo): array {
    $feito = [];

    foreach ([
        ['aparelhos',      'modelo_id',          'INTEGER REFERENCES modelos (id)'],
        ['vendas',         'forma_pagamento_id', 'INTEGER REFERENCES formas_pagamento (id)'],
        ['ordens_servico', 'forma_pagamento_id', 'INTEGER REFERENCES formas_pagamento (id)'],
        ['ordens_servico', 'venda_id',           'INTEGER REFERENCES vendas (id)'],
        ['lancamentos',    'forma_pagamento_id', 'INTEGER REFERENCES formas_pagamento (id)'],
        ['os_itens',       'servico_id',         'INTEGER REFERENCES servicos (id)'],
        ['usuarios',       'trocar_senha',       'INTEGER NOT NULL DEFAULT 0'],
    ] as [$tabela, $coluna, $definicao]) {
        if (adicionarColuna($pdo, $tabela, $coluna, $definicao)) {
            $feito[] = "coluna {$tabela}.{$coluna}";
        }
    }

    /*
     * Banco INSTALADO pelo estrutura.sql da v2 (e nao migrado da v1) tem
     * modelo_id, venda_id e servico_id no meio da tabela, e aparelhos com
     * ON DELETE SET NULL. Ordem de coluna e FK so mudam reconstruindo.
     */
    $formaV3 = [
        'aparelhos' => ['id,cliente_id,marca,modelo,cor,imei,senha_aparelho,acessorios,criado_em,modelo_id', "CREATE TABLE aparelhos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id     INTEGER REFERENCES clientes (id) ON DELETE SET NULL,
    marca          TEXT,
    modelo         TEXT NOT NULL,
    cor            TEXT,
    imei           TEXT,
    senha_aparelho TEXT,
    acessorios     TEXT,
    criado_em      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    modelo_id      INTEGER REFERENCES modelos (id)
)"],
        'ordens_servico' => ['id,numero,cliente_id,aparelho_id,tecnico_id,defeito_relatado,diagnostico,servico_executado,status,'
            . 'valor_orcamento,valor_pecas,valor_mao_obra,valor_final,forma_pagamento,data_entrada,data_previsao,data_entrega,'
            . 'garantia_dias,observacoes,atualizado_em,forma_pagamento_id,venda_id', "CREATE TABLE ordens_servico (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    numero           TEXT    UNIQUE,
    cliente_id       INTEGER NOT NULL REFERENCES clientes  (id),
    aparelho_id      INTEGER          REFERENCES aparelhos (id),
    tecnico_id       INTEGER          REFERENCES usuarios  (id),
    defeito_relatado  TEXT,
    diagnostico       TEXT,
    servico_executado TEXT,
    status           TEXT    NOT NULL DEFAULT 'aberta'
                     CHECK (status IN ('aberta', 'orcamento', 'aprovada',
                                       'em_reparo', 'pronta', 'entregue',
                                       'recusada', 'cancelada')),
    valor_orcamento  REAL    NOT NULL DEFAULT 0,
    valor_pecas      REAL    NOT NULL DEFAULT 0,
    valor_mao_obra   REAL    NOT NULL DEFAULT 0,
    valor_final      REAL    NOT NULL DEFAULT 0,
    forma_pagamento  TEXT,
    data_entrada     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    data_previsao    TEXT,
    data_entrega     TEXT,
    garantia_dias    INTEGER NOT NULL DEFAULT 90,
    observacoes      TEXT,
    atualizado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    forma_pagamento_id INTEGER REFERENCES formas_pagamento (id),
    venda_id           INTEGER REFERENCES vendas (id)
)"],
        'os_itens' => ['id,os_id,entrada_id,descricao,quantidade,valor_unitario,custo_unitario,subtotal,criado_em,servico_id', "CREATE TABLE os_itens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    os_id          INTEGER NOT NULL REFERENCES ordens_servico (id) ON DELETE CASCADE,
    entrada_id     INTEGER          REFERENCES entradas       (id) ON DELETE SET NULL,
    descricao      TEXT    NOT NULL,
    quantidade     INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
    valor_unitario REAL    NOT NULL DEFAULT 0,
    custo_unitario REAL    NOT NULL DEFAULT 0,
    subtotal       REAL    NOT NULL DEFAULT 0,
    criado_em      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    servico_id     INTEGER REFERENCES servicos (id)
)"],
    ];
    foreach ($formaV3 as $tabela => [$colunas, $ddl]) {
        $fk = $tabela === 'aparelhos'
            ? $pdo->query("SELECT on_delete FROM pragma_foreign_key_list('aparelhos') WHERE \"from\" = 'modelo_id'")->fetchColumn()
            : 'NO ACTION';
        if (temTabela($pdo, $tabela) && (implode(',', colunasDe($pdo, $tabela)) !== $colunas || $fk !== 'NO ACTION')) {
            reconstruirTabela($pdo, $tabela, $ddl);
            $feito[] = "tabela {$tabela} reconstruída na forma da v3";
        }
    }

    $tabelasV3 = [
        'login_tentativas' => "CREATE TABLE login_tentativas (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario  TEXT    NOT NULL,
    ip       TEXT    NOT NULL DEFAULT '',
    momento  INTEGER NOT NULL
)",
        'formas_pagamento' => "CREATE TABLE formas_pagamento (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT    NOT NULL UNIQUE,
    tipo            TEXT    NOT NULL DEFAULT 'vista'
                    CHECK (tipo IN ('vista', 'prazo', 'cartao', 'outro')),
    parcelas_padrao INTEGER NOT NULL DEFAULT 1 CHECK (parcelas_padrao > 0),
    ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    ordem           INTEGER NOT NULL DEFAULT 0,
    observacoes     TEXT,
    criado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
)",
        'servicos' => "CREATE TABLE servicos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nome          TEXT    NOT NULL,
    descricao     TEXT,
    valor_padrao  REAL    NOT NULL DEFAULT 0,
    tempo_medio   INTEGER,
    ativo         INTEGER NOT NULL DEFAULT 1,
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
)",
        'os_pagamentos' => "CREATE TABLE os_pagamentos (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    os_id              INTEGER NOT NULL REFERENCES ordens_servico (id) ON DELETE CASCADE,
    forma_pagamento_id INTEGER REFERENCES formas_pagamento (id),
    forma_pagamento    TEXT,
    valor              REAL    NOT NULL,
    parcelas           INTEGER NOT NULL DEFAULT 1,
    criado_em          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
)",
        'lancamentos_log' => "CREATE TABLE lancamentos_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lancamento_id INTEGER NOT NULL REFERENCES lancamentos (id) ON DELETE CASCADE,
    campo         TEXT    NOT NULL,
    valor_antes   TEXT,
    valor_depois  TEXT,
    usuario_id    INTEGER REFERENCES usuarios (id),
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
)",
    ];
    $nasceu = [];
    foreach ($tabelasV3 as $tabela => $ddl) {
        if (!temTabela($pdo, $tabela)) {
            $pdo->exec($ddl);
            $nasceu[$tabela] = true;
            $feito[] = "tabela {$tabela}";
        }
    }

    if (isset($nasceu['formas_pagamento'])) {
        /*
         * Primeiro as formas que a loja REALMENTE usou, do jeito que foram
         * escritas (sem duplicar "Pix"/"pix"); depois as comuns que faltam;
         * por fim cada documento antigo e ligado a sua forma pelo texto.
         */
        $usadas = [];
        foreach (['vendas', 'ordens_servico', 'lancamentos'] as $t) {
            foreach ($pdo->query('SELECT DISTINCT TRIM(forma_pagamento) AS nome FROM "' . $t . '"
                                   WHERE forma_pagamento IS NOT NULL AND TRIM(forma_pagamento) <> \'\'') as $l) {
                $usadas[normalizarNome($l['nome'])] ??= $l['nome'];
            }
        }
        $inserir = $pdo->prepare('INSERT OR IGNORE INTO formas_pagamento (nome, tipo, parcelas_padrao, ordem) VALUES (?, ?, ?, ?)');
        $ordem = 0;
        foreach ($usadas as $nome) {
            $n = normalizarNome($nome);
            [$tipo, $parcelas] = str_contains($n, 'credito') ? ['cartao', 3]
                : (str_contains($n, 'cart') ? ['cartao', 1]
                : (preg_match('/fiado|prazo|boleto|crediario/', $n) ? ['prazo', 1]
                : (preg_match('/pix|dinheiro|debito|transfer/', $n) ? ['vista', 1] : ['outro', 1])));
            $inserir->execute([$nome, $tipo, $parcelas, $ordem += 1]);
        }
        foreach ([['Dinheiro', 'vista', 1, 10], ['Pix', 'vista', 1, 20], ['Cartão de débito', 'vista', 1, 30],
                  ['Cartão de crédito', 'cartao', 3, 40], ['Transferência', 'vista', 1, 50],
                  ['Boleto', 'prazo', 1, 60], ['Fiado', 'prazo', 1, 70]] as [$nome, $tipo, $parcelas, $o]) {
            $ja = $pdo->prepare('SELECT 1 FROM formas_pagamento WHERE minusculas(nome) = minusculas(?)');
            $ja->execute([$nome]);
            if (!$ja->fetchColumn()) {
                $inserir->execute([$nome, $tipo, $parcelas, $o]);
            }
        }
        $ligados = 0;
        foreach (['vendas', 'ordens_servico', 'lancamentos'] as $t) {
            $ligados += $pdo->exec('UPDATE "' . $t . '" SET forma_pagamento_id = (SELECT f.id FROM formas_pagamento f
                                     WHERE minusculas(f.nome) = minusculas("' . $t . '".forma_pagamento) ORDER BY f.id LIMIT 1)
                                    WHERE forma_pagamento_id IS NULL AND forma_pagamento IS NOT NULL AND TRIM(forma_pagamento) <> \'\'');
        }
        $feito[] = count($usadas) . ' forma(s) de pagamento vinda(s) do texto gravado; ' . $ligados . ' documento(s) ligado(s)';
    }

    if (isset($nasceu['servicos'])) {
        $inserir = $pdo->prepare('INSERT INTO servicos (nome, valor_padrao) VALUES (?, 0)');
        foreach (['Troca de tela', 'Troca de bateria', 'Troca de conector de carga', 'Limpeza / oxidação',
                  'Troca de tampa traseira', 'Troca de câmera', 'Desbloqueio / software', 'Mão de obra avulsa'] as $nome) {
            $inserir->execute([$nome]);
        }
        $feito[] = '8 serviços de partida (preço zerado)';
    }

    if (isset($nasceu['os_pagamentos'])) {
        $n = $pdo->exec("INSERT INTO os_pagamentos (os_id, forma_pagamento_id, forma_pagamento, valor)
                         SELECT id, forma_pagamento_id, forma_pagamento, valor_final FROM ordens_servico
                          WHERE valor_final > 0 AND (forma_pagamento_id IS NOT NULL OR forma_pagamento IS NOT NULL)");
        $feito[] = "{$n} OS antiga(s) com uma linha de pagamento";
    }

    return $feito;
};
