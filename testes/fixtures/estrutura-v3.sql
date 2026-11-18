-- ============================================================
--  INDEX CELULARES - Sistema de Assistência Técnica
--  Estrutura do banco de dados (SQLite) - versão 3
--
--  Este arquivo é a receita do banco: TODAS as tabelas, colunas,
--  índices, gatilhos e views que a API usa. Não rode na mão (DBeaver,
--  sqlite3): quem aplica é o
--
--      php dados\aplicar-estrutura.php
--
--  que cria o banco do zero OU leva um banco antigo até esta versão
--  (acrescenta as colunas que faltam, recria views e gatilhos, grava
--  PRAGMA user_version = 3) e cria o usuário admin com uma senha
--  inicial que precisa ser trocada no primeiro acesso.
--
--  Regra para quem mexer aqui: coluna nova entra no FIM da tabela e
--  também na lista COLUNAS_NOVAS do aplicar-estrutura.php - é assim que
--  o banco migrado e o banco novo ficam iguais.
--
--  ------------------------------------------------------------
--  COMO O BANCO ESTÁ ORGANIZADO
--
--  CADASTRO ("o que existe no mundo", não tem quantidade)
--      clientes, fornecedores, modelos, pecas, produtos, servicos,
--      formas_pagamento
--
--  MOVIMENTO ("o que entrou e o que saiu", tem quantidade)
--      entradas       -> tudo que chega na loja (celular/peça/produto)
--      movimentacoes  -> garantia, perda, devolução, ajuste
--      vendas         -> saída pela venda, com venda_itens
--      ordens_servico -> saída pelo conserto, com os_itens e
--                        os_pagamentos (pagamento dividido)
--
--  FINANCEIRO
--      lancamentos     -> a pagar e a receber, manual ou gerado
--      lancamentos_log -> quem mudou o quê em cada lançamento
--
--  ACESSO
--      usuarios, login_tentativas
--
--  O saldo NUNCA é uma coluna gravada: é calculado em
--  vw_entradas_saldo (entrou - vendido - usado em OS + movimentações).
--  Coluna de saldo desencontra da realidade na primeira exclusão;
--  conta não.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- USUÁRIOS  (quem entra no sistema)
-- ------------------------------------------------------------
-- A senha NUNCA é guardada em texto puro. A coluna senha_hash guarda
-- um PBKDF2-SHA256 no formato:
--
--     pbkdf2$sha256$<iterações>$<salt em hex>$<hash em hex>
--
-- trocar_senha = 1: a senha foi dada na instalação; a pessoa só usa o
-- sistema depois de escolher a dela. (Quem entra com senha fraca também
-- é obrigado a trocar - isso a API confere no login.)
CREATE TABLE IF NOT EXISTS usuarios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario     TEXT    NOT NULL UNIQUE,
    nome        TEXT    NOT NULL,
    senha_hash  TEXT    NOT NULL,
    perfil      TEXT    NOT NULL DEFAULT 'tecnico'
                CHECK (perfil IN ('admin', 'tecnico', 'balcao')),
    ativo       INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    ultimo_acesso TEXT,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    trocar_senha INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- TENTATIVAS DE LOGIN ERRADAS
-- ------------------------------------------------------------
-- 5 erros por login, ou por IP, dentro de 15 minutos travam o login
-- por 15 minutos. Login certo apaga as tentativas daquele login e IP.
-- momento = segundos desde 1970 (time() do PHP), para a conta ser
-- simples e não depender de fuso.
CREATE TABLE IF NOT EXISTS login_tentativas (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario  TEXT    NOT NULL,
    ip       TEXT    NOT NULL DEFAULT '',
    momento  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_tent_usuario ON login_tentativas (usuario, momento);
CREATE INDEX IF NOT EXISTS idx_login_tent_ip      ON login_tentativas (ip, momento);

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
-- Venda, OS, pagamento da OS e lançamento apontam para cá por
-- forma_pagamento_id. A coluna de texto continua existindo nelas,
-- guardando o nome (a API atualiza quando a forma é renomeada).
--
-- parcelas_padrao é o que a tela sugere ao escolher a forma (1 a 24).
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
-- modelo ainda não existe, a própria tela da OS cadastra na hora.
-- A API recusa nome repetido sem diferenciar maiúscula.
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
-- SERVIÇOS  (o que a oficina faz, com preço de tabela)
-- ------------------------------------------------------------
-- O preço daqui é SUGESTÃO. O que fica gravado na OS é o cobrado de
-- verdade (os_itens.valor_unitario) - senão mudar a tabela amanhã
-- reescreveria o histórico do que já foi cobrado.
CREATE TABLE IF NOT EXISTS servicos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nome          TEXT    NOT NULL,
    descricao     TEXT,
    valor_padrao  REAL    NOT NULL DEFAULT 0,
    tempo_medio   INTEGER,
    ativo         INTEGER NOT NULL DEFAULT 1,
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_servicos_nome ON servicos (nome);

-- ------------------------------------------------------------
-- APARELHOS  (o celular físico que o cliente deixou na loja)
-- ------------------------------------------------------------
-- Nasce dentro da Ordem de Serviço. O modelo vem do catálogo
-- (modelo_id) e a API copia marca/modelo para cá na abertura: se o
-- modelo for renomeado daqui a um ano, a OS antiga continua dizendo o
-- que o cliente entregou naquele dia. Modelo em uso não se exclui (a
-- API confere antes), por isso modelo_id não tem ON DELETE.
CREATE TABLE IF NOT EXISTS aparelhos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id     INTEGER REFERENCES clientes (id) ON DELETE SET NULL,
    marca          TEXT,
    modelo         TEXT NOT NULL,
    cor            TEXT,
    imei           TEXT,
    senha_aparelho TEXT,                   -- padrão/PIN informado pelo cliente
    acessorios     TEXT,                   -- capa, chip, cartão de memória...
    criado_em      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    modelo_id      INTEGER REFERENCES modelos (id)
);

CREATE INDEX IF NOT EXISTS idx_aparelhos_cliente ON aparelhos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_aparelhos_imei    ON aparelhos (imei);
CREATE INDEX IF NOT EXISTS idx_aparelhos_modelo  ON aparelhos (modelo_id);

-- ============================================================
--  MOVIMENTO
-- ============================================================

-- ------------------------------------------------------------
-- ENTRADAS  (tudo que chega na loja)
-- ------------------------------------------------------------
-- Uma linha por compra. O tipo decide qual coluna de catálogo vale:
--
--   celular -> modelo_id  + imei, cor, condicao   (quantidade sempre 1)
--   peca    -> peca_id    + quantidade
--   produto -> produto_id + quantidade
--
-- IMEI: 15 dígitos e único entre os celulares - quem confere é a API.
-- O índice não é UNIQUE porque bancos antigos têm IMEI repetido de
-- antes da regra (o reparar-dados.php lista esses casos).
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

    imei               TEXT,
    cor                TEXT,
    condicao           TEXT    CHECK (condicao IS NULL OR
                                      condicao IN ('novo', 'seminovo', 'usado', 'defeito')),

    nota_fiscal        TEXT,
    observacoes        TEXT,
    data_entrada       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    data_venda         TEXT,

    CHECK (tipo <> 'celular' OR quantidade = 1)
);

CREATE INDEX IF NOT EXISTS idx_entradas_tipo       ON entradas (tipo);
CREATE INDEX IF NOT EXISTS idx_entradas_situacao   ON entradas (situacao);
CREATE INDEX IF NOT EXISTS idx_entradas_fornecedor ON entradas (fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_entradas_imei       ON entradas (imei);

-- ------------------------------------------------------------
-- VENDAS  (balcão: sai do estoque, entra no financeiro)
-- ------------------------------------------------------------
-- Venda cancelada é estado final (a API recusa reativar). Venda gerada
-- por OS só muda pela OS.
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
    atualizado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    forma_pagamento_id INTEGER REFERENCES formas_pagamento (id)
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
-- ORDENS DE SERVIÇO  (o coração do sistema)
-- ------------------------------------------------------------
-- valor_pecas é a soma de os_itens, recalculada pela API.
-- venda_id: a venda gerada quando a OS foi entregue. É ela que faz a
-- peça voltar à prateleira e sair de novo pela venda, e é o que impede
-- o relatório de contar a mesma receita duas vezes.
-- atualizado_em é a VERSÃO da OS: a tela devolve o valor que leu, e a
-- API recusa (409) se outra pessoa gravou no meio.
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
);

CREATE INDEX IF NOT EXISTS idx_os_status  ON ordens_servico (status);
CREATE INDEX IF NOT EXISTS idx_os_venda   ON ordens_servico (venda_id);
CREATE INDEX IF NOT EXISTS idx_os_cliente ON ordens_servico (cliente_id);
CREATE INDEX IF NOT EXISTS idx_os_entrada ON ordens_servico (data_entrada);

-- Carimba atualizado_em em qualquer UPDATE que não o tenha mudado (com
-- milissegundos: duas gravações no mesmo segundo são versões diferentes).
DROP TRIGGER IF EXISTS trg_os_atualizado;
CREATE TRIGGER trg_os_atualizado
AFTER UPDATE ON ordens_servico
FOR EACH ROW
WHEN NEW.atualizado_em IS OLD.atualizado_em
BEGIN
    UPDATE ordens_servico
       SET atualizado_em = strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
     WHERE id = OLD.id;
END;

-- ------------------------------------------------------------
-- ITENS DA OS  (peças e serviços do conserto)
-- ------------------------------------------------------------
-- Uma linha é uma peça do estoque (entrada_id: dá baixa no saldo) OU
-- um serviço do catálogo (servico_id: não tem estoque, é mão de obra).
-- descricao e valor_unitario ficam congelados na linha.
CREATE TABLE IF NOT EXISTS os_itens (
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
);

CREATE INDEX IF NOT EXISTS idx_os_itens_os      ON os_itens (os_id);
CREATE INDEX IF NOT EXISTS idx_os_itens_entrada ON os_itens (entrada_id);
CREATE INDEX IF NOT EXISTS idx_os_itens_servico ON os_itens (servico_id);

-- ------------------------------------------------------------
-- PAGAMENTO DIVIDIDO DA OS
-- ------------------------------------------------------------
-- "Metade em dinheiro, metade no débito". Uma linha por forma; a soma
-- é igual a ordens_servico.valor_final (a API confere e põe o centavo
-- de arredondamento na última linha). As colunas de forma da OS
-- guardam a PRIMEIRA forma, para as telas antigas continuarem lendo.
CREATE TABLE IF NOT EXISTS os_pagamentos (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    os_id              INTEGER NOT NULL REFERENCES ordens_servico (id) ON DELETE CASCADE,
    forma_pagamento_id INTEGER REFERENCES formas_pagamento (id),
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
-- MOVIMENTAÇÕES  (o que entra e sai fora de compra, venda e OS)
-- ------------------------------------------------------------
--   garantia   o fornecedor mandou a peça nova sem cobrar   (entrada)
--   retorno    a peça voltou para a prateleira              (entrada)
--   devolucao  a peça foi devolvida ao fornecedor           (saída)
--   defeito    a peça veio com defeito e saiu do estoque    (saída)
--   perda      quebrou, sumiu, estragou                     (saída)
--   ajuste     acerto de inventário, para os dois lados
--
-- Entrada com movimentação não se exclui (a API recusa): o CASCADE
-- abaixo só age se alguém apagar direto no banco.
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
--          'os'      -> criado pela OS antiga (antes da venda gerada)
--          'entrada' -> criado sozinho ao comprar (a pagar)
--
-- Regras (na API):
--   - só o MANUAL e PENDENTE pode ser excluído;
--   - quitado vira 'cancelado' (estorno), nunca é apagado;
--   - o de venda/OS/compra não tem valor editável e sai junto com o
--     documento (cancelado, com o motivo no log).
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
    criado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    forma_pagamento_id INTEGER REFERENCES formas_pagamento (id)
);

CREATE INDEX IF NOT EXISTS idx_lanc_tipo       ON lancamentos (tipo);
CREATE INDEX IF NOT EXISTS idx_lanc_status     ON lancamentos (status);
CREATE INDEX IF NOT EXISTS idx_lanc_vencimento ON lancamentos (vencimento);
CREATE INDEX IF NOT EXISTS idx_lanc_venda      ON lancamentos (venda_id);
CREATE INDEX IF NOT EXISTS idx_lanc_os         ON lancamentos (os_id);
CREATE INDEX IF NOT EXISTS idx_lanc_entrada    ON lancamentos (entrada_id);

-- ------------------------------------------------------------
-- LOG DE ALTERAÇÃO DOS LANÇAMENTOS
-- ------------------------------------------------------------
-- Quem mudou o valor de uma conta, e de quanto para quanto, é pergunta
-- que aparece semanas depois. Cada alteração de campo sensível vira
-- uma linha aqui - inclusive os cancelamentos automáticos (venda
-- cancelada, OS reaberta), com o motivo.
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

-- ============================================================
--  VIEWS  (atalhos de consulta)
-- ============================================================
-- DROP + CREATE, nunca "CREATE VIEW IF NOT EXISTS": com IF NOT EXISTS
-- a view antiga ficava para sempre, e a correção feita aqui nunca
-- chegava ao banco que já existia.
DROP VIEW IF EXISTS vw_estoque_totais;      -- não era usada por ninguém
DROP VIEW IF EXISTS vw_os_abertas;          -- idem (a API conta as OS em andamento)
DROP VIEW IF EXISTS vw_vendas;
DROP VIEW IF EXISTS vw_entradas;
DROP VIEW IF EXISTS vw_entradas_saldo;

-- Saldo real de cada entrada: o que entrou menos o que saiu.
-- É a fonte da verdade do estoque; não existe coluna "saldo".
-- saldo = comprado - vendido - usado em OS + movimentações de entrada
--         - movimentações de saída
CREATE VIEW vw_entradas_saldo AS
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
CREATE VIEW vw_entradas AS
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

-- Histórico de vendas com cliente, quantidade de itens e lucro.
-- forma_pagamento_id vem junto: sem ele o "Editar venda" abria com
-- "não informado" e, ao salvar, apagava a forma gravada.
CREATE VIEW vw_vendas AS
SELECT v.id,
       v.numero,
       v.cliente_id,
       COALESCE(c.nome, 'Consumidor')       AS cliente,
       u.nome                               AS vendedor,
       v.valor_bruto, v.desconto, v.valor_total, v.custo_total,
       ROUND(v.valor_total - v.custo_total, 2) AS lucro,
       v.forma_pagamento_id,
       COALESCE(fp.nome, v.forma_pagamento) AS forma_pagamento,
       v.parcelas, v.status,
       v.data_venda, v.observacoes, v.atualizado_em,
       (SELECT COUNT(*)           FROM venda_itens vi WHERE vi.venda_id = v.id) AS itens,
       (SELECT SUM(vi.quantidade) FROM venda_itens vi WHERE vi.venda_id = v.id) AS unidades,
       -- Os nomes dos itens em uma string só: é o que deixa a busca do
       -- histórico achar uma venda pelo modelo do aparelho, e não só
       -- pelo número ou pelo cliente.
       (SELECT GROUP_CONCAT(vi.descricao, ' | ')
          FROM venda_itens vi WHERE vi.venda_id = v.id) AS itens_texto
  FROM vendas v
  LEFT JOIN clientes c ON c.id = v.cliente_id
  LEFT JOIN usuarios u ON u.id = v.usuario_id
  LEFT JOIN formas_pagamento fp ON fp.id = v.forma_pagamento_id;

-- @@SEMENTES@@
-- ============================================================
--  SEMENTES  (só quando a tabela é criada - ver aplicar-estrutura.php)
-- ============================================================
-- Rodam UMA vez, no dia em que a tabela nasce. Se rodassem a cada
-- aplicação, uma forma de pagamento apagada pela loja voltaria sozinha.
-- O usuário admin NÃO está aqui: o aplicar-estrutura.php o cria com
-- uma senha inicial aleatória, que precisa ser trocada no 1º acesso.

-- @@SEMENTE formas_pagamento
-- minusculas() é a função do PHP registrada pelo aplicar-estrutura.php:
-- num banco antigo, "pix" já gravado não ganha um "Pix" ao lado.
INSERT OR IGNORE INTO formas_pagamento (nome, tipo, parcelas_padrao, ordem)
SELECT nome, tipo, parcelas, ordem FROM (
          SELECT 'Dinheiro' AS nome, 'vista' AS tipo, 1 AS parcelas, 10 AS ordem
    UNION ALL SELECT 'Pix',               'vista',  1, 20
    UNION ALL SELECT 'Cartão de débito',  'vista',  1, 30
    UNION ALL SELECT 'Cartão de crédito', 'cartao', 3, 40
    UNION ALL SELECT 'Transferência',     'vista',  1, 50
    UNION ALL SELECT 'Boleto',            'prazo',  1, 60
    UNION ALL SELECT 'Fiado',             'prazo',  1, 70
) novas
WHERE NOT EXISTS (SELECT 1 FROM formas_pagamento f WHERE minusculas(f.nome) = minusculas(novas.nome));

-- @@SEMENTE servicos
-- Valor zero de propósito: preço é decisão da loja, e um número
-- inventado aqui viraria orçamento errado.
INSERT INTO servicos (nome, valor_padrao)
SELECT nome, 0 FROM (
          SELECT 'Troca de tela' AS nome
    UNION ALL SELECT 'Troca de bateria'
    UNION ALL SELECT 'Troca de conector de carga'
    UNION ALL SELECT 'Limpeza / oxidação'
    UNION ALL SELECT 'Troca de tampa traseira'
    UNION ALL SELECT 'Troca de câmera'
    UNION ALL SELECT 'Desbloqueio / software'
    UNION ALL SELECT 'Mão de obra avulsa'
) novos
WHERE NOT EXISTS (SELECT 1 FROM servicos s WHERE s.nome = novos.nome);
