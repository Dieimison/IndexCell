// pdv.js - v6: tela de Inicio, PDV (caixa), campo de lista com "+ Nova" e
// regras por chave na tela de Admin. Confere a tela E o banco.
'use strict';
const H = require('./lib');
const { L, sql, confere } = H;

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'admin');
    const sufixo = String(Date.now()).slice(-6);

    await H.bloco('Depois do login a pessoa cai no Inicio, com o PDV em destaque', async function () {
        await H.entrar(p, 'admin', H.SENHA_ADMIN);
        confere('endereco #inicio', await p.evaluate(function () { return location.hash; }), '#inicio');
        confere('PDV em destaque e "Pedidos de entrada" planejado (nao abre)', await p.evaluate(function () {
            return [!!document.querySelector('.inicio-destaque[data-ir="pdv"]'),
                    !!document.querySelector('.modulo-planejado[aria-disabled="true"]')];
        }), [true, true]);
        await H.print(p, 'pdv-1-inicio');
    });

    // Massa: um celular com IMEI e uma peca com 5 unidades (preco 50).
    const luhn = function (base14) {
        let soma = 0;
        base14.split('').forEach(function (c, i) { let d = Number(c); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } soma += d; });
        return base14 + String((10 - soma % 10) % 10);
    };
    const imei = luhn('35' + sufixo + '123456');   // o servidor confere o digito do IMEI (Luhn)
    const modelo = await H.apiNa(p, 'POST', '/modelos', { marca: 'Apple', modelo: 'PDV ' + sufixo, armazenamento: '128GB' });
    const cel = await H.apiNa(p, 'POST', '/entradas', { tipo: 'celular', modelo_id: modelo.id, imei: imei, cor: 'Preto',
        situacao: 'ready', valor_investimento: 900, valor_venda: 1500, gerar_conta_pagar: '' });
    const peca = await H.apiNa(p, 'POST', '/entradas', { tipo: 'peca', peca_nome: 'Tela PDV ' + sufixo, peca_categoria: 'tela',
        quantidade: 5, valor_investimento: 20, valor_venda: 50, gerar_conta_pagar: '' });
    L('massa: celular ' + cel.id + ' (' + cel.status + '), peca ' + peca.id + ' (' + peca.status + ')');

    await H.bloco('F2 abre o PDV em tela cheia; IMEI bipado + Enter poe o celular no carrinho', async function () {
        await p.reload(); await p.waitForTimeout(1200);
        await p.keyboard.press('F2'); await p.waitForTimeout(1200);
        confere('tela cheia (sem menu lateral) e foco na busca', await p.evaluate(function () {
            return [document.body.classList.contains('tela-cheia'), document.activeElement && document.activeElement.id];
        }), [true, 'pdvBusca']);
        await p.fill('#pdvBusca', imei);
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        const linha = await p.locator('.pdv-linha').first().innerText();
        confere('o carrinho tem o celular, com o IMEI', [await p.locator('.pdv-linha').count(), linha.indexOf(imei) !== -1], [1, true]);
    });

    await H.bloco('Peca x2 com 10% de desconto, dinheiro com troco: grava a venda paga', async function () {
        await p.fill('#pdvBusca', 'tela pdv ' + sufixo);
        await p.keyboard.press('Enter'); await p.waitForTimeout(200);
        await p.click('.pdv-linha:nth-child(2) [data-pdv="mais"]'); await p.waitForTimeout(200);
        await p.click('[data-pdv="modo-desconto"]');
        await p.fill('#pdvDesconto', '10'); await p.waitForTimeout(200);
        // 1500 + 2 x 50 = 1600; 10% = 160; total 1440
        confere('total na tela', (await p.locator('#pdvTotal').innerText()).replace(/\s/g, ' '), 'R$ 1.440,00');
        await p.click('.pdv-forma:has-text("Dinheiro")'); await p.waitForTimeout(200);
        await p.fill('[data-pdv-campo="recebido"]', '1500'); await p.waitForTimeout(200);
        // moeda() usa espaco nao separavel depois do "R$": compara com espaco comum
        confere('troco', (await p.locator('.pdv-troco').innerText()).replace(/\s/g, ' '), 'Troco R$ 60,00');
        await H.print(p, 'pdv-2-carrinho');
        const antes = sql('select count(*) n from vendas')[0].n;
        await p.keyboard.press('F10'); await p.waitForTimeout(1500);
        confere('janela "Venda registrada" com o troco', await p.evaluate(function () {
            const c = document.getElementById('pdvConcluida');
            return !c.classList.contains('oculta') && /Troco: R\$\s60,00/.test(c.innerText);
        }), true);
        await H.print(p, 'pdv-3-concluida');
        const v = sql('select id, valor_bruto, desconto, valor_total from vendas order by id desc limit 1')[0];
        confere('venda no banco: bruto 1600, desconto 160, total 1440', [sql('select count(*) n from vendas')[0].n - antes,
            v.valor_bruto, v.desconto, v.valor_total], [1, 1600, 160, 1440]);
        confere('conta a receber ja paga (dinheiro, 1 parcela)', sql("select status from lancamentos where venda_id = " + v.id)
            .map(function (l) { return l.status; }), ['pago']);
        confere('estoque: celular vendido, peca 5 -> 3', [sql('select saldo from vw_entradas where id = ' + cel.id)[0].saldo,
            sql('select saldo from vw_entradas where id = ' + peca.id)[0].saldo], [0, 3]);
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        confere('Enter fecha e o carrinho comeca vazio', [await p.locator('#pdvConcluida.oculta').count(), await p.locator('.pdv-linha').count()], [1, 0]);
    });

    await H.bloco('Balcao com limite de 10%: o PDV avisa antes e o servidor recusa mesmo sem a tela', async function () {
        await H.apiNa(p, 'POST', '/chaves', { chave: 'venda.desconto_maximo_balcao', escopo: 'empresa', valor: '10' });
        const login = 'pdvbalcao' + sufixo;
        const provisoria = 'Provisoria-' + sufixo + 'x';
        const definitiva = 'Caixa-Loja-' + sufixo;
        await H.apiNa(p, 'POST', '/usuarios', { usuario: login, nome: 'Caixa PDV', perfil: 'balcao', senha: provisoria, ativo: 1 });
        const ctxB = await H.novoContexto(navegador);
        const b = await H.novaPagina(ctxB, 'balcao');
        await H.entrar(b, login, provisoria);
        await b.fill('#trocaAtual', provisoria);
        await b.fill('#trocaNova', definitiva);
        await b.fill('#trocaConfirma', definitiva);
        await b.click('#formTrocaSenha button[type="submit"]'); await b.waitForTimeout(1500);
        confere('balcao nao ve o Admin no menu', await b.evaluate(function () {
            const a = document.querySelector('nav a[data-secao="admin"]');
            return !!a && a.offsetParent !== null;
        }), false);
        await b.keyboard.press('F2'); await b.waitForTimeout(1200);
        await b.fill('#pdvBusca', 'tela pdv ' + sufixo);
        await b.keyboard.press('Enter'); await b.waitForTimeout(200);
        await b.fill('#pdvDesconto', '6'); await b.waitForTimeout(200);   // R$ 6 de R$ 50 = 12%
        confere('a tela mostra o limite e marca o desconto acima dele', [
            (await b.locator('.resumo-nota').innerText()).indexOf('até 10%') !== -1,
            await b.locator('.resumo-desconto.fora-do-limite').count()], [true, 1]);
        const antes = sql('select count(*) n from vendas')[0].n;
        await b.click('#pdvFinalizar'); await b.waitForTimeout(800);
        confere('Finalizar nao grava e diz o limite', [(await b.locator('#pdvErro').innerText()).indexOf('limite') !== -1,
            sql('select count(*) n from vendas')[0].n], [true, antes]);
        const direto = await H.apiNa(b, 'POST', '/vendas', { itens: [{ entrada_id: peca.id, quantidade: 1 }], desconto: 6, pago: true });
        confere('pela API, sem a tela: 403 e nada gravado', [direto.status, sql('select count(*) n from vendas')[0].n], [403, antes]);
        await b.fill('#pdvDesconto', '5'); await b.waitForTimeout(200);
        await b.click('#pdvFinalizar'); await b.waitForTimeout(1500);
        confere('no limite (R$ 5 = 10%) grava', sql('select count(*) n from vendas')[0].n, antes + 1);
        await H.print(b, 'pdv-4-balcao-limite');
        await H.apiNa(p, 'POST', '/chaves', { chave: 'venda.desconto_maximo_balcao', escopo: 'empresa', valor: null });
        await ctxB.close();
    });

    await H.bloco('Novo modelo: Marca e lista e "+ Nova marca" cadastra ali mesmo', async function () {
        await p.keyboard.press('Escape');
        await p.click('[data-pdv="sair"]'); await p.waitForTimeout(800);
        await H.secao(p, 'cadastros');
        await p.click('#subAbasCadastros [data-cadastro="modelos"]'); await p.waitForTimeout(400);
        await p.click('#botaoNovoCadastro'); await p.waitForTimeout(600);
        confere('Marca e um select com Apple e Samsung', await p.evaluate(function () {
            const s = document.getElementById('campo-marca');
            const v = Array.from(s.options).map(function (o) { return o.value; });
            return [s.tagName, v.indexOf('Apple') !== -1, v.indexOf('Samsung') !== -1];
        }), ['SELECT', true, true]);
        const marca = 'marca e2e ' + sufixo;
        await p.click('#campo-marca ~ [data-lista-novo]');
        await p.fill('#campo-marca ~ .lista-novo-caixa [data-lista-digitado]', marca);
        await H.print(p, 'pdv-5-nova-marca');
        await p.keyboard.press('Enter'); await p.waitForTimeout(800);
        confere('a marca nova ja vem escolhida (com a 1a maiuscula) e a janela continua aberta',
            [await p.inputValue('#campo-marca'), await H.modalAberto(p)], ['Marca e2e ' + sufixo, true]);
        await p.fill('#campo-modelo', 'Modelo e2e ' + sufixo);
        await H.salvar(p);
        confere('modelo gravado com a marca da lista', sql("select marca from modelos where modelo = 'Modelo e2e " + sufixo + "'")
            .map(function (m) { return m.marca; }), ['Marca e2e ' + sufixo]);
    });

    await H.bloco('Admin: regra mudada na tela vale para a empresa e entra no historico', async function () {
        await H.secao(p, 'admin');
        await p.selectOption('[data-chave="venda.exigir_cliente"][data-escopo="empresa"]', '1');
        await p.waitForTimeout(1200);
        confere('gravado em chaves_empresa e no historico', [
            sql("select valor from chaves_empresa where chave = 'venda.exigir_cliente'").map(function (l) { return l.valor; }),
            sql("select depois from chaves_historico where chave = 'venda.exigir_cliente' order by id desc limit 1")[0].depois], [['1'], '1']);
        confere('a tela mostra que vale "desta empresa"', (await p.locator('.tabela-regras tr', { hasText: 'Venda só com cliente' }).innerText())
            .indexOf('desta empresa') !== -1, true);
        await H.print(p, 'pdv-6-admin-regras');
        await H.apiNa(p, 'POST', '/chaves', { chave: 'venda.exigir_cliente', escopo: 'empresa', valor: null });
    });

    H.terminar('pdv');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
