-- ============================================================
--  INDEX CELULARES - Sistema de Assistência Técnica
--  Estrutura do banco de dados (SQLite) - versão 2
--
--  Este arquivo é a receita do banco. O arquivo pronto para uso
--  é o index.sqlite, nesta mesma pasta.
--
--  Para aplicar (cria o que falta, não apaga nada):
--      php dados/aplicar-estrutura.php
--
--  ------------------------------------------------------------
--  COMO O BANCO ESTÁ ORGANIZADO
--
--  CADASTRO ("o que existe no mundo", não tem quantidade)
--      clientes, fornecedores, modelos, pecas, produtos
--
--  MOVIMENTO ("o que entrou e o que saiu", tem quantidade)
--      entradas       -> tudo que chega na loja (celular/peça/produto)
--      vendas         -> saída pela venda, com venda_itens
--      ordens_servico -> saída pelo conserto, com os_itens
--
--  FINANCEIRO
--      lancamentos    -> a pagar e a receber, manual ou gerado
--
--  O saldo NUNCA é uma coluna gravada: é calculado em
--  vw_entradas_saldo (entrou - vendido - usado em OS). Coluna de
--  saldo desencontra da realidade na primeira exclusão; conta não.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- USUÁRIOS  (quem entra no sistema)
-- ------------------------------------------------------------
-- A senha NUNCA é guardada em texto puro. A coluna senha_hash guarda
-- um PBKDF2-SHA256 no formato:
--
--     pbkdf2$sha256$<iterações>$<salt em hex>$<hash em hex>
CREATE TABLE IF NOT EXISTS usuarios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario     TEXT    NOT NULL UNIQUE,
    nome        TEXT    NOT NULL,
    senha_hash  TEXT    NOT NULL,
    perfil      TEXT    NOT NULL DEFAULT 'tecnico'
                CHECK (perfil IN ('admin', 'tecnico', 'balcao')),
    ativo       INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    ultimo_acesso TEXT,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
--  CADASTROS
-- ============================================================

-- ------------------------------------------------------------
-- CLIENTES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT    NOT NULL,
    telefone    TEXT,
    documento   TEXT,                      -- CPF ou CNPJ
    email       TEXT,
    endereco    TEXT,
    observacoes TEXT,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_clientes_nome     ON clientes (nome);
CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes (telefone);

-- ------------------------------------------------------------
-- FORNECEDORES  (de quem a loja compra)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fornecedores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT    NOT NULL,
    telefone    TEXT,
    documento   TEXT,
    email       TEXT,
    endereco    TEXT,
    observacoes TEXT,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_fornecedores_nome ON fornecedores (nome);

-- ------------------------------------------------------------
-- FORMAS DE PAGAMENTO
-- ------------------------------------------------------------
-- Era um campo de digitar, e campo de digitar em relatório vira "Pix",
-- "pix" e "PIX" — três linhas no agrupamento para o mesmo dinheiro.
--
-- Venda, OS e lançamento apontam para cá por forma_pagamento_id. A
-- coluna de texto continua existindo nas três tabelas, guardando o que
-- foi digitado antes deste cadastro existir; as consultas usam
-- COALESCE(cadastro, texto) para que o histórico antigo não suma.
--
-- parcelas_padrao é o que a tela sugere ao escolher a forma: cartão de
-- crédito costuma ser parcelado, Pix não.
CREATE TABLE IF NOT EXISTS formas_pagamento (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT    NOT NULL UNIQUE,
    tipo            TEXT    NOT NULL DEFAULT 'vista'
                    CHECK (tipo IN ('vista', 'prazo', 'cartao', 'outro')),
    parcelas_padrao INTEGER NOT NULL DEFAULT 1 CHECK (parcelas_padrao > 0),
    ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    ordem           INTEGER NOT NULL DEFAULT 0,
    observacoes     TEXT,
    criado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_formas_ativo ON formas_pagamento (ativo, ordem);

-- ------------------------------------------------------------
-- MODELOS  (catálogo de celulares: "Apple iPhone 11 128GB")
-- ------------------------------------------------------------
-- É este cadastro que alimenta o select da Ordem de Serviço. Se o
-- modelo ainda não existe, a própria tela da OS cadastra na hora;
-- da segunda vez em diante é só escolher na lista.
CREATE TABLE IF NOT EXISTS modelos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    marca         TEXT    NOT NULL DEFAULT '',
    modelo        TEXT    NOT NULL,
    armazenamento TEXT    NOT NULL DEFAULT '',   -- 64GB, 128GB... vazio = não se aplica
    observacoes   TEXT,
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (marca, modelo, armazenamento)
);

CREATE INDEX IF NOT EXISTS idx_modelos_modelo ON modelos (modelo);

-- ------------------------------------------------------------
-- PEÇAS  (catálogo de peças de reposição)
-- ------------------------------------------------------------
-- modelo_id é opcional: peça universal (parafuso, cola, fita) não
-- pertence a modelo nenhum.
CREATE TABLE IF NOT EXISTS pecas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT    NOT NULL,
    categoria   TEXT    NOT NULL DEFAULT 'outra'
                CHECK (categoria IN ('tela', 'bateria', 'placa_carga', 'flex_carga',
                                     'camera', 'flex_volume', 'flex_power', 'outra')),
    modelo_id   INTEGER REFERENCES modelos (id) ON DELETE SET NULL,
    codigo      TEXT,                      -- código do fornecedor / SKU
    observacoes TEXT,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_pecas_categoria ON pecas (categoria);
CREATE INDEX IF NOT EXISTS idx_pecas_modelo    ON pecas (modelo_id);

-- ------------------------------------------------------------
-- PRODUTOS  (acessórios: capa, película, carregador, fone...)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS produtos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT    NOT NULL,
    categoria   TEXT,                      -- capa, película, carregador...
    marca       TEXT,
    codigo      TEXT,
    observacoes TEXT,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_produtos_nome ON produtos (nome);

-- ------------------------------------------------------------
-- APARELHOS  (o celular físico que o cliente deixou na loja)
-- ------------------------------------------------------------
-- Não é cadastro solto: nasce dentro da Ordem de Serviço. O modelo vem
-- do catálogo (modelo_id) e a API copia marca/modelo para cá no momento
-- da abertura. Essa cópia é de propósito: se o modelo for renomeado no
-- catálogo daqui a um ano, a OS antiga continua dizendo o que o cliente
-- entregou naquele dia.
CREATE TABLE IF NOT EXISTS aparelhos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id     INTEGER REFERENCES clientes (id) ON DELETE SET NULL,
    modelo_id      INTEGER REFERENCES modelos  (id) ON DELETE SET NULL,
    marca          TEXT,
    modelo         TEXT NOT NULL,
    cor            TEXT,
    imei           TEXT,
    senha_aparelho TEXT,                   -- padrão/PIN informado pelo cliente
    acessorios     TEXT,                   -- capa, chip, cartão de memória...
    criado_em      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_aparelhos_cliente ON aparelhos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_aparelhos_imei    ON aparelhos (imei);
CREATE INDEX IF NOT EXISTS idx_aparelhos_modelo  ON aparelhos (modelo_id);

-- ============================================================
--  MOVIMENTO
-- ============================================================

-- ------------------------------------------------------------
-- ENTRADAS  (tudo que chega na loja - substitui a antiga "estoque")
-- ------------------------------------------------------------
-- Uma linha por compra. O tipo decide qual coluna de catálogo vale
-- e quais campos a tela mostra:
--
--   celular -> modelo_id  + imei, cor, condicao   (quantidade sempre 1)
--   peca    -> peca_id    + quantidade
--   produto -> produto_id + quantidade
--
-- situacao vale de verdade para celular (é o que move os cards do
-- dashboard). Peça e produto entram como 'ready' e quem manda no
-- que sobrou é o saldo.
CREATE TABLE IF NOT EXISTS entradas (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo               TEXT    NOT NULL DEFAULT 'celular'
                       CHECK (tipo IN ('celular', 'peca', 'produto')),

    modelo_id          INTEGER REFERENCES modelos      (id) ON DELETE SET NULL,
    peca_id            INTEGER REFERENCES pecas        (id) ON DELETE SET NULL,
    produto_id         INTEGER REFERENCES produtos     (id) ON DELETE SET NULL,
    fornecedor_id      INTEGER REFERENCES fornecedores (id) ON DELETE SET NULL,

    descricao          TEXT,               -- complemento livre; o nome sai do catálogo
    quantidade         INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
    valor_investimento REAL    NOT NULL DEFAULT 0,   -- custo POR UNIDADE
    valor_venda        REAL    NOT NULL DEFAULT 0,   -- preço POR UNIDADE

    situacao           TEXT    NOT NULL DEFAULT 'check'
                       CHECK (situacao IN ('ready', 'processamento', 'check', 'vendido')),

    -- só para celular
    imei               TEXT,
    cor                TEXT,
    condicao           TEXT    CHECK (condicao IS NULL OR
                                      condicao IN ('novo', 'seminovo', 'usado', 'defeito')),

    nota_fiscal        TEXT,
    observacoes        TEXT,
    data_entrada       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    data_venda         TEXT,

    -- celular é unitário: 1 IMEI = 1 aparelho
    CHECK (tipo <> 'celular' OR quantidade = 1)
);

CREATE INDEX IF NOT EXISTS idx_entradas_tipo       ON entradas (tipo);
CREATE INDEX IF NOT EXISTS idx_entradas_situacao   ON entradas (situacao);
CREATE INDEX IF NOT EXISTS idx_entradas_fornecedor ON entradas (fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_entradas_imei       ON entradas (imei);

-- ------------------------------------------------------------
-- ORDENS DE SERVIÇO  (o coração do sistema)
-- ------------------------------------------------------------
-- cliente_id e aparelho_id são escolhidos em lista, nunca digitados.
-- valor_pecas deixou de ser um número solto: é a soma de os_itens,
-- recalculada pela API sempre que um item entra ou sai.
CREATE TABLE IF NOT EXISTS ordens_servico (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    numero           TEXT    UNIQUE,       -- ex.: OS-2026-0001
    cliente_id       INTEGER NOT NULL REFERENCES clientes  (id),
    aparelho_id      INTEGER          REFERENCES aparelhos (id),
    tecnico_id       INTEGER          REFERENCES usuarios  (id),

    defeito_relatado  TEXT,                -- o que o cliente disse
    diagnostico       TEXT,                -- o que o técnico encontrou
    servico_executado TEXT,                -- o que foi feito

    status           TEXT    NOT NULL DEFAULT 'aberta'
                     CHECK (status IN ('aberta', 'orcamento', 'aprovada',
                                       'em_reparo', 'pronta', 'entregue',
                                       'recusada', 'cancelada')),

    valor_orcamento  REAL    NOT NULL DEFAULT 0,
    valor_pecas      REAL    NOT NULL DEFAULT 0,   -- soma de os_itens
    valor_mao_obra   REAL    NOT NULL DEFAULT 0,
    valor_final      REAL    NOT NULL DEFAULT 0,
    forma_pagamento  TEXT,

    data_entrada     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    data_previsao    TEXT,
    data_entrega     TEXT,
    garantia_dias    INTEGER NOT NULL DEFAULT 90,

    observacoes      TEXT,
    -- A venda gerada quando esta OS foi entregue. É ela que faz a peça
    -- voltar à prateleira e sair de novo pela venda, e é o que impede o
    -- relatório de contar a mesma receita duas vezes.
    venda_id         INTEGER          REFERENCES vendas (id),
    atualizado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_os_status  ON ordens_servico (status);
CREATE INDEX IF NOT EXISTS idx_os_venda   ON ordens_servico (venda_id);
CREATE INDEX IF NOT EXISTS idx_os_cliente ON ordens_servico (cliente_id);
CREATE INDEX IF NOT EXISTS idx_os_entrada ON ordens_servico (data_entrada);

-- Mantém atualizado_em sempre em dia, sem precisar lembrar no PHP
CREATE TRIGGER IF NOT EXISTS trg_os_atualizado
AFTER UPDATE ON ordens_servico
FOR EACH ROW
BEGIN
    UPDATE ordens_servico
       SET atualizado_em = datetime('now', 'localtime')
     WHERE id = OLD.id;
END;

-- ------------------------------------------------------------
-- ITENS DA OS  (peças e produtos gastos no conserto)
-- ------------------------------------------------------------
-- entrada_id aponta para o lote de onde a peça saiu: é isso que dá
-- a baixa no saldo. descricao e valor_unitario ficam congelados na
-- linha, para o histórico não mudar se o catálogo mudar depois.
CREATE TABLE IF NOT EXISTS os_itens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    os_id          INTEGER NOT NULL REFERENCES ordens_servico (id) ON DELETE CASCADE,
    -- Uma linha da OS e uma peca do estoque OU um servico do catalogo.
    -- Peca da baixa no saldo; servico nao tem estoque, e mao de obra.
    entrada_id     INTEGER          REFERENCES entradas       (id) ON DELETE SET NULL,
    servico_id     INTEGER          REFERENCES servicos       (id),
    descricao      TEXT    NOT NULL,
    quantidade     INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
    valor_unitario REAL    NOT NULL DEFAULT 0,
    custo_unitario REAL    NOT NULL DEFAULT 0,
    subtotal       REAL    NOT NULL DEFAULT 0,
    criado_em      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_os_itens_os      ON os_itens (os_id);
CREATE INDEX IF NOT EXISTS idx_os_itens_entrada ON os_itens (entrada_id);
CREATE INDEX IF NOT EXISTS idx_os_itens_servico ON os_itens (servico_id);

-- ------------------------------------------------------------------
-- Servicos: o que a oficina faz, com preco de tabela
-- ------------------------------------------------------------------
-- O preco daqui e SUGESTAO. O que fica gravado na OS e o cobrado de
-- verdade (os_itens.valor_unitario) - senao mudar a tabela amanha
-- reescreveria o historico do que ja foi cobrado.
CREATE TABLE IF NOT EXISTS servicos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nome         TEXT    NOT NULL,
    descricao    TEXT,
    valor_padrao REAL    NOT NULL DEFAULT 0,
    tempo_medio  INTEGER,
    ativo        INTEGER NOT NULL DEFAULT 1,
    criado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_servicos_nome ON servicos (nome);

-- ------------------------------------------------------------------
-- Pagamento dividido da OS
-- ------------------------------------------------------------------
-- "Metade em dinheiro, metade no debito" e o caso comum no balcao. Uma
-- linha por forma; a soma tem de bater com ordens_servico.valor_final,
-- conferido na API. As colunas forma_pagamento/forma_pagamento_id da OS
-- guardam a PRIMEIRA forma, para as telas antigas continuarem lendo.
CREATE TABLE IF NOT EXISTS os_pagamentos (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    os_id              INTEGER NOT NULL REFERENCES ordens_servico  (id) ON DELETE CASCADE,
    forma_pagamento_id INTEGER          REFERENCES formas_pagamento(id),
    forma_pagamento    TEXT,
    valor              REAL    NOT NULL,
    parcelas           INTEGER NOT NULL DEFAULT 1,
    criado_em          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_os_pagamentos_os ON os_pagamentos (os_id);

-- ------------------------------------------------------------
-- HISTÓRICO DA OS  (cada mudança de status vira uma linha)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS os_historico (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    os_id        INTEGER NOT NULL REFERENCES ordens_servico (id) ON DELETE CASCADE,
    usuario_id   INTEGER          REFERENCES usuarios (id),
    status_de    TEXT,
    status_para  TEXT    NOT NULL,
    comentario   TEXT,
    criado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_historico_os ON os_historico (os_id);

-- ------------------------------------------------------------
-- VENDAS  (balcão: sai do estoque, entra no financeiro)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    numero          TEXT    UNIQUE,        -- ex.: VD-2026-0001
    cliente_id      INTEGER          REFERENCES clientes (id),
    usuario_id      INTEGER          REFERENCES usuarios (id),

    valor_bruto     REAL    NOT NULL DEFAULT 0,   -- soma dos itens
    desconto        REAL    NOT NULL DEFAULT 0,
    valor_total     REAL    NOT NULL DEFAULT 0,   -- bruto - desconto
    custo_total     REAL    NOT NULL DEFAULT 0,   -- para calcular o lucro

    forma_pagamento TEXT,
    parcelas        INTEGER NOT NULL DEFAULT 1 CHECK (parcelas > 0),

    status          TEXT    NOT NULL DEFAULT 'concluida'
                    CHECK (status IN ('concluida', 'cancelada')),

    data_venda      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    observacoes     TEXT,
    atualizado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_vendas_data    ON vendas (data_venda);
CREATE INDEX IF NOT EXISTS idx_vendas_cliente ON vendas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_vendas_status  ON vendas (status);

CREATE TABLE IF NOT EXISTS venda_itens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id       INTEGER NOT NULL REFERENCES vendas   (id) ON DELETE CASCADE,
    entrada_id     INTEGER          REFERENCES entradas (id) ON DELETE SET NULL,
    descricao      TEXT    NOT NULL,
    quantidade     INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
    valor_unitario REAL    NOT NULL DEFAULT 0,
    custo_unitario REAL    NOT NULL DEFAULT 0,
    subtotal       REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_venda_itens_venda   ON venda_itens (venda_id);
CREATE INDEX IF NOT EXISTS idx_venda_itens_entrada ON venda_itens (entrada_id);

-- ------------------------------------------------------------
-- MOVIMENTAÇÕES  (o que entra e sai fora de compra, venda e OS)
-- ------------------------------------------------------------
-- Compra, venda e ordem de serviço já movem o estoque sozinhas. Esta
-- tabela é para o resto do que acontece de verdade numa assistência:
--
--   garantia   o fornecedor mandou a peça nova sem cobrar   (entrada)
--   retorno    a peça voltou para a prateleira              (entrada)
--   devolucao  a peça foi devolvida ao fornecedor           (saída)
--   defeito    a peça veio com defeito e saiu do estoque    (saída)
--   perda      quebrou, sumiu, estragou                     (saída)
--   ajuste     acerto de inventário, para os dois lados
--
-- os_id liga o movimento à ordem de serviço que revelou o problema -
-- é o que permite responder "esta tela deu defeito em qual conserto?".
--
-- Nada aqui apaga a saída original: a peça que saiu numa OS continua
-- registrada nela. O movimento é um lançamento novo, e o saldo é a
-- soma de todos. Um estoque que reescreve o passado não é auditável.
CREATE TABLE IF NOT EXISTS movimentacoes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entrada_id    INTEGER NOT NULL REFERENCES entradas       (id) ON DELETE CASCADE,
    tipo          TEXT    NOT NULL CHECK (tipo IN ('entrada', 'saida')),
    motivo        TEXT    NOT NULL DEFAULT 'ajuste'
                  CHECK (motivo IN ('garantia', 'retorno', 'devolucao',
                                    'defeito', 'perda', 'ajuste')),
    quantidade    INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),

    os_id         INTEGER REFERENCES ordens_servico (id) ON DELETE SET NULL,
    fornecedor_id INTEGER REFERENCES fornecedores   (id) ON DELETE SET NULL,
    valor         REAL    NOT NULL DEFAULT 0,   -- crédito/custo do movimento
    observacoes   TEXT,
    usuario_id    INTEGER REFERENCES usuarios (id),
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_mov_entrada ON movimentacoes (entrada_id);
CREATE INDEX IF NOT EXISTS idx_mov_os      ON movimentacoes (os_id);
CREATE INDEX IF NOT EXISTS idx_mov_data    ON movimentacoes (criado_em);

-- ============================================================
--  FINANCEIRO
-- ============================================================

-- ------------------------------------------------------------
-- LANÇAMENTOS  (a pagar e a receber)
-- ------------------------------------------------------------
-- origem = 'manual'  -> digitado na tela do financeiro
--          'venda'   -> criado sozinho ao fechar uma venda
--          'os'      -> criado sozinho ao entregar uma OS
--          'entrada' -> criado sozinho ao comprar (a pagar)
--
-- Lançamento de origem automática pode ser editado (valor, vencimento,
-- baixa), mas não some sozinho: quem cancela a venda cancela o
-- lançamento junto.
CREATE TABLE IF NOT EXISTS lancamentos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo            TEXT    NOT NULL CHECK (tipo IN ('receber', 'pagar')),
    descricao       TEXT    NOT NULL,
    categoria       TEXT,                  -- venda, serviço, aluguel, fornecedor...
    valor           REAL    NOT NULL DEFAULT 0,

    vencimento      TEXT,                  -- AAAA-MM-DD
    data_pagamento  TEXT,                  -- preenchido ao dar baixa
    status          TEXT    NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente', 'pago', 'cancelado')),

    origem          TEXT    NOT NULL DEFAULT 'manual'
                    CHECK (origem IN ('manual', 'venda', 'os', 'entrada')),
    venda_id        INTEGER REFERENCES vendas         (id) ON DELETE SET NULL,
    os_id           INTEGER REFERENCES ordens_servico (id) ON DELETE SET NULL,
    entrada_id      INTEGER REFERENCES entradas       (id) ON DELETE SET NULL,
    cliente_id      INTEGER REFERENCES clientes       (id) ON DELETE SET NULL,
    fornecedor_id   INTEGER REFERENCES fornecedores   (id) ON DELETE SET NULL,

    forma_pagamento TEXT,
    parcela         INTEGER NOT NULL DEFAULT 1,
    total_parcelas  INTEGER NOT NULL DEFAULT 1,
    observacoes     TEXT,
    usuario_id      INTEGER REFERENCES usuarios (id),
    criado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ------------------------------------------------------------
-- LOG DE ALTERAÇÃO DOS LANÇAMENTOS
-- ------------------------------------------------------------
-- Lançamento é dinheiro: quem mudou o valor de uma conta, e de quanto
-- para quanto, é pergunta que aparece semanas depois — quando ninguém
-- lembra. Cada alteração de campo sensível vira uma linha aqui.
--
-- Só os campos que mudam o significado financeiro entram: valor,
-- parcelas, destinatário (cliente/fornecedor), vencimento e status.
-- Corrigir um erro de digitação na descrição não precisa de auditoria.
CREATE TABLE IF NOT EXISTS lancamentos_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lancamento_id INTEGER NOT NULL REFERENCES lancamentos (id) ON DELETE CASCADE,
    campo         TEXT    NOT NULL,
    valor_antes   TEXT,
    valor_depois  TEXT,
    usuario_id    INTEGER REFERENCES usuarios (id),
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_lanclog_lanc ON lancamentos_log (lancamento_id, criado_em);

CREATE INDEX IF NOT EXISTS idx_lanc_tipo       ON lancamentos (tipo);
CREATE INDEX IF NOT EXISTS idx_lanc_status     ON lancamentos (status);
CREATE INDEX IF NOT EXISTS idx_lanc_vencimento ON lancamentos (vencimento);
CREATE INDEX IF NOT EXISTS idx_lanc_venda      ON lancamentos (venda_id);

-- ============================================================
--  VIEWS  (atalhos de consulta)
-- ============================================================

-- Saldo real de cada entrada: o que entrou menos o que saiu.
-- É a fonte da verdade do estoque; não existe coluna "saldo".
-- saldo = comprado - vendido - usado em OS + devolvido/garantia - baixas
CREATE VIEW IF NOT EXISTS vw_entradas_saldo AS
SELECT e.id                    AS entrada_id,
       e.quantidade            AS quantidade,
       COALESCE(v.vendido, 0)  AS vendido,
       COALESCE(o.usado, 0)    AS usado_os,
       COALESCE(m.entrou, 0)   AS mov_entrada,
       COALESCE(m.saiu, 0)     AS mov_saida,
       e.quantidade - COALESCE(v.vendido, 0) - COALESCE(o.usado, 0)
                    + COALESCE(m.entrou, 0) - COALESCE(m.saiu, 0) AS saldo
  FROM entradas e
  LEFT JOIN (SELECT vi.entrada_id, SUM(vi.quantidade) AS vendido
               FROM venda_itens vi
               JOIN vendas vd ON vd.id = vi.venda_id AND vd.status = 'concluida'
              GROUP BY vi.entrada_id) v ON v.entrada_id = e.id
  /*
   * A OS segura a peça enquanto o serviço está em andamento. Ao ser
   * ENTREGUE, ela gera uma venda: a peça volta para a prateleira aqui e
   * sai de novo pela venda, logo acima. Se as duas contassem, a mesma
   * peça sairia duas vezes e o saldo ficaria negativo.
   *
   * OS entregue ANTES desta regra (sem venda_id) continua contando como
   * saída — senão o estoque de ontem mudaria sozinho.
   */
  LEFT JOIN (SELECT oi.entrada_id, SUM(oi.quantidade) AS usado
               FROM os_itens oi
               JOIN ordens_servico os ON os.id = oi.os_id
                    AND os.status NOT IN ('cancelada', 'recusada')
                    AND NOT (os.status = 'entregue' AND os.venda_id IS NOT NULL)
              GROUP BY oi.entrada_id) o ON o.entrada_id = e.id
  LEFT JOIN (SELECT entrada_id,
                    SUM(CASE WHEN tipo = 'entrada' THEN quantidade ELSE 0 END) AS entrou,
                    SUM(CASE WHEN tipo = 'saida'   THEN quantidade ELSE 0 END) AS saiu
               FROM movimentacoes
              GROUP BY entrada_id) m ON m.entrada_id = e.id;

-- Entradas com o nome do item já resolvido e o saldo junto. É desta
-- view que a tela de Entradas e os selects da OS e da venda comem.
CREATE VIEW IF NOT EXISTS vw_entradas AS
SELECT e.id,
       e.tipo,
       CASE e.tipo
           WHEN 'celular' THEN TRIM(TRIM(COALESCE(m.marca, '') || ' ' || COALESCE(m.modelo, '')) ||
                                    ' ' || COALESCE(m.armazenamento, ''))
           WHEN 'peca'    THEN p.nome
           WHEN 'produto' THEN pr.nome
       END                                    AS item,
       COALESCE(m.marca, pr.marca)            AS marca,
       COALESCE(p.categoria, pr.categoria)    AS categoria,
       e.modelo_id, e.peca_id, e.produto_id,
       e.fornecedor_id,
       f.nome                                 AS fornecedor,
       e.descricao,
       e.quantidade,
       COALESCE(s.saldo, e.quantidade)        AS saldo,
       e.valor_investimento,
       e.valor_venda,
       e.situacao,
       e.imei, e.cor, e.condicao,
       e.nota_fiscal, e.observacoes,
       e.data_entrada, e.data_venda
  FROM entradas e
  LEFT JOIN modelos      m  ON m.id  = e.modelo_id
  LEFT JOIN pecas        p  ON p.id  = e.peca_id
  LEFT JOIN produtos     pr ON pr.id = e.produto_id
  LEFT JOIN fornecedores f  ON f.id  = e.fornecedor_id
  LEFT JOIN vw_entradas_saldo s ON s.entrada_id = e.id;

-- Totais por situação: alimenta os cards do dashboard.
-- Conta só o que ainda tem saldo (o vendido sai da conta sozinho).
CREATE VIEW IF NOT EXISTS vw_estoque_totais AS
SELECT e.situacao,
       COUNT(*)                            AS quantidade,
       SUM(e.valor_investimento * s.saldo) AS total_investido,
       SUM(e.valor_venda        * s.saldo) AS total_venda
  FROM entradas e
  JOIN vw_entradas_saldo s ON s.entrada_id = e.id
 WHERE e.situacao <> 'vendido' AND s.saldo > 0
 GROUP BY e.situacao;

-- Ordens de serviço em aberto, com nome do cliente e do aparelho
CREATE VIEW IF NOT EXISTS vw_os_abertas AS
SELECT os.id,
       os.numero,
       c.nome                                         AS cliente,
       c.telefone,
       COALESCE(a.marca || ' ' || a.modelo, a.modelo) AS aparelho,
       os.status,
       os.valor_orcamento,
       os.data_entrada,
       os.data_previsao
  FROM ordens_servico os
  JOIN clientes  c ON c.id = os.cliente_id
  LEFT JOIN aparelhos a ON a.id = os.aparelho_id
 WHERE os.status NOT IN ('entregue', 'cancelada', 'recusada')
 ORDER BY os.data_entrada;

-- Histórico de vendas com cliente, quantidade de itens e lucro
CREATE VIEW IF NOT EXISTS vw_vendas AS
SELECT v.id,
       v.numero,
       v.cliente_id,
       COALESCE(c.nome, 'Consumidor')       AS cliente,
       u.nome                               AS vendedor,
       v.valor_bruto, v.desconto, v.valor_total, v.custo_total,
       v.valor_total - v.custo_total        AS lucro,
       v.forma_pagamento, v.parcelas, v.status,
       v.data_venda, v.observacoes,
       (SELECT COUNT(*)           FROM venda_itens vi WHERE vi.venda_id = v.id) AS itens,
       (SELECT SUM(vi.quantidade) FROM venda_itens vi WHERE vi.venda_id = v.id) AS unidades,
       -- Os nomes dos itens em uma string só: é o que deixa a busca do
       -- histórico achar uma venda pelo modelo do aparelho, e não só
       -- pelo número ou pelo cliente.
       (SELECT GROUP_CONCAT(vi.descricao, ' | ')
          FROM venda_itens vi WHERE vi.venda_id = v.id) AS itens_texto
  FROM vendas v
  LEFT JOIN clientes c ON c.id = v.cliente_id
  LEFT JOIN usuarios u ON u.id = v.usuario_id;

-- ------------------------------------------------------------
-- USUÁRIO INICIAL
-- ------------------------------------------------------------
-- Ao recriar o banco do zero, este é o único login que já vem
-- pronto:   admin  /  admin
--
-- Troque a senha no sistema (Configurações > Trocar minha senha)
-- assim que entrar pela primeira vez.
INSERT OR IGNORE INTO usuarios (usuario, nome, senha_hash, perfil, ativo)
VALUES (
    'admin',
    'Administrador',
    'pbkdf2$sha256$120000$bc5e8e7a54e53215304e8599bec6a936$f6042ccc948c67738c0c3901cc2778218cccbadb4dd8fb16ae81d9cbd2edf4dc',
    'admin',
    1
);
