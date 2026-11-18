// carga: usa Formato; publica Loja  (conferido por testes/front/carga.test.js)
/*
 * loja.js - a loja online do cliente (v8). Window.Loja.
 *
 * Uma pagina so, com as telas pelo endereco (#/...):
 *   #/                    vitrine (busca e filtro por tipo)
 *   #/produto/ID          o anuncio, com as fotos
 *   #/carrinho            o carrinho (fica neste navegador)
 *   #/entrar  #/criar-conta
 *   #/finalizar           endereco de entrega e confirmacao
 *   #/encomendas          minhas encomendas
 *   #/encomenda/ID        o pagamento (enquanto aguarda) e o RASTREIO
 *
 * Quem decide tudo e o servidor (/api/loja/...): preco, frete, o que esta
 * disponivel, se a loja aceita encomenda. A tela so mostra e pede. O
 * rastreio se atualiza sozinho a cada 30 segundos enquanto esta aberto.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, horaCurta } = janela.Formato;
    const raiz = document.getElementById('conteudo');
    const CHAVE_CARRINHO = 'index-loja-carrinho';
    const CHAVE_VOLTAR = 'index-loja-voltar';
    const TIPOS = [['todos', 'Tudo'], ['celular', 'Celulares'], ['produto', 'Acessórios'], ['peca', 'Peças']];
    /* Onde o caminhao fica na linha da entrega, por passo (0 = na loja, 100 = no endereco). */
    const POSICAO_NA_ROTA = { pago: 0, separacao: 10, enviado: 32, em_transito: 58, saiu_entrega: 84, entregue: 100 };

    const estado = { loja: null, anuncios: [], ufs: [], conta: null, carregado: false, filtro: 'todos', busca: '', relogio: 0 };

    // ------------------------------------------------------------------
    // Servidor
    // ------------------------------------------------------------------
    async function api(caminho, metodo, corpo) {
        const r = await fetch('/api/loja' + caminho, {
            method: metodo || 'GET', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: corpo === undefined ? undefined : JSON.stringify(corpo),
        });
        let dados = {};
        try { dados = await r.json(); } catch (e) { /* resposta sem JSON */ }
        if (!r.ok || dados.ok === false) {
            const erro = new Error(dados.erro || 'Não foi possível falar com a loja agora. Tente de novo.');
            erro.status = r.status;
            throw erro;
        }
        return dados;
    }

    function avisar(texto, tipo) {
        const caixa = document.getElementById('avisos');
        const aviso = document.createElement('div');
        aviso.className = 'aviso' + (tipo === 'erro' ? ' aviso-erro' : '');
        aviso.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
        aviso.textContent = texto;
        caixa.appendChild(aviso);
        setTimeout(function () { aviso.classList.add('saindo'); }, 4200);
        setTimeout(function () { aviso.remove(); }, 4700);
    }

    /** Roda a acao com o botao travado: clique duplo nao manda duas vezes. */
    async function travado(botao, acao) {
        if (botao.disabled) return;
        const texto = botao.textContent;
        botao.disabled = true;
        botao.setAttribute('aria-busy', 'true');
        try {
            await acao();
        } finally {
            if (botao.isConnected) {
                botao.disabled = false;
                botao.removeAttribute('aria-busy');
                botao.textContent = texto;
            }
        }
    }

    // ------------------------------------------------------------------
    // Carrinho (localStorage: so neste navegador; sem ele, so na pagina)
    // ------------------------------------------------------------------
    let carrinhoNaMemoria = [];
    function lerCarrinho() {
        try {
            const c = JSON.parse(janela.localStorage.getItem(CHAVE_CARRINHO) || '[]');
            return Array.isArray(c) ? c.filter(function (l) { return l && Number(l.anuncio_id) > 0 && Number(l.quantidade) > 0; }) : [];
        } catch (e) {
            return carrinhoNaMemoria;
        }
    }
    function gravarCarrinho(c) {
        carrinhoNaMemoria = c;
        try { janela.localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(c)); } catch (e) { /* sem armazenamento: fica na memoria */ }
        desenharContador();
    }
    function anuncioDe(id) {
        return estado.anuncios.find(function (a) { return a.id === Number(id); }) || null;
    }
    /** O carrinho conferido com a vitrine: o que saiu some, a quantidade cabe no disponivel. */
    function carrinhoValido() {
        return lerCarrinho().map(function (l) {
            const a = anuncioDe(l.anuncio_id);
            if (!a || a.disponivel < 1) return null;
            return { anuncio: a, quantidade: Math.min(Number(l.quantidade), a.disponivel, a.unitario ? 1 : 10) };
        }).filter(Boolean);
    }
    function adicionarAoCarrinho(anuncioId, quantidade) {
        const a = anuncioDe(anuncioId);
        if (!a || a.disponivel < 1) { avisar('Este produto esgotou.', 'erro'); return; }
        const c = lerCarrinho();
        const linha = c.find(function (l) { return Number(l.anuncio_id) === a.id; });
        const limite = Math.min(a.disponivel, a.unitario ? 1 : 10);
        if (linha) {
            if (linha.quantidade >= limite) {
                avisar(a.unitario ? 'Este aparelho já está no seu carrinho (é uma unidade só).' : 'Você já tem o máximo disponível no carrinho.');
                return;
            }
            linha.quantidade = Math.min(limite, linha.quantidade + quantidade);
        } else {
            c.push({ anuncio_id: a.id, quantidade: Math.min(limite, quantidade) });
        }
        gravarCarrinho(c);
        avisar('"' + a.titulo + '" foi para o carrinho.');
    }
    function desenharContador() {
        const n = lerCarrinho().reduce(function (s, l) { return s + Number(l.quantidade); }, 0);
        const el = document.getElementById('contadorCarrinho');
        el.textContent = String(n);
        el.hidden = n === 0;
    }

    // ------------------------------------------------------------------
    // Pedacos de tela
    // ------------------------------------------------------------------
    const ICONE_PRODUTO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';

    function foto(idFoto, classe, alt) {
        return idFoto
            ? '<img class="' + classe + '" src="/api/loja/fotos/' + Number(idFoto) + '" alt="' + escapar(alt || '') + '" loading="lazy">'
            : '<span class="' + classe + ' sem-foto">' + ICONE_PRODUTO + '</span>';
    }

    function etiquetas(a) {
        return [a.condicao, a.cor, a.marca && a.tipo !== 'celular' ? a.marca : null].filter(Boolean)
            .map(function (t) { return '<span class="selo">' + escapar(t) + '</span>'; }).join('');
    }

    function textoFrete() {
        const l = estado.loja;
        if (!l) return '';
        if (l.frete_fixo <= 0) return 'Frete grátis';
        return 'Frete ' + moeda(l.frete_fixo) + (l.frete_gratis_acima > 0 ? ' · grátis a partir de ' + moeda(l.frete_gratis_acima) : '');
    }

    function freteDe(produtos) {
        const l = estado.loja;
        return l.frete_gratis_acima > 0 && Math.round(produtos * 100) >= Math.round(l.frete_gratis_acima * 100) ? 0 : l.frete_fixo;
    }

    function dataHora(texto) {
        return texto ? dataCurta(texto) + ' às ' + horaCurta(texto) : '—';
    }

    function seloStatus(status, rotulo) {
        return '<span class="status status-' + escapar(status) + '">' + escapar(rotulo) + '</span>';
    }

    function voltarPara(rota) {
        try { janela.sessionStorage.setItem(CHAVE_VOLTAR, rota); } catch (e) { /* sem armazenamento */ }
    }
    function irParaVoltar() {
        let rota = '#/';
        try { rota = janela.sessionStorage.getItem(CHAVE_VOLTAR) || '#/'; janela.sessionStorage.removeItem(CHAVE_VOLTAR); } catch (e) { /* idem */ }
        location.hash = rota;
    }

    // ------------------------------------------------------------------
    // Vitrine
    // ------------------------------------------------------------------
    function telaVitrine() {
        const l = estado.loja;
        const termo = estado.busca.trim().toLowerCase();
        const lista = estado.anuncios.filter(function (a) {
            return (estado.filtro === 'todos' || a.tipo === estado.filtro) &&
                   (!termo || (a.titulo + ' ' + (a.marca || '') + ' ' + (a.categoria || '') + ' ' + (a.cor || '')).toLowerCase().includes(termo));
        });
        raiz.innerHTML =
            '<section class="vitrine-topo">' +
                '<div><h1>' + escapar(l.nome) + '</h1>' +
                '<p class="vitrine-sub">Celulares revisados, acessórios e peças, com entrega no seu endereço.</p></div>' +
                '<ul class="vitrine-fatos" aria-label="Condições da loja">' +
                    '<li>' + escapar(textoFrete()) + '</li>' +
                    '<li>Entrega em até ' + l.prazo_entrega_dias + ' dia(s) depois do pagamento</li>' +
                    '<li>Pagamento por Pix</li>' +
                '</ul>' +
            '</section>' +
            (l.aberta ? '' : '<p class="faixa faixa-atencao" role="status">A loja online não está aceitando encomendas agora. ' +
                'Você pode olhar os produtos e montar o carrinho; finalize mais tarde.</p>') +
            '<div class="filtros" role="tablist" aria-label="Tipo de produto">' +
                TIPOS.map(function (t) {
                    const n = t[0] === 'todos' ? estado.anuncios.length : estado.anuncios.filter(function (a) { return a.tipo === t[0]; }).length;
                    return '<button type="button" role="tab" class="filtro' + (estado.filtro === t[0] ? ' ativo' : '') + '" aria-selected="' +
                        (estado.filtro === t[0]) + '" data-filtro="' + t[0] + '">' + t[1] + ' <span>' + n + '</span></button>';
                }).join('') +
            '</div>' +
            (lista.length
                ? '<div class="grade-produtos">' + lista.map(cartaoProduto).join('') + '</div>'
                : '<div class="vazio"><p>' + (estado.anuncios.length ? 'Nenhum produto com "' + escapar(estado.busca) + '".'
                    : 'A vitrine ainda está vazia. Volte em breve!') + '</p>' +
                  (estado.busca ? '<button type="button" class="botao botao-leve" data-limpar-busca>Limpar a busca</button>' : '') + '</div>');
    }

    function cartaoProduto(a) {
        const esgotado = a.disponivel < 1;
        return '<article class="produto' + (esgotado ? ' esgotado' : '') + '">' +
            '<a href="#/produto/' + a.id + '" class="produto-foto" aria-label="' + escapar(a.titulo) + '">' +
                foto(a.fotos[0], 'produto-img', a.titulo) +
                (esgotado ? '<span class="selo-esgotado">Esgotado</span>' : '') +
            '</a>' +
            '<div class="produto-corpo">' +
                '<span class="produto-tipo">' + escapar(a.tipo_rotulo) + '</span>' +
                '<h2 class="produto-titulo"><a href="#/produto/' + a.id + '">' + escapar(a.titulo) + '</a></h2>' +
                '<div class="selos">' + etiquetas(a) + '</div>' +
                '<div class="produto-pe">' +
                    '<strong class="preco">' + moeda(a.preco) + '</strong>' +
                    (esgotado ? '<span class="produto-aviso">Sem unidades</span>'
                        : '<button type="button" class="botao botao-pequeno" data-adicionar="' + a.id + '">Adicionar</button>') +
                '</div>' +
            '</div>' +
        '</article>';
    }

    // ------------------------------------------------------------------
    // Produto
    // ------------------------------------------------------------------
    async function telaProduto(id) {
        let a;
        try {
            a = (await api('/anuncios/' + Number(id))).anuncio;
        } catch (erro) {
            raiz.innerHTML = '<div class="vazio"><p>' + escapar(erro.message) + '</p><a class="botao" href="#/">Ver a vitrine</a></div>';
            return;
        }
        const esgotado = a.disponivel < 1;
        const max = Math.min(a.disponivel, a.unitario ? 1 : 10);
        raiz.innerHTML =
            '<a href="#/" class="voltar">&larr; Voltar para a vitrine</a>' +
            '<section class="detalhe">' +
                '<div class="galeria">' +
                    '<div class="galeria-principal">' + foto(a.fotos[0], 'galeria-img', a.titulo) + '</div>' +
                    (a.fotos.length > 1 ? '<div class="galeria-miniaturas">' + a.fotos.map(function (f, i) {
                        return '<button type="button" class="miniatura' + (i === 0 ? ' ativa' : '') + '" data-foto="' + f + '" aria-label="Foto ' + (i + 1) + '">' +
                            foto(f, 'miniatura-img', '') + '</button>';
                    }).join('') + '</div>' : '') +
                '</div>' +
                '<div class="detalhe-info">' +
                    '<span class="produto-tipo">' + escapar(a.tipo_rotulo) + '</span>' +
                    '<h1>' + escapar(a.titulo) + '</h1>' +
                    '<div class="selos">' + etiquetas(a) + '</div>' +
                    '<p class="detalhe-preco">' + moeda(a.preco) + '</p>' +
                    '<p class="detalhe-frete">' + escapar(textoFrete()) + '</p>' +
                    (esgotado
                        ? '<p class="faixa faixa-atencao">Esgotado no momento.</p>'
                        : '<div class="comprar">' +
                            (a.unitario ? '<p class="detalhe-unidade">Aparelho único: é exatamente este que você recebe.</p>'
                                : '<label class="quantidade">Quantidade <input type="number" id="quantidadeProduto" min="1" max="' + max +
                                  '" value="1" inputmode="numeric"></label><span class="detalhe-unidade">' + a.disponivel + ' disponível(is)</span>') +
                            '<button type="button" class="botao botao-grande" data-adicionar="' + a.id + '" data-ir-carrinho>Adicionar ao carrinho</button>' +
                          '</div>') +
                    (a.descricao ? '<h2 class="detalhe-subtitulo">Sobre o produto</h2><p class="detalhe-descricao">' + escapar(a.descricao) + '</p>' : '') +
                '</div>' +
            '</section>';
    }

    // ------------------------------------------------------------------
    // Carrinho
    // ------------------------------------------------------------------
    function telaCarrinho() {
        const linhas = carrinhoValido();
        gravarCarrinho(linhas.map(function (l) { return { anuncio_id: l.anuncio.id, quantidade: l.quantidade }; }));
        if (!linhas.length) {
            raiz.innerHTML = '<h1 class="titulo-pagina">Carrinho</h1><div class="vazio"><p>Seu carrinho está vazio.</p>' +
                '<a class="botao" href="#/">Ver a vitrine</a></div>';
            return;
        }
        const produtos = linhas.reduce(function (s, l) { return s + Math.round(l.anuncio.preco * 100) * l.quantidade; }, 0) / 100;
        const frete = freteDe(produtos);
        raiz.innerHTML =
            '<h1 class="titulo-pagina">Carrinho</h1>' +
            '<div class="duas-colunas">' +
                '<ul class="linhas-carrinho">' + linhas.map(function (l) {
                    const a = l.anuncio;
                    const max = Math.min(a.disponivel, a.unitario ? 1 : 10);
                    return '<li class="linha-carrinho">' +
                        '<a href="#/produto/' + a.id + '">' + foto(a.fotos[0], 'linha-img', a.titulo) + '</a>' +
                        '<div class="linha-info"><a href="#/produto/' + a.id + '" class="linha-titulo">' + escapar(a.titulo) + '</a>' +
                            '<span class="linha-unitario">' + moeda(a.preco) + (l.quantidade > 1 ? ' cada' : '') + '</span></div>' +
                        '<div class="linha-quantidade" aria-label="Quantidade de ' + escapar(a.titulo) + '">' +
                            (a.unitario ? '<span class="linha-unica">1 un.</span>'
                                : '<button type="button" class="botao-redondo" data-mudar="' + a.id + '" data-passo="-1" aria-label="Menos um"' +
                                    (l.quantidade <= 1 ? ' disabled' : '') + '>&minus;</button><span>' + l.quantidade + '</span>' +
                                  '<button type="button" class="botao-redondo" data-mudar="' + a.id + '" data-passo="1" aria-label="Mais um"' +
                                    (l.quantidade >= max ? ' disabled' : '') + '>+</button>') +
                        '</div>' +
                        '<strong class="linha-subtotal">' + moeda(a.preco * l.quantidade) + '</strong>' +
                        '<button type="button" class="botao-texto" data-remover="' + a.id + '">Remover</button>' +
                    '</li>';
                }).join('') + '</ul>' +
                resumoValores(produtos, frete,
                    estado.loja.aberta
                        ? '<button type="button" class="botao botao-grande" data-finalizar>Finalizar encomenda</button>'
                        : '<p class="faixa faixa-atencao">A loja não está aceitando encomendas agora.</p>') +
            '</div>';
    }

    function resumoValores(produtos, frete, rodape) {
        const l = estado.loja;
        const falta = l.frete_gratis_acima > 0 && frete > 0 ? l.frete_gratis_acima - produtos : 0;
        return '<aside class="resumo">' +
            '<h2>Resumo</h2>' +
            '<dl><div><dt>Produtos</dt><dd>' + moeda(produtos) + '</dd></div>' +
            '<div><dt>Frete</dt><dd>' + (frete > 0 ? moeda(frete) : 'Grátis') + '</dd></div>' +
            '<div class="resumo-total"><dt>Total</dt><dd>' + moeda(produtos + frete) + '</dd></div></dl>' +
            (falta > 0 ? '<p class="resumo-dica">Faltam ' + moeda(falta) + ' para o frete grátis.</p>' : '') +
            (rodape || '') +
        '</aside>';
    }

    // ------------------------------------------------------------------
    // Entrar e criar conta
    // ------------------------------------------------------------------
    function telaConta(criar) {
        if (estado.conta) { location.hash = '#/encomendas'; return; }
        raiz.innerHTML =
            '<section class="caixa-conta">' +
                '<div class="abas-conta" role="tablist">' +
                    '<a role="tab" href="#/entrar" class="aba-conta' + (criar ? '' : ' ativa') + '" aria-selected="' + !criar + '">Entrar</a>' +
                    '<a role="tab" href="#/criar-conta" class="aba-conta' + (criar ? ' ativa' : '') + '" aria-selected="' + criar + '">Criar conta</a>' +
                '</div>' +
                (criar
                    ? '<form id="formCriarConta" class="formulario" novalidate>' +
                        campo('contaNome', 'Nome completo', 'text', 'name', true) +
                        campo('contaEmail', 'E-mail', 'email', 'email', true) +
                        campo('contaTelefone', 'Telefone com DDD', 'tel', 'tel', true, '(11) 98765-4321') +
                        campo('contaCpf', 'CPF (opcional)', 'text', 'off', false, '000.000.000-00') +
                        campo('contaSenha', 'Senha', 'password', 'new-password', true, null,
                              'Pelo menos 8 caracteres, com letras e números. Não use o seu e-mail.') +
                        campo('contaSenha2', 'Repita a senha', 'password', 'new-password', true) +
                        '<p class="erro-formulario" id="erroConta" role="alert"></p>' +
                        '<button type="submit" class="botao botao-grande">Criar minha conta</button>' +
                      '</form>'
                    : '<form id="formEntrar" class="formulario" novalidate>' +
                        campo('entrarEmail', 'E-mail', 'email', 'email', true) +
                        campo('entrarSenha', 'Senha', 'password', 'current-password', true) +
                        '<p class="erro-formulario" id="erroConta" role="alert"></p>' +
                        '<button type="submit" class="botao botao-grande">Entrar</button>' +
                        '<p class="conta-dica">Ainda não tem conta? <a href="#/criar-conta">Crie em um minuto</a>.</p>' +
                      '</form>') +
                '<p class="conta-admin">É da loja? <a href="../Login/index.html">Entre na área dos funcionários</a> ' +
                    '(o administrador posta os produtos e acompanha as encomendas por lá).</p>' +
            '</section>';
        const primeiro = raiz.querySelector('input');
        if (primeiro) primeiro.focus();
    }

    function campo(id, rotulo, tipo, autocomplete, exigido, exemplo, dica) {
        return '<div class="campo"><label for="' + id + '">' + escapar(rotulo) + '</label>' +
            '<input id="' + id + '" type="' + tipo + '" autocomplete="' + autocomplete + '"' + (exigido ? ' required' : '') +
            (exemplo ? ' placeholder="' + escapar(exemplo) + '"' : '') + (tipo === 'tel' ? ' inputmode="tel"' : '') +
            (dica ? ' aria-describedby="' + id + 'Dica"' : '') + '>' +
            (dica ? '<small class="dica" id="' + id + 'Dica">' + escapar(dica) + '</small>' : '') + '</div>';
    }

    function valorDe(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    function mostrarErro(texto) {
        const el = document.getElementById('erroConta') || document.getElementById('erroFinalizar');
        if (el) { el.textContent = texto; el.scrollIntoView({ block: 'nearest' }); } else avisar(texto, 'erro');
    }

    // ------------------------------------------------------------------
    // Finalizar
    // ------------------------------------------------------------------
    async function telaFinalizar() {
        if (!estado.conta) { voltarPara('#/finalizar'); location.hash = '#/entrar'; return; }
        const linhas = carrinhoValido();
        if (!linhas.length) { location.hash = '#/carrinho'; return; }
        let enderecos = [];
        try { enderecos = (await api('/enderecos')).itens; } catch (e) { /* segue sem os guardados */ }
        const produtos = linhas.reduce(function (s, l) { return s + Math.round(l.anuncio.preco * 100) * l.quantidade; }, 0) / 100;
        const frete = freteDe(produtos);
        raiz.innerHTML =
            '<a href="#/carrinho" class="voltar">&larr; Voltar ao carrinho</a>' +
            '<h1 class="titulo-pagina">Finalizar encomenda</h1>' +
            '<div class="duas-colunas">' +
                '<form id="formFinalizar" class="formulario cartao-form" novalidate>' +
                    '<h2>Onde entregar</h2>' +
                    (enderecos.length
                        ? '<fieldset class="enderecos"><legend class="sr-only">Endereços guardados</legend>' + enderecos.map(function (e, i) {
                            return '<label class="endereco-opcao"><input type="radio" name="endereco" value="' + e.id + '"' + (i === 0 ? ' checked' : '') + '>' +
                                '<span><strong>' + escapar(e.destinatario) + '</strong><br>' + escapar(e.logradouro + ', ' + e.numero +
                                (e.complemento ? ' - ' + e.complemento : '') + ' - ' + e.bairro) + '<br>' +
                                escapar(e.cidade + '/' + e.uf + ' - CEP ' + e.cep.substring(0, 5) + '-' + e.cep.substring(5)) + '</span></label>';
                          }).join('') +
                          '<label class="endereco-opcao"><input type="radio" name="endereco" value="novo"><span><strong>Outro endereço</strong></span></label>' +
                          '</fieldset>'
                        : '<input type="hidden" name="endereco" value="novo">') +
                    '<div id="enderecoNovo" class="grade-endereco"' + (enderecos.length ? ' hidden' : '') + '>' +
                        campoEndereco('endDestinatario', 'Quem vai receber', 'name', estado.conta.nome, 'total') +
                        campoEndereco('endCep', 'CEP', 'postal-code', '', 'curto', '00000-000') +
                        '<p class="dica dica-cep" id="dicaCep" aria-live="polite">Digite o CEP: a rua e a cidade são preenchidas sozinhas.</p>' +
                        campoEndereco('endLogradouro', 'Rua / avenida', 'address-line1', '', 'total') +
                        campoEndereco('endNumero', 'Número', 'off', '', 'curto') +
                        campoEndereco('endComplemento', 'Complemento (opcional)', 'address-line2', '', '') +
                        campoEndereco('endBairro', 'Bairro', 'off', '', '') +
                        campoEndereco('endCidade', 'Cidade', 'address-level2', '', '') +
                        '<div class="campo campo-curto"><label for="endUf">UF</label><select id="endUf" autocomplete="address-level1">' +
                            '<option value="">—</option>' + estado.ufs.map(function (u) {
                                return '<option value="' + u.valor + '">' + u.valor + '</option>';
                            }).join('') + '</select></div>' +
                    '</div>' +
                    '<h2>Contato e recado</h2>' +
                    '<div class="campo"><label for="finTelefone">Telefone para a entrega</label>' +
                        '<input id="finTelefone" type="tel" inputmode="tel" autocomplete="tel" value="' + escapar(formatarTelefone(estado.conta.telefone)) + '"></div>' +
                    '<div class="campo"><label for="finObservacao">Recado para a loja (opcional)</label>' +
                        '<textarea id="finObservacao" rows="2" maxlength="300" placeholder="Ex.: deixar na portaria"></textarea></div>' +
                    '<div class="pagamento-aviso"><strong>Pagamento por Pix.</strong> Depois de confirmar, você recebe a chave Pix e o valor. ' +
                        'O produto fica reservado para você por ' + estado.loja.prazo_pagamento_horas + ' hora(s).</div>' +
                    '<p class="erro-formulario" id="erroFinalizar" role="alert"></p>' +
                '</form>' +
                resumoValores(produtos, frete,
                    '<ul class="resumo-itens">' + linhas.map(function (l) {
                        return '<li><span>' + (l.quantidade > 1 ? l.quantidade + '× ' : '') + escapar(l.anuncio.titulo) + '</span><span>' +
                            moeda(l.anuncio.preco * l.quantidade) + '</span></li>';
                    }).join('') + '</ul>' +
                    '<button type="submit" form="formFinalizar" class="botao botao-grande" id="botaoConfirmar">Confirmar encomenda</button>') +
            '</div>';
    }

    function campoEndereco(id, rotulo, autocomplete, valor, largura, exemplo) {
        return '<div class="campo' + (largura ? ' campo-' + largura : '') + '"><label for="' + id + '">' + escapar(rotulo) + '</label>' +
            '<input id="' + id + '" type="text" autocomplete="' + autocomplete + '" value="' + escapar(valor || '') + '"' +
            (id === 'endCep' ? ' inputmode="numeric" maxlength="9"' : '') + (exemplo ? ' placeholder="' + escapar(exemplo) + '"' : '') + '></div>';
    }

    function formatarTelefone(t) {
        const n = String(t || '').replace(/\D/g, '');
        if (n.length === 11) return '(' + n.substring(0, 2) + ') ' + n.substring(2, 7) + '-' + n.substring(7);
        if (n.length === 10) return '(' + n.substring(0, 2) + ') ' + n.substring(2, 6) + '-' + n.substring(6);
        return t || '';
    }

    /* CEP -> rua, bairro, cidade e UF pelo ViaCEP. Sem internet, a pessoa preenche. */
    async function buscarCep(cep) {
        const dica = document.getElementById('dicaCep');
        try {
            const r = await fetch('https://viacep.com.br/ws/' + cep + '/json/');
            const d = await r.json();
            if (d.erro) { dica.textContent = 'Não achei este CEP. Confira os números ou preencha o endereço.'; return; }
            [['endLogradouro', d.logradouro], ['endBairro', d.bairro], ['endCidade', d.localidade]].forEach(function (p) {
                const el = document.getElementById(p[0]);
                if (el && !el.value && p[1]) el.value = p[1];
            });
            const uf = document.getElementById('endUf');
            if (uf && !uf.value && d.uf) uf.value = d.uf;
            dica.textContent = 'Endereço encontrado. Confira e preencha o número.';
            const numero = document.getElementById('endNumero');
            if (numero && !numero.value) numero.focus();
        } catch (e) {
            dica.textContent = 'Não consegui buscar o CEP agora. Preencha o endereço.';
        }
    }

    async function confirmarEncomenda() {
        const escolhido = (raiz.querySelector('input[name="endereco"]:checked') || raiz.querySelector('input[name="endereco"]')).value;
        const corpo = {
            itens: carrinhoValido().map(function (l) { return { anuncio_id: l.anuncio.id, quantidade: l.quantidade }; }),
            telefone: valorDe('finTelefone'), observacoes: valorDe('finObservacao'),
        };
        if (escolhido === 'novo') {
            corpo.endereco = { destinatario: valorDe('endDestinatario'), cep: valorDe('endCep'), logradouro: valorDe('endLogradouro'),
                numero: valorDe('endNumero'), complemento: valorDe('endComplemento'), bairro: valorDe('endBairro'),
                cidade: valorDe('endCidade'), uf: valorDe('endUf') };
        } else {
            corpo.endereco_id = Number(escolhido);
        }
        try {
            const r = await api('/encomendas', 'POST', corpo);
            gravarCarrinho([]);
            avisar(r.mensagem);
            location.hash = '#/encomenda/' + r.id;
        } catch (erro) {
            if (erro.status === 401) { estado.conta = null; desenharConta(); voltarPara('#/finalizar'); location.hash = '#/entrar'; return; }
            mostrarErro(erro.message);
            await carregarVitrine();   // o disponivel pode ter mudado
        }
    }

    // ------------------------------------------------------------------
    // Minhas encomendas e o rastreio
    // ------------------------------------------------------------------
    async function telaEncomendas() {
        if (!estado.conta) { voltarPara('#/encomendas'); location.hash = '#/entrar'; return; }
        const lista = (await api('/encomendas')).itens;
        raiz.innerHTML =
            '<div class="titulo-linha"><h1 class="titulo-pagina">Minhas encomendas</h1>' +
                '<button type="button" class="botao botao-leve" data-sair>Sair da conta</button></div>' +
            '<p class="ola">Olá, ' + escapar(String(estado.conta.nome).split(' ')[0]) + '. Toque numa encomenda para ver o pagamento e o rastreio.</p>' +
            (lista.length
                ? '<ul class="lista-encomendas">' + lista.map(function (e) {
                    return '<li><a href="#/encomenda/' + e.id + '" class="encomenda-linha">' +
                        '<span class="encomenda-numero">' + escapar(e.numero) + '</span>' +
                        seloStatus(e.status, e.status_rotulo) +
                        '<span class="encomenda-itens">' + escapar(e.itens_texto) + '</span>' +
                        '<span class="encomenda-data">Feita em ' + dataHora(e.criado_em) + '</span>' +
                        '<strong class="encomenda-total">' + moeda(e.valor_total) + '</strong>' +
                    '</a></li>';
                }).join('') + '</ul>'
                : '<div class="vazio"><p>Você ainda não fez nenhuma encomenda.</p><a class="botao" href="#/">Ver a vitrine</a></div>');
    }

    async function telaEncomenda(id, silenciosa) {
        if (!estado.conta) { voltarPara('#/encomenda/' + id); location.hash = '#/entrar'; return; }
        let e;
        try {
            e = (await api('/encomendas/' + Number(id))).encomenda;
        } catch (erro) {
            if (!silenciosa) raiz.innerHTML = '<div class="vazio"><p>' + escapar(erro.message) + '</p><a class="botao" href="#/encomendas">Minhas encomendas</a></div>';
            return;
        }
        if (location.hash !== '#/encomenda/' + id) return;   // a pessoa ja foi para outra tela
        const destino = e.entrega.cidade + '/' + e.entrega.uf;
        raiz.innerHTML =
            '<a href="#/encomendas" class="voltar">&larr; Minhas encomendas</a>' +
            '<div class="titulo-linha"><h1 class="titulo-pagina">Encomenda ' + escapar(e.numero) + '</h1>' + seloStatus(e.status, e.status_rotulo) + '</div>' +
            (e.status === 'cancelada'
                ? '<p class="faixa faixa-grave" role="status"><strong>Encomenda cancelada.</strong> ' + escapar(e.motivo_cancelamento || '') + '</p>' : '') +
            (e.pagamento ? blocoPagamento(e) : '') +
            (e.rastreio ? blocoRastreio(e, destino) : '') +
            (!e.rastreio && e.status !== 'cancelada'
                ? '<p class="rastreio-espera">O rastreio da entrega aparece aqui assim que a loja confirmar o pagamento.</p>' : '') +
            '<div class="duas-colunas duas-colunas-iguais">' +
                '<section class="cartao"><h2>Entrega em</h2><p class="endereco-texto"><strong>' + escapar(e.entrega.destinatario) + '</strong><br>' +
                    escapar(e.entrega.logradouro + ', ' + e.entrega.numero + (e.entrega.complemento ? ' - ' + e.entrega.complemento : '')) + '<br>' +
                    escapar(e.entrega.bairro + ' - ' + destino) + '<br>CEP ' + escapar(e.entrega.cep) + '</p>' +
                    (e.observacoes ? '<p class="recado">Recado: ' + escapar(e.observacoes) + '</p>' : '') + '</section>' +
                '<section class="cartao"><h2>Itens</h2><ul class="itens-encomenda">' + e.itens.map(function (i) {
                        return '<li>' + foto(i.foto, 'item-img', '') + '<span>' + (i.quantidade > 1 ? i.quantidade + '× ' : '') + escapar(i.descricao) +
                            '</span><strong>' + moeda(i.subtotal) + '</strong></li>';
                    }).join('') + '</ul>' +
                    '<dl class="valores-encomenda"><div><dt>Frete</dt><dd>' + (e.frete > 0 ? moeda(e.frete) : 'Grátis') + '</dd></div>' +
                    '<div class="resumo-total"><dt>Total</dt><dd>' + moeda(e.valor_total) + '</dd></div></dl></section>' +
            '</div>' +
            (e.pode_cancelar ? '<p class="cancelar-linha"><button type="button" class="botao-texto botao-perigo" data-cancelar="' + e.id + '">' +
                'Cancelar esta encomenda</button></p>' : '');

        // Enquanto nao terminou, o rastreio se atualiza sozinho.
        clearTimeout(estado.relogio);
        if (e.status !== 'entregue' && e.status !== 'cancelada') {
            estado.relogio = setTimeout(function () { telaEncomenda(id, true); }, 30000);
        }
    }

    function blocoPagamento(e) {
        const p = e.pagamento;
        return '<section class="cartao pagamento">' +
            '<h2>Pague com Pix para confirmar</h2>' +
            '<div class="pix">' +
                '<div><span class="pix-rotulo">Valor</span><strong class="pix-valor">' + moeda(p.valor) + '</strong></div>' +
                '<div><span class="pix-rotulo">Chave Pix</span><code class="pix-chave" id="chavePix">' + escapar(p.chave_pix || '—') + '</code>' +
                    (p.chave_pix ? '<button type="button" class="botao botao-pequeno botao-leve" data-copiar-pix>Copiar chave</button>' : '') + '</div>' +
                (p.recebedor ? '<div><span class="pix-rotulo">Em nome de</span><span>' + escapar(p.recebedor) + '</span></div>' : '') +
                '<div><span class="pix-rotulo">Pague até</span><span>' + dataHora(p.pagar_ate) + '</span></div>' +
            '</div>' +
            '<p class="pix-dica">No Pix, escreva <strong>' + escapar(e.numero) + '</strong> na mensagem. A loja confere o pagamento e confirma aqui: ' +
                'depois disso o produto é separado e o rastreio começa. Se o prazo passar sem pagamento, a reserva é desfeita e nada é cobrado.</p>' +
        '</section>';
    }

    /*
     * O rastreio linear: a linha da loja (origem) ate o endereco, com o
     * caminhao no ponto do passo atual, e embaixo os passos com a hora de cada um.
     */
    function blocoRastreio(e, destino) {
        const passos = e.trilha.filter(function (t) { return t.status !== 'aguardando_pagamento'; });
        const pos = e.status === 'cancelada' ? null : (POSICAO_NA_ROTA[e.status] || 0);
        const entregue = e.status === 'entregue';
        return '<section class="cartao rastreio" aria-label="Rastreio da entrega">' +
            '<div class="rastreio-cabeca">' +
                '<h2>' + (entregue ? 'Entregue!' : 'Acompanhe a entrega') + '</h2>' +
                (e.previsao_entrega && !entregue && e.status !== 'cancelada'
                    ? '<p class="previsao">Previsão de entrega: <strong>' + dataCurta(e.previsao_entrega) + '</strong></p>' : '') +
                (e.codigo_rastreio ? '<p class="codigo">' + escapar(e.transportadora || 'Transportadora') + ': <code>' + escapar(e.codigo_rastreio) + '</code></p>' : '') +
            '</div>' +
            '<div class="rota" role="img" aria-label="' + escapar('Da ' + e.origem + ' até ' + destino + ': ' + e.status_rotulo) + '">' +
                '<div class="rota-ponta rota-origem"><span class="rota-pino"></span><span class="rota-nome">' + escapar(e.origem) + '</span></div>' +
                '<div class="rota-trilho"><div class="rota-feito" style="width:' + (pos === null ? 0 : pos) + '%"></div>' +
                    passos.filter(function (t) { const x = POSICAO_NA_ROTA[t.status]; return x > 0 && x < 100; }).map(function (t) {
                        return '<span class="rota-marco' + (t.feito ? ' feito' : '') + '" style="left:' + POSICAO_NA_ROTA[t.status] + '%"></span>';
                    }).join('') +
                    (pos === null ? '' : '<span class="rota-veiculo' + (entregue ? ' chegou' : '') + '" style="left:' + pos + '%">' +
                        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 6h13v10H1zM14 9h4l4 4v3h-8z"/><circle cx="5.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/></svg></span>') +
                '</div>' +
                '<div class="rota-ponta rota-destino"><span class="rota-pino"></span><span class="rota-nome">' + escapar(destino) + '</span></div>' +
            '</div>' +
            '<ol class="passos">' + passos.map(function (t) {
                return '<li class="passo' + (t.feito ? ' feito' : '') + (t.atual ? ' atual' : '') + '">' +
                    '<span class="passo-bola" aria-hidden="true"></span>' +
                    '<span class="passo-nome">' + escapar(t.rotulo) + '</span>' +
                    '<span class="passo-hora">' + (t.momento ? dataHora(t.momento) : (t.feito ? '' : 'a seguir')) + '</span>' +
                '</li>';
            }).join('') + '</ol>' +
            '<details class="historico"' + (e.eventos.length <= 4 ? ' open' : '') + '><summary>Histórico completo (' + e.eventos.length + ')</summary>' +
                '<ul>' + e.eventos.map(function (ev) {
                    return '<li><span class="hist-hora">' + dataHora(ev.momento) + '</span><span class="hist-texto"><strong>' + escapar(ev.rotulo) + '</strong>' +
                        (ev.local ? ' · ' + escapar(ev.local) : '') + (ev.observacao ? '<br>' + escapar(ev.observacao) : '') + '</span></li>';
                }).join('') + '</ul></details>' +
        '</section>';
    }

    // ------------------------------------------------------------------
    // Roteador e eventos
    // ------------------------------------------------------------------
    function desenharConta() {
        document.getElementById('rotuloConta').textContent = estado.conta ? String(estado.conta.nome).split(' ')[0] : 'Entrar';
        document.getElementById('botaoConta').setAttribute('href', estado.conta ? '#/encomendas' : '#/entrar');
    }

    async function carregarVitrine() {
        const v = await api('/vitrine');
        estado.loja = v.loja;
        estado.anuncios = v.anuncios;
        estado.ufs = v.ufs;
        document.getElementById('nomeLoja').textContent = v.loja.nome;
        document.getElementById('nomeRodape').textContent = v.loja.nome;
        document.title = 'Loja online - ' + v.loja.nome;
    }

    async function desenhar() {
        clearTimeout(estado.relogio);
        const partes = location.hash.replace(/^#\/?/, '').split('/');
        try {
            if (!estado.carregado) {
                await carregarVitrine();
                try { estado.conta = (await api('/sessao')).conta; } catch (e) { estado.conta = null; }
                estado.carregado = true;
                desenharConta();
                desenharContador();
            }
            switch (partes[0]) {
                case '': telaVitrine(); break;
                case 'produto': await telaProduto(partes[1]); break;
                case 'carrinho': telaCarrinho(); break;
                case 'entrar': telaConta(false); break;
                case 'criar-conta': telaConta(true); break;
                case 'finalizar': await telaFinalizar(); break;
                case 'encomendas': await telaEncomendas(); break;
                case 'encomenda': await telaEncomenda(partes[1]); break;
                default: location.hash = '#/';
            }
        } catch (erro) {
            if (erro.status === 401 && estado.carregado) {   // a sessao caiu (8 horas): entra de novo e volta para ca
                estado.conta = null;
                desenharConta();
                voltarPara(location.hash);
                location.hash = '#/entrar';
                return;
            }
            raiz.innerHTML = '<div class="vazio"><p>' + escapar(erro.message) + '</p><button type="button" class="botao" data-recarregar>Tentar de novo</button></div>';
        }
        if (partes[0] !== '' || !estado.busca) janela.scrollTo(0, 0);
    }

    raiz.addEventListener('click', function (evento) {
        const alvo = evento.target.closest('button, [data-filtro]');
        if (!alvo) return;
        if (alvo.dataset.filtro) { estado.filtro = alvo.dataset.filtro; telaVitrine(); return; }
        if (alvo.dataset.adicionar) {
            const q = document.getElementById('quantidadeProduto');
            adicionarAoCarrinho(Number(alvo.dataset.adicionar), q ? Math.max(1, Math.floor(Number(q.value) || 1)) : 1);
            if (alvo.hasAttribute('data-ir-carrinho')) location.hash = '#/carrinho';
            return;
        }
        if (alvo.dataset.mudar) {
            const c = lerCarrinho();
            const l = c.find(function (x) { return Number(x.anuncio_id) === Number(alvo.dataset.mudar); });
            if (l) { l.quantidade = Math.max(1, l.quantidade + Number(alvo.dataset.passo)); gravarCarrinho(c); }
            telaCarrinho();
            return;
        }
        if (alvo.dataset.remover) {
            gravarCarrinho(lerCarrinho().filter(function (x) { return Number(x.anuncio_id) !== Number(alvo.dataset.remover); }));
            telaCarrinho();
            return;
        }
        if (alvo.hasAttribute('data-finalizar')) { location.hash = '#/finalizar'; return; }
        if (alvo.dataset.foto) {
            raiz.querySelector('.galeria-principal').innerHTML = foto(Number(alvo.dataset.foto), 'galeria-img', '');
            raiz.querySelectorAll('.miniatura').forEach(function (m) { m.classList.toggle('ativa', m === alvo); });
            return;
        }
        if (alvo.hasAttribute('data-copiar-pix')) {
            const chave = document.getElementById('chavePix').textContent;
            (navigator.clipboard ? navigator.clipboard.writeText(chave) : Promise.reject())
                .then(function () { avisar('Chave Pix copiada.'); })
                .catch(function () { avisar('Não consegui copiar. Selecione a chave e copie à mão.', 'erro'); });
            return;
        }
        if (alvo.dataset.cancelar) {
            if (!janela.confirm('Cancelar esta encomenda? A reserva do produto é desfeita.')) return;
            travado(alvo, async function () {
                try {
                    avisar((await api('/encomendas/' + Number(alvo.dataset.cancelar) + '/cancelar', 'POST', {})).mensagem);
                    await carregarVitrine();
                } catch (erro) { avisar(erro.message, 'erro'); }
                await telaEncomenda(alvo.dataset.cancelar);
            });
            return;
        }
        if (alvo.hasAttribute('data-sair')) {
            travado(alvo, async function () {
                try { await api('/sair', 'POST', {}); } catch (e) { /* ja estava fora */ }
                estado.conta = null;
                desenharConta();
                location.hash = '#/';
            });
            return;
        }
        if (alvo.hasAttribute('data-limpar-busca')) {
            estado.busca = '';
            document.getElementById('campoBusca').value = '';
            telaVitrine();
            return;
        }
        if (alvo.hasAttribute('data-recarregar')) { estado.carregado = false; desenhar(); }
    });

    raiz.addEventListener('change', function (evento) {
        if (evento.target.name === 'endereco') {
            document.getElementById('enderecoNovo').hidden = evento.target.value !== 'novo';
        }
    });

    raiz.addEventListener('input', function (evento) {
        if (evento.target.id === 'endCep') {
            const n = evento.target.value.replace(/\D/g, '').substring(0, 8);
            evento.target.value = n.length > 5 ? n.substring(0, 5) + '-' + n.substring(5) : n;
            if (n.length === 8 && evento.target.dataset.buscado !== n) {
                evento.target.dataset.buscado = n;
                buscarCep(n);
            }
        }
    });

    raiz.addEventListener('submit', function (evento) {
        evento.preventDefault();
        const form = evento.target;
        const botao = form.querySelector('button[type="submit"]') || document.querySelector('button[form="' + form.id + '"]');
        if (form.id === 'formEntrar') {
            travado(botao, async function () {
                try {
                    estado.conta = (await api('/entrar', 'POST', { email: valorDe('entrarEmail'), senha: document.getElementById('entrarSenha').value })).conta;
                    desenharConta();
                    avisar('Olá, ' + String(estado.conta.nome).split(' ')[0] + '!');
                    irParaVoltar();
                } catch (erro) { mostrarErro(erro.message); }
            });
        } else if (form.id === 'formCriarConta') {
            const senha = document.getElementById('contaSenha').value;
            if (senha !== document.getElementById('contaSenha2').value) { mostrarErro('As duas senhas não são iguais.'); return; }
            travado(botao, async function () {
                try {
                    const r = await api('/conta', 'POST', { nome: valorDe('contaNome'), email: valorDe('contaEmail'),
                        telefone: valorDe('contaTelefone'), cpf: valorDe('contaCpf'), senha: senha });
                    estado.conta = r.conta;
                    desenharConta();
                    avisar(r.mensagem);
                    irParaVoltar();
                } catch (erro) { mostrarErro(erro.message); }
            });
        } else if (form.id === 'formFinalizar') {
            travado(document.getElementById('botaoConfirmar'), confirmarEncomenda);
        }
    });

    document.getElementById('formBusca').addEventListener('submit', function (evento) {
        evento.preventDefault();
        document.getElementById('campoBusca').blur();
    });
    document.getElementById('campoBusca').addEventListener('input', function (evento) {
        estado.busca = evento.target.value;
        if (location.hash.replace(/^#\/?/, '') !== '') location.hash = '#/';
        else if (estado.carregado) telaVitrine();
    });

    janela.addEventListener('hashchange', desenhar);
    janela.addEventListener('storage', function (evento) { if (evento.key === CHAVE_CARRINHO) desenharContador(); });
    desenhar();

    janela.Loja = { estado: estado, carrinho: lerCarrinho, recarregar: function () { estado.carregado = false; return desenhar(); } };
})(window);
