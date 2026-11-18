// carga: usa Formato, Nucleo, Janela; publica Telas.vendas  (conferido por testes/front/carga.test.js)
/*
 * telas/vendas.js - consulta, edicao e cancelamento das vendas (as de balcao,
 * feitas no PDV, e as geradas por OS). Window.Telas.vendas. Venda NOVA so
 * pelo PDV (telas/pdv.js): a janela "Nova venda" daqui saiu na v7.
 *
 * O que cada venda permite (editar valor, cancelar, excluir) vem pronto do
 * servidor em cada registro: pode_editar_valor, pode_cancelar, pode_excluir.
 * A tela so mostra ou esconde; a regra mora la.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, somarEmCentavos } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, etiqueta, vazio, opcoesDe, tabelaHtml, moedaOuTraco,
            campoFormaPagamento, carregarCatalogos, carregarDisponiveis } = N;
    const { abrirModal, modalCorpo } = janela.Janela;

    async function carregarVendas() {
        const r = await Promise.all([api.get('/vendas'), carregarCatalogos(), carregarDisponiveis()]);
        estado.vendas = r[0].itens;
        desenharVendas();
    }

    /** Venda que e o faturamento de uma OS (e nao venda de balcao). */
    function vendaDeOs(v) {
        return !!(v.os_id || v.os_numero);
    }

    /* Custo e lucro so aparecem se o servidor mandou (balcao e tecnico nao recebem). */
    function temLucro(lista) {
        return lista.some(function (v) { return v.lucro !== undefined && v.lucro !== null; });
    }

    function desenharVendas() {
        const busca = document.getElementById('buscaVenda').value.trim().toLowerCase();
        const status = document.getElementById('filtroVenda').value;

        const itens = estado.vendas.filter(function (v) {
            if (status && v.status !== status) return false;
            if (!busca) return true;
            return [v.numero, v.cliente, v.vendedor, v.forma_pagamento].join(' ').toLowerCase().includes(busca);
        });

        const alvo = document.getElementById('listaVendas');
        if (!itens.length) {
            alvo.innerHTML = vazio('Nenhuma venda registrada. As vendas são feitas no PDV (tecla F2).');
            return;
        }

        const concluidas = itens.filter(function (v) { return v.status === 'concluida'; });
        const veLucro = temLucro(itens);

        alvo.innerHTML = tabelaHtml({
            colunas: ['Número', 'Cliente', 'Itens', 'Pagamento', 'Total']
                .concat(veLucro ? ['Lucro'] : [])
                .concat(['Data', 'Status', { titulo: 'Ações', classe: 'coluna-acoes' }]),
            linhas: itens.map(function (v) {
                return [
                    // Venda de OS e diferente da de balcao; dizer na linha evita descobrir no clique.
                    escapar(v.numero || ('#' + v.id)) +
                        (vendaDeOs(v) ? '<br><small class="observacao">da ' + escapar(v.os_numero || 'OS') + '</small>' : ''),
                    escapar(v.cliente) + (v.vendedor ? '<br><small class="observacao">por ' + escapar(v.vendedor) + '</small>' : ''),
                    (v.unidades || 0) + ' un.',
                    escapar(v.forma_pagamento || '—') + (v.parcelas > 1 ? '<br><small class="observacao">' + v.parcelas + 'x</small>' : ''),
                    moeda(v.valor_total) + (v.desconto > 0 ? '<br><small class="observacao">desc. ' + moeda(v.desconto) + '</small>' : ''),
                ].concat(veLucro ? [moedaOuTraco(v.lucro)] : []).concat([
                    dataCurta(v.data_venda),
                    etiqueta('status_venda', v.status),
                    { classe: 'coluna-acoes', html:
                        '<button type="button" class="botao-icone" data-acao="ver-venda" data-id="' + v.id + '">Ver</button> ' +
                        '<button type="button" class="botao-icone" data-acao="editar-venda" data-id="' + v.id + '">Editar</button> ' +
                        (v.pode_excluir
                            ? '<button type="button" class="botao-icone perigo" data-acao="excluir-venda" data-id="' + v.id + '">Excluir</button>'
                            : vendaDeOs(v)
                                ? '<button type="button" class="botao-icone botao-excluir" disabled title="Faturamento da ' +
                                  escapar(v.os_numero || 'OS') + '. Para desfazer, tire a ordem do status entregue; ' +
                                  'para devolução ou garantia, use o botão Garantia na OS.">Excluir</button>'
                                : '') },
                ]);
            }),
            total: [{ colspan: 4, html: '<strong>TOTAL (' + concluidas.length + ' venda[s] concluída[s])</strong>' },
                    '<strong>' + moeda(somarEmCentavos(concluidas, function (v) { return v.valor_total; })) + '</strong>']
                .concat(veLucro ? ['<strong>' + moeda(somarEmCentavos(concluidas, function (v) { return v.lucro; })) + '</strong>'] : [])
                .concat([{ colspan: 3, html: '' }]),
        });
    }

    /*
     * Formulario do Editar venda, pelo que o servidor permite NESTA venda:
     *   pode_editar_valor  cliente, desconto e forma de pagamento
     *   pode_cancelar      o campo Situacao, com "Cancelada"
     * O aviso explica o porque quando nada disso pode: venda gerada por OS
     * (muda pela OS) ou venda cancelada (nao volta a ser concluida).
     */
    function formularioEditarVenda(venda) {
        const campos = [];
        if (vendaDeOs(venda)) {
            const os = escapar(venda.os_numero || 'OS');
            campos.push({ nome: '__aviso', tipo: 'html', html:
                '<div class="aviso-formulario campo-total">Esta venda é o faturamento da <strong>' + os +
                '</strong>. Itens, valores, cliente e situação não mudam aqui: <strong>altere pela ' + os +
                '</strong>.</div>' });
        } else if (venda.status === 'cancelada') {
            campos.push({ nome: '__aviso', tipo: 'html', html:
                '<div class="aviso-formulario campo-total">Venda <strong>cancelada</strong>: os itens já voltaram ' +
                'ao estoque e podem ter sido vendidos de novo, então ela não volta a ser concluída. ' +
                'Para vender de novo, registre uma venda nova.</div>' });
        }

        if (venda.pode_editar_valor) {
            campos.push({
                nome: 'cliente_id', rotulo: 'Cliente', tipo: 'select', valor: venda.cliente_id || '',
                opcoes: opcoesDe(estado.clientes, function (c) { return c.nome; }, '— consumidor não identificado —'),
                largura: 'total',
            });
            campos.push({ nome: 'desconto', rotulo: 'Desconto (R$)', tipo: 'number', valor: venda.desconto,
                          maximo: venda.valor_bruto > 0 ? venda.valor_bruto : undefined,
                          dica: 'Se a venda já foi recebida, o servidor diz o que acontece com a diferença.' });
            campos.push(campoFormaPagamento(venda.forma_pagamento_id));
        }
        if (venda.pode_cancelar) {
            campos.push({
                nome: 'status', rotulo: 'Situação', tipo: 'select', valor: venda.status,
                opcoes: [{ valor: 'concluida', rotulo: 'Concluída' }, { valor: 'cancelada', rotulo: 'Cancelada' }],
                dica: 'Cancelar devolve os itens ao estoque.',
            });
        }
        campos.push({ nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: venda.observacoes, largura: 'total' });
        return campos;
    }

    async function verVenda(id) {
        const v = (await api.get('/vendas/' + id)).venda;

        const itens = tabelaHtml({
            colunas: ['Item', 'Qtd', 'Unitário', 'Subtotal'],
            linhas: v.lista_itens.map(function (i) {
                return [escapar(i.descricao), i.quantidade, moeda(i.valor_unitario), moeda(i.subtotal)];
            }),
            total: [{ colspan: 3, html: '<strong>Total</strong>' }, '<strong>' + moeda(v.valor_total) + '</strong>'],
        });
        const lancamentos = (v.lancamentos || []).length
            ? tabelaHtml({
                colunas: ['Descrição', 'Vencimento', 'Valor', 'Status'],
                linhas: v.lancamentos.map(function (l) {
                    return [escapar(l.descricao), dataCurta(l.vencimento), moeda(l.valor), etiqueta('status_lancamento', l.status)];
                }),
            })
            : vazio('Esta venda não gerou lançamentos.');

        abrirModal({
            titulo: 'Venda ' + (v.numero || '#' + v.id),
            somenteLeitura: true,
            html: '<div class="campo-total">' +
                  '<div class="lista-dados">' +
                  '  <div><span>Cliente</span><strong>' + escapar(v.cliente) + '</strong></div>' +
                  '  <div><span>Vendedor</span><strong>' + escapar(v.vendedor || '—') + '</strong></div>' +
                  '  <div><span>Data</span><strong>' + dataCurta(v.data_venda) + '</strong></div>' +
                  '  <div><span>Pagamento</span><strong>' + escapar(v.forma_pagamento || '—') +
                       (v.parcelas > 1 ? ' em ' + v.parcelas + 'x' : '') + '</strong></div>' +
                  (v.custo_total !== undefined && v.custo_total !== null
                      ? '  <div><span>Custo dos itens</span><strong>' + moeda(v.custo_total) + '</strong></div>' +
                        '  <div><span>Lucro</span><strong>' + moedaOuTraco(v.lucro) + '</strong></div>'
                      : '') +
                  (vendaDeOs(v) ? '  <div><span>Origem</span><strong>Faturamento da ' + escapar(v.os_numero || 'OS') + '</strong></div>' : '') +
                  '</div>' +
                  '<h4 class="sub-titulo">Itens</h4>' + itens +
                  '<h4 class="sub-titulo">Lançamentos</h4>' + lancamentos +
                  (v.observacoes ? '<h4 class="sub-titulo">Observações</h4><p>' + escapar(v.observacoes) + '</p>' : '') +
                  '</div>',
        });
    }

    document.getElementById('buscaVenda').addEventListener('input', desenharVendas);
    document.getElementById('filtroVenda').addEventListener('change', desenharVendas);

    N.registrarAcoes({
        'abrir-pdv': function () { N.mostrarSecao('pdv', true); },
        'ver-venda': verVenda,
        'editar-venda': function (id) {
            const venda = estado.vendas.find(function (v) { return v.id === id; });
            return abrirModal({
                titulo: 'Editar venda ' + (venda.numero || '#' + venda.id),
                campos: formularioEditarVenda(venda),
                aoSalvar: async function (valores) {
                    if (valores.status === 'cancelada' && venda.status !== 'cancelada' &&
                        !confirm('Cancelar a venda ' + (venda.numero || '#' + venda.id) + '? Os itens voltam ao estoque.')) {
                        throw new Error('Nada foi gravado.');
                    }
                    // A mensagem e a do servidor: diz o que aconteceu com o
                    // estoque e com o dinheiro (diferenca, devolucao...).
                    avisar(mensagemDe(await api.put('/vendas/' + id, valores), 'Venda atualizada.'));
                    await carregarVendas();
                },
            });
        },
        'excluir-venda': async function (id) {
            const venda = estado.vendas.find(function (v) { return v.id === id; });
            if (!confirm('Excluir a venda ' + (venda.numero || '#' + venda.id) + '? Os itens voltam para o estoque.')) return;
            avisar(mensagemDe(await api.remover('/vendas/' + id), 'Venda excluída.'));
            await carregarVendas();
        },
    });

    N.registrarTela('vendas', { titulo: 'Vendas', carregar: carregarVendas });
    janela.Telas = janela.Telas || {};
    janela.Telas.vendas = { vendaDeOs: vendaDeOs, verVenda: verVenda };
})(window);
