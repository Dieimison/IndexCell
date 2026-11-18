-- ============================================================
--  INDEX CELULARES - Sistema de Assistência Técnica
--  Estrutura do banco de dados (SQLite) - versão 8
--  (a versão mora em VERSAO_BANCO, api/nucleo.php)
--
--  Este arquivo é a receita do banco NOVO: TODAS as tabelas, colunas,
--  índices, gatilhos e views que a API usa. Não rode na mão (DBeaver,
--  sqlite3): quem aplica é o
--
--      php dados\aplicar-estrutura.php
--
--  Banco novo: este arquivo inteiro + as sementes + o usuário admin.
--  Banco antigo: os passos de dados\migracoes\NNN-*.php, um por versão
--  (NNN = a versão a que o passo leva). No fim, o banco migrado é
--  comparado com um banco novo feito deste arquivo (o "sql" normalizado
--  de cada tabela, índice, view e gatilho): qualquer diferença é falha,
--  nada é gravado e o script sai com código 1.
--
--  Regra para quem mexer aqui: mudou uma TABELA (coluna, DEFAULT, CHECK,
--  FK, UNIQUE)? Suba VERSAO_BANCO e escreva o passo NNN que leva o banco
--  antigo até a mesma forma (ADD COLUMN, ou reconstruirTabela() para o
--  que o SQLite não muda por ALTER). Índices, views e gatilhos não
--  precisam de passo: são refeitos a partir daqui.
--
--  DEFAULT que tem constante no PHP usa o MESMO número (garantia_dias
--  DEFAULT 90 = GARANTIA_PADRAO); testes\nucleo.test.php confere.
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
--  LISTAS E REGRAS
--      opcoes_lista   -> marcas, cores, armazenamentos... (o vocabulário)
--      empresas, chaves_geral, chaves_empresa, chaves_historico
--
--  LOJA ONLINE (v8)
--      loja_ajustes, loja_contas, loja_enderecos, anuncios,
--      anuncio_fotos, encomendas, encomenda_itens, encomenda_eventos
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
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    ie           TEXT,   -- v7
    uf           TEXT CHECK (uf IS NULL OR uf IN ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'))
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
    criado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    padrao          INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_formas_ativo ON formas_pagamento (ativo, ordem);
-- A forma pré-escolhida na venda: no máximo UMA (padrao = 1).
CREATE UNIQUE INDEX IF NOT EXISTS idx_formas_padrao ON formas_pagamento (padrao) WHERE padrao = 1;

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
    ncm          TEXT CHECK (ncm IS NULL OR (length(ncm) = 8 AND ncm NOT GLOB '*[^0-9]*')),   -- v7
    cest         TEXT CHECK (cest IS NULL OR (length(cest) = 7 AND cest NOT GLOB '*[^0-9]*')),
    origem       TEXT CHECK (origem IS NULL OR origem IN ('0', '1', '2', '3', '4', '5', '6', '7', '8')),
    unidade      TEXT NOT NULL DEFAULT 'UN',
    gtin         TEXT,
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
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    ncm          TEXT CHECK (ncm IS NULL OR (length(ncm) = 8 AND ncm NOT GLOB '*[^0-9]*')),   -- v7
    cest         TEXT CHECK (cest IS NULL OR (length(cest) = 7 AND cest NOT GLOB '*[^0-9]*')),
    origem       TEXT CHECK (origem IS NULL OR origem IN ('0', '1', '2', '3', '4', '5', '6', '7', '8')),
    unidade      TEXT NOT NULL DEFAULT 'UN',
    gtin         TEXT
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
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    ncm          TEXT CHECK (ncm IS NULL OR (length(ncm) = 8 AND ncm NOT GLOB '*[^0-9]*')),   -- v7
    cest         TEXT CHECK (cest IS NULL OR (length(cest) = 7 AND cest NOT GLOB '*[^0-9]*')),
    origem       TEXT CHECK (origem IS NULL OR origem IN ('0', '1', '2', '3', '4', '5', '6', '7', '8')),
    unidade      TEXT NOT NULL DEFAULT 'UN',
    gtin         TEXT
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
--   brinde     brinde ou cortesia ao cliente                (saída)
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
                                    'defeito', 'perda', 'brinde', 'ajuste')),
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
    forma_pagamento_id INTEGER REFERENCES formas_pagamento (id),
    pedido_id    INTEGER REFERENCES pedidos (id) ON DELETE SET NULL   -- v7
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
--  LISTAS, EMPRESA E REGRAS  (v6)
-- ============================================================

-- ------------------------------------------------------------
-- LISTAS DE OPÇÕES  (marca, armazenamento, cor, categoria...)
-- ------------------------------------------------------------
-- Os campos de texto que se repetem viram lista para escolher: a mesma
-- marca não nasce escrita de três jeitos ("Apple", "apple", "APPLE").
-- O registro (modelos.marca, entradas.cor...) continua guardando o
-- TEXTO: a lista é o vocabulário, não uma chave estrangeira. Desativar
-- um valor tira da lista e não mexe no que já foi gravado.
-- A API grava o valor com a grafia que já está aqui e acrescenta o que
-- for novo (cadastrar novo dentro do formulário).
CREATE TABLE IF NOT EXISTS opcoes_lista (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    lista     TEXT    NOT NULL
              CHECK (lista IN ('marcas', 'armazenamentos', 'cores',
                               'categorias_produto', 'categorias_lancamento')),
    valor     TEXT    NOT NULL CHECK (length(trim(valor)) > 0),
    ativo     INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- NOCASE só iguala A-Z; acento a API confere com minusculas().
CREATE UNIQUE INDEX IF NOT EXISTS idx_opcoes_lista_valor ON opcoes_lista (lista, valor COLLATE NOCASE);

-- ------------------------------------------------------------
-- EMPRESA
-- ------------------------------------------------------------
-- Hoje a loja é UMA empresa (a de menor id, ativa). A tabela existe
-- para as regras por empresa (chaves_empresa) e para o fiscal que vem
-- depois. Movimento (venda, entrada, OS) ainda não tem empresa_id.
CREATE TABLE IF NOT EXISTS empresas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nome         TEXT    NOT NULL,             -- nome fantasia, o da tela
    razao_social TEXT,
    cnpj         TEXT    UNIQUE                -- 14 caracteres sem pontuação: 12 letras/números + 2 dígitos (CNPJ alfanumérico)
                 CHECK (cnpj IS NULL OR (length(cnpj) = 14 AND cnpj NOT GLOB '*[^0-9A-Z]*'
                                         AND substr(cnpj, 13, 2) NOT GLOB '*[^0-9]*')),
    ativo        INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ------------------------------------------------------------
-- REGRAS POR CHAVE  (geral x empresa)
-- ------------------------------------------------------------
-- O que cada chave quer dizer, o tipo e o valor de fábrica moram no
-- código (CHAVES, api/rotas/admin.php): chave que o código não conhece
-- a API recusa. Aqui ficam só os valores escolhidos pela loja.
--
-- Qual valor vale, nesta ordem:
--   1. chaves_empresa  (o da empresa, se tiver)
--   2. chaves_geral    (o de todas as empresas)
--   3. o valor de fábrica do código
-- Quem confere é o SERVIDOR, a cada pedido: a tela só lê para saber o
-- que mostrar.
CREATE TABLE IF NOT EXISTS chaves_geral (
    chave         TEXT    PRIMARY KEY,
    valor         TEXT    NOT NULL,
    atualizado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id    INTEGER REFERENCES usuarios (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chaves_empresa (
    empresa_id    INTEGER NOT NULL REFERENCES empresas (id) ON DELETE CASCADE,
    chave         TEXT    NOT NULL,
    valor         TEXT    NOT NULL,
    atualizado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id    INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
    PRIMARY KEY (empresa_id, chave)
);

-- Toda mudança de regra: quem, quando, de quanto para quanto.
-- antes/depois NULL = não havia valor naquele nível (herdava).
CREATE TABLE IF NOT EXISTS chaves_historico (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    escopo     TEXT    NOT NULL CHECK (escopo IN ('geral', 'empresa')),
    empresa_id INTEGER REFERENCES empresas (id) ON DELETE SET NULL,
    chave      TEXT    NOT NULL,
    antes      TEXT,
    depois     TEXT,
    usuario_id INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
    momento    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_chaves_hist_chave ON chaves_historico (chave, momento);

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

-- ============================================================
--  VIEWS  (atalhos de consulta)
-- ============================================================
-- O aplicar-estrutura.php apaga e recria todas as views a cada
-- migração, nesta ordem (uma view pode ler a de cima).

-- As SAÍDAS de estoque por venda e por OS. A regra de quando uma OS
-- segura a peça mora AQUI e só aqui (o saldo e a ficha do item leem
-- esta view):
--   - OS cancelada ou recusada não segura nada (a peça volta);
--   - OS entregue que gerou venda também não: a peça sai pela venda;
--   - OS entregue sem venda (antiga, ou de valor final 0) segura.
CREATE VIEW vw_saidas_estoque AS
SELECT vi.entrada_id, 'venda' AS origem, vi.quantidade, v.data_venda AS data,
       v.id AS venda_id, NULL AS os_id, vi.valor_unitario
  FROM venda_itens vi
  JOIN vendas v ON v.id = vi.venda_id AND v.status = 'concluida'
 WHERE vi.entrada_id IS NOT NULL
UNION ALL
SELECT oi.entrada_id, 'os', oi.quantidade, oi.criado_em, NULL, o.id, oi.valor_unitario
  FROM os_itens oi
  JOIN ordens_servico o ON o.id = oi.os_id
 WHERE oi.entrada_id IS NOT NULL
   AND o.status NOT IN ('cancelada', 'recusada')
   AND NOT (o.status = 'entregue' AND o.venda_id IS NOT NULL);

-- Saldo real de cada entrada: comprado - vendido - usado em OS
-- + movimentações de entrada - movimentações de saída.
CREATE VIEW vw_entradas_saldo AS
SELECT e.id                    AS entrada_id,
       e.quantidade            AS quantidade,
       COALESCE(s.vendido, 0)  AS vendido,
       COALESCE(s.usado, 0)    AS usado_os,
       COALESCE(m.entrou, 0)   AS mov_entrada,
       COALESCE(m.saiu, 0)     AS mov_saida,
       e.quantidade - COALESCE(s.vendido, 0) - COALESCE(s.usado, 0)
                    + COALESCE(m.entrou, 0) - COALESCE(m.saiu, 0) AS saldo
  FROM entradas e
  LEFT JOIN (SELECT entrada_id,
                    SUM(CASE WHEN origem = 'venda' THEN quantidade ELSE 0 END) AS vendido,
                    SUM(CASE WHEN origem = 'os'    THEN quantidade ELSE 0 END) AS usado
               FROM vw_saidas_estoque
              GROUP BY entrada_id) s ON s.entrada_id = e.id
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

-- Histórico de vendas com cliente, itens, lucro e forma.
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
       -- Os nomes dos itens numa string só: a busca do histórico acha a
       -- venda pelo modelo do aparelho.
       (SELECT GROUP_CONCAT(vi.descricao, ' | ')
          FROM venda_itens vi WHERE vi.venda_id = v.id) AS itens_texto
  FROM vendas v
  LEFT JOIN clientes c ON c.id = v.cliente_id
  LEFT JOIN usuarios u ON u.id = v.usuario_id
  LEFT JOIN formas_pagamento fp ON fp.id = v.forma_pagamento_id;

-- O que é FATURAMENTO e de onde veio - a regra anti-dupla-contagem num
-- lugar só. Um documento por linha:
--   - venda concluída; origem 'os' se uma OS aponta para ela (é a
--     venda gerada pela entrega), senão 'venda' (balcão);
--   - OS entregue SEM venda (as antigas, de antes da venda gerada, e as
--     de valor final 0): é faturamento da oficina direto da OS.
-- A OS entregue com venda NÃO entra pela OS: ela já entrou pela venda.
CREATE VIEW vw_faturamentos AS
SELECT v.id AS venda_id, o.id AS os_id,
       CASE WHEN o.id IS NULL THEN 'venda' ELSE 'os' END AS origem,
       substr(v.data_venda, 1, 10) AS dia
  FROM vendas v
  LEFT JOIN ordens_servico o ON o.venda_id = v.id
 WHERE v.status = 'concluida'
UNION ALL
SELECT NULL, o.id, 'os', substr(o.data_entrega, 1, 10)
  FROM ordens_servico o
 WHERE o.status = 'entregue' AND o.venda_id IS NULL AND o.data_entrega IS NOT NULL;

-- Receita e custo de cada faturamento, por forma de pagamento. O
-- pagamento dividido da OS (os_pagamentos) vira uma linha por forma; o
-- custo e a contagem ficam na primeira linha, para a soma por dia dar
-- certo. /financeiro e /relatorios leem SÓ daqui.
CREATE VIEW vw_receitas AS
SELECT f.dia, f.origem,
       COALESCE(v.valor_total, o.valor_final) AS receita,
       CASE WHEN f.venda_id IS NOT NULL THEN v.custo_total
            ELSE COALESCE((SELECT SUM(oi.custo_unitario * oi.quantidade) FROM os_itens oi WHERE oi.os_id = f.os_id), 0)
       END AS custo,
       1 AS quantidade,
       COALESCE(v.forma_pagamento_id, o.forma_pagamento_id) AS forma_pagamento_id,
       COALESCE(fp.nome, v.forma_pagamento, o.forma_pagamento, 'Não informado') AS forma,
       f.venda_id, f.os_id
  FROM vw_faturamentos f
  LEFT JOIN vendas v ON v.id = f.venda_id
  LEFT JOIN ordens_servico o ON o.id = f.os_id
  LEFT JOIN formas_pagamento fp ON fp.id = COALESCE(v.forma_pagamento_id, o.forma_pagamento_id)
 WHERE NOT EXISTS (SELECT 1 FROM os_pagamentos p WHERE p.os_id = f.os_id)
UNION ALL
SELECT f.dia, f.origem, p.valor,
       CASE WHEN p.id = (SELECT MIN(p2.id) FROM os_pagamentos p2 WHERE p2.os_id = f.os_id)
            THEN CASE WHEN f.venda_id IS NOT NULL THEN v.custo_total
                      ELSE COALESCE((SELECT SUM(oi.custo_unitario * oi.quantidade) FROM os_itens oi WHERE oi.os_id = f.os_id), 0)
                 END
            ELSE 0 END,
       CASE WHEN p.id = (SELECT MIN(p2.id) FROM os_pagamentos p2 WHERE p2.os_id = f.os_id) THEN 1 ELSE 0 END,
       p.forma_pagamento_id,
       COALESCE(fp.nome, p.forma_pagamento, 'Não informado'),
       f.venda_id, f.os_id
  FROM vw_faturamentos f
  JOIN os_pagamentos p ON p.os_id = f.os_id
  LEFT JOIN vendas v ON v.id = f.venda_id
  LEFT JOIN formas_pagamento fp ON fp.id = p.forma_pagamento_id;

-- Os itens faturados (o ranking "o que mais vendeu"), pela mesma regra.
-- A receita do item é a que ENTROU: o desconto do documento é repartido
-- entre os itens na proporção do subtotal (venda de 100 com 10 de
-- desconto: o item de 60 conta 54). Na OS sem venda, o "bruto" é a soma
-- dos itens mais a mão de obra digitada (só quando não há serviço
-- lançado, que já a contém); valor final acima do bruto não sobe o item.
CREATE VIEW vw_itens_faturados AS
SELECT f.dia, vi.descricao, COALESCE(e.tipo, 'produto') AS tipo, f.origem,
       vi.quantidade AS unidades,
       CASE WHEN v.valor_bruto > 0 AND v.valor_total < v.valor_bruto
            THEN ROUND(vi.subtotal * v.valor_total / v.valor_bruto, 2)
            ELSE vi.subtotal END AS receita,
       vi.custo_unitario * vi.quantidade AS custo
  FROM vw_faturamentos f
  JOIN vendas v ON v.id = f.venda_id
  JOIN venda_itens vi ON vi.venda_id = f.venda_id
  LEFT JOIN entradas e ON e.id = vi.entrada_id
UNION ALL
SELECT f.dia, oi.descricao, COALESCE(e.tipo, 'peca'), f.origem,
       oi.quantidade,
       CASE WHEN b.bruto > 0 AND o.valor_final < b.bruto
            THEN ROUND(oi.subtotal * o.valor_final / b.bruto, 2)
            ELSE oi.subtotal END,
       oi.custo_unitario * oi.quantidade
  FROM vw_faturamentos f
  JOIN ordens_servico o ON o.id = f.os_id
  JOIN os_itens oi ON oi.os_id = f.os_id AND f.venda_id IS NULL
  JOIN (SELECT oi2.os_id,
               SUM(oi2.subtotal) + CASE WHEN MAX(oi2.servico_id) IS NULL
                                        THEN COALESCE(MAX(o2.valor_mao_obra), 0) ELSE 0 END AS bruto
          FROM os_itens oi2
          JOIN ordens_servico o2 ON o2.id = oi2.os_id
         GROUP BY oi2.os_id) b ON b.os_id = f.os_id
  LEFT JOIN entradas e ON e.id = oi.entrada_id;

-- @@SEMENTES@@
-- ============================================================
--  SEMENTES  (só no banco NOVO)
-- ============================================================
-- Cada bloco "@@SEMENTE <tabela>" roda uma vez, quando o banco nasce.
-- Nome de tabela que não existe faz a instalação FALHAR (antes era
-- ignorado em silêncio). Banco antigo recebe os dados de que precisa
-- pelos passos de dados\migracoes\. O usuário admin NÃO está aqui: o
-- aplicar-estrutura.php o cria com senha inicial aleatória.

-- @@SEMENTE formas_pagamento
-- Dinheiro é a forma padrão (pré-escolhida na venda).
INSERT OR IGNORE INTO formas_pagamento (nome, tipo, parcelas_padrao, ordem, padrao)
SELECT nome, tipo, parcelas, ordem, padrao FROM (
          SELECT 'Dinheiro' AS nome, 'vista' AS tipo, 1 AS parcelas, 10 AS ordem, 1 AS padrao
    UNION ALL SELECT 'Pix',               'vista',  1, 20, 0
    UNION ALL SELECT 'Cartão de débito',  'vista',  1, 30, 0
    UNION ALL SELECT 'Cartão de crédito', 'cartao', 3, 40, 0
    UNION ALL SELECT 'Transferência',     'vista',  1, 50, 0
    UNION ALL SELECT 'Boleto',            'prazo',  1, 60, 0
    UNION ALL SELECT 'Fiado',             'prazo',  1, 70, 0
) novas
WHERE NOT EXISTS (SELECT 1 FROM formas_pagamento f WHERE minusculas(f.nome) = minusculas(novas.nome));

-- @@SEMENTE servicos
-- Valor zero de propósito: preço é decisão da loja.
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

-- @@SEMENTE empresas
-- A loja. Razão social e CNPJ o admin completa em Admin > Empresa.
INSERT INTO empresas (nome)
SELECT 'Index Celulares' WHERE NOT EXISTS (SELECT 1 FROM empresas);

-- @@SEMENTE opcoes_lista
-- O vocabulário de partida (o mesmo do passo 006). A loja acrescenta o
-- resto ao cadastrar.
INSERT OR IGNORE INTO opcoes_lista (lista, valor)
SELECT lista, valor FROM (
          SELECT 'marcas' AS lista, 'Apple' AS valor
    UNION ALL SELECT 'marcas', 'Samsung'
    UNION ALL SELECT 'marcas', 'Motorola'
    UNION ALL SELECT 'marcas', 'Xiaomi'
    UNION ALL SELECT 'marcas', 'Realme'
    UNION ALL SELECT 'marcas', 'LG'
    UNION ALL SELECT 'armazenamentos', '32GB'
    UNION ALL SELECT 'armazenamentos', '64GB'
    UNION ALL SELECT 'armazenamentos', '128GB'
    UNION ALL SELECT 'armazenamentos', '256GB'
    UNION ALL SELECT 'armazenamentos', '512GB'
    UNION ALL SELECT 'armazenamentos', '1TB'
    UNION ALL SELECT 'cores', 'Preto'
    UNION ALL SELECT 'cores', 'Branco'
    UNION ALL SELECT 'cores', 'Azul'
    UNION ALL SELECT 'cores', 'Verde'
    UNION ALL SELECT 'cores', 'Vermelho'
    UNION ALL SELECT 'cores', 'Rosa'
    UNION ALL SELECT 'cores', 'Roxo'
    UNION ALL SELECT 'cores', 'Dourado'
    UNION ALL SELECT 'cores', 'Prata'
    UNION ALL SELECT 'cores', 'Grafite'
    UNION ALL SELECT 'categorias_produto', 'Capa'
    UNION ALL SELECT 'categorias_produto', 'Película'
    UNION ALL SELECT 'categorias_produto', 'Carregador'
    UNION ALL SELECT 'categorias_produto', 'Cabo'
    UNION ALL SELECT 'categorias_produto', 'Fone de ouvido'
    UNION ALL SELECT 'categorias_produto', 'Caixa de som'
    UNION ALL SELECT 'categorias_produto', 'Suporte'
    UNION ALL SELECT 'categorias_lancamento', 'Aluguel'
    UNION ALL SELECT 'categorias_lancamento', 'Energia'
    UNION ALL SELECT 'categorias_lancamento', 'Internet'
    UNION ALL SELECT 'categorias_lancamento', 'Fornecedor'
    UNION ALL SELECT 'categorias_lancamento', 'Imposto'
    UNION ALL SELECT 'categorias_lancamento', 'Salário'
    UNION ALL SELECT 'categorias_lancamento', 'Outros'
) iniciais;

-- @@SEMENTE cfops
-- Os CFOPs mais usados por uma loja de celulares (descrição da tabela do
-- Convênio s/nº de 1970). O admin cadastra os que faltarem.
INSERT OR IGNORE INTO cfops (codigo, descricao, oficial) VALUES
    ('1102', 'Compra para comercialização', 1),
    ('1152', 'Transferência para comercialização', 1),
    ('1202', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros', 1),
    ('1403', 'Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 1),
    ('1411', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 1),
    ('1556', 'Compra de material para uso ou consumo', 1),
    ('1910', 'Entrada de bonificação, doação ou brinde', 1),
    ('1915', 'Entrada de mercadoria ou bem recebido para conserto ou reparo', 1),
    ('1916', 'Retorno de mercadoria ou bem remetido para conserto ou reparo', 1),
    ('1949', 'Outra entrada de mercadoria ou prestação de serviço não especificada', 1),
    ('2102', 'Compra para comercialização', 1),
    ('2152', 'Transferência para comercialização', 1),
    ('2202', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros', 1),
    ('2403', 'Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 1),
    ('2411', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 1),
    ('2556', 'Compra de material para uso ou consumo', 1),
    ('2910', 'Entrada de bonificação, doação ou brinde', 1),
    ('2915', 'Entrada de mercadoria ou bem recebido para conserto ou reparo', 1),
    ('2916', 'Retorno de mercadoria ou bem remetido para conserto ou reparo', 1),
    ('2949', 'Outra entrada de mercadoria ou prestação de serviço não especificada', 1),
    ('5102', 'Venda de mercadoria adquirida ou recebida de terceiros', 1),
    ('5152', 'Transferência de mercadoria adquirida ou recebida de terceiros', 1),
    ('5202', 'Devolução de compra para comercialização', 1),
    ('5405', 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído', 1),
    ('5411', 'Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 1),
    ('5910', 'Remessa em bonificação, doação ou brinde', 1),
    ('5915', 'Remessa de mercadoria ou bem para conserto ou reparo', 1),
    ('5916', 'Retorno de mercadoria ou bem recebido para conserto ou reparo', 1),
    ('5933', 'Prestação de serviço tributado pelo ISSQN', 1),
    ('5949', 'Outra saída de mercadoria ou prestação de serviço não especificado', 1),
    ('6102', 'Venda de mercadoria adquirida ou recebida de terceiros', 1),
    ('6202', 'Devolução de compra para comercialização', 1),
    ('6411', 'Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 1),
    ('6949', 'Outra saída de mercadoria ou prestação de serviço não especificado', 1);

-- @@SEMENTE naturezas_operacao
-- Entradas ligadas; devolução e venda desligadas até a etapa delas.
INSERT OR IGNORE INTO naturezas_operacao (codigo, descricao, sentido, finalidade, cfop_interno, cfop_interestadual,
                                         movimenta_estoque, gera_financeiro, exige_fornecedor, ativa) VALUES
    ('COMPRA_REVENDA', 'Compra para revenda', 'entrada', 'normal', '1102', '2102', 'entra', 'pagar', 1, 1),
    ('COMPRA_REVENDA_ST', 'Compra para revenda com substituição tributária', 'entrada', 'normal', '1403', '2403', 'entra', 'pagar', 1, 1),
    ('COMPRA_USADO_PF', 'Compra de celular usado de pessoa física', 'entrada', 'normal', '1102', NULL, 'entra', 'pagar', 1, 1),
    ('BONIFICACAO', 'Bonificação, doação ou brinde recebido', 'entrada', 'normal', '1910', '2910', 'entra', 'nao', 1, 1),
    ('USO_CONSUMO', 'Compra de material de uso e consumo', 'entrada', 'normal', '1556', '2556', 'nao', 'pagar', 1, 1),
    ('ENTRADA_AJUSTE', 'Outra entrada (ajuste ou regularização)', 'entrada', 'ajuste', '1949', '2949', 'entra', 'nao', 0, 1),
    ('DEVOLUCAO_CLIENTE', 'Devolução de venda (cliente devolve)', 'entrada', 'devolucao', '1202', '2202', 'entra', 'nao', 0, 0),
    ('VENDA', 'Venda de mercadoria', 'saida', 'normal', '5102', '6102', 'sai', 'receber', 0, 0),
    ('DEVOLUCAO_FORNECEDOR', 'Devolução de compra ao fornecedor', 'saida', 'devolucao', '5202', '6202', 'sai', 'nao', 1, 0);

-- @@SEMENTE loja_ajustes
-- A loja online nasce FECHADA: o administrador abre em Loja online > Ajustes.
INSERT OR IGNORE INTO loja_ajustes (id) VALUES (1);
