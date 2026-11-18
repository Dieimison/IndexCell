// carga: usa Formato; publica Nucleo  (conferido por testes/front/carga.test.js)
/*
 * nucleo.js - o que todas as telas do painel usam. Window.Nucleo.
 *
 * Como o painel e montado (sem build, sem framework):
 *
 *   formato.js  dre.js  os-regras.js   contas e formatacao puras (tambem no Node)
 *   graficos.js                        window.Graficos
 *   nucleo.js                          window.Nucleo  - este arquivo
 *   janela.js                          window.Janela  - o modal de cadastro
 *   editores.js                        window.Editores - itens e pagamentos
 *   telas/*.js                         uma tela por arquivo; cada uma se
 *                                      registra com registrarTela() e
 *                                      registrarAcoes()
 *   inicio.js                          carrega a sessao e o /api/config e abre
 *
 * Sao scripts CLASSICOS, carregados em ordem pelo dashboard.html. Cada um
 * e um IIFE que pega o que precisa dos objetos ja carregados (no topo:
 * "const { api, estado } = window.Nucleo;") e publica o seu proprio objeto
 * em window. Nada mais vira global. Escolhemos script classico, e nao
 * <script type="module">, porque o sistema tambem e aberto pelo
 * navegador da loja sem servidor de desenvolvimento e porque os testes do
 * Node carregam os arquivos puros com require.
 *
 * O que mora aqui:
 *   1. api            conversa com /api (sessao caida, troca de senha)
 *   2. estado/config  o que veio do servidor; config.dominios da os rotulos
 *   3. html           etiqueta, vazio, opcoes, tabelaHtml, cardSimples...
 *   4. navegacao      registro de telas, menu, Voltar do navegador
 *   5. acoes          registro ACOES: data-acao="x" no botao chama ACOES[x]
 *   6. catalogos      listas usadas pelos selects de varias telas
 */
(function (janela) {
    'use strict';

    const { escapar, moeda } = janela.Formato;

    // ==================================================================
    // 1. Conversa com a API
    // ==================================================================
    const SESSAO_CAIU = 'Sua sessão terminou. Entre de novo aqui mesmo e clique em Salvar outra vez.';

    /** Erro com o código HTTP junto: 401, 403 e 409 são tratados diferente. */
    function erroDaApi(mensagem, status, dados) {
        const erro = new Error(mensagem);
        erro.status = status;
        erro.dados = dados || {};
        return erro;
    }

    /*
     * Ganchos: quem carrega DEPOIS deste arquivo reage a eventos daqui sem
     * que o nucleo o conheca (nao ha ciclo nucleo <-> janela). Preenchidos
     * pela janela (formulario aberto, Voltar com formulario alterado) e pelo
     * inicio.js (troca obrigatoria de senha, canto do usuario).
     */
    const ganchosApi = {
        formularioAberto: function () { return false; },
        antesDeNavegar: function () { return true; },
        trocarSenha: function () {},
        usuarioAtualizado: function () {},
    };

    const api = {
        /*
         * Toda chamada leva JSON e vai pelo fetch, que manda Origin do
         * proprio endereco: o servidor recusa mutacao sem isso (CSRF). Nada
         * de formulario nativo nem sendBeacon para gravar.
         */
        async pedir(caminho, opcoes) {
            opcoes = opcoes || {};
            const config = {
                method: opcoes.method || 'GET',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
            };
            if (opcoes.corpo !== undefined) {
                config.body = JSON.stringify(opcoes.corpo);
            }

            let resposta;
            try {
                resposta = await fetch('/api' + caminho, config);
            } catch (erro) {
                throw new Error('Sem conexão com o servidor. Ele ainda está rodando?');
            }

            const dados = await resposta.json().catch(function () { return {}; });

            /*
             * Sessao caiu (Sair em outra aba, servidor reiniciado...). Com
             * um formulario aberto, NAO sai da pagina: a janela mostra o
             * aviso com um login ali mesmo (ver janela.js) e o que esta nos
             * campos fica onde esta. Sem formulario, volta para o login.
             */
            if (resposta.status === 401) {
                if (ganchosApi.formularioAberto()) {
                    throw erroDaApi(SESSAO_CAIU, 401, dados);
                }
                window.location.href = '../Login/index.html';
                throw erroDaApi('Sessão expirada.', 401, dados);
            }

            // Senha provisoria: nada funciona antes de trocar.
            if (resposta.status === 403 && dados.trocar_senha) {
                ganchosApi.trocarSenha();
                throw erroDaApi(dados.erro || 'Troque sua senha para continuar.', 403, dados);
            }

            if (!resposta.ok || dados.ok === false) {
                throw erroDaApi(dados.erro || 'Erro na operação (HTTP ' + resposta.status + ').',
                                resposta.status, dados);
            }
            return dados;
        },
        get(caminho) { return api.pedir(caminho); },
        post(caminho, corpo) { return api.pedir(caminho, { method: 'POST', corpo: corpo }); },
        put(caminho, corpo) { return api.pedir(caminho, { method: 'PUT', corpo: corpo }); },
        remover(caminho) { return api.pedir(caminho, { method: 'DELETE' }); },
    };

    /** A mensagem que a API devolveu ao gravar, ou um texto padrão. */
    function mensagemDe(resposta, padrao) {
        return (resposta && resposta.mensagem) || padrao;
    }

    // ==================================================================
    // 2. Estado e configuracao
    // ==================================================================
    const estado = {
        usuario: null,
        /* GET /api/config: limites, listas de status, dominios e o que o
           perfil pode. Vem do servidor ANTES de qualquer tela ser
           desenhada (inicio.js); a tela nao tem numeros de reserva. */
        config: null,
        entradas: [],
        disponiveis: [],   // entradas com saldo, para os selects de venda e OS
        movimentaveis: [], // todas as entradas, para a tela de movimentacao
        os: [],
        vendas: [],
        lancamentos: [],
        clientes: [],
        fornecedores: [],
        formasPagamento: [],
        modelos: [],
        pecas: [],
        produtos: [],
        servicos: [],
        usuarios: [],
        listas: {},        // marcas, cores... (GET /api/listas): os campos de lista
        relatorio: null,
        secaoAtual: 'inicio',
    };

    /*
     * Dominios: as listas de valores com rotulo (status da OS, categorias
     * de peca, motivos de movimentacao com o lado, perfis...). A fonte e o
     * servidor (config.dominios), o mesmo que confere o CHECK do banco -
     * aqui nao ha copia. A tela so acrescenta a COR de cada valor, que e
     * apresentacao, e os poucos valores que existem so na tela (abaixo).
     */
    const DOMINIOS_DA_TELA = {
        // Peca e produto nao tem situacao gravada: a tela deriva do saldo (situacaoReal).
        situacoes: [
            { valor: 'em_estoque', rotulo: 'Em estoque' },
            { valor: 'esgotado', rotulo: 'Esgotado' },
        ],
        // De onde veio um movimento de estoque que nao e motivo manual.
        origens_estoque: [
            { valor: 'compra', rotulo: 'Compra' },
            { valor: 'venda', rotulo: 'Venda' },
            { valor: 'os', rotulo: 'Ordem de serviço' },
        ],
        // De onde veio um lancamento.
        origens_lancamento: [
            { valor: 'manual', rotulo: 'lançamento manual' },
            { valor: 'venda', rotulo: 'venda' },
            { valor: 'os', rotulo: 'ordem de serviço' },
            { valor: 'entrada', rotulo: 'compra de estoque' },
        ],
    };

    /* Cor de cada valor, por token do CSS (dashboard.css :root). */
    const CORES = {
        status_os: { aberta: '--serie-1', orcamento: '--serie-5', aprovada: '--serie-3', em_reparo: '--serie-2',
                     pronta: '--bom', entregue: '--tinta-fraca', recusada: '--critico', cancelada: '--critico' },
        status_venda: { concluida: '--bom', cancelada: '--critico' },
        situacoes: { ready: '--serie-3', processamento: '--serie-2', check: '--serie-1', vendido: '--serie-5',
                     em_estoque: '--serie-3', esgotado: '--tinta-fraca' },
        tipos_entrada: { celular: '--serie-1', peca: '--serie-2', produto: '--serie-5' },
        status_lancamento: { pendente: '--atencao', pago: '--bom', cancelado: '--tinta-fraca' },
        tipos_lancamento: { receber: '--serie-3', pagar: '--serie-2' },
        motivos_movimentacao: { garantia: '--serie-3', retorno: '--serie-1', devolucao: '--serie-4',
                                defeito: '--critico', perda: '--critico', ajuste: '--tinta-fraca', brinde: '--serie-5' },
        origens_estoque: { compra: '--serie-1', venda: '--serie-5', os: '--serie-2' },
    };

    /** A lista [{valor, rotulo, ...}] de um dominio: a do servidor e, depois, o que so a tela tem. */
    function dominio(nome) {
        const doServidor = (estado.config && estado.config.dominios && estado.config.dominios[nome]) || [];
        const daTela = (DOMINIOS_DA_TELA[nome] || []).filter(function (d) {
            return !doServidor.some(function (s) { return s.valor === d.valor; });
        });
        return doServidor.concat(daTela);
    }

    /** So os valores que o servidor conhece (o que pode ser gravado). */
    function dominioDoServidor(nome) {
        return (estado.config && estado.config.dominios && estado.config.dominios[nome]) || [];
    }

    /** O rotulo de um valor; o proprio valor se o dominio nao o conhece. */
    function rotuloDe(nome, valor) {
        const item = dominio(nome).find(function (d) { return d.valor === valor; });
        return item ? item.rotulo : (valor || '—');
    }

    /** O token de cor de um valor (o neutro se nao houver). */
    function corDe(nome, valor) {
        return (CORES[nome] && CORES[nome][valor]) || '--tinta-fraca';
    }

    /* Para um <select>: [{valor, rotulo}] do dominio. */
    function opcoesDoDominio(nome) {
        return dominioDoServidor(nome).map(function (d) { return { valor: d.valor, rotulo: d.rotulo }; });
    }

    // ==================================================================
    // 3. Pedacos de HTML
    // ==================================================================
    /*
     * Etiqueta colorida com o nome do valor. A cor e um token do CSS e o
     * fundo e a borda saem dela por color-mix no .etiqueta: a paleta mora
     * so no dashboard.css. A etiqueta SEMPRE mostra o texto - a cor ajuda
     * a achar, o texto e que diz o que e.
     */
    function etiqueta(nomeDominio, valor) {
        return '<span class="etiqueta" style="--cor-etiqueta:var(' + corDe(nomeDominio, valor) + ')">' +
               escapar(rotuloDe(nomeDominio, valor)) + '</span>';
    }

    /* Etiqueta de um texto qualquer com uma cor de token ("Ativo", "Bloqueado ate..."). */
    function etiquetaTexto(texto, corToken) {
        return '<span class="etiqueta" style="--cor-etiqueta:var(' + corToken + ')">' + escapar(texto) + '</span>';
    }

    function vazio(mensagem) {
        return '<p class="texto-vazio">' + escapar(mensagem) + '</p>';
    }

    /** Monta as opcoes de um select a partir de uma lista da API. */
    function opcoesDe(lista, rotulo, vazioTexto) {
        const opcoes = vazioTexto === null ? [] : [{ valor: '', rotulo: vazioTexto || '— selecione —' }];
        return opcoes.concat(lista.map(function (item) {
            return { valor: String(item.id), rotulo: rotulo(item) };
        }));
    }

    /*
     * Uma tabela. Cada celula e um texto JA em HTML (quem monta escapa) ou
     * { html, classe, colspan }. Coluna: 'Titulo' ou { titulo, classe }.
     *
     *   tabelaHtml({ colunas: ['Item', { titulo: 'Valor', classe: 'numero' }],
     *                linhas: [[escapar(nome), moeda(v)], ...],
     *                total: ['<strong>TOTAL</strong>', ...],   // opcional
     *                vazio: 'Nada aqui.' })                    // sem linhas
     */
    function tabelaHtml(config) {
        const celula = function (tag) {
            return function (c) {
                const obj = (c !== null && typeof c === 'object') ? c : { html: c };
                return '<' + tag + (obj.classe ? ' class="' + obj.classe + '"' : '') +
                       (obj.colspan ? ' colspan="' + obj.colspan + '"' : '') + '>' +
                       (obj.html === undefined || obj.html === null ? '' : obj.html) + '</' + tag + '>';
            };
        };
        const cabeca = (config.colunas || []).map(function (c) {
            return typeof c === 'string' ? { html: escapar(c) } : { html: escapar(c.titulo), classe: c.classe };
        }).map(celula('th')).join('');
        const linhas = config.linhas || [];
        const corpo = linhas.length
            ? linhas.map(function (l) {
                const celulas = Array.isArray(l) ? l : l.celulas;
                return '<tr' + (l.classe ? ' class="' + l.classe + '"' : '') + '>' + celulas.map(celula('td')).join('') + '</tr>';
            }).join('') + (config.total ? '<tr class="linha-total">' + config.total.map(celula('td')).join('') + '</tr>' : '')
            : '<tr class="empty-row"><td colspan="' + (config.colunas || []).length + '">' + escapar(config.vazio || '') + '</td></tr>';
        const tabela = '<table><thead><tr>' + cabeca + '</tr></thead><tbody>' + corpo + '</tbody></table>';
        return config.rolagem === false ? tabela : '<div class="rolagem-x">' + tabela + '</div>';
    }

    function cardSimples(titulo, valor, corToken) {
        return '<div class="stat-box">' +
               '  <div class="stat-title"><span style="background:var(' + (corToken || '--serie-1') + ')"></span>' +
                    escapar(titulo) + '</div>' +
               '  <div class="stat-value">' + escapar(valor) + '</div>' +
               '</div>';
    }

    /** Dinheiro, ou "—" quando o campo nem veio (o servidor esconde custo do balcão). */
    function moedaOuTraco(valor) {
        return valor === undefined || valor === null ? '—' : moeda(valor);
    }

    /** Nome cheio do modelo: marca, modelo e armazenamento, o que existir. */
    function nomeModelo(m) {
        return [m.marca, m.modelo, m.armazenamento].filter(Boolean).join(' ').trim();
    }

    /*
     * O que separa dois celulares do mesmo modelo numa lista de estoque: o
     * IMEI (o que está na caixa); sem IMEI, a cor e o número da entrada.
     * Peça e produto não mudam - unidades iguais de verdade.
     */
    function identificacaoDoAparelho(entrada) {
        if (entrada.tipo !== 'celular') return '';
        const imei = String(entrada.imei || '').trim();
        if (imei) return ' · IMEI ' + imei;
        const cor = String(entrada.cor || '').trim();
        return (cor ? ' · ' + cor : '') + ' · entrada nº ' + entrada.id;
    }

    /*
     * A situacao que a tela mostra. Celular e unitario: o campo gravado
     * diz a verdade sobre AQUELE aparelho. Peca e produto tem quantidade,
     * e para eles quem sabe a verdade e o saldo.
     */
    function situacaoReal(item) {
        if (item.tipo === 'celular') return item.situacao;
        return item.saldo > 0 ? 'em_estoque' : 'esgotado';
    }

    /*
     * Classe do saldo de peca/produto: zerado, acabando ou ok. "Acabando"
     * e config.estoque_baixo, o mesmo numero em todas as telas.
     */
    function classeSaldo(saldo) {
        if (saldo <= 0) return 'saldo-zero';
        return saldo <= estado.config.estoque_baixo ? 'saldo-baixo' : 'saldo-ok';
    }

    /** A forma marcada como padrão no cadastro ("Usar como padrão nas vendas"). */
    function formaPadrao() {
        const padrao = estado.formasPagamento.find(function (f) { return f.ativo && f.padrao; });
        return padrao ? padrao.id : '';
    }

    /*
     * Campo de forma de pagamento, usado por venda, OS e lancamento: os
     * tres oferecem exatamente as mesmas opcoes. Forma desativada continua
     * aparecendo se o documento ja usa ela.
     */
    function campoFormaPagamento(valorId, dica) {
        return {
            nome: 'forma_pagamento_id', rotulo: 'Forma de pagamento', tipo: 'select',
            valor: valorId ? String(valorId) : '',
            opcoes: opcoesDe(estado.formasPagamento.filter(function (f) {
                return f.ativo || String(f.id) === String(valorId);
            }), function (f) {
                return f.nome + (f.ativo ? '' : ' (inativa)');
            }, '— não informado —'),
            dica: dica,
        };
    }

    function avisar(mensagem, tipo) {
        const aviso = document.createElement('div');
        aviso.className = 'aviso ' + (tipo === 'erro' ? 'aviso-erro' : 'aviso-ok');
        aviso.textContent = mensagem;
        document.getElementById('avisos').appendChild(aviso);
        setTimeout(function () { aviso.classList.add('sumindo'); }, 3200);
        setTimeout(function () { aviso.remove(); }, 3700);
    }

    // ==================================================================
    // 4. Navegacao
    // ==================================================================
    /* nome -> { titulo, carregar, soFinanceiro } (cada tela se registra) */
    const TELAS = {};

    function registrarTela(nome, tela) {
        TELAS[nome] = tela;
    }

    /*
     * Troca a seção visível. Cada clique no menu vira uma entrada no
     * historico do navegador (pushState), entao o Voltar volta para a
     * secao anterior. Quem chega pelo proprio Voltar nao empilha de novo.
     */
    function mostrarSecao(nome, empilhar) {
        if (!TELAS[nome]) nome = 'inicio';
        if (TELAS[nome].soFinanceiro && !estado.config.pode_ver_financeiro) nome = 'inicio';
        if (TELAS[nome].soAdmin && !estado.config.pode_admin) nome = 'inicio';
        estado.secaoAtual = nome;

        document.querySelectorAll('.secao').forEach(function (secao) {
            secao.classList.toggle('oculta', secao.id !== 'secao-' + nome);
        });
        document.querySelectorAll('nav a[data-secao]').forEach(function (link) {
            link.classList.toggle('active', link.dataset.secao === nome);
        });
        marcarGrupos(nome);

        document.getElementById('tituloPagina').textContent = TELAS[nome].titulo;
        // Tela cheia (o PDV): sem menu lateral nem barra de cima.
        document.body.classList.toggle('tela-cheia', !!TELAS[nome].telaCheia);
        fecharMenuLateral();

        if (window.location.hash !== '#' + nome) {
            if (empilhar) history.pushState(null, '', '#' + nome);
            else history.replaceState(null, '', '#' + nome);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });

        TELAS[nome].carregar().catch(function (erro) {
            avisar(erro.message, 'erro');
        });
    }

    document.querySelectorAll('nav a[data-secao]').forEach(function (link) {
        link.addEventListener('click', function (evento) {
            evento.preventDefault();
            mostrarSecao(this.dataset.secao, true);
        });
    });

    /*
     * Menu em grupos (v9). O grupo e um botao (aria-expanded) com a lista
     * embaixo (hidden). Navegar abre o grupo da secao aberta e fecha os
     * outros, entao o menu fica sempre curto; clicar no titulo do grupo so
     * abre ou fecha aquele grupo. Fechado, o grupo da secao aberta fica
     * aceso (.tem-ativo), para a pessoa saber onde esta.
     */
    function abrirGrupo(grupo, aberto) {
        grupo.querySelector('.menu-grupo-botao').setAttribute('aria-expanded', aberto ? 'true' : 'false');
        grupo.querySelector('.submenu').hidden = !aberto;
    }

    function marcarGrupos(nome) {
        document.querySelectorAll('nav .menu-grupo').forEach(function (grupo) {
            const tem = !!grupo.querySelector('a[data-secao="' + nome + '"]');
            grupo.classList.toggle('tem-ativo', tem);
            abrirGrupo(grupo, tem);
        });
    }

    document.querySelectorAll('nav .menu-grupo-botao').forEach(function (botao) {
        botao.addEventListener('click', function () {
            abrirGrupo(botao.closest('.menu-grupo'), botao.getAttribute('aria-expanded') !== 'true');
        });
    });

    /*
     * Voltar/Avancar do navegador. Com um formulario aberto e alterado, o
     * Voltar nao troca de secao por baixo dele: a janela treme, como no Esc.
     */
    window.addEventListener('hashchange', function () {
        if (!ganchosApi.antesDeNavegar()) {
            history.pushState(null, '', '#' + estado.secaoAtual);
            return;
        }
        mostrarSecao(window.location.hash.replace('#', ''));
    });

    // ---- menu lateral em tela estreita: desliza por cima, sombra fecha ----
    const sidebar = document.getElementById('sidebar');
    let sombraMenu = null;

    function abrirMenuLateral() {
        sidebar.classList.add('aberta');
        if (!sombraMenu) {
            sombraMenu = document.createElement('div');
            sombraMenu.className = 'sombra-menu';
            sombraMenu.addEventListener('click', fecharMenuLateral);
            document.body.appendChild(sombraMenu);
        }
    }

    function fecharMenuLateral() {
        sidebar.classList.remove('aberta');
        if (sombraMenu) {
            sombraMenu.remove();
            sombraMenu = null;
        }
    }

    document.getElementById('abrirMenu').addEventListener('click', function () {
        sidebar.classList.contains('aberta') ? fecharMenuLateral() : abrirMenuLateral();
    });

    /*
     * Encolher o menu para uma faixa de icones. A escolha fica no
     * navegador (localStorage, que pode estar bloqueado: try/catch). Os
     * graficos dependem da largura, entao o painel e avisado por 'resize'.
     */
    const app = document.querySelector('.app');
    const CHAVE_MENU = 'index-menu-encolhido';

    function aplicarMenuEncolhido(encolhido) {
        app.classList.toggle('menu-encolhido', encolhido);
        const botao = document.getElementById('botaoEncolher');
        botao.title = encolhido ? 'Expandir menu' : 'Encolher menu';
        botao.setAttribute('aria-label', botao.title);
        try {
            localStorage.setItem(CHAVE_MENU, encolhido ? '1' : '0');
        } catch (erro) {
            // sem memoria: o menu vale so para esta sessao
        }
        setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 280);
    }

    document.getElementById('botaoEncolher').addEventListener('click', function () {
        aplicarMenuEncolhido(!app.classList.contains('menu-encolhido'));
    });

    try {
        if (localStorage.getItem(CHAVE_MENU) === '1') {
            app.classList.add('menu-encolhido');
            document.getElementById('botaoEncolher').title = 'Expandir menu';
        }
    } catch (erro) {
        // sem memoria: comeca expandido
    }

    // ==================================================================
    // 5. Acoes dos botoes
    // ==================================================================
    /*
     * Registro ACOES: um botao com data-acao="editar-os" data-id="12" chama
     * ACOES['editar-os'](12, tipo). Cada tela registra as suas; nao ha um
     * despachante gigante com um case por botao.
     */
    const ACOES = {};

    function registrarAcoes(mapa) {
        Object.keys(mapa).forEach(function (nome) { ACOES[nome] = mapa[nome]; });
    }

    function executarAcao(acao, id, tipo) {
        // O perfil sem exclusao nem ve o botao; isto e a segunda tranca.
        if ((acao.indexOf('excluir-') === 0 || acao === 'desfazer-mov') && !estado.config.pode_excluir) {
            avisar('Seu perfil não pode excluir registros. Peça a um administrador.', 'erro');
            return Promise.resolve();
        }
        if (!ACOES[acao]) return Promise.resolve();
        return Promise.resolve(ACOES[acao](id, tipo));
    }

    document.addEventListener('click', function (evento) {
        const botao = evento.target.closest('[data-acao]');
        if (!botao) return;
        evento.preventDefault();
        executarAcao(botao.dataset.acao, Number(botao.dataset.id) || null, botao.dataset.tipo)
            .catch(function (erro) { avisar(erro.message, 'erro'); });
    });

    // ==================================================================
    // 6. Catalogos
    // ==================================================================
    /* Clientes, modelos, pecas... usados pelos selects de varias telas,
       carregados juntos para abrir a OS sem esperar sete requisicoes. */
    async function carregarCatalogos() {
        const r = await Promise.all([
            api.get('/clientes'), api.get('/modelos'), api.get('/pecas'),
            api.get('/produtos'), api.get('/fornecedores'), api.get('/formas-pagamento'),
            api.get('/servicos'), api.get('/listas'),
        ]);
        estado.clientes = r[0].itens;
        estado.modelos = r[1].itens;
        estado.pecas = r[2].itens;
        estado.produtos = r[3].itens;
        estado.fornecedores = r[4].itens;
        estado.formasPagamento = r[5].itens;
        estado.servicos = r[6].itens;
        estado.listas = r[7].listas;
    }

    /** Entradas com saldo: o que a venda e a OS podem consumir. */
    async function carregarDisponiveis() {
        estado.disponiveis = (await api.get('/entradas?disponivel=1')).itens;
    }

    /* Tudo que pode ser movimentado, inclusive o item zerado: e ele que
       costuma receber uma reposicao em garantia. */
    async function carregarMovimentaveis() {
        estado.movimentaveis = (await api.get('/entradas')).itens.filter(function (e) { return e.item; });
    }

    janela.Nucleo = {
        api: api, mensagemDe: mensagemDe, ganchosApi: ganchosApi,
        estado: estado,
        dominio: dominio, rotuloDe: rotuloDe, corDe: corDe, opcoesDoDominio: opcoesDoDominio,
        etiqueta: etiqueta, etiquetaTexto: etiquetaTexto, vazio: vazio, opcoesDe: opcoesDe, tabelaHtml: tabelaHtml, cardSimples: cardSimples,
        moedaOuTraco: moedaOuTraco, nomeModelo: nomeModelo, identificacaoDoAparelho: identificacaoDoAparelho, situacaoReal: situacaoReal, classeSaldo: classeSaldo,
        formaPadrao: formaPadrao, campoFormaPagamento: campoFormaPagamento, avisar: avisar,
        registrarTela: registrarTela, mostrarSecao: mostrarSecao,
        registrarAcoes: registrarAcoes, executarAcao: executarAcao,
        carregarCatalogos: carregarCatalogos, carregarDisponiveis: carregarDisponiveis,
        carregarMovimentaveis: carregarMovimentaveis,
    };
})(window);
