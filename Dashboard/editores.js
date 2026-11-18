// carga: usa Formato, Nucleo, Janela; publica Editores  (conferido por testes/front/carga.test.js)
/*
 * editores.js - os dois editores de linhas da janela. Window.Editores.
 *
 *   itens       pecas do estoque e servicos (venda e OS)
 *   pagamentos  "como o cliente pagou", dividido em formas (OS)
 *
 * As conferencias daqui (saldo somado das linhas, soma dos pagamentos,
 * valor sem forma) sao AVISO AO VIVO, em centavos inteiros, e NAO travam
 * o Salvar: quem decide e o servidor, e a recusa dele (400) aparece
 * dentro da janela. A unica trava e a forma escolhida sem valor numa
 * divisao em varias formas - o contrato diz que o servidor recusa, e a
 * tela nao tem o que mandar naquela linha.
 *
 * Este arquivo usa a Janela so pelo que ela publica para registro
 * (registrarTipoDeCampo e ganchos), no fim, e pelo corpo do modal na hora
 * de cada conta: nao a desestrutura ao carregar.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, emCentavos, deCentavos } = janela.Formato;
    const { estado, rotuloDe, avisar, identificacaoDoAparelho } = janela.Nucleo;

    /** O corpo do modal aberto (lido na hora, nao guardado ao carregar). */
    function corpo() {
        return janela.Janela.modalCorpo;
    }

    // ==================================================================
    // Itens (venda e OS)
    // ==================================================================
    /*
     * As opcoes do select de pecas: as entradas com saldo, mais as que ESTA
     * OS ja usa. O item ja usado costuma estar com saldo zero - foi a
     * propria OS que o consumiu -, e sem ele o select nao acharia a opcao
     * e a peca sumiria da OS ao salvar de novo. O saldo util soma de volta
     * o que a OS ja consumiu.
     */
    function opcoesDeEstoque(jaUsados) {
        const usado = {};
        (jaUsados || []).forEach(function (item) {
            if (item.entrada_id) usado[item.entrada_id] = (usado[item.entrada_id] || 0) + (Number(item.quantidade) || 0);
        });

        const lista = estado.disponiveis.map(function (e) {
            return usado[e.id] ? Object.assign({}, e, { saldoUtil: e.saldo + usado[e.id] }) : e;
        });
        const tem = {};
        lista.forEach(function (e) { tem[e.id] = true; });

        (jaUsados || []).forEach(function (item) {
            if (!item.entrada_id || tem[item.entrada_id]) return;
            tem[item.entrada_id] = true;
            const saldo = item.saldo === undefined ? 0 : item.saldo;
            lista.push({
                id: item.entrada_id,
                tipo: item.item_tipo || 'peca',
                item: item.item_estoque || item.descricao,
                saldo: saldo,
                saldoUtil: saldo + usado[item.entrada_id],
                valor_venda: item.valor_unitario,
                valor_investimento: item.custo_unitario,
            });
        });
        return lista;
    }

    function editorItensHtml(campo) {
        const travado = campo.travado || '';
        const opcoes = opcoesDeEstoque(campo.valor);
        const linhas = (campo.valor || []).map(function (item) {
            return item.servico_id
                ? linhaEditorHtml('servico', item.servico_id, item.quantidade, item.valor_unitario, travado)
                : linhaEditorHtml('peca', item.entrada_id, item.quantidade, item.valor_unitario, travado, opcoes);
        }).join('');

        /* Lista travada: o aviso diz o que fazer, nao so "nao pode". */
        const aviso = travado
            ? '<div class="editor-travado">' +
              '  <strong>Lista fechada.</strong> Esta OS está como <em>' +
                 escapar(rotuloDe('status_os', travado)) + '</em>, e as peças já saíram do estoque.<br>' +
              '  Para mexer nos itens, volte o status para <em>' + escapar(rotuloDe('status_os', 'em_reparo')) +
              '</em> (ou outro em andamento), salve, e edite de novo.' +
              '</div>'
            : '';

        return '<div class="editor-itens' + (travado ? ' travado' : '') + '" data-editor="itens"' +
                    (travado ? ' data-travado="' + escapar(travado) + '"' : '') + '>' +
               '  <h4>' + escapar(campo.titulo || 'Itens') + '</h4>' +
               aviso +
               '  <div class="item-cabecalho"><span>Peça do estoque ou serviço</span><span>Qtd</span><span>Valor un.</span><span></span></div>' +
               '  <div data-linhas>' + linhas + '</div>' +
               '  <div class="aviso-saldo oculta" data-aviso-saldo role="status"></div>' +
               '  <div class="editor-rodape">' +
               (travado ? '<span></span>'
                        : '    <div class="editor-acoes">' +
                          '      <button type="button" class="botao botao-secundario botao-pequeno" data-adicionar-item>+ Peça do estoque</button>' +
                          '      <button type="button" class="botao botao-secundario botao-pequeno" data-adicionar-servico>+ Serviço</button>' +
                          '    </div>') +
               '    <div class="editor-total"><span>Total</span><b data-total-itens>' + moeda(0) + '</b></div>' +
               '  </div>' +
               '</div>';
    }

    /*
     * Valor sugerido de uma peca: o preco de VENDA da entrada; zerado (quem
     * cadastrou so o custo), cai para o custo - senao a peca entraria de graca.
     */
    function valorSugerido(entrada) {
        return Number(entrada.valor_venda) > 0 ? Number(entrada.valor_venda) : Number(entrada.valor_investimento) || 0;
    }

    /*
     * Uma linha do editor. Peca e servico moram no mesmo editor porque para
     * a ordem os dois sao "algo com quantidade e preco"; muda a origem:
     * peca sai do estoque (e tem saldo), servico e mao de obra com nome.
     * O preco do cadastro entra como sugestao e pode ser mudado por cima.
     */
    function linhaEditorHtml(tipo, escolhido, quantidade, valorUnitario, travado, listaEstoque) {
        const trava = travado ? ' disabled' : '';
        let select;

        if (tipo === 'servico') {
            const ativos = (estado.servicos || []).filter(function (sv) {
                return sv.ativo || String(sv.id) === String(escolhido);
            });
            select = '<select data-item-servico' + trava + '>' +
                ['<option value="">— escolha o serviço —</option>'].concat(ativos.map(function (sv) {
                    return '<option value="' + sv.id + '"' + (String(sv.id) === String(escolhido) ? ' selected' : '') +
                           ' data-valor="' + (sv.valor_padrao || 0) + '">' +
                           escapar(sv.nome + (sv.valor_padrao > 0 ? ' · ' + moeda(sv.valor_padrao) : '')) + '</option>';
                })).join('') + '</select>';
        } else {
            const disponiveis = listaEstoque || opcoesDeEstoque(null);
            select = '<select data-item-entrada' + trava + '>' +
                ['<option value="">— escolha no estoque —</option>'].concat(disponiveis.map(function (e) {
                    const sugerido = valorSugerido(e);
                    const saldoUtil = e.saldoUtil !== undefined ? e.saldoUtil : e.saldo;
                    return '<option value="' + e.id + '"' + (String(e.id) === String(escolhido) ? ' selected' : '') +
                           ' data-valor="' + sugerido + '" data-saldo="' + saldoUtil + '">' +
                           escapar(rotuloDe('tipos_entrada', e.tipo) + ': ' + e.item + identificacaoDoAparelho(e) +
                                   ' (saldo ' + saldoUtil + (sugerido > 0 ? ' · ' + moeda(sugerido) : '') + ')') + '</option>';
                })).join('') + '</select>';
        }

        return '<div class="item-linha' + (tipo === 'servico' ? ' servico' : '') + '">' +
               select +
               '  <input type="number" min="1" step="1" max="' + estado.config.quantidade_maxima +
                    '" data-item-qtd value="' + (quantidade || 1) + '"' + trava + '>' +
               '  <input type="number" min="0" step="0.01" max="' + estado.config.valor_maximo + '" data-item-valor value="' +
                    (valorUnitario === undefined ? '' : valorUnitario) + '"' + trava + '>' +
               (travado
                    ? '  <span class="item-cadeado" title="Item fechado">&#128274;</span>'
                    : '  <button type="button" class="item-remover" data-remover-item title="Remover">&times;</button>') +
               '</div>';
    }

    function ligarEditorItens() {
        const editor = corpo().querySelector('[data-editor="itens"]');
        if (!editor) return;

        // Lista fechada: so mostra o que ja foi usado.
        if (editor.dataset.travado) {
            recalcularItens(true);
            return;
        }

        const linhas = editor.querySelector('[data-linhas]');

        editor.querySelector('[data-adicionar-item]').addEventListener('click', function () {
            linhas.insertAdjacentHTML('beforeend', linhaEditorHtml('peca', '', 1, ''));
            recalcularItens();
        });
        editor.querySelector('[data-adicionar-servico]').addEventListener('click', function () {
            linhas.insertAdjacentHTML('beforeend', linhaEditorHtml('servico', '', 1, ''));
            recalcularItens();
        });
        editor.addEventListener('click', function (evento) {
            if (evento.target.closest('[data-remover-item]')) {
                evento.target.closest('.item-linha').remove();
                recalcularItens();
            }
        });

        editor.addEventListener('change', function (evento) {
            // Escolheu a peca: puxa o preco de venda.
            if (evento.target.matches('[data-item-entrada]')) {
                const opcao = evento.target.selectedOptions[0];
                const campoValor = evento.target.closest('.item-linha').querySelector('[data-item-valor]');
                if (opcao && opcao.value && !campoValor.value) campoValor.value = opcao.dataset.valor;
            }
            /* Servico: o preco de tabela vira sugestao. Preco negativo
               (cadastro antigo) nao vira: diz de onde veio o numero. */
            if (evento.target.matches('[data-item-servico]')) {
                const opcao = evento.target.selectedOptions[0];
                const campoValor = evento.target.closest('.item-linha').querySelector('[data-item-valor]');
                if (opcao && opcao.value && !campoValor.value) {
                    if (Number(opcao.dataset.valor) >= 0) {
                        campoValor.value = opcao.dataset.valor;
                    } else {
                        avisar('O preço de tabela deste serviço está negativo no cadastro. Digite o valor cobrado ' +
                               'e corrija o serviço em Cadastros > Serviços.', 'erro');
                    }
                }
            }
            recalcularItens();
        });

        editor.addEventListener('input', function () { recalcularItens(); });

        if (!linhas.children.length) {
            linhas.insertAdjacentHTML('beforeend', linhaEditorHtml('peca', '', 1, ''));
        }
        recalcularItens(true);
    }

    /* Os dois totais do editor, separados como no servidor: servico e mao
       de obra, nao peca. Em reais, somados em centavos. */
    function totaisDoEditor() {
        const editor = corpo().querySelector('[data-editor="itens"]');
        if (!editor) return { pecas: 0, servicos: 0 };
        const cent = { pecas: 0, servicos: 0 };
        editor.querySelectorAll('.item-linha').forEach(function (linha) {
            const qtd = Number(linha.querySelector('[data-item-qtd]').value) || 0;
            const valor = emCentavos(linha.querySelector('[data-item-valor]').value);
            cent[linha.querySelector('[data-item-servico]') ? 'servicos' : 'pecas'] += qtd * valor;
        });
        return { pecas: deCentavos(cent.pecas), servicos: deCentavos(cent.servicos) };
    }

    /* "abertura" marca o recalculo feito ao montar a janela - quem ouve
       (as contas da OS) nao pode tratar isso como alguem mexendo. */
    function recalcularItens(abertura) {
        const editor = corpo().querySelector('[data-editor="itens"]');
        if (!editor) return;
        const t = totaisDoEditor();
        editor.querySelector('[data-total-itens]').textContent = moeda(t.pecas + t.servicos);
        avisarSaldoDasLinhas(editor);
        corpo().dispatchEvent(new CustomEvent('itens-mudaram', { detail: { abertura: abertura === true } }));
    }

    /*
     * A mesma peca em mais de uma linha passando do saldo: aviso ao vivo,
     * somando as linhas por item. Quem recusa de verdade e o servidor
     * ("Saldo insuficiente..."), e a recusa aparece na janela.
     */
    function avisarSaldoDasLinhas(editor) {
        const porItem = {};
        editor.querySelectorAll('.item-linha [data-item-entrada]').forEach(function (select) {
            const opcao = select.selectedOptions[0];
            if (!opcao || !opcao.value) return;
            const p = porItem[opcao.value] || (porItem[opcao.value] = {
                qtd: 0, linhas: 0, saldo: Number(opcao.dataset.saldo) || 0,
                nome: opcao.textContent.replace(/\s*\(saldo.*$/, ''),
            });
            p.qtd += Number(select.closest('.item-linha').querySelector('[data-item-qtd]').value) || 0;
            p.linhas++;
        });
        const avisos = Object.keys(porItem).map(function (id) { return porItem[id]; })
            .filter(function (p) { return p.qtd > p.saldo; })
            .map(function (p) {
                return '"' + p.nome + '"' + (p.linhas > 1 ? ' está em ' + p.linhas + ' linhas e' : '') +
                       ' soma ' + p.qtd + ' unidade(s), mas o saldo é ' + p.saldo + '.';
            });
        const caixa = editor.querySelector('[data-aviso-saldo]');
        caixa.textContent = avisos.join(' ');
        caixa.classList.toggle('oculta', !avisos.length);
    }

    /* Linhas preenchidas, prontas para a API. Lista travada devolve null:
       sem "itens" no corpo, o servidor deixa os itens gravados como estao. */
    function coletarItens() {
        const editor = corpo().querySelector('[data-editor="itens"]');
        if (!editor || editor.dataset.travado) return null;

        return Array.from(editor.querySelectorAll('.item-linha')).map(function (linha) {
            const estoque = linha.querySelector('[data-item-entrada]');
            const servico = linha.querySelector('[data-item-servico]');
            const base = {
                quantidade: Number(linha.querySelector('[data-item-qtd]').value) || 1,
                valor_unitario: linha.querySelector('[data-item-valor]').value,
            };
            if (servico) {
                /* A descricao gravada e o nome do servico no dia do conserto. */
                const cadastro = (estado.servicos || []).find(function (sv) { return String(sv.id) === String(servico.value); });
                const opcao = servico.selectedOptions[0];
                return Object.assign(base, {
                    servico_id: servico.value,
                    descricao: cadastro ? cadastro.nome : (opcao ? opcao.textContent : ''),
                });
            }
            return Object.assign(base, { entrada_id: estoque ? estoque.value : '' });
        }).filter(function (item) {
            return (item.entrada_id || '') !== '' || (item.servico_id || '') !== '';
        });
    }

    // ==================================================================
    // Pagamento dividido (OS)
    // ==================================================================
    /*
     * "Metade em dinheiro, metade no debito" e o caso comum no balcao. O
     * rodape mostra o tempo todo quanto falta ou passou do valor final; a
     * soma certa e conferida pelo servidor, em centavos.
     *
     * Uma forma so, escolhida com o valor em branco, e o total: a tela
     * preenche com o valor final e, enquanto a pessoa nao mexer nesse
     * valor, ele acompanha o valor final (data-automatico).
     */
    const SEM_FORMA = 'Escolha a forma de pagamento de cada valor lançado.';
    const SEM_VALOR = 'Informe o valor de cada forma de pagamento escolhida.';

    function linhaPagamentoHtml(formaId, valor) {
        const opcoes = ['<option value="">— forma de pagamento —</option>'].concat(
            (estado.formasPagamento || []).filter(function (f) {
                return f.ativo || String(f.id) === String(formaId);
            }).map(function (f) {
                return '<option value="' + f.id + '"' + (String(f.id) === String(formaId) ? ' selected' : '') + '>' +
                       escapar(f.nome + (f.ativo ? '' : ' (inativa)')) + '</option>';
            })
        ).join('');
        return '<div class="pagamento-linha">' +
               '  <select data-pag-forma>' + opcoes + '</select>' +
               '  <input type="number" min="0" step="0.01" max="' + estado.config.valor_maximo +
                    '" data-pag-valor placeholder="0,00" value="' + (valor === undefined || valor === null ? '' : valor) + '">' +
               '  <button type="button" class="item-remover" data-remover-pagamento title="Remover">&times;</button>' +
               '</div>';
    }

    function editorPagamentosHtml(campo) {
        const linhas = (campo.valor || []).map(function (p) { return linhaPagamentoHtml(p.forma_pagamento_id, p.valor); }).join('');
        return '<div class="editor-itens" data-editor="pagamentos">' +
               '  <h4>Como o cliente pagou</h4>' +
               '  <div class="item-cabecalho pagamento-cabecalho"><span>Forma</span><span>Valor</span><span></span></div>' +
               '  <div data-linhas-pagamento>' + linhas + '</div>' +
               '  <div class="editor-rodape">' +
               '    <button type="button" class="botao botao-secundario botao-pequeno" data-adicionar-pagamento>+ Forma de pagamento</button>' +
               '    <div class="editor-total"><span data-pag-rotulo>Falta</span> <b data-pag-diferenca>—</b></div>' +
               '  </div>' +
               '</div>';
    }

    function valorFinalDaJanela() {
        const campo = corpo().querySelector('[name="valor_final"]');
        return campo ? campo.value : '';
    }

    function ligarEditorPagamentos() {
        const editor = corpo().querySelector('[data-editor="pagamentos"]');
        if (!editor) return;
        const linhas = editor.querySelector('[data-linhas-pagamento]');

        editor.querySelector('[data-adicionar-pagamento]').addEventListener('click', function () {
            linhas.insertAdjacentHTML('beforeend', linhaPagamentoHtml('', ''));
            conferirPagamentosNaTela();
        });
        editor.addEventListener('click', function (evento) {
            if (evento.target.closest('[data-remover-pagamento]')) {
                evento.target.closest('.pagamento-linha').remove();
                conferirPagamentosNaTela();
            }
        });

        /* Uma forma so, escolhida com o valor em branco: e o total. */
        editor.addEventListener('change', function (evento) {
            if (evento.target.matches('[data-pag-forma]')) {
                const todas = editor.querySelectorAll('.pagamento-linha');
                const valor = evento.target.closest('.pagamento-linha').querySelector('[data-pag-valor]');
                if (todas.length === 1 && evento.target.value && valor.value === '' && emCentavos(valorFinalDaJanela()) > 0) {
                    valor.value = deCentavos(emCentavos(valorFinalDaJanela())).toFixed(2);
                    valor.dataset.automatico = '1';
                }
            }
            conferirPagamentosNaTela();
        });
        editor.addEventListener('input', function (evento) {
            // A pessoa digitou o valor: ele deixa de acompanhar o valor final.
            if (evento.target.matches('[data-pag-valor]')) delete evento.target.dataset.automatico;
            conferirPagamentosNaTela();
        });

        // O valor final muda com itens e orcamento; a diferenca acompanha.
        corpo().addEventListener('itens-mudaram', conferirPagamentosNaTela);
        corpo().addEventListener('input', function (evento) {
            if (['valor_final', 'valor_orcamento', 'valor_mao_obra'].indexOf(evento.target.name) !== -1) {
                conferirPagamentosNaTela();
            }
        });

        if (!linhas.children.length) linhas.insertAdjacentHTML('beforeend', linhaPagamentoHtml('', ''));
        conferirPagamentosNaTela();
    }

    /* A linha unica preenchida sozinha acompanha o valor final. */
    function acompanharValorFinal(editor) {
        const linhas = editor.querySelectorAll('.pagamento-linha');
        if (linhas.length !== 1) return;
        const valor = linhas[0].querySelector('[data-pag-valor]');
        if (valor.dataset.automatico !== '1') return;
        const final = emCentavos(valorFinalDaJanela());
        valor.value = final > 0 ? deCentavos(final).toFixed(2) : '';
    }

    /*
     * As linhas lidas, com o valor em centavos e o que esta pela metade.
     * Uma linha SO, com forma e sem valor, nao esta pela metade: ela e o
     * total (vale o valor final da OS, e e assim que vai para a API).
     */
    function linhasDePagamento() {
        const editor = corpo().querySelector('[data-editor="pagamentos"]');
        if (!editor) return [];
        const linhas = Array.from(editor.querySelectorAll('.pagamento-linha'));
        return linhas.map(function (linha) {
            const forma = linha.querySelector('[data-pag-forma]').value;
            const texto = linha.querySelector('[data-pag-valor]').value;
            const emBranco = String(texto).trim() === '';
            const total = linhas.length === 1 && forma !== '' && emBranco;
            const centavos = total ? emCentavos(valorFinalDaJanela()) : emCentavos(texto);
            return { forma: forma, centavos: centavos,
                     semForma: centavos > 0 && forma === '',
                     semValor: forma !== '' && emBranco && !total };
        });
    }

    /* O que impede salvar (so a forma sem valor numa divisao), ou ''. */
    function pendenciaDosPagamentos() {
        return linhasDePagamento().some(function (l) { return l.semValor; }) ? SEM_VALOR : '';
    }

    function conferirPagamentosNaTela() {
        const editor = corpo().querySelector('[data-editor="pagamentos"]');
        if (!editor) return;
        const rotulo = editor.querySelector('[data-pag-rotulo]');
        const alvo = editor.querySelector('[data-pag-diferenca]');
        const salvar = document.getElementById('modalSalvar');

        acompanharValorFinal(editor);

        const pendencia = pendenciaDosPagamentos();
        if (salvar) salvar.disabled = !!pendencia;
        // Valor sem forma: so aviso (o servidor recusa e diz por que, na janela).
        const aviso = pendencia || (linhasDePagamento().some(function (l) { return l.semForma; }) ? SEM_FORMA : '');
        if (aviso) {
            rotulo.textContent = aviso;
            alvo.textContent = '';
            editor.classList.remove('pagamento-fecha');
            editor.classList.add('pagamento-erra');
            return;
        }

        const final = emCentavos(valorFinalDaJanela());
        const soma = linhasDePagamento().reduce(function (s, l) { return s + (l.forma ? l.centavos : 0); }, 0);
        const diferenca = final - soma;

        // Nada lancado ainda e legitimo: a OS pode estar aberta.
        if (soma === 0) {
            rotulo.textContent = 'A dividir';
            alvo.textContent = moeda(deCentavos(final));
            editor.classList.remove('pagamento-fecha', 'pagamento-erra');
            return;
        }

        /* Folga de config.tolerancia_centavo (33,33 x 3 = 99,99). Passou
           disso, e aviso: o servidor e quem recusa, com a mensagem dele. */
        const fecha = Math.abs(diferenca) <= emCentavos(estado.config.tolerancia_centavo);
        editor.classList.toggle('pagamento-fecha', fecha);
        editor.classList.toggle('pagamento-erra', !fecha);
        rotulo.textContent = fecha ? 'Fecha em' : (diferenca > 0 ? 'Falta lançar' : 'Passou em');
        alvo.textContent = moeda(deCentavos(fecha ? soma : Math.abs(diferenca)));
    }

    /*
     * As linhas, prontas para a API. Uma linha so, com forma e sem valor,
     * leva o valor final. Linha com valor e sem forma VAI como esta: o
     * servidor recusa com a mensagem dele, mostrada na janela.
     */
    function coletarPagamentos() {
        const editor = corpo().querySelector('[data-editor="pagamentos"]');
        if (!editor) return null;

        const linhas = Array.from(editor.querySelectorAll('.pagamento-linha'));
        if (linhas.length === 1) {
            const valor = linhas[0].querySelector('[data-pag-valor]');
            if (linhas[0].querySelector('[data-pag-forma]').value && valor.value.trim() === '' &&
                emCentavos(valorFinalDaJanela()) > 0) {
                valor.value = deCentavos(emCentavos(valorFinalDaJanela())).toFixed(2);
            }
        }
        const pendencia = pendenciaDosPagamentos();
        if (pendencia) throw new Error(pendencia);

        return linhas.map(function (linha) {
            return { forma_pagamento_id: linha.querySelector('[data-pag-forma]').value,
                     valor: linha.querySelector('[data-pag-valor]').value };
        }).filter(function (p) { return emCentavos(p.valor) > 0; });
    }

    // Registro na janela: quem desenha "itens" e "pagamentos", e os ganchos
    // de montar ao abrir, coletar ao salvar e conferir depois de falhar.
    const J = janela.Janela;
    J.registrarTipoDeCampo('itens', editorItensHtml);
    J.registrarTipoDeCampo('pagamentos', editorPagamentosHtml);
    J.ganchos.montar.push(ligarEditorItens, ligarEditorPagamentos);
    J.ganchos.coletar.push(function (valores) {
        const itens = coletarItens();
        if (itens !== null) valores.itens = itens;
        const pagamentos = coletarPagamentos();
        if (pagamentos !== null) valores.pagamentos = pagamentos;
    });
    J.ganchos.depoisDeFalhar.push(conferirPagamentosNaTela);

    janela.Editores = {
        totaisDoEditor: totaisDoEditor,
    };
})(window);
