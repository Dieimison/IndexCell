// formato.test.js - escapar, dinheiro em centavos e datas (Dashboard/formato.js).
'use strict';
const F = require('../../Dashboard/formato.js');
const { caso, igual, fim } = require('./caso');

console.log('formato: escapar');

caso('escapa & < > " \' (texto e atributo)', function () {
    igual(F.escapar('a & b < c > d " e \' f'), 'a &amp; b &lt; c &gt; d &quot; e &#39; f');
});

caso('nome com aspas nao fecha o atributo (item 11)', function () {
    const html = '<input value="' + F.escapar('x" autofocus onfocus="alert(1)') + '">';
    igual(html, '<input value="x&quot; autofocus onfocus=&quot;alert(1)">');
});

caso('nulo e indefinido viram texto vazio; numero vira texto', function () {
    igual([F.escapar(null), F.escapar(undefined), F.escapar(0)], ['', '', '0']);
});

console.log('formato: dinheiro');

caso('moeda no formato brasileiro', function () {
    const m = function (v) { return F.moeda(v).replace(/\s/g, ' '); };
    igual([m(1234.5), m(0), m(-80), m('abc'), m(null)],
          ['R$ 1.234,50', 'R$ 0,00', '-R$ 80,00', 'R$ 0,00', 'R$ 0,00']);
});

caso('emCentavos devolve INTEIRO; aceita virgula; lixo vira 0', function () {
    igual([F.emCentavos(33.33), F.emCentavos('19,99'), F.emCentavos(0.1 + 0.2), F.emCentavos('x'), F.emCentavos(null)],
          [3333, 1999, 30, 0, 0]);
});

caso('arredondarCentavo devolve reais: 0,1 + 0,2 = 0,3', function () {
    igual(F.arredondarCentavo(0.1 + 0.2), 0.3);
});

caso('somarEmCentavos: 33,33 tres vezes = 99,99 exato', function () {
    igual(F.somarEmCentavos([{ v: 33.33 }, { v: 33.33 }, { v: 33.33 }], function (x) { return x.v; }), 99.99);
});

caso('porcento com uma casa e virgula', function () {
    igual([F.porcento(23.3333), F.porcento(0)], ['23,3%', '0%']);
});

console.log('formato: datas');

caso('dataCurta, dataBr, mesAno, horaCurta, rotuloMes', function () {
    igual([F.dataCurta('2026-03-05 10:11:12'), F.dataCurta(''), F.dataBr('2026-03-05'),
           F.mesAno('2026-03'), F.horaCurta('2026-03-05 14:07:00'), F.rotuloMes('2026-03')],
          ['05/03/2026', '—', '05/03', '03/2026', '14:07', 'mar/26']);
});

caso('somarDias vira o mes; diasEntre conta 30 em marco', function () {
    igual([F.somarDias('2026-02-28', 1), F.diasEntre('2026-03-01', '2026-03-31')], ['2026-03-01', 30]);
});

caso('hoje() e o dia LOCAL (23h30 local continua o mesmo dia)', function () {
    igual(F.hoje(new Date(2026, 9, 27, 23, 30)), '2026-10-27');
});

fim();
