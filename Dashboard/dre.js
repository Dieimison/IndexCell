// carga: usa Formato; publica Dre  (conferido por testes/front/carga.test.js)
/*
 * dre.js - a formula do resultado (DRE) que o painel mostra. Window.Dre.
 *
 * Pura e testavel no Node (testes\front\dre.test.js). Depende so do
 * formato.js (datas e centavos).
 *
 * A API manda a serie DIARIA (/api/relatorios, campo "diario") ja com o
 * dinheiro separado por origem, e e isso que impede a dupla contagem:
 *
 *   receita_vendas/custo_vendas/quantidade  venda de BALCAO
 *   receita_os/custo_os/qtd_os              OS: a venda gerada pela OS
 *                                           entregue E a OS antiga sem venda
 *   despesas                                lancamento a pagar MANUAL e o
 *                                           custo do que saiu de brinde
 *                                           (compra de estoque vira custo
 *                                           quando o item sai)
 *   recebido/pago                           caixa: o que foi baixado
 *
 * Uma venda gerada por OS aparece UMA vez, em receita_os. Quem separa e o
 * SQL de relatorios() no servidor; aqui so se soma o que ja veio separado.
 */
(function (raiz, fabrica) {
    const noNode = typeof module !== 'undefined' && module.exports;
    const objeto = fabrica(noNode ? require('./formato.js') : raiz.Formato);
    if (noNode) module.exports = objeto;
    else raiz.Dre = objeto;
})(this, function (Formato) {
    'use strict';

    const { emCentavos, deCentavos, dataBr, rotuloMes, somarDias, somarMeses, diasEntre } = Formato;

    /*
     * A granularidade acompanha o tamanho do intervalo:
     *   ate  45 dias  -> um ponto por DIA
     *   ate 180 dias  -> um ponto por SEMANA
     *   alem disso    -> um ponto por MES
     */
    function granularidadeDe(de, ate) {
        const span = diasEntre(de, ate);
        return span <= 45 ? 'dia' : (span <= 180 ? 'semana' : 'mes');
    }

    const CAMPOS_DINHEIRO = ['receita_vendas', 'custo_vendas', 'receita_os', 'custo_os',
                             'despesas', 'recebido', 'pago'];
    const CAMPOS_CONTAGEM = ['quantidade', 'qtd_os'];
    const CAMPOS_DIARIOS = CAMPOS_DINHEIRO.concat(CAMPOS_CONTAGEM);

    /*
     * Agrupa a serie diaria dentro de [de, ate] e fecha a conta de cada balde.
     *
     *   origem  ''       vendas e OS, com despesas -> lucro LIQUIDO
     *           'balcao' so vendas de balcao, sem despesas -> lucro BRUTO
     *           'os'     so ordens de servico, sem despesas -> lucro BRUTO
     *
     * As despesas so entram quando se olha tudo: aluguel e energia nao sao
     * de "venda" nem de "OS". Dia sem movimento vira balde zerado, para a
     * linha do tempo do grafico nao ter furos. Dinheiro somado em centavos.
     */
    function agregarPeriodo(diario, de, ate, origem) {
        const passo = granularidadeDe(de, ate);
        const baldes = [];
        const indice = {};

        function abrir(chave, rotulo, titulo) {
            const b = { chave: chave, rotulo: rotulo, titulo: titulo };
            CAMPOS_DIARIOS.forEach(function (c) { b[c] = 0; });
            indice[chave] = b;
            baldes.push(b);
        }

        if (passo === 'dia') {
            for (let d = de; d <= ate; d = somarDias(d, 1)) abrir(d, dataBr(d), dataBr(d));
        } else if (passo === 'semana') {
            for (let d = de; d <= ate; d = somarDias(d, 7)) {
                const fim = somarDias(d, 6);
                abrir(d, dataBr(d), 'Semana de ' + dataBr(d) + ' a ' + dataBr(fim > ate ? ate : fim));
            }
        } else {
            let m = de.substring(0, 7);
            const ultimo = ate.substring(0, 7);
            while (m <= ultimo) {
                abrir(m, rotuloMes(m), rotuloMes(m));
                m = somarMeses(m + '-01', 1).substring(0, 7);
            }
        }

        function baldeDe(dia) {
            if (passo === 'mes') return indice[dia.substring(0, 7)];
            if (passo === 'dia') return indice[dia];
            return indice[somarDias(de, Math.floor(diasEntre(de, dia) / 7) * 7)];
        }

        (diario || []).forEach(function (linha) {
            if (linha.dia < de || linha.dia > ate) return;
            const b = baldeDe(linha.dia);
            if (!b) return;
            CAMPOS_DINHEIRO.forEach(function (c) { b[c] += emCentavos(linha[c]); });
            CAMPOS_CONTAGEM.forEach(function (c) { b[c] += Number(linha[c]) || 0; });
        });

        const soBalcao = origem === 'balcao';
        const soOs = origem === 'os';

        return baldes.map(function (b) {
            const receita = soOs ? b.receita_os : soBalcao ? b.receita_vendas : b.receita_vendas + b.receita_os;
            const custo = soOs ? b.custo_os : soBalcao ? b.custo_vendas : b.custo_vendas + b.custo_os;
            const despesas = origem ? 0 : b.despesas;
            const bruto = receita - custo;
            const liquido = bruto - despesas;
            return {
                mes: b.chave, rotulo: b.rotulo, titulo: b.titulo,
                receita: deCentavos(receita),
                receita_vendas: deCentavos(b.receita_vendas), receita_os: deCentavos(b.receita_os),
                custo: deCentavos(custo), despesas: deCentavos(despesas),
                lucro_bruto: deCentavos(bruto), lucro_liquido: deCentavos(liquido),
                margem: receita > 0 ? liquido / receita * 100 : 0,
                recebido: deCentavos(b.recebido), pago: deCentavos(b.pago), caixa: deCentavos(b.recebido - b.pago),
                quantidade: soOs ? b.qtd_os : soBalcao ? b.quantidade : b.quantidade + b.qtd_os,
            };
        });
    }

    /** Soma os baldes de um periodo, refazendo margem e ticket medio. */
    function totalizar(baldes) {
        const cent = { receita: 0, custo: 0, despesas: 0, lucro_bruto: 0, lucro_liquido: 0 };
        let quantidade = 0;
        (baldes || []).forEach(function (m) {
            Object.keys(cent).forEach(function (k) { cent[k] += emCentavos(m[k]); });
            quantidade += Number(m.quantidade) || 0;
        });
        const t = { quantidade: quantidade };
        Object.keys(cent).forEach(function (k) { t[k] = deCentavos(cent[k]); });
        t.margem = cent.receita > 0 ? cent.lucro_liquido / cent.receita * 100 : 0;
        t.ticket_medio = quantidade > 0 ? deCentavos(Math.round(cent.receita / quantidade)) : 0;
        return t;
    }

    return {
        granularidadeDe: granularidadeDe, CAMPOS_DIARIOS: CAMPOS_DIARIOS,
        agregarPeriodo: agregarPeriodo, totalizar: totalizar,
    };
});
