# memory.md — como este sistema funciona

Memória técnica do **Index Celulares**, sistema de assistência técnica que
roda no navegador, sozinho, sem internet e sem instalar banco de dados.

Este arquivo é a fonte de verdade sobre **fluxos e regras**. O `LEIA-ME.txt`
explica o sistema para quem vai *usar*; este aqui explica para quem vai
*mexer* nele — e registra **por que** cada regra é assim, porque o motivo
some da memória antes do código.

> **Manutenção:** toda orientação nova que mude um fluxo entra aqui, na
> seção correspondente, junto com o motivo. Se uma regra for substituída,
> a antiga vira uma linha em *Decisões revistas* — nunca some sem
> explicação, senão alguém a reintroduz meses depois.

Última revisão: 28/10/2026 (rodada 4 da banca; banco na versão 4).

---

## 1. O que é e onde roda

| | |
|---|---|
| Motor | **PHP 8.3** (`C:\php`), só ele. A versão Node foi retirada na v2. |
| Banco | **SQLite**, arquivo único: `dados\index.sqlite` |
| Servidor | `servidor.php`, servidor embutido do PHP (`php -S localhost:5500`) |
| Front | HTML + CSS + JS puro. Sem framework, sem build, sem CDN. |
| Abrir | `iniciar-servidor.bat` |

**Nada é baixado de fora em tempo de execução.** O sistema roda na loja,
às vezes sem internet: um `<script src="cdn...">` viraria painel em branco
no primeiro dia sem conexão. Por isso os gráficos são SVG escritos à mão
(`Dashboard/graficos.js`) e não uma biblioteca.

### Arquivos

```
master-restaurado\
    Login\      index.html · login.css · login.js
    Dashboard\  dashboard.html · dashboard.css
                inicio.js · nucleo.js · janela.js · editores.js   ← base da tela
                formato.js · dre.js · os-regras.js   ← contas puras (testadas no Node)
                graficos.js                          ← gráficos SVG
                telas\  painel · vendas · os · entradas · movimentacao ·
                        financeiro · cadastros · configuracoes (.js)
    api\        api.php                      ← só o roteador
                nucleo.php                   ← constantes, DOMINIOS, banco, senha,
                                               validação, sessão (o instalador usa)
                rotas\  acesso · painel · catalogo · estoque · vendas ·
                        lancamentos · os (.php)
    dados\      index.sqlite                 ← O BANCO
                estrutura.sql                ← schema do banco NOVO (versão 4)
                aplicar-estrutura.php        ← ÚNICO jeito de criar/atualizar o banco
                migracoes\  ferramentas.php · 003-ate-v3.php ·
                            004-forma-padrao-e-brinde.php   ← um passo por versão
                reparar-dados.php            ← lista/corrige dados tortos antigos
                dados-demonstracao.php       ← dados falsos, pelo fluxo da API
                homologacao.php              ← põe uma CÓPIA em homologação: p / p, faixa, fiscal
    testes\     rodar.bat / rodar.php        ← roda TUDO em banco novo temporário
                api.test.mjs                 ← suíte da API (Node; a da banca + r3 + r4)
                nucleo.test.php · estoque.test.php · relatorios.test.php ·
                migracoes.php · migracao-esquema.test.php · integridade.php ·
                caso.php
                casos\mao-de-obra.json       ← tabela da regra da OS (tela e servidor)
                fixtures\estrutura-v2.sql, estrutura-v3.sql
                front\                       ← testes da tela (do dev front)
                front\e2e\                   ← roteiros de tela (Playwright, do front)
    Img\        logo.jpeg
    servidor.php · iniciar-servidor.bat · abrir-projeto.bat · .gitignore
    LEIA-ME.txt · memory.md

Tudo fica DENTRO desta pasta (uma pasta só por projeto, 12/11/2026):
dados\backups\   ← cópias de segurança do banco, junto do banco
                   (outra pasta: INDEX_CELULARES_BACKUPS)
testes\saida\    ← saída do testes\rodar.bat
                   (outra pasta: INDEX_CELULARES_SAIDA_TESTES)
As duas estão no .gitignore; copiar o CÓDIGO para outra máquina é
copiar tudo menos dados\ (banco e cópias) e testes\saida\.
```

Os `migrar-*.php` foram apagados (rodada 3); as cópias `.antes-*` não
ficam mais dentro de `dados\`.

---

## 2. A ideia central: cadastro, movimento, financeiro

Tudo no sistema cai em uma destas três caixas. Quando surgir uma dúvida
de modelagem, esta é a primeira pergunta a fazer.

| Caixa | O que é | Tem quantidade? | Tabelas |
|---|---|---|---|
| **Cadastro** | o que existe no mundo | não | `clientes`, `fornecedores`, `modelos`, `pecas`, `produtos`, `servicos`, `formas_pagamento` |
| **Movimento** | o que entrou e saiu | sim | `entradas`, `vendas`+`venda_itens`, `ordens_servico`+`os_itens`, `movimentacoes` |
| **Financeiro** | o dinheiro | valor | `lancamentos`, `os_pagamentos` |

**Regra que vale em todas as telas:** campo que aponta para outro cadastro
é *sempre* uma lista, nunca um campo de digitar. Digitar "Joao" e depois
"João" criava dois clientes; "Pix", "pix" e "PIX" viravam três linhas no
relatório. A única exceção é o **modelo do celular na OS**, que aceita um
nome novo — e mesmo esse vira cadastro na hora, aparecendo na lista da
próxima vez.

---

### As tabelas de apoio e as views

Além das três caixas, existem quatro tabelas que não guardam decisão de
negócio — guardam **rastro**:

| Tabela | Para quê | Por que existe separada |
|---|---|---|
| `aparelhos` | o celular do cliente na OS | o mesmo aparelho volta para outro conserto; sem ele, IMEI e senha seriam redigitados |
| `os_historico` | cada troca de status, com autor e hora | "quem marcou como pronta e quando" é a primeira pergunta quando o cliente reclama |
| `lancamentos_log` | alteração de valor, parcelas e destinatário | financeiro editável sem log vira palavra contra palavra |
| `os_pagamentos` | uma linha por forma de pagamento | ver a regra do pagamento dividido |

E cinco views, que existem para a **conta ficar num lugar só** — repetida
em cada consulta, ela desencontra na primeira alteração:

| View | Entrega |
|---|---|
| `vw_entradas_saldo` | o saldo calculado de cada entrada (a view mais importante do sistema) |
| `vw_entradas` | a entrada com o nome do item, o tipo e o saldo já juntos |
| `vw_vendas` | a venda com cliente, vendedor, lucro, itens, unidades e `forma_pagamento_id` |

`vw_os_abertas` e `vw_estoque_totais` foram removidas na versão 3: ninguém
as lia, e a definição de "OS em andamento" delas divergia da API.
As views são recriadas (DROP + CREATE) a cada aplicar-estrutura.

### Os oito status da OS

`aberta` → `orcamento` → `aprovada` → `em_reparo` → `pronta` → `entregue`,
com `recusada` e `cancelada` saindo de qualquer ponto.

Três deles mudam o mundo, e são os únicos que importam para o estoque e
para o caixa:

| Status | O que dispara |
|---|---|
| `entregue` | gera a venda, dá baixa definitiva, abre a conta a receber |
| `cancelada` / `recusada` | devolve as peças à prateleira e cancela a conta em aberto |

Sair de `entregue` desfaz a venda — ver a regra da seção 3.

### Dar baixa em um lançamento

Conta em aberto vira paga pelo botão **Baixar** no financeiro, que grava a
data do pagamento. É o que separa "faturado" de "recebido" nos gráficos —
o painel de caixa mostra só o que teve baixa, e o DRE mostra o faturado.

Lançamento já quitado nunca é apagado: vira `cancelado`. Dinheiro que
entrou não se apaga, se estorna.

`cancelada` (OS e venda) é **estado final**: não volta para status ativo
(a peça já voltou à prateleira e pode ter sido vendida de novo).
`recusada` pode voltar, e o saldo é conferido de novo na volta.

"OS em andamento" = `aberta, orcamento, aprovada, em_reparo, pronta`
(constante `STATUS_OS_EM_ANDAMENTO`; a tela recebe por `/api/config`).

---

## 3. Estoque: o saldo é calculado, nunca gravado

**Não existe coluna `saldo`.** Ele é calculado em `vw_entradas_saldo`:

```
saldo = comprado
      − vendido            (venda_itens de vendas concluídas)
      − usado em OS        (os_itens de OS em andamento — ver regra abaixo)
      + movimentação(+)    (garantia, retorno, ajuste)
      − movimentação(−)    (devolução, defeito, perda, ajuste)
```

Coluna de saldo desencontra da realidade na primeira exclusão; conta não.
Esta decisão é a base de tudo e **não deve ser revertida** sem trocar o
modelo inteiro.

### Onde a peça está, momento a momento

```
comprada → PRATELEIRA
              ↓ (entra numa OS)
           DENTRO DA OS          ← saiu do saldo, ainda não é receita
              ↓ OS entregue                    ↓ OS cancelada/recusada
           volta à prateleira               volta à prateleira
           e sai pela VENDA                 e fica disponível
```

A peça **sai do estoque no instante em que entra na ordem** e fica gravada
nela, com preço cobrado e custo **congelados na linha** (`os_itens`) — para
o histórico não mudar se o catálogo mudar depois.

Enquanto a OS não é entregue, essa peça não está no saldo nem virou
receita. Para ela não sumir do painel sem explicação, existem:
- tabela **"Dentro de OS abertas"** no Dashboard;
- card **"Dentro de OS"** na ficha do item.

### A venda de uma OS não se exclui sozinha  *(regra de 22/08/2026)*

A venda gerada por uma OS entregue **não** tem botão Excluir: ela é o
faturamento daquela ordem. Apagada sozinha, a OS ficaria "entregue"
apontando para uma venda que não existe.

Os três caminhos certos:

| O que aconteceu | O que fazer | O que acontece com a peça |
|---|---|---|
| Faturou errado | tirar a OS do status `entregue` | volta a ficar **reservada na ordem** |
| A OS não devia existir | excluir a OS | volta para a **prateleira** |
| Cliente devolveu / peça com defeito | botão **Garantia** na OS | movimentação: a defeituosa entra, a nova sai |

A troca por garantia só fecha se houver **saldo da peça nova** — a saída
já é barrada por "Saldo insuficiente", e um saldo negativo não é um
número, é um erro que ninguém explica depois.

**O bug que originou a regra**: a trava existia só no banco
(`ordens_servico.venda_id`, `NO ACTION`) e aparecia como
`SQLSTATE[23000] FOREIGN KEY constraint failed` na tela. A regra estava
certa; faltava dizê-la. Hoje: aviso na API, botão desativado com o motivo
no `title`, e a origem escrita na linha ("da OS-2026-0001").

O mesmo buraco existia em **excluir cliente**, que só contava ordens e
não vendas. E o handler global agora traduz qualquer
`FOREIGN KEY constraint failed` que escape para uma frase em português —
rede de segurança, não substituto do aviso específico.

---

### Entregar a OS gera uma venda  *(regra de 22/08/2026)*

Ao entregar, a peça **volta à prateleira e sai de novo pela venda**:

1. `vw_entradas_saldo` deixa de contar os `os_itens` daquela OS;
2. é criada uma `vendas` com os itens da OS + a mão de obra como item de
   serviço (sem `entrada_id`);
3. `ordens_servico.venda_id` guarda a venda gerada;
4. a conta a receber passa a vir da **venda**, não da OS.

O saldo final é o mesmo; o que muda é que a saída ganha um documento de
venda com cliente, valor e forma de pagamento, e o faturamento da oficina
entra no relatório como venda.

**Cuidado permanente — dupla contagem.** Como a receita e a saída agora
podem vir de dois lugares, *toda* consulta de OS entregue precisa de
`AND venda_id IS NULL`. Desde a rodada 3 essa regra mora em **um lugar
só**, nas views do `estrutura.sql`:

- `vw_faturamentos` — o que é faturamento (venda de balcão, venda gerada
  por OS, OS antiga sem venda), com a origem já classificada;
- `vw_receitas` — receita/custo por dia, origem e forma (pagamento
  dividido vira uma linha por forma); `financeiro()` e `relatorios()`
  leem só dela;
- `vw_itens_faturados` — o ranking de itens, pela mesma regra;
- `vw_saidas_estoque` — o que saiu por venda e por OS; `vw_entradas_saldo`
  e a ficha do item (`historicoDoItem`) leem dela.

Consulta nova de receita ou de saída **lê a view**, não reescreve o join.
`testes\relatorios.test.php` prova com uma venda gerada por OS.

OS entregue **antes** desta regra (sem `venda_id`) continua contando como
receita de serviço — o estoque e o faturamento de ontem não podem mudar
sozinhos.

Reabrir a OS (sair de "entregue") desfaz a venda: `desfazerVendaDaOs()`
apaga a venda, devolve o celular para "processamento" e cancela — não
apaga — o lançamento já quitado. Dinheiro que entrou não se apaga, se
estorna.

**Excluir a OS também precisa desfazer a venda.** O `DELETE /api/os/{id}`
apagava só a ordem, e a venda gerada ficava **órfã**: a peça continuava
marcada como vendida, não voltava ao estoque, e a conta a receber seguia
em pé cobrando um serviço que não existia mais. Hoje o delete roda em
transação e, se houver `venda_id`, chama `desfazerVendaDaOs()` antes —
depois cancela o lançamento de origem `os` (fluxo antigo) e só então
apaga a ordem.

Regra geral: **toda saída de "entregue" — reabrir, cancelar ou excluir —
tem de passar pelo mesmo desfazer.** Se aparecer um quarto caminho, ele
precisa chamá-lo também.

### Movimentações fora do fluxo

`movimentacoes` cobre o que compra/venda/OS não cobrem. **O motivo escolhe
o lado**, para quem preenche pensar no que aconteceu, não em "isso é
entrada ou saída?":

| Motivo | Lado |
|---|---|
| garantia (fornecedor repôs) | entrada |
| retorno (voltou à prateleira) | entrada |
| devolucao (devolvido ao fornecedor) | saída |
| defeito | saída |
| perda | saída |
| brinde (brinde / cortesia) | saída |
| ajuste (ajuste de estoque) | os dois |

Motivo, rótulo e lado moram em `DOMINIOS['motivos_movimentacao']`
(`api/nucleo.php`) e vão para a tela por `/api/config` — nenhum `CASE` de
rótulo no SQL. Venda de total 0 é recusada e aponta para o brinde.

Regras: **baixa maior que o saldo é recusada** (saldo negativo não é
número, é erro que ninguém explica depois); **nada apaga o passado** — a
peça que saiu numa OS continua registrada nela, e o movimento é um
lançamento novo. Estoque que reescreve o histórico não é auditável.

**Ficha do item** (`GET /api/movimentacoes?peca_id=`): une as quatro
origens — compra, venda, OS e movimentação — numa linha do tempo com o
saldo depois de cada linha. É onde se responde "por que sobrou 2?" sem
abrir quatro telas.

---

## 4. Entradas

### Uma ferramenta só: a entrada é o documento  *(v9, 12/11/2026)*

Havia duas portas para a mesma coisa: o **Pedido de entrada** (a nota do
fornecedor, com natureza, CFOP e parcelas) e o "+ Celular / + Peça /
+ Produto" da tela Entradas, que gravava a linha em `entradas` direto,
sem documento. Ficou **uma**:

- **Entradas** (menu; seção `#pedidos`, `telas/pedidos.js`) é o único
  lugar onde mercadoria entra. "+ Nova entrada" já abre com uma linha (a
  compra digitada: a peça do dia, o usado comprado no balcão);
  "Importar XML da NF-e" continua. Confirmar cria uma `entradas` por
  linha (`pedido_itens.entrada_id`) e as contas.
- **Estoque** (menu; seção `#entradas`, `telas/entradas.js`) só consulta:
  saldo, histórico, edição do que não é conta (preço de venda, situação,
  cor, condição, observação). Cada linha mostra a origem: "Entrada
  PE-..." (link que abre o documento) ou "lançamento avulso" (o que foi
  lançado antes da v9). Do documento, **quantidade e custo vêm travados**
  na edição e **não há Excluir** — o servidor já recusava
  (`pedidoDaEntrada`); desfaz-se cancelando a Entrada. O lançamento
  avulso antigo continua editável e excluível como antes.
- `GET /api/entradas` (lista e item) traz `pedido_id` e `pedido` (o
  número), de `documentosDasEntradas()`: uma consulta só, unida em PHP.
- **"Já paguei"** saiu da entrada avulsa e foi para a confirmação:
  `POST /api/pedidos/{id}/confirmar` com `{"pago": 1}` cria as contas já
  pagas (`data_pagamento` = agora). A tela pergunta ao confirmar ("Fica a
  pagar" / "Já paguei"); sem escolha, nota importada ou com parcelas fica
  a pagar e a digitada nasce paga — o padrão que a entrada avulsa tinha.
  A escolha não vai para o banco (não há coluna): só muda as contas.
- **Quem confirma** é o admin, ou o balcão e o técnico com a regra
  `pedido.confirmar_balcao` (Empresa e regras > Regras > Entradas). Antes
  o balcão lançava entrada avulsa sem regra nenhuma: com a regra
  desligada (o padrão), ele monta o rascunho e o admin confirma.
- Compra pede fornecedor (a natureza `exige_fornecedor`): o usado de
  pessoa física entra com a natureza `COMPRA_USADO_PF` e a pessoa
  cadastrada como fornecedor.
- `POST /api/entradas` **continua na API** (a massa dos testes e do e2e
  usa; nenhuma tela chama mais). Fechá-la é o passo "venda e entrada
  como transação fiscal" do plano do fiscal: toda entrada com natureza.

### A linha de estoque

Uma linha por compra. O **tipo** decide qual cadastro vale e quais campos
a tela mostra:

| Tipo | Aponta para | Campos próprios | Quantidade |
|---|---|---|---|
| `celular` | `modelos` | IMEI, cor, condição | sempre 1 |
| `peca` | `pecas` | — | livre |
| `produto` | `produtos` | — | livre |

Celular é unitário (1 IMEI = 1 aparelho), e o banco cobra isso com um
`CHECK`.

`situacao` (ready/processamento/check/vendido) vale **só para celular** —
é o que move os cards do Dashboard. Para peça e produto quem manda é o
saldo: um lote marcado como "vendido" com saldo 3 ainda tem 3 peças na
gaveta. Por isso o filtro `?disponivel=1` é
`saldo > 0 AND (tipo <> 'celular' OR situacao <> 'vendido')`.

**Valor sugerido de um item**: preço de venda quando existe, senão o
**custo**. Quem cadastra a peça só com o custo (caso comum) via o campo
abrir com "0" e a peça entrava de graça na OS.

**Botão Histórico na linha**  *(22/08/2026)*: abre a mesma ficha de
movimentação do cadastro, mas por `entrada_id` — a ficha do **lote**, não
do item do catálogo. A pergunta que ele responde é "o que aconteceu com
esta compra": quanto saiu em venda, quanto foi para uma OS, o que voltou
por garantia. Um item que existe em vários lotes tem uma ficha por lote
aqui, e uma consolidada em Cadastros.

`GET /api/movimentacoes` já aceitava `entrada_id` além de `peca_id`,
`produto_id` e `modelo_id`; só faltava o atalho na tela.

---

## 5. Ordem de serviço

Peças vêm de listas. **Cliente e modelo do celular vêm da lista ou são
cadastrados ali mesmo** — quem chega com o aparelho na mão não obriga o
atendente a sair da OS, abrir Cadastros e voltar.

### Cadastrar cliente pela OS  *(regra de 22/08/2026)*

A opção vazia do select é `— cadastrar cliente novo —`; escolhendo ela
aparecem **nome e telefone** (`cliente_nome`, `cliente_telefone`), e o
cadastro acontece **dentro da transação da OS** — se a OS falhar depois,
não pode sobrar cliente solto no sistema.

`acharOuCriarCliente()` é mais cuidadoso que o equivalente do modelo:
dois modelos com o mesmo nome **são** o mesmo modelo, duas pessoas com o
mesmo nome **não são** a mesma pessoa, e juntar as duas misturaria
histórico e garantia. Então:

- **Com telefone**: procura pelo telefone, comparando só os dígitos —
  senão `(11) 99999-0000` e `11999990000` viram dois clientes. Não achou?
  É gente nova, mesmo que o nome já exista.
- **Sem telefone**: cai no nome exato, único dado que há. Se duas pessoas
  já dividem o nome, pega a mais antiga — por isso vale escolher na lista,
  onde cada uma aparece com o seu telefone.

O campo de "cadastrar novo" aceita mais de uma entrada (`extras` no
`select-novo`); modelo, peça e produto continuam pedindo só o nome.

### Serviços: a mão de obra virou cadastro  *(25/08/2026)*

Antes a mão de obra era um número digitado na OS. Quem faz a mesma troca
de tela dez vezes no mês redigitava o preço dez vezes, e nenhum relatório
sabia dizer qual serviço rende mais — "mão de obra" era uma linha só, sem
nome.

Agora existe o cadastro **Serviços** (nome, preço de tabela, tempo médio)
e a OS aponta para ele. Peça e serviço moram na **mesma tabela**
(`os_itens`), porque para a ordem são a mesma coisa — algo com quantidade
e preço. O que muda é a origem:

| coluna | significa | mexe no estoque? |
|---|---|---|
| `entrada_id` | peça que saiu da prateleira | sim, dá baixa |
| `servico_id` | serviço do catálogo | não, é mão de obra |

**O preço do cadastro é sugestão.** O que fica gravado na OS é o cobrado
de verdade (`os_itens.valor_unitario`) — senão mudar a tabela amanhã
reescreveria o histórico do que já foi cobrado.

**Com serviços lançados, `valor_mao_obra` é a soma deles** e o campo trava
na tela. Deixá-lo solto permitiria uma OS dizer "mão de obra 50" com
serviços somando 80, e nenhum dos dois números seria confiável. Sem
serviço lançado vale o digitado e, sem nada digitado, `orçamento − peças`
(as OS antigas e o conserto avulso dependem disso) — a regra completa está
em "Contas encadeadas" (seção 5).

Serviço já usado **não se exclui**, só desativa — as OS antigas apontam
para ele e apagar deixaria o histórico sem o nome do que foi feito. Mesma
regra das formas de pagamento.

**Armadilha de dupla contagem:** ao entregar, a OS vira venda. Com
serviços como linha, eles já viram `venda_itens` no laço dos itens — somar
`valor_mao_obra` por cima cobraria o trabalho duas vezes. Por isso a linha
sintética "Mão de obra — OS-XXXX" só existe quando **não** há serviço
lançado. Mesma condição no cálculo do `$bruto`.

---

### Pagamento dividido na OS  *(25/08/2026)*

"Metade em dinheiro, metade no débito" é o caso comum no balcão. Antes
cabia uma forma só por OS: o lançamento saía inteiro numa forma, com a
forma errada em parte do valor, e a conciliação da equipe nunca fechava
com o extrato.

Uma linha por forma em `os_pagamentos`. Ao entregar, sai **um lançamento
por forma** — 50 em dinheiro e 30 no débito viram duas linhas no
financeiro, cada uma com a sua.

**A soma tem de bater com `valor_final`.** Uma OS de 100 registrada como
50+40 significa que 10 sumiram, e o erro só apareceria no fim do mês sem
ninguém lembrar de qual ordem veio. A conferência é feita nos dois lados:
o rodapé da tela mostra a diferença o tempo todo ("Falta lançar",
"Fecha em", "Passou em") e trava o Salvar; a API recusa de novo, porque
outra aba pode ter mudado o valor.

**Folga de um centavo** (`0.011`): 33,33 três vezes dá 99,99, e recusar
isso obrigaria o atendente a caçar a diferença do arredondamento.

As colunas `forma_pagamento` / `forma_pagamento_id` da OS continuam
existindo e passam a guardar a **primeira** forma — não é a verdade
inteira, mas é melhor que ficar desatualizada apontando para a forma de
antes da divisão. A verdade completa está em `os_pagamentos`.

---

### Situação de peça sai do saldo, não do campo gravado  *(25/08/2026)*

Uma peça vendida continuava com a etiqueta **"Stock Ready"** e saldo
`0 de 1`. Quem filtrasse por "pronto para vender" receberia item que não
existe mais.

O filtro `?disponivel=1` já estava certo (manda o saldo). O que mentia era
a **etiqueta**. Agora:

| tipo | de onde vem a etiqueta |
|---|---|
| `celular` | o campo gravado — é unitário, e move os cards do painel |
| `peca` / `produto` | o **saldo**: `Em estoque` ou `Esgotado` |

E o formulário de entrada **só pergunta situação para celular**. Para peça
e produto o campo dava a chance de gravar uma informação que a tela
ignora.

### Contas encadeadas

Uma regra só, `calcularValoresOs()` em `api/rotas/os.php` (a tela tem a
mesma em `Dashboard/os-regras.js`), em centavos inteiros:

```
mão de obra = serviços > 0 ? serviços
            : mão digitada ?? (orçamento > 0 ? max(0, orçamento − peças) : 0)
valor final = final digitado ?? ((peças + mão) > 0 ? peças + mão : orçamento)
```

"Digitado" = veio no corpo (POST) ou é o valor já gravado (PUT sem o
campo): salvar sem mexer nunca muda a cobrança. Os dois lados são
conferidos pela mesma tabela, `testes\casos\mao-de-obra.json` (25 casos;
`testes\nucleo.test.php` e `testes\front\os-regras.test.js`). Mudou a
regra? Mude os dois e a tabela. Se as peças passam do orçamento, a tela
mostra um alerta — quase sempre é um dígito a mais.

Formato da tabela (combinado com o front na rodada 4): cada caso tem
`entrada {orcamento, pecas, servicos, mao_digitada, final_digitado}` e
`esperado {mao, final}`. Caso de **edição** traz também
`"edicao": {"gravado": {"mao": X, "final": Y}}`; aí `mao_digitada` e
`final_digitado` são o que a pessoa mexeu depois de abrir a OS (null =
não mexeu) e vale `digitado = entrada ?? gravado`. O teste PHP roda esses
casos também pelo `valoresOs()` de verdade, como um PUT parcial (campo
que não vem no corpo = o gravado).

`valor_pecas` **nunca é digitado**: é a soma de `os_itens`, recalculada
pela API a cada gravação.

### Itens travam quando a OS fica pronta

`ITENS_TRAVADOS = ['pronta', 'entregue']`. A lista vira só leitura: as
peças já saíram do estoque e podem já ter virado conta a receber. Tirar um
item ali devolveria a peça à prateleira sem ninguém ter devolvido nada —
foi o que aconteceu com a OS-2026-0001, que ficou "pronta" com zero peças.

**O status continua editável.** A saída é: voltar para "Em reparo", salvar,
editar. O aviso na tela diz isso.

Quando travado, `coletarItens()` devolve `null` de propósito: a API só
regrava os itens quando o campo `itens` vem no corpo.

### Armadilha resolvida: item some ao reabrir

O select de itens lista entradas com saldo. O item **já usado nesta OS**
está com saldo zero — foi esta OS que o consumiu. Sem juntá-lo às opções,
ao reabrir a ordem o select caía em "escolha no estoque" e, ao salvar de
novo, a linha era descartada: **a peça sumia sem ninguém remover nada**.

`opcoesDeEstoque(jaUsados)` resolve isso, e o saldo exibido soma de volta a
saída da própria ordem. Qualquer editor de itens novo precisa fazer o mesmo.

### Painel de status

Trilha de seis etapas (aberta → orçamento → aprovada → em reparo → pronta
→ entregue) com o passo atual pulsando. `recusada` e `cancelada` não estão
na trilha: são saídas do caminho, não etapas dele.

### Garantia

Interruptor sim/não + período (30/60/90/180/365). Antes era campo numérico
com passo de centavo, e a setinha do teclado transformava 90 dias em 89,98.
Desmarcado grava zero.

---

## 6. Vendas

Escolhe cliente (ou "consumidor"), itens com saldo, desconto, forma de
pagamento e parcelas. Ao fechar: baixa o saldo, marca celular como
vendido, e abre **uma conta a receber por parcela**, de mês em mês.

Os **itens não mudam** depois de gravados: mexer neles significaria
devolver e retirar estoque de novo. Quem errou o item exclui a venda e
refaz — dois cliques, sem rastro torto.

Divisão de parcelas: a última leva a diferença do arredondamento, senão
R$ 100,00 em 3× vira R$ 99,99.

Excluir devolve tudo ao estoque; cancelar faz o mesmo e mantém o registro.
Nos dois, **toda** conta da venda (pendente e paga) vira "cancelado" -
nunca é apagada - e o celular volta à prateleira (`devolverCelularesAPrateleira`,
a mesma função do reabrir OS).

- Cancelada é final: PUT para "concluida" → 400.
- Venda gerada por OS: não cancela, não exclui e não muda valor pelo
  /vendas (400 "Altere pela ordem de serviço").
- Mudou desconto ou forma: se todas as parcelas estão pendentes, são
  canceladas e refeitas com a mesma regra da criação; com parcela paga, o
  pago fica e a diferença vira receber ou devolução (seção 7, "Venda já
  paga que muda de desconto").
- Parcelas: inteiras de 1 a 24, nenhuma abaixo de R$ 0,01, divididas em
  centavos; "já recebi à vista" só com 1 parcela. Vencimento de mês em mês
  sem pular mês: 31/01 → 28/02 → 31/03 (`somarMeses`).
- Saldo: as linhas da MESMA entrada são somadas antes de conferir
  (`prepararItensDeSaida`), e depois de gravar `conferirSaldos()` confere
  de novo pela `vw_entradas_saldo`, dentro da transação. Na edição de uma
  OS, as peças que ela já segura voltam para a conta — e quem diz se ela
  segura é a `vw_saidas_estoque` (r4: antes era uma cópia da regra em PHP).
  `testes\estoque.test.php` confere em cada status da OS.
- "Parado no estoque" (o que ainda pode ser vendido) é a constante
  `SQL_ESTOQUE_PARADO` (`api/nucleo.php`), sobre a `vw_entradas`: o painel
  (cards, financeiro, relatórios) e `/entradas?disponivel=1` usam a mesma.
- **Um aparelho, uma unidade** (r4): depois da recompra (entrada nova com o
  mesmo IMEI), desfazer a venda antiga — cancelar, excluir, tirar a OS de
  "entregue", excluir a OS — e a movimentação que traria a entrada antiga
  de volta são recusados (400, "O IMEI X já voltou ao estoque pela entrada
  de dd/mm/aaaa (recompra: ...). Nada foi gravado. ..."). Antes de devolver:
  `devolverCelularesAPrateleira`; depois de gravar (movimentação, OS):
  `conferirImeiNoEstoque`. Invariante: I17.

---

## 7. Financeiro

`lancamentos` com tipo (receber/pagar) e **origem**: `manual`, `venda`,
`os`, `entrada`. Lançamento de origem automática é o espelho de um
documento: não se exclui, e valor e tipo não se editam (mude o documento).

**Toda** alteração de lançamento passa pelas funções de
`api/rotas/lancamentos.php` (`criarLancamento`, `gravarLancamento`,
`cancelarLancamentos`).
Não escreva `UPDATE lancamentos` fora delas: é o que garante o log.

### Lucro líquido (a conta do DRE)

```
receita        vendas + OS entregues (sem venda_id)
− custo        o que a loja pagou nos itens (CMV)
= lucro bruto
− despesas     contas a pagar de origem MANUAL
= lucro líquido
```

**A compra de estoque não entra como despesa** — ela já aparece no custo
quando o item é vendido. Somar as duas descontaria o mesmo dinheiro duas
vezes, e o mês de uma compra grande ficaria no vermelho com a loja
vendendo bem. Por isso o filtro `origem = 'manual'`.

### Editar lançamento e o log  *(revisto em 28/10/2026 - vale a regra da banca)*

- **Excluir**: só lançamento MANUAL e PENDENTE (o digitado errado, que
  nunca virou dinheiro). Quitado vira `cancelado` pelo PUT de situação.
- **Gerado por venda/OS/compra**: vencimento, forma, baixa e observação
  editam; **valor e tipo não** (400 explicando onde mudar). Cancelar só a
  conta de uma venda concluída → 400 (cancele a venda). Cancelado de
  documento não volta a pendente.
- Lançamento manual: vencimento obrigatório; parcela ≤ total.
- Baixa dada duas vezes (duas abas) → 409, nada muda.

A regra antiga ("tudo editável, só não exclui com venda") deixava o
dinheiro pago sumir do histórico e a venda de R$ 900 com R$ 1 a receber.

Cada alteração de campo sensível vira uma linha em `lancamentos_log`:
valor, vencimento, situação, tipo, parcela, total de parcelas, cliente,
fornecedor e forma de pagamento - **inclusive nos cancelamentos
automáticos** (venda cancelada/excluída, OS reaberta/cancelada/excluída,
entrada excluída), com uma linha "Motivo". Descrição e observação não
entram — corrigir um acento não precisa de auditoria.

O log grava o **nome**, não o id: "cliente_id: 7 → 12" obrigaria a
consultar o banco para ser lido. Botão **Histórico** na linha abre a
ficha com os dados atuais e todas as alterações.

Armadilha: em `registrarLogLancamento()` use `array_merge`, não `+`. O
operador de união mantém a chave já existente, e parcela/total_parcelas
(copiados do registro atual) venceriam os valores novos — a mudança
nunca apareceria no log.

### Compra gera lançamento pago

A entrada lança no financeiro com três opções: **já paguei (baixa na
hora)**, a pagar (pendente) ou não lançar. O padrão é já pago, porque na
prática a peça é comprada quando o aparelho já está na bancada e o
dinheiro sai na hora — deixar pendente obrigaria a dar baixa em cada
compra, uma por uma. A forma de pagamento vai junto.

*(v9)* Desde que a entrada avulsa saiu da tela, as três opções moram na
**confirmação da Entrada**: "Já paguei" (`{"pago": 1}`), "Fica a pagar"
e o interruptor "Gerar contas a pagar" desligado (= não lançar). Ver
seção 4, "Uma ferramenta só".

### Formas de pagamento

Cadastro com tipo (à vista/cartão/a prazo) e **parcelas sugeridas**.
Venda, OS e lançamento apontam por `forma_pagamento_id`; a coluna de texto
continua gravada para o histórico e é atualizada quando a forma é
renomeada — senão o documento mostraria um nome e o relatório outro.

Forma **em uso não se exclui, desativa**. Documento antigo que usa uma
forma desativada continua vendo ela na *sua* lista: editar uma venda velha
não pode trocar a forma dela sozinho.

**Forma padrão é explícita** (`formas_pagamento.padrao`, índice único
parcial: só uma com 1; semente: Dinheiro). `PUT {padrao:true}` troca; a
padrão não pode ser desativada. Forma nova entra com `ordem = max + 10`
(fim da lista). Nome repetido é comparado sem acento e sem caixa. **Só o
admin escolhe a padrão** (r4, `conferirQuemEscolhePadrao`): POST ou PUT
com `padrao:true` de balcão/técnico → 403, a menos que a forma já seja a
padrão (reenviar o formulário não muda nada).

**Venda já paga que muda de desconto** (`acertarVendaJaRecebida`): o pago
continua pago; cancelam-se só os pendentes; se o total novo ≥ recebido,
nasce UM receber pendente com a diferença; se for menor, nasce um pagar
pendente "Devolução ao cliente — VD-x". Devolução e cancelamento de venda
paga são só do admin.

---

## 8. Dashboard e relatórios

Duas partes: **resultado do período** (relatórios) e **estoque e oficina
hoje** (situação atual).

Nove relatórios, cada um com **filtro próprio e independente**: dá para
deixar a receita em 12 meses e o ranking em 3 ao mesmo tempo. Filtro fora
do padrão fica marcado em azul.

### Filtro de origem  *(regra de 22/08/2026)*

Cada relatório filtra também **de onde veio o dinheiro**: `Vendas e OS`
(padrão), `Só vendas de balcão`, `Só ordens de serviço`.

Isto só funciona porque a receita é **classificada na origem**, no SQL:
como a OS entregue vira venda, sem o `LEFT JOIN ordens_servico o ON
o.venda_id = v.id` toda receita de oficina apareceria como balcão — e o
filtro "só OS" mostraria zero. A oficina fatura por **dois caminhos** e
os dois contam como OS:

1. OS entregue **antes** desta regra → receita de serviço direta;
2. venda gerada pela OS entregue → `vendas` com uma OS apontando para ela.

Desde a rodada 3 o join mora só em `vw_faturamentos`/`vw_receitas`/
`vw_itens_faturados` (seção 3). **Consulta nova de receita lê a view**,
senão a oficina volta a virar balcão.

**Despesas só entram quando se olha tudo.** Aluguel e energia não são de
"venda" nem de "OS"; atribuí-las a um lado daria um lucro líquido falso.
Filtrado por origem, a tela troca os rótulos sozinha: o card de despesa
vira a contagem de documentos e "Lucro líquido" vira **"Lucro bruto"** —
em `rotuloLucro()`. O título da seção também diz a origem.

### Filtro de datas e granularidade

Além de 3/6/12 meses, cada painel aceita **datas escolhidas**. O gráfico
troca de granularidade sozinho:

| Intervalo | Uma coluna por |
|---|---|
| até 45 dias | dia |
| até 180 dias | semana |
| acima | mês |

O título acompanha ("Receita, custo e despesas **por dia**").

**Os filtros não vão ao servidor.** A API manda a série **diária** de uma
vez (~30 KB, só dias com movimento) e o navegador agrupa. Trocar filtro é
instantâneo; uma requisição por clique travaria o painel.

Datas em **UTC** de propósito: em horário local, um "+1 dia" que cai no
domingo da virada devolve o mesmo dia e o gráfico ganha ou perde uma
coluna sem motivo.

Conta vencida aparece em **qualquer** prazo escolhido — é justamente o que
não pode sumir por causa de um filtro.

### Roscas (pizza)  *(22/08/2026)*

Três gráficos de rosca no painel: **como o cliente pagou** (por forma de
pagamento), **para onde vai o dinheiro** (contas a pagar por categoria) e
**dinheiro parado por tipo** (celular/peça/produto).

Rosca, e não pizza cheia, porque o furo guarda o total — o número que se
lê primeiro fica no centro em vez de ter de ser somado de cabeça.

Regras que valem para toda rosca nova:

- **Só parte-do-todo.** Círculo responde "quanto do bolo cada um pegou";
  não serve para comparar fatias parecidas (24% e 26% são idênticos ao
  olho). Por isso a legenda traz valor e percentual **escritos**, em
  colunas alinhadas — é ali que a comparação acontece.
- **Máximo de 6 fatias.** Acima disso o olho não separa mais os arcos; o
  excedente vira "Outros (n)", com os nomes preservados na dica.
- **A legenda também abre a dica** e realça a fatia: acertar um arco fino
  com o mouse é difícil, e a linha da legenda é um alvo grande.
- Uma fatia de 100%% não pode ser um arco — o ponto inicial e o final
  coincidem e o path some. Nesse caso o desenho é um `<circle>`.

A composição da receita (balcão x oficina) continua como **barra de
proporção**, não rosca: com duas fatias a barra lê melhor e ocupa menos.

**Cada rosca tem o seu filtro**, como os outros painéis. A API manda uma
linha por **dia** (`pagamentos`, `despesas_categoria`, `estoque`) e o
recorte é feito no navegador — trocar o período não vai ao servidor.

Duas particularidades:

- **Como o cliente pagou** também tem filtro de origem (venda / OS), e
  classifica pelo `LEFT JOIN ordens_servico o ON o.venda_id = v.id`: a
  venda gerada por uma OS entregue conta como OS, não como balcão.
- **Dinheiro parado por tipo** recorta pela data da **entrada**, não da
  venda — a pergunta é "desse dinheiro parado, quanto entrou quando". Por
  isso o padrão dele é `Qualquer entrada`, e não 12 meses: uma peça
  comprada há dois anos e nunca vendida é justamente a que precisa
  aparecer. A consulta desse painel não tem recorte de `$desde`.

### Gráficos (`graficos.js`)

SVG à mão. Regras seguidas, todas pelo mesmo motivo — o gráfico é lido por
uma pessoa, às vezes com pressa, às vezes daltônica:

- **um eixo de valor por gráfico** (dois eixos inventam correlação);
- cor segue a **série**, nunca a posição no ranking;
- legenda obrigatória com 2+ séries;
- rótulo de valor só no que importa (o último mês), nunca em todo ponto;
- grade e eixo em linha **contínua** e discreta;
- o alvo do mouse é a **coluna inteira**, não o retângulo pintado;
- escala com passos que se leem de cabeça (1, 2, 2,5, 5, 10 × grandeza);
- 12 meses de zero não são gráfico: viram uma frase.

**Paleta validada** contra a superfície `#171b26` (banda de luminosidade,
piso de croma, separação para daltonismo, contraste). Os hex estão em dois
lugares — tokens no CSS e `PALETA` no JS (a função `etiqueta()` concatena
transparência no hex, e `var(--x)22` não é cor). **Mexeu num, mexa no
outro, e revalide** — não trocar no olho.

---

## 9. Interface

- **Menu retrátil** (74px, só ícones); escolha gravada em `localStorage`.
- **Menu em grupos** *(v9, 12/11/2026)*: soltos só Início, PDV e Ordens de
  serviço; o resto em grupos que abrem e fecham — **Compras e estoque**
  (Entradas, Estoque), **Vendas** (Histórico de vendas, Loja online),
  **Gestão** (Painel, Financeiro) e **Administrativo** (Cadastros, Fiscal,
  Empresa e regras, Minha conta). O grupo é um `<button aria-expanded>` com
  a `<ul class="submenu" hidden>` embaixo; o `nucleo.js` (`marcarGrupos`)
  abre o grupo da seção aberta e fecha os outros a cada navegação, e o
  grupo fechado que contém a seção fica aceso (`.tem-ativo`). Os ids das
  seções **não mudaram**: `#pedidos` é a tela **Entradas** e `#entradas` é
  o **Estoque** (renomear quebraria links, atalhos e os testes). Grupo
  em que o perfil não vê nada não existe hoje (todo grupo tem um item para
  todos); se um dia existir, ponha `data-so-admin` no `<li>` do grupo. O
  e2e navega pelo `H.secao()`, que abre o grupo antes de clicar, como a
  pessoa faria.
- **Janela de cadastro não fecha com clique fora nem Esc** — treme e
  avisa. Um clique errado no meio de uma entrada jogava fora tudo o que
  havia sido digitado. Janela de leitura fecha normal.
- **Modal com altura limitada**: `#modalForm` precisa de `min-height: 0`
  para participar do flex. Sem isso o form crescia livre, o corpo nunca
  rolava e o rodapé com Cancelar/Salvar era desenhado fora da tela.
- Tabelas largas rolam **dentro do painel** (`.rolagem-x`); a página nunca
  rola de lado.
- Números com dígito de largura fixa (`tabular-nums`), senão as colunas de
  dinheiro dançam.
- **Filtros em painel estreito** (`.tables-grid .table-title`): descem
  inteiros para a linha abaixo do título e ficam **dois por linha**
  (`flex: 1 1 calc(50% - 3px)`). Um `<select>` nasce com a largura da
  **opção mais longa**, não da escolhida — "Vendas e OS" mede o tamanho
  de "Só ordens de serviço". Por isso o ranking, que tem quatro filtros
  em um terço da tela, passava da borda e quebrava em escadinha 1-2-1.
  Nos cabeçalhos de gráfico e de seção o bloco continua rígido
  (`flex-shrink: 0`): lá sobra espaço e quebrar seria pior.

---

## 10. API

Tudo sob `/api`, JSON, sessão obrigatória (menos `login`).

```
login · logout · sessao · config · trocar-senha
resumo · financeiro (admin) · relatorios (admin)
entradas          ?tipo= ?disponivel=1
os · vendas · lancamentos ?tipo= ?status= ?de= ?ate=
movimentacoes     ?peca_id= ?produto_id= ?modelo_id= ?entrada_id=
clientes · fornecedores · modelos · pecas · produtos · servicos · formas-pagamento
usuarios          (só admin)   usuarios/{id}/destravar (POST, só admin)
```

Contrato com a tela (rodada 3):
- Erro é sempre `{"ok":false,"erro":"..."}`; login errado é
  `401 {"ok":false,"erro":"...","restam":N|null}` (N a partir do 3º erro).
- `/api/config`: limites (quantidade_maxima, garantia_maxima,
  janela_vencimentos, tempo_medio_maximo...), `regra_senha` e `dominios`
  (status_os, status_venda, categorias_peca, tipos_pagamento, condicoes,
  motivos_movimentacao `[{valor,rotulo,lado}]`). A tela não tem rótulo
  próprio.
- `resumo.cards`, `resumo.os_em_andamento` e `financeiro.os.os_abertas`
  vêm prontos: a tela não refaz a conta.
- Venda, OS e lançamento trazem `pode_editar_valor`, `pode_excluir`,
  `pode_cancelar`; a OS traz `status_permitidos` (`[]` se cancelada).
- Pagamento com forma e sem valor → 400 "Informe o valor de cada forma de
  pagamento escolhida.".

Padrões: erro previsto é `ErroApi(codigo, mensagem)` com texto que explica
**o que fazer**, não só o que houve - com acento e com o nome do campo
como aparece na tela. Operação que grava em mais de uma tabela vai em
`emTransacao(function () {...})`. Exclusão que quebraria histórico é
recusada com o caminho alternativo na mensagem. Erro não previsto: 500
com frase genérica, detalhe em `dados/erros.log`.

Números de regra e domínios moram em `api/nucleo.php` (SENHA_MIN 8,
PARCELAS_MAX 24, VALOR_MAXIMO 10 milhões, QUANTIDADE_MAXIMA, ESTOQUE_BAIXO
3, GARANTIA_PADRAO 90, GARANTIA_MAXIMA 3650, JANELA_VENCIMENTOS 90,
LOGIN_*, REGRA_SENHA, DOMINIOS) e a tela lê por `/api/config`. DEFAULT do
schema = a constante (ex.: `garantia_dias DEFAULT 90`).

Segurança:
- Perfis: `tecnico`/`balcao` → 403 em financeiro, relatorios,
  lancamentos, usuarios e em qualquer DELETE; sem custo/lucro em /resumo,
  /vendas e /os (só /entradas mostra custo); cancelar venda já recebida,
  devolver dinheiro ou tirar OS paga de "entregue" → 403 (só admin).
- Login: 5 erros no MESMO LOGIN em 15 min → 429 só para ele (Caps Lock de
  um não tranca a loja). Por IP só conta quando o IP não é local, com
  limite 30. Login inexistente roda PBKDF2 num hash falso (mesmo tempo).
  Senha atual errada no trocar-senha conta como tentativa. Acerto limpa
  só as do login. O admin destrava (`POST usuarios/{id}/destravar`).
- Senha: regra única `senhaFraca()` (≥8, letras e números, sem o login,
  fora da lista comum, sem bloco repetido). Senha fraca, senha inicial,
  usuário criado pelo admin ou senha redefinida pelo admin
  (`usuarios.trocar_senha`) → só trocar-senha/config/sessao/logout até
  trocar (403 com `trocar_senha`).
- Sessão: 8 h contadas do login (`$_SESSION['login_em']`), cookie
  HttpOnly + SameSite=Strict + Secure em HTTPS (ou X-Forwarded-Proto
  https). Escrita (POST/PUT/PATCH/DELETE) exige Content-Type JSON e
  Origin — ou, sem Origin, Referer — do mesmo host, senão 403. Não sobra
  ninguém admin: o último admin ativo não é rebaixado/desativado/excluído.
- Log: `zend.exception_ignore_args=1` e o corpo da requisição nunca vai
  para o `erros.log` (senha não vaza num 500).
- Senha do aparelho (`aparelhos.senha_aparelho`): só no GET de OS em
  andamento; nunca em lista; vira NULL ao entregar, cancelar ou recusar
  (`STATUS_OS_APAGA_SENHA`; I15). Senha antiga guardada:
  `reparar-dados.php` item 4.
- IMEI: 15 dígitos com Luhn; só é recusado se houver entrada de celular
  com esse IMEI e saldo > 0 (recompra do aparelho vendido é permitida).
- OS: `atualizado_em` é a versão; PUT com versão velha → 409 "Esta OS foi
  alterada por outra pessoa depois que você abriu. Nada foi gravado. Use
  Recarregar e confira." (o botão da tela se chama Recarregar).
- `servidor.php` só entrega Login/, Dashboard/ e Img/ (conferido depois do
  realpath, com lista de extensões). O resto é 404.
- Banco: `INDEX_CELULARES_DB` troca o arquivo (testes); a API recusa
  (503) banco com `PRAGMA user_version` diferente de `VERSAO_BANCO` (4),
  com aviso para rodar o aplicar-estrutura.

---

## 11. Ao mexer neste sistema

1. **Rode o sistema e olhe a tela.** Lint não pega realce na coluna
   errada, rodapé fora da tela nem item que some ao reabrir — os três
   bugs mais caros daqui apareceram só ao dirigir o navegador.
2. **Cuidado com scripts de teste que auto-aceitam diálogos.** Um
   `dialog.accept()` apagou uma OS real do usuário. Se for automatizar,
   confirme só o diálogo esperado.
3. **Mudou o banco? Três passos**: (a) mude o `estrutura.sql` (é o banco
   NOVO); (b) crie `dados\migracoes\NNN-o-que-faz.php` que leva a versão
   anterior até ela — coluna com DEFAULT/CHECK novo exige
   `reconstruirTabela()` (SQLite não altera coluna); (c) suba
   `VERSAO_BANCO` em `api/nucleo.php`. O aplicar-estrutura grava a cópia
   em `dados\backups\`, roda os passos que faltam numa
   transação e compara o `sqlite_master` normalizado com um banco novo
   em memória: qualquer diferença (inclusive DEFAULT/CHECK) → nada muda e
   sai com 1. Semente com nome de tabela desconhecido também falha.
   Prova: `testes\migracoes.php` e `testes\migracao-esquema.test.php`.
4. **Receita e saída de estoque se leem das views** (`vw_receitas`,
   `vw_itens_faturados`, `vw_saidas_estoque`). Reescrever o join à mão é
   a volta da dupla contagem.
8. **Rode `testes\rodar.bat` antes de entregar.** Banco novo temporário,
   servidor em porta livre, todas as suítes (PHP, API em Node,
   integridade, front e os roteiros de tela em Playwright); sai ≠ 0 se
   algo falhar. Só diz **TUDO VERDE** quando nada foi pulado: sem
   Playwright, o e2e sai com 77 e o resultado é "VERDE COM ETAPA PULADA
   (e2e)" — a tela não foi testada. Arquivo de teste que falta é falha.
   A saída vai para `testes\saida\`. Domínio novo no
   `DOMINIOS`? O `nucleo.test.php` exige a coluna com o MESMO CHECK. Com
   `INDEX_CELULARES_BANCOS_ANTIGOS=<pasta>` a prova de migração inclui os
   backups reais (copiados; o original nunca é aberto para escrita).
   Mudou regra provada? Ajuste o teste e marque o porquê no próprio caso
   (`ADAPTADO-r3:` na suíte), nunca apague o caso.
5. Dados de teste: `php dados\dados-demonstracao.php criar` / `limpar` —
   tudo marcado `[DEMO]`, o limpar não toca no que é real.
   Banco de homologação: `php dados\homologacao.php <cópia>` (p / p admin,
   regra `sistema.banco_de_teste`, ambiente fiscal em homologação, tudo pelas
   rotas e no histórico; recusa o `dados\index.sqlite` sem `--banco-da-pasta`).
   Só com a regra ligada o `login()` deixa senha fraca entrar sem trocar; a
   API continua recusando senha fraca ao criar, redefinir e trocar.
6. **Peso é requisito, não detalhe.** A máquina da loja não é de
   desenvolvimento e o sistema fica aberto o dia inteiro. Efeito visual
   que custa quadros já foi revertido uma vez (ver seção 13). Antes de
   propor qualquer camada nova de animação, role uma tabela longa e
   troque de aba algumas vezes — se engasgar, não vai.
7. **Confirme que o arquivo mudou mesmo.** Um `echo "ok"` no fim do
   script diz que o script rodou, não que o disco tem a versão nova.
   Confira a data do arquivo depois de gravar.

---

## 12. Decisões revistas

| Antes | Agora | Por quê |
|---|---|---|
| Tabela `estoque` plana | `entradas` com tipo | celular, peça e produto têm campos e regras diferentes |
| API em PHP **e** Node | só PHP | duas implementações da mesma coisa, só uma atualizada |
| `forma_pagamento` texto livre | cadastro com vínculo | "Pix"/"pix"/"PIX" viravam três linhas no relatório |
| OS entregue = receita de serviço | entregue gera **venda** | a peça precisava voltar à prateleira e sair pela venda |
| Cliente digitado na OS | select do cadastro | erro de digitação criava cliente novo |
| Cliente **só** do select | select **ou** cadastro na hora | quem chega com o aparelho na mão obrigava a sair da OS e voltar |
| `garantia_dias` numérico | interruptor + período | passo de centavo virava 89,98 dias |
| Clique fora fechava o modal | trava e avisa | perdia o formulário inteiro sem desfazer |
| Receita de venda toda junta | separada por origem | o lucro da oficina não aparecia em lugar nenhum |
| Excluir OS apagava só a ordem | desfaz a venda junto | peça ficava presa numa venda órfã |
| Lançamento de venda/OS não editável | tudo editável, só não exclui com venda | financeiro é onde se corrige o caixa |
| (acima) tudo editável | valor travado nos gerados; só exclui manual pendente | conta paga sumia sem rastro e venda ficava com outro valor a receber (banca, 28/10) |
| estrutura.sql com IF NOT EXISTS + migrar-*.php soltos | aplicar-estrutura.php único, user_version 3 | banco novo não era igual ao migrado e a migração falhava devolvendo 0 |
| DRE calculado no PHP e na tela | só a série diária vem do PHP; a conta é da tela | a correção feita num lado não chegava no outro |
| admin/admin no LEIA-ME | senha inicial aleatória + troca obrigatória | o LEIA-ME era servido a qualquer um na rede |
| Compra virava conta pendente | nasce paga por padrão | a peça já chega paga na prática |
| Mão de obra digitada na OS | cadastro de **serviços** | mesmo conserto redigitado todo mês, e relatório sem nome de serviço |
| Uma forma de pagamento por OS | **linhas** em os_pagamentos | 50 em dinheiro + 30 no débito viravam um lançamento só, e a conciliação não fechava |
| Situação de peça vinha do campo gravado | vem do **saldo** | peça vendida seguia como "Stock Ready" com saldo zero |
| Redesign 3D (OKLCH, chão em perspectiva, View Transitions) | **revertido** | deixou o sistema pesado e pouco fluido na máquina da loja |
| aplicar-estrutura com lista de colunas novas, user_version 3 | passos numerados em `dados\migracoes\` + comparação estrita do `sqlite_master`, user_version 4 | um DEFAULT/CHECK mudado no estrutura.sql não chegava ao banco migrado e ninguém percebia (banca r2) |
| api.php de ~3.500 linhas | `api.php` só roteia; `nucleo.php` + `rotas\*.php`; `crudCatalogo()` para os cadastros | sete CRUDs copiados divergiam em mensagem e regra |
| Bloqueio de login por login **ou** por IP | só por login (IP só se não for local, limite 30) + aviso de tentativas + destravar | na loja todos usam o mesmo IP: o Caps Lock de um trancava todo mundo |
| Senha: ≥ 8 e diferente do login | letras e números, sem o login, sem repetição; troca obrigatória para usuário criado/redefinido pelo admin | "12345678"/"aaaaaaaa" passavam; o admin sabia a senha de todos |
| IMEI único para sempre | único só enquanto está no estoque; Luhn | a loja não conseguia recomprar o aparelho que vendeu |
| Desconto em venda paga mandava "ir ao Financeiro" | o pago fica; diferença vira receber ou devolução a pagar | o balcão não tem acesso ao Financeiro |
| Primeira forma da lista = padrão | `formas_pagamento.padrao` explícito | reordenar a lista mudava a forma das vendas novas |
| Regra da mão de obra em três lugares (tela, PUT, POST) | `calcularValoresOs()` + `os-regras.js` + tabela de casos | o PUT recalculava diferente da tela e mudava a cobrança ao salvar |
| Join anti-dupla-contagem em cada consulta | `vw_faturamentos`/`vw_receitas` | cada relatório novo era uma chance de contar a OS duas vezes |
| Cópias `.antes-*` dentro de `dados\` | `..\index-celulares-backups\` + `.gitignore` | dados reais iam junto com o projeto |
| Cópias e saída dos testes em pastas irmãs (`..\index-celulares-*`) | `dados\backups\` e `testes\saida\`, as duas no `.gitignore` | o usuário quer uma pasta só por projeto (12/11/2026); o dado real continua todo em `dados\`, que não acompanha o código |
| Senha fraca sempre obriga a trocar no login | exceção só com `sistema.banco_de_teste` ligada, para o p / p do `dados\homologacao.php` | o usuário quer entrar rápido nos bancos de homologação (12/11/2026); na loja a regra fica desligada e o p não existe |
| Desfazer venda sempre devolvia o celular à prateleira | recusado se o IMEI já voltou pela recompra (I17) | o mesmo aparelho virava duas unidades à venda (banca r3, item 1) |
| Qualquer perfil marcava a forma padrão | só o admin | o balcão trocava a forma pré-escolhida da loja inteira |
| Senha do aparelho apagada em entregue/cancelada | também em recusada | o aparelho recusado também já voltou ao cliente |
| A OS em edição decidia em PHP se segurava a peça | pergunta à `vw_saidas_estoque` | mudar a view deixaria o PUT da OS com a regra velha |
| Domínio x CHECK conferidos em 2 de 11, num sentido | os 11, nos dois sentidos, + lados dos motivos | valor novo num lado só vira erro cru ou opção impossível |
| "TUDO VERDE" sem rodar a tela | e2e no rodar; sem Playwright "VERDE COM ETAPA PULADA" | o portão aprovava sem testar a volta do A1 na tela |

---

## 13. O redesign que não ficou  *(25/08/2026)*

Em 24/08 o visual foi refeito: paleta em OKLCH, chão em perspectiva
animado, cards inclinando com o ponteiro, troca de tela com View
Transitions, entrada por `animation-timeline: view()`. **Foi revertido no
mesmo dia**: ficou pesado e pouco fluido na máquina da loja.

Fica registrado porque a tentação de refazer é grande — o código era
moderno e passava em todo teste que eu tinha. O que ele não passava era
no critério que importa aqui: **a tela responde na hora?**

O que aprendi, e vale para qualquer proposta visual futura:

- **Fluidez ganha de efeito.** Isto é uma ferramenta de bancada, usada o
  dia inteiro. Um efeito que custa quadros atrapalha o trabalho todo dia
  para impressionar uma vez.
- Os vilões prováveis, em ordem: `backdrop-filter` na barra e no menu
  (desfoca a página inteira a cada rolagem), o chão animado de 190vh
  girado em 3D, e `preserve-3d` em todos os painéis — que tira cada um
  deles da pintura plana. Nenhum foi medido com o profiler; se um dia
  alguém tentar de novo, **meça antes de defender**.
- Testei em telas de 1500, 1366 e 1180px e olhei o resultado, mas nunca
  medi **quadros por segundo** nem rolei uma tabela longa. Bonito em
  print não é o mesmo que leve em uso.

**Uma coisa do redesign continua valendo e não foi aplicada:** o
validador reprova a paleta atual no critério de *todos os pares* — CVD
ΔE 1,6 e piso de visão normal 10,6, abaixo do mínimo de 15. Na prática,
nas roscas há duas fatias que ninguém distingue. A legenda traz rótulo,
valor e percentual escritos, que é o que segura a leitura hoje. Se um dia
for corrigido, que seja **só a troca dos cinco hexadecimais** — sem
nenhuma camada nova de efeito junto.
