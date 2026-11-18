// carga: usa Formato, Nucleo, Janela; publica Telas.cadastros  (conferido por testes/front/carga.test.js)
/*
 * telas/cadastros.js - Cadastros: clientes, modelos, pecas, produtos,
 * servicos, fornecedores e formas de pagamento. Window.Telas.cadastros.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, dominio, rotuloDe, opcoesDoDominio, vazio, opcoesDe, nomeModelo,
            classeSaldo, etiquetaTexto, tabelaHtml, carregarCatalogos } = N;
    const { abrirModal } = janela.Janela;

    /*
     * v7: o que a nota fiscal pede do item. O servidor confere (NCM 8 numeros,
     * CEST 7, GTIN 8/12/13/14) e aceita com pontos; a nota do fornecedor
     * importada no Pedido de entrada preenche o que estiver vazio.
     */
    function camposFiscais(item) {
        return [
            { nome: '__fiscal', tipo: 'html', html: '<h4 class="sub-titulo campo-total">Dados fiscais (para a nota)</h4>' },
            { nome: 'ncm', rotulo: 'NCM', valor: item.ncm, dica: '8 números. Celular: 8517.13.00; capa de silicone: 3926.90.90.' },
            { nome: 'cest', rotulo: 'CEST', valor: item.cest, dica: '7 números, só quando o produto tem substituição tributária.' },
            { nome: 'origem', rotulo: 'Origem da mercadoria', tipo: 'select', valor: item.origem === null || item.origem === undefined ? '' : String(item.origem),
              opcoes: [{ valor: '', rotulo: '— não informada —' }].concat(opcoesDoDominio('origens_mercadoria')) },
            { nome: 'unidade', rotulo: 'Unidade', valor: item.unidade || 'UN', dica: 'UN, PC, CX, KIT...' },
            { nome: 'gtin', rotulo: 'GTIN (código de barras)', valor: item.gtin, dica: 'O número debaixo do código de barras. Vazio se não tiver.' },
        ];
    }

    estado.cadastroAtual = 'clientes';

    /* "Ativo"/"Inativo" de servico e forma de pagamento. */
    function etiquetaAtivo(ativo, masculino) {
        return etiquetaTexto(ativo ? (masculino ? 'Ativo' : 'Ativa') : (masculino ? 'Inativo' : 'Inativa'),
                             ativo ? '--serie-3' : '--tinta-fraca');
    }

    // ==================================================================
    // 4e. Cadastros  (clientes, modelos, pecas, produtos, fornecedores)
    // ==================================================================
    /*
     * As cinco listas se comportam igual: buscar, listar, editar, excluir. O
     * que muda e o desenho das colunas e o formulario, entao cada uma entra
     * aqui como uma configuracao, e nao como uma tela inteira copiada.
     */
    const CADASTROS = {
        clientes: {
            titulo: 'cliente',
            rota: '/clientes',
            lista: function () { return estado.clientes; },
            busca: function (c) { return [c.nome, c.telefone, c.documento, c.email]; },
            colunas: ['Nome', 'Telefone', 'Documento', 'E-mail'],
            celulas: function (c) {
                return [escapar(c.nome) + (c.endereco ? '<br><small class="observacao">' + escapar(c.endereco) + '</small>' : ''),
                        escapar(c.telefone || '—'), escapar(c.documento || '—'), escapar(c.email || '—')];
            },
            formulario: function (c) {
                c = c || {};
                return [
                    { nome: 'nome', rotulo: 'Nome', valor: c.nome, obrigatorio: true, largura: 'total' },
                    { nome: 'telefone', rotulo: 'Telefone', valor: c.telefone },
                    { nome: 'documento', rotulo: 'CPF ou CNPJ', valor: c.documento },
                    { nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: c.email },
                    { nome: 'endereco', rotulo: 'Endereço', valor: c.endereco, largura: 'total' },
                    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: c.observacoes, largura: 'total' },
                ];
            },
        },

        modelos: {
            titulo: 'modelo',
            rota: '/modelos',
            movimenta: true,
            lista: function () { return estado.modelos; },
            busca: function (m) { return [m.marca, m.modelo, m.armazenamento]; },
            colunas: ['Modelo', 'Marca', 'Armazenamento', 'Em uso'],
            celulas: function (m) {
                return [escapar(m.modelo) + (m.observacoes ? '<br><small class="observacao">' + escapar(m.observacoes) + '</small>' : ''),
                        escapar(m.marca || '—'), escapar(m.armazenamento || '—'),
                        m.em_estoque + ' entrada(s), ' + m.aparelhos + ' aparelho(s)'];
            },
            formulario: function (m) {
                m = m || {};
                return [
                    { nome: 'marca', rotulo: 'Marca', tipo: 'lista', lista: 'marcas', valor: m.marca,
                      dica: 'Escolha na lista. Marca que a loja nunca teve: "+ Nova marca".' },
                    { nome: 'modelo', rotulo: 'Modelo', valor: m.modelo, obrigatorio: true },
                    { nome: 'armazenamento', rotulo: 'Armazenamento', tipo: 'lista', lista: 'armazenamentos', valor: m.armazenamento,
                      vazio: '— não se aplica —' },
                    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: m.observacoes, largura: 'total' },
                ].concat(camposFiscais(m));
            },
        },

        pecas: {
            titulo: 'peça',
            rota: '/pecas',
            movimenta: true,
            lista: function () { return estado.pecas; },
            busca: function (p) { return [p.nome, p.codigo, p.modelo_nome, rotuloDe('categorias_peca', p.categoria)]; },
            colunas: ['Peça', 'Categoria', 'Serve no modelo', 'Saldo'],
            celulas: function (p) {
                return [escapar(p.nome) + (p.codigo ? '<br><small class="observacao">cód. ' + escapar(p.codigo) + '</small>' : ''),
                        escapar(rotuloDe('categorias_peca', p.categoria)),
                        escapar(p.modelo_nome || 'universal'),
                        '<span class="' + classeSaldo(p.saldo) + '">' +
                            p.saldo + '</span>'];
            },
            formulario: function (p) {
                p = p || {};
                return [
                    { nome: 'nome', rotulo: 'Nome da peça', valor: p.nome, obrigatorio: true, largura: 'total' },
                    {
                        nome: 'categoria', rotulo: 'Categoria', tipo: 'select', valor: p.categoria || 'tela',
                        opcoes: opcoesDoDominio('categorias_peca'),
                    },
                    {
                        nome: 'modelo_id', rotulo: 'Serve no modelo', tipo: 'select', valor: p.modelo_id || '',
                        opcoes: opcoesDe(estado.modelos, nomeModelo, '— peça universal —'),
                    },
                    { nome: 'codigo', rotulo: 'Código / SKU', valor: p.codigo },
                    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: p.observacoes, largura: 'total' },
                ].concat(camposFiscais(p));
            },
        },

        produtos: {
            titulo: 'produto',
            rota: '/produtos',
            movimenta: true,
            lista: function () { return estado.produtos; },
            busca: function (p) { return [p.nome, p.categoria, p.marca, p.codigo]; },
            colunas: ['Produto', 'Categoria', 'Marca', 'Saldo'],
            celulas: function (p) {
                return [escapar(p.nome) + (p.codigo ? '<br><small class="observacao">cód. ' + escapar(p.codigo) + '</small>' : ''),
                        escapar(p.categoria || '—'), escapar(p.marca || '—'),
                        '<span class="' + classeSaldo(p.saldo) + '">' +
                            p.saldo + '</span>'];
            },
            formulario: function (p) {
                p = p || {};
                return [
                    { nome: 'nome', rotulo: 'Nome do produto', valor: p.nome, obrigatorio: true, largura: 'total' },
                    { nome: 'categoria', rotulo: 'Categoria', tipo: 'lista', lista: 'categorias_produto', valor: p.categoria },
                    { nome: 'marca', rotulo: 'Marca', tipo: 'lista', lista: 'marcas', valor: p.marca },
                    { nome: 'codigo', rotulo: 'Código / SKU', valor: p.codigo },
                    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: p.observacoes, largura: 'total' },
                ].concat(camposFiscais(p));
            },
        },

        servicos: {
            titulo: 'serviço',
            rota: '/servicos',
            lista: function () { return estado.servicos; },
            busca: function (sv) { return [sv.nome, sv.descricao]; },
            colunas: ['Serviço', 'Preço de tabela', 'Tempo médio', 'Já usado em', 'Situação'],
            celulas: function (sv) {
                return [
                    escapar(sv.nome) + (sv.descricao ? '<br><small class="observacao">' + escapar(sv.descricao) + '</small>' : ''),
                    sv.valor_padrao > 0 ? moeda(sv.valor_padrao)
                        : '<small class="observacao">a definir</small>',
                    sv.tempo_medio ? sv.tempo_medio + ' min' : '—',
                    sv.usos + ' OS' + (sv.faturado > 0 ? ' · ' + moeda(sv.faturado) : ''),
                    etiquetaAtivo(sv.ativo, true),
                ];
            },
            formulario: function (sv) {
                sv = sv || {};
                return [
                    { nome: 'nome', rotulo: 'Nome do serviço', valor: sv.nome, obrigatorio: true, largura: 'total' },
                    { nome: 'valor_padrao', rotulo: 'Preço de tabela (R$)', tipo: 'number', valor: sv.valor_padrao,
                      minimo: 0,
                      dica: 'Entra na OS como sugestão. Dá para cobrar outro valor no conserto difícil.' },
                    { nome: 'tempo_medio', rotulo: 'Tempo médio (min)', tipo: 'number', passo: '1', minimo: 0,
                      maximo: estado.config.tempo_medio_maximo,
                      valor: sv.tempo_medio, dica: 'Opcional. Ajuda a prometer prazo ao cliente.' },
                    { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea', valor: sv.descricao, largura: 'total' },
                    { nome: 'ativo', rotulo: 'Oferecer este serviço?', tipo: 'checkbox',
                      valor: sv.id ? !!sv.ativo : true, textoSim: 'Sim, aparece na OS' },
                ];
            },
        },

        /*
         * Formas de pagamento. Virou cadastro porque campo de digitar em
         * relatório gera "Pix", "pix" e "PIX" — três linhas no agrupamento
         * para o mesmo dinheiro.
         *
         * Em uso não se exclui, desativa: a forma some das listas e os
         * documentos antigos continuam apontando para ela.
         */
        formas: {
            titulo: 'forma de pagamento',
            rota: '/formas-pagamento',
            lista: function () { return estado.formasPagamento; },
            busca: function (f) { return [f.nome, rotuloDe('tipos_pagamento', f.tipo)]; },
            colunas: ['Forma', 'Tipo', 'Parcelas padrão', 'Em uso', 'Situação'],
            celulas: function (f) {
                return [
                    escapar(f.nome) + (f.padrao ? ' ' + etiquetaTexto('padrão nas vendas', '--acento') : '') +
                        (f.observacoes ? '<br><small class="observacao">' + escapar(f.observacoes) + '</small>' : ''),
                    escapar(rotuloDe('tipos_pagamento', f.tipo)),
                    f.parcelas_padrao + 'x',
                    f.usos + ' registro(s)',
                    etiquetaAtivo(f.ativo, false),
                ];
            },
            /*
             * A forma pre-escolhida nas vendas e a marcada como PADRAO (so
             * uma; marcar outra troca). A ordem de uma forma nova e o fim da
             * lista, posta pelo servidor: o campo so aparece ao editar.
             */
            formulario: function (f) {
                f = f || {};
                const tipos = opcoesDoDominio('tipos_pagamento');
                return [
                    { nome: 'nome', rotulo: 'Nome', valor: f.nome, obrigatorio: true, largura: 'total',
                      dica: 'É este texto que vai aparecer nas listas e nos relatórios.' },
                    {
                        nome: 'tipo', rotulo: 'Tipo', tipo: 'select', valor: f.tipo || (tipos[0] && tipos[0].valor),
                        opcoes: tipos,
                    },
                    { nome: 'parcelas_padrao', rotulo: 'Parcelas sugeridas', tipo: 'number',
                      valor: f.parcelas_padrao === undefined ? 1 : f.parcelas_padrao, passo: '1', minimo: 1,
                      maximo: estado.config.parcelas_max,
                      dica: 'O que a venda sugere ao escolher esta forma.' },
                ].concat(f.id ? [
                    { nome: 'ordem', rotulo: 'Ordem na lista', tipo: 'number', valor: f.ordem || 0, passo: '1',
                      dica: 'Menor aparece primeiro.' },
                ] : []).concat(estado.config.perfil === 'admin' ? [
                    // Trocar a forma pre-escolhida de toda a loja e coisa do admin (o servidor tambem recusa).
                    { nome: 'padrao', rotulo: 'Usar como padrão nas vendas', tipo: 'checkbox', valor: !!f.padrao,
                      textoSim: 'Sim, vem marcada em toda venda nova',
                      dica: f.padrao ? 'É a padrão hoje. Para trocar, marque outra forma.' : 'Marcar aqui tira a marca da padrão atual.' },
                ] : []).concat([
                    {
                        nome: 'ativo', rotulo: 'Aparece nas listas?', tipo: 'checkbox',
                        valor: f.ativo === undefined ? true : !!f.ativo,
                        textoSim: 'Sim, disponível para uso',
                    },
                    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: f.observacoes, largura: 'total' },
                ]);
            },
        },

        fornecedores: {
            titulo: 'fornecedor',
            rota: '/fornecedores',
            lista: function () { return estado.fornecedores; },
            busca: function (f) { return [f.nome, f.telefone, f.documento, f.email]; },
            colunas: ['Nome', 'Telefone', 'Documento', 'E-mail'],
            celulas: function (f) {
                return [escapar(f.nome), escapar(f.telefone || '—'), escapar(f.documento || '—'), escapar(f.email || '—')];
            },
            formulario: function (f) {
                f = f || {};
                return [
                    { nome: 'nome', rotulo: 'Nome', valor: f.nome, obrigatorio: true, largura: 'total' },
                    { nome: 'telefone', rotulo: 'Telefone', valor: f.telefone },
                    { nome: 'documento', rotulo: 'CNPJ', valor: f.documento,
                      dica: 'É por ele que a nota do fornecedor (XML) acha este cadastro.' },
                    { nome: 'ie', rotulo: 'Inscrição estadual', valor: f.ie },
                    { nome: 'uf', rotulo: 'UF', tipo: 'select', valor: f.uf || '',
                      opcoes: [{ valor: '', rotulo: '— não informada —' }].concat(opcoesDoDominio('ufs').map(function (u) {
                          return { valor: u.valor, rotulo: u.valor + ' - ' + u.rotulo };
                      })),
                      dica: 'De outro estado, o pedido de entrada usa o CFOP interestadual (2.xxx).' },
                    { nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: f.email },
                    { nome: 'endereco', rotulo: 'Endereço', valor: f.endereco, largura: 'total' },
                    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: f.observacoes, largura: 'total' },
                ];
            },
        },
    };

    async function carregarCadastros() {
        await carregarCatalogos();
        desenharCadastro();
    }

    function desenharCadastro() {
        const config = CADASTROS[estado.cadastroAtual];
        const busca = document.getElementById('buscaCadastro').value.trim().toLowerCase();

        document.getElementById('botaoNovoCadastro').textContent = '+ Novo ' + config.titulo;
        document.querySelectorAll('#subAbasCadastros .sub-aba').forEach(function (aba) {
            aba.classList.toggle('ativa', aba.dataset.cadastro === estado.cadastroAtual);
        });

        const itens = config.lista().filter(function (item) {
            if (!busca) return true;
            return config.busca(item).filter(Boolean).join(' ').toLowerCase().includes(busca);
        });

        const alvo = document.getElementById('listaCadastro');
        if (!itens.length) {
            alvo.innerHTML = vazio('Nenhum registro encontrado.');
            return;
        }

        alvo.innerHTML = tabelaHtml({
            colunas: config.colunas.concat([{ titulo: 'Ações', classe: 'coluna-acoes' }]),
            linhas: itens.map(function (item) {
                return config.celulas(item).concat([{ classe: 'coluna-acoes', html:
                    // So o que tem estoque tem movimentacao para mostrar.
                    (config.movimenta
                        ? '<button type="button" class="botao-icone" data-acao="ficha-item" data-id="' + item.id + '">Movimentação</button> '
                        : '') +
                    '<button type="button" class="botao-icone" data-acao="editar-cadastro" data-id="' + item.id + '">Editar</button> ' +
                    '<button type="button" class="botao-icone perigo" data-acao="excluir-cadastro" data-id="' + item.id + '">Excluir</button>' }]);
            }),
        });
    }

    document.getElementById('buscaCadastro').addEventListener('input', desenharCadastro);

    document.getElementById('subAbasCadastros').addEventListener('click', function (evento) {
        const aba = evento.target.closest('.sub-aba');
        if (!aba) return;
        estado.cadastroAtual = aba.dataset.cadastro;
        document.getElementById('buscaCadastro').value = '';
        desenharCadastro();
    });


    /* Forma de pagamento: o interruptor "padrao" so vai no corpo quando
       ligado (PUT {padrao:true} troca a padrao); desligado nao desmarca -
       para trocar a padrao, marca-se outra forma. */
    function prepararValores(valores) {
        if (estado.cadastroAtual === 'formas') {
            if (valores.padrao) valores.padrao = true;
            else delete valores.padrao;
        }
        return valores;
    }

    N.registrarAcoes({
        'novo-cadastro': function () {
            const config = CADASTROS[estado.cadastroAtual];
            return abrirModal({
                titulo: 'Novo ' + config.titulo,
                campos: config.formulario(null),
                aoSalvar: async function (valores) {
                    avisar(mensagemDe(await api.post(config.rota, prepararValores(valores)), 'Cadastro salvo.'));
                    await carregarCadastros();
                },
            });
        },
        'editar-cadastro': function (id) {
            const config = CADASTROS[estado.cadastroAtual];
            const item = config.lista().find(function (i) { return i.id === id; });
            return abrirModal({
                titulo: 'Editar ' + config.titulo,
                campos: config.formulario(item),
                aoSalvar: async function (valores) {
                    avisar(mensagemDe(await api.put(config.rota + '/' + id, prepararValores(valores)), 'Cadastro atualizado.'));
                    await carregarCadastros();
                },
            });
        },
        'excluir-cadastro': async function (id) {
            const config = CADASTROS[estado.cadastroAtual];
            const item = config.lista().find(function (i) { return i.id === id; });
            if (!confirm('Excluir "' + (item.nome || item.modelo) + '"?')) return;
            avisar(mensagemDe(await api.remover(config.rota + '/' + id), 'Registro excluído.'));
            await carregarCadastros();
        },
        // A ficha e do item do CATALOGO, somando todos os lotes dele.
        'ficha-item': function (id) {
            const chave = { modelos: 'modelo_id', pecas: 'peca_id', produtos: 'produto_id' }[estado.cadastroAtual];
            const item = CADASTROS[estado.cadastroAtual].lista().find(function (i) { return i.id === id; });
            return janela.Telas.movimentacao.verFichaDoItem(chave + '=' + id, item && (item.nome || item.modelo));
        },
    });

    N.registrarTela('cadastros', { titulo: 'Cadastros', carregar: carregarCadastros });
    janela.Telas = janela.Telas || {};
    janela.Telas.cadastros = { carregarCadastros: carregarCadastros };
})(window);
