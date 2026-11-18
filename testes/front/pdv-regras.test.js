/*
 * pdv-regras.test.js - as contas do PDV (Dashboard/pdv-regras.js).
 *
 * O limite de desconto tem de dar o MESMO que o servidor
 * (conferirRegrasDaVenda): os casos de fronteira daqui sao os mesmos do
 * testes\regras-listas.test.php (10% de R$ 100,00: 10,00 passa, 10,01 nao).
 * Os valores esperados sao escritos a mao.
 */
'use strict';
const R = require('../../Dashboard/pdv-regras.js');
const { caso, igual, fim } = require('./caso');

console.log('pdv-regras: contas do caixa');

caso('lerReais aceita virgula, ponto e milhar; vazio e lixo = 0', function () {
    igual([R.lerReais('12,50'), R.lerReais('12.5'), R.lerReais('1.234,56'), R.lerReais(''), R.lerReais('abc'), R.lerReais(7)],
          [12.5, 12.5, 1234.56, 0, 0, 7]);
});

caso('totais em centavos: 3 x 33,33 = 99,99', function () {
    igual(R.totais([{ preco: 33.33, quantidade: 3 }], 0, 'reais'), { bruto: 9999, desconto: 0, total: 9999, percentual: 0 });
});

caso('desconto em reais', function () {
    igual(R.totais([{ preco: '35', quantidade: 2 }, { preco: 60, quantidade: 1 }], '13', 'reais'),
          { bruto: 13000, desconto: 1300, total: 11700, percentual: 10 });
});

caso('desconto em % arredonda no centavo (10% de 99,99 = 10,00)', function () {
    igual(R.totais([{ preco: 33.33, quantidade: 3 }], '10', 'porcento').desconto, 1000);
});

caso('desconto nunca passa do bruto nem fica negativo', function () {
    igual([R.totais([{ preco: 50, quantidade: 1 }], 80, 'reais').total, R.totais([{ preco: 50, quantidade: 1 }], -5, 'reais').desconto,
           R.totais([{ preco: 50, quantidade: 1 }], 150, 'porcento').total], [0, 0, 0]);
});

caso('limite de desconto = o do servidor: 10% de R$ 100 -> 10,00 passa, 10,01 nao', function () {
    igual([R.descontoNoLimite(10000, 1000, 10, false).ok, R.descontoNoLimite(10000, 1001, 10, false).ok,
           R.descontoNoLimite(10000, 1000, 10, false).maximo], [true, false, 1000]);
});

caso('limite 100 = sem limite; admin nunca tem limite', function () {
    igual([R.descontoNoLimite(10000, 10000, 100, false).ok, R.descontoNoLimite(10000, 9000, 5, true).ok], [true, true]);
});

caso('troco: recebido - total; vazio = null; falta = negativo', function () {
    igual([R.troco(11700, '200'), R.troco(11700, ''), R.troco(11700, '100,00')], [8300, null, -1700]);
});

const itens = [
    { tipo: 'celular', procura: 'Apple iPhone 13 128GB 356000301591046 Preto', exatos: ['356000301591046'] },
    { tipo: 'produto', procura: 'Película 3D cód. PEL3D', exatos: ['PEL3D'] },
    { tipo: 'peca', procura: 'Tela iPhone 13 cód. 356000301591046', exatos: [] },
    { tipo: 'produto', procura: 'Capa antichoque Azul', exatos: [] },
];

caso('busca sem acento e sem caixa: "pelicula" acha "Película"', function () {
    igual(R.buscar(itens, 'PELICULA', 'todos').map(function (i) { return i.procura; }), ['Película 3D cód. PEL3D']);
});

caso('busca exige todas as palavras', function () {
    igual(R.buscar(itens, 'iphone tela', 'todos').length, 1);
});

caso('IMEI digitado inteiro vem primeiro (leitor de codigo)', function () {
    igual(R.buscar(itens, '356000301591046', 'todos')[0].tipo, 'celular');
});

caso('filtro por tipo', function () {
    igual(R.buscar(itens, '', 'produto').length, 2);
});

fim();
