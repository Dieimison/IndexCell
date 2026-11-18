<?php
/**
 * Passo 008 (v7 -> v8): loja online.
 *   - tabelas novas: loja_ajustes (uma linha, a loja nasce FECHADA),
 *     loja_contas, loja_enderecos, anuncios, anuncio_fotos, encomendas,
 *     encomenda_itens, encomenda_eventos.
 * So acrescenta: nenhuma tabela antiga muda e nenhum dado antigo mexe.
 * As definicoes estao escritas aqui (o estrutura.sql so tem a ultima versao).
 */

declare(strict_types=1);

return function (PDO $pdo): array {
    $tabelas = ['loja_ajustes', 'loja_contas', 'loja_enderecos', 'anuncios', 'anuncio_fotos',
                'encomendas', 'encomenda_itens', 'encomenda_eventos'];
    $faltavam = array_values(array_filter($tabelas, fn ($t) => !temTabela($pdo, $t)));
    $pdo->exec(<<<'SQL'

-- ============================================================
--  LOJA ONLINE  (v8)
-- ============================================================
-- A vitrine na internet (pasta Loja\): o cliente cria a conta, vê os
-- anúncios, encomenda e acompanha a entrega. O anúncio aponta para UMA
-- entrada do estoque: o que a loja online vende é o mesmo item da
-- prateleira. A encomenda só RESERVA o item até o pagamento; quando o
-- administrador confirma o pagamento, nasce a venda de verdade (baixa
-- no estoque + conta a receber já paga), pelas mesmas funções do PDV.

-- ------------------------------------------------------------
-- AJUSTES DA LOJA ONLINE  (uma linha só, id = 1)
-- ------------------------------------------------------------
-- aberta = 0: a vitrine mostra os produtos, mas não aceita encomenda.
-- frete_gratis_acima = 0: nunca é grátis.
CREATE TABLE IF NOT EXISTS loja_ajustes (
    id                    INTEGER PRIMARY KEY CHECK (id = 1),
    aberta                INTEGER NOT NULL DEFAULT 0 CHECK (aberta IN (0, 1)),
    nome_vitrine          TEXT,
    frete_fixo            REAL    NOT NULL DEFAULT 0 CHECK (frete_fixo >= 0),
    frete_gratis_acima    REAL    NOT NULL DEFAULT 0 CHECK (frete_gratis_acima >= 0),
    prazo_pagamento_horas INTEGER NOT NULL DEFAULT 48 CHECK (prazo_pagamento_horas BETWEEN 1 AND 720),
    prazo_entrega_dias    INTEGER NOT NULL DEFAULT 5 CHECK (prazo_entrega_dias BETWEEN 1 AND 90),
    chave_pix             TEXT,
    recebedor_pix         TEXT,
    cidade_origem         TEXT,                  -- de onde a encomenda sai (o começo do rastreio)
    atualizado_em         TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id            INTEGER REFERENCES usuarios (id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- CONTAS DE CLIENTE DA LOJA ONLINE
-- ------------------------------------------------------------
-- Não é a tabela usuarios: cliente da vitrine nunca entra no painel.
-- A senha segue o mesmo formato PBKDF2 dos usuários. cliente_id liga a
-- conta ao cadastro de clientes (nasce no primeiro pagamento), e é ele
-- que aparece na venda e no financeiro.
CREATE TABLE IF NOT EXISTS loja_contas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    nome          TEXT    NOT NULL,
    telefone      TEXT    NOT NULL,
    cpf           TEXT    CHECK (cpf IS NULL OR (length(cpf) = 11 AND cpf NOT GLOB '*[^0-9]*')),
    senha_hash    TEXT    NOT NULL,
    cliente_id    INTEGER REFERENCES clientes (id) ON DELETE SET NULL,
    ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    ultimo_acesso TEXT
);

-- Endereços de entrega guardados na conta (a encomenda COPIA o endereço:
-- mudar ou apagar aqui não muda a encomenda já feita).
CREATE TABLE IF NOT EXISTS loja_enderecos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    conta_id     INTEGER NOT NULL REFERENCES loja_contas (id) ON DELETE CASCADE,
    destinatario TEXT    NOT NULL,
    cep          TEXT    NOT NULL CHECK (length(cep) = 8 AND cep NOT GLOB '*[^0-9]*'),
    logradouro   TEXT    NOT NULL,
    numero       TEXT    NOT NULL,
    complemento  TEXT,
    bairro       TEXT    NOT NULL,
    cidade       TEXT    NOT NULL,
    uf           TEXT    NOT NULL CHECK (uf IN ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
                                                 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR',
                                                 'SC', 'SP', 'SE', 'TO')),
    criado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_loja_enderecos_conta ON loja_enderecos (conta_id);

-- ------------------------------------------------------------
-- ANÚNCIOS  (o que o administrador posta na vitrine)
-- ------------------------------------------------------------
-- O preço do anúncio é o da loja online (pode ser diferente do balcão).
-- O que dá para vender é o saldo da entrada menos o que outras
-- encomendas aguardando pagamento estão segurando (reservaDoAnuncio).
CREATE TABLE IF NOT EXISTS anuncios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entrada_id    INTEGER NOT NULL REFERENCES entradas (id),
    titulo        TEXT    NOT NULL,
    descricao     TEXT,
    preco         REAL    NOT NULL CHECK (preco > 0),
    publicado     INTEGER NOT NULL DEFAULT 1 CHECK (publicado IN (0, 1)),
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id    INTEGER REFERENCES usuarios (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_anuncios_entrada   ON anuncios (entrada_id);
CREATE INDEX IF NOT EXISTS idx_anuncios_publicado ON anuncios (publicado);

-- As fotos ficam DENTRO do banco: a cópia de segurança do banco leva
-- as fotos junto, e nenhuma pasta pública guarda arquivo enviado.
CREATE TABLE IF NOT EXISTS anuncio_fotos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    anuncio_id INTEGER NOT NULL REFERENCES anuncios (id) ON DELETE CASCADE,
    ordem      INTEGER NOT NULL DEFAULT 0,
    tipo       TEXT    NOT NULL CHECK (tipo IN ('image/jpeg', 'image/png', 'image/webp')),
    dados      BLOB    NOT NULL,
    criado_em  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_anuncio_fotos_anuncio ON anuncio_fotos (anuncio_id, ordem);

-- ------------------------------------------------------------
-- ENCOMENDAS  (o pedido do cliente da loja online)
-- ------------------------------------------------------------
-- status anda pela trilha STATUS_ENCOMENDA_TRILHA (api/nucleo.php), um
-- passo por vez; cada passo grava um evento (encomenda_eventos), que é
-- o rastreio que o cliente vê. venda_id = a venda criada no pagamento.
CREATE TABLE IF NOT EXISTS encomendas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    numero              TEXT    UNIQUE,          -- ex.: LJ-2026-0001
    conta_id            INTEGER NOT NULL REFERENCES loja_contas (id),
    status              TEXT    NOT NULL DEFAULT 'aguardando_pagamento'
                        CHECK (status IN ('aguardando_pagamento', 'pago', 'separacao', 'enviado', 'em_transito',
                                          'saiu_entrega', 'entregue', 'cancelada')),
    valor_produtos      REAL    NOT NULL DEFAULT 0,
    frete               REAL    NOT NULL DEFAULT 0,
    valor_total         REAL    NOT NULL DEFAULT 0,
    entrega_destinatario TEXT   NOT NULL,
    entrega_cep         TEXT    NOT NULL,
    entrega_logradouro  TEXT    NOT NULL,
    entrega_numero      TEXT    NOT NULL,
    entrega_complemento TEXT,
    entrega_bairro      TEXT    NOT NULL,
    entrega_cidade      TEXT    NOT NULL,
    entrega_uf          TEXT    NOT NULL,
    entrega_telefone    TEXT,
    observacoes         TEXT,                    -- recado do cliente
    pagar_ate           TEXT    NOT NULL,        -- depois disso, a reserva cai
    previsao_entrega    TEXT,
    transportadora      TEXT,
    codigo_rastreio     TEXT,
    venda_id            INTEGER REFERENCES vendas (id) ON DELETE SET NULL,
    motivo_cancelamento TEXT,
    criado_em           TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_encomendas_conta  ON encomendas (conta_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_encomendas_status ON encomendas (status, pagar_ate);
CREATE INDEX IF NOT EXISTS idx_encomendas_venda  ON encomendas (venda_id);

CREATE TABLE IF NOT EXISTS encomenda_itens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    encomenda_id   INTEGER NOT NULL REFERENCES encomendas (id) ON DELETE CASCADE,
    anuncio_id     INTEGER          REFERENCES anuncios   (id) ON DELETE SET NULL,
    entrada_id     INTEGER NOT NULL REFERENCES entradas   (id),
    descricao      TEXT    NOT NULL,
    quantidade     INTEGER NOT NULL CHECK (quantidade > 0),
    valor_unitario REAL    NOT NULL CHECK (valor_unitario > 0),
    subtotal       REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_encomenda_itens_encomenda ON encomenda_itens (encomenda_id);
CREATE INDEX IF NOT EXISTS idx_encomenda_itens_entrada   ON encomenda_itens (entrada_id);
CREATE INDEX IF NOT EXISTS idx_encomenda_itens_anuncio   ON encomenda_itens (anuncio_id);

-- O rastreio: um evento por passo (e um no cancelamento). local e
-- observacao são o que o administrador escreveu ("Centro de
-- distribuição de Curitiba"); o cliente vê os dois.
CREATE TABLE IF NOT EXISTS encomenda_eventos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    encomenda_id INTEGER NOT NULL REFERENCES encomendas (id) ON DELETE CASCADE,
    status       TEXT    NOT NULL,
    momento      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    local        TEXT,
    observacao   TEXT,
    usuario_id   INTEGER REFERENCES usuarios (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_encomenda_eventos ON encomenda_eventos (encomenda_id, id);
SQL);
    $pdo->exec('INSERT OR IGNORE INTO loja_ajustes (id) VALUES (1)');
    return [$faltavam ? 'tabelas da loja online criadas: ' . implode(', ', $faltavam) : 'tabelas da loja online ja existiam',
            'loja online nasce fechada (Loja online > Ajustes)'];
};
