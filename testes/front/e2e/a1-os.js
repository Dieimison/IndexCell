// a1-os.js - abrir uma OS gravada e salvar sem mexer nos valores nao muda nada (banca R1, item 4).
'use strict';
const H = require('./lib');
const { L, sql, confere } = H;

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'a1');
    await H.entrar(p, 'admin', H.SENHA_ADMIN);

    const campos = function () {
        return p.evaluate(function () {
            return ['valor_orcamento', 'valor_mao_obra', 'valor_final'].map(function (n) {
                return Number(document.querySelector('[name="' + n + '"]').value) || 0;
            });
        });
    };
    const banco = function (id) {
        const o = sql('select valor_orcamento o, valor_mao_obra m, valor_final f from ordens_servico where id=' + id)[0];
        return [o.o, o.m, o.f];
    };

    async function caso(rotulo, preencher, esperado, statusNovo) {
        let id = null;
        await H.bloco(rotulo, async function () {
            await H.secao(p, 'os');
            await p.click('[data-acao="nova-os"]'); await p.waitForTimeout(500);
            await p.selectOption('#campo-cliente_id', { index: 1 });
            await p.selectOption('#campo-modelo_id', { index: 1 });
            await p.fill('#campo-defeito_relatado', 'e2e A1 ' + rotulo);
            await preencher();
            await H.salvar(p);
            id = sql('select max(id) id from ordens_servico')[0].id;
            confere('gravado [orcamento, mao, final]', banco(id), esperado);
            await p.click('[data-acao="editar-os"][data-id="' + id + '"]'); await p.waitForTimeout(800);
            confere('reaberta, sem tocar em nada', await campos(), esperado);
            await p.selectOption('#campo-status', statusNovo || 'em_reparo');
            await H.salvar(p);
            confere('depois de trocar so o status', banco(id), esperado);
        });
        return id;
    }

    await caso('mao de obra 120 sem orcamento', async function () { await p.fill('#campo-valor_mao_obra', '120'); }, [0, 120, 120]);
    await caso('orcamento 300 com final 250', async function () {
        await p.fill('#campo-valor_orcamento', '300');
        await p.fill('#campo-valor_final', '250');
    }, [300, 300, 250]);
    await caso('orcamento 300 com mao 200', async function () {
        await p.fill('#campo-valor_orcamento', '300');
        await p.fill('#campo-valor_mao_obra', '200');
    }, [300, 200, 200]);
    /*
     * Reabrir e MEXER no orcamento: o final gravado (250, desconto de balcao)
     * continua digitado e nao e recalculado. E o que pega a mutacao M8 da banca
     * ("let finalDigitado = null" em telas/os.js), que so trocar o status nao pega.
     */
    await H.bloco('reabrir a OS de final 250 e mexer no orcamento: o final gravado fica', async function () {
        await H.secao(p, 'os');
        await p.click('[data-acao="nova-os"]'); await p.waitForTimeout(500);
        await p.selectOption('#campo-cliente_id', { index: 1 });
        await p.selectOption('#campo-modelo_id', { index: 1 });
        await p.fill('#campo-defeito_relatado', 'e2e A1 mexer no orcamento');
        await p.fill('#campo-valor_orcamento', '300');
        await p.fill('#campo-valor_final', '250');
        await H.salvar(p);
        const os = sql('select max(id) id from ordens_servico')[0].id;
        await p.click('[data-acao="editar-os"][data-id="' + os + '"]'); await p.waitForTimeout(800);
        await p.fill('#campo-valor_orcamento', '350');
        confere('na tela, depois de mexer no orcamento', await campos(), [350, 300, 250]);
        await H.salvar(p);
        confere('gravado', banco(os), [350, 300, 250]);
    });

    const id = await caso('entrega: mao 120, muda so para Entregue', async function () {
        await p.fill('#campo-valor_mao_obra', '120');
    }, [0, 120, 120], 'entregue');
    if (id) {
        const os = sql('select status, venda_id from ordens_servico where id=' + id)[0];
        const venda = os.venda_id ? sql('select valor_total v from vendas where id=' + os.venda_id)[0].v : null;
        confere('entregue com venda de 120', [os.status, venda], ['entregue', 120]);
    }

    H.terminar('a1-os');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
