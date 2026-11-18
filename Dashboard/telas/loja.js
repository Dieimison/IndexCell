// carga: usa Formato, Nucleo, Janela; publica Telas.loja  (conferido por testes/front/carga.test.js)
/*
 * telas/loja.js - a loja online do lado da loja (v8). Window.Telas.loja. So admin.
 *
 *   Encomendas  o que os clientes encomendaram na vitrine (Loja\). Cada uma
 *               abre numa janela com o que fazer agora: confirmar o pagamento
 *               (nasce a venda: estoque + financeiro), avancar a entrega um
 *               passo (o cliente ve no rastreio) ou cancelar com o motivo.
 *   Anuncios    o que aparece na vitrine: um item do estoque, com titulo,
 *               preco da loja online, descricao e ate 4 fotos (reduzidas
 *               aqui antes de subir). Tirar da vitrine nao apaga.
 *   Ajustes     aberta ou fechada, frete, prazos, chave Pix e de onde sai.
 *
 * Quem confere tudo e o servidor (api/rotas/loja.php); a tela so mostra.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, horaCurta } = janela.Formato;
    const N = janela.Nucleo;
    const { api, avisar, mensagemDe, rotuloDe, opcoesDoDominio, etiquetaTexto, tabelaHtml, vazio, identificacaoDoAparelho } = N;
    const J = janela.Janela;

    const raiz = document.getElementById('lojaConteudo');
    const FOTOS_MAX = 4;
    const LADO_MAX = 1280;           // a foto sobe com no maximo 1280 px no lado maior
    const BYTES_MAX = 1000000;       // e abaixo de 1 MB (o servidor recusa acima)
    const COR_STATUS = { aguardando_pagamento: '--atencao', pago: '--serie-1', separacao: '--serie-1', enviado: '--serie-1',
                         em_transito: '--serie-1', saiu_entrega: '--serie-5', entregue: '--bom', cancelada: '--critico' };
    let aba = 'encomendas';
    let filtro = '';
    let dados = { encomendas: [], contagem: {}, anuncios: [], ajustes: null };

    function quando(texto) {
        return texto ? dataCurta(texto) + ' ' + horaCurta(texto) : '—';
    }
    function statusHtml(status) {
        return etiquetaTexto(rotuloDe('status_encomenda', status), COR_STATUS[status] || '--tinta-fraca');
    }

    // ------------------------------------------------------------------
    // Desenho
    // ------------------------------------------------------------------
    function desenhar() {
        const a = dados.ajustes;
        const aguardando = dados.contagem.aguardando_pagamento || 0;
        raiz.innerHTML =
            '<div class="loja-faixa">' +
                '<span>' + (a && a.aberta ? etiquetaTexto('Aberta para encomendas', '--bom') : etiquetaTexto('Fechada para encomendas', '--atencao')) + '</span>' +
                '<a class="botao botao-pequeno botao-secundario" href="../Loja/index.html" target="_blank" rel="noopener">Abrir a vitrine</a>' +
            '</div>' +
            '<div class="sub-abas" role="tablist" aria-label="Partes da loja online">' +
                [['encomendas', 'Encomendas' + (aguardando ? ' (' + aguardando + ' a pagar)' : '')], ['anuncios', 'Anúncios'], ['ajustes', 'Ajustes']].map(function (x) {
                    return '<button type="button" role="tab" aria-selected="' + (x[0] === aba) + '" class="sub-aba' + (x[0] === aba ? ' ativa' : '') +
                        '" data-aba-loja="' + x[0] + '">' + escapar(x[1]) + '</button>';
                }).join('') +
            '</div><div class="admin-painel">' +
            (aba === 'encomendas' ? desenharEncomendas() : aba === 'anuncios' ? desenharAnuncios() : desenharAjustes()) + '</div>';
    }

    function desenharEncomendas() {
        const filtros = [['', 'Todas']].concat(opcoesDoDominio('status_encomenda').map(function (o) { return [o.valor, o.rotulo]; }));
        const total = Object.keys(dados.contagem).reduce(function (s, k) { return s + dados.contagem[k]; }, 0);
        return '<div class="table-section">' +
            '<h3 class="table-title"><span style="background:var(--serie-1)"></span>Encomendas da loja online</h3>' +
            '<p class="secao-descricao">A encomenda reserva o item até o prazo de pagamento. Confirme o pagamento só depois de ver o Pix na ' +
                'conta: aí nasce a venda (o estoque baixa e o Financeiro recebe). Depois, avance a entrega passo a passo; o cliente acompanha pelo rastreio.</p>' +
            '<div class="loja-filtros" role="tablist" aria-label="Filtrar por situação">' + filtros.map(function (f) {
                const n = f[0] ? (dados.contagem[f[0]] || 0) : total;
                return '<button type="button" class="loja-filtro' + (filtro === f[0] ? ' ativo' : '') + '" aria-pressed="' + (filtro === f[0]) +
                    '" data-filtro-encomenda="' + f[0] + '">' + escapar(f[1]) + ' <small>' + n + '</small></button>';
            }).join('') + '</div>' +
            (dados.encomendas.length
                ? tabelaHtml({
                    colunas: ['Encomenda', 'Cliente', 'Itens', 'Total', 'Situação', 'Atualizada', { titulo: 'Ações', classe: 'coluna-acoes' }],
                    linhas: dados.encomendas.map(function (e) {
                        return ['<strong>' + escapar(e.numero) + '</strong><br><small class="observacao">' + quando(e.criado_em) + '</small>',
                                escapar(e.cliente) + '<br><small class="observacao">' + escapar(e.entrega_cidade + '/' + e.entrega_uf) + '</small>',
                                escapar(e.itens_texto), moeda(e.valor_total), statusHtml(e.status), quando(e.atualizado_em),
                                { classe: 'coluna-acoes', html: '<button type="button" class="botao-icone" data-abrir-encomenda="' + e.id + '">Abrir</button>' }];
                    }),
                })
                : vazio(filtro ? 'Nenhuma encomenda "' + rotuloDe('status_encomenda', filtro) + '".' : 'Nenhuma encomenda ainda. Quando um cliente encomendar na vitrine, ela aparece aqui.')) +
        '</div>';
    }

    function desenharAnuncios() {
        return '<div class="table-section">' +
            '<h3 class="table-title"><span style="background:var(--serie-3)"></span>Anúncios da vitrine' +
                '<button type="button" class="botao botao-pequeno" data-novo-anuncio>+ Novo anúncio</button></h3>' +
            '<p class="secao-descricao">Cada anúncio vende um item do estoque (Entradas). "Disponível" é o saldo menos o que encomendas ' +
                'aguardando pagamento estão segurando. O preço é o da loja online e pode ser diferente do balcão.</p>' +
            (dados.anuncios.length
                ? '<div class="loja-anuncios">' + dados.anuncios.map(function (a) {
                    return '<article class="loja-anuncio' + (a.publicado ? '' : ' fora') + '">' +
                        '<div class="loja-anuncio-foto">' + (a.fotos.length
                            ? '<img src="/api/fotos-anuncio/' + a.fotos[0] + '" alt="" loading="lazy">'
                            : '<span>sem foto</span>') + '</div>' +
                        '<div class="loja-anuncio-corpo">' +
                            '<strong>' + escapar(a.titulo) + '</strong>' +
                            '<span class="observacao">' + escapar(a.tipo_rotulo + ': ' + a.item + identificacaoDoAparelho(a)) + '</span>' +
                            '<span class="loja-anuncio-preco">' + moeda(a.preco) +
                                (a.preco_balcao && Math.round(a.preco_balcao * 100) !== Math.round(a.preco * 100)
                                    ? ' <small class="observacao">(balcão ' + moeda(a.preco_balcao) + ')</small>' : '') + '</span>' +
                            '<span>' + (a.disponivel > 0 ? etiquetaTexto(a.disponivel + ' disponível(is)', '--bom') : etiquetaTexto('Esgotado', '--critico')) +
                                (a.reservado ? ' ' + etiquetaTexto(a.reservado + ' reservado(s)', '--atencao') : '') +
                                (a.publicado ? '' : ' ' + etiquetaTexto('Fora da vitrine', '--tinta-fraca')) +
                                (a.vendidos ? ' <small class="observacao">' + a.vendidos + ' vendido(s) online</small>' : '') + '</span>' +
                            (a.disponivel > 0 || a.reservado ? ''
                                : '<small class="observacao">' + (a.tipo === 'celular' && a.situacao === 'vendido'
                                    ? 'Aparelho vendido: já saiu da vitrine sozinho.'
                                    : 'Chegou mais? A reposição entra como outra entrada: em Editar, escolha o item novo.') + '</small>') +
                        '</div>' +
                        '<div class="loja-anuncio-acoes">' +
                            '<button type="button" class="botao-icone" data-editar-anuncio="' + a.id + '">Editar</button>' +
                            '<button type="button" class="botao-icone" data-publicar-anuncio="' + a.id + '" data-publicado="' + a.publicado + '">' +
                                (a.publicado ? 'Tirar da vitrine' : 'Publicar') + '</button>' +
                            '<button type="button" class="botao-icone botao-perigo" data-excluir-anuncio="' + a.id + '">Excluir</button>' +
                        '</div>' +
                    '</article>';
                }).join('') + '</div>'
                : vazio('Nenhum anúncio. Clique em "+ Novo anúncio" e escolha um item do estoque.')) +
        '</div>';
    }

    function desenharAjustes() {
        const a = dados.ajustes;
        const campo = function (id, rotulo, valor, extra) {
            extra = extra || {};
            return '<div class="campo' + (extra.total ? ' campo-total' : '') + '"><label for="loja-' + id + '">' + escapar(rotulo) + '</label>' +
                '<input type="' + (extra.tipo || 'text') + '" id="loja-' + id + '" name="' + id + '" value="' + escapar(valor === null || valor === undefined ? '' : valor) + '"' +
                (extra.attrs || '') + '>' + (extra.dica ? '<small class="dica">' + escapar(extra.dica) + '</small>' : '') + '</div>';
        };
        return '<div class="table-section">' +
            '<h3 class="table-title"><span style="background:var(--serie-4)"></span>Ajustes da loja online</h3>' +
            '<form id="formLojaAjustes" class="formulario">' +
                '<div class="campo campo-total"><span class="rotulo-campo">Encomendas</span>' +
                    '<label class="interruptor"><input type="checkbox" id="loja-aberta" name="aberta"' + (a.aberta ? ' checked' : '') + '>' +
                    '<span class="interruptor-trilho"><span class="interruptor-bola"></span></span>' +
                    '<span class="interruptor-texto">Aceitar encomendas na vitrine</span></label>' +
                    '<small class="dica">Desligado, a vitrine continua no ar (o cliente olha e monta o carrinho), mas não finaliza.</small></div>' +
                campo('nome_vitrine', 'Nome na vitrine', a.nome_vitrine, { dica: 'Vazio: o nome da empresa (' + a.nome + ').', attrs: ' maxlength="80"' }) +
                campo('cidade_origem', 'De onde a encomenda sai', a.cidade_origem, { dica: 'Começo da linha do rastreio. Ex.: São Paulo/SP.', attrs: ' maxlength="80"' }) +
                campo('chave_pix', 'Chave Pix para receber', a.chave_pix, { dica: 'Obrigatória para abrir. O cliente vê depois de encomendar.', attrs: ' maxlength="120"' }) +
                campo('recebedor_pix', 'Nome de quem recebe o Pix', a.recebedor_pix, { attrs: ' maxlength="80"' }) +
                campo('frete_fixo', 'Frete (R$)', a.frete_fixo, { tipo: 'number', attrs: ' min="0" step="0.01" inputmode="decimal"', dica: '0 = frete grátis sempre.' }) +
                campo('frete_gratis_acima', 'Frete grátis a partir de (R$)', a.frete_gratis_acima, { tipo: 'number', attrs: ' min="0" step="0.01" inputmode="decimal"', dica: '0 = nunca.' }) +
                campo('prazo_pagamento_horas', 'Prazo para pagar (horas)', a.prazo_pagamento_horas, { tipo: 'number', attrs: ' min="1" max="720" step="1"',
                      dica: 'Passou do prazo sem pagamento: a reserva cai e a encomenda é cancelada sozinha.' }) +
                campo('prazo_entrega_dias', 'Prazo de entrega (dias)', a.prazo_entrega_dias, { tipo: 'number', attrs: ' min="1" max="90" step="1"',
                      dica: 'A previsão que o cliente vê, contada do pagamento.' }) +
                '<div class="campo-total"><button type="submit" class="botao">Salvar ajustes</button></div>' +
            '</form></div>';
    }

    // ------------------------------------------------------------------
    // Carga
    // ------------------------------------------------------------------
    async function carregarLoja() {
        const r = await Promise.all([api.get('/encomendas' + (filtro ? '?status=' + encodeURIComponent(filtro) : '')),
                                     api.get('/anuncios'), api.get('/loja-ajustes')]);
        dados = { encomendas: r[0].itens, contagem: r[0].contagem, anuncios: r[1].itens, ajustes: r[2].ajustes };
        desenhar();
    }

    // ------------------------------------------------------------------
    // Encomenda: a janela com o que fazer agora
    // ------------------------------------------------------------------
    async function abrirEncomenda(id) {
        let e;
        try {
            e = (await api.get('/encomendas/' + id)).encomenda;
        } catch (erro) {
            avisar(erro.message, 'erro');
            return;
        }
        const fim = e.status === 'entregue' || e.status === 'cancelada';
        const pagar = e.status === 'aguardando_pagamento';
        const enviar = e.proximo === 'enviado';
        const end = e.entrega;
        const html =
            '<div class="campo-total loja-detalhe">' +
                '<p>' + statusHtml(e.status) + ' <span class="observacao">feita em ' + quando(e.criado_em) +
                    (pagar ? ' · pagar até ' + quando(e.pagar_ate) : '') +
                    (e.previsao_entrega && !fim ? ' · previsão ' + dataCurta(e.previsao_entrega) : '') + '</span></p>' +
                (e.status === 'cancelada' ? '<p class="modal-erro-texto">Cancelada: ' + escapar(e.motivo_cancelamento || '') + '</p>' : '') +
                '<div class="loja-detalhe-grade">' +
                    '<div><h4 class="sub-titulo">Cliente</h4><p>' + escapar(e.conta.nome) + '<br>' + escapar(e.conta.email) + '<br>' +
                        escapar(end.telefone || e.conta.telefone) + (e.conta.cpf ? '<br>CPF ' + escapar(e.conta.cpf) : '') + '</p></div>' +
                    '<div><h4 class="sub-titulo">Entregar em</h4><p>' + escapar(end.destinatario) + '<br>' +
                        escapar(end.logradouro + ', ' + end.numero + (end.complemento ? ' - ' + end.complemento : '')) + '<br>' +
                        escapar(end.bairro + ' - ' + end.cidade + '/' + end.uf) + '<br>CEP ' + escapar(end.cep) + '</p>' +
                        (e.observacoes ? '<p class="observacao">Recado: ' + escapar(e.observacoes) + '</p>' : '') + '</div>' +
                '</div>' +
                tabelaHtml({ colunas: ['Item', 'Qtd', 'Preço', 'Subtotal'], linhas: e.itens.map(function (i) {
                    return [escapar(i.descricao), String(i.quantidade), moeda(i.valor_unitario), moeda(i.subtotal)];
                }).concat([['Frete', '', '', e.frete > 0 ? moeda(e.frete) : 'Grátis'], ['<strong>Total</strong>', '', '', '<strong>' + moeda(e.valor_total) + '</strong>']]) }) +
                (e.venda ? '<p class="observacao">Venda ' + escapar(e.venda.numero) + ' (' + escapar(e.venda.status) + ') · forma Pix.</p>' : '') +
                (e.codigo_rastreio ? '<p class="observacao">' + escapar(e.transportadora || 'Transportadora') + ': ' + escapar(e.codigo_rastreio) + '</p>' : '') +
                '<h4 class="sub-titulo">Rastreio (o que o cliente vê)</h4>' +
                '<ol class="loja-trilha">' + e.trilha.map(function (t) {
                    return '<li class="' + (t.feito ? 'feito' : '') + (t.atual ? ' atual' : '') + '"><span>' + escapar(t.rotulo) + '</span><small>' +
                        (t.momento ? quando(t.momento) : '') + '</small></li>';
                }).join('') + '</ol>' +
                '<details class="loja-eventos"><summary>Histórico (' + e.eventos.length + ')</summary><ul>' + e.eventos.map(function (ev) {
                    return '<li><small>' + quando(ev.momento) + '</small> <strong>' + escapar(ev.rotulo) + '</strong>' + (ev.local ? ' · ' + escapar(ev.local) : '') +
                        (ev.observacao ? ' — ' + escapar(ev.observacao) : '') + (ev.usuario ? ' <small class="observacao">(' + escapar(ev.usuario) + ')</small>' : '') + '</li>';
                }).join('') + '</ul></details>' +
            '</div>' +
            (pagar
                ? '<div class="campo campo-total"><p class="loja-aviso-pagamento">Confira se o Pix de <strong>' + moeda(e.valor_total) + '</strong> caiu na conta ' +
                    '(o cliente deve ter escrito ' + escapar(e.numero) + ' na mensagem). Confirmar registra a venda e baixa o estoque.</p></div>' +
                  '<div class="campo campo-total"><label for="campo-observacao">Observação (opcional)</label>' +
                    '<input type="text" id="campo-observacao" name="observacao" maxlength="300" placeholder="Ex.: Pix recebido às 14h"></div>'
                : '') +
            (!fim && !pagar
                ? '<div class="campo"><label for="campo-local">Onde está (opcional)</label><input type="text" id="campo-local" name="local" maxlength="120" ' +
                    'placeholder="' + (enviar ? 'Ex.: ' + escapar(e.origem) : 'Ex.: Centro de distribuição') + '"></div>' +
                  '<div class="campo"><label for="campo-observacao">Recado para o cliente (opcional)</label>' +
                    '<input type="text" id="campo-observacao" name="observacao" maxlength="300"></div>' +
                  (enviar ? '<div class="campo"><label for="campo-transportadora">Transportadora</label><input type="text" id="campo-transportadora" ' +
                      'name="transportadora" maxlength="60" placeholder="Correios, motoboy..." value="' + escapar(e.transportadora || '') + '"></div>' +
                    '<div class="campo"><label for="campo-codigo_rastreio">Código de rastreio</label><input type="text" id="campo-codigo_rastreio" ' +
                      'name="codigo_rastreio" maxlength="40" value="' + escapar(e.codigo_rastreio || '') + '"></div>' : '')
                : '') +
            (e.pode_cancelar
                ? '<details class="campo-total loja-cancelar"><summary>Cancelar esta encomenda</summary>' +
                    '<p class="observacao">' + (e.venda ? 'Já está paga: a venda ' + escapar(e.venda.numero) + ' é cancelada junto, o item volta ao estoque e ' +
                        'o recebido é estornado no Financeiro. Devolva o dinheiro ao cliente.' : 'A reserva do item é desfeita. Nada foi cobrado.') + '</p>' +
                    '<label for="motivoCancelar">Motivo (o cliente vê)</label><input type="text" id="motivoCancelar" maxlength="300">' +
                    '<button type="button" class="botao botao-perigo" data-cancelar-encomenda="' + e.id + '">Cancelar encomenda</button></details>'
                : '');

        J.abrirModal({
            titulo: 'Encomenda ' + e.numero,
            html: html,
            somenteLeitura: fim,
            textoSalvar: pagar ? 'Confirmar pagamento' : ('Avançar para: ' + (e.proximo_rotulo || '')),
            aoSalvar: fim ? null : async function (valores) {
                const r = pagar
                    ? await api.post('/encomendas/' + e.id + '/pagamento', { observacao: valores.observacao || '' })
                    : await api.post('/encomendas/' + e.id + '/avancar', Object.assign({ para: e.proximo }, valores));
                avisar(mensagemDe(r, 'Encomenda atualizada.'));
                await carregarLoja();
            },
        });
    }

    async function cancelarEncomenda(botao) {
        const motivo = document.getElementById('motivoCancelar').value.trim();
        if (!motivo) {
            J.mostrarErroNoModal('Escreva o motivo do cancelamento: o cliente vê no rastreio.');
            document.getElementById('motivoCancelar').focus();
            return;
        }
        botao.disabled = true;
        try {
            const r = await api.post('/encomendas/' + botao.dataset.cancelarEncomenda + '/cancelar', { motivo: motivo });
            J.fecharModal();
            avisar(mensagemDe(r, 'Encomenda cancelada.'));
            await carregarLoja();
        } catch (erro) {
            botao.disabled = false;
            J.mostrarErroNoModal(erro.message);
        }
    }

    // ------------------------------------------------------------------
    // Anuncio: a janela de cadastro, com as fotos
    // ------------------------------------------------------------------
    let fotosNovas = [];      // data URLs ja reduzidas
    let fotosRemover = [];

    async function abrirAnuncio(a) {
        let itens;
        try {
            itens = (await api.get('/entradas?disponivel=1')).itens;
        } catch (erro) {
            avisar(erro.message, 'erro');
            return;
        }
        // O item do anuncio em edicao entra na lista mesmo esgotado (para continuar escolhido).
        if (a && !itens.some(function (i) { return i.id === a.entrada_id; })) {
            itens.unshift({ id: a.entrada_id, tipo: a.tipo, item: a.item, saldo: a.saldo, valor_venda: a.preco_balcao, imei: a.imei, cor: a.cor });
        }
        fotosNovas = [];
        fotosRemover = [];
        const opcoes = [{ valor: '', rotulo: '— escolha o item do estoque —' }].concat(itens.map(function (i) {
            return { valor: String(i.id), rotulo: rotuloDe('tipos_entrada', i.tipo) + ': ' + i.item + identificacaoDoAparelho(i) +
                     ' (saldo ' + i.saldo + ', balcão ' + moeda(i.valor_venda) + ')' };
        }));
        J.abrirModal({
            titulo: a ? 'Anúncio: ' + a.titulo : 'Novo anúncio na vitrine',
            textoSalvar: a ? 'Salvar anúncio' : 'Publicar anúncio',
            campos: [
                { nome: 'entrada_id', rotulo: 'Item do estoque', tipo: 'select', valor: a ? String(a.entrada_id) : '', opcoes: opcoes, largura: 'total' },
                { nome: 'titulo', rotulo: 'Título na vitrine', valor: a ? a.titulo : '', largura: 'total', dica: 'Vazio: o nome do item do estoque.' },
                { nome: 'preco', rotulo: 'Preço na loja online (R$)', tipo: 'number', valor: a ? a.preco : '', minimo: 0.01, passo: 0.01 },
                { nome: 'publicado', rotulo: 'Na vitrine', tipo: 'checkbox', valor: a ? !!a.publicado : true, textoSim: 'Publicado' },
                { nome: 'descricao', rotulo: 'Descrição (o cliente vê)', tipo: 'textarea', valor: a ? (a.descricao || '') : '', largura: 'total' },
                { tipo: 'html', html: '<div class="campo campo-total"><span class="rotulo-campo">Fotos (até ' + FOTOS_MAX + ')</span>' +
                    '<div class="loja-fotos" id="lojaFotos">' + (a ? a.fotos.map(function (f) {
                        return '<figure class="loja-foto" data-foto-existente="' + f + '"><img src="/api/fotos-anuncio/' + f + '" alt="">' +
                            '<button type="button" class="botao-icone" data-remover-foto="' + f + '">Remover</button></figure>';
                    }).join('') : '') + '</div>' +
                    '<label class="botao botao-secundario botao-pequeno loja-escolher-foto">Escolher fotos' +
                        '<input type="file" id="lojaArquivos" accept="image/jpeg,image/png,image/webp" multiple hidden></label>' +
                    '<small class="dica">JPG, PNG ou WEBP. A foto é reduzida aqui antes de enviar.</small></div>' },
            ],
            aoAbrir: function () {
                const select = document.getElementById('campo-entrada_id');
                select.addEventListener('change', function () {
                    const i = itens.find(function (x) { return String(x.id) === select.value; });
                    if (!i) return;
                    const titulo = document.getElementById('campo-titulo');
                    const preco = document.getElementById('campo-preco');
                    if (!titulo.value) titulo.value = i.item;
                    if (!preco.value && Number(i.valor_venda) > 0) preco.value = Number(i.valor_venda).toFixed(2);
                });
                document.getElementById('lojaArquivos').addEventListener('change', function (evento) {
                    acrescentarFotos(Array.from(evento.target.files));
                    evento.target.value = '';
                });
            },
            aoSalvar: async function (valores) {
                const corpo = Object.assign({}, valores, { fotos_novas: fotosNovas, fotos_remover: fotosRemover });
                const r = a ? await api.put('/anuncios/' + a.id, corpo) : await api.post('/anuncios', corpo);
                avisar(mensagemDe(r, 'Anúncio gravado.'));
                await carregarLoja();
            },
        });
    }

    function fotosNaJanela() {
        return document.querySelectorAll('#lojaFotos .loja-foto').length;
    }

    async function acrescentarFotos(arquivos) {
        for (const arquivo of arquivos) {
            if (fotosNaJanela() >= FOTOS_MAX) {
                avisar('Cada anúncio leva no máximo ' + FOTOS_MAX + ' fotos.', 'erro');
                break;
            }
            try {
                const url = await reduzir(arquivo);
                fotosNovas.push(url);
                const fig = document.createElement('figure');
                fig.className = 'loja-foto';
                fig.dataset.fotoNova = String(fotosNovas.length - 1);
                fig.innerHTML = '<img src="' + url + '" alt=""><button type="button" class="botao-icone" data-remover-nova>Remover</button>';
                document.getElementById('lojaFotos').appendChild(fig);
            } catch (erro) {
                avisar('"' + arquivo.name + '": ' + erro.message, 'erro');
            }
        }
    }

    /* A foto do celular (4000 px, 5 MB) vira um JPG de ate 1280 px e menos de 1 MB. */
    function reduzir(arquivo) {
        return new Promise(function (resolver, recusar) {
            if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) { recusar(new Error('não é uma foto JPG, PNG ou WEBP.')); return; }
            const leitor = new FileReader();
            leitor.onerror = function () { recusar(new Error('não consegui ler o arquivo.')); };
            leitor.onload = function () {
                const img = new Image();
                img.onerror = function () { recusar(new Error('o arquivo não abriu como foto.')); };
                img.onload = function () {
                    const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
                    const tela = document.createElement('canvas');
                    tela.width = Math.max(1, Math.round(img.width * escala));
                    tela.height = Math.max(1, Math.round(img.height * escala));
                    const ctx = tela.getContext('2d');
                    ctx.fillStyle = '#ffffff';             // PNG transparente vira fundo branco no JPG
                    ctx.fillRect(0, 0, tela.width, tela.height);
                    ctx.drawImage(img, 0, 0, tela.width, tela.height);
                    let qualidade = 0.86;
                    let url = tela.toDataURL('image/jpeg', qualidade);
                    while (url.length * 0.75 > BYTES_MAX && qualidade > 0.4) {
                        qualidade -= 0.12;
                        url = tela.toDataURL('image/jpeg', qualidade);
                    }
                    if (url.length * 0.75 > BYTES_MAX) { recusar(new Error('a foto continua grande demais.')); return; }
                    resolver(url);
                };
                img.src = leitor.result;
            };
            leitor.readAsDataURL(arquivo);
        });
    }

    // ------------------------------------------------------------------
    // Eventos
    // ------------------------------------------------------------------
    raiz.addEventListener('click', async function (evento) {
        const alvo = evento.target.closest('button');
        if (!alvo) return;
        if (alvo.dataset.abaLoja) {
            // Trocar de aba busca de novo (a encomenda que o cliente acabou de fazer aparece) e
            // so desenha quando os dados chegam: nada redesenha um formulario em que a pessoa ja digita.
            aba = alvo.dataset.abaLoja;
            alvo.disabled = true;
            try { await carregarLoja(); } catch (erro) { desenhar(); avisar(erro.message, 'erro'); }
            return;
        }
        if (alvo.dataset.filtroEncomenda !== undefined) {
            filtro = alvo.dataset.filtroEncomenda;
            try { await carregarLoja(); } catch (erro) { avisar(erro.message, 'erro'); }
            return;
        }
        if (alvo.dataset.abrirEncomenda) { abrirEncomenda(Number(alvo.dataset.abrirEncomenda)); return; }
        if (alvo.hasAttribute('data-novo-anuncio')) { abrirAnuncio(null); return; }
        const anuncio = function (campo) {
            return dados.anuncios.find(function (x) { return x.id === Number(alvo.dataset[campo]); });
        };
        if (alvo.dataset.editarAnuncio) { abrirAnuncio(anuncio('editarAnuncio')); return; }
        try {
            if (alvo.dataset.publicarAnuncio) {
                alvo.disabled = true;
                const r = await api.put('/anuncios/' + alvo.dataset.publicarAnuncio, { publicado: alvo.dataset.publicado === '1' ? 0 : 1 });
                avisar(mensagemDe(r, 'Anúncio atualizado.'));
            } else if (alvo.dataset.excluirAnuncio) {
                const a = anuncio('excluirAnuncio');
                if (!janela.confirm('Excluir o anúncio "' + a.titulo + '"? O item continua no estoque.')) return;
                avisar(mensagemDe(await api.remover('/anuncios/' + a.id), 'Anúncio excluído.'));
            } else {
                return;
            }
        } catch (erro) {
            avisar(erro.message, 'erro');
        }
        await carregarLoja();
    });

    raiz.addEventListener('submit', async function (evento) {
        if (evento.target.id !== 'formLojaAjustes') return;
        evento.preventDefault();
        const f = evento.target;
        const botao = f.querySelector('button[type="submit"]');
        const corpo = {};
        Array.from(f.elements).forEach(function (el) {
            if (el.name) corpo[el.name] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
        });
        botao.disabled = true;
        try {
            avisar(mensagemDe(await api.put('/loja-ajustes', corpo), 'Ajustes gravados.'));
            await carregarLoja();
        } catch (erro) {
            avisar(erro.message, 'erro');
            botao.disabled = false;
        }
    });

    // Dentro da janela: remover foto e cancelar encomenda.
    J.modalCorpo.addEventListener('click', function (evento) {
        const alvo = evento.target.closest('button');
        if (!alvo) return;
        if (alvo.dataset.removerFoto) {
            fotosRemover.push(Number(alvo.dataset.removerFoto));
            alvo.closest('figure').remove();
        } else if (alvo.hasAttribute('data-remover-nova')) {
            const fig = alvo.closest('figure');
            fotosNovas[Number(fig.dataset.fotoNova)] = null;
            fotosNovas = fotosNovas.filter(Boolean);
            fig.remove();
            document.querySelectorAll('#lojaFotos [data-foto-nova]').forEach(function (x, i) { x.dataset.fotoNova = String(i); });
        } else if (alvo.dataset.cancelarEncomenda) {
            cancelarEncomenda(alvo);
        }
    });

    N.registrarTela('loja', { titulo: 'Loja online', carregar: carregarLoja, soAdmin: true });
    janela.Telas = janela.Telas || {};
    janela.Telas.loja = { carregar: carregarLoja };
})(window);
