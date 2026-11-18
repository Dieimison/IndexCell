// carga: usa Formato, RegrasPdv, Nucleo, Janela; publica Telas.pdv  (conferido por testes/front/carga.test.js)
/*
 * telas/pdv.js - o PDV: a UNICA tela de venda do balcao (a antiga janela
 * "Nova venda" saiu; a tela Vendas ficou para consultar, editar e
 * cancelar). Window.Telas.pdv.
 *
 *   esquerda   busca (nome, codigo, IMEI, cor) no que tem saldo e nos
 *              servicos do cadastro
 *   direita    o cupom: cliente, itens, desconto, total, pagamento,
 *              vencimento e observacao
 *
 * Grava pelo MESMO POST /api/vendas de sempre: estoque, contas a receber e
 * as regras da loja (Admin > Regras) sao as do servidor. O PDV so mostra
 * antes o que o servidor vai conferir (limite de desconto, cliente
 * obrigatorio, preco travado, venda a prazo).
 *
 * O que a janela antiga fazia e o PDV faz igual: servico do cadastro,
 * preco sugerido (o de venda; sem ele, o custo), pergunta antes de fechar
 * item a R$ 0,00, forma "nao informada", parcelas, "ja recebi",
 * vencimento da 1a parcela e observacoes.
 *
 * A venda em andamento fica guardada enquanto o sistema estiver aberto:
 * sair do PDV e voltar nao perde o carrinho.
 *
 * Teclado: F2 busca (de qualquer tela, abre o PDV) - setas e Enter na
 * lista - F4 pagamento - F10 ou Ctrl+Enter finaliza - Esc limpa a busca.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, deCentavos, hoje } = janela.Formato;
    const R = janela.RegrasPdv;
    const N = janela.Nucleo;
    const { api, estado, avisar, rotuloDe, mensagemDe, formaPadrao, mostrarSecao,
            carregarCatalogos, carregarDisponiveis, identificacaoDoAparelho } = N;
    const J = janela.Janela;

    const raiz = document.getElementById('pdvConteudo');
    const LIMITE_LISTA = 80;

    /* A venda em andamento. */
    const venda = {
        itens: [],          // { chave, entrada_id, servico_id, item, tipo, detalhe, quantidade, preco, tabela, saldo }
        clienteId: '',
        desconto: '',
        modoDesconto: 'reais',
        formaId: '',
        semForma: false,    // a pessoa escolheu "Nao informar"
        parcelas: 1,
        pago: true,
        recebido: '',
        vencimento: '',
        observacoes: '',
    };
    const tela = { busca: '', filtro: 'todos', destaque: 0, gravando: false, montada: false, concluida: null };

    // ------------------------------------------------------------------
    // Regras da loja que o PDV mostra (o servidor confere)
    // ------------------------------------------------------------------
    function admin() { return !!estado.config.pode_admin; }
    function chaveDaLoja(nome, padrao) {
        const c = estado.config.chaves || {};
        return c[nome] === undefined ? padrao : c[nome];
    }
    function limiteDesconto() { return Number(chaveDaLoja('venda.desconto_maximo_balcao', 100)); }
    function podeMudarPreco() { return admin() || !!chaveDaLoja('venda.alterar_preco_balcao', true); }
    function exigeCliente() { return !!chaveDaLoja('venda.exigir_cliente', false); }
    function podePrazo() { return admin() || !!chaveDaLoja('venda.prazo_balcao', true); }

    function formasDoPdv() {
        return estado.formasPagamento.filter(function (f) { return f.ativo && (f.tipo !== 'prazo' || podePrazo()); });
    }
    function formaEscolhida() {
        return estado.formasPagamento.find(function (f) { return String(f.id) === String(venda.formaId); }) || null;
    }

    // ------------------------------------------------------------------
    // O que pode ser vendido: estoque com saldo + servicos ativos
    // ------------------------------------------------------------------
    /* Preco sugerido de uma entrada: o de venda; sem ele, o custo (senao o item sairia de graca). */
    function precoSugerido(e) {
        return Number(e.valor_venda) > 0 ? Number(e.valor_venda) : Number(e.valor_investimento) || 0;
    }

    function catalogoDoPdv() {
        const codigo = function (e) {
            const dono = e.tipo === 'peca' ? estado.pecas.find(function (p) { return p.id === e.peca_id; })
                       : e.tipo === 'produto' ? estado.produtos.find(function (p) { return p.id === e.produto_id; }) : null;
            return dono && dono.codigo ? String(dono.codigo) : '';
        };
        const doEstoque = estado.disponiveis.map(function (e) {
            const cod = codigo(e);
            return {
                chave: 'e' + e.id, tipo: e.tipo, titulo: e.item, preco: precoSugerido(e), saldo: e.saldo,
                detalhe: rotuloDe('tipos_entrada', e.tipo) + identificacaoDoAparelho(e) + (cod ? ' · cód. ' + cod : ''),
                procura: [e.item, e.imei, e.cor, e.marca, e.categoria, cod, rotuloDe('tipos_entrada', e.tipo),
                          e.condicao ? rotuloDe('condicoes', e.condicao) : '', '#' + e.id].join(' '),
                exatos: [e.imei, cod].filter(Boolean),
                entrada: e,
            };
        });
        const servicos = (estado.servicos || []).filter(function (sv) { return sv.ativo; }).map(function (sv) {
            return {
                chave: 's' + sv.id, tipo: 'servico', titulo: sv.nome, preco: Number(sv.valor_padrao) || 0, saldo: Infinity,
                detalhe: 'Serviço' + (sv.descricao ? ' · ' + sv.descricao : ''),
                procura: [sv.nome, sv.descricao, 'servico serviço'].join(' '), exatos: [], servico: sv,
            };
        });
        return doEstoque.concat(servicos);
    }

    function noCarrinho(chave) {
        return venda.itens.find(function (i) { return i.chave === chave; }) || null;
    }

    function resultados() {
        return R.buscar(catalogoDoPdv(), tela.busca, tela.filtro).filter(function (r) {
            const ja = noCarrinho(r.chave);
            return !ja || ja.quantidade < r.saldo;
        });
    }

    // ------------------------------------------------------------------
    // Desenho
    // ------------------------------------------------------------------
    function montar() {
        raiz.innerHTML =
            '<div class="pdv">' +
            '<header class="pdv-topo">' +
                '<div class="pdv-marca"><strong>PDV</strong><span id="pdvLoja"></span></div>' +
                '<div class="pdv-teclas" aria-hidden="true"><span><kbd>F2</kbd> buscar</span><span><kbd>F4</kbd> pagamento</span>' +
                    '<span><kbd>F10</kbd> finalizar</span></div>' +
                '<div class="pdv-operador" id="pdvOperador"></div>' +
                '<button type="button" class="botao botao-secundario" data-pdv="sair">Sair do PDV</button>' +
            '</header>' +
            '<div class="pdv-corpo">' +
                '<section class="pdv-catalogo" aria-label="O que tem para vender">' +
                    '<label class="pdv-busca" for="pdvBusca">' +
                        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
                        '<input type="search" id="pdvBusca" autocomplete="off" spellcheck="false" ' +
                            'placeholder="Buscar por nome, código, IMEI ou cor" aria-controls="pdvResultados">' +
                    '</label>' +
                    '<div class="pdv-filtros" role="group" aria-label="Tipo">' +
                        [['todos', 'Tudo'], ['celular', 'Celulares'], ['peca', 'Peças'], ['produto', 'Produtos'], ['servico', 'Serviços']].map(function (f) {
                            return '<button type="button" class="pdv-filtro" data-pdv="filtro" data-valor="' + f[0] + '">' + f[1] + '</button>';
                        }).join('') +
                    '</div>' +
                    '<ul class="pdv-resultados" id="pdvResultados" role="listbox" aria-label="Itens encontrados"></ul>' +
                '</section>' +
                '<section class="pdv-cupom" aria-label="Venda atual">' +
                    '<div class="pdv-cliente" id="pdvCliente"></div>' +
                    '<div class="pdv-itens" id="pdvItens"></div>' +
                    '<div class="pdv-resumo" id="pdvResumo"></div>' +
                    '<div class="pdv-pagamento" id="pdvPagamento"></div>' +
                    '<label class="pdv-observacao" for="pdvObservacoes">Observação da venda (opcional)' +
                        '<input type="text" id="pdvObservacoes" data-pdv-campo="observacoes" maxlength="500" ' +
                            'placeholder="Ex.: garantia de 90 dias, troca só com a caixa"></label>' +
                    '<p class="pdv-erro" id="pdvErro" role="alert"></p>' +
                    '<div class="pdv-acoes">' +
                        '<button type="button" class="botao botao-secundario" data-pdv="limpar">Cancelar venda</button>' +
                        '<button type="button" class="pdv-finalizar" id="pdvFinalizar" data-pdv="finalizar"></button>' +
                    '</div>' +
                '</section>' +
            '</div>' +
            '<div class="pdv-concluida oculta" id="pdvConcluida" role="dialog" aria-modal="true" aria-labelledby="pdvConcluidaTitulo"></div>' +
            '</div>';
        tela.montada = true;
    }

    function desenharTopo() {
        document.getElementById('pdvLoja').textContent = estado.config.empresa || 'Index Celulares';
        document.getElementById('pdvOperador').textContent = 'Operador: ' + (estado.usuario.nome || estado.usuario.usuario);
        raiz.querySelectorAll('[data-pdv="filtro"]').forEach(function (b) {
            b.setAttribute('aria-pressed', String(b.dataset.valor === tela.filtro));
        });
    }

    function desenharResultados() {
        const lista = resultados();
        if (tela.destaque >= lista.length) tela.destaque = Math.max(0, lista.length - 1);
        const ul = document.getElementById('pdvResultados');
        if (!estado.disponiveis.length && !(estado.servicos || []).some(function (s) { return s.ativo; })) {
            ul.innerHTML = '<li class="pdv-vazio">Não há nada com saldo no estoque nem serviço cadastrado. Registre uma entrada primeiro.</li>';
            return;
        }
        if (!lista.length) {
            ul.innerHTML = '<li class="pdv-vazio">Nada encontrado para "' + escapar(tela.busca) + '". ' +
                'Confira a escrita, ou procure pelo IMEI ou pelo código.</li>';
            return;
        }
        ul.innerHTML = lista.slice(0, LIMITE_LISTA).map(function (r, i) {
            const ja = noCarrinho(r.chave);
            const sobra = r.saldo - (ja ? ja.quantidade : 0);
            return '<li role="option" aria-selected="' + (i === tela.destaque) + '">' +
                '<button type="button" class="pdv-resultado' + (i === tela.destaque ? ' destaque' : '') +
                    '" data-pdv="adicionar" data-chave="' + r.chave + '">' +
                    '<span class="resultado-nome">' + escapar(r.titulo) + '</span>' +
                    '<span class="resultado-detalhe">' + escapar(r.detalhe) +
                        (r.tipo !== 'celular' && r.tipo !== 'servico' ? ' · ' + sobra + ' em estoque' : '') + '</span>' +
                    '<span class="resultado-preco">' + moeda(r.preco) + '</span>' +
                '</button></li>';
        }).join('') + (lista.length > LIMITE_LISTA
            ? '<li class="pdv-vazio">Mais ' + (lista.length - LIMITE_LISTA) + ' item(ns): refine a busca.</li>' : '');
    }

    function desenharCliente() {
        const opcoes = estado.clientes.map(function (c) {
            return '<option value="' + c.id + '"' + (String(c.id) === String(venda.clienteId) ? ' selected' : '') + '>' +
                   escapar(c.nome + (c.telefone ? ' (' + c.telefone + ')' : '')) + '</option>';
        }).join('');
        document.getElementById('pdvCliente').innerHTML =
            '<label for="pdvClienteSelect">Cliente' + (exigeCliente() ? ' <span class="pdv-obrigatorio">obrigatório nesta loja</span>' : '') + '</label>' +
            '<div class="pdv-cliente-linha">' +
                '<select id="pdvClienteSelect" data-pdv-campo="cliente">' +
                    '<option value="">' + (exigeCliente() ? '— escolha o cliente —' : 'Consumidor (sem cadastro)') + '</option>' + opcoes +
                '</select>' +
                '<button type="button" class="botao-icone" data-pdv="cliente-novo">+ Cliente novo</button>' +
            '</div>' +
            '<div class="pdv-cliente-novo oculta" id="pdvClienteNovo">' +
                '<input type="text" id="pdvClienteNome" placeholder="Nome" aria-label="Nome do cliente novo" maxlength="120">' +
                '<input type="tel" id="pdvClienteFone" placeholder="Telefone" aria-label="Telefone do cliente novo" maxlength="30">' +
                '<button type="button" class="botao botao-pequeno" data-pdv="cliente-gravar">Cadastrar</button>' +
                '<button type="button" class="botao-icone" data-pdv="cliente-cancelar">Cancelar</button>' +
            '</div>';
    }

    function desenharItens() {
        const caixa = document.getElementById('pdvItens');
        if (!venda.itens.length) {
            caixa.innerHTML = '<p class="pdv-vazio">Nenhum item ainda. Busque o item e clique nele, ou digite e aperte Enter.</p>';
            return;
        }
        const preco = podeMudarPreco();
        caixa.innerHTML = '<ol class="pdv-linhas">' + venda.itens.map(function (i, n) {
            const subtotal = R.totais([i], 0, 'reais').bruto;
            const mexeu = R.lerReais(i.preco) !== i.tabela;
            return '<li class="pdv-linha">' +
                '<div class="linha-nome"><span>' + escapar(i.item) + '</span><small>' + escapar(i.detalhe) + '</small></div>' +
                (i.tipo === 'celular'
                    ? '<div class="linha-qtd linha-qtd-fixa" title="Celular é unitário">1</div>'
                    : '<div class="linha-qtd">' +
                        '<button type="button" class="botao-icone" data-pdv="menos" data-n="' + n + '" aria-label="Um a menos">−</button>' +
                        '<input type="number" min="1"' + (isFinite(i.saldo) ? ' max="' + i.saldo + '"' : '') + ' step="1" value="' +
                            i.quantidade + '" data-pdv-campo="quantidade" data-n="' + n + '" aria-label="Quantidade de ' + escapar(i.item) + '">' +
                        '<button type="button" class="botao-icone" data-pdv="mais" data-n="' + n + '" aria-label="Um a mais">+</button>' +
                      '</div>') +
                '<div class="linha-preco">' +
                    '<input type="text" inputmode="decimal" value="' + escapar(R.lerReais(i.preco).toFixed(2).replace('.', ',')) +
                        '" data-pdv-campo="preco" data-n="' + n + '"' +
                        (preco ? '' : ' readonly title="Nesta loja só o administrador muda o preço. Use o desconto."') +
                        ' aria-label="Preço unitário de ' + escapar(i.item) + '">' +
                    (mexeu ? '<small>tabela ' + moeda(i.tabela) + '</small>' : '') +
                '</div>' +
                '<div class="linha-subtotal">' + moeda(deCentavos(subtotal)) + '</div>' +
                '<button type="button" class="botao-icone perigo-leve" data-pdv="remover" data-n="' + n + '" aria-label="Tirar ' +
                    escapar(i.item) + ' da venda">×</button>' +
                '</li>';
        }).join('') + '</ol>';
    }

    function contas() {
        return R.totais(venda.itens, venda.desconto, venda.modoDesconto);
    }

    function desenharResumo() {
        const t = contas();
        const limite = limiteDesconto();
        const confere = R.descontoNoLimite(t.bruto, t.desconto, limite, admin());
        document.getElementById('pdvResumo').innerHTML =
            '<div class="resumo-linha"><span>Itens</span><span>' + moeda(deCentavos(t.bruto)) + '</span></div>' +
            '<div class="resumo-linha resumo-desconto' + (confere.ok ? '' : ' fora-do-limite') + '">' +
                '<label for="pdvDesconto">Desconto</label>' +
                '<span class="desconto-campo">' +
                    '<input type="text" inputmode="decimal" id="pdvDesconto" data-pdv-campo="desconto" value="' + escapar(venda.desconto) + '" placeholder="0">' +
                    '<button type="button" class="desconto-modo" data-pdv="modo-desconto" aria-label="Trocar entre reais e porcentagem">' +
                        (venda.modoDesconto === 'porcento' ? '%' : 'R$') + '</button>' +
                '</span>' +
                '<span>− ' + moeda(deCentavos(t.desconto)) + '</span>' +
            '</div>' +
            (!admin() && limite < 100
                ? '<p class="resumo-nota">Seu limite: até ' + limite + '% (' + moeda(deCentavos(confere.maximo)) + ' nesta venda).</p>' : '') +
            '<div class="resumo-total"><span>Total</span><strong id="pdvTotal">' + moeda(deCentavos(t.total)) + '</strong></div>';
        atualizarBotaoFinalizar(t);
    }

    function desenharPagamento() {
        const formas = formasDoPdv();
        if (!venda.semForma && (!formaEscolhida() || !formas.some(function (f) { return String(f.id) === String(venda.formaId); }))) {
            escolherForma(formas.some(function (f) { return String(f.id) === String(formaPadrao()); }) ? formaPadrao()
                          : (formas[0] ? formas[0].id : ''), false);
        }
        const forma = formaEscolhida();
        const t = contas();
        const parcelavel = !!forma && forma.tipo !== 'vista';
        const mostraRecebido = !!forma && forma.tipo === 'vista' && venda.pago;
        const mostraVencimento = !venda.pago || venda.parcelas > 1;
        const troco = R.troco(t.total, venda.recebido);
        const maxParcelas = estado.config.parcelas_max;

        document.getElementById('pdvPagamento').innerHTML =
            '<div class="pagamento-titulo">Pagamento</div>' +
            '<div class="pdv-formas" role="radiogroup" aria-label="Forma de pagamento">' +
                formas.map(function (f) {
                    const sim = !venda.semForma && String(f.id) === String(venda.formaId);
                    return '<button type="button" role="radio" class="pdv-forma" aria-checked="' + sim + '" data-pdv="forma" data-id="' + f.id + '">' +
                        escapar(f.nome) + '</button>';
                }).join('') +
                '<button type="button" role="radio" class="pdv-forma pdv-forma-nenhuma" aria-checked="' + venda.semForma +
                    '" data-pdv="sem-forma" title="A venda fica sem forma de pagamento registrada">Não informar</button>' +
                (!podePrazo() ? '<span class="pagamento-nota">Venda a prazo só com o administrador.</span>' : '') +
            '</div>' +
            '<div class="pagamento-detalhe">' +
                (parcelavel
                    ? '<label class="pagamento-campo">Parcelas <select data-pdv-campo="parcelas">' +
                        Array.from({ length: maxParcelas }, function (_, k) { return k + 1; }).map(function (p) {
                            return '<option value="' + p + '"' + (p === venda.parcelas ? ' selected' : '') + '>' + p + 'x</option>';
                        }).join('') + '</select></label>'
                    : '') +
                (venda.parcelas === 1
                    ? '<label class="pagamento-campo pagamento-recebi"><input type="checkbox" data-pdv-campo="pago"' + (venda.pago ? ' checked' : '') + '> ' +
                        'Já recebi agora</label>'
                    : '<span class="pagamento-nota">Parcelado: uma conta a receber por parcela, de mês em mês.</span>') +
                (mostraVencimento
                    ? '<label class="pagamento-campo">' + (venda.parcelas > 1 ? 'Vencimento da 1ª parcela' : 'Vencimento') +
                        ' <input type="date" data-pdv-campo="vencimento" value="' + escapar(venda.vencimento || hoje()) + '"></label>'
                    : '') +
                (mostraRecebido
                    ? '<label class="pagamento-campo">Recebido <input type="text" inputmode="decimal" data-pdv-campo="recebido" value="' +
                        escapar(venda.recebido) + '" placeholder="' + escapar(moeda(deCentavos(t.total))) + '"></label>' +
                      (troco === null ? ''
                        : '<span class="pdv-troco' + (troco < 0 ? ' falta' : '') + '">' +
                            (troco < 0 ? 'Falta ' + moeda(deCentavos(-troco)) : 'Troco ' + moeda(deCentavos(troco))) + '</span>')
                    : '') +
            '</div>';
    }

    function atualizarBotaoFinalizar(t) {
        const botao = document.getElementById('pdvFinalizar');
        botao.disabled = tela.gravando || !venda.itens.length;
        botao.innerHTML = tela.gravando ? 'Gravando...'
            : '<span>Finalizar venda</span><strong>' + moeda(deCentavos((t || contas()).total)) + '</strong><kbd>F10</kbd>';
    }

    function desenharTudo() {
        desenharTopo();
        desenharResultados();
        desenharCliente();
        desenharItens();
        desenharResumo();
        desenharPagamento();
        document.getElementById('pdvObservacoes').value = venda.observacoes;
    }

    /* Mexeu em quantidade, preco, desconto ou recebido: so as contas, sem perder o foco do campo. */
    function recalcular() {
        const t = contas();
        raiz.querySelectorAll('.pdv-linha').forEach(function (li, n) {
            const i = venda.itens[n];
            if (i) li.querySelector('.linha-subtotal').textContent = moeda(deCentavos(R.totais([i], 0, 'reais').bruto));
        });
        const limite = limiteDesconto();
        const confere = R.descontoNoLimite(t.bruto, t.desconto, limite, admin());
        const linhaDesconto = raiz.querySelector('.resumo-desconto');
        linhaDesconto.classList.toggle('fora-do-limite', !confere.ok);
        linhaDesconto.lastElementChild.textContent = '− ' + moeda(deCentavos(t.desconto));
        document.getElementById('pdvTotal').textContent = moeda(deCentavos(t.total));
        const nota = raiz.querySelector('.resumo-nota');
        if (nota) nota.textContent = 'Seu limite: até ' + limite + '% (' + moeda(deCentavos(confere.maximo)) + ' nesta venda).';
        const troco = raiz.querySelector('.pdv-troco');
        const campoRecebido = raiz.querySelector('[data-pdv-campo="recebido"]');
        if (campoRecebido) {
            campoRecebido.placeholder = moeda(deCentavos(t.total));
            const valor = R.troco(t.total, venda.recebido);
            if (troco && valor === null) troco.remove();
            else if (valor !== null) {
                const alvo = troco || campoRecebido.closest('.pagamento-campo').insertAdjacentElement('afterend', document.createElement('span'));
                alvo.className = 'pdv-troco' + (valor < 0 ? ' falta' : '');
                alvo.textContent = valor < 0 ? 'Falta ' + moeda(deCentavos(-valor)) : 'Troco ' + moeda(deCentavos(valor));
            }
        }
        atualizarBotaoFinalizar(t);
        erro('');
    }

    function erro(texto) {
        document.getElementById('pdvErro').textContent = texto || '';
    }

    // ------------------------------------------------------------------
    // Acoes
    // ------------------------------------------------------------------
    function adicionar(chave) {
        const r = catalogoDoPdv().find(function (x) { return x.chave === chave; });
        if (!r) return;
        const ja = noCarrinho(chave);
        if (ja) {
            if (ja.quantidade >= r.saldo) {
                erro('Só há ' + r.saldo + ' de "' + r.titulo + '" no estoque.');
                return;
            }
            ja.quantidade++;
        } else {
            venda.itens.push({
                chave: chave, tipo: r.tipo, item: r.titulo, detalhe: r.detalhe,
                entrada_id: r.entrada ? r.entrada.id : null, servico_id: r.servico ? r.servico.id : null,
                quantidade: 1, preco: r.preco, tabela: r.preco, saldo: r.saldo,
            });
        }
        tela.busca = '';
        document.getElementById('pdvBusca').value = '';
        tela.destaque = 0;
        desenharResultados();
        desenharItens();
        desenharResumo();
        desenharPagamento();
        erro('');
        document.getElementById('pdvBusca').focus();
    }

    function escolherForma(id, redesenhar) {
        venda.formaId = id ? String(id) : '';
        venda.semForma = false;
        const f = formaEscolhida();
        venda.parcelas = f && f.tipo !== 'vista' ? Math.min(Math.max(1, f.parcelas_padrao || 1), estado.config.parcelas_max) : 1;
        venda.pago = !f || (f.tipo !== 'prazo' && venda.parcelas === 1);
        if (!f || f.tipo !== 'vista') venda.recebido = '';
        if (redesenhar !== false) desenharPagamento();
    }

    function semForma() {
        venda.formaId = '';
        venda.semForma = true;
        venda.parcelas = 1;
        venda.pago = true;
        venda.recebido = '';
        desenharPagamento();
    }

    function limparVenda() {
        venda.itens = [];
        venda.clienteId = '';
        venda.desconto = '';
        venda.modoDesconto = 'reais';
        venda.recebido = '';
        venda.vencimento = '';
        venda.observacoes = '';
        escolherForma('', false);
        tela.busca = '';
        tela.destaque = 0;
        const busca = document.getElementById('pdvBusca');
        if (busca) busca.value = '';
        erro('');
    }

    /* O que o servidor vai recusar, dito antes (a mesma regra; ele confere de novo). */
    function problemaAntesDeEnviar(t) {
        if (!venda.itens.length) return 'Coloque pelo menos um item na venda.';
        if (exigeCliente() && !venda.clienteId) return 'Escolha o cliente: nesta loja toda venda é feita com o cliente identificado.';
        if (t.total <= 0) return 'O total ficou em R$ 0,00. Brinde ou cortesia sai por Cadastros > Movimentar estoque > Brinde.';
        const confere = R.descontoNoLimite(t.bruto, t.desconto, limiteDesconto(), admin());
        if (!confere.ok) return 'Desconto acima do seu limite (' + moeda(deCentavos(confere.maximo)) + '). Para mais, peça a um administrador.';
        if (!venda.formaId && !venda.semForma) return 'Escolha a forma de pagamento (ou "Não informar").';
        const troco = venda.pago ? R.troco(t.total, venda.recebido) : null;
        if (troco !== null && troco < 0) return 'O valor recebido é menor que o total: falta ' + moeda(deCentavos(-troco)) + '.';
        return '';
    }

    async function finalizar() {
        if (tela.gravando) return;
        const t = contas();
        const problema = problemaAntesDeEnviar(t);
        if (problema) { erro(problema); return; }
        /* Preco zero quase sempre e campo esquecido: pergunta antes (como a janela antiga). */
        const deGraca = venda.itens.filter(function (i) { return R.lerReais(i.preco) <= 0; }).length;
        if (deGraca && !confirm(deGraca + ' item(ns) desta venda está(ão) com preço R$ 0,00. Fechar a venda assim mesmo?')) {
            erro('Venda não fechada: confira o preço dos itens.');
            return;
        }
        tela.gravando = true;
        atualizarBotaoFinalizar(t);
        const centavo = function (p) { return deCentavos(R.totais([{ preco: p, quantidade: 1 }], 0, 'reais').bruto); };
        try {
            const resposta = await api.post('/vendas', {
                cliente_id: venda.clienteId || null,
                itens: venda.itens.map(function (i) {
                    return i.servico_id
                        ? { servico_id: i.servico_id, descricao: i.item, quantidade: i.quantidade, valor_unitario: centavo(i.preco) }
                        : { entrada_id: i.entrada_id, quantidade: i.quantidade, valor_unitario: centavo(i.preco) };
                }),
                desconto: deCentavos(t.desconto),
                forma_pagamento_id: venda.formaId ? Number(venda.formaId) : null,
                parcelas: venda.parcelas,
                pago: venda.parcelas === 1 && venda.pago,
                vencimento: (!venda.pago || venda.parcelas > 1) ? (venda.vencimento || hoje()) : null,
                observacoes: venda.observacoes.trim() || null,
            });
            const troco = venda.pago ? R.troco(t.total, venda.recebido) : null;
            const forma = formaEscolhida();
            tela.concluida = {
                id: resposta.id, total: t.total, troco: troco,
                forma: forma ? forma.nome + (venda.parcelas > 1 ? ' em ' + venda.parcelas + 'x' : '') : 'Forma não informada',
                pago: venda.pago, mensagem: mensagemDe(resposta, 'Venda registrada.'),
            };
            limparVenda();
            await carregarDisponiveis();
            desenharTudo();
            mostrarConcluida();
        } catch (falha) {
            erro(falha.message);
        } finally {
            tela.gravando = false;
            atualizarBotaoFinalizar();
        }
    }

    function mostrarConcluida() {
        const c = tela.concluida;
        const caixa = document.getElementById('pdvConcluida');
        caixa.innerHTML =
            '<div class="concluida-caixa">' +
                '<h2 id="pdvConcluidaTitulo">' + escapar(c.mensagem) + '</h2>' +
                '<p class="concluida-total">' + moeda(deCentavos(c.total)) + '</p>' +
                '<p class="concluida-forma">' + escapar(c.forma) + (c.pago ? ' · recebido' : ' · fica a receber no Financeiro') + '</p>' +
                (c.troco !== null && c.troco > 0 ? '<p class="concluida-troco">Troco: <strong>' + moeda(deCentavos(c.troco)) + '</strong></p>' : '') +
                '<div class="concluida-acoes">' +
                    '<button type="button" class="botao botao-secundario" data-pdv="ver-venda">Ver a venda</button>' +
                    '<button type="button" class="botao" data-pdv="nova-venda" id="pdvNovaVenda">Nova venda <kbd>Enter</kbd></button>' +
                '</div>' +
            '</div>';
        caixa.classList.remove('oculta');
        document.getElementById('pdvNovaVenda').focus();
    }

    function fecharConcluida() {
        tela.concluida = null;
        document.getElementById('pdvConcluida').classList.add('oculta');
        document.getElementById('pdvBusca').focus();
    }

    async function cadastrarCliente() {
        const nome = document.getElementById('pdvClienteNome').value.trim();
        const fone = document.getElementById('pdvClienteFone').value.trim();
        if (!nome) { document.getElementById('pdvClienteNome').focus(); return; }
        try {
            const r = await api.post('/clientes', { nome: nome, telefone: fone });
            avisar(mensagemDe(r, 'Cliente cadastrado.'));
            await carregarCatalogos();
            venda.clienteId = String(r.id);
            desenharCliente();
            erro('');
        } catch (falha) {
            erro(falha.message);
        }
    }

    raiz.addEventListener('click', function (evento) {
        const alvo = evento.target.closest('[data-pdv]');
        if (!alvo) return;
        const n = Number(alvo.dataset.n);
        switch (alvo.dataset.pdv) {
            case 'adicionar': adicionar(alvo.dataset.chave); break;
            case 'filtro':
                tela.filtro = alvo.dataset.valor; tela.destaque = 0;
                desenharTopo(); desenharResultados(); break;
            case 'menos':
                if (venda.itens[n].quantidade > 1) venda.itens[n].quantidade--;
                desenharItens(); desenharResumo(); desenharResultados(); break;
            case 'mais':
                if (venda.itens[n].quantidade < venda.itens[n].saldo) venda.itens[n].quantidade++;
                else erro('Só há ' + venda.itens[n].saldo + ' de "' + venda.itens[n].item + '" no estoque.');
                desenharItens(); desenharResumo(); desenharResultados(); break;
            case 'remover':
                venda.itens.splice(n, 1);
                desenharItens(); desenharResumo(); desenharResultados(); desenharPagamento(); break;
            case 'modo-desconto':
                venda.modoDesconto = venda.modoDesconto === 'reais' ? 'porcento' : 'reais';
                desenharResumo(); desenharPagamento(); break;
            case 'forma': escolherForma(alvo.dataset.id); desenharResumo(); break;
            case 'sem-forma': semForma(); break;
            case 'cliente-novo':
                document.getElementById('pdvClienteNovo').classList.remove('oculta');
                document.getElementById('pdvClienteNome').focus(); break;
            case 'cliente-cancelar':
                document.getElementById('pdvClienteNovo').classList.add('oculta'); break;
            case 'cliente-gravar': cadastrarCliente(); break;
            case 'limpar':
                if (venda.itens.length && !confirm('Cancelar esta venda? Os itens saem do carrinho e nada é gravado.')) return;
                limparVenda(); desenharTudo(); document.getElementById('pdvBusca').focus(); break;
            case 'finalizar': finalizar(); break;
            case 'nova-venda': fecharConcluida(); break;
            case 'ver-venda': {
                const id = tela.concluida && tela.concluida.id;
                fecharConcluida();
                if (id && janela.Telas.vendas) janela.Telas.vendas.verVenda(id).catch(function (e) { avisar(e.message, 'erro'); });
                break;
            }
            case 'sair': mostrarSecao('pdv-inicio', true); break;   // v8: volta para a tela de entrada do PDV
        }
    });

    raiz.addEventListener('input', function (evento) {
        const campo = evento.target.dataset.pdvCampo;
        if (evento.target.id === 'pdvBusca') {
            tela.busca = evento.target.value;
            tela.destaque = 0;
            desenharResultados();
            return;
        }
        if (!campo) return;
        const n = Number(evento.target.dataset.n);
        if (campo === 'quantidade') {
            const i = venda.itens[n];
            const q = Math.floor(Number(evento.target.value));
            if (q >= 1) i.quantidade = Math.min(q, i.saldo);
            recalcular();
        } else if (campo === 'preco') {
            venda.itens[n].preco = R.lerReais(evento.target.value);
            recalcular();
        } else if (campo === 'desconto') {
            venda.desconto = evento.target.value;
            recalcular();
        } else if (campo === 'recebido') {
            venda.recebido = evento.target.value;
            recalcular();
        } else if (campo === 'observacoes') {
            venda.observacoes = evento.target.value;
        } else if (campo === 'vencimento') {
            venda.vencimento = evento.target.value;
        }
    });

    raiz.addEventListener('change', function (evento) {
        const campo = evento.target.dataset.pdvCampo;
        if (campo === 'cliente') { venda.clienteId = evento.target.value; erro(''); }
        if (campo === 'parcelas') {
            venda.parcelas = Number(evento.target.value) || 1;
            if (venda.parcelas > 1) venda.pago = false;
            desenharPagamento();
        }
        if (campo === 'pago') { venda.pago = evento.target.checked; desenharPagamento(); }
        if (campo === 'quantidade' || campo === 'preco') { desenharItens(); desenharResumo(); desenharResultados(); }
    });

    /* Setas e Enter na busca; Esc limpa. */
    raiz.addEventListener('keydown', function (evento) {
        if (evento.target.id === 'pdvBusca') {
            const total = Math.min(resultados().length, LIMITE_LISTA);
            if (evento.key === 'ArrowDown') { evento.preventDefault(); tela.destaque = Math.min(tela.destaque + 1, total - 1); desenharResultados(); }
            else if (evento.key === 'ArrowUp') { evento.preventDefault(); tela.destaque = Math.max(tela.destaque - 1, 0); desenharResultados(); }
            else if (evento.key === 'Enter') {
                evento.preventDefault();
                const r = resultados()[tela.destaque];
                if (r && tela.busca.trim()) adicionar(r.chave);
            } else if (evento.key === 'Escape') {
                evento.target.value = ''; tela.busca = ''; tela.destaque = 0; desenharResultados();
            }
            return;
        }
        if (evento.key === 'Enter' && (evento.target.id === 'pdvClienteNome' || evento.target.id === 'pdvClienteFone')) {
            evento.preventDefault();
            cadastrarCliente();
        }
    });

    /* Teclas do caixa. F2 abre o PDV de qualquer tela (sem janela aberta). */
    document.addEventListener('keydown', function (evento) {
        // Com uma janela aberta (cadastro, troca obrigatoria de senha) as teclas sao dela.
        if (J.aberta() || !document.getElementById('trocaSenha').classList.contains('oculta')) return;
        if (evento.key === 'F2') {
            evento.preventDefault();
            if (estado.secaoAtual !== 'pdv') { mostrarSecao('pdv', true); return; }
            if (!tela.concluida) document.getElementById('pdvBusca').focus();
            return;
        }
        if (estado.secaoAtual !== 'pdv') return;
        if (tela.concluida) {
            if (evento.key === 'Enter' || evento.key === 'Escape') { evento.preventDefault(); fecharConcluida(); }
            return;
        }
        if (evento.key === 'F4') {
            evento.preventDefault();
            const forma = raiz.querySelector('.pdv-forma[aria-checked="true"]') || raiz.querySelector('.pdv-forma');
            if (forma) forma.focus();
        } else if (evento.key === 'F10' || (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey))) {
            evento.preventDefault();
            finalizar();
        }
    });

    async function carregarPdv() {
        if (!tela.montada) montar();
        await Promise.all([carregarCatalogos(), carregarDisponiveis()]);
        // Venda nova (carrinho vazio) comeca na forma PADRAO de agora, mesmo que ela tenha mudado.
        if (!venda.itens.length) { venda.formaId = ''; venda.semForma = false; }
        // Item que saiu do estoque (ou servico desativado) enquanto o PDV estava fechado sai do carrinho.
        const agora = catalogoDoPdv();
        venda.itens = venda.itens.filter(function (i) {
            const r = agora.find(function (x) { return x.chave === i.chave; });
            if (r) { i.saldo = r.saldo; i.quantidade = Math.min(i.quantidade, r.saldo); }
            return !!r;
        });
        desenharTudo();
        if (tela.concluida) mostrarConcluida();
        else document.getElementById('pdvBusca').focus();
    }

    N.registrarTela('pdv', { titulo: 'PDV', carregar: carregarPdv, telaCheia: true });
    janela.Telas = janela.Telas || {};
    janela.Telas.pdv = { carregar: carregarPdv };
})(window);
