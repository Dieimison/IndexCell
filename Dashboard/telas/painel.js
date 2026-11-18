// carga: usa Formato, Dre, Graficos, Nucleo; publica Telas.painel  (conferido por testes/front/carga.test.js)
/*
 * telas/painel.js - a secao Dashboard: relatorios do periodo (so quem ve
 * o financeiro) e a operacao do dia (estoque e oficina). Window.Telas.painel.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, porcento, dataCurta, hoje, somarMeses, somarEmCentavos } = janela.Formato;
    const { agregarPeriodo, totalizar, granularidadeDe } = janela.Dre;
    const Graficos = janela.Graficos;
    const { api, estado, rotuloDe, corDe, etiqueta, vazio, cardSimples, classeSaldo, registrarTela } = janela.Nucleo;

    // ==================================================================
    // Operacao do dia: cards do estoque, OS e tabelas
    // ==================================================================
    async function carregarDashboard() {
        /* Relatório (receita, custo, lucro) só para quem vê o financeiro. Os
           outros perfis veem a operação do dia: estoque e oficina. */
        const veFinanceiro = estado.config.pode_ver_financeiro;
        const [resumo, entradas, relatorio] = await Promise.all([
            api.get('/resumo'), api.get('/entradas'),
            veFinanceiro ? api.get('/relatorios') : Promise.resolve(null),
        ]);
        estado.entradas = entradas.itens;
        estado.relatorio = relatorio;

        if (relatorio) desenharRelatorios(relatorio);

        /* Os quatro cards vem prontos do servidor (/api/resumo: so celular,
           com saldo, por situacao). A tela nao recalcula. */
        const cards = resumo.cards || {};
        preencherCard('cardReady', cards.ready);
        preencherCard('cardProc', cards.processamento);
        preencherCard('cardCheck', cards.check);
        preencherCard('cardTotal', cards.total);

        // Proximo celular em processamento
        const destaque = document.getElementById('proximoProcessamento');
        if (resumo.proximo) {
            destaque.innerHTML =
                '<p class="destaque-modelo">' + escapar(resumo.proximo.modelo) + '</p>' +
                '<p class="destaque-info">' +
                (resumo.proximo.valor_investimento !== undefined
                    ? 'Investido: ' + moeda(resumo.proximo.valor_investimento) + ' &bull; ' : '') +
                'Previsto de venda: ' + moeda(resumo.proximo.valor_venda) +
                ' &bull; Entrada: ' + dataCurta(resumo.proximo.data_entrada) + '</p>' +
                (resumo.proximo.observacoes ? '<p class="destaque-info">' + escapar(resumo.proximo.observacoes) + '</p>' : '');
        } else if (resumo.proxima_os) {
            destaque.innerHTML =
                '<p class="destaque-modelo">' + escapar(resumo.proxima_os.aparelho || 'Aparelho') + ' — ' +
                escapar(resumo.proxima_os.cliente) + '</p>' +
                '<p class="destaque-info">' + escapar(resumo.proxima_os.numero || '') + ' &bull; ' +
                escapar(rotuloDe('status_os', resumo.proxima_os.status)) + ' &bull; Previsão: ' +
                dataCurta(resumo.proxima_os.data_previsao) + '</p>';
        } else {
            destaque.innerHTML = vazio('Não há celulares em processamento no momento.');
        }

        // Cards das ordens de servico; "em andamento" vem contado do servidor.
        const os = resumo.os || {};
        document.getElementById('cardsOs').innerHTML =
            cardSimples('OS em andamento', resumo.os_em_andamento || 0, '--serie-1') +
            cardSimples('Prontas para entrega', os.pronta || 0, '--serie-3') +
            cardSimples('Em reparo', os.em_reparo || 0, '--serie-2') +
            cardSimples('Entregues', os.entregue || 0, '--tinta-fraca');

        // Tabelas: as tres situacoes dos celulares, mais o que esta acabando
        const grade = document.getElementById('tabelasEstoque');
        grade.innerHTML = ['ready', 'processamento', 'check']
            .map(function (situacao) {
                return tabelaSituacao(situacao, estado.entradas.filter(function (i) {
                    return i.tipo === 'celular' && i.situacao === situacao && i.saldo > 0;
                }));
            })
            .join('') + tabelaReposicao() + (veFinanceiro ? tabelaAlocado() : '');
    }

    /*
     * O que saiu da prateleira mas ainda está dentro de uma OS em
     * andamento. Enquanto o conserto não é entregue, essa peça não aparece
     * no saldo nem virou receita — e some do painel sem explicação.
     *
     * É a primeira pergunta de quem confere o estoque no fim do mês: "onde
     * está a tela que eu comprei?". Está aqui.
     */
    function tabelaAlocado() {
        const itens = (estado.relatorio && estado.relatorio.alocado) || [];

        const linhas = itens.length
            ? itens.map(function (i) {
                return '<tr><td>' + escapar(i.descricao) +
                       '<br><small class="observacao">' + escapar(i.numeros || '') + '</small></td>' +
                       '<td class="numero">' + i.unidades + '</td>' +
                       '<td class="numero">' + moeda(i.custo) + '</td></tr>';
            }).join('') +
              '<tr class="linha-total"><td><strong>TOTAL</strong></td>' +
              '<td class="numero"><strong>' +
                  itens.reduce(function (s, i) { return s + i.unidades; }, 0) + '</strong></td>' +
              '<td class="numero"><strong>' +
                  moeda(somarEmCentavos(itens, function (i) { return i.custo; })) + '</strong></td></tr>'
            : '<tr class="empty-row"><td colspan="3">Nenhuma peça presa em ordem aberta.</td></tr>';

        return '<div class="table-section">' +
               '  <h3 class="table-title"><span style="background:var(--serie-2)"></span>Dentro de OS abertas' +
               '    <small class="observacao" style="margin-left:auto;font-weight:400">já saiu do estoque</small></h3>' +
               '  <table><thead><tr><th>Item</th><th class="numero">Un.</th><th class="numero">Custo</th></tr></thead>' +
               '  <tbody>' + linhas + '</tbody></table>' +
               '</div>';
    }

    // ------------------------------------------------------------------
    // Relatorios do painel
    // ------------------------------------------------------------------
    /*
     * Sao nove leituras do mesmo banco, em ordem de "o que o dono pergunta
     * primeiro":
     *
     *   1. os quatro numeros do periodo (KPIs)
     *   2. receita x custo x despesas, mes a mes  -> onde o dinheiro entra e sai
     *   3. lucro liquido por mes                  -> o mes fechou no azul?
     *   4. margem liquida                         -> sobra quanto de cada R$ 100
     *   5. caixa                                  -> o que entrou e saiu de verdade
     *   6. composicao da receita                  -> balcao ou oficina
     *   7. ranking de itens                       -> o que da dinheiro
     *   8. contas a vencer                        -> o que exige acao esta semana
     *   9. quadro mes a mes                       -> a tabela, para conferir numero
     *
     * CADA UM TEM O SEU FILTRO, e eles sao independentes: da para deixar a
     * receita em 12 meses e o ranking em 3 ao mesmo tempo.
     *
     * Os filtros trabalham SOBRE OS DADOS JA CARREGADOS, sem voltar ao
     * servidor. A API manda os 12 meses e a lista inteira de itens de uma vez
     * (uns poucos KB); cortar isso no navegador e instantaneo, enquanto uma
     * requisicao por clique deixaria o painel travando a cada troca.
     */
    const FILTROS_PADRAO = {
        kpis: '12',
        kpisOrigem: '',
        resultado: '12',
        resultadoOrigem: '',
        lucro: '12',
        lucroOrigem: '',
        margem: '12',
        margemOrigem: '',
        caixa: '12',
        composicao: '12',
        rankingPeriodo: '12',
        rankingTipo: '',
        rankingOrdem: 'receita',
        rankingOrigem: '',
        vencendoPrazo: '30',
        vencendoTipo: '',
        dre: '12',
        dreOrigem: '',
        pagamentos: '12',
        pagamentosOrigem: '',
        despesas: '12',
        estoquePizza: 'tudo',
    };

    /*
     * De onde veio o dinheiro. A oficina fatura por dois caminhos - a OS
     * antiga, que virava receita de serviço direto, e a venda gerada pela OS
     * entregue - e os dois contam como "ordens de serviço" aqui.
     */
    const ORIGENS = [
        { valor: '', rotulo: 'Vendas e OS' },
        { valor: 'balcao', rotulo: 'Só vendas de balcão' },
        { valor: 'os', rotulo: 'Só ordens de serviço' },
    ];

    estado.filtros = Object.assign({}, FILTROS_PADRAO);

    /*
     * Quando o filtro de um relatorio esta em "datas", o intervalo escolhido
     * fica aqui - um par por relatorio, porque eles sao independentes.
     */
    estado.datas = {};

    const PERIODOS = [
        { valor: '3', rotulo: 'Últimos 3 meses' },
        { valor: '6', rotulo: 'Últimos 6 meses' },
        { valor: '12', rotulo: 'Últimos 12 meses' },
        { valor: 'datas', rotulo: 'Escolher datas…' },
    ];

    // ------------------------------------------------------------------
    // Periodo de cada relatorio (as contas de data e do DRE: formato.js e dre.js)
    // ------------------------------------------------------------------
    /** O intervalo que um relatório está mostrando, seja preset ou escolhido. */
    function intervaloDe(nome) {
        const valor = estado.filtros[nome];
        const fim = (estado.relatorio && estado.relatorio.ate) || hoje();

        if (valor === 'datas') {
            const d = estado.datas[nome] || {};
            // Enquanto o par nao estiver completo, segue valendo o padrao de
            // 12 meses - a tela nao pode ficar vazia entre um clique e outro.
            if (d.de && d.ate && d.de <= d.ate) {
                return { de: d.de, ate: d.ate };
            }
            return { de: somarMeses(fim.substring(0, 8) + '01', -11), ate: fim };
        }

        const meses = Number(valor) || 12;
        return { de: somarMeses(fim.substring(0, 8) + '01', -(meses - 1)), ate: fim };
    }

    /** A série que um relatório deve desenhar, já agregada e filtrada. */
    function serieDe(nome) {
        const i = intervaloDe(nome);
        return agregarPeriodo(estado.relatorio && estado.relatorio.diario, i.de, i.ate,
                              estado.filtros[nome + 'Origem'] || '');
    }

    /** Rótulo do lucro conforme a origem: com despesas é líquido, sem é bruto. */
    function rotuloLucro(nome) {
        return estado.filtros[nome + 'Origem'] ? 'Lucro bruto' : 'Lucro líquido';
    }

    const UNIDADE = { dia: 'por dia', semana: 'por semana', mes: 'por mês' };

    const UNIDADE_SINGULAR = { dia: 'um dia', semana: 'uma semana', mes: 'um mês' };

    /*
     * Deixa o titulo e a nota do painel de acordo com a granularidade. Um
     * grafico que virou diario nao pode continuar dizendo "por mes" no topo,
     * nem pedir para "passar o mouse em um mes".
     */
    function ajustarTituloDoGrafico(idTopo, nomeFiltro, base, notaDoMouse) {
        const topo = document.getElementById(idTopo);
        if (!topo) return;

        const i = intervaloDe(nomeFiltro);
        const g = granularidadeDe(i.de, i.ate);

        const titulo = topo.querySelector('.grafico-titulo');
        if (titulo && base) titulo.textContent = base + ' ' + UNIDADE[g];

        /* A nota so e reescrita onde ela existe para dizer "passe o mouse".
           Nos outros paineis ela explica a conta ("Quanto sobra de cada R$ 100
           vendidos"), e trocar isso por uma instrucao de mouse perderia a
           unica linha que explica o grafico. */
        if (notaDoMouse) {
            const nota = topo.querySelector('.grafico-nota');
            if (nota) nota.textContent = 'Passe o mouse em ' + UNIDADE_SINGULAR[g] + ' para ver os valores.';
        }
    }

    /*
     * Qual bloco redesenhar quando cada filtro muda. Sem este mapa, trocar o
     * periodo do ranking redesenharia os nove relatorios - funcionaria, mas
     * piscaria a tela inteira por causa de um select.
     *
     * "resultado" e o unico que mexe em dois: os quatro numeros do topo saem
     * do mesmo periodo do grafico principal.
     */
    const AO_FILTRAR = {
        kpis: function () { desenharKpis(); },
        kpisOrigem: function () { desenharKpis(); },
        resultadoOrigem: function () { desenharGraficoResultado(); },
        lucroOrigem: function () { desenharGraficoLucro(); },
        margemOrigem: function () { desenharGraficoMargem(); },
        dreOrigem: function () { desenharDre(); },
        rankingOrigem: function () { desenharRanking(); },
        resultado: function () { desenharGraficoResultado(); },
        lucro: function () { desenharGraficoLucro(); },
        margem: function () { desenharGraficoMargem(); },
        caixa: function () { desenharGraficoCaixa(); },
        composicao: function () { desenharComposicao(); },
        rankingPeriodo: function () { desenharRanking(); },
        rankingTipo: function () { desenharRanking(); },
        rankingOrdem: function () { desenharRanking(); },
        vencendoPrazo: function () { desenharVencendo(); },
        vencendoTipo: function () { desenharVencendo(); },
        dre: function () { desenharDre(); },
        pagamentos: function () { desenharPagamentos(); },
        pagamentosOrigem: function () { desenharPagamentos(); },
        despesas: function () { desenharDespesas(); },
        estoquePizza: function () { desenharEstoquePizza(); },
    };

    document.addEventListener('change', function (evento) {
        if (!estado.relatorio) return;

        const select = evento.target.closest('.filtro-grafico');
        if (select) {
            const nome = select.dataset.filtro;
            estado.filtros[nome] = select.value;

            /* Ao entrar em "datas" pela primeira vez, os dois campos ja nascem
               com o intervalo que estava sendo mostrado. Começar com os campos
               vazios obrigaria a preencher os dois antes de ver qualquer
               coisa, e a tela piscaria vazia no meio do caminho. */
            if (select.value === 'datas' && !estado.datas[nome]) {
                estado.datas[nome] = intervaloDe(nome);
            }
            if (AO_FILTRAR[nome]) AO_FILTRAR[nome]();
            return;
        }

        const campo = evento.target.closest('.filtro-data');
        if (!campo) return;

        const nome = campo.dataset.data;
        const par = estado.datas[nome] || (estado.datas[nome] = intervaloDe(nome));
        par[campo.dataset.ponta] = campo.value;

        // Datas invertidas: em vez de recusar, arrasta a outra ponta junto -
        // e o que a pessoa quis dizer, e evita um estado de erro na tela.
        if (par.de && par.ate && par.de > par.ate) {
            if (campo.dataset.ponta === 'de') par.ate = par.de;
            else par.de = par.ate;
        }
        if (AO_FILTRAR[nome]) AO_FILTRAR[nome]();
    });

    /*
     * Os dois campos de data que aparecem quando o filtro esta em "datas".
     * Ficam escondidos no resto do tempo: dois seletores de data em cada um
     * dos nove paineis, sempre visiveis, seriam dezoito controles competindo
     * com os numeros.
     */
    function camposDeDataHtml(nome) {
        if (estado.filtros[nome] !== 'datas') return '';

        const i = intervaloDe(nome);
        const d = estado.datas[nome] || {};
        const limite = (estado.relatorio && estado.relatorio.ate) || '';

        return '<input type="date" class="filtro-data" data-data="' + nome + '" data-ponta="de"' +
               ' value="' + escapar(d.de || i.de) + '" max="' + escapar(limite) + '" title="Data inicial">' +
               '<span class="filtro-ate">até</span>' +
               '<input type="date" class="filtro-data" data-data="' + nome + '" data-ponta="ate"' +
               ' value="' + escapar(d.ate || i.ate) + '" max="' + escapar(limite) + '" title="Data final">';
    }


    /*
     * Monta um <select> de filtro. O "ativo" marca visualmente quando o valor
     * saiu do padrao - senao alguem le um grafico de 3 meses achando que esta
     * vendo o ano inteiro.
     */
    function filtroHtml(nome, opcoes, titulo) {
        const valor = estado.filtros[nome];
        const mudou = valor !== FILTROS_PADRAO[nome];
        return '<select class="filtro-grafico' + (mudou ? ' ativo' : '') + '" data-filtro="' + nome + '"' +
               (titulo ? ' title="' + escapar(titulo) + '"' : '') + '>' +
            opcoes.map(function (o) {
                return '<option value="' + escapar(o.valor) + '"' +
                       (String(o.valor) === String(valor) ? ' selected' : '') + '>' +
                       escapar(o.rotulo) + '</option>';
            }).join('') + '</select>';
    }

    /** Põe os filtros no cabeçalho de um painel, sem redesenhar o resto. */
    function montarFiltros(idPainel, html) {
        const painel = document.getElementById(idPainel);
        if (!painel) return;
        let caixa = painel.querySelector('.filtros-painel');
        if (!caixa) {
            caixa = document.createElement('div');
            caixa.className = 'filtros-painel';
            painel.appendChild(caixa);
        }
        caixa.innerHTML = html;
    }

    function desenharRelatorios(dados) {
        if (dados) estado.relatorio = dados;
        desenharKpis();
        desenharGraficoResultado();
        desenharGraficoLucro();
        desenharGraficoMargem();
        desenharGraficoCaixa();
        desenharComposicao();
        desenharRanking();
        desenharPagamentos();
        desenharDespesas();
        desenharEstoquePizza();
        desenharVencendo();
        desenharDre();
    }

    /*
     * As três roscas. Todas respondem "quanto do bolo cada um pegou" — o uso
     * em que o círculo funciona. Para comparar valores próximos ela é ruim,
     * e por isso a legenda traz valor e percentual escritos ao lado.
     *
     * Cada uma tem o seu filtro, como os outros painéis. A API manda uma
     * linha por DIA; o recorte é feito aqui, sem nova ida ao servidor, e
     * por isso trocar o período é instantâneo.
     */

    /** Soma as linhas diárias dentro da janela do filtro, agrupando por chave. */
    function somarNoPeriodo(linhas, janela, chave, campo, passa) {
        const soma = {};
        (linhas || []).forEach(function (l) {
            if (janela && (l.dia < janela.de || l.dia > janela.ate)) return;
            if (passa && !passa(l)) return;
            soma[l[chave]] = (soma[l[chave]] || 0) + l[campo];
        });
        return soma;
    }

    function desenharPagamentos() {
        montarFiltros('topoPagamentos',
            filtroHtml('pagamentosOrigem', ORIGENS, 'De onde veio o dinheiro') +
            filtroHtml('pagamentos', PERIODOS) + camposDeDataHtml('pagamentos'));

        const origem = estado.filtros.pagamentosOrigem;
        const soma = somarNoPeriodo(
            estado.relatorio.pagamentos, intervaloDe('pagamentos'), 'forma', 'total',
            function (l) {
                /* A venda gerada por uma OS entregue chega marcada como 'os';
                   a de balcão, como 'venda'. */
                if (origem === 'balcao') return l.origem === 'venda';
                if (origem === 'os') return l.origem === 'os';
                return true;
            });

        Graficos.rosca(document.getElementById('graficoPagamentos'), {
            rotuloTotal: 'faturado',
            partes: Object.keys(soma).map(function (k) { return { rotulo: k, valor: soma[k] }; }),
            vazio: 'Nenhuma venda no período.',
        });
    }

    function desenharDespesas() {
        montarFiltros('topoDespesas',
            filtroHtml('despesas', PERIODOS) + camposDeDataHtml('despesas'));

        const soma = somarNoPeriodo(
            estado.relatorio.despesas_categoria, intervaloDe('despesas'), 'categoria', 'total');

        Graficos.rosca(document.getElementById('graficoDespesas'), {
            rotuloTotal: 'a pagar',
            partes: Object.keys(soma).map(function (k) { return { rotulo: k, valor: soma[k] }; }),
            vazio: 'Nenhuma conta a pagar no período.',
        });
    }

    /* "Celular" + "s" dava "Celulars", e "Peça" + "s" daria "Peças" por
       acaso. Plural em português não se resolve concatenando letra. */

    const PLURAL_TIPO = { celular: 'Celulares', peca: 'Peças', produto: 'Produtos' };

    /*
     * Aqui o período recorta pela data da ENTRADA, não da venda: a pergunta é
     * "desse dinheiro parado, quanto entrou quando". Por isso o padrão é
     * "Qualquer entrada" - com um recorte de 12 meses por padrão, uma peça
     * comprada há dois anos e nunca vendida sumiria do painel, e é exatamente
     * ela que precisa aparecer.
     */
    const PERIODOS_ESTOQUE = [{ valor: 'tudo', rotulo: 'Qualquer entrada' }].concat(PERIODOS);

    function desenharEstoquePizza() {
        montarFiltros('topoEstoquePizza',
            filtroHtml('estoquePizza', PERIODOS_ESTOQUE, 'Quando a peça entrou') +
            camposDeDataHtml('estoquePizza'));

        const janela = estado.filtros.estoquePizza === 'tudo' ? null : intervaloDe('estoquePizza');
        const soma = somarNoPeriodo(estado.relatorio.estoque, janela, 'tipo', 'investido');

        Graficos.rosca(document.getElementById('graficoEstoquePizza'), {
            rotuloTotal: 'investido',
            partes: Object.keys(soma).map(function (t) {
                return {
                    rotulo: PLURAL_TIPO[t] || t,
                    valor: soma[t],
                    cor: Graficos.cor(corDe('tipos_entrada', t)),
                };
            }),
            vazio: 'Nada parado no estoque.',
        });
    }

    // ---- 1. KPIs ----
    function desenharKpis() {
        montarFiltros('topoKpis', filtroHtml('kpisOrigem', ORIGENS, 'De onde veio o dinheiro') +
                              filtroHtml('kpis', PERIODOS) + camposDeDataHtml('kpis'));

        const meses = serieDe('kpis');
        const t = totalizar(meses);

        /* O titulo acompanha o filtro: com "3 meses" escolhido, deixar
           "Resultado dos ultimos 12 meses" escrito em cima seria mentira. Com
           datas escolhidas a mao, ele mostra o intervalo - dizer "ultimos
           datas meses" seria pior ainda. */
        const titulo = document.getElementById('tituloPeriodo');
        if (titulo) {
            /* Com "Escolher datas" ligado, os dois campos ao lado ja mostram o
               intervalo. Repeti-lo por extenso no titulo era a mesma
               informacao duas vezes na mesma linha. */
            const fonte = { balcao: ' — vendas de balcão', os: ' — ordens de serviço' }[estado.filtros.kpisOrigem] || '';
            titulo.textContent = (estado.filtros.kpis === 'datas'
                ? 'Resultado do período'
                : 'Resultado dos últimos ' + estado.filtros.kpis + ' meses') + fonte;
        }

        /* Compara os dois ultimos periodos FECHADOS: o periodo corrente esta
           pela metade, e mede-lo contra um inteiro mostraria uma queda que
           nao existe. A unidade da comparacao segue a granularidade - com o
           filtro em dias, "vs. mes anterior" seria simplesmente falso. */
        const i = intervaloDe('kpis');
        const unidade = { dia: 'vs. dia anterior', semana: 'vs. semana anterior', mes: 'vs. mês anterior' };
        const fechados = meses.slice(0, -1);
        const ultimo = fechados[fechados.length - 1];
        const penultimo = fechados[fechados.length - 2];

        document.getElementById('kpisRelatorio').innerHTML =
            kpi('Receita no período', moeda(t.receita), '--serie-1',
                variacao(ultimo && ultimo.receita, penultimo && penultimo.receita,
                         unidade[granularidadeDe(i.de, i.ate)])) +
            kpi('Custo dos itens', moeda(t.custo), '--serie-2',
                t.receita > 0 ? porcento(t.custo / t.receita * 100) + ' da receita' : '—') +
            /* Filtrado por origem não há despesa a atribuir, então o card
               deixa de falar em despesa e mostra de onde vem a receita. */
            (estado.filtros.kpisOrigem
                ? kpi(estado.filtros.kpisOrigem === 'os' ? 'Ordens de serviço' : 'Vendas de balcão',
                      t.quantidade, '--serie-4', 'no período')
                : kpi('Despesas', moeda(t.despesas), '--serie-4',
                      t.receita > 0 ? porcento(t.despesas / t.receita * 100) + ' da receita' : '—')) +
            kpi(rotuloLucro('kpis'), moeda(t.lucro_liquido),
                t.lucro_liquido >= 0 ? '--serie-3' : '--critico',
                'margem de ' + porcento(t.margem) + ' • ticket ' + moeda(t.ticket_medio),
                t.receita > 0 ? Math.max(0, Math.min(100, t.lucro_liquido / t.receita * 100)) : 0);
    }

    // ---- 2. receita x custo x despesas ----
    function desenharGraficoResultado() {
        montarFiltros('topoResultado', filtroHtml('resultadoOrigem', ORIGENS, 'De onde veio o dinheiro') +
                              filtroHtml('resultado', PERIODOS) + camposDeDataHtml('resultado'));
        ajustarTituloDoGrafico('topoResultado', 'resultado', 'Receita, custo e despesas', true);

        const comDespesa = !estado.filtros.resultadoOrigem;
        const series = [
            { rotulo: 'Receita', cor: Graficos.cor('--serie-1') },
            { rotulo: 'Custo dos itens', cor: Graficos.cor('--serie-2') },
        ];
        if (comDespesa) series.push({ rotulo: 'Despesas', cor: Graficos.cor('--serie-4') });

        Graficos.barras(document.getElementById('graficoResultado'), {
            series: series,
            dados: serieDe('resultado').map(function (m) {
                return {
                    rotulo: m.rotulo,
                    valores: comDespesa ? [m.receita, m.custo, m.despesas] : [m.receita, m.custo],
                    extras: [{ rotulo: rotuloLucro('resultado'), valor: moeda(m.lucro_liquido),
                               destaque: m.lucro_liquido >= 0 ? Graficos.cor('--serie-3') : Graficos.cor('--critico') }],
                };
            }),
            vazio: 'Nenhuma venda ou OS entregue neste período.',
        });
    }

    // ---- 3. lucro liquido ----
    /* Aqui a cor SIGNIFICA alguma coisa (mes no azul ou no vermelho), e nao
       identidade de serie. O sinal tambem esta no lado do zero em que a barra
       fica, entao a cor so reforca - nao carrega a informacao sozinha. */

    function desenharGraficoLucro() {
        montarFiltros('topoLucro', filtroHtml('lucroOrigem', ORIGENS, 'De onde veio o dinheiro') +
                              filtroHtml('lucro', PERIODOS) + camposDeDataHtml('lucro'));
        ajustarTituloDoGrafico('topoLucro', 'lucro', rotuloLucro('lucro'));

        Graficos.barras(document.getElementById('graficoLucro'), {
            series: [{ rotulo: rotuloLucro('lucro'), cor: Graficos.cor('--serie-3') }],
            corPorSinal: true,
            rotularUltimo: true,
            dados: serieDe('lucro').map(function (m) {
                return {
                    rotulo: m.rotulo,
                    valores: [m.lucro_liquido],
                    extras: [
                        { rotulo: 'Receita', valor: moeda(m.receita) },
                        { rotulo: 'Margem', valor: porcento(m.margem) },
                    ],
                };
            }),
            vazio: 'Sem resultado para mostrar neste período.',
        });
    }

    // ---- 4. margem ----
    function desenharGraficoMargem() {
        montarFiltros('topoMargem', filtroHtml('margemOrigem', ORIGENS, 'De onde veio o dinheiro') +
                              filtroHtml('margem', PERIODOS) + camposDeDataHtml('margem'));
        ajustarTituloDoGrafico('topoMargem', 'margem', null);

        Graficos.linha(document.getElementById('graficoMargem'), {
            series: [{ rotulo: 'Margem líquida', cor: Graficos.cor('--serie-3') }],
            tipo: 'porcento',
            dados: serieDe('margem').map(function (m) {
                return {
                    rotulo: m.rotulo,
                    valores: [m.margem],
                    extras: [{ rotulo: 'Lucro líquido', valor: moeda(m.lucro_liquido) }],
                };
            }),
            vazio: 'Sem margem para calcular neste período.',
        });
    }

    // ---- 5. caixa ----
    function desenharGraficoCaixa() {
        montarFiltros('topoCaixa', filtroHtml('caixa', PERIODOS) + camposDeDataHtml('caixa'));
        ajustarTituloDoGrafico('topoCaixa', 'caixa', null);

        Graficos.barras(document.getElementById('graficoCaixa'), {
            series: [
                { rotulo: 'Recebido', cor: Graficos.cor('--serie-3') },
                { rotulo: 'Pago', cor: Graficos.cor('--serie-2') },
            ],
            dados: serieDe('caixa').map(function (m) {
                return {
                    rotulo: m.rotulo,
                    valores: [m.recebido, m.pago],
                    extras: [{ rotulo: 'Saldo do mês', valor: moeda(m.caixa),
                               destaque: m.caixa >= 0 ? Graficos.cor('--serie-3') : Graficos.cor('--critico') }],
                };
            }),
            vazio: 'Nenhuma baixa registrada neste período.',
        });
    }

    // ---- 6. composicao da receita ----
    function desenharComposicao() {
        montarFiltros('topoComposicao', filtroHtml('composicao', PERIODOS) + camposDeDataHtml('composicao'));

        const meses = serieDe('composicao');
        const vendas = somarEmCentavos(meses, function (m) { return m.receita_vendas; });
        const os = somarEmCentavos(meses, function (m) { return m.receita_os; });

        Graficos.proporcao(document.getElementById('graficoComposicao'), {
            partes: [
                { rotulo: 'Vendas de balcão', valor: vendas, cor: Graficos.cor('--serie-1') },
                { rotulo: 'Ordens de serviço', valor: os, cor: Graficos.cor('--serie-4') },
            ],
            vazio: 'Nenhuma receita neste período.',
        });
    }

    // ---- 7. ranking de itens ----
    /*
     * Tres filtros aqui, porque sao tres perguntas diferentes sobre a mesma
     * lista: "o que rendeu mais nos ultimos 3 meses?", "e so entre as pecas?",
     * "e se eu ordenar por lucro em vez de faturamento?".
     */
    function desenharRanking() {
        montarFiltros('topoRanking',
            filtroHtml('rankingOrigem', ORIGENS, 'De onde veio o dinheiro') +
            filtroHtml('rankingPeriodo', PERIODOS) +
            camposDeDataHtml('rankingPeriodo') +
            filtroHtml('rankingTipo', [
                { valor: '', rotulo: 'Todos os itens' },
                { valor: 'celular', rotulo: 'Só celulares' },
                { valor: 'peca', rotulo: 'Só peças' },
                { valor: 'produto', rotulo: 'Só produtos' },
            ], 'Tipo de item') +
            filtroHtml('rankingOrdem', [
                { valor: 'receita', rotulo: 'Por faturamento' },
                { valor: 'lucro', rotulo: 'Por lucro' },
                { valor: 'unidades', rotulo: 'Por quantidade' },
            ], 'Critério de ordenação'));

        const janela = intervaloDe('rankingPeriodo');
        const tipo = estado.filtros.rankingTipo;
        const ordem = estado.filtros.rankingOrdem;

        // A API manda uma linha por item POR DIA; aqui elas viram uma linha
        // por item, somando só os dias dentro do intervalo escolhido.
        const origem = estado.filtros.rankingOrigem;

        const somado = {};
        (estado.relatorio.itens || []).forEach(function (i) {
            if (i.dia < janela.de || i.dia > janela.ate) return;
            if (tipo && i.tipo !== tipo) return;
            /* A API marca cada linha com a origem: 'venda' para o balcão e
               'os' para o que saiu num conserto. A venda gerada por uma OS
               entregue chega aqui já como 'os'. */
            if (origem === 'balcao' && i.origem !== 'venda') return;
            if (origem === 'os' && i.origem !== 'os') return;

            const chave = i.descricao;
            somado[chave] = somado[chave] || { descricao: i.descricao, receita: 0, lucro: 0, unidades: 0 };
            somado[chave].receita += i.receita;
            somado[chave].lucro += i.lucro;
            somado[chave].unidades += i.unidades;
        });

        const lista = Object.keys(somado).map(function (k) { return somado[k]; })
            .sort(function (a, b) { return b[ordem] - a[ordem]; })
            .slice(0, 8);

        Graficos.ranking(document.getElementById('rankingItens'), {
            itens: lista.map(function (i) {
                // A barra mede o criterio escolhido; o texto mostra os tres,
                // senao trocar a ordenacao mudaria a barra sem explicar por que.
                return {
                    rotulo: i.descricao,
                    valor: Math.max(0, i[ordem]),
                    texto: ordem === 'unidades'
                        ? i.unidades + ' un  ·  ' + moeda(i.receita)
                        : moeda(i[ordem]) + '  ·  ' + i.unidades + ' un',
                };
            }),
            cor: ordem === 'lucro' ? Graficos.cor('--serie-3') : Graficos.cor('--serie-1'),
            vazio: tipo ? 'Nenhum item deste tipo saiu no período.' : 'Nenhum item vendido no período.',
        });
    }

    function kpi(rotulo, valor, cor, nota, barra) {
        return '<div class="kpi">' +
            '<i class="kpi-faixa" style="background:var(' + cor + ')"></i>' +
            '<div class="kpi-rotulo">' + escapar(rotulo) + '</div>' +
            '<div class="kpi-valor">' + escapar(valor) + '</div>' +
            '<div class="kpi-nota">' + (nota || '') + '</div>' +
            (barra === undefined ? '' :
                '<div class="barra-mini"><i style="width:' + barra.toFixed(1) + '%;background:var(' + cor + ')"></i></div>') +
            '</div>';
    }

    /*
     * A variacao vem com SETA e SINAL, nunca so com a cor: quem nao
     * distingue verde de vermelho continua lendo a direcao.
     */
    function variacao(atual, anterior, sufixo) {
        if (!anterior || anterior === 0 || atual === undefined || atual === null) {
            return escapar(sufixo || '');
        }
        const pct = (atual - anterior) / Math.abs(anterior) * 100;
        const sobe = pct >= 0;
        return '<span class="' + (sobe ? 'delta-sobe' : 'delta-desce') + '">' +
               (sobe ? '↑' : '↓') + ' ' + porcento(Math.abs(pct)) + '</span> ' + escapar(sufixo || '');
    }

    // ---- 8. contas a vencer ----
    function desenharVencendo() {
        montarFiltros('topoVencendo',
            filtroHtml('vencendoPrazo', [
                { valor: '7', rotulo: 'Próximos 7 dias' },
                { valor: '15', rotulo: 'Próximos 15 dias' },
                { valor: '30', rotulo: 'Próximos 30 dias' },
                { valor: '60', rotulo: 'Próximos 60 dias' },
                // O ultimo prazo e a janela que o servidor manda (config.janela_vencimentos).
                { valor: String(estado.config.janela_vencimentos),
                  rotulo: 'Próximos ' + estado.config.janela_vencimentos + ' dias' },
            ]) +
            filtroHtml('vencendoTipo', [
                { valor: '', rotulo: 'Receber e pagar' },
                { valor: 'receber', rotulo: 'Só a receber' },
                { valor: 'pagar', rotulo: 'Só a pagar' },
            ], 'Tipo de conta'));

        const prazo = Number(estado.filtros.vencendoPrazo);
        const tipo = estado.filtros.vencendoTipo;

        // O que ja venceu (dias negativo) entra em qualquer prazo: e
        // justamente o que nao pode sumir de vista por causa de um filtro.
        const contas = (estado.relatorio.vencendo || []).filter(function (c) {
            if (tipo && c.tipo !== tipo) return false;
            return c.dias <= prazo;
        }).slice(0, 12);

        const alvo = document.getElementById('listaVencendo');
        if (!contas.length) {
            alvo.innerHTML = vazio(tipo
                ? 'Nada a ' + tipo + ' vencendo nos próximos ' + prazo + ' dias.'
                : 'Nada vencendo nos próximos ' + prazo + ' dias.');
            return;
        }

        alvo.innerHTML =
            '<div class="rolagem-x"><table><thead><tr><th>Conta</th><th>Tipo</th><th>Vence</th>' +
            '<th class="numero">Valor</th></tr></thead><tbody>' +
            contas.map(function (c) {
                // "vencido" e "hoje" precisam saltar: sao os que exigem acao agora.
                const rotuloDia = c.dias < 0 ? 'vencido há ' + Math.abs(c.dias) + 'd'
                                : c.dias === 0 ? 'hoje'
                                : 'em ' + c.dias + 'd';
                const urgente = c.dias <= 0;
                return '<tr>' +
                    '<td>' + escapar(c.descricao) +
                        (c.quem ? '<br><small class="observacao">' + escapar(c.quem) + '</small>' : '') + '</td>' +
                    '<td>' + etiqueta('tipos_lancamento', c.tipo) + '</td>' +
                    '<td' + (urgente ? ' class="saldo-zero"' : '') + '>' + dataCurta(c.vencimento) +
                        '<br><small class="observacao">' + escapar(rotuloDia) + '</small></td>' +
                    '<td class="numero">' + moeda(c.valor) + '</td>' +
                    '</tr>';
            }).join('') +
            '</tbody></table></div>';
    }

    // ---- 9. quadro mes a mes ----
    function desenharDre() {
        montarFiltros('topoDre', filtroHtml('dreOrigem', ORIGENS, 'De onde veio o dinheiro') +
                              filtroHtml('dre', PERIODOS) + camposDeDataHtml('dre'));

        const meses = serieDe('dre');

        // Mês sem nada some da tabela (mas continua no gráfico, para a linha
        // do tempo não ficar torta). Aqui uma linha de zeros só ocuparia espaço.
        const comMovimento = meses.filter(function (m) { return m.receita > 0 || m.despesas > 0; });
        const alvo = document.getElementById('tabelaDre');

        if (!comMovimento.length) {
            alvo.innerHTML = vazio('Nenhum movimento no período escolhido.');
            return;
        }

        const soma = function (campo) {
            return somarEmCentavos(comMovimento, function (m) { return m[campo]; });
        };

        alvo.innerHTML =
            '<div class="rolagem-x"><table>' +
            '<thead><tr><th>Mês</th><th class="numero">Receita</th><th class="numero">Custo</th>' +
            '<th class="numero">Lucro bruto</th><th class="numero">Despesas</th>' +
            '<th class="numero">' + escapar(rotuloLucro('dre')) + '</th><th class="numero">Margem</th></tr></thead><tbody>' +
            comMovimento.map(function (m) {
                const classe = m.lucro_liquido >= 0 ? 'saldo-ok' : 'saldo-zero';
                return '<tr>' +
                    '<td>' + escapar(m.titulo || m.rotulo) + '</td>' +
                    '<td class="numero">' + moeda(m.receita) + '</td>' +
                    '<td class="numero">' + moeda(m.custo) + '</td>' +
                    '<td class="numero">' + moeda(m.lucro_bruto) + '</td>' +
                    '<td class="numero">' + moeda(m.despesas) + '</td>' +
                    '<td class="numero ' + classe + '">' + moeda(m.lucro_liquido) + '</td>' +
                    '<td class="numero ' + classe + '">' + porcento(m.margem) + '</td>' +
                    '</tr>';
            }).join('') +
            '<tr class="linha-total">' +
            '<td>Total</td>' +
            '<td class="numero">' + moeda(soma('receita')) + '</td>' +
            '<td class="numero">' + moeda(soma('custo')) + '</td>' +
            '<td class="numero">' + moeda(soma('lucro_bruto')) + '</td>' +
            '<td class="numero">' + moeda(soma('despesas')) + '</td>' +
            '<td class="numero">' + moeda(soma('lucro_liquido')) + '</td>' +
            '<td class="numero">' + porcento(soma('receita') > 0 ? soma('lucro_liquido') / soma('receita') * 100 : 0) + '</td>' +
            '</tr></tbody></table></div>';
    }

    function preencherCard(id, dados) {
        dados = dados || { venda: 0, quantidade: 0 };
        document.getElementById(id).textContent = moeda(dados.venda);
        document.getElementById(id + 'Qtd').textContent =
            dados.quantidade + (dados.quantidade === 1 ? ' item' : ' itens');
    }

    /*
     * Estas tabelas listam SO OS CELULARES com saldo, um por linha, na
     * situacao do card de mesmo nome (a regra dos cards do /api/resumo).
     * Peca e produto aparecem em "Precisa repor" e na rosca "Dinheiro
     * parado por tipo".
     */
    function tabelaSituacao(situacao, itens) {
        const total = somarEmCentavos(itens, function (item) { return item.valor_venda; });

        const linhas = itens.length
            ? itens.map(function (item) {
                return '<tr><td>' + escapar(item.item) + '</td><td class="numero">' + moeda(item.valor_venda) + '</td></tr>';
            }).join('') +
              '<tr class="linha-total"><td><strong>TOTAL</strong></td>' +
              '<td class="numero"><strong>' + moeda(total) + '</strong></td></tr>'
            : '<tr class="empty-row"><td colspan="2">Nenhum aparelho nesta situação.</td></tr>';

        return '<div class="table-section">' +
               '  <h3 class="table-title"><span style="background:var(' + corDe('situacoes', situacao) + ')"></span>' +
                    escapar(rotuloDe('situacoes', situacao)) +
               '    <small class="observacao" style="margin-left:auto;font-weight:400">celulares</small></h3>' +
               '  <table><thead><tr><th>Item</th><th class="numero">Valor</th></tr></thead><tbody>' + linhas + '</tbody></table>' +
               '</div>';
    }

    /*
     * Pecas e produtos com saldo baixo (config.estoque_baixo ou menos). Aparece no painel porque
     * ficar sem tela no meio de um conserto para a oficina - e ninguem vai
     * abrir a tela de Entradas de manha so para conferir isso.
     */
    function tabelaReposicao() {
        const acabando = estado.entradas
            .filter(function (i) { return i.tipo !== 'celular' && i.saldo > 0 && i.saldo <= estado.config.estoque_baixo; })
            .sort(function (a, b) { return a.saldo - b.saldo; });

        const linhas = acabando.length
            ? acabando.map(function (item) {
                return '<tr><td>' + escapar(item.item) +
                       '<br><small class="observacao">' + escapar(rotuloDe('tipos_entrada', item.tipo)) + '</small></td>' +
                       '<td class="' + classeSaldo(item.saldo) + '">' + item.saldo + '</td></tr>';
            }).join('')
            : '<tr class="empty-row"><td colspan="2">Nada acabando no estoque.</td></tr>';

        return '<div class="table-section">' +
               '  <h3 class="table-title"><span style="background:var(--grave)"></span>Precisa repor</h3>' +
               '  <table><thead><tr><th>Item</th><th>Saldo</th></tr></thead><tbody>' + linhas + '</tbody></table>' +
               '</div>';
    }

    /*
     * Ao mudar a largura da janela (ou encolher o menu), os graficos sao
     * redesenhados: quantos rotulos de mes cabem no eixo depende da largura
     * real do container, e essa conta e feita na hora de desenhar.
     *
     * O espera-um-pouco evita redesenhar a cada pixel enquanto a janela e
     * arrastada - seriam dezenas de redesenhos por segundo.
     */
    let esperaRedesenho = null;

    window.addEventListener('resize', function () {
        if (!estado.relatorio) return;
        clearTimeout(esperaRedesenho);
        esperaRedesenho = setTimeout(function () {
            if (!document.getElementById('secao-dashboard').classList.contains('oculta')) {
                desenharRelatorios(estado.relatorio);
            }
        }, 220);
    });

    registrarTela('dashboard', { titulo: 'Painel de Controle', carregar: carregarDashboard });

    janela.Telas = janela.Telas || {};
    janela.Telas.painel = { desenharRelatorios: desenharRelatorios };
})(window);
