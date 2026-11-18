// carga: usa Formato, Nucleo, Janela; publica Telas.movimentacao  (conferido por testes/front/carga.test.js)
/*
 * telas/movimentacao.js - movimentacao de estoque fora de compra, venda e
 * OS: garantia, devolucao, defeito, perda, brinde, ajuste. Window.Telas.movimentacao.
 *
 * O motivo escolhe o lado do movimento (garantia entra, devolucao sai),
 * entao quem preenche pensa no que aconteceu, nao em "entrada ou saida".
 * Os motivos, os rotulos e o lado vem do servidor (config.dominios.
 * motivos_movimentacao); aqui so mora o texto de ajuda de cada um.
 */
(function (janela) {
    'use strict';

    const { escapar, dataCurta, horaCurta } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, dominio, rotuloDe, etiqueta, vazio, opcoesDe, cardSimples,
            tabelaHtml, carregarMovimentaveis, identificacaoDoAparelho } = N;
    const { abrirModal, fecharModal, modalCorpo } = janela.Janela;

    const AJUDA_DO_MOTIVO = {
        garantia: 'O fornecedor mandou a peça nova sem cobrar.',
        retorno: 'A peça voltou para a prateleira e pode ser usada de novo.',
        devolucao: 'Saiu da loja de volta para quem vendeu.',
        defeito: 'Veio com defeito e não pode ser usada.',
        perda: 'Quebrou, sumiu ou estragou.',
        brinde: 'Saiu de graça para o cliente (cortesia). Venda de R$ 0,00 não existe: o brinde é lançado aqui. ' +
                'O custo do item entra nas despesas do dia, em "Brinde / cortesia".',
        ajuste: 'Acerto de contagem. Escolha o lado do ajuste abaixo.',
    };

    function motivo(valor) {
        return dominio('motivos_movimentacao').find(function (m) { return m.valor === valor; });
    }

    /* Rotulo e cor de uma linha da ficha: motivo manual ou origem automatica. */
    function etiquetaDaOrigem(origem) {
        return motivo(origem) ? etiqueta('motivos_movimentacao', origem) : etiqueta('origens_estoque', origem);
    }

    /** Ficha de movimentacao de um lote (entrada_id=) ou de um item do catalogo. */
    async function verFichaDoItem(consulta, titulo) {
        const dados = await api.get('/movimentacoes?' + consulta);
        const movimentos = dados.movimentos || [];
        const r = dados.resumo || {};

        /* Quanto esta dentro de OS ainda em andamento: saldo 0 nao quer
           dizer "acabou" se a peca esta na bancada. */
        const emOs = movimentos.reduce(function (soma, m) {
            return m.origem === 'os' ? soma + Math.abs(m.quantidade) : soma;
        }, 0);

        const tabela = tabelaHtml({
            colunas: ['Quando', 'Origem', 'O que aconteceu', { titulo: 'Qtd', classe: 'numero' },
                      { titulo: 'Saldo', classe: 'numero' }, { titulo: 'Ações', classe: 'coluna-acoes' }],
            linhas: movimentos.map(function (m) {
                const entrou = m.quantidade > 0;
                return [
                    dataCurta(m.data) + '<br><small class="observacao">' + escapar(horaCurta(m.data)) + '</small>',
                    etiquetaDaOrigem(m.origem),
                    escapar(m.descricao) + (m.referencia ? '<br><small class="observacao">' + escapar(m.referencia) + '</small>' : ''),
                    { html: (entrou ? '+' : '') + m.quantidade, classe: 'numero ' + (entrou ? 'saldo-ok' : 'saldo-zero') },
                    { html: '<strong>' + m.saldo + '</strong>', classe: 'numero' },
                    { html: m.mov_id
                        ? '<button type="button" class="botao-icone perigo" data-acao="desfazer-mov" data-id="' + m.mov_id + '">Desfazer</button>'
                        : '<small class="observacao">automático</small>', classe: 'coluna-acoes' },
                ];
            }),
        });

        abrirModal({
            titulo: 'Movimentação — ' + (dados.item || titulo || 'item'),
            somenteLeitura: true,
            html: '<div class="campo-total">' +
                '<div class="stats-container" style="margin-bottom:18px">' +
                cardSimples('Na prateleira', dados.saldo, dados.saldo > 0 ? '--serie-3' : '--critico') +
                cardSimples('Dentro de OS', emOs, '--serie-2') +
                cardSimples('Total que entrou', r.entrou || 0, '--serie-1') +
                cardSimples('Total que saiu', r.saiu || 0, '--tinta-fraca') +
                '</div>' +
                (movimentos.length ? tabela : vazio('Este item ainda não teve nenhuma movimentação.')) +
                '<p class="observacao" style="margin-top:12px">Linhas marcadas como <em>automático</em> vêm de uma compra, ' +
                'venda ou ordem de serviço — para desfazer, mexa no documento de origem.</p>' +
                '</div>',
        });
    }

    /*
     * Formulario de movimentacao. Aceita um item ja escolhido (vindo da
     * ficha) e uma OS de origem (vindo de uma ordem em que a peca deu problema).
     */
    function formularioMovimentacao(entradaId, osId) {
        const motivos = dominio('motivos_movimentacao');
        const primeiro = motivos[0] || {};
        const campos = [];

        campos.push({
            nome: 'entrada_id', rotulo: 'Item do estoque', tipo: 'select',
            valor: entradaId ? String(entradaId) : '',
            opcoes: opcoesDe(estado.movimentaveis, function (e) {
                return rotuloDe('tipos_entrada', e.tipo) + ': ' + e.item + identificacaoDoAparelho(e) + ' (saldo ' + e.saldo + ')';
            }, '— escolha o item —'),
            obrigatorio: true, largura: 'total',
        });
        campos.push({
            nome: 'motivo', rotulo: 'O que aconteceu?', tipo: 'select', valor: primeiro.valor,
            opcoes: motivos.map(function (m) { return { valor: m.valor, rotulo: m.rotulo }; }),
            dica: AJUDA_DO_MOTIVO[primeiro.valor] || ' ',
            largura: 'total',
        });
        campos.push({
            nome: 'tipo', rotulo: 'Lado do movimento', tipo: 'select', valor: primeiro.lado || 'entrada',
            opcoes: [
                { valor: 'entrada', rotulo: 'Entrada (volta para o estoque)' },
                { valor: 'saida', rotulo: 'Saída (sai do estoque)' },
            ],
            dica: 'Preenchido conforme o motivo. Só mexa em um ajuste de inventário.',
        });
        campos.push({ nome: 'quantidade', rotulo: 'Quantidade', tipo: 'number', valor: 1, passo: '1', minimo: 1,
                      maximo: estado.config.quantidade_maxima, obrigatorio: true });

        if (osId) {
            campos.push({ nome: 'os_id', tipo: 'oculto', valor: osId });
        } else {
            campos.push({
                nome: 'os_id', rotulo: 'Ordem de serviço relacionada', tipo: 'select', valor: '',
                opcoes: opcoesDe(estado.os || [], function (o) {
                    return (o.numero || 'OS #' + o.id) + ' — ' + o.cliente;
                }, '— nenhuma —'),
                dica: 'Se o problema apareceu num conserto, aponte a OS aqui.',
            });
        }
        campos.push({ nome: 'valor', rotulo: 'Valor / crédito (R$)', tipo: 'number', valor: '',
                      dica: 'Opcional. O que o fornecedor creditou, por exemplo.' });
        campos.push({ nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: '', largura: 'total' });
        return campos;
    }

    /* O motivo escolhe o lado e troca a ajuda. */
    function ligarMotivoMovimentacao() {
        const campoMotivo = modalCorpo.querySelector('[name="motivo"]');
        const campoTipo = modalCorpo.querySelector('[name="tipo"]');
        if (!campoMotivo || !campoTipo) return;
        campoMotivo.addEventListener('change', function () {
            const info = motivo(this.value);
            if (!info) return;
            if (info.lado) campoTipo.value = info.lado;
            const dica = this.closest('.campo').querySelector('.dica');
            if (dica) dica.textContent = AJUDA_DO_MOTIVO[info.valor] || ' ';
        });
    }

    function abrirMovimentacao(titulo, entradaId, osId, depois) {
        return abrirModal({
            titulo: titulo,
            textoSalvar: 'Registrar',
            campos: formularioMovimentacao(entradaId, osId),
            aoAbrir: ligarMotivoMovimentacao,
            aoSalvar: async function (valores) {
                avisar(mensagemDe(await api.post('/movimentacoes', valores), 'Movimentação registrada.'));
                await depois();
            },
        });
    }

    N.registrarAcoes({
        'nova-movimentacao': async function () {
            await carregarMovimentaveis();
            if (!estado.movimentaveis.length) {
                avisar('Não há itens em estoque para movimentar.', 'erro');
                return;
            }
            return abrirMovimentacao('Movimentação de estoque', null, null, function () {
                return janela.Telas.cadastros.carregarCadastros();
            });
        },
        'desfazer-mov': async function (id) {
            if (!confirm('Desfazer esta movimentação? O saldo volta ao que era antes dela.')) return;
            avisar(mensagemDe(await api.remover('/movimentacoes/' + id), 'Movimentação desfeita.'));
            fecharModal();
        },
    });

    janela.Telas = janela.Telas || {};
    janela.Telas.movimentacao = { verFichaDoItem: verFichaDoItem, abrirMovimentacao: abrirMovimentacao };
})(window);
