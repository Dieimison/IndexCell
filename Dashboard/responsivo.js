// carga: usa (nada); publica Responsivo  (conferido por testes/front/carga.test.js)
/*
 * responsivo.js - tabela larga vira lista de cartoes no celular e no tablet.
 * Window.Responsivo.
 *
 * Cada tela monta a sua tabela do jeito dela (nucleo.tabelaHtml, entradas,
 * financeiro, fiscal...). Em vez de mexer em todas, este arquivo olha o
 * documento: toda tabela com cabecalho ganha, em cada celula, o nome da
 * coluna (data-rotulo), e a classe "em-cartoes" quando:
 *   - nao cabe na largura do painel (num tablet em pe, a de Entradas tinha
 *     1032px num espaco de 786 e o botao de editar ficava escondido), ou
 *   - a tela e de celular e a tabela tem 4 colunas ou mais (caber, ela
 *     cabe, mas espremida: "OS-2026-0025" quebrava em tres linhas).
 * O CSS (secao 11 do dashboard.css) e que desenha o cartao: cada linha vira
 * um bloco, e o rotulo da coluna aparece ao lado do valor.
 *
 * No computador vale a mesma regra: cabendo, fica tabela. Num notebook de
 * 1280 a de Entradas nao cabia e os botoes Historico/Editar/Excluir ficavam
 * fora, so com rolagem de lado; virando cartao, ficam a vista.
 *
 * Nada aqui muda dado nem evento: so atributo e classe. Os botoes da
 * tabela continuam os mesmos elementos, com os mesmos data-acao.
 */
(function (janela) {
    'use strict';

    const LARGURA_CELULAR = 640;   // ate aqui: celular
    const COLUNAS_NO_CELULAR = 4;

    /** Nomes das colunas, contando colspan do cabecalho. */
    function colunas(tabela) {
        const cab = tabela.tHead && tabela.tHead.rows[tabela.tHead.rows.length - 1];
        if (!cab) return [];
        const nomes = [];
        Array.from(cab.cells).forEach(function (th) {
            const texto = th.textContent.replace(/\s+/g, ' ').trim();
            for (let i = 0; i < (th.colSpan || 1); i++) nomes.push(texto);
        });
        return nomes;
    }

    /** Poe o nome da coluna em cada celula (so escreve o que mudou). */
    function rotular(tabela, nomes) {
        Array.from(tabela.tBodies).concat(tabela.tFoot ? [tabela.tFoot] : []).forEach(function (grupo) {
            Array.from(grupo.rows).forEach(function (linha) {
                let coluna = 0;
                Array.from(linha.cells).forEach(function (celula) {
                    // Celula que ocupa varias colunas (linha vazia, total) nao tem rotulo.
                    const rotulo = celula.colSpan > 1 ? '' : (nomes[coluna] || '');
                    if (celula.getAttribute('data-rotulo') !== rotulo) celula.setAttribute('data-rotulo', rotulo);
                    coluna += celula.colSpan || 1;
                });
            });
        });
    }

    /*
     * Largura que a tabela pede quando e tabela (a do conteudo mais largo),
     * medida uma vez por conteudo. Sem guardar, cada clique em qualquer
     * lugar da tela tirava e punha o cartao de novo so para medir: no
     * celular eram 20 a 28 ms por mudanca.
     */
    const larguraNatural = new WeakMap();

    /**
     * conteudoMudou: as linhas foram redesenhadas (rotula e mede de novo).
     * Sem isso (secao que apareceu, tela que girou), so compara a largura
     * guardada com o espaco que ha agora.
     */
    function ajustar(tabela, conteudoMudou) {
        if (tabela.classList.contains('sem-cartao')) return;
        const nomes = colunas(tabela);
        if (nomes.length < 2) return;
        if (conteudoMudou || !larguraNatural.has(tabela)) rotular(tabela, nomes);

        if (janela.innerWidth <= LARGURA_CELULAR && nomes.length >= COLUNAS_NO_CELULAR) {
            tabela.classList.add('em-cartoes');
            return;
        }
        const caixa = tabela.parentElement;
        if (!caixa || !caixa.clientWidth) {         // escondida: decide quando aparecer
            if (conteudoMudou) larguraNatural.delete(tabela);
            return;
        }
        // A caixa (.rolagem-x) tem margem interna: o espaco util e sem ela.
        const estilo = janela.getComputedStyle(caixa);
        const util = caixa.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);

        let natural;
        if (!tabela.classList.contains('em-cartoes')) {
            natural = tabela.offsetWidth;            // e tabela agora: mede direto
        } else if (conteudoMudou || !larguraNatural.has(tabela)) {
            tabela.classList.remove('em-cartoes');   // e cartao: volta a tabela so para medir
            natural = tabela.offsetWidth;
        } else {
            natural = larguraNatural.get(tabela);
        }
        larguraNatural.set(tabela, natural);
        tabela.classList.toggle('em-cartoes', natural > util + 1);
    }

    function ajustarTudo(conteudoMudou) {
        document.querySelectorAll('table').forEach(function (t) { ajustar(t, conteudoMudou === true); });
    }

    /*
     * So as tabelas que a mudanca alcancou: as redesenhadas (linha nova,
     * busca filtrada) e as de dentro do que trocou de classe (secao ou
     * janela que abriu, menu encolhido). A troca de classe da propria
     * tabela, feita aqui, e ignorada.
     */
    const observador = new MutationObserver(function (mudancas) {
        const redesenhadas = new Set();
        const alcancadas = new Set();
        mudancas.forEach(function (m) {
            const alvo = m.target;
            if (m.type === 'attributes') {
                if (alvo.tagName !== 'TABLE' && alvo.querySelectorAll) {
                    alvo.querySelectorAll('table').forEach(function (t) { alcancadas.add(t); });
                }
                return;
            }
            const dentro = alvo.closest ? alvo.closest('table') : null;
            if (dentro) { redesenhadas.add(dentro); return; }
            m.addedNodes.forEach(function (n) {
                if (n.nodeType !== 1) return;
                if (n.tagName === 'TABLE') redesenhadas.add(n);
                else n.querySelectorAll('table').forEach(function (t) { redesenhadas.add(t); });
            });
        });
        redesenhadas.forEach(function (t) { ajustar(t, true); });
        alcancadas.forEach(function (t) { if (!redesenhadas.has(t)) ajustar(t, false); });
    });

    let pedido = 0;
    function aoRedimensionar() {
        if (pedido) return;
        pedido = janela.requestAnimationFrame(function () { pedido = 0; ajustarTudo(false); });
    }

    function iniciar() {
        observador.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        janela.addEventListener('resize', aoRedimensionar);
        janela.addEventListener('orientationchange', aoRedimensionar);
        ajustarTudo(true);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();

    janela.Responsivo = { ajustarTudo: ajustarTudo, LARGURA_CELULAR: LARGURA_CELULAR };
})(window);
