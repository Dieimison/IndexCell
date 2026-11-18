// carga: usa Formato, Nucleo; publica Telas.pedidos  (conferido por testes/front/carga.test.js)
/*
 * telas/pedidos.js - ENTRADAS: o pedido de entrada (v7; a nota do
 * fornecedor). Window.Telas.pedidos. Desde a v9 e o UNICO jeito de por
 * mercadoria no estoque (a entrada avulsa da tela Estoque saiu): o
 * documento leva natureza, CFOP e as contas, e a entrada nasce dele.
 *
 *   lista    as entradas, "+ Nova entrada" e "Importar XML da NF-e"
 *   editor   o rascunho: natureza, fornecedor, nota, linhas, parcelas;
 *            Salvar, Confirmar (a pagar ou "Já paguei"), Apagar.
 *            Confirmado/cancelado: so leitura, com as entradas e as contas
 *            que a confirmacao criou, e o Cancelar (admin, com motivo).
 *   novaEntrada() / abrirEntrada(id)  para as outras telas (o Estoque).
 *
 * Cada linha diz O QUE e (celular, peca, produto) e QUAL item do catalogo;
 * sem item escolhido, a confirmacao cria um novo com o nome da nota.
 * Celular com quantidade 2 ou mais vira uma linha por aparelho ao salvar
 * (um IMEI por linha). Quem confere tudo e o servidor (api/rotas/pedidos.php).
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, emCentavos, deCentavos } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, avisar, mensagemDe, rotuloDe, etiquetaTexto, tabelaHtml, vazio, nomeModelo, carregarCatalogos } = N;

    const raiz = document.getElementById('pedidosConteudo');
    const COR_STATUS = { rascunho: '--atencao', confirmado: '--bom', cancelado: '--tinta-fraca' };
    let lista = [];
    let naturezas = [];
    let cfops = [];
    let atual = null;          // o pedido aberto no editor (objeto em memoria)
    let filtro = 'abertos';

    const fmtCfop = function (c) { return c ? String(c).charAt(0) + '.' + String(c).slice(1) : '—'; };
    const num = function (v) { const n = Number(v); return isFinite(n) ? n : 0; };
    function podeConfirmar() {
        return !!estado.config.pode_admin || !!(estado.config.chaves || {})['pedido.confirmar_balcao'];
    }

    // ------------------------------------------------------------------
    // Lista
    // ------------------------------------------------------------------
    function desenharLista() {
        const itens = lista.filter(function (p) {
            return filtro === 'todos' || (filtro === 'abertos' ? p.status === 'rascunho' : p.status === filtro);
        });
        raiz.innerHTML =
            '<div class="secao-topo"><div><p class="secao-descricao">Tudo o que chega na loja entra por aqui: celular, peça e produto. ' +
                'Importe o XML da nota do fornecedor ou digite (o celular usado comprado no balcão também), confira as linhas e confirme: ' +
                'vira estoque e conta a pagar (ou já paga).</p></div>' +
                '<div class="pedido-acoes-topo">' +
                    '<label class="botao botao-secundario" for="pedidoXml">Importar XML da NF-e</label>' +
                    '<input type="file" id="pedidoXml" accept=".xml,text/xml,application/xml" class="oculto-visual">' +
                    '<button type="button" class="botao" data-pedido="novo">+ Nova entrada</button>' +
                '</div></div>' +
            '<div class="barra-filtros"><select id="filtroPedido" aria-label="Situação">' +
                [['abertos', 'Rascunhos'], ['confirmado', 'Confirmados'], ['cancelado', 'Cancelados'], ['todos', 'Todos']].map(function (f) {
                    return '<option value="' + f[0] + '"' + (f[0] === filtro ? ' selected' : '') + '>' + f[1] + '</option>';
                }).join('') + '</select></div>' +
            '<div class="table-section">' +
            (itens.length
                ? tabelaHtml({
                    colunas: ['Número', 'Fornecedor', 'Nota', 'Natureza', { titulo: 'Total', classe: 'numero' }, 'Data', 'Situação',
                              { titulo: 'Ações', classe: 'coluna-acoes' }],
                    linhas: itens.map(function (p) {
                        return [escapar(p.numero) + '<br><small class="observacao">' + p.itens + ' linha(s)</small>',
                                escapar(p.fornecedor || '—'),
                                p.nota_numero ? 'NF ' + escapar(p.nota_numero) + (p.nota_serie ? '/' + escapar(p.nota_serie) : '') : '<small class="observacao">sem nota</small>',
                                escapar(p.natureza) + '<br><small class="observacao">CFOP ' + fmtCfop(p.cfop) + '</small>',
                                { html: moeda(p.valor_total), classe: 'numero' },
                                dataCurta(p.data_entrada),
                                etiquetaTexto(rotuloDe('status_pedido', p.status), COR_STATUS[p.status]),
                                { classe: 'coluna-acoes', html: '<button type="button" class="botao-icone" data-pedido="abrir" data-id="' + p.id + '">' +
                                    (p.status === 'rascunho' ? 'Abrir' : 'Ver') + '</button>' }];
                    }),
                })
                : vazio(filtro === 'abertos' ? 'Nenhum rascunho. Importe o XML da nota do fornecedor ou use "+ Nova entrada".' : 'Nenhuma entrada aqui.')) +
            '</div>';
    }

    async function carregarLista() {
        lista = (await api.get('/pedidos')).itens;
        atual = null;
        desenharLista();
    }

    // ------------------------------------------------------------------
    // Editor
    // ------------------------------------------------------------------
    function novoPedido() {
        const compra = naturezas.find(function (n) { return n.codigo === 'COMPRA_REVENDA' && n.ativa; }) ||
                       naturezas.find(function (n) { return n.sentido === 'entrada' && n.ativa; });
        return { id: null, status: 'rascunho', numero: 'Nova entrada', natureza_id: compra ? compra.id : '', fornecedor_id: '', cfop: '',
                 nota_numero: '', nota_serie: '', nota_chave: '', nota_emissao: '', valor_frete: 0, valor_outros: 0,
                 gerar_financeiro: 1, forma_pagamento_id: '', observacoes: '', lista_itens: [], parcelas: [], lancamentos: [] };
    }

    function linhaVazia() {
        return { tipo_item: '', modelo_id: '', peca_id: '', produto_id: '', descricao: '', codigo_fornecedor: '', ncm: '',
                 quantidade: 1, valor_total: 0, valor_desconto: 0, valor_venda: 0, imei: '', cor: '', condicao: '' };
    }

    function totais() {
        const c = { produtos: 0, desconto: 0 };
        atual.lista_itens.forEach(function (i) { c.produtos += emCentavos(i.valor_total); c.desconto += emCentavos(i.valor_desconto); });
        const total = c.produtos - c.desconto + emCentavos(atual.valor_frete) + emCentavos(atual.valor_outros);
        const parcelas = atual.parcelas.reduce(function (s, p) { return s + emCentavos(p.valor); }, 0);
        return { produtos: deCentavos(c.produtos), desconto: deCentavos(c.desconto), total: deCentavos(total), parcelas: deCentavos(parcelas) };
    }

    function opcoes(lista2, valor, rotulo, vazioTexto) {
        return '<option value="">' + escapar(vazioTexto) + '</option>' + lista2.map(function (x) {
            return '<option value="' + escapar(x.id) + '"' + (String(x.id) === String(valor) ? ' selected' : '') + '>' + escapar(rotulo(x)) + '</option>';
        }).join('');
    }

    function catalogoDoTipo(tipo) {
        if (tipo === 'celular') return { lista: estado.modelos, rotulo: nomeModelo, campo: 'modelo_id' };
        if (tipo === 'peca') return { lista: estado.pecas, rotulo: function (p) { return p.nome; }, campo: 'peca_id' };
        if (tipo === 'produto') return { lista: estado.produtos, rotulo: function (p) { return p.nome; }, campo: 'produto_id' };
        return null;
    }

    function linhaHtml(i, n, travado) {
        const cat = catalogoDoTipo(i.tipo_item);
        const dis = travado ? ' disabled' : '';
        const campo = function (nome, rotulo, valor, extra) {
            return '<label class="pedido-campo' + (extra && extra.largo ? ' largo' : '') + '">' + escapar(rotulo) +
                '<input type="' + ((extra && extra.tipo) || 'text') + '" data-linha="' + n + '" data-campo="' + nome + '" value="' +
                escapar(valor === null || valor === undefined ? '' : valor) + '"' + ((extra && extra.attrs) || '') + dis + '></label>';
        };
        return '<div class="pedido-linha' + (!i.tipo_item ? ' sem-tipo' : '') + '">' +
            '<div class="pedido-linha-topo"><strong>' + (n + 1) + '.</strong>' +
                campo('descricao', 'Descrição (como na nota)', i.descricao, { largo: true, attrs: ' maxlength="200"' }) +
                (travado ? '' : '<button type="button" class="botao-icone perigo-leve" data-pedido="tirar-linha" data-n="' + n + '" aria-label="Tirar a linha ' + (n + 1) + '">×</button>') +
            '</div>' +
            '<div class="pedido-linha-campos">' +
                '<label class="pedido-campo">O que é<select data-linha="' + n + '" data-campo="tipo_item"' + dis + '>' +
                    '<option value="">— escolha —</option>' + ['celular', 'peca', 'produto'].map(function (t) {
                        return '<option value="' + t + '"' + (i.tipo_item === t ? ' selected' : '') + '>' + escapar(rotuloDe('tipos_entrada', t)) + '</option>';
                    }).join('') + '</select></label>' +
                (cat
                    ? '<label class="pedido-campo largo">Item do catálogo<select data-linha="' + n + '" data-campo="' + cat.campo + '"' + dis + '>' +
                        opcoes(cat.lista, i[cat.campo], cat.rotulo, '— criar novo com o nome da nota —') + '</select></label>'
                    : '<p class="pedido-dica">Diga se é celular, peça ou produto para ligar ao catálogo.</p>') +
                campo('quantidade', 'Qtd', i.quantidade, { tipo: 'number', attrs: ' min="1" step="1"' }) +
                campo('valor_total', 'Valor da linha', i.valor_total, { tipo: 'number', attrs: ' min="0" step="0.01"' }) +
                campo('valor_desconto', 'Desconto', i.valor_desconto, { tipo: 'number', attrs: ' min="0" step="0.01"' }) +
                campo('valor_venda', 'Preço de venda (un.)', i.valor_venda, { tipo: 'number', attrs: ' min="0" step="0.01"' }) +
                campo('ncm', 'NCM', i.ncm, { attrs: ' maxlength="10"' }) +
                campo('codigo_fornecedor', 'Código no fornecedor', i.codigo_fornecedor, { attrs: ' maxlength="60"' }) +
                (i.tipo_item === 'celular'
                    ? '<label class="pedido-campo largo">IMEI (um por aparelho)<textarea data-linha="' + n + '" data-campo="imei" rows="' +
                        Math.max(1, Math.min(4, num(i.quantidade))) + '"' + dis + '>' + escapar(i.imei || '') + '</textarea></label>' +
                      '<label class="pedido-campo">Cor<select data-linha="' + n + '" data-campo="cor"' + dis + '><option value="">—</option>' +
                        ((estado.listas || {}).cores || []).map(function (c) {
                            return '<option' + (c.valor === i.cor ? ' selected' : '') + '>' + escapar(c.valor) + '</option>';
                        }).join('') + '</select></label>' +
                      '<label class="pedido-campo">Condição<select data-linha="' + n + '" data-campo="condicao"' + dis + '><option value="">—</option>' +
                        ['novo', 'seminovo', 'usado', 'defeito'].map(function (c) {
                            return '<option value="' + c + '"' + (c === i.condicao ? ' selected' : '') + '>' + escapar(rotuloDe('condicoes', c)) + '</option>';
                        }).join('') + '</select></label>'
                    : '') +
                (i.entrada_id ? '<p class="pedido-dica">Entrada nº ' + i.entrada_id + ' no estoque.</p>' : '') +
            '</div></div>';
    }

    function desenharEditor() {
        const p = atual;
        const travado = p.status !== 'rascunho';
        const dis = travado ? ' disabled' : '';
        const t = totais();
        const naturezasDeEntrada = naturezas.filter(function (n) { return n.sentido === 'entrada' && (n.ativa || String(n.id) === String(p.natureza_id)); });
        const cfopsEntrada = cfops.filter(function (c) { return c.sentido === 'entrada' && (c.permitido || c.codigo === p.cfop); });
        const cab = function (nome, rotulo, valor, tipo, attrs) {
            return '<div class="campo"><label for="ped-' + nome + '">' + escapar(rotulo) + '</label><input type="' + (tipo || 'text') + '" id="ped-' + nome +
                '" data-cab="' + nome + '" value="' + escapar(valor === null || valor === undefined ? '' : valor) + '"' + (attrs || '') + dis + '></div>';
        };
        raiz.innerHTML =
            '<div class="secao-topo"><div><h2 class="secao-titulo">' + escapar(p.numero) + ' ' +
                etiquetaTexto(rotuloDe('status_pedido', p.status), COR_STATUS[p.status]) + '</h2>' +
                (p.status === 'cancelado' ? '<p class="secao-descricao">Cancelado: ' + escapar(p.motivo_cancelamento || '') + '</p>' : '') +
                (p.tem_xml ? '<p class="secao-descricao">Veio do XML da NF-e. Chave ' + escapar(p.nota_chave) + '</p>' : '') +
            '</div><button type="button" class="botao botao-secundario" data-pedido="voltar">Voltar para a lista</button></div>' +

            '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-1)"></span>Cabeçalho</h3>' +
            '<div class="formulario">' +
                '<div class="campo"><label for="ped-natureza">Natureza da operação</label><select id="ped-natureza" data-cab="natureza_id"' + dis + '>' +
                    opcoes(naturezasDeEntrada, p.natureza_id, function (n) { return n.descricao; }, '— escolha —') + '</select></div>' +
                '<div class="campo"><label for="ped-fornecedor">Fornecedor</label><select id="ped-fornecedor" data-cab="fornecedor_id"' + dis + '>' +
                    opcoes(estado.fornecedores, p.fornecedor_id, function (f) { return f.nome + (f.uf ? ' (' + f.uf + ')' : ''); }, '— sem fornecedor —') + '</select></div>' +
                '<div class="campo"><label for="ped-cfop">CFOP</label><select id="ped-cfop" data-cab="cfop"' + dis + '>' +
                    '<option value="">Automático pela natureza e UF</option>' + cfopsEntrada.map(function (c) {
                        return '<option value="' + c.codigo + '"' + (c.codigo === p.cfop ? ' selected' : '') + '>' + fmtCfop(c.codigo) + ' - ' + escapar(c.descricao) + '</option>';
                    }).join('') + '</select>' +
                    (p.cfop ? '<small class="dica">Gravado: ' + fmtCfop(p.cfop) + (p.cfop_descricao ? ' - ' + escapar(p.cfop_descricao) : '') + '</small>' : '') + '</div>' +
                cab('nota_numero', 'Número da nota', p.nota_numero, 'text', ' maxlength="9"') +
                cab('nota_serie', 'Série', p.nota_serie, 'text', ' maxlength="3"') +
                cab('nota_chave', 'Chave de acesso (44)', p.nota_chave, 'text', ' maxlength="44"') +
                cab('valor_frete', 'Frete', p.valor_frete, 'number', ' min="0" step="0.01"') +
                cab('valor_outros', 'Outros (seguro, IPI, ST)', p.valor_outros, 'number', ' min="0" step="0.01"') +
                '<div class="campo"><label for="ped-forma">Forma de pagamento ao fornecedor</label><select id="ped-forma" data-cab="forma_pagamento_id"' + dis + '>' +
                    opcoes(estado.formasPagamento.filter(function (f) { return f.ativo || String(f.id) === String(p.forma_pagamento_id); }),
                           p.forma_pagamento_id, function (f) { return f.nome; }, '— não informada —') + '</select></div>' +
                '<div class="campo"><label class="interruptor"><input type="checkbox" data-cab="gerar_financeiro"' + (Number(p.gerar_financeiro) ? ' checked' : '') + dis + '>' +
                    '<span class="interruptor-trilho"><span class="interruptor-bola"></span></span>' +
                    '<span class="interruptor-texto">Gerar contas a pagar (se a natureza gera)</span></label></div>' +
                '<div class="campo campo-total"><label for="ped-obs">Observações</label><input type="text" id="ped-obs" data-cab="observacoes" maxlength="500" value="' +
                    escapar(p.observacoes || '') + '"' + dis + '></div>' +
            '</div></div>' +

            '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-2)"></span>Itens (' + p.lista_itens.length + ')' +
                (travado ? '' : '<button type="button" class="botao botao-pequeno" data-pedido="nova-linha">+ Linha</button>') + '</h3>' +
            (p.lista_itens.length ? p.lista_itens.map(function (i, n) { return linhaHtml(i, n, travado); }).join('')
                                  : vazio('Nenhuma linha. Use "+ Linha" ou importe o XML da nota.')) +
            '</div>' +

            '<div class="tables-grid">' +
            '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-4)"></span>Parcelas (duplicatas)' +
                (travado ? '' : '<button type="button" class="botao botao-pequeno" data-pedido="nova-parcela">+ Parcela</button>') + '</h3>' +
                (p.parcelas.length
                    ? '<div class="pedido-parcelas">' + p.parcelas.map(function (x, k) {
                        return '<div class="pedido-parcela">' +
                            '<label class="pedido-campo">Nº<input type="text" data-parcela="' + k + '" data-campo="numero" value="' + escapar(x.numero || '') + '"' + dis + '></label>' +
                            '<label class="pedido-campo">Vencimento<input type="date" data-parcela="' + k + '" data-campo="vencimento" value="' + escapar(x.vencimento || '') + '"' + dis + '></label>' +
                            '<label class="pedido-campo">Valor<input type="number" min="0" step="0.01" data-parcela="' + k + '" data-campo="valor" value="' + escapar(x.valor) + '"' + dis + '></label>' +
                            (travado ? '' : '<button type="button" class="botao-icone perigo-leve" data-pedido="tirar-parcela" data-n="' + k + '" aria-label="Tirar a parcela ' + (k + 1) + '">×</button>') +
                            '</div>';
                    }).join('') + '</div>'
                    : '<p class="pedido-dica">Sem parcelas: a conta a pagar sai numa só, no total, vencendo na data de entrada.</p>') +
                (p.parcelas.length && emCentavos(t.parcelas) !== emCentavos(t.total)
                    ? '<p class="pedido-alerta">As parcelas somam ' + moeda(t.parcelas) + ' e o total é ' + moeda(t.total) + '.</p>' : '') +
            '</div>' +
            '<div class="table-section pedido-totais"><h3 class="table-title"><span style="background:var(--serie-3)"></span>Totais</h3>' +
                '<div class="resumo-linha"><span>Produtos</span><span>' + moeda(t.produtos) + '</span></div>' +
                '<div class="resumo-linha"><span>Descontos</span><span>− ' + moeda(t.desconto) + '</span></div>' +
                '<div class="resumo-linha"><span>Frete + outros</span><span>' + moeda(num(p.valor_frete) + num(p.valor_outros)) + '</span></div>' +
                '<div class="resumo-total"><span>Total</span><strong id="pedTotal">' + moeda(t.total) + '</strong></div>' +
            '</div></div>' +

            (p.lancamentos && p.lancamentos.length
                ? '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-5)"></span>Contas a pagar criadas</h3>' +
                  tabelaHtml({ colunas: ['Descrição', 'Vencimento', 'Valor', 'Situação'], linhas: p.lancamentos.map(function (l) {
                      return [escapar(l.descricao), dataCurta(l.vencimento), moeda(l.valor), escapar(rotuloDe('status_lancamento', l.status))];
                  }) }) + '</div>'
                : '') +

            '<p class="pdv-erro" id="pedidoErro" role="alert"></p>' +
            '<div class="pedido-botoes">' +
            (p.status === 'rascunho'
                ? (podeConfirmar() && Number(p.gerar_financeiro)
                    ? '<label class="pedido-campo">Pagamento ao confirmar<select id="pedidoPago" data-cab="pago_agora">' +
                        [['0', 'Fica a pagar (vencimento ou parcelas)'], ['1', 'Já paguei (a conta nasce paga)']].map(function (o) {
                            return '<option value="' + o[0] + '"' + (String(pagoAgora(p)) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
                        }).join('') + '</select></label>'
                    : '') +
                  '<button type="button" class="botao" data-pedido="salvar">Salvar rascunho</button>' +
                  (podeConfirmar() ? '<button type="button" class="botao botao-confirmar" data-pedido="confirmar">Confirmar entrada</button>' : '') +
                  (p.id && estado.config.pode_admin ? '<button type="button" class="botao botao-secundario" data-pedido="apagar">Apagar rascunho</button>' : '')
                : '') +
            (p.status === 'confirmado' && estado.config.pode_admin
                ? '<label class="pedido-campo largo">Motivo do cancelamento<input type="text" id="pedidoMotivo" maxlength="300"></label>' +
                  '<button type="button" class="botao botao-secundario perigo" data-pedido="cancelar">Cancelar entrada</button>'
                : '') +
            '</div>';
    }

    function erro(texto) {
        const el = document.getElementById('pedidoErro');
        if (el) el.textContent = texto || '';
    }

    /*
     * "Já paguei" ou "fica a pagar", escolhido na hora de confirmar (nao vai
     * para o banco: so muda as contas que a confirmacao cria). Sem escolha,
     * a nota importada ou com parcelas fica a pagar; a digitada (a peca
     * comprada na hora, o usado pago no balcao) ja nasce paga, como fazia a
     * entrada avulsa.
     */
    function pagoAgora(p) {
        if (p.pago_agora !== undefined && p.pago_agora !== '') return Number(p.pago_agora) ? 1 : 0;
        return p.tem_xml || p.parcelas.length ? 0 : 1;
    }

    /*
     * O que outra tela pediu para abrir: { novo: true } ou { id }. Fica
     * guardado e o carregar() desta tela abre - abrir direto correria com o
     * carregar() que o mostrarSecao dispara (e a lista venceria).
     */
    let pendente = null;

    /* Abre a tela Entradas numa entrada nova, com uma linha (o "+ Nova entrada" do Estoque). */
    function novaEntrada() {
        pendente = { novo: true };
        atual = null;
        N.mostrarSecao('pedidos', true);
    }

    /* Abre a tela Entradas num documento (o Estoque mostra "Entrada PE-..."). */
    function abrirEntrada(id) {
        pendente = { id: Number(id) };
        atual = null;
        N.mostrarSecao('pedidos', true);
    }

    async function abrir(id) {
        await Promise.all([carregarCatalogos(), carregarApoio()]);
        atual = id ? (await api.get('/pedidos/' + id)).pedido : novoPedido();
        atual.lista_itens.forEach(function (i) {
            ['modelo_id', 'peca_id', 'produto_id', 'tipo_item', 'imei', 'cor', 'condicao', 'ncm', 'codigo_fornecedor'].forEach(function (c) {
                if (i[c] === null || i[c] === undefined) i[c] = '';
            });
        });
        desenharEditor();
        window.scrollTo({ top: 0 });
    }

    function corpoDoPedido() {
        return {
            natureza_id: atual.natureza_id, fornecedor_id: atual.fornecedor_id || null, cfop: atual.cfop || null,
            nota_numero: atual.nota_numero, nota_serie: atual.nota_serie, nota_chave: atual.nota_chave, nota_emissao: atual.nota_emissao,
            valor_frete: num(atual.valor_frete), valor_outros: num(atual.valor_outros), gerar_financeiro: Number(atual.gerar_financeiro) ? 1 : 0,
            forma_pagamento_id: atual.forma_pagamento_id || null, observacoes: atual.observacoes,
            itens: atual.lista_itens.map(function (i) {
                return { tipo_item: i.tipo_item || null, modelo_id: i.modelo_id || null, peca_id: i.peca_id || null, produto_id: i.produto_id || null,
                         descricao: i.descricao, codigo_fornecedor: i.codigo_fornecedor || null, gtin: i.gtin || null, ncm: i.ncm || null,
                         cest: i.cest || null, cfop_nota: i.cfop_nota || null, unidade: i.unidade || null, quantidade: num(i.quantidade),
                         valor_total: num(i.valor_total), valor_desconto: num(i.valor_desconto), valor_venda: num(i.valor_venda),
                         imei: i.imei || null, cor: i.cor || null, condicao: i.condicao || null };
            }),
            parcelas: atual.parcelas.map(function (x) { return { numero: x.numero || null, vencimento: x.vencimento, valor: num(x.valor) }; }),
        };
    }

    async function salvar() {
        const r = atual.id ? await api.put('/pedidos/' + atual.id, corpoDoPedido()) : await api.post('/pedidos', corpoDoPedido());
        const id = atual.id || r.id;
        avisar(mensagemDe(r, 'Rascunho gravado.'));
        await abrir(id);
        return id;
    }

    async function carregarApoio() {
        const r = await Promise.all([api.get('/naturezas'), api.get('/cfops')]);
        naturezas = r[0].itens;
        cfops = r[1].itens;
    }

    async function importarXml(arquivo) {
        if (!arquivo) return;
        if (arquivo.size > 3000000) { avisar('O arquivo é grande demais para um XML de nota (limite de 3 MB).', 'erro'); return; }
        try {
            const r = await api.post('/pedidos', { xml: await arquivo.text() });
            avisar(mensagemDe(r, 'Nota importada.'));
            await abrir(r.id);
        } catch (falha) {
            avisar(falha.message, 'erro');
        }
    }

    raiz.addEventListener('click', async function (evento) {
        const alvo = evento.target.closest('[data-pedido]');
        if (!alvo) return;
        const n = Number(alvo.dataset.n);
        try {
            switch (alvo.dataset.pedido) {
                // Entrada nova ja com uma linha: a compra digitada quase sempre tem um item so.
                case 'novo': await abrir(null); atual.lista_itens.push(linhaVazia()); desenharEditor(); break;
                case 'abrir': await abrir(Number(alvo.dataset.id)); break;
                case 'voltar': await carregarLista(); break;
                case 'nova-linha': atual.lista_itens.push(linhaVazia()); desenharEditor(); break;
                case 'tirar-linha': atual.lista_itens.splice(n, 1); desenharEditor(); break;
                case 'nova-parcela': atual.parcelas.push({ numero: '', vencimento: '', valor: 0 }); desenharEditor(); break;
                case 'tirar-parcela': atual.parcelas.splice(n, 1); desenharEditor(); break;
                case 'salvar': erro(''); await salvar(); break;
                case 'confirmar': {
                    erro('');
                    // Lido antes de salvar: o salvar recarrega o documento do servidor.
                    const pago = !!Number(atual.gerar_financeiro) && pagoAgora(atual) === 1;
                    const id = await salvar();
                    if (!confirm('Confirmar a entrada? A mercadoria entra no estoque e ' +
                                 (pago ? 'a conta já nasce paga (Já paguei).' : 'as contas a pagar são criadas.'))) return;
                    avisar(mensagemDe(await api.post('/pedidos/' + id + '/confirmar', { pago: pago ? 1 : 0 }), 'Entrada confirmada.'));
                    await abrir(id);
                    break;
                }
                case 'apagar':
                    if (!confirm('Apagar o rascunho ' + atual.numero + '?')) return;
                    avisar(mensagemDe(await api.remover('/pedidos/' + atual.id), 'Rascunho apagado.'));
                    await carregarLista();
                    break;
                case 'cancelar': {
                    const motivo = document.getElementById('pedidoMotivo').value;
                    avisar(mensagemDe(await api.post('/pedidos/' + atual.id + '/cancelar', { motivo: motivo }), 'Entrada cancelada.'));
                    await abrir(atual.id);
                    break;
                }
            }
        } catch (falha) {
            erro(falha.message);
            avisar(falha.message, 'erro');
        }
    });

    function guardar(evento) {
        const el = evento.target;
        const valor = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
        if (el.dataset.cab) { atual[el.dataset.cab] = valor; }
        else if (el.dataset.linha !== undefined) { atual.lista_itens[Number(el.dataset.linha)][el.dataset.campo] = valor; }
        else if (el.dataset.parcela !== undefined) { atual.parcelas[Number(el.dataset.parcela)][el.dataset.campo] = valor; }
        else return false;
        return true;
    }

    raiz.addEventListener('input', function (evento) {
        if (!atual || !guardar(evento)) return;
        const t = totais();
        const total = document.getElementById('pedTotal');
        if (total) total.textContent = moeda(t.total);
    });

    raiz.addEventListener('change', function (evento) {
        if (evento.target.id === 'filtroPedido') { filtro = evento.target.value; desenharLista(); return; }
        if (evento.target.id === 'pedidoXml') { importarXml(evento.target.files[0]); evento.target.value = ''; return; }
        if (!atual || !guardar(evento)) return;
        // Mudou o tipo da linha ou a quantidade de celular: o desenho da linha muda.
        if (['tipo_item', 'quantidade'].indexOf(evento.target.dataset.campo) !== -1 || evento.target.dataset.parcela !== undefined ||
            ['valor_frete', 'valor_outros', 'gerar_financeiro'].indexOf(evento.target.dataset.cab) !== -1) {
            desenharEditor();
        }
    });

    async function carregarPedidos() {
        await Promise.all([carregarApoio(), carregarCatalogos()]);
        if (pendente) {
            const pedido = pendente;
            pendente = null;
            if (pedido.id) { await abrir(pedido.id); return; }
            await abrir(null);
            atual.lista_itens.push(linhaVazia());
            desenharEditor();
            return;
        }
        if (atual && atual.id) { await abrir(atual.id); return; }
        await carregarLista();
    }

    N.registrarTela('pedidos', { titulo: 'Entradas', carregar: carregarPedidos });
    janela.Telas = janela.Telas || {};
    janela.Telas.pedidos = { carregar: carregarPedidos, abrir: abrir, novaEntrada: novaEntrada, abrirEntrada: abrirEntrada };
})(window);
