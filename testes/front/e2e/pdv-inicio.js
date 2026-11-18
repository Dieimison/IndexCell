// pdv-inicio.js - a tela de entrada do PDV (v8) e a faixa "Banco de teste".
// O menu PDV abre a entrada (atalhos, hoje, Nova venda, ultimas OS); Nova venda
// leva ao PDV em tela cheia e "Sair do PDV" volta; "Abrir" abre a OS. A faixa
// liga pela regra em Admin > Regras e aparece no painel, no login e na loja.
// Tirar o telas/pdv-inicio.js ou o ambiente.js deixa este roteiro vermelho.
'use strict';
const H = require('./lib');
const { confere } = H;

function faixaVisivel(p) {
    return p.evaluate(function () { return !!document.querySelector('[data-faixa-teste]:not([hidden]) .faixa-teste-texto'); });
}

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'pdv-inicio');
    await H.entrar(p, 'admin', H.SENHA_ADMIN);

    await H.bloco('menu PDV abre a tela de entrada, com os atalhos do admin e as ultimas OS', async function () {
        // Rodando sozinho (sem o a1-os antes), garante uma OS para a lista.
        if (!H.sql('SELECT COUNT(*) AS q FROM ordens_servico')[0].q) {
            const cli = (await H.apiNa(p, 'GET', '/clientes')).itens[0];
            await H.apiNa(p, 'POST', '/os', { cliente_id: cli.id, modelo_nome: 'Modelo PDV entrada', valor_orcamento: 150 });
        }
        await H.secao(p, 'pdv-inicio');
        await p.waitForSelector('.pdvi-fila, .pdvi-os .texto-vazio');
        const t = await p.evaluate(function () {
            return { titulo: document.getElementById('tituloPagina').textContent,
                     atalhos: Array.from(document.querySelectorAll('.pdvi-atalho-nome')).map(function (a) { return a.textContent; }),
                     nova: !!document.querySelector('.pdvi-nova-venda') && !!document.querySelector('[data-nova-os]'), faixa: !!document.querySelector('.faixa-teste:not([hidden])') };
        });
        confere('titulo, atalhos e Nova venda', t, { titulo: 'PDV',
            atalhos: ['Histórico de vendas', 'Ordens de serviço', 'Estoque', 'Clientes e produtos', 'Entradas',
                      'Recebimentos', 'Loja online', 'Resultados'], nova: true, faixa: false });
        const os = H.sql('SELECT COUNT(*) AS q FROM ordens_servico')[0].q;
        confere('ultimas OS (ate 6)', await p.locator('.pdvi-os-item').count(), Math.min(6, os));
        await H.print(p, 'pdv-inicio');
    });

    await H.bloco('Nova venda -> PDV em tela cheia; Sair do PDV volta para a entrada', async function () {
        await p.click('.pdvi-nova-venda');
        await p.waitForTimeout(900);
        confere('PDV aberto', await p.evaluate(function () { return [location.hash, document.body.classList.contains('tela-cheia')]; }), ['#pdv', true]);
        await p.click('[data-pdv="sair"]');
        await p.waitForTimeout(800);
        confere('de volta', await p.evaluate(function () { return location.hash; }), '#pdv-inicio');
    });

    await H.bloco('"Abrir" de uma OS da lista abre a OS para editar', async function () {
        if (!(await p.locator('[data-abrir-os]').count())) { confere('ha OS na lista', false, true); return; }
        await p.click('[data-abrir-os]');
        await p.waitForTimeout(1500);
        confere('janela da OS', [await H.modalAberto(p), /^Editar /.test(await p.textContent('#modalTitulo'))], [true, true]);
        await p.click('#modalCancelar');
        await p.waitForTimeout(400);
    });

    await H.bloco('Nova OS abre a janela de OS nova', async function () {
        await H.secao(p, 'pdv-inicio');
        await p.click('[data-nova-os]');
        await p.waitForTimeout(1500);
        confere('janela', [await H.modalAberto(p), await p.textContent('#modalTitulo')], [true, 'Nova ordem de serviço']);
        await p.click('#modalCancelar');
        await p.waitForTimeout(400);
    });

    await H.bloco('Admin > Regras liga "banco de teste": a faixa aparece no painel, no login e na loja', async function () {
        await H.secao(p, 'admin');
        await p.selectOption('[data-chave="sistema.banco_de_teste"][data-escopo="geral"]', '1');
        await p.waitForTimeout(1200);
        confere('faixa no painel na hora', await faixaVisivel(p), true);
        const outra = await ctx.browser().newContext({ locale: 'pt-BR', viewport: { width: 390, height: 844 }, isMobile: true });
        const q = await outra.newPage();
        await q.goto(H.BASE + '/Login/index.html');
        await q.waitForTimeout(800);
        confere('faixa no login', await faixaVisivel(q), true);
        await q.goto(H.BASE + '/Loja/index.html');
        await q.waitForTimeout(1000);
        confere('faixa na loja', await faixaVisivel(q), true);
        confere('loja sem rolagem de lado com a faixa', await q.evaluate(function () {
            return Math.max(document.documentElement.scrollWidth, window.innerWidth); }), 390);
        await H.print(q, 'pdv-inicio-faixa-loja');
        await p.selectOption('[data-chave="sistema.banco_de_teste"][data-escopo="geral"]', '');
        await p.waitForTimeout(1200);
        confere('desligada: a faixa some', await faixaVisivel(p), false);
        await q.goto(H.BASE + '/Login/index.html');
        await q.waitForTimeout(800);
        confere('desligada: login sem faixa', await faixaVisivel(q), false);
        await outra.close();
    });

    await navegador.close();
    H.terminar('pdv-inicio');
})().catch(function (e) { console.error(e); process.exit(1); });
