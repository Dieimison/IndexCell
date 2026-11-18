// dre.test.js - a formula do resultado que o painel mostra (Dashboard/dre.js).
'use strict';
const D = require('../../Dashboard/dre.js');
const { caso, igual, perto, fim } = require('./caso');

function dia(data, campos) {
    return Object.assign({ dia: data }, campos);
}

/*
 * Um mes de loja, escrito a mao, no formato da serie diaria da API:
 *   05/03  venda de balcao 1000 (custo 600), 1 venda
 *   10/03  venda GERADA POR OS 300 (custo 100) - a API ja manda em receita_os
 *   12/03  OS antiga, sem venda, 200 (custo 50) - tambem em receita_os
 *   15/03  aluguel 400 (despesa manual) e 1300 pagos no caixa
 *   20/03  recebido 1300
 */
const MARCO = [
    dia('2026-03-05', { receita_vendas: 1000, custo_vendas: 600, quantidade: 1 }),
    dia('2026-03-10', { receita_os: 300, custo_os: 100, qtd_os: 1 }),
    dia('2026-03-12', { receita_os: 200, custo_os: 50, qtd_os: 1 }),
    dia('2026-03-15', { despesas: 400, pago: 1300 }),
    dia('2026-03-20', { recebido: 1300 }),
];
const tot = function (linhas, de, ate, origem) { return D.totalizar(D.agregarPeriodo(linhas, de, ate, origem)); };

console.log('dre');

caso('mes inteiro: receita, custo, despesas, lucro bruto e liquido, margem, ticket', function () {
    const t = tot(MARCO, '2026-03-01', '2026-03-31', '');
    igual([t.receita, t.custo, t.lucro_bruto, t.despesas, t.lucro_liquido, t.quantidade],
          [1500, 750, 750, 400, 350, 3]);
    perto(t.margem, 23.333, 'margem = 350 / 1500');
    perto(t.ticket_medio, 500, 'ticket = 1500 / 3');
});

caso('venda gerada por OS: soma uma vez, fica em "os" e nao em "balcao"', function () {
    igual([tot([MARCO[1]], '2026-03-01', '2026-03-31', '').receita,
           tot([MARCO[1]], '2026-03-01', '2026-03-31', 'balcao').receita,
           tot([MARCO[1]], '2026-03-01', '2026-03-31', 'os').receita], [300, 0, 300]);
});

caso('despesas: so a coluna "despesas"; o que foi pago no caixa nao vira despesa', function () {
    const t = tot([MARCO[3]], '2026-03-01', '2026-03-31', '');
    igual([t.despesas, t.lucro_liquido], [400, -400]);
    const caixa = D.agregarPeriodo(MARCO, '2026-03-01', '2026-03-31', '').reduce(function (s, b) { return s + b.caixa; }, 0);
    igual(caixa, 0, 'caixa = recebido 1300 - pago 1300');
});

caso('filtrado por origem: sem despesas, lucro bruto daquela origem', function () {
    const b = tot(MARCO, '2026-03-01', '2026-03-31', 'balcao');
    const o = tot(MARCO, '2026-03-01', '2026-03-31', 'os');
    igual([b.receita, b.custo, b.despesas, b.lucro_liquido, b.quantidade], [1000, 600, 0, 400, 1]);
    igual([o.receita, o.custo, o.despesas, o.lucro_liquido, o.quantidade], [500, 150, 0, 350, 2]);
});

caso('dia fora do intervalo fica de fora', function () {
    const t = tot(MARCO, '2026-03-11', '2026-03-31', '');
    igual([t.receita, t.despesas], [200, 400]);
});

caso('sem receita: margem e ticket zero (nao NaN)', function () {
    const t = tot([], '2026-03-01', '2026-03-31', '');
    igual([t.margem, t.ticket_medio, t.receita], [0, 0, 0]);
});

caso('centavos: 0,10 + 0,20 da 0,30', function () {
    igual(tot([dia('2026-03-01', { receita_vendas: 0.1 }), dia('2026-03-02', { receita_vendas: 0.2 })],
              '2026-03-01', '2026-03-31', '').receita, 0.3);
});

caso('granularidade: ate 45 dias por dia, ate 180 por semana, depois por mes', function () {
    igual([D.granularidadeDe('2026-03-01', '2026-04-15'), D.granularidadeDe('2026-03-01', '2026-04-16'),
           D.granularidadeDe('2026-01-01', '2026-06-30'), D.granularidadeDe('2026-01-01', '2026-07-01')],
          ['dia', 'semana', 'semana', 'mes']);
    igual(D.agregarPeriodo([], '2026-03-01', '2026-03-31', '').length, 31);
    igual(D.agregarPeriodo([], '2025-11-01', '2026-10-27', '').length, 12);
});

caso('serie mensal nao pula fevereiro', function () {
    igual(D.agregarPeriodo([], '2025-08-31', '2026-03-31', '').map(function (b) { return b.mes; }).join(','),
          '2025-08,2025-09,2025-10,2025-11,2025-12,2026-01,2026-02,2026-03');
});

caso('semana: o dia cai no balde da semana certa', function () {
    const com = D.agregarPeriodo([dia('2026-03-09', { receita_vendas: 50 })], '2026-01-01', '2026-04-30', '')
        .filter(function (b) { return b.receita > 0; });
    igual([com.length, com[0].mes], [1, '2026-03-05']);
});

fim();
