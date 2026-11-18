<?php
/**
 * Passo 007 (v6 -> v7): base fiscal e pedido de entrada.
 *   - tabelas novas: empresa_fiscal (+ historico), cfops, cfop_empresa,
 *     naturezas_operacao, pedidos, pedido_itens, pedido_parcelas,
 *     vinculos_fornecedor;
 *   - colunas novas: NCM, CEST, origem, unidade e GTIN em produtos, pecas e
 *     modelos; IE e UF em fornecedores; pedido_id em lancamentos;
 *   - dados de referencia: os CFOPs mais usados e as naturezas de operacao.
 * So acrescenta: nenhum dado antigo muda. As definicoes e os dados estao
 * escritos aqui (o estrutura.sql so tem a ultima versao).
 */

declare(strict_types=1);

return function (PDO $pdo): array {
    $feito = [];
    $tabelas = ['empresa_fiscal', 'empresa_fiscal_historico', 'cfops', 'cfop_empresa', 'naturezas_operacao',
                'pedidos', 'pedido_itens', 'pedido_parcelas', 'vinculos_fornecedor'];
    $faltavam = array_values(array_filter($tabelas, fn ($t) => !temTabela($pdo, $t)));
    $pdo->exec(<<<'SQL'

-- ============================================================
--  FISCAL: CADASTROS  (v7)
-- ============================================================
-- Base para o módulo fiscal (análise em
-- index-celulares-pdv-20261101\analise-fiscal). Por enquanto o sistema
-- NÃO emite nota nem calcula imposto: guarda os cadastros e registra a
-- entrada de mercadoria com a nota do fornecedor (pedidos, abaixo).

-- ------------------------------------------------------------
-- DADOS FISCAIS DA EMPRESA  (1 para 1 com empresas)
-- ------------------------------------------------------------
-- O CRT não é gravado: sai do regime (mei 4, simples 1,
-- simples_excesso 2, presumido/real 3), numa função só (crtDoRegime).
CREATE TABLE IF NOT EXISTS empresa_fiscal (
    empresa_id     INTEGER PRIMARY KEY REFERENCES empresas (id) ON DELETE CASCADE,
    regime         TEXT    CHECK (regime IS NULL OR
                                  regime IN ('mei', 'simples', 'simples_excesso', 'presumido', 'real')),
    ie             TEXT,                       -- inscrição estadual (ou ISENTO)
    im             TEXT,                       -- inscrição municipal
    cnae           TEXT,
    logradouro     TEXT,
    numero         TEXT,
    complemento    TEXT,
    bairro         TEXT,
    cep            TEXT,
    municipio_ibge TEXT    CHECK (municipio_ibge IS NULL OR
                                  (length(municipio_ibge) = 7 AND municipio_ibge NOT GLOB '*[^0-9]*')),
    municipio      TEXT,
    uf             TEXT    CHECK (uf IS NULL OR uf IN ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
                                  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR',
                                  'SC', 'SP', 'SE', 'TO')),
    telefone       TEXT,
    ambiente       TEXT    NOT NULL DEFAULT 'homologacao'
                           CHECK (ambiente IN ('homologacao', 'producao')),
    atualizado_em  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id     INTEGER REFERENCES usuarios (id) ON DELETE SET NULL
);

-- Quem mudou o quê na configuração fiscal (um campo por linha).
CREATE TABLE IF NOT EXISTS empresa_fiscal_historico (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL REFERENCES empresas (id) ON DELETE CASCADE,
    campo      TEXT    NOT NULL,
    antes      TEXT,
    depois     TEXT,
    usuario_id INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
    momento    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_fiscal_hist_empresa ON empresa_fiscal_historico (empresa_id, momento);

-- ------------------------------------------------------------
-- CFOP  (tabela de referência + configuração por empresa)
-- ------------------------------------------------------------
-- O 1º dígito diz o sentido e o alcance: 1/2/3 entrada (no estado, de
-- outro estado, do exterior), 5/6/7 saída. CFOP oficial (oficial = 1)
-- tem a descrição travada; o admin cadastra os que faltarem com
-- oficial = 0. O que a EMPRESA faz com cada CFOP (permitido, mexe no
-- estoque, gera conta) fica em cfop_empresa, sem tocar no código oficial.
CREATE TABLE IF NOT EXISTS cfops (
    codigo    TEXT    PRIMARY KEY
              CHECK (length(codigo) = 4 AND codigo NOT GLOB '*[^0-9]*' AND substr(codigo, 1, 1) IN ('1', '2', '3', '5', '6', '7')),
    descricao TEXT    NOT NULL,
    oficial   INTEGER NOT NULL DEFAULT 1 CHECK (oficial IN (0, 1)),
    criado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS cfop_empresa (
    empresa_id        INTEGER NOT NULL REFERENCES empresas (id) ON DELETE CASCADE,
    cfop              TEXT    NOT NULL REFERENCES cfops (codigo) ON DELETE CASCADE,
    permitido         INTEGER NOT NULL DEFAULT 1 CHECK (permitido IN (0, 1)),
    movimenta_estoque TEXT    NOT NULL DEFAULT 'nao'
                      CHECK (movimenta_estoque IN ('entra', 'sai', 'nao')),
    gera_financeiro   TEXT    NOT NULL DEFAULT 'nao'
                      CHECK (gera_financeiro IN ('pagar', 'receber', 'nao')),
    observacao        TEXT,
    atualizado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (empresa_id, cfop)
);

-- ------------------------------------------------------------
-- NATUREZAS DE OPERAÇÃO
-- ------------------------------------------------------------
-- "O que está acontecendo" (compra para revenda, bonificação...). Diz o
-- CFOP de dentro e de fora do estado e o que a operação faz no estoque
-- e no financeiro. O pedido de entrada escolhe a natureza; o CFOP sai
-- dela pela UF do fornecedor x a da empresa.
CREATE TABLE IF NOT EXISTS naturezas_operacao (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo             TEXT    NOT NULL UNIQUE,
    descricao          TEXT    NOT NULL,
    sentido            TEXT    NOT NULL CHECK (sentido IN ('entrada', 'saida')),
    finalidade         TEXT    NOT NULL DEFAULT 'normal'
                       CHECK (finalidade IN ('normal', 'devolucao', 'ajuste', 'complementar')),
    cfop_interno       TEXT    REFERENCES cfops (codigo),
    cfop_interestadual TEXT    REFERENCES cfops (codigo),
    movimenta_estoque  TEXT    NOT NULL DEFAULT 'nao'
                       CHECK (movimenta_estoque IN ('entra', 'sai', 'nao')),
    gera_financeiro    TEXT    NOT NULL DEFAULT 'nao'
                       CHECK (gera_financeiro IN ('pagar', 'receber', 'nao')),
    exige_fornecedor   INTEGER NOT NULL DEFAULT 1 CHECK (exige_fornecedor IN (0, 1)),
    ativa              INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),
    criado_em          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
--  PEDIDO DE ENTRADA  (v7)
-- ============================================================
-- A mercadoria que chega com a nota do fornecedor (ou sem nota:
-- bonificação, ajuste). Nasce RASCUNHO (digitado ou importado do XML da
-- NF-e), é conferido e CONFIRMADO: aí vira entradas no estoque (uma por
-- linha; celular é uma linha por aparelho) e contas a pagar pelas
-- duplicatas da nota. CANCELADO é final. Dinheiro em REAL com 2 casas,
-- como entradas e lancamentos (decisão D8 da análise fica para o
-- documento fiscal próprio).
CREATE TABLE IF NOT EXISTS pedidos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    numero              TEXT    UNIQUE,                 -- PE-2026-0001
    empresa_id          INTEGER NOT NULL REFERENCES empresas (id),
    natureza_id         INTEGER NOT NULL REFERENCES naturezas_operacao (id),
    cfop                TEXT    REFERENCES cfops (codigo),
    fornecedor_id       INTEGER REFERENCES fornecedores (id) ON DELETE SET NULL,
    status              TEXT    NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho', 'confirmado', 'cancelado')),

    nota_numero         TEXT,
    nota_serie          TEXT,
    nota_chave          TEXT    CHECK (nota_chave IS NULL OR (length(nota_chave) = 44 AND nota_chave NOT GLOB '*[^0-9A-Z]*')),   -- CNPJ alfanumérico entra na chave
    nota_emissao        TEXT,
    xml_nota            TEXT,                           -- o XML importado, como veio

    data_entrada        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    valor_produtos      REAL    NOT NULL DEFAULT 0,     -- soma das linhas (antes do desconto)
    valor_desconto      REAL    NOT NULL DEFAULT 0,     -- soma dos descontos das linhas
    valor_frete         REAL    NOT NULL DEFAULT 0,
    valor_outros        REAL    NOT NULL DEFAULT 0,
    valor_total         REAL    NOT NULL DEFAULT 0,     -- produtos - desconto + frete + outros
    gerar_financeiro    INTEGER NOT NULL DEFAULT 1 CHECK (gerar_financeiro IN (0, 1)),
    forma_pagamento_id  INTEGER REFERENCES formas_pagamento (id),
    observacoes         TEXT,

    criado_por          INTEGER REFERENCES usuarios (id),
    criado_em           TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    confirmado_por      INTEGER REFERENCES usuarios (id),
    confirmado_em       TEXT,
    cancelado_por       INTEGER REFERENCES usuarios (id),
    cancelado_em        TEXT,
    motivo_cancelamento TEXT
);

CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos (status, data_entrada);
-- A mesma nota não entra duas vezes (a cancelada sai da conta).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_chave ON pedidos (nota_chave)
    WHERE nota_chave IS NOT NULL AND status <> 'cancelado';

-- Uma linha da nota. tipo_item NULL = ainda não ligada ao catálogo (o
-- pedido não confirma assim). Celular: quantidade 1, uma linha por
-- aparelho, com o IMEI. entrada_id: a entrada criada ao confirmar.
CREATE TABLE IF NOT EXISTS pedido_itens (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id         INTEGER NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
    ordem             INTEGER NOT NULL DEFAULT 1,
    tipo_item         TEXT    CHECK (tipo_item IS NULL OR tipo_item IN ('celular', 'peca', 'produto')),
    modelo_id         INTEGER REFERENCES modelos  (id) ON DELETE SET NULL,
    peca_id           INTEGER REFERENCES pecas    (id) ON DELETE SET NULL,
    produto_id        INTEGER REFERENCES produtos (id) ON DELETE SET NULL,
    descricao         TEXT    NOT NULL,               -- como veio na nota
    codigo_fornecedor TEXT,                           -- cProd
    gtin              TEXT,
    ncm               TEXT,
    cest              TEXT,
    cfop_nota         TEXT,                           -- o CFOP de saída que o fornecedor usou
    unidade           TEXT,
    quantidade        INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
    valor_total       REAL    NOT NULL DEFAULT 0,     -- da linha, antes do desconto (vProd)
    valor_desconto    REAL    NOT NULL DEFAULT 0,
    valor_venda       REAL    NOT NULL DEFAULT 0,     -- preço de venda POR UNIDADE da entrada criada
    imei              TEXT,
    cor               TEXT,
    condicao          TEXT    CHECK (condicao IS NULL OR condicao IN ('novo', 'seminovo', 'usado', 'defeito')),
    entrada_id        INTEGER REFERENCES entradas (id) ON DELETE SET NULL,
    CHECK (tipo_item IS NOT 'celular' OR quantidade = 1)
);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON pedido_itens (pedido_id, ordem);

-- As duplicatas da nota (cobr/dup): viram as contas a pagar ao confirmar.
-- Sem nenhuma, o pedido gera UMA conta no total, vencendo na entrada.
CREATE TABLE IF NOT EXISTS pedido_parcelas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id  INTEGER NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
    numero     TEXT,                                 -- nDup
    vencimento TEXT    NOT NULL,
    valor      REAL    NOT NULL CHECK (valor > 0)
);

-- "O código X deste fornecedor é o produto Y": aprendido ao confirmar,
-- sugere o vínculo na próxima nota do mesmo fornecedor.
CREATE TABLE IF NOT EXISTS vinculos_fornecedor (
    fornecedor_id     INTEGER NOT NULL REFERENCES fornecedores (id) ON DELETE CASCADE,
    codigo_fornecedor TEXT    NOT NULL,
    tipo_item         TEXT    NOT NULL CHECK (tipo_item IN ('celular', 'peca', 'produto')),
    modelo_id         INTEGER REFERENCES modelos  (id) ON DELETE CASCADE,
    peca_id           INTEGER REFERENCES pecas    (id) ON DELETE CASCADE,
    produto_id        INTEGER REFERENCES produtos (id) ON DELETE CASCADE,
    atualizado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (fornecedor_id, codigo_fornecedor)
);

SQL);
    if ($faltavam) {
        $feito[] = 'tabelas ' . implode(', ', $faltavam);
    }

    $colunas = array (
  'produtos' => 
  array (
    0 => 
    array (
      0 => 'ncm',
      1 => 'TEXT CHECK (ncm IS NULL OR (length(ncm) = 8 AND ncm NOT GLOB \'*[^0-9]*\'))',
    ),
    1 => 
    array (
      0 => 'cest',
      1 => 'TEXT CHECK (cest IS NULL OR (length(cest) = 7 AND cest NOT GLOB \'*[^0-9]*\'))',
    ),
    2 => 
    array (
      0 => 'origem',
      1 => 'TEXT CHECK (origem IS NULL OR origem IN (\'0\', \'1\', \'2\', \'3\', \'4\', \'5\', \'6\', \'7\', \'8\'))',
    ),
    3 => 
    array (
      0 => 'unidade',
      1 => 'TEXT NOT NULL DEFAULT \'UN\'',
    ),
    4 => 
    array (
      0 => 'gtin',
      1 => 'TEXT',
    ),
  ),
  'pecas' => 
  array (
    0 => 
    array (
      0 => 'ncm',
      1 => 'TEXT CHECK (ncm IS NULL OR (length(ncm) = 8 AND ncm NOT GLOB \'*[^0-9]*\'))',
    ),
    1 => 
    array (
      0 => 'cest',
      1 => 'TEXT CHECK (cest IS NULL OR (length(cest) = 7 AND cest NOT GLOB \'*[^0-9]*\'))',
    ),
    2 => 
    array (
      0 => 'origem',
      1 => 'TEXT CHECK (origem IS NULL OR origem IN (\'0\', \'1\', \'2\', \'3\', \'4\', \'5\', \'6\', \'7\', \'8\'))',
    ),
    3 => 
    array (
      0 => 'unidade',
      1 => 'TEXT NOT NULL DEFAULT \'UN\'',
    ),
    4 => 
    array (
      0 => 'gtin',
      1 => 'TEXT',
    ),
  ),
  'modelos' => 
  array (
    0 => 
    array (
      0 => 'ncm',
      1 => 'TEXT CHECK (ncm IS NULL OR (length(ncm) = 8 AND ncm NOT GLOB \'*[^0-9]*\'))',
    ),
    1 => 
    array (
      0 => 'cest',
      1 => 'TEXT CHECK (cest IS NULL OR (length(cest) = 7 AND cest NOT GLOB \'*[^0-9]*\'))',
    ),
    2 => 
    array (
      0 => 'origem',
      1 => 'TEXT CHECK (origem IS NULL OR origem IN (\'0\', \'1\', \'2\', \'3\', \'4\', \'5\', \'6\', \'7\', \'8\'))',
    ),
    3 => 
    array (
      0 => 'unidade',
      1 => 'TEXT NOT NULL DEFAULT \'UN\'',
    ),
    4 => 
    array (
      0 => 'gtin',
      1 => 'TEXT',
    ),
  ),
  'fornecedores' => 
  array (
    0 => 
    array (
      0 => 'ie',
      1 => 'TEXT',
    ),
    1 => 
    array (
      0 => 'uf',
      1 => 'TEXT CHECK (uf IS NULL OR uf IN (\'AC\', \'AL\', \'AP\', \'AM\', \'BA\', \'CE\', \'DF\', \'ES\', \'GO\', \'MA\', \'MT\', \'MS\', \'MG\', \'PA\', \'PB\', \'PR\', \'PE\', \'PI\', \'RJ\', \'RN\', \'RS\', \'RO\', \'RR\', \'SC\', \'SP\', \'SE\', \'TO\'))',
    ),
  ),
  'lancamentos' => 
  array (
    0 => 
    array (
      0 => 'pedido_id',
      1 => 'INTEGER REFERENCES pedidos (id) ON DELETE SET NULL',
    ),
  ),
);
    foreach ($colunas as $tabela => $lista) {
        foreach ($lista as [$nome, $definicao]) {
            if (adicionarColuna($pdo, $tabela, $nome, $definicao)) {
                $feito[] = "coluna {$tabela}.{$nome}";
            }
        }
    }

    $cfops = array (
  1102 => 'Compra para comercialização',
  1152 => 'Transferência para comercialização',
  1202 => 'Devolução de venda de mercadoria adquirida ou recebida de terceiros',
  1403 => 'Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária',
  1411 => 'Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária',
  1556 => 'Compra de material para uso ou consumo',
  1910 => 'Entrada de bonificação, doação ou brinde',
  1915 => 'Entrada de mercadoria ou bem recebido para conserto ou reparo',
  1916 => 'Retorno de mercadoria ou bem remetido para conserto ou reparo',
  1949 => 'Outra entrada de mercadoria ou prestação de serviço não especificada',
  2102 => 'Compra para comercialização',
  2152 => 'Transferência para comercialização',
  2202 => 'Devolução de venda de mercadoria adquirida ou recebida de terceiros',
  2403 => 'Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária',
  2411 => 'Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária',
  2556 => 'Compra de material para uso ou consumo',
  2910 => 'Entrada de bonificação, doação ou brinde',
  2915 => 'Entrada de mercadoria ou bem recebido para conserto ou reparo',
  2916 => 'Retorno de mercadoria ou bem remetido para conserto ou reparo',
  2949 => 'Outra entrada de mercadoria ou prestação de serviço não especificada',
  5102 => 'Venda de mercadoria adquirida ou recebida de terceiros',
  5152 => 'Transferência de mercadoria adquirida ou recebida de terceiros',
  5202 => 'Devolução de compra para comercialização',
  5405 => 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído',
  5411 => 'Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária',
  5910 => 'Remessa em bonificação, doação ou brinde',
  5915 => 'Remessa de mercadoria ou bem para conserto ou reparo',
  5916 => 'Retorno de mercadoria ou bem recebido para conserto ou reparo',
  5933 => 'Prestação de serviço tributado pelo ISSQN',
  5949 => 'Outra saída de mercadoria ou prestação de serviço não especificado',
  6102 => 'Venda de mercadoria adquirida ou recebida de terceiros',
  6202 => 'Devolução de compra para comercialização',
  6411 => 'Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária',
  6949 => 'Outra saída de mercadoria ou prestação de serviço não especificado',
);
    $st = $pdo->prepare('INSERT OR IGNORE INTO cfops (codigo, descricao, oficial) VALUES (?, ?, 1)');
    $n = 0;
    foreach ($cfops as $codigo => $descricao) {
        $st->execute([(string) $codigo, $descricao]);
        $n += $st->rowCount();
    }
    $feito[] = "CFOP de referência: {$n}";

    $naturezas = array (
  0 => 
  array (
    0 => 'COMPRA_REVENDA',
    1 => 'Compra para revenda',
    2 => 'entrada',
    3 => 'normal',
    4 => '1102',
    5 => '2102',
    6 => 'entra',
    7 => 'pagar',
    8 => 1,
    9 => 1,
  ),
  1 => 
  array (
    0 => 'COMPRA_REVENDA_ST',
    1 => 'Compra para revenda com substituição tributária',
    2 => 'entrada',
    3 => 'normal',
    4 => '1403',
    5 => '2403',
    6 => 'entra',
    7 => 'pagar',
    8 => 1,
    9 => 1,
  ),
  2 => 
  array (
    0 => 'COMPRA_USADO_PF',
    1 => 'Compra de celular usado de pessoa física',
    2 => 'entrada',
    3 => 'normal',
    4 => '1102',
    5 => NULL,
    6 => 'entra',
    7 => 'pagar',
    8 => 1,
    9 => 1,
  ),
  3 => 
  array (
    0 => 'BONIFICACAO',
    1 => 'Bonificação, doação ou brinde recebido',
    2 => 'entrada',
    3 => 'normal',
    4 => '1910',
    5 => '2910',
    6 => 'entra',
    7 => 'nao',
    8 => 1,
    9 => 1,
  ),
  4 => 
  array (
    0 => 'USO_CONSUMO',
    1 => 'Compra de material de uso e consumo',
    2 => 'entrada',
    3 => 'normal',
    4 => '1556',
    5 => '2556',
    6 => 'nao',
    7 => 'pagar',
    8 => 1,
    9 => 1,
  ),
  5 => 
  array (
    0 => 'ENTRADA_AJUSTE',
    1 => 'Outra entrada (ajuste ou regularização)',
    2 => 'entrada',
    3 => 'ajuste',
    4 => '1949',
    5 => '2949',
    6 => 'entra',
    7 => 'nao',
    8 => 0,
    9 => 1,
  ),
  6 => 
  array (
    0 => 'DEVOLUCAO_CLIENTE',
    1 => 'Devolução de venda (cliente devolve)',
    2 => 'entrada',
    3 => 'devolucao',
    4 => '1202',
    5 => '2202',
    6 => 'entra',
    7 => 'nao',
    8 => 0,
    9 => 0,
  ),
  7 => 
  array (
    0 => 'VENDA',
    1 => 'Venda de mercadoria',
    2 => 'saida',
    3 => 'normal',
    4 => '5102',
    5 => '6102',
    6 => 'sai',
    7 => 'receber',
    8 => 0,
    9 => 0,
  ),
  8 => 
  array (
    0 => 'DEVOLUCAO_FORNECEDOR',
    1 => 'Devolução de compra ao fornecedor',
    2 => 'saida',
    3 => 'devolucao',
    4 => '5202',
    5 => '6202',
    6 => 'sai',
    7 => 'nao',
    8 => 1,
    9 => 0,
  ),
);
    $st = $pdo->prepare('INSERT OR IGNORE INTO naturezas_operacao (codigo, descricao, sentido, finalidade, cfop_interno,
        cfop_interestadual, movimenta_estoque, gera_financeiro, exige_fornecedor, ativa) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $n = 0;
    foreach ($naturezas as $linha) {
        $st->execute($linha);
        $n += $st->rowCount();
    }
    $feito[] = "naturezas de operação: {$n}";

    return $feito;
};
