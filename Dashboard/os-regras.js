// carga: usa Formato; publica RegrasOs  (conferido por testes/front/carga.test.js)
/*
 * os-regras.js - a conta da mao de obra e do valor final da OS. Window.RegrasOs.
 *
 * E a MESMA regra do servidor (valoresOs). Os dois lados rodam a mesma
 * tabela de casos, testes\casos\mao-de-obra.json: o teste PHP do backend
 * e testes\front\os-regras.test.js. Mudou a regra? Mude os dois e a tabela.
 *
 *   mao   = servicos, quando houver servico lancado;
 *           senao o valor digitado;
 *           senao, sem nada digitado, orcamento - pecas (nunca negativo)
 *   final = o valor digitado; senao pecas + mao; e se isso der zero,
 *           o orcamento
 *
 * "Digitado" e null quando ninguem digitou. Zero digitado e um valor
 * (0 ?? x = 0).
 *
 * O que conta como digitado AO ABRIR a janela tambem e regra, e mora aqui
 * (digitadosIniciais): numa OS gravada, o que esta gravado conta como
 * digitado - reabrir e salvar sem mexer grava o mesmo. Os casos de edicao
 * da tabela trazem "edicao": {"gravado": {mao, final}}; ali "entrada" e o
 * que a pessoa mexeu DEPOIS de abrir (null = nao mexeu), e vale
 *     digitado = o que mexeu, senao o gravado     (comDigitadosIniciais).
 *
 * As contas sao em centavos inteiros e a resposta volta em reais.
 */
(function (raiz, fabrica) {
    const noNode = typeof module !== 'undefined' && module.exports;
    const objeto = fabrica(noNode ? require('./formato.js') : raiz.Formato);
    if (noNode) module.exports = objeto;
    else raiz.RegrasOs = objeto;
})(this, function (Formato) {
    'use strict';

    const { emCentavos, deCentavos } = Formato;

    function digitado(valor) {
        return valor === null || valor === undefined || valor === '' ? null : emCentavos(valor);
    }

    /**
     * entrada: { orcamento, pecas, servicos, mao_digitada, final_digitado }
     * devolve: { mao, final } em reais
     */
    function calcularValoresOs(entrada) {
        const orcamento = emCentavos(entrada.orcamento);
        const pecas = emCentavos(entrada.pecas);
        const servicos = emCentavos(entrada.servicos);
        const maoDigitada = digitado(entrada.mao_digitada);
        const finalDigitado = digitado(entrada.final_digitado);

        const mao = servicos > 0 ? servicos
                  : maoDigitada !== null ? maoDigitada
                  : (orcamento > 0 ? Math.max(0, orcamento - pecas) : 0);
        const final = finalDigitado !== null ? finalDigitado
                    : (pecas + mao > 0 ? pecas + mao : orcamento);

        return { mao: deCentavos(mao), final: deCentavos(final) };
    }

    /**
     * O que conta como digitado ao abrir a janela.
     *   edicao true:  a OS gravada - mao e final gravados contam como digitados
     *   edicao false: OS nova - nada foi digitado ainda
     * gravados: { mao, final } como estao nos campos (texto ou numero; vazio = nao ha).
     */
    function digitadosIniciais(edicao, gravados) {
        if (!edicao || !gravados) return { mao_digitada: null, final_digitado: null };
        const ou = function (v) { return v === undefined || v === '' ? null : v; };
        return { mao_digitada: ou(gravados.mao), final_digitado: ou(gravados.final) };
    }

    /**
     * A entrada da conta para um caso de edicao: o que a pessoa mexeu depois
     * de abrir manda; o que ela nao mexeu vale o inicial (o gravado).
     */
    function comDigitadosIniciais(entrada, iniciais) {
        const pega = function (mexido, inicial) { return mexido === null || mexido === undefined ? inicial : mexido; };
        return Object.assign({}, entrada, {
            mao_digitada: pega(entrada.mao_digitada, iniciais.mao_digitada),
            final_digitado: pega(entrada.final_digitado, iniciais.final_digitado),
        });
    }

    return { calcularValoresOs: calcularValoresOs, digitadosIniciais: digitadosIniciais,
             comDigitadosIniciais: comDigitadosIniciais };
});
