// loja.js - loja online (v8), de ponta a ponta pela tela: o admin abre a loja e
// posta o anuncio (com foto); o cliente, no celular, cria a conta, encomenda e ve
// o Pix; o admin confirma o pagamento e avanca a entrega; o cliente ve o rastreio.
// Sessao do cliente e do painel nao se misturam. Desligar a loja.js deixa vermelho.
'use strict';
const H = require('./lib');
const { L, confere } = H;

function imeiValido(base14) {
    let soma = 0;
    base14.split('').forEach(function (c, i) {
        let d = Number(c);
        if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
        soma += d;
    });
    return base14 + String((10 - soma % 10) % 10);
}

/** Pagina mais larga que a tela (a medida do responsivo.js). */
function larguraDaPagina(p) {
    return p.evaluate(function () { return Math.max(document.documentElement.scrollWidth, window.innerWidth); });
}

async function abrirEncomendaNoPainel(p) {
    await p.goto(H.BASE + '/Dashboard/dashboard.html#loja');
    await p.waitForTimeout(1000);
    await p.click('[data-aba-loja="encomendas"]');   // a mesma URL nao recarrega: a aba pode ser outra
    await p.waitForSelector('[data-abrir-encomenda]');
    await p.waitForTimeout(300);
    await p.click('[data-abrir-encomenda]');
    await p.waitForTimeout(700);
}

(async function () {
    const navegador = await H.chromium.launch();
    const sufixo = String(Date.now()).slice(-6);
    const emailCliente = 'cliente' + sufixo + '@teste.com';

    // ---------------- admin: estoque, ajustes e anuncio ----------------
    const ctxAdmin = await H.novoContexto(navegador);
    const adm = await H.novaPagina(ctxAdmin, 'loja-admin');
    await H.entrar(adm, 'admin', H.SENHA_ADMIN);
    let celularId = null;

    await H.bloco('admin: estoque para anunciar', async function () {
        const m = await H.apiNa(adm, 'POST', '/modelos', { marca: 'Apple', modelo: 'iPhone 14 Loja ' + sufixo, armazenamento: '128GB' });
        const cel = await H.apiNa(adm, 'POST', '/entradas', { tipo: 'celular', modelo_id: m.id, imei: imeiValido('35' + sufixo + '654321'),
            cor: 'Preto', condicao: 'seminovo', situacao: 'ready', valor_investimento: 2000, valor_venda: 3200, gerar_conta_pagar: '' });
        const capa = await H.apiNa(adm, 'POST', '/entradas', { tipo: 'produto', produto_nome: 'Capa Loja E2E', quantidade: 8,
            valor_investimento: 8, valor_venda: 35, gerar_conta_pagar: '' });
        celularId = cel.id;
        confere('entradas criadas', [m.status, cel.status, capa.status], [201, 201, 201]);
        const an = await H.apiNa(adm, 'POST', '/anuncios', { entrada_id: capa.id, titulo: 'Capa de silicone E2E' });
        confere('anuncio da capa pela API', an.status, 201);
    });

    await H.bloco('admin: Loja online > Ajustes abre a loja (sem chave Pix e recusado)', async function () {
        await H.secao(adm, 'loja');
        await adm.click('[data-aba-loja="ajustes"]');
        await adm.waitForSelector('#formLojaAjustes');
        await adm.click('label.interruptor:has(#loja-aberta)');
        await adm.click('#formLojaAjustes button[type="submit"]');
        await adm.waitForTimeout(700);
        const avisos = await adm.evaluate(function () { return window.__avisos.slice(-1)[0]; });
        confere('sem chave: recusado', avisos, 'Para abrir a loja online, informe a chave PIX: é por ela que o cliente paga.');
        await adm.fill('#loja-chave_pix', 'pix@loja-e2e.com');
        await adm.fill('#loja-recebedor_pix', 'Loja E2E');
        await adm.fill('#loja-cidade_origem', 'Curitiba/PR');
        await adm.fill('#loja-frete_fixo', '20');
        await adm.fill('#loja-frete_gratis_acima', '500');
        await adm.click('#formLojaAjustes button[type="submit"]');
        await adm.waitForTimeout(900);
        confere('loja aberta no banco', H.sql('SELECT aberta, chave_pix FROM loja_ajustes')[0], { aberta: 1, chave_pix: 'pix@loja-e2e.com' });
    });

    await H.bloco('admin: + Novo anuncio do celular, com foto reduzida na tela', async function () {
        await adm.click('[data-aba-loja="anuncios"]');
        await adm.waitForSelector('[data-novo-anuncio]');
        await adm.click('[data-novo-anuncio]');
        await adm.waitForTimeout(500);
        await adm.selectOption('#campo-entrada_id', String(celularId));
        confere('titulo e preco sugeridos do estoque', [await adm.inputValue('#campo-titulo'), await adm.inputValue('#campo-preco')],
                ['Apple iPhone 14 Loja ' + sufixo + ' 128GB', '3200.00']);
        await adm.fill('#campo-preco', '2999.90');
        await adm.fill('#campo-descricao', 'Bateria 92%, sem marcas de uso.');
        const imagem = await adm.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 900, height: 900 } });   // uma "foto" grande
        await adm.setInputFiles('#lojaArquivos', { name: 'foto.png', mimeType: 'image/png', buffer: imagem });
        await adm.waitForTimeout(900);
        confere('previa da foto na janela', await adm.locator('#lojaFotos .loja-foto').count(), 1);
        await H.salvar(adm);
        const a = H.sql("SELECT a.preco, a.publicado, f.tipo, length(f.dados) < 1000000 AS pequena FROM anuncios a JOIN anuncio_fotos f ON f.anuncio_id = a.id WHERE a.entrada_id = " + celularId);
        confere('anuncio e foto no banco (JPG, < 1 MB)', a, [{ preco: 2999.9, publicado: 1, tipo: 'image/jpeg', pequena: 1 }]);
        await H.print(adm, 'loja-admin-anuncios');
    });

    // ---------------- cliente no celular ----------------
    const ctxCli = await navegador.newContext({ locale: 'pt-BR', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctxCli.route('https://viacep.com.br/**', function (rota) { return rota.abort(); });   // sem internet no teste
    const cli = await H.novaPagina(ctxCli, 'loja-cliente');

    await H.bloco('cliente: vitrine no celular, com a foto e sem rolagem de lado', async function () {
        await cli.goto(H.BASE + '/loja');
        await cli.waitForTimeout(1200);
        confere('endereco curto leva a vitrine', /\/Loja\/index\.html/.test(cli.url()), true);
        confere('2 produtos na vitrine', await cli.locator('.produto').count(), 2);
        const foto = await cli.evaluate(function () {
            const img = document.querySelector('.produto .produto-img[src]');
            return img ? img.complete && img.naturalWidth > 0 : false;
        });
        confere('foto do anuncio carregou', foto, true);
        confere('largura da pagina', await larguraDaPagina(cli), 390);
        await H.print(cli, 'loja-cliente-vitrine');
    });

    await H.bloco('cliente: carrinho -> finalizar pede conta -> criar conta volta para finalizar', async function () {
        await cli.click('.produto:has-text("iPhone 14") [data-adicionar]');
        await cli.click('.produto:has-text("iPhone 14") [data-adicionar]');   // de novo: e um aparelho so
        confere('contador do carrinho', await cli.textContent('#contadorCarrinho'), '1');
        await cli.click('.topo-carrinho');
        await cli.waitForTimeout(500);
        confere('frete gratis acima de R$ 500', await cli.textContent('.resumo dl div:nth-child(2) dd'), 'Grátis');
        await cli.click('[data-finalizar]');
        await cli.waitForTimeout(600);
        confere('sem conta: tela de entrar', cli.url().endsWith('#/entrar'), true);
        await cli.click('a[href="#/criar-conta"]');
        await cli.waitForTimeout(300);
        await cli.fill('#contaNome', 'Cliente E2E Loja');
        await cli.fill('#contaEmail', emailCliente);
        await cli.fill('#contaTelefone', '(41) 98888-7777');
        await cli.fill('#contaSenha', 'Compra-Segura-2026');
        await cli.fill('#contaSenha2', 'Compra-Segura-2026x');
        await cli.click('#formCriarConta button[type="submit"]');
        await cli.waitForTimeout(300);
        confere('senhas diferentes avisadas', await cli.textContent('#erroConta'), 'As duas senhas não são iguais.');
        await cli.fill('#contaSenha2', 'Compra-Segura-2026');
        await cli.click('#formCriarConta button[type="submit"]');
        await cli.waitForTimeout(1200);
        confere('conta criada e de volta ao finalizar', cli.url().endsWith('#/finalizar'), true);
    });

    await H.bloco('cliente: endereco e confirmar (clique duplo nao duplica)', async function () {
        await cli.fill('#endCep', '80010000');
        confere('CEP com mascara', await cli.inputValue('#endCep'), '80010-000');
        await cli.fill('#endLogradouro', 'Rua XV de Novembro');
        await cli.fill('#endNumero', '100');
        await cli.fill('#endBairro', 'Centro');
        await cli.fill('#endCidade', 'Curitiba');
        await cli.selectOption('#endUf', 'PR');
        await cli.click('#botaoConfirmar');
        await cli.click('#botaoConfirmar', { force: true, timeout: 1000 }).catch(function () { /* ja foi */ });
        await cli.waitForTimeout(1500);
        const enc = H.sql("SELECT e.numero, e.status, e.valor_total, e.entrega_cidade FROM encomendas e JOIN loja_contas c ON c.id = e.conta_id WHERE c.email = '" + emailCliente + "'");
        confere('uma encomenda so', enc.length, 1);
        confere('encomenda gravada', enc[0] && [enc[0].status, enc[0].valor_total, enc[0].entrega_cidade], ['aguardando_pagamento', 2999.9, 'Curitiba']);
        confere('tela do Pix com a chave', await cli.textContent('#chavePix'), 'pix@loja-e2e.com');
        confere('rastreio ainda nao aparece', await cli.locator('.rota').count(), 0);
        confere('largura da pagina', await larguraDaPagina(cli), 390);
        await H.print(cli, 'loja-cliente-pix');
    });

    await H.bloco('sessoes separadas: cliente nao entra no painel, painel nao e cliente', async function () {
        const r1 = await cli.evaluate(async function () { return (await fetch('/api/sessao')).status; });
        const r2 = await adm.evaluate(async function () { return (await fetch('/api/loja/sessao')).status; });
        const r3 = await cli.evaluate(async function () { return (await fetch('/api/encomendas')).status; });
        confere('cliente em /api/sessao, admin em /api/loja/sessao, cliente em /api/encomendas', [r1, r2, r3], [401, 401, 401]);
    });

    // ---------------- admin: pagamento e entrega ----------------
    await H.bloco('admin: confirma o pagamento -> venda no Pix e celular vendido', async function () {
        await abrirEncomendaNoPainel(adm);
        confere('botao da janela', await adm.textContent('#modalSalvar'), 'Confirmar pagamento');
        await adm.fill('#campo-observacao', 'Pix conferido no extrato');
        await H.salvar(adm);
        const e = H.sql("SELECT e.status, v.forma_pagamento, v.valor_total, en.situacao FROM encomendas e JOIN vendas v ON v.id = e.venda_id " +
                        "JOIN entradas en ON en.id = " + celularId + " JOIN loja_contas c ON c.id = e.conta_id WHERE c.email = '" + emailCliente + "'");
        confere('pago, venda Pix e celular vendido', e, [{ status: 'pago', forma_pagamento: 'Pix', valor_total: 2999.9, situacao: 'vendido' }]);
    });

    await H.bloco('admin: avanca separacao -> enviado (com codigo) -> em transito', async function () {
        await abrirEncomendaNoPainel(adm);
        confere('proximo passo', await adm.textContent('#modalSalvar'), 'Avançar para: Em separação');
        await H.salvar(adm);
        await abrirEncomendaNoPainel(adm);
        await adm.fill('#campo-transportadora', 'Correios');
        await adm.fill('#campo-codigo_rastreio', 'QA123456789BR');
        await adm.fill('#campo-local', 'Curitiba/PR');
        await H.salvar(adm);
        await abrirEncomendaNoPainel(adm);
        await adm.fill('#campo-local', 'Centro de distribuição de São José dos Pinhais');
        await H.salvar(adm);
        confere('status no banco', H.sql("SELECT e.status, e.codigo_rastreio FROM encomendas e JOIN loja_contas c ON c.id = e.conta_id WHERE c.email = '" + emailCliente + "'"),
                [{ status: 'em_transito', codigo_rastreio: 'QA123456789BR' }]);
        await H.print(adm, 'loja-admin-encomendas');
    });

    await H.bloco('admin: a venda da loja nao cancela pela tela de Vendas', async function () {
        const venda = H.sql("SELECT e.venda_id FROM encomendas e JOIN loja_contas c ON c.id = e.conta_id WHERE c.email = '" + emailCliente + "'")[0].venda_id;
        const r = await H.apiNa(adm, 'PUT', '/vendas/' + venda, { status: 'cancelada' });
        confere('recusado', [r.status, /Loja online > Encomendas/.test(r.erro || '')], [400, true]);
    });

    // ---------------- cliente: o rastreio ----------------
    await H.bloco('cliente: rastreio linear ate o endereco', async function () {
        await cli.goto(H.BASE + '/Loja/index.html#/encomendas');
        await cli.waitForTimeout(1000);
        await cli.click('.encomenda-linha');
        await cli.waitForTimeout(1000);
        const r = await cli.evaluate(function () {
            const v = document.querySelector('.rota-veiculo');
            return { veiculo: v ? v.style.left : null, feitos: document.querySelectorAll('.passo.feito').length,
                     atual: (document.querySelector('.passo.atual .passo-nome') || {}).textContent,
                     origem: (document.querySelector('.rota-origem .rota-nome') || {}).textContent,
                     destino: (document.querySelector('.rota-destino .rota-nome') || {}).textContent,
                     codigo: (document.querySelector('.codigo code') || {}).textContent,
                     cancelar: !!document.querySelector('[data-cancelar]'), pix: !!document.getElementById('chavePix') };
        });
        confere('rastreio', r, { veiculo: '58%', feitos: 4, atual: 'Em trânsito', origem: 'Curitiba/PR', destino: 'Curitiba/PR',
                                 codigo: 'QA123456789BR', cancelar: false, pix: false });
        confere('largura da pagina', await larguraDaPagina(cli), 390);
        await H.print(cli, 'loja-cliente-rastreio');
    });

    await H.bloco('cliente: sair e entrar de novo (senha errada avisa)', async function () {
        await cli.goto(H.BASE + '/Loja/index.html#/encomendas');
        await cli.waitForTimeout(800);
        await cli.click('[data-sair]');
        await cli.waitForTimeout(800);
        await cli.goto(H.BASE + '/Loja/index.html#/entrar');
        await cli.waitForTimeout(600);
        await cli.fill('#entrarEmail', emailCliente);
        await cli.fill('#entrarSenha', 'Senha-Errada-2026');
        await cli.click('#formEntrar button[type="submit"]');
        await cli.waitForTimeout(900);
        confere('senha errada', await cli.textContent('#erroConta'), 'E-mail ou senha incorretos.');
        await cli.fill('#entrarSenha', 'Compra-Segura-2026');
        await cli.click('#formEntrar button[type="submit"]');
        await cli.waitForTimeout(900);
        confere('entrou', await cli.textContent('#rotuloConta'), 'Cliente');
    });

    await H.bloco('cliente: entra pela tela de login do sistema, aba "Cliente" (e nao ganha o painel)', async function () {
        await cli.evaluate(async function () { await fetch('/api/loja/sair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); });
        await cli.goto(H.BASE + '/Login/index.html#cliente');
        await cli.waitForTimeout(600);
        confere('abre na aba do cliente', [await cli.textContent('.aba-login.ativa'), await cli.textContent('#rotuloUsuario')], ['Cliente', 'E-MAIL']);
        await cli.fill('#username', emailCliente);
        await cli.fill('#password', 'Compra-Segura-2026');
        await cli.click('#loginForm button');
        await cli.waitForURL(/Loja\/index\.html#\/encomendas/, { timeout: 8000 });
        await cli.waitForTimeout(800);
        confere('caiu em Minhas encomendas, logado', [await cli.locator('.encomenda-linha').count(), await cli.textContent('#rotuloConta')], [1, 'Cliente']);
        confere('o painel continua fechado para o cliente', await cli.evaluate(async function () { return (await fetch('/api/sessao')).status; }), 401);
        await cli.goto(H.BASE + '/Login/index.html');
        await cli.waitForTimeout(400);
        await cli.click('.aba-login[data-modo="funcionario"]');
        confere('aba Funcionario volta ao login do painel', [await cli.textContent('#rotuloUsuario'), await cli.inputValue('#username')], ['USUÁRIO', '']);
    });

    await ctxCli.close();
    await ctxAdmin.close();
    await navegador.close();
    H.terminar('loja');
})().catch(function (e) { console.error(e); process.exit(1); });
