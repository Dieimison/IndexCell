// formas.js - forma de pagamento padrao explicita (R2 item 5) e OS com forma sem valor (R2 item 11).
'use strict';
const H = require('./lib');
const { L, sql, confere } = H;

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'formas');
    await H.entrar(p, 'admin', H.SENHA_ADMIN);

    const nomeNova = 'Vale-presente e2e ' + String(Date.now()).slice(-5);

    await H.bloco('Forma nova nao vira a pre-escolhida da venda', async function () {
        await H.secao(p, 'cadastros');
        await p.click('#subAbasCadastros [data-cadastro="formas"]'); await p.waitForTimeout(400);
        await p.click('#botaoNovoCadastro'); await p.waitForTimeout(500);
        confere('formulario de forma nova sem "Ordem na lista"', await p.locator('#campo-ordem').count(), 0);
        confere('tem "Usar como padrão nas vendas"', await p.locator('#campo-padrao').count(), 1);
        await p.fill('#campo-nome', nomeNova);
        await H.salvar(p);
        const padrao = sql('select id, nome from formas_pagamento where padrao = 1');
        L('  padrao no banco: ' + JSON.stringify(padrao));
        const nova = sql("select id, ordem, padrao from formas_pagamento where nome = '" + nomeNova + "'")[0];
        const maior = sql('select max(ordem) m from formas_pagamento')[0].m;
        confere('a forma nova foi para o fim da lista e nao e padrao', [nova.ordem === maior, nova.padrao], [true, 0]);

        // ADAPTADO-v7: a venda nova e no PDV; a forma pre-escolhida e o botao marcado.
        await H.secao(p, 'vendas');
        await p.click('[data-acao="abrir-pdv"]'); await p.waitForTimeout(1200);
        const escolhida = await p.getAttribute('.pdv-forma[aria-checked="true"]', 'data-id');
        confere('a venda nova vem com a forma PADRAO', escolhida, padrao.length ? String(padrao[0].id) : '');
        await p.click('[data-pdv="sair"]'); await p.waitForTimeout(800);
    });

    await H.bloco('Marcar outra forma como padrao troca a pre-escolhida', async function () {
        const nova = sql("select id from formas_pagamento where nome = '" + nomeNova + "'")[0];
        await H.secao(p, 'cadastros');
        await p.click('#subAbasCadastros [data-cadastro="formas"]'); await p.waitForTimeout(400);
        await p.click('[data-acao="editar-cadastro"][data-id="' + nova.id + '"]'); await p.waitForTimeout(500);
        await p.locator('label.interruptor:has(#campo-padrao)').click();
        await H.salvar(p);
        confere('so ela e padrao no banco', sql('select id from formas_pagamento where padrao = 1').map(function (f) { return f.id; }), [nova.id]);
        await p.keyboard.press('F2'); await p.waitForTimeout(1200);
        confere('a venda nova vem com ela', await p.getAttribute('.pdv-forma[aria-checked="true"]', 'data-id'), String(nova.id));
        await p.click('[data-pdv="sair"]'); await p.waitForTimeout(800);
    });

    await H.bloco('OS: uma forma so, com o valor em branco, vale o total', async function () {
        await H.secao(p, 'os');
        await p.click('[data-acao="nova-os"]'); await p.waitForTimeout(500);
        await p.selectOption('#campo-cliente_id', { index: 1 });
        await p.selectOption('#campo-modelo_id', { index: 1 });
        await p.fill('#campo-valor_mao_obra', '100');
        await p.selectOption('[data-pag-forma]', { index: 1 });
        confere('valor preenchido com o total', await p.inputValue('[data-pag-valor]'), '100.00');
        await H.salvar(p);
        const os = sql('select max(id) id from ordens_servico')[0].id;
        confere('os_pagamentos com 1 linha de 100', sql('select count(*) n, sum(valor) v from os_pagamentos where os_id=' + os)[0], { n: 1, v: 100 });
    });

    await H.bloco('OS: o pagamento unico preenchido sozinho acompanha o valor final ate a pessoa mexer nele', async function () {
        await H.secao(p, 'os');
        await p.click('[data-acao="nova-os"]'); await p.waitForTimeout(500);
        await p.selectOption('#campo-cliente_id', { index: 1 });
        await p.selectOption('#campo-modelo_id', { index: 1 });
        await p.fill('#campo-valor_mao_obra', '100');
        await p.selectOption('[data-pag-forma]', { index: 1 });
        await p.fill('#campo-valor_mao_obra', '150');
        confere('mao 150: o pagamento foi junto', await p.inputValue('[data-pag-valor]'), '150.00');
        await p.fill('[data-pag-valor]', '120');
        await p.fill('#campo-valor_mao_obra', '200');
        confere('digitado 120 pela pessoa: nao acompanha mais', await p.inputValue('[data-pag-valor]'), '120');
        await p.click('#modalCancelar');
    });

    await H.bloco('OS: valor sem forma nao trava o Salvar; o servidor recusa e a janela mostra', async function () {
        await H.secao(p, 'os');
        const antes = sql('select count(*) n from ordens_servico')[0].n;
        await p.click('[data-acao="nova-os"]'); await p.waitForTimeout(500);
        await p.selectOption('#campo-cliente_id', { index: 1 });
        await p.selectOption('#campo-modelo_id', { index: 1 });
        await p.fill('#campo-valor_mao_obra', '100');
        await p.fill('[data-pag-valor]', '100');
        confere('aviso no rodape, Salvar livre', [await p.locator('[data-pag-rotulo]').innerText(),
            await p.evaluate(function () { return document.getElementById('modalSalvar').disabled; })],
            ['Escolha a forma de pagamento de cada valor lançado.', false]);
        await H.salvar(p);
        const msg = await H.erroDaJanela(p);
        L('  recusa do servidor: "' + msg + '"');
        confere('recusado pelo servidor, janela aberta, nada gravado',
                [!!msg, await H.modalAberto(p), sql('select count(*) n from ordens_servico')[0].n], [true, true, antes]);
        await p.click('#modalCancelar');
    });

    await H.bloco('OS: duas formas e uma sem valor trava o Salvar com a mensagem', async function () {
        await H.secao(p, 'os');
        await p.click('[data-acao="nova-os"]'); await p.waitForTimeout(500);
        await p.selectOption('#campo-cliente_id', { index: 1 });
        await p.selectOption('#campo-modelo_id', { index: 1 });
        await p.fill('#campo-valor_mao_obra', '100');
        await p.selectOption('[data-pag-forma] >> nth=0', { index: 1 });
        await p.fill('[data-pag-valor] >> nth=0', '60');
        await p.click('[data-adicionar-pagamento]');
        await p.selectOption('[data-pag-forma] >> nth=1', { index: 2 });
        confere('rodape e Salvar', [await p.locator('[data-pag-rotulo]').innerText(),
            await p.evaluate(function () { return document.getElementById('modalSalvar').disabled; })],
            ['Informe o valor de cada forma de pagamento escolhida.', true]);
        await H.print(p, 'os-forma-sem-valor');
        await p.fill('[data-pag-valor] >> nth=1', '40');
        confere('preenchido, fecha e libera', [await p.locator('[data-pag-rotulo]').innerText(),
            await p.evaluate(function () { return document.getElementById('modalSalvar').disabled; })], ['Fecha em', false]);
        await p.click('#modalCancelar');
    });

    H.terminar('formas');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
