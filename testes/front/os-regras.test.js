/*
 * os-regras.test.js - a regra da mao de obra e do valor final da OS.
 *
 * Roda a MESMA tabela que o teste PHP do servidor: testes\casos\mao-de-obra.json
 * (array de { nome, entrada: {orcamento, pecas, servicos, mao_digitada,
 * final_digitado}, esperado: {mao, final}, edicao?: {gravado: {mao, final}} }).
 * Caso com "edicao": a OS gravada foi reaberta; "entrada" e o que a pessoa
 * mexeu depois (null = nao mexeu) e o resto vem de digitadosIniciais - a
 * mesma funcao que a tela usa ao abrir. Se a tabela nao existir, o teste
 * FALHA: sem ela nao ha prova de que front e servidor fazem a mesma conta.
 *
 * Depois, os casos que so a tela tem (as tres variantes do A1 da banca).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../../Dashboard/os-regras.js');
const { caso, igual, fim } = require('./caso');

const TABELA = path.join(__dirname, '..', 'casos', 'mao-de-obra.json');

console.log('os-regras: tabela compartilhada ' + path.relative(path.join(__dirname, '..', '..'), TABELA));

let casos = [];
caso('a tabela existe e tem casos', function () {
    if (!fs.existsSync(TABELA)) throw new Error('nao achei ' + TABELA + ' (quem cria e o backend)');
    casos = JSON.parse(fs.readFileSync(TABELA, 'utf8'));
    if (!Array.isArray(casos) || !casos.length) throw new Error('a tabela esta vazia');
});

casos.forEach(function (c) {
    caso(c.nome, function () {
        const entrada = c.edicao
            ? R.comDigitadosIniciais(c.entrada, R.digitadosIniciais(true, c.edicao.gravado))
            : c.entrada;
        const r = R.calcularValoresOs(entrada);
        igual({ mao: r.mao, final: r.final }, { mao: c.esperado.mao, final: c.esperado.final });
    });
});

caso('a tabela tem casos de edicao (reabrir a OS)', function () {
    if (!casos.some(function (c) { return c.edicao; })) throw new Error('nenhum caso com "edicao"');
});

console.log('os-regras: o que conta como digitado ao abrir (digitadosIniciais)');

caso('OS nova: nada digitado', function () {
    igual(R.digitadosIniciais(false, { mao: '120', final: '250' }), { mao_digitada: null, final_digitado: null });
});
caso('OS gravada: mao e final gravados contam como digitados', function () {
    igual(R.digitadosIniciais(true, { mao: '120.00', final: '250.00' }), { mao_digitada: '120.00', final_digitado: '250.00' });
});
caso('OS gravada com campo vazio: aquele nao conta', function () {
    igual(R.digitadosIniciais(true, { mao: '', final: '0' }), { mao_digitada: null, final_digitado: '0' });
});
caso('A1 (final 250 gravado): mexer no orcamento depois de abrir nao recalcula o final', function () {
    const ini = R.digitadosIniciais(true, { mao: '300.00', final: '250.00' });
    igual(R.calcularValoresOs(R.comDigitadosIniciais({ orcamento: 350, pecas: 0, servicos: 0,
        mao_digitada: null, final_digitado: null }, ini)), { mao: 300, final: 250 });
});

console.log('os-regras: casos da tela (A1)');

const oS = function (orcamento, pecas, servicos, mao, final) {
    return R.calcularValoresOs({ orcamento: orcamento, pecas: pecas, servicos: servicos,
                                 mao_digitada: mao, final_digitado: final });
};

caso('A1: mao de obra 120 sem orcamento -> 120/120', function () {
    igual(oS(0, 0, 0, 120, null), { mao: 120, final: 120 });
});
caso('A1: orcamento 300 e final 250 digitado -> sugere mao 300, final fica 250', function () {
    igual(oS(300, 0, 0, null, 250), { mao: 300, final: 250 });
});
caso('A1: orcamento 300 e mao 200 digitada -> 200/200', function () {
    igual(oS(300, 0, 0, 200, null), { mao: 200, final: 200 });
});
caso('OS gravada reaberta: o gravado conta como digitado e nada muda', function () {
    igual(oS(300, 50, 0, 200, 250), { mao: 200, final: 250 });
});
caso('servicos lancados mandam na mao de obra, mesmo com mao digitada', function () {
    igual(oS(300, 40, 80, 999, null), { mao: 80, final: 120 });
});
caso('sem nada alem do orcamento: final cai no orcamento', function () {
    igual(oS(300, 400, 0, null, null), { mao: 0, final: 400 });
    igual(oS(0, 0, 0, null, null), { mao: 0, final: 0 });
    igual(oS(150, 0, 0, 0, null), { mao: 0, final: 150 });
});
caso('zero digitado e valor, nao "vazio"', function () {
    igual(oS(300, 0, 0, null, 0), { mao: 300, final: 0 });
});
caso('centavos: 33,33 + 66,67 = 100,00 exato', function () {
    igual(oS(0, 33.33, 0, 66.67, null), { mao: 66.67, final: 100 });
});

fim();
