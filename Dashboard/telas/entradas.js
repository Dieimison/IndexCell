// carga: usa Formato, Nucleo, Janela; publica Telas.entradas  (conferido por testes/front/carga.test.js)
/*
 * telas/entradas.js - ESTOQUE: o que esta na loja, item por item (celular,
 * peca, produto), com saldo. Window.Telas.entradas.
 *
 * Desde a v9 a entrada NAO se lanca aqui: toda mercadoria entra pela tela
 * Entradas (telas/pedidos.js - o documento com natureza, CFOP e contas).
 * "+ Nova entrada" leva para la. Aqui o item e consultado, tem o historico
 * e e corrigido no que nao e conta (preco de venda, situacao, cor...): a
 * quantidade e o custo do que veio de documento seguem a nota, e o Excluir
 * so aparece para o lancamento avulso antigo (de antes da v9).
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, somarEmCentavos } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, rotuloDe, opcoesDoDominio, etiqueta, vazio, opcoesDe, nomeModelo,
            situacaoReal, classeSaldo, carregarCatalogos } = N;
    const { abrirModal } = janela.Janela;

    // ==================================================================
    // 4b. Entradas  (celular, peca e produto)
    // ==================================================================
    async function carregarEntradas() {
        const [dados] = await Promise.all([api.get('/entradas'), carregarCatalogos()]);
        estado.entradas = dados.itens;
        desenharEntradas();
    }

    function desenharEntradas() {
        const busca = document.getElementById('buscaEntrada').value.trim().toLowerCase();
        const tipo = document.getElementById('filtroTipo').value;
        const situacao = document.getElementById('filtroSituacao').value;
        const de = document.getElementById('entradaDe').value;
        const ate = document.getElementById('entradaAte').value;

        // O botão de limpar só existe quando há algo para limpar.
        document.getElementById('limparEntradas')
            .classList.toggle('oculta', !(busca || tipo || situacao || de || ate));

        const itens = estado.entradas.filter(function (item) {
            if (tipo && item.tipo !== tipo) return false;
            if (situacao === 'zerado') {
                if (item.saldo > 0) return false;
            } else if (situacao && situacaoReal(item) !== situacao) {
                return false;
            }
            // A data da ENTRADA, que é o que responde "o que eu comprei em tal dia".
            const dia = String(item.data_entrada).substring(0, 10);
            if (de && dia < de) return false;
            if (ate && dia > ate) return false;

            if (!busca) return true;
            return [item.item, item.imei, item.fornecedor, item.observacoes, item.descricao]
                .join(' ').toLowerCase().includes(busca);
        });

        const alvo = document.getElementById('listaEntradas');
        if (!itens.length) {
            alvo.innerHTML = vazio(busca || tipo || situacao || de || ate
                ? 'Nenhuma entrada encontrada com esses filtros.'
                : 'Nenhuma entrada registrada. Use os botões acima para registrar a primeira.');
            return;
        }

        // Os totais seguem o saldo, nao a quantidade comprada: o que ja saiu
        // nao esta mais parado na prateleira.
        const totalInvestido = somarEmCentavos(itens, function (i) { return i.valor_investimento * i.saldo; });
        const totalVenda = somarEmCentavos(itens, function (i) { return i.valor_venda * i.saldo; });

        alvo.innerHTML =
            '<div class="rolagem-x"><table>' +
            '<thead><tr><th>Item</th><th>Tipo</th><th>Situação</th><th>Saldo</th>' +
            '<th>Custo un.</th><th>Venda un.</th><th>Entrada</th><th class="coluna-acoes">Ações</th></tr></thead><tbody>' +
            itens.map(function (item) {
                const detalhe = [
                    item.imei ? 'IMEI ' + item.imei : '',
                    item.cor || '',
                    item.condicao ? rotuloDe('condicoes', item.condicao) : '',
                    item.categoria ? rotuloDe('categorias_peca', item.categoria) : '',
                    item.fornecedor ? 'de ' + item.fornecedor : '',
                    item.observacoes || '',
                ].filter(Boolean).join(' • ');

                /*
                 * "Acabando" so faz sentido para o que tem quantidade. Um
                 * celular e sempre 1 de 1: pinta-lo de amarelo por ter saldo
                 * baixo encheria a tela de alerta que nao quer dizer nada.
                 */
                const classe = item.tipo === 'celular'
                    ? (item.saldo <= 0 ? 'saldo-zero' : 'saldo-ok')
                    : classeSaldo(item.saldo);

                return '<tr>' +
                    '<td>' + escapar(item.item || '(sem cadastro)') +
                        (detalhe ? '<br><small class="observacao">' + escapar(detalhe) + '</small>' : '') + '</td>' +
                    '<td class="tipo-' + item.tipo + '">' + escapar(rotuloDe('tipos_entrada', item.tipo)) + '</td>' +
                    '<td>' + etiqueta('situacoes', situacaoReal(item)) + '</td>' +
                    '<td class="' + classe + '" style="white-space:nowrap">' +
                        item.saldo + ' de ' + item.quantidade + '</td>' +
                    '<td>' + moeda(item.valor_investimento) + '</td>' +
                    '<td>' + moeda(item.valor_venda) + '</td>' +
                    '<td>' + dataCurta(item.data_entrada) +
                        /* De onde veio: o documento (abre a Entrada) ou o lancamento avulso antigo. */
                        (item.pedido_id
                            ? '<br><button type="button" class="botao-link" data-acao="ver-documento-entrada" data-id="' + item.pedido_id +
                              '" title="Abrir a entrada">Entrada ' + escapar(item.pedido) + '</button>'
                            : '<br><small class="observacao">lançamento avulso</small>') + '</td>' +
                    '<td class="coluna-acoes">' +
                    /* Ficha do LOTE, nao do item do catalogo: aqui a pergunta e
                       "o que aconteceu com esta entrada" - quanto saiu em venda,
                       quanto foi para uma OS, o que voltou por garantia. */
                    '  <button type="button" class="botao-icone" data-acao="ficha-entrada" data-id="' + item.id + '" title="Histórico de movimentação desta entrada">Histórico</button>' +
                    '  <button type="button" class="botao-icone" data-acao="editar-entrada" data-id="' + item.id + '">Editar</button>' +
                    /* O que veio de documento se desfaz cancelando a Entrada (o servidor recusa o Excluir). */
                    (item.pedido_id ? '' :
                    '  <button type="button" class="botao-icone perigo" data-acao="excluir-entrada" data-id="' + item.id + '">Excluir</button>') +
                    '</td></tr>';
            }).join('') +
            '<tr class="linha-total"><td><strong>TOTAL (' + itens.length + ')</strong></td><td colspan="3"></td>' +
            '<td><strong>' + moeda(totalInvestido) + '</strong></td>' +
            '<td><strong>' + moeda(totalVenda) + '</strong></td><td colspan="2"></td></tr>' +
            '</tbody></table></div>';
    }

    /*
     * O formulario da entrada muda conforme o tipo. Um celular tem IMEI, cor e
     * condicao e nunca tem quantidade; uma peca tem categoria e quantidade e
     * nunca tem IMEI. Mostrar tudo junto deixaria metade dos campos sem uso em
     * qualquer cadastro.
     */
    function formularioEntrada(item, tipo) {
        item = item || {};
        tipo = tipo || item.tipo || 'celular';
        const doDocumento = !!item.pedido_id;
        const campos = [{ nome: 'tipo', tipo: 'oculto', valor: tipo }];
        if (doDocumento) {
            campos.push({ nome: '__origem', tipo: 'html', html: '<p class="observacao campo-total">Veio da entrada ' + escapar(item.pedido) +
                ': quantidade e custo seguem a nota. Para corrigir, cancele a entrada e lance de novo.</p>' });
        }

        if (tipo === 'celular') {
            campos.push({
                nome: 'modelo_id', rotulo: 'Modelo', tipo: 'select-novo', valor: item.modelo_id || '',
                opcoes: opcoesDe(estado.modelos, nomeModelo, '— cadastrar um modelo novo —'),
                campoNovo: 'modelo_nome', rotuloNovo: 'Nome do modelo novo',
                extras: [{ nome: 'marca', rotulo: 'Marca do modelo novo', lista: 'marcas' },
                         { nome: 'armazenamento', rotulo: 'Armazenamento do modelo novo', lista: 'armazenamentos' }],
                dica: 'Escolha na lista. Se for um modelo que a loja nunca teve, cadastre aqui mesmo.',
                largura: 'total',
            });
            campos.push({ nome: 'imei', rotulo: 'IMEI', valor: item.imei });
            campos.push({ nome: 'cor', rotulo: 'Cor', tipo: 'lista', lista: 'cores', valor: item.cor });
            campos.push({
                nome: 'condicao', rotulo: 'Condição', tipo: 'select', valor: item.condicao || '',
                opcoes: [{ valor: '', rotulo: '— não informado —' }].concat(
                    opcoesDoDominio('condicoes')
                ),
            });
        } else if (tipo === 'peca') {
            campos.push({
                nome: 'peca_id', rotulo: 'Peça', tipo: 'select-novo', valor: item.peca_id || '',
                opcoes: opcoesDe(estado.pecas, function (p) {
                    return rotuloDe('categorias_peca', p.categoria) + ' — ' + p.nome;
                }, '— cadastrar uma peça nova —'),
                campoNovo: 'peca_nome', rotuloNovo: 'Nome da peça nova',
                largura: 'total',
            });
            campos.push({
                nome: 'peca_categoria', rotulo: 'Categoria (só para peça nova)', tipo: 'select', valor: 'tela',
                opcoes: opcoesDoDominio('categorias_peca'),
            });
            campos.push({
                nome: 'peca_modelo_id', rotulo: 'Serve no modelo (só para peça nova)', tipo: 'select', valor: '',
                opcoes: opcoesDe(estado.modelos, nomeModelo, '— peça universal —'),
            });
            campos.push({ nome: 'quantidade', rotulo: 'Quantidade', tipo: 'number', valor: item.quantidade || 1, passo: '1', minimo: 1,
                          maximo: estado.config.quantidade_maxima, obrigatorio: true, desabilitado: doDocumento });
        } else {
            campos.push({
                nome: 'produto_id', rotulo: 'Produto', tipo: 'select-novo', valor: item.produto_id || '',
                opcoes: opcoesDe(estado.produtos, function (p) { return p.nome; }, '— cadastrar um produto novo —'),
                campoNovo: 'produto_nome', rotuloNovo: 'Nome do produto novo',
                extras: [{ nome: 'produto_categoria', rotulo: 'Categoria do produto novo', lista: 'categorias_produto' },
                         { nome: 'marca', rotulo: 'Marca do produto novo', lista: 'marcas' }],
                largura: 'total',
            });
            campos.push({ nome: 'quantidade', rotulo: 'Quantidade', tipo: 'number', valor: item.quantidade || 1, passo: '1', minimo: 1,
                          maximo: estado.config.quantidade_maxima, obrigatorio: true, desabilitado: doDocumento });
        }

        campos.push({ nome: 'valor_investimento', rotulo: 'Custo por unidade (R$)', tipo: 'number', valor: item.valor_investimento,
                      desabilitado: doDocumento });
        campos.push({ nome: 'valor_venda', rotulo: 'Venda por unidade (R$)', tipo: 'number', valor: item.valor_venda });
        /* So celular pergunta a situacao. Para peca e produto ela e
           calculada do saldo, e um campo aqui so daria a chance de gravar
           uma informacao que a tela vai ignorar. */
        if (tipo === 'celular') {
            campos.push({
                nome: 'situacao', rotulo: 'Situação', tipo: 'select',
                valor: item.situacao || 'check',
                opcoes: opcoesDoDominio('situacoes'),
            });
        }
        campos.push({
            nome: 'fornecedor_id', rotulo: 'Fornecedor', tipo: 'select', valor: item.fornecedor_id || '',
            opcoes: opcoesDe(estado.fornecedores, function (f) { return f.nome; }, '— não informado —'),
        });
        campos.push({ nome: 'nota_fiscal', rotulo: 'Nota fiscal', valor: item.nota_fiscal });
        /* O "como foi pago" saiu daqui (v9): a compra nova nasce na tela
           Entradas, que pergunta "Já paguei / fica a pagar" ao confirmar. */
        campos.push({ nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: item.observacoes, largura: 'total' });
        return campos;
    }

    // ------------------------------------------------------------------
    // Filtros, buscas e sub-abas
    // ------------------------------------------------------------------
    document.getElementById('buscaEntrada').addEventListener('input', desenharEntradas);

    document.getElementById('filtroTipo').addEventListener('change', desenharEntradas);

    document.getElementById('filtroSituacao').addEventListener('change', desenharEntradas);

    document.getElementById('entradaDe').addEventListener('change', desenharEntradas);

    document.getElementById('entradaAte').addEventListener('change', desenharEntradas);

    document.getElementById('limparEntradas').addEventListener('click', function () {
        ['buscaEntrada', 'filtroTipo', 'filtroSituacao', 'entradaDe', 'entradaAte'].forEach(function (id) {
            document.getElementById(id).value = '';
        });
        desenharEntradas();
    });

    N.registrarAcoes({
        // A mercadoria nova entra pela tela Entradas (o documento), ja com uma linha.
        'estoque-nova-entrada': function () { return janela.Telas.pedidos.novaEntrada(); },
        'ver-documento-entrada': function (id) { return janela.Telas.pedidos.abrirEntrada(id); },
        'editar-entrada': function (id) {
            const item = estado.entradas.find(function (i) { return i.id === id; });
            return abrirModal({
                titulo: 'Editar ' + (item.item || 'entrada'),
                campos: formularioEntrada(item, item.tipo),
                aoSalvar: async function (valores) {
                    avisar(mensagemDe(await api.put('/entradas/' + id, valores), 'Entrada atualizada.'));
                    await carregarEntradas();
                },
            });
        },
        'excluir-entrada': async function (id) {
            const item = estado.entradas.find(function (i) { return i.id === id; });
            if (!confirm('Excluir a entrada "' + item.item + '"?')) return;
            avisar(mensagemDe(await api.remover('/entradas/' + id), 'Entrada excluída.'));
            await carregarEntradas();
        },
        'ficha-entrada': function (id) {
            const ent = estado.entradas.find(function (e) { return e.id === id; });
            return janela.Telas.movimentacao.verFichaDoItem('entrada_id=' + id, ent && ent.item);
        },
    });

    N.registrarTela('entradas', { titulo: 'Estoque', carregar: carregarEntradas });
    janela.Telas = janela.Telas || {};
    janela.Telas.entradas = { carregarEntradas: carregarEntradas };
})(window);
