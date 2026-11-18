// massa.js - cria pela API os dados que os outros roteiros usam (o banco do
// rodar.js nasce vazio): 2 clientes, 1 modelo, uma peca com saldo, um celular
// em processamento e uma venda paga (que gera um lancamento de venda).
'use strict';
const H = require('./lib');
const { L, confere } = H;

/* IMEI de 15 digitos com o digito verificador (Luhn) certo. */
function imeiValido(base14) {
    let soma = 0;
    base14.split('').forEach(function (c, i) {
        let d = Number(c);
        if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
        soma += d;
    });
    return base14 + String((10 - soma % 10) % 10);
}

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'massa');
    await H.entrar(p, 'admin', H.SENHA_ADMIN);

    await H.bloco('Massa pela API', async function () {
        const sufixo = String(Date.now()).slice(-6);
        const c1 = await H.apiNa(p, 'POST', '/clientes', { nome: 'Cliente E2E Um', telefone: '(11) 91' + sufixo + '1' });
        const c2 = await H.apiNa(p, 'POST', '/clientes', { nome: 'Cliente E2E Dois', telefone: '(11) 92' + sufixo + '2' });
        const m = await H.apiNa(p, 'POST', '/modelos', { marca: 'Marca', modelo: 'Modelo E2E', armazenamento: '128GB' });
        const peca = await H.apiNa(p, 'POST', '/entradas', { tipo: 'peca', peca_nome: 'Tela E2E', peca_categoria: 'tela',
            quantidade: 50, valor_investimento: 40, valor_venda: 100, gerar_conta_pagar: '' });
        const cel = await H.apiNa(p, 'POST', '/entradas', { tipo: 'celular', modelo_id: m.id, imei: imeiValido('35' + sufixo + '123456'),
            situacao: 'processamento', valor_investimento: 500, valor_venda: 900, gerar_conta_pagar: '' });
        const formas = (await H.apiNa(p, 'GET', '/formas-pagamento')).itens;
        const padrao = formas.find(function (f) { return f.padrao; }) || formas[0];
        const venda = await H.apiNa(p, 'POST', '/vendas', { itens: [{ entrada_id: peca.id, quantidade: 1, valor_unitario: 100 }],
            forma_pagamento_id: padrao.id, parcelas: 1, pago: '1', vencimento: new Date().toISOString().substring(0, 10) });
        L('  ' + JSON.stringify({ c1: c1.status, c2: c2.status, modelo: m.status, peca: peca.status, celular: cel.status, venda: venda.status }));
        confere('tudo criado', [c1.status, c2.status, m.status, peca.status, cel.status, venda.status], [201, 201, 201, 201, 201, 201]);
    });

    H.terminar('massa');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
