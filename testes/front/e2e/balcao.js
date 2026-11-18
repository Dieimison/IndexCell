// balcao.js - perfil balcao (R2 itens 17, 20, 27): usuario novo cai na troca de senha;
// sem financeiro, sem custo/lucro em vendas, sem cancelar venda paga, sem Excluir;
// custo visivel nas Entradas; "Brinde" em Movimentar estoque; venda de R$ 0 recusada pelo servidor.
'use strict';
const H = require('./lib');
const { L, sql, confere } = H;

(async function () {
    const navegador = await H.chromium.launch();
    const ctxAdmin = await H.novoContexto(navegador);
    const adm = await H.novaPagina(ctxAdmin, 'admin');
    await H.entrar(adm, 'admin', H.SENHA_ADMIN);

    const login = 'balcao' + String(Date.now()).slice(-5);
    const provisoria = 'Provisoria-' + String(Date.now()).slice(-6) + 'x';
    const definitiva = 'Balcao-Loja-' + String(Date.now()).slice(-6);
    const u = await H.apiNa(adm, 'POST', '/usuarios', { usuario: login, nome: 'Balcão E2E', perfil: 'balcao', senha: provisoria, ativo: 1 });
    const ent = await H.apiNa(adm, 'POST', '/entradas', { tipo: 'peca', peca_nome: 'Película e2e ' + login, peca_categoria: 'outra',
        quantidade: 5, valor_investimento: 10, valor_venda: 30, gerar_conta_pagar: '' });
    L('massa: usuario ' + login + ' (' + u.status + '), entrada ' + ent.id + ' (' + ent.status + ')');

    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'balcao');

    await H.bloco('Usuario criado pelo admin troca a senha no primeiro acesso', async function () {
        await H.entrar(p, login, provisoria);
        confere('janela "Troque sua senha"', await p.evaluate(function () {
            return !document.getElementById('trocaSenha').classList.contains('oculta');
        }), true);
        await p.fill('#trocaAtual', provisoria);
        await p.fill('#trocaNova', definitiva);
        await p.fill('#trocaConfirma', definitiva);
        await p.click('#formTrocaSenha button[type="submit"]'); await p.waitForTimeout(1500);
    });

    const visivel = function (sel) {
        return p.evaluate(function (s) { const e = document.querySelector(s); return !!e && e.offsetParent !== null; }, sel);
    };

    await H.bloco('Sem financeiro, sem relatorios e sem Excluir', async function () {
        confere('menu Financeiro / KPIs / DRE', [await visivel('nav a[data-secao="financeiro"]'), await visivel('#kpisRelatorio'),
                                                 await visivel('#tabelaDre')], [false, false, false]);
        for (const s of ['entradas', 'os', 'vendas', 'cadastros']) {
            await H.secao(p, s);
            confere('botoes Excluir visiveis em ' + s, await p.evaluate(function () {
                return Array.from(document.querySelectorAll('button')).filter(function (b) {
                    return /Excluir|Desfazer/.test(b.textContent) && b.offsetParent !== null;
                }).length;
            }), 0);
        }
        await H.print(p, 'balcao-painel');
    });

    await H.bloco('Forma de pagamento: o balcao nao ve "Usar como padrão nas vendas"', async function () {
        await H.secao(p, 'cadastros');
        await p.click('#subAbasCadastros [data-cadastro="formas"]'); await p.waitForTimeout(400);
        await p.click('#botaoNovoCadastro'); await p.waitForTimeout(500);
        confere('sem o interruptor na forma nova', await p.locator('#campo-padrao').count(), 0);
        await p.click('#modalCancelar');
        await p.click('[data-acao="editar-cadastro"]'); await p.waitForTimeout(500);
        confere('sem o interruptor ao editar', await p.locator('#campo-padrao').count(), 0);
        await p.click('#modalCancelar');
        await p.click('#subAbasCadastros [data-cadastro="clientes"]'); await p.waitForTimeout(300);
    });

    await H.bloco('OS entregue e paga: o balcao le que so o admin reabre', async function () {
        await H.secao(p, 'os');
        await p.click('[data-acao="nova-os"]'); await p.waitForTimeout(500);
        await p.selectOption('#campo-cliente_id', { index: 1 });
        await p.selectOption('#campo-modelo_id', { index: 1 });
        await p.fill('#campo-valor_mao_obra', '50');
        await p.selectOption('[data-pag-forma]', { index: 1 });
        await H.salvar(p);
        const os = sql('select max(id) id from ordens_servico')[0].id;
        await p.click('[data-acao="editar-os"][data-id="' + os + '"]'); await p.waitForTimeout(800);
        await p.selectOption('#campo-status', 'entregue');
        await H.salvar(p);
        // O admin da baixa no que a OS gerou a receber: agora ela esta entregue E paga.
        const aReceber = sql("select id from lancamentos where tipo='receber' and status='pendente' and " +
                             '(os_id=' + os + ' or venda_id=(select venda_id from ordens_servico where id=' + os + '))');
        for (const l of aReceber) await H.apiNa(adm, 'PUT', '/lancamentos/' + l.id, { status: 'pago' });
        L('  OS ' + os + ': ' + JSON.stringify(sql('select status, venda_id from ordens_servico where id=' + os)[0]) +
          ', baixas dadas pelo admin: ' + aReceber.length);
        await p.click('[data-acao="editar-os"][data-id="' + os + '"]'); await p.waitForTimeout(800);
        confere('frase no lugar do select de status', [await p.locator('#campo-status').count(),
            (await p.locator('#modalCorpo').innerText()).includes('Só o administrador pode reabrir uma OS entregue e paga.')], [0, true]);
        await H.print(p, 'balcao-os-entregue-paga');
        await p.click('#modalCancelar');
    });

    await H.bloco('Entradas mostram o custo (o balcao cadastra entrada)', async function () {
        await H.secao(p, 'entradas');
        confere('coluna "Custo un."', await p.evaluate(function () {
            return Array.from(document.querySelectorAll('#listaEntradas th')).some(function (t) { return t.textContent === 'Custo un.'; });
        }), true);
    });

    await H.bloco('Venda paga: sem custo/lucro e sem cancelar', async function () {
        // ADAPTADO-v7: venda nova so pelo PDV (a janela "Nova venda" saiu).
        await p.keyboard.press('F2'); await p.waitForTimeout(1200);
        await p.fill('#pdvBusca', 'Película e2e ' + login);
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        await p.keyboard.press('F10'); await p.waitForTimeout(1500);
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        await p.click('[data-pdv="sair"]'); await p.waitForTimeout(800);
        await H.secao(p, 'vendas');
        const venda = sql('select max(id) id from vendas')[0].id;
        confere('lista sem coluna Lucro', await p.evaluate(function () {
            return Array.from(document.querySelectorAll('#listaVendas th')).map(function (t) { return t.textContent; }).indexOf('Lucro');
        }), -1);
        await p.click('[data-acao="editar-venda"][data-id="' + venda + '"]'); await p.waitForTimeout(500);
        confere('Editar sem o campo Situação (nao cancela venda paga)', await p.locator('#campo-status').count(), 0);
        await p.click('#modalCancelar');
        await p.click('[data-acao="ver-venda"][data-id="' + venda + '"]'); await p.waitForTimeout(600);
        confere('Ver venda sem custo e lucro', (await p.locator('#modalCorpo').innerText()).indexOf('Custo dos itens'), -1);
        await p.keyboard.press('Escape');
    });

    await H.bloco('Venda de R$ 0,00: o PDV nao fecha e o servidor recusa do mesmo jeito', async function () {
        // ADAPTADO-v7: no PDV, com a mensagem na tela; e pela API, sem a tela.
        const antes = sql('select count(*) n from vendas')[0].n;
        await p.keyboard.press('F2'); await p.waitForTimeout(1200);
        await p.fill('#pdvBusca', 'Película e2e ' + login);
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        await p.fill('[data-pdv-campo="preco"]', '0'); await p.waitForTimeout(200);
        await p.click('#pdvFinalizar'); await p.waitForTimeout(800);
        const msg = await p.locator('#pdvErro').innerText();
        L('  mensagem: "' + msg + '"');
        const direto = await H.apiNa(p, 'POST', '/vendas', { itens: [{ entrada_id: ent.id, quantidade: 1, valor_unitario: 0 }] });
        confere('PDV avisa, servidor recusa (400), nada gravado', [/R\$ 0,00/.test(msg), direto.status, sql('select count(*) n from vendas')[0].n],
                [true, 400, antes]);
        await p.click('[data-pdv="remover"][data-n="0"]');
        await p.click('[data-pdv="sair"]'); await p.waitForTimeout(800);
    });

    await H.bloco('Dois celulares do mesmo modelo: a lista da venda mostra o IMEI de cada um', async function () {
        const luhn = function (base14) {
            let soma = 0;
            base14.split('').forEach(function (c, i) { let d = Number(c); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } soma += d; });
            return base14 + String((10 - soma % 10) % 10);
        };
        const sufixo = String(Date.now()).slice(-6);
        const m = await H.apiNa(adm, 'POST', '/modelos', { marca: 'Marca', modelo: 'Gemeo ' + sufixo, armazenamento: '64GB' });
        const imeiA = luhn('35' + sufixo + '654321');
        const a = await H.apiNa(adm, 'POST', '/entradas', { tipo: 'celular', modelo_id: m.id, imei: imeiA, cor: 'Preto',
            situacao: 'processamento', valor_investimento: 300, valor_venda: 600, gerar_conta_pagar: '' });
        const b = await H.apiNa(adm, 'POST', '/entradas', { tipo: 'celular', modelo_id: m.id, imei: '', cor: 'Azul',
            situacao: 'processamento', valor_investimento: 300, valor_venda: 600, gerar_conta_pagar: '' });
        L('  massa: modelo ' + m.status + ', com IMEI ' + a.id + ' (' + a.status + '), sem IMEI ' + b.id + ' (' + b.status + ')');
        // ADAPTADO-v7: a lista de escolha agora e a do PDV.
        await p.reload(); await p.waitForTimeout(1200);
        await p.keyboard.press('F2'); await p.waitForTimeout(1200);
        await p.fill('#pdvBusca', 'Gemeo ' + sufixo); await p.waitForTimeout(400);
        const rotulo = function (id) {
            return p.evaluate(function (v) {
                const o = document.querySelector('[data-pdv="adicionar"][data-chave="e' + v + '"] .resultado-detalhe');
                return o ? o.textContent : null;
            }, String(id));
        };
        const ra = await rotulo(a.id);
        const rb = await rotulo(b.id);
        L('  com IMEI: "' + ra + '" | sem IMEI: "' + rb + '"');
        confere('com IMEI: o IMEI na opcao', !!ra && ra.indexOf('IMEI ' + imeiA) !== -1, true);
        confere('sem IMEI: a cor e o numero da entrada', !!rb && rb.indexOf('Azul') !== -1 && rb.indexOf('entrada nº ' + b.id) !== -1, true);
        confere('as duas opcoes nao sao iguais', ra !== rb, true);
        await H.print(p, 'balcao-celulares-com-imei');
        await p.click('[data-pdv="sair"]'); await p.waitForTimeout(800);
    });

    await H.bloco('Movimentar estoque oferece "Brinde / cortesia"', async function () {
        await H.secao(p, 'cadastros');
        await p.click('[data-acao="nova-movimentacao"]'); await p.waitForTimeout(800);
        const motivos = await p.evaluate(function () {
            return Array.from(document.querySelectorAll('#campo-motivo option')).map(function (o) { return o.value + '=' + o.textContent; });
        });
        L('  motivos: ' + JSON.stringify(motivos));
        const brinde = motivos.find(function (m) { return /brinde|cortesia/i.test(m); });
        confere('tem brinde/cortesia', !!brinde, true);
        if (brinde) {
            await p.selectOption('#campo-entrada_id', String(ent.id));
            await p.selectOption('#campo-motivo', brinde.split('=')[0]);
            confere('lado do brinde = saida', await p.inputValue('#campo-tipo'), 'saida');
            await H.salvar(p);
            confere('movimentacao gravada', sql("select count(*) n from movimentacoes where entrada_id=" + ent.id +
                                                " and motivo='" + brinde.split('=')[0] + "'")[0].n, 1);
        }
    });

    H.terminar('balcao');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
