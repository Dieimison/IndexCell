// responsivo.js - celular, tablet e computador (v7.1): nenhuma tela mais larga que
// o aparelho, tabela larga vira cartao (com o nome da coluna) e volta a ser tabela
// quando a tela alarga. Desligar o Dashboard/responsivo.js deixa este roteiro vermelho.
'use strict';
const H = require('./lib');
const { L, confere } = H;

const SECOES = ['inicio', 'pdv-inicio', 'pdv', 'dashboard', 'pedidos', 'entradas', 'os', 'vendas', 'cadastros', 'financeiro', 'loja', 'fiscal', 'admin', 'configuracoes'];

/** Largura da pagina e de quem passa da borda (menu fechado nao conta). */
function medir(p, largura) {
    return p.evaluate(function (L) {
        const menu = document.querySelector('.sidebar');
        const menuFechado = menu && menu.getBoundingClientRect().right <= 1;
        const fora = [];
        document.querySelectorAll('main *, .modal-caixa *').forEach(function (el) {
            if (menuFechado && menu.contains(el)) return;
            const r = el.getBoundingClientRect();
            if (r.width && r.right > L + 1 && fora.length < 3) fora.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
        });
        return { pagina: Math.max(document.documentElement.scrollWidth, window.innerWidth), fora: fora };
    }, largura);
}

/** A tabela de Entradas: em cartao? e o rotulo da 2a celula da 1a linha. */
function tabelaEntradas(p) {
    return p.evaluate(function () {
        const t = document.querySelector('#secao-entradas table');
        if (!t) return null;
        const td = t.querySelector('tbody tr td:nth-child(2)');
        return { cartao: t.classList.contains('em-cartoes'), rotulo: td ? td.getAttribute('data-rotulo') : null,
                 cabecalho: t.tHead ? t.tHead.rows[0].cells[1].textContent.trim() : null,
                 editarVisivel: (function () {
                     const b = t.querySelector('tbody .coluna-acoes button');
                     if (!b) return null;
                     const r = b.getBoundingClientRect();
                     return r.right <= window.innerWidth && r.left >= 0;
                 })() };
    });
}

async function irPara(p, secao) {
    await p.goto(H.BASE + '/Dashboard/dashboard.html#' + secao);
    await p.waitForTimeout(1100);
}

(async function () {
    const navegador = await H.chromium.launch();

    for (const aparelho of [{ nome: 'celular', width: 360, height: 740 }, { nome: 'tablet em pe', width: 820, height: 1180 }]) {
        const ctx = await navegador.newContext({ locale: 'pt-BR', viewport: { width: aparelho.width, height: aparelho.height },
                                                 isMobile: true, hasTouch: true });
        const p = await H.novaPagina(ctx, 'responsivo-' + aparelho.nome);
        await H.entrar(p, 'admin', H.SENHA_ADMIN);

        await H.bloco(aparelho.nome + ' ' + aparelho.width + 'px: nenhuma secao mais larga que a tela', async function () {
            for (const s of SECOES) {
                await irPara(p, s);
                const m = await medir(p, aparelho.width);
                confere(s + ': largura da pagina' + (m.fora.length ? ' (passa: ' + m.fora.join(', ') + ')' : ''), m.pagina, aparelho.width);
            }
        });

        await H.bloco(aparelho.nome + ': Entradas em cartoes, com o nome da coluna e o botao a vista', async function () {
            await irPara(p, 'entradas');
            const t = await tabelaEntradas(p);
            confere('tabela em cartao', t && t.cartao, true);
            confere('rotulo da celula = cabecalho da coluna', t && t.rotulo, t && t.cabecalho);
            confere('botao do registro dentro da tela', t && t.editarVisivel, true);
            await H.print(p, 'responsivo-' + aparelho.nome.replace(/ /g, '-') + '-entradas');
        });

        await H.bloco(aparelho.nome + ': janela da OS e do usuario cabem na tela', async function () {
            await irPara(p, 'os');
            await p.click('[data-acao="nova-os"]'); await p.waitForTimeout(700);
            confere('janela da OS aberta', await H.modalAberto(p), true);
            const corpo = await p.evaluate(function () { const c = document.getElementById('modalCorpo'); return c.scrollWidth <= c.clientWidth + 1; });
            confere('corpo da janela sem rolagem de lado', corpo, true);
            confere('janela: largura da pagina', (await medir(p, aparelho.width)).pagina, aparelho.width);
            await p.click('#modalCancelar'); await p.waitForTimeout(400);
            // No celular o "+ Novo usuario" ficava fora da tela e nao abria.
            await irPara(p, 'configuracoes');
            await p.click('[data-acao="novo-usuario"]', { timeout: 4000 }); await p.waitForTimeout(600);
            confere('"+ Novo usuario" abre a janela', await H.modalAberto(p), true);
            await p.click('#modalCancelar'); await p.waitForTimeout(400);
        });

        await ctx.close();
    }

    // Computador: tela larga fica tabela; estreitar a janela vira cartao e alargar volta.
    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'responsivo-computador');
    await H.entrar(p, 'admin', H.SENHA_ADMIN);
    await H.bloco('computador: tabela <-> cartao conforme a largura da janela', async function () {
        await p.setViewportSize({ width: 1920, height: 1000 });
        await irPara(p, 'entradas');
        // Espera a tabela de verdade (a espera fixa do irPara falhou uma vez numa rodada completa lenta).
        await p.waitForSelector('#secao-entradas table', { timeout: 10000 });
        confere('1920px: tabela', (await tabelaEntradas(p)).cartao, false);
        await p.setViewportSize({ width: 600, height: 900 }); await p.waitForTimeout(400);
        confere('600px: cartao', (await tabelaEntradas(p)).cartao, true);
        confere('600px: largura da pagina', (await medir(p, 600)).pagina, 600);
        await p.setViewportSize({ width: 1920, height: 1000 }); await p.waitForTimeout(400);
        confere('de volta a 1920px: tabela', (await tabelaEntradas(p)).cartao, false);
        // Redesenhar a lista (filtro) com a tela estreita: as linhas novas tambem ganham rotulo.
        await p.setViewportSize({ width: 600, height: 900 }); await p.waitForTimeout(300);
        await p.fill('#secao-entradas .barra-filtros input', 'E2E'); await p.waitForTimeout(700);
        const t = await tabelaEntradas(p);
        confere('filtrada a 600px: cartao com rotulo', t && t.cartao && t.rotulo === t.cabecalho, true);
    });

    await navegador.close();
    H.terminar('responsivo');
})();
