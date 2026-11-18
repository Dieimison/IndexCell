// carga: usa Formato, Nucleo, Telas.inicio; publica Telas.pdvInicio  (conferido por testes/front/carga.test.js)
/*
 * telas/pdv-inicio.js - a tela de ENTRADA do PDV (v8). Window.Telas.pdvInicio.
 *
 * O menu "PDV" abre aqui. De cima para baixo:
 *   - o balcao: saudacao e as duas acoes do dia, "Nova venda" (F2) e "Nova OS";
 *   - o dia em numeros, numa faixa so (vendas, OS prontas, em andamento e,
 *     para o admin, a fila da loja online) - cada numero leva a tela dele;
 *   - os atalhos em lista (icone, nome e para que serve), e ao lado a fila
 *     das ultimas ordens de servico, cada uma com "Abrir".
 * A venda continua no PDV em tela cheia (secao "pdv"); "Sair do PDV" volta
 * para ca. O que o perfil nao pode usar nao aparece (o servidor recusa do
 * mesmo jeito); os numeros vem prontos de GET /api/pdv-painel.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, horaCurta } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mostrarSecao, etiqueta, vazio, avisar } = N;
    const icone = janela.Telas.inicio.icone;

    const raiz = document.getElementById('pdvInicioConteudo');

    /* Os atalhos, na ordem do balcao. quem: todos | financeiro | admin. */
    const ATALHOS = [
        { ir: 'vendas', titulo: 'Histórico de vendas', texto: 'Consultar, editar e cancelar', icone: 'vendas', quem: 'todos' },
        { ir: 'os', titulo: 'Ordens de serviço', texto: 'Bancada, orçamentos e entregas', icone: 'os', quem: 'todos', aviso: 'os' },
        { ir: 'entradas', titulo: 'Estoque', texto: 'Celulares, peças e produtos', icone: 'entradas', quem: 'todos' },
        { ir: 'cadastros', titulo: 'Clientes e produtos', texto: 'Cadastros da loja', icone: 'cadastros', quem: 'todos' },
        { ir: 'pedidos', titulo: 'Entradas', texto: 'Nota do fornecedor ou compra', icone: 'pedidos', quem: 'todos' },
        { ir: 'financeiro', titulo: 'Recebimentos', texto: 'Contas a receber e a pagar', icone: 'financeiro', quem: 'financeiro' },
        { ir: 'loja', titulo: 'Loja online', texto: 'Encomendas e anúncios', icone: 'loja', quem: 'admin', aviso: 'loja' },
        { ir: 'dashboard', titulo: 'Resultados', texto: 'Receita, custo e lucro', icone: 'dashboard', quem: 'todos' },
    ];

    function pode(a) {
        return a.quem === 'todos' || (a.quem === 'financeiro' && estado.config.pode_ver_financeiro) ||
               (a.quem === 'admin' && estado.config.pode_admin);
    }

    function avisoDo(a, d) {
        if (!d) return '';
        if (a.aviso === 'os' && d.os.prontas) return '<span class="pdvi-selo">' + d.os.prontas + ' pronta' + (d.os.prontas > 1 ? 's' : '') + '</span>';
        if (a.aviso === 'loja' && d.loja && d.loja.a_pagar) return '<span class="pdvi-selo">' + d.loja.a_pagar + ' a pagar</span>';
        return '';
    }

    function saudacao() {
        const h = new Date().getHours();
        return h < 12 ? 'Bom dia' : (h < 18 ? 'Boa tarde' : 'Boa noite');
    }

    function numero(valor, rotulo, ir, destaque) {
        return '<button type="button" class="pdvi-numero' + (destaque ? ' pdvi-numero-alerta' : '') + '" data-ir="' + ir + '">' +
            '<strong>' + escapar(valor) + '</strong><span>' + escapar(rotulo) + '</span></button>';
    }

    function desenhar(d) {
        const primeiroNome = String((estado.usuario && estado.usuario.nome) || '').trim().split(/\s+/)[0];
        raiz.innerHTML =
            '<div class="pdvi">' +
                '<section class="pdvi-balcao">' +
                    '<div class="pdvi-balcao-texto">' +
                        '<span class="pdvi-balcao-sub">Balcão · ' + escapar(estado.config.empresa || 'Index Celulares') + '</span>' +
                        '<h2 class="pdvi-balcao-titulo">' + escapar(saudacao() + (primeiroNome ? ', ' + primeiroNome : '')) + '</h2>' +
                    '</div>' +
                    '<div class="pdvi-acoes">' +
                        '<button type="button" class="pdvi-nova-venda" data-ir="pdv">' +
                            '<span class="pdvi-acao-icone">' + icone('vendas') + '</span>' +
                            '<span class="pdvi-acao-textos"><span class="pdvi-acao-nome">Nova venda</span>' +
                            '<span class="pdvi-acao-dica"><kbd>F2</kbd> de qualquer tela</span></span></button>' +
                        '<button type="button" class="pdvi-nova-os" data-nova-os>' +
                            '<span class="pdvi-acao-icone">' + icone('os') + '</span>' +
                            '<span class="pdvi-acao-textos"><span class="pdvi-acao-nome">Nova OS</span>' +
                            '<span class="pdvi-acao-dica">receber um aparelho</span></span></button>' +
                    '</div>' +
                '</section>' +

                '<section class="pdvi-dia" aria-label="O dia de hoje">' +
                    '<span class="pdvi-dia-rotulo">Hoje' + (d ? '<small>' + dataCurta(d.hoje) + '</small>' : '') + '</span>' +
                    numero(d ? moeda(d.vendas_hoje.total) : '…', d ? d.vendas_hoje.quantidade + (d.vendas_hoje.quantidade === 1 ? ' venda' : ' vendas') : 'vendas', 'vendas') +
                    numero(d ? String(d.os.prontas) : '…', 'OS prontas', 'os', d && d.os.prontas) +
                    numero(d ? String(d.os.em_andamento) : '…', 'OS em andamento', 'os') +
                    (d && d.loja ? numero(String(d.loja.a_pagar), 'encomendas a pagar', 'loja', d.loja.a_pagar) +
                                   numero(String(d.loja.a_enviar), 'encomendas a enviar', 'loja', d.loja.a_enviar) : '') +
                '</section>' +

                '<div class="pdvi-corpo">' +
                    '<nav class="pdvi-atalhos" aria-label="Atalhos do PDV">' +
                        '<h3 class="pdvi-bloco-titulo">Atalhos</h3>' +
                        ATALHOS.filter(pode).map(function (a) {
                            return '<button type="button" class="pdvi-atalho" data-ir="' + a.ir + '">' +
                                '<span class="pdvi-atalho-icone">' + icone(a.icone) + '</span>' +
                                '<span class="pdvi-atalho-textos"><span class="pdvi-atalho-nome">' + escapar(a.titulo) + '</span>' +
                                '<span class="pdvi-atalho-texto">' + escapar(a.texto) + '</span></span>' + avisoDo(a, d) + '</button>';
                        }).join('') +
                    '</nav>' +

                    '<section class="pdvi-os" aria-label="Últimas ordens de serviço">' +
                        '<h3 class="pdvi-bloco-titulo">Últimas ordens de serviço' +
                            '<button type="button" class="botao-texto-link" data-ir="os">Ver todas</button></h3>' +
                        (!d ? vazio('Carregando...') : d.ultimas_os.length
                            ? '<ul class="pdvi-fila">' + d.ultimas_os.map(function (o) {
                                return '<li class="pdvi-os-item">' +
                                    '<div class="pdvi-os-cabeca"><strong>' + escapar(o.numero || 'OS #' + o.id) + '</strong>' + etiqueta('status_os', o.status) + '</div>' +
                                    '<div class="pdvi-os-quem">' + escapar(o.cliente) + (o.aparelho ? ' · ' + escapar(o.aparelho) : '') + '</div>' +
                                    '<div class="pdvi-os-pe"><span>' + dataCurta(o.data_entrada) + ' ' + escapar(horaCurta(o.data_entrada)) + '</span>' +
                                        '<strong>' + moeda(o.valor) + '</strong>' +
                                        '<button type="button" class="botao-icone" data-abrir-os="' + o.id + '">Abrir</button></div>' +
                                '</li>';
                            }).join('') + '</ul>'
                            : vazio('Nenhuma ordem de serviço ainda.')) +
                    '</section>' +
                '</div>' +
            '</div>';
    }

    async function carregarPdvInicio() {
        // Chamada antes de o painel terminar de abrir (troca de #endereco no meio da carga): o inicio.js desenha depois.
        if (!estado.config || !estado.usuario) return;
        desenhar(null);   // a tela abre na hora; os numeros chegam depois
        try {
            desenhar(await api.get('/pdv-painel'));
        } catch (erro) {
            avisar(erro.message, 'erro');
        }
    }

    raiz.addEventListener('click', async function (evento) {
        // A OS abre na tela dela (os selects precisam dos cadastros que ela carrega).
        const abrir = evento.target.closest('[data-abrir-os]');
        if (abrir) {
            mostrarSecao('os', true);
            try { await janela.Telas.os.abrirOs(Number(abrir.dataset.abrirOs)); } catch (erro) { avisar(erro.message, 'erro'); }
            return;
        }
        if (evento.target.closest('[data-nova-os]')) {
            mostrarSecao('os', true);
            try { await janela.Telas.os.novaOs(); } catch (erro) { avisar(erro.message, 'erro'); }
            return;
        }
        const alvo = evento.target.closest('[data-ir]');
        if (alvo) mostrarSecao(alvo.dataset.ir, true);
    });

    N.registrarTela('pdv-inicio', { titulo: 'PDV', carregar: carregarPdvInicio });
    janela.Telas = janela.Telas || {};
    janela.Telas.pdvInicio = { carregar: carregarPdvInicio };
})(window);
