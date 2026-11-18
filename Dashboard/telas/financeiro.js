// carga: usa Formato, Nucleo, Janela; publica Telas.financeiro  (conferido por testes/front/carga.test.js)
/*
 * telas/financeiro.js - Financeiro (so quem ve o financeiro): resumo,
 * lancamentos e historico de vendas. Window.Telas.financeiro.
 *
 * O que cada lancamento permite (editar o valor, excluir) vem pronto do
 * servidor em cada registro (pode_editar_valor, pode_excluir).
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, horaCurta, mesAno, hoje, emCentavos, deCentavos, somarEmCentavos } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, rotuloDe, opcoesDoDominio, etiqueta, vazio, opcoesDe, cardSimples,
            tabelaHtml, campoFormaPagamento, carregarCatalogos } = N;
    const { abrirModal } = janela.Janela;
    const vendaDeOs = function (v) { return janela.Telas.vendas.vendaDeOs(v); };

    estado.painelFinanceiro = 'resumo';

    async function carregarFinanceiro() {
        if (estado.painelFinanceiro === 'resumo') {
            // "OS em andamento" (os.os_abertas) vem contado pelo servidor.
            return desenharResumoFinanceiro(await api.get('/financeiro'));
        }
        if (estado.painelFinanceiro === 'lancamentos') {
            await carregarCatalogos();
            return carregarLancamentos();
        }
        // As formas vêm do cadastro: é por ele (id) que o histórico filtra.
        const [dados, formas] = await Promise.all([api.get('/vendas'), api.get('/formas-pagamento')]);
        estado.vendas = dados.itens;
        estado.formasPagamento = formas.itens;
        return desenharHistoricoVendas();
    }

    function desenharResumoFinanceiro(dados) {
        const est = dados.estoque;
        const os = dados.os;
        const vend = dados.vendas;
        const lanc = dados.lancamentos;

        const mensal = (dados.mensal || []).length
            ? '<div class="rolagem-x"><table><thead><tr><th>Mês</th><th class="numero">Vendas</th>' +
              '<th class="numero">OS</th><th class="numero">Total</th></tr></thead><tbody>' +
              dados.mensal.map(function (m) {
                  return '<tr><td>' + mesAno(m.mes) + '</td>' +
                         '<td class="numero">' + moeda(m.vendas) + '</td>' +
                         '<td class="numero">' + moeda(m.os) + '</td>' +
                         '<td class="numero"><strong>' + moeda(m.total) + '</strong></td></tr>';
              }).join('') +
              '</tbody></table></div>'
            : vazio('Nenhuma venda ou OS entregue ainda.');

        // Vencido aparece separado porque e o unico numero que exige acao hoje.
        const alertas = (lanc.vencido_receber > 0 || lanc.vencido_pagar > 0)
            ? '<div class="stats-container">' +
              (lanc.vencido_receber > 0 ? cardSimples('Vencido a receber', moeda(lanc.vencido_receber), '--critico') : '') +
              (lanc.vencido_pagar > 0 ? cardSimples('Vencido a pagar', moeda(lanc.vencido_pagar), '--critico') : '') +
              '</div>'
            : '';

        document.getElementById('conteudoFinanceiro').innerHTML =
            '<div class="stats-container">' +
            cardSimples('A receber (em aberto)', moeda(lanc.a_receber), '--serie-3') +
            cardSimples('A pagar (em aberto)', moeda(lanc.a_pagar), '--critico') +
            cardSimples('Saldo previsto', moeda(dados.saldo_previsto), dados.saldo_previsto >= 0 ? '--serie-3' : '--critico') +
            cardSimples('Já recebido', moeda(lanc.recebido), '--serie-1') +
            '</div>' +
            alertas +
            '<div class="stats-container">' +
            cardSimples('Investido no estoque parado', moeda(est.investido_parado), '--serie-2') +
            cardSimples('Venda prevista do estoque', moeda(est.venda_prevista), '--serie-1') +
            cardSimples('Lucro previsto do estoque', moeda(dados.lucro_previsto_estoque), '--serie-3') +
            cardSimples('A receber de OS abertas', moeda(os.a_receber), '--serie-1') +
            '</div>' +
            '<div class="stats-container">' +
            cardSimples('Receita de vendas', moeda(vend.receita_vendas), '--serie-5') +
            cardSimples('Lucro das vendas', moeda(dados.lucro_vendas), '--serie-3') +
            cardSimples('Receita de OS entregues', moeda(os.receita_os), '--serie-1') +
            cardSimples('Lucro das OS (sem peças)', moeda(dados.lucro_os), '--serie-3') +
            '</div>' +
            '<div class="tables-grid">' +
            '  <div class="table-section">' +
            '    <h3 class="table-title"><span style="background:var(--serie-1)"></span>Faturamento por mês</h3>' + mensal +
            '  </div>' +
            '  <div class="table-section">' +
            '    <h3 class="table-title"><span style="background:var(--serie-5)"></span>Resumo</h3>' +
            '    <div class="lista-dados">' +
            '      <div><span>Vendas concluídas</span><strong>' + vend.quantidade + '</strong></div>' +
            '      <div><span>Unidades paradas no estoque</span><strong>' + est.unidades_paradas + '</strong></div>' +
            '      <div><span>OS entregues</span><strong>' + os.os_entregues + '</strong></div>' +
            '      <div><span>OS em andamento</span><strong>' + os.os_abertas + '</strong></div>' +
            '      <div><span>Custo de peças (OS entregues)</span><strong>' + moeda(os.custo_pecas) + '</strong></div>' +
            '      <div><span>Custo das vendas</span><strong>' + moeda(vend.custo_vendas) + '</strong></div>' +
            // lanc.pago soma TODA conta a pagar ja baixada - fornecedor,
            // aluguel, energia. Chamar isso de "fornecedores" seria mentira.
            '      <div><span>Já pago (todas as contas)</span><strong>' + moeda(lanc.pago) + '</strong></div>' +
            '    </div>' +
            '  </div>' +
            '</div>';
    }

    async function carregarLancamentos() {
        const tipo = document.getElementById('filtroLancTipo').value;
        const status = document.getElementById('filtroLancStatus').value;
        const busca = [];
        if (tipo) busca.push('tipo=' + tipo);
        if (status) busca.push('status=' + status);

        const dados = await api.get('/lancamentos' + (busca.length ? '?' + busca.join('&') : ''));
        estado.lancamentos = dados.itens;
        desenharLancamentos();
    }

    function desenharLancamentos() {
        const itens = estado.lancamentos;
        const alvo = document.getElementById('conteudoFinanceiro');

        if (!itens.length) {
            alvo.innerHTML = vazio('Nenhum lançamento neste filtro. Use os botões "+ A receber" e "+ A pagar" para incluir na mão.');
            return;
        }

        const pendentes = function (tipo) {
            return itens.filter(function (l) { return l.tipo === tipo && l.status === 'pendente'; });
        };
        const receber = somarEmCentavos(pendentes('receber'), function (l) { return l.valor; });
        const pagar = somarEmCentavos(pendentes('pagar'), function (l) { return l.valor; });
        const saldo = deCentavos(emCentavos(receber) - emCentavos(pagar));

        const marcoHoje = hoje();

        alvo.innerHTML =
            '<div class="stats-container">' +
            cardSimples('A receber na lista', moeda(receber), '--serie-3') +
            cardSimples('A pagar na lista', moeda(pagar), '--serie-2') +
            cardSimples('Saldo da lista', moeda(saldo), saldo >= 0 ? '--serie-3' : '--critico') +
            '</div>' +
            '<div class="table-section">' +
            '<div class="rolagem-x"><table><thead><tr><th>Descrição</th><th>Tipo</th><th>Vencimento</th><th class="numero">Valor</th>' +
            '<th>Status</th><th>Origem</th><th class="coluna-acoes">Ações</th></tr></thead><tbody>' +
            itens.map(function (l) {
                const vencido = l.status === 'pendente' && l.vencimento && l.vencimento < marcoHoje;
                const quem = l.cliente || l.fornecedor || '';
                const ref = l.venda_numero || l.os_numero || '';

                return '<tr>' +
                    '<td>' + escapar(l.descricao) +
                        (quem ? '<br><small class="observacao">' + escapar(quem) + '</small>' : '') + '</td>' +
                    '<td>' + etiqueta('tipos_lancamento', l.tipo) + '</td>' +
                    '<td' + (vencido ? ' class="saldo-zero"' : '') + '>' + dataCurta(l.vencimento) +
                        (vencido ? '<br><small>vencido</small>' : '') + '</td>' +
                    '<td>' + moeda(l.valor) +
                        (l.total_parcelas > 1 ? '<br><small class="observacao">' + l.parcela + '/' + l.total_parcelas + '</small>' : '') + '</td>' +
                    '<td>' + etiqueta('status_lancamento', l.status) + '</td>' +
                    '<td>' + escapar(rotuloDe('origens_lancamento', l.origem || 'manual') + (ref ? ' ' + ref : '')) + '</td>' +
                    '<td class="coluna-acoes">' +
                    (l.status === 'pendente'
                        ? '  <button type="button" class="botao-icone" data-acao="baixar-lancamento" data-id="' + l.id + '">Dar baixa</button>'
                        : '') +
                    '  <button type="button" class="botao-icone" data-acao="editar-lancamento" data-id="' + l.id + '">Editar</button>' +
                    '  <button type="button" class="botao-icone" data-acao="log-lancamento" data-id="' + l.id +
                        '" title="Ver alterações deste lançamento">Histórico</button>' +
                    // O servidor diz, por lancamento, se ele pode ser excluido.
                    (l.pode_excluir
                        ? '  <button type="button" class="botao-icone perigo" data-acao="excluir-lancamento" data-id="' + l.id + '">Excluir</button>'
                        : '') +
                    '</td></tr>';
            }).join('') +
            '</tbody></table></div></div>';
    }

    /*
     * Filtros do historico de vendas. Ficam no estado, e nao dentro do HTML
     * que e reescrito a cada desenho - senao o campo de busca perderia o que
     * foi digitado a cada tecla.
     */
    estado.filtroVenda = { busca: '', de: '', ate: '', pagamento: '', origem: '' };

    /* Valor do filtro para "venda sem forma informada" (id vazio). */
    const SEM_FORMA_ID = 'nenhuma';

    function desenharHistoricoVendas() {
        const alvo = document.getElementById('conteudoFinanceiro');
        const f = estado.filtroVenda;

        if (!estado.vendas.length) {
            alvo.innerHTML = vazio('Nenhuma venda registrada ainda.');
            return;
        }

        /*
         * O filtro de forma usa o ID do cadastro, como o relatório. Filtrar
         * pelo nome gravado em texto na venda fazia uma forma renomeada
         * aparecer com dois nomes em duas telas para o mesmo dinheiro. Só
         * entram no select as formas que alguma venda usou.
         */
        const usadas = {};
        estado.vendas.forEach(function (v) { usadas[String(v.forma_pagamento_id || '')] = true; });
        const formas = estado.formasPagamento.filter(function (fp) { return usadas[String(fp.id)]; })
            .map(function (fp) { return { valor: String(fp.id), rotulo: fp.nome }; });
        if (usadas['']) formas.push({ valor: SEM_FORMA_ID, rotulo: '— não informada —' });

        const busca = f.busca.trim().toLowerCase();
        const itens = estado.vendas.filter(function (v) {
            const dia = String(v.data_venda).substring(0, 10);
            if (f.de && dia < f.de) return false;
            if (f.ate && dia > f.ate) return false;
            if (f.pagamento === SEM_FORMA_ID ? v.forma_pagamento_id : (f.pagamento && String(v.forma_pagamento_id) !== f.pagamento)) return false;
            if (f.origem === 'balcao' && vendaDeOs(v)) return false;
            if (f.origem === 'os' && !vendaDeOs(v)) return false;
            if (!busca) return true;
            // itens_texto traz os modelos vendidos, entao "iphone 7" acha a venda
            return [v.numero, v.cliente, v.vendedor, v.forma_pagamento, v.itens_texto]
                .filter(Boolean).join(' ').toLowerCase().includes(busca);
        });

        const barra =
            '<div class="barra-filtros" style="margin-bottom:16px">' +
            '  <input type="search" id="buscaHistorico" placeholder="Buscar por número, cliente, modelo ou vendedor..." ' +
            '         value="' + escapar(f.busca) + '">' +
            '  <input type="date" id="histDe" class="filtro-data-larga" value="' + escapar(f.de) + '" title="A partir de">' +
            '  <span class="filtro-ate">até</span>' +
            '  <input type="date" id="histAte" class="filtro-data-larga" value="' + escapar(f.ate) + '" title="Até">' +
            '  <select id="histPagamento">' +
            '    <option value="">Todas as formas</option>' +
            formas.map(function (x) {
                return '<option value="' + escapar(x.valor) + '"' + (x.valor === f.pagamento ? ' selected' : '') + '>' +
                       escapar(x.rotulo) + '</option>';
            }).join('') +
            '  </select>' +
            '  <select id="histOrigem" title="Venda de balcão ou faturamento de OS">' +
            [{ valor: '', rotulo: 'Balcão e OS' }, { valor: 'balcao', rotulo: 'Só vendas de balcão' },
             { valor: 'os', rotulo: 'Só faturamento de OS' }].map(function (o) {
                return '<option value="' + o.valor + '"' + (o.valor === f.origem ? ' selected' : '') + '>' + o.rotulo + '</option>';
            }).join('') +
            '  </select>' +
            (f.busca || f.de || f.ate || f.pagamento || f.origem
                ? '  <button type="button" class="botao botao-secundario botao-pequeno" id="limparHistorico">Limpar filtros</button>'
                : '') +
            '</div>';

        if (!itens.length) {
            alvo.innerHTML = barra + vazio('Nenhuma venda encontrada com esses filtros.');
            ligarFiltrosHistorico();
            return;
        }

        /*
         * Venda de balcão e faturamento de OS separados, como no Financeiro e
         * no painel. Somados num "Faturamento" só, o número não batia com a
         * "Receita de vendas" do Financeiro, que é só balcão.
         */
        const concluidas = itens.filter(function (v) { return v.status === 'concluida'; });
        const soma = function (lista, campo) { return somarEmCentavos(lista, function (v) { return v[campo]; }); };
        const deOs = concluidas.filter(vendaDeOs);
        const deBalcao = concluidas.filter(function (v) { return !vendaDeOs(v); });
        const total = soma(concluidas, 'valor_total');
        const custo = soma(concluidas, 'custo_total');

        // Por mes, com balcao e OS em colunas separadas, como no Financeiro.
        const meses = {};
        concluidas.forEach(function (v) {
            const mes = String(v.data_venda).substring(0, 7);
            (meses[mes] = meses[mes] || []).push(v);
        });

        alvo.innerHTML = barra +
            '<div class="stats-container">' +
            cardSimples('Vendas encontradas', concluidas.length, '--serie-1') +
            cardSimples('Vendas de balcão', moeda(soma(deBalcao, 'valor_total')), '--serie-5') +
            cardSimples('Faturamento de OS', moeda(soma(deOs, 'valor_total')), '--serie-4') +
            cardSimples('Custo dos itens', moeda(custo), '--serie-2') +
            cardSimples('Lucro', moeda(deCentavos(emCentavos(total) - emCentavos(custo))), '--serie-3') +
            '</div>' +
            '<div class="tables-grid grade-resumo-lista">' +
            '  <div class="table-section">' +
            '    <h3 class="table-title"><span style="background:var(--serie-1)"></span>Por mês</h3>' +
            tabelaHtml({
                colunas: ['Mês', { titulo: 'Vendas', classe: 'numero' }, { titulo: 'Balcão', classe: 'numero' },
                          { titulo: 'OS', classe: 'numero' }, { titulo: 'Lucro', classe: 'numero' }],
                linhas: Object.keys(meses).sort().reverse().map(function (mes) {
                    const lista = meses[mes];
                    return [mesAno(mes),
                            { html: lista.length, classe: 'numero' },
                            { html: moeda(soma(lista.filter(function (v) { return !vendaDeOs(v); }), 'valor_total')), classe: 'numero' },
                            { html: moeda(soma(lista.filter(vendaDeOs), 'valor_total')), classe: 'numero' },
                            { html: moeda(soma(lista, 'lucro')), classe: 'numero' }];
                }),
            }) +
            '  </div>' +
            '  <div class="table-section">' +
            '    <h3 class="table-title"><span style="background:var(--serie-5)"></span>Vendas' +
            '      <small class="observacao" style="margin-left:auto;font-weight:400">' +
                 itens.length + ' encontrada(s)</small></h3>' +
            '    <div class="rolagem-x"><table><thead><tr><th>Número</th><th>Data</th><th>Cliente</th>' +
            '<th>Itens</th><th class="numero">Total</th><th class="coluna-acoes">Ações</th></tr></thead><tbody>' +
            itens.slice(0, 40).map(function (v) {
                return '<tr><td>' + escapar(v.numero || '#' + v.id) +
                           (vendaDeOs(v) ? '<br><small class="observacao">da ' + escapar(v.os_numero || 'OS') + '</small>' : '') + '</td>' +
                       '<td>' + dataCurta(v.data_venda) + '</td>' +
                       '<td>' + escapar(v.cliente) +
                           (v.forma_pagamento ? '<br><small class="observacao">' + escapar(v.forma_pagamento) + '</small>' : '') + '</td>' +
                       '<td><small class="observacao">' + escapar(v.itens_texto || '—') + '</small></td>' +
                       '<td class="numero">' + moeda(v.valor_total) + '</td>' +
                       '<td class="coluna-acoes"><button type="button" class="botao-icone" data-acao="ver-venda" data-id="' + v.id + '">Ver</button></td></tr>';
            }).join('') +
            '    </tbody></table></div>' +
            (itens.length > 40 ? '<p class="observacao" style="margin-top:10px">Mostrando as 40 mais recentes de ' +
                 itens.length + '. Use os filtros para chegar no que procura.</p>' : '') +
            '  </div>' +
            '</div>';

        ligarFiltrosHistorico();
    }

    /*
     * Religa os campos do filtro depois de cada desenho. O innerHTML acabou
     * de trocar os elementos, entao os ouvintes antigos morreram junto -
     * por isso eles sao ligados aqui, e nao uma vez no carregamento.
     *
     * A busca guarda o cursor: sem isso, digitar a segunda letra jogava o
     * cursor para o comeco do campo a cada tecla.
     */
    function ligarFiltrosHistorico() {
        const busca = document.getElementById('buscaHistorico');
        if (busca) {
            busca.addEventListener('input', function () {
                const pos = this.selectionStart;
                estado.filtroVenda.busca = this.value;
                desenharHistoricoVendas();
                const novo = document.getElementById('buscaHistorico');
                novo.focus();
                novo.setSelectionRange(pos, pos);
            });
        }

        [['histDe', 'de'], ['histAte', 'ate'], ['histPagamento', 'pagamento'], ['histOrigem', 'origem']].forEach(function (par) {
            const campo = document.getElementById(par[0]);
            if (!campo) return;
            campo.addEventListener('change', function () {
                estado.filtroVenda[par[1]] = this.value;
                desenharHistoricoVendas();
            });
        });

        const limpar = document.getElementById('limparHistorico');
        if (limpar) {
            limpar.addEventListener('click', function () {
                estado.filtroVenda = { busca: '', de: '', ate: '', pagamento: '', origem: '' };
                desenharHistoricoVendas();
            });
        }
    }

    /*
     * Lancamento. O valor de um lancamento gerado por venda, OS ou compra e
     * a contrapartida daquele documento: o servidor manda pode_editar_valor
     * falso e o campo abre travado (o valor muda pelo documento). Vencimento,
     * forma, situacao e observacoes continuam editaveis, e tudo vai para o log.
     */
    function formularioLancamento(lanc, tipo) {
        lanc = lanc || {};
        const travarValor = !!lanc.id && !lanc.pode_editar_valor;

        return [
            {
                nome: 'tipo', rotulo: 'Tipo', tipo: 'select', valor: lanc.tipo || tipo || 'receber',
                opcoes: opcoesDoDominio('tipos_lancamento'),
            },
            { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'number', valor: lanc.valor, obrigatorio: true,
              minimo: 0.01, somenteLeitura: travarValor,
              dica: travarValor ? 'Gerado por ' + rotuloDe('origens_lancamento', lanc.origem) +
                    ': o valor muda pelo próprio documento.' : '' },
            { nome: 'descricao', rotulo: 'Descrição', valor: lanc.descricao, obrigatorio: true, largura: 'total' },
            { nome: 'categoria', rotulo: 'Categoria', tipo: 'lista', lista: 'categorias_lancamento', valor: lanc.categoria },
            { nome: 'vencimento', rotulo: 'Vencimento', tipo: 'date', valor: (lanc.vencimento || hoje()).substring(0, 10) },
            {
                nome: 'status', rotulo: 'Situação', tipo: 'select', valor: lanc.status || 'pendente',
                opcoes: opcoesDoDominio('status_lancamento'),
                dica: 'Marcar como pago carimba a data de hoje sozinho.',
            },
            campoFormaPagamento(lanc.forma_pagamento_id),
            {
                nome: 'cliente_id', rotulo: 'Cliente', tipo: 'select', valor: lanc.cliente_id || '',
                opcoes: opcoesDe(estado.clientes, function (c) { return c.nome; }, '— nenhum —'),
            },
            {
                nome: 'fornecedor_id', rotulo: 'Fornecedor', tipo: 'select', valor: lanc.fornecedor_id || '',
                opcoes: opcoesDe(estado.fornecedores, function (f) { return f.nome; }, '— nenhum —'),
            },
            { nome: 'parcela', rotulo: 'Parcela nº', tipo: 'number', valor: lanc.parcela || 1, passo: '1', minimo: 1,
              maximo: estado.config.parcelas_max },
            { nome: 'total_parcelas', rotulo: 'Total de parcelas', tipo: 'number',
              valor: lanc.total_parcelas || 1, passo: '1', minimo: 1, maximo: estado.config.parcelas_max,
              dica: 'Corrige a divisão quando o combinado com o cliente mudou.' },
            { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: lanc.observacoes, largura: 'total' },
        ];
    }

    /*
     * Ficha do lançamento: o que ele é hoje e tudo o que já mudou nele.
     * "Quem baixou o valor desta conta, e de quanto para quanto?" é pergunta
     * que aparece semanas depois, quando ninguém lembra.
     */
    async function verLogLancamento(id) {
        const dados = await api.get('/lancamentos/' + id);
        const l = dados.lancamento;

        const linhas = (dados.log || []).map(function (g) {
            return '<tr>' +
                '<td>' + dataCurta(g.criado_em) +
                    '<br><small class="observacao">' + escapar(horaCurta(g.criado_em)) + '</small></td>' +
                '<td>' + escapar(g.campo) + '</td>' +
                '<td class="observacao">' + escapar(g.valor_antes) + '</td>' +
                '<td><strong>' + escapar(g.valor_depois) + '</strong></td>' +
                '<td>' + escapar(g.usuario || '—') + '</td></tr>';
        }).join('');

        abrirModal({
            titulo: 'Lançamento — ' + l.descricao,
            somenteLeitura: true,
            html: '<div class="campo-total">' +
                '<div class="lista-dados" style="margin-bottom:18px">' +
                '  <div><span>Valor</span><strong>' + moeda(l.valor) + '</strong></div>' +
                '  <div><span>Tipo</span><strong>' + etiqueta('tipos_lancamento', l.tipo) + '</strong></div>' +
                '  <div><span>Situação</span><strong>' + etiqueta('status_lancamento', l.status) + '</strong></div>' +
                '  <div><span>Vencimento</span><strong>' + dataCurta(l.vencimento) + '</strong></div>' +
                (l.data_pagamento ? '  <div><span>Baixa em</span><strong>' + dataCurta(l.data_pagamento) + '</strong></div>' : '') +
                '  <div><span>Parcela</span><strong>' + l.parcela + ' de ' + l.total_parcelas + '</strong></div>' +
                '  <div><span>Origem</span><strong>' + escapar(rotuloDe('origens_lancamento', l.origem)) + '</strong></div>' +
                (l.forma_pagamento ? '  <div><span>Forma</span><strong>' + escapar(l.forma_pagamento) + '</strong></div>' : '') +
                '</div>' +
                '<h4 class="sub-titulo">Alterações</h4>' +
                (linhas
                    ? '<div class="rolagem-x"><table><thead><tr><th>Quando</th><th>Campo</th>' +
                      '<th>De</th><th>Para</th><th>Quem</th></tr></thead><tbody>' + linhas + '</tbody></table></div>'
                    : vazio('Este lançamento nunca foi alterado.')) +
                '</div>',
        });
    }

    function trocarPainelFinanceiro() {
        document.querySelectorAll('#subAbasFinanceiro .sub-aba').forEach(function (aba) {
            aba.classList.toggle('ativa', aba.dataset.painel === estado.painelFinanceiro);
        });
        document.getElementById('filtrosLancamento')
            .classList.toggle('oculta', estado.painelFinanceiro !== 'lancamentos');

        carregarFinanceiro().catch(function (erro) {
            avisar(erro.message, 'erro');
        });
    }

    document.getElementById('subAbasFinanceiro').addEventListener('click', function (evento) {
        const aba = evento.target.closest('.sub-aba');
        if (!aba) return;
        estado.painelFinanceiro = aba.dataset.painel;
        trocarPainelFinanceiro();
    });

    document.getElementById('filtroLancTipo').addEventListener('change', function () {
        carregarLancamentos().catch(function (erro) { avisar(erro.message, 'erro'); });
    });

    document.getElementById('filtroLancStatus').addEventListener('change', function () {
        carregarLancamentos().catch(function (erro) { avisar(erro.message, 'erro'); });
    });

    N.registrarAcoes({
        'novo-lancamento': async function (id, tipo) {
            await carregarCatalogos();
            return abrirModal({
                titulo: tipo === 'pagar' ? 'Nova conta a pagar' : 'Nova conta a receber',
                campos: formularioLancamento(null, tipo),
                aoSalvar: async function (valores) {
                    avisar(mensagemDe(await api.post('/lancamentos', valores), 'Lançamento registrado.'));
                    estado.painelFinanceiro = 'lancamentos';
                    trocarPainelFinanceiro();
                },
            });
        },
        'editar-lancamento': function (id) {
            const lanc = estado.lancamentos.find(function (l) { return l.id === id; });
            return abrirModal({
                titulo: 'Editar lançamento',
                campos: formularioLancamento(lanc),
                aoSalvar: async function (valores) {
                    if (!lanc.pode_editar_valor) delete valores.valor;   // o valor muda pelo documento
                    avisar(mensagemDe(await api.put('/lancamentos/' + id, valores), 'Lançamento atualizado.'));
                    await carregarLancamentos();
                },
            });
        },
        'log-lancamento': verLogLancamento,
        'baixar-lancamento': async function (id) {
            const lanc = estado.lancamentos.find(function (l) { return l.id === id; });
            if (!confirm('Dar baixa em "' + lanc.descricao + '" (' + moeda(lanc.valor) + ')?')) return;
            avisar(mensagemDe(await api.put('/lancamentos/' + id, { status: 'pago' }), 'Baixa registrada.'));
            await carregarLancamentos();
        },
        'excluir-lancamento': async function (id) {
            const lanc = estado.lancamentos.find(function (l) { return l.id === id; });
            if (!confirm('Excluir o lançamento "' + lanc.descricao + '"?')) return;
            avisar(mensagemDe(await api.remover('/lancamentos/' + id), 'Lançamento excluído.'));
            await carregarLancamentos();
        },
    });

    N.registrarTela('financeiro', { titulo: 'Financeiro', carregar: carregarFinanceiro, soFinanceiro: true });
    janela.Telas = janela.Telas || {};
    janela.Telas.financeiro = {};
})(window);
