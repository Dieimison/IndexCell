// pedido.js - v7: Pedido de entrada pela tela (importar o XML da NF-e,
// classificar as linhas, confirmar), Fiscal (CFOP) e o PDV completo
// (servico, "Nao informar", vencimento, observacao). Tela E banco.
'use strict';
const H = require('./lib');
const { L, sql, confere } = H;

/* DV da chave de acesso (modulo 11, pesos 2..9 da direita). */
function dv(c43) {
    let soma = 0;
    let peso = 2;
    for (let i = 42; i >= 0; i--) { soma += (c43.charCodeAt(i) - 48) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const resto = soma % 11;
    return String(resto < 2 ? 0 : 11 - resto);
}

function nfe(numero, imeis) {
    const cnpj = '11222333000181';
    const c43 = '352611' + cnpj + '55001' + String(numero).padStart(9, '0') + '1' + '87654321';
    const chave = c43 + dv(c43);
    return '<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe>' +
        '<infNFe Id="NFe' + chave + '" versao="4.00"><ide><mod>55</mod><serie>1</serie><nNF>' + numero + '</nNF>' +
        '<dhEmi>2026-11-01T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>' +
        '<emit><CNPJ>' + cnpj + '</CNPJ><xNome>DISTRIBUIDORA E2E LTDA</xNome><enderEmit><UF>SP</UF></enderEmit><IE>123</IE></emit>' +
        '<det nItem="1"><prod><cProd>CAPA-E2E</cProd><cEAN>SEM GTIN</cEAN><xProd>CAPA E2E ' + numero + '</xProd><NCM>39269090</NCM><CFOP>5102</CFOP>' +
        '<uCom>UN</uCom><qCom>5</qCom><vProd>50.00</vProd></prod></det>' +
        '<det nItem="2"><prod><cProd>CEL-E2E</cProd><cEAN>SEM GTIN</cEAN><xProd>SMARTPHONE E2E ' + numero + '</xProd><NCM>85171300</NCM><CFOP>5102</CFOP>' +
        '<uCom>UN</uCom><qCom>2</qCom><vProd>1000.00</vProd></prod><infAdProd>IMEI ' + imeis.join(' IMEI ') + '</infAdProd></det>' +
        '<total><ICMSTot><vProd>1050.00</vProd><vDesc>0</vDesc><vFrete>10.00</vFrete><vNF>1060.00</vNF></ICMSTot></total>' +
        '</infNFe></NFe></nfeProc>';
}

function luhn(base14) {
    let soma = 0;
    base14.split('').forEach(function (c, i) { let d = Number(c); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } soma += d; });
    return base14 + String((10 - soma % 10) % 10);
}

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'admin');
    const sufixo = String(Date.now()).slice(-6);
    const numero = Number(sufixo);
    const imeis = [luhn('35' + sufixo + '111111'), luhn('35' + sufixo + '222222')];
    await H.entrar(p, 'admin', H.SENHA_ADMIN);

    await H.bloco('Importar o XML da NF-e pela tela: rascunho com as linhas e os IMEIs', async function () {
        await H.secao(p, 'pedidos');
        await p.setInputFiles('#pedidoXml', { name: 'nota.xml', mimeType: 'text/xml', buffer: Buffer.from(nfe(numero, imeis)) });
        await p.waitForTimeout(1800);
        const ped = sql("select id, numero, status, valor_total from pedidos where nota_numero = '" + numero + "'")[0];
        L('  pedido: ' + JSON.stringify(ped));
        confere('rascunho de R$ 1.060 (1.050 + frete 10)', [ped && ped.status, ped && ped.valor_total], ['rascunho', 1060]);
        confere('o editor abriu com 2 linhas sem tipo', await p.locator('.pedido-linha.sem-tipo').count(), 2);
        await H.print(p, 'pedido-1-importado');
    });

    await H.bloco('Classificar as linhas e confirmar: estoque e conta a pagar', async function () {
        await p.selectOption('[data-linha="0"][data-campo="tipo_item"]', 'produto'); await p.waitForTimeout(300);
        await p.fill('[data-linha="0"][data-campo="valor_venda"]', '25');
        await p.selectOption('[data-linha="1"][data-campo="tipo_item"]', 'celular'); await p.waitForTimeout(300);
        confere('os IMEIs da nota aparecem na linha do celular', (await p.inputValue('[data-linha="1"][data-campo="imei"]')).split(/\s+/), imeis);
        await p.fill('[data-linha="1"][data-campo="valor_venda"]', '899');
        await p.click('[data-pedido="confirmar"]'); await p.waitForTimeout(2500);
        const ped = sql("select id, status from pedidos where nota_numero = '" + numero + "'")[0];
        const entradas = sql('select e.tipo, e.quantidade, e.valor_investimento, e.imei from pedido_itens i join entradas e on e.id = i.entrada_id ' +
                             'where i.pedido_id = ' + ped.id + ' order by i.ordem');
        L('  entradas: ' + JSON.stringify(entradas));
        // liquidos 50 + 500 + 500 = 1050; frete 10 -> capa 50 + 0,47 = 50,47/5 = 10,09; celulares 504,76 e 504,77
        confere('confirmado: 1 produto x5 e 2 celulares com o IMEI de cada um', [ped.status, entradas.map(function (e) { return [e.tipo, e.quantidade, e.imei]; })],
                ['confirmado', [['produto', 5, null], ['celular', 1, imeis[0]], ['celular', 1, imeis[1]]]]);
        confere('conta a pagar no total da nota', sql('select sum(valor) v, count(*) n from lancamentos where pedido_id = ' + ped.id)[0], { v: 1060, n: 1 });
        confere('nota importada: sem "Ja paguei", a conta fica pendente', sql('select status from lancamentos where pedido_id = ' + ped.id)[0].status, 'pendente');
        await H.print(p, 'pedido-2-confirmado');
    });

    await H.bloco('Estoque (v9): o item mostra a Entrada de origem, sem Excluir, com custo travado', async function () {
        const ped = sql("select id, numero from pedidos where nota_numero = '" + numero + "'")[0];
        await H.secao(p, 'entradas');
        await p.fill('#buscaEntrada', imeis[0]); await p.waitForTimeout(500);
        const linha = p.locator('#listaEntradas tbody tr').first();
        confere('origem "Entrada PE-..." e sem Excluir', [await linha.locator('[data-acao="ver-documento-entrada"]').innerText(),
            await linha.locator('[data-acao="excluir-entrada"]').count()], ['Entrada ' + ped.numero, 0]);
        await linha.locator('[data-acao="editar-entrada"]').click(); await p.waitForTimeout(700);
        confere('na edicao, quantidade e custo seguem a nota (travados)',
                await p.locator('#modalCorpo [name="valor_investimento"]').isDisabled(), true);
        await p.click('#modalCancelar'); await p.waitForTimeout(300);
        await linha.locator('[data-acao="ver-documento-entrada"]').click(); await p.waitForTimeout(1500);
        confere('o link abre a propria entrada', await p.evaluate(function () {
            return [location.hash, document.getElementById('tituloPagina').textContent,
                    document.querySelector('#secao-pedidos .secao-titulo').textContent.trim().split(' ')[0]];
        }), ['#pedidos', 'Entradas', ped.numero]);
    });

    await H.bloco('Fiscal: CFOP 1.102 desligado na tela fica gravado para a loja', async function () {
        await H.secao(p, 'fiscal');
        await p.click('[data-aba-fiscal="cfop"]'); await p.waitForTimeout(500);
        await p.fill('#buscaCfop', '1102'); await p.waitForTimeout(400);
        await p.uncheck('[data-cfop="1102"][data-campo-cfop="permitido"]'); await p.waitForTimeout(1200);
        confere('cfop_empresa.permitido = 0', sql("select permitido from cfop_empresa where cfop = '1102'").map(function (c) { return c.permitido; }), [0]);
        await H.print(p, 'pedido-3-cfop');
        await p.check('[data-cfop="1102"][data-campo-cfop="permitido"]'); await p.waitForTimeout(1200);
    });

    await H.bloco('PDV: servico do cadastro, "Nao informar", vencimento e observacao', async function () {
        const sv = await H.apiNa(p, 'POST', '/servicos', { nome: 'Aplicação de película ' + sufixo, valor_padrao: 20 });
        await p.reload(); await p.waitForTimeout(1200);
        await p.keyboard.press('F2'); await p.waitForTimeout(1200);
        await p.click('[data-pdv="filtro"][data-valor="servico"]');
        await p.fill('#pdvBusca', 'película ' + sufixo);
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        await p.click('[data-pdv="sem-forma"]'); await p.waitForTimeout(200);
        await p.uncheck('[data-pdv-campo="pago"]'); await p.waitForTimeout(200);
        await p.fill('[data-pdv-campo="vencimento"]', '2026-12-10');
        await p.fill('#pdvObservacoes', 'Obs e2e ' + sufixo);
        await H.print(p, 'pedido-4-pdv-servico');
        await p.keyboard.press('F10'); await p.waitForTimeout(1500);
        const v = sql("select id, forma_pagamento_id, observacoes from vendas where observacoes = 'Obs e2e " + sufixo + "'")[0];
        // A venda guarda o servico pelo nome (venda_itens nao tem servico_id; a janela antiga fazia igual).
        confere('venda com o servico, sem forma, com a observacao', [!!v, v && v.forma_pagamento_id,
            v && sql('select descricao from venda_itens where venda_id = ' + v.id)[0].descricao], [true, null, 'Aplicação de película ' + sufixo]);
        L('  servico ' + sv.id + ' (' + sv.status + ')');
        confere('conta a receber pendente vencendo em 10/12', v && sql('select status, vencimento from lancamentos where venda_id = ' + v.id)[0],
                { status: 'pendente', vencimento: '2026-12-10' });
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        await p.click('[data-pdv="sair"]'); await p.waitForTimeout(800);
    });

    H.terminar('pedido');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
