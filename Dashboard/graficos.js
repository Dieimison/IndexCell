// carga: usa Formato; publica Graficos  (conferido por testes/front/carga.test.js)
/*
 * graficos.js - os graficos do painel, em SVG escrito na mao.
 *
 * Por que sem biblioteca: o sistema roda na loja, muitas vezes sem
 * internet, e um <script src="cdn..."> viraria um painel em branco no
 * primeiro dia sem conexao. Baixar a biblioteca para dentro do projeto
 * resolveria isso, mas seriam centenas de KB para desenhar barra, linha
 * e uma proporcao. Entao: SVG na mao.
 *
 * O que este arquivo expoe (window.Graficos):
 *   barras(alvo, config)      colunas agrupadas, 1 a 4 series
 *   linha(alvo, config)       linha com pontos
 *   proporcao(alvo, config)   uma barra so, dividida em partes
 *   rosca(alvo, config)       pizza com furo, para parte-do-todo
 *   ranking(alvo, config)     barras horizontais (HTML, nao SVG)
 *
 * Regras de desenho seguidas aqui, todas pelo mesmo motivo - o grafico
 * e lido por uma pessoa, as vezes com pressa, as vezes daltonica:
 *
 *   - UM eixo de valor por grafico. Duas escalas no mesmo desenho
 *     inventam uma correlacao que nao existe nos dados.
 *   - A cor segue a SERIE, nunca a posicao no ranking. Filtrar nao
 *     repinta quem sobrou.
 *   - Com duas ou mais series a legenda e obrigatoria: a identidade
 *     nunca depende so da cor.
 *   - Rotulo de valor so no que importa (o ultimo mes, o extremo). Um
 *     numero em cima de cada barra e ruido, e ninguem le.
 *   - Grade e eixo em linha continua e discreta. Grade tracejada parece
 *     "projecao" quando e so grade.
 *   - O alvo do mouse e a coluna inteira, nao o retangulo pintado.
 */
(function (janela) {
    'use strict';

    // ------------------------------------------------------------------
    // Medidas e formatacao
    // ------------------------------------------------------------------
    const LARGURA = 760;
    const ALTURA  = 250;
    const MARGEM  = { topo: 14, direita: 14, baixo: 30, esquerda: 62 };

    const AREA = {
        x: MARGEM.esquerda,
        y: MARGEM.topo,
        largura: LARGURA - MARGEM.esquerda - MARGEM.direita,
        altura: ALTURA - MARGEM.topo - MARGEM.baixo,
    };

    const curto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

    /* escapar, moeda e porcento vem do formato.js, carregado antes. */
    const { escapar, moeda, porcento } = janela.Formato;

    /** Lê uma cor dos tokens do CSS, para o grafico nunca ter hex solto. */
    function cor(nome) {
        return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    }

    function formatar(valor, tipo) {
        if (tipo === 'porcento') return porcento(valor);
        if (tipo === 'inteiro') return String(Math.round(valor));
        return moeda(valor);
    }

    function formatarEixo(valor, tipo) {
        if (tipo === 'porcento') return Math.round(valor) + '%';
        if (tipo === 'inteiro') return curto.format(valor);
        return 'R$ ' + curto.format(valor);
    }

    /*
     * Escolhe o topo (e o fundo, quando ha negativo) da escala em passos
     * "redondos", para o eixo ler 0 / 5 mil / 10 mil e nao 0 / 4.317 /
     * 8.634. Sempre inclui o zero: barra que nao comeca no zero mente
     * sobre a proporcao entre as colunas.
     */
    function escala(valores) {
        const maximo = Math.max(0, ...valores);
        const minimo = Math.min(0, ...valores);

        if (maximo === 0 && minimo === 0) {
            return { mini: 0, maxi: 1, marcas: [0, 1] };
        }

        /*
         * Cinco faixas, e nao quatro, com uma lista de passos mais fina.
         * Com quatro faixas e passos so de 1/2/2.5/5, um maximo de 10,2
         * mil caia no passo de 5 mil e o topo ia para 15 mil - um terco
         * do grafico ficava vazio e as barras encolhiam por nada.
         */
        const bruto = (maximo - minimo) / 5;
        const grandeza = Math.pow(10, Math.floor(Math.log10(Math.abs(bruto) || 1)));

        /*
         * So passos que uma pessoa le de cabeca: 1, 2, 2,5, 5 e 10 (vezes
         * a grandeza). Passos como 750 ou 1,5 mil chegam a caber melhor no
         * espaco, mas produzem eixos do tipo "R$ 2,3 mil / R$ 750" que
         * ninguem consegue usar para estimar valor de barra nenhuma.
         */
        const passo = [1, 2, 2.5, 5, 10]
            .map(function (m) { return m * grandeza; })
            .find(function (p) { return p >= bruto; }) || grandeza * 10;

        const maxi = Math.ceil(maximo / passo) * passo;
        const mini = Math.floor(minimo / passo) * passo;

        const marcas = [];
        for (let v = mini; v <= maxi + passo / 2; v += passo) {
            marcas.push(Math.round(v * 1e6) / 1e6);
        }
        return { mini: mini, maxi: maxi === mini ? mini + passo : maxi, marcas: marcas };
    }

    // ------------------------------------------------------------------
    // Dica que segue o mouse
    // ------------------------------------------------------------------
    const dica = document.getElementById('dicaGrafico');

    function mostrarDica(evento, titulo, linhas) {
        if (!dica) return;

        dica.innerHTML =
            '<div class="dica-titulo">' + escapar(titulo) + '</div>' +
            linhas.map(function (l) {
                return '<div class="dica-linha">' +
                    '<span class="dica-rotulo">' +
                        (l.cor ? '<i class="dica-marca" style="background:' + l.cor + '"></i>' : '') +
                        escapar(l.rotulo) + '</span>' +
                    '<span class="dica-valor"' + (l.destaque ? ' style="color:' + l.destaque + '"' : '') + '>' +
                        escapar(l.valor) + '</span>' +
                    '</div>';
            }).join('');

        dica.classList.add('visivel');
        dica.setAttribute('aria-hidden', 'false');
        posicionarDica(evento);
    }

    /* Mantem a dica dentro da janela: perto da borda ela vira para o
       outro lado, senao o ultimo mes do grafico nunca seria legivel. */
    function posicionarDica(evento) {
        if (!dica) return;
        const caixa = dica.getBoundingClientRect();
        const folga = 14;

        let x = evento.clientX + folga;
        let y = evento.clientY + folga;

        if (x + caixa.width > window.innerWidth - 8) x = evento.clientX - caixa.width - folga;
        if (y + caixa.height > window.innerHeight - 8) y = evento.clientY - caixa.height - folga;

        dica.style.left = Math.max(8, x) + 'px';
        dica.style.top = Math.max(8, y) + 'px';
    }

    function esconderDica() {
        if (!dica) return;
        dica.classList.remove('visivel');
        dica.setAttribute('aria-hidden', 'true');
    }

    // ------------------------------------------------------------------
    // Pecas comuns do desenho
    // ------------------------------------------------------------------
    function abrirSvg() {
        return '<svg class="grafico" viewBox="0 0 ' + LARGURA + ' ' + ALTURA + '" ' +
               'preserveAspectRatio="xMidYMid meet" role="img">';
    }

    /** Grade horizontal + numeros do eixo Y. */
    function grade(esc, tipo) {
        return esc.marcas.map(function (marca) {
            const y = paraY(marca, esc);
            const ehZero = Math.abs(marca) < 1e-9;
            return '<line class="' + (ehZero ? 'zero' : 'grade-linha') + '" x1="' + AREA.x + '" y1="' + y +
                       '" x2="' + (AREA.x + AREA.largura) + '" y2="' + y + '"/>' +
                   '<text class="rotulo" x="' + (AREA.x - 9) + '" y="' + (y + 4) + '" text-anchor="end">' +
                       escapar(formatarEixo(marca, tipo)) + '</text>';
        }).join('');
    }

    function paraY(valor, esc) {
        const proporcao = (valor - esc.mini) / (esc.maxi - esc.mini);
        return AREA.y + AREA.altura - proporcao * AREA.altura;
    }

    /** Legenda em HTML (fora do SVG, para quebrar linha sozinha). */
    function legenda(series) {
        if (series.length < 2) return '';
        return '<div class="legenda">' + series.map(function (s) {
            return '<span class="legenda-item"><i class="legenda-marca" style="background:' + s.cor + '"></i>' +
                   escapar(s.rotulo) + '</span>';
        }).join('') + '</div>';
    }

    function vazio(alvo, mensagem) {
        alvo.innerHTML = '<p class="texto-vazio">' + escapar(mensagem) + '</p>';
    }

    /*
     * Doze meses de zero nao sao um grafico: sao uma grade vazia de 250px
     * com um eixo dizendo "R$ 0". Numa loja que acabou de comecar, o
     * painel inteiro virava isso. Quando nao ha valor nenhum, vale mais a
     * frase explicando que ainda nao ha movimento.
     */
    function tudoZero(valores) {
        return valores.every(function (v) { return !v; });
    }

    /*
     * De quantos em quantos rotulos escrever no eixo X.
     *
     * O SVG tem viewBox fixo e se encolhe junto com a tela, entao "cabem
     * 12 rotulos" depende da largura REAL do container, nao da largura do
     * desenho. Num celular de 420px os doze meses viravam
     * "set/25out/25nov/25", tudo grudado. Aqui a conta e simples: cada
     * rotulo precisa de uns 46px de tela para respirar.
     */
    function saltoDosRotulos(alvo, quantidade) {
        const largura = alvo.clientWidth || LARGURA;
        const cabem = Math.max(2, Math.floor(largura / 46));
        return Math.max(1, Math.ceil(quantidade / cabem));
    }

    /*
     * Liga o hover. O alvo e um retangulo transparente que cobre a coluna
     * inteira, da base ao topo - com 6px de barra como area de mouse, a
     * dica so abriria por sorte.
     *
     * O realce da coluna e ligado AQUI, no JS, e nao por CSS. A tentativa
     * com ".alvo:hover ~ .destaque-coluna" acendia a coluna errada: o til
     * so enxerga irmaos que vem DEPOIS, e o destaque e desenhado antes do
     * alvo (precisa ficar atras das barras). O resultado era a dica falar
     * de um mes e a faixa acender em outro.
     */
    /*
     * Um ligador so para barras, linha, proporcao e rosca. Cada grafico
     * diz como "acender" o item (realcar) e, se quiser, quais outros
     * elementos tambem abrem a dica (a legenda da rosca: com fatia fina,
     * a linha da legenda e um alvo maior que o arco).
     */
    function ligarHover(alvo, pontos, realcar, extras) {
        const svg = alvo.querySelector('svg');
        if (!svg) return;
        const acender = realcar || realcarColuna(svg);

        Array.from(svg.querySelectorAll('[data-indice]')).concat(Array.from(extras || []))
            .forEach(function (elemento) {
                const indice = Number(elemento.dataset.indice);
                const ponto = pontos[indice];
                if (!ponto) return;
                elemento.addEventListener('mouseenter', function (evento) {
                    acender(indice, true);
                    mostrarDica(evento, ponto.titulo, ponto.linhas);
                });
                elemento.addEventListener('mousemove', posicionarDica);
                elemento.addEventListener('mouseleave', function () {
                    acender(indice, false);
                    esconderDica();
                });
            });
    }

    /* Barras e linha: acende a faixa da coluna (data-destaque) do indice. */
    function realcarColuna(svg) {
        const destaques = svg.querySelectorAll('[data-destaque]');
        return function (indice, ligado) {
            destaques.forEach(function (d) {
                d.style.opacity = ligado && Number(d.dataset.destaque) === indice ? 1 : 0;
            });
        };
    }

    // ------------------------------------------------------------------
    // Barras agrupadas
    // ------------------------------------------------------------------
    /*
     * config = {
     *   dados:  [{ rotulo, valores: [n, n, ...] }, ...],
     *   series: [{ rotulo, cor }, ...],
     *   tipo:   'dinheiro' | 'porcento' | 'inteiro',
     *   rotularUltimo: true    escreve o valor em cima da ultima coluna
     *   corPorSinal: true      barra verde/vermelha conforme o sinal
     * }
     */
    function barras(alvo, config) {
        const dados = config.dados || [];
        if (!dados.length) {
            return vazio(alvo, config.vazio || 'Sem dados no período.');
        }

        const series = config.series || [{ rotulo: '', cor: cor('--serie-1') }];
        const tipo = config.tipo || 'dinheiro';

        const todos = [];
        dados.forEach(function (d) { d.valores.forEach(function (v) { todos.push(v || 0); }); });
        if (tudoZero(todos)) {
            return vazio(alvo, config.vazio || "Sem movimento no período.");
        }
        const esc = escala(todos);

        const passo = AREA.largura / dados.length;
        /*
         * 2px de folga entre grupos e entre barras: o respiro separa as
         * barras sem precisar desenhar borda em volta delas.
         *
         * O teto de 54px por grupo existe para o filtro de 3 meses: sem
         * ele, tres colunas dividiam a largura toda e viravam blocos
         * enormes, que leem como cartaz e nao como grafico. Passando do
         * teto, o grupo fica centrado no seu espaco.
         */
        const larguraGrupo = Math.min(54 * series.length, Math.max(6, passo - 12));
        const larguraBarra = Math.max(3, (larguraGrupo - (series.length - 1) * 2) / series.length);
        const yZero = paraY(0, esc);
        const raio = Math.min(4, larguraBarra / 2);

        const pontos = [];
        let marcas = '';
        let alvos = '';
        let destaquesSvg = '';

        dados.forEach(function (d, i) {
            const xGrupo = AREA.x + i * passo + (passo - larguraGrupo) / 2;

            d.valores.forEach(function (valorBruto, s) {
                const valor = valorBruto || 0;
                const x = xGrupo + s * (larguraBarra + 2);
                const yValor = paraY(valor, esc);
                const y = Math.min(yValor, yZero);
                const altura = Math.max(1, Math.abs(yValor - yZero));

                /*
                 * corPorSinal usa o verde da paleta, e nao o verde de
                 * "status ok": o status e mais saturado e, do lado das
                 * outras series, gritava na tela. O sinal ja esta dito
                 * pelo lado do zero em que a barra fica - a cor so
                 * reforca.
                 */
                let pintura = series[s].cor;
                if (config.corPorSinal) {
                    pintura = valor >= 0 ? cor('--serie-3') : cor('--critico');
                }

                /* Canto arredondado so na ponta do dado, e so quando a
                   barra e alta o bastante para o raio nao comer a marca. */
                const arredondar = altura > raio * 2;
                const r = arredondar ? raio : 0;
                marcas += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) +
                          '" width="' + larguraBarra.toFixed(2) + '" height="' + altura.toFixed(2) +
                          '" rx="' + r + '" fill="' + pintura + '"/>';
            });

            // A faixa de realce vai numa camada, o alvo de mouse em outra:
            // o realce precisa ficar ATRAS das barras e o alvo, NA FRENTE
            // delas (senao a barra rouba o mouse e a dica nao abre).
            destaquesSvg += '<rect class="destaque-coluna" data-destaque="' + i + '" x="' +
                     (AREA.x + i * passo).toFixed(2) + '" y="' + AREA.y +
                     '" width="' + passo.toFixed(2) + '" height="' + AREA.altura + '" rx="6"/>';
            alvos += '<rect class="alvo" data-indice="' + i + '" x="' + (AREA.x + i * passo).toFixed(2) +
                     '" y="' + AREA.y + '" width="' + passo.toFixed(2) + '" height="' + AREA.altura + '"/>';

            pontos.push({
                titulo: d.titulo || d.rotulo,
                linhas: d.valores.map(function (v, s) {
                    return { rotulo: series[s].rotulo || 'Valor', cor: series[s].cor, valor: formatar(v || 0, tipo) };
                }).concat(d.extras || []),
            });
        });

        // Rotulo direto so na ultima coluna: e o mes que a pessoa quer
        // saber de cabeca, e um numero por barra viraria poluicao.
        let rotulosValor = '';
        if (config.rotularUltimo && dados.length) {
            const i = dados.length - 1;
            const d = dados[i];
            const valor = d.valores[0] || 0;
            const y = paraY(valor, esc);
            const x = AREA.x + i * passo + passo / 2;
            const acima = valor >= 0;
            rotulosValor = '<text class="rotulo-valor" x="' + x.toFixed(2) + '" y="' +
                (acima ? y - 8 : y + 15).toFixed(2) + '" text-anchor="middle">' +
                escapar(formatar(valor, tipo)) + '</text>';
        }

        // O ultimo rotulo sempre aparece: e o mes corrente, o que mais
        // interessa. Por isso a conta do salto parte do fim para o comeco.
        const salto = saltoDosRotulos(alvo, dados.length);
        const ultimo = dados.length - 1;
        const eixoX = dados.map(function (d, i) {
            if ((ultimo - i) % salto !== 0) return '';
            return '<text class="rotulo" x="' + (AREA.x + i * passo + passo / 2).toFixed(2) +
                   '" y="' + (AREA.y + AREA.altura + 19) + '" text-anchor="middle">' +
                   escapar(d.rotulo) + '</text>';
        }).join('');

        // Ordem das camadas: grade, realce, barras, rotulos, eixo e por
        // ultimo os alvos - que ficam por cima de tudo para pegar o mouse.
        alvo.innerHTML = legenda(series) + abrirSvg() +
            grade(esc, tipo) +
            destaquesSvg +
            marcas +
            rotulosValor +
            '<line class="eixo" x1="' + AREA.x + '" y1="' + (AREA.y + AREA.altura) +
                '" x2="' + (AREA.x + AREA.largura) + '" y2="' + (AREA.y + AREA.altura) + '"/>' +
            eixoX +
            alvos +
            '</svg>';

        ligarHover(alvo, pontos);
    }

    // ------------------------------------------------------------------
    // Linha
    // ------------------------------------------------------------------
    function linha(alvo, config) {
        const dados = config.dados || [];
        if (!dados.length) {
            return vazio(alvo, config.vazio || 'Sem dados no período.');
        }

        const series = config.series || [{ rotulo: '', cor: cor('--serie-1') }];
        const tipo = config.tipo || 'dinheiro';

        const todos = [];
        dados.forEach(function (d) { d.valores.forEach(function (v) { todos.push(v || 0); }); });
        if (tudoZero(todos)) {
            return vazio(alvo, config.vazio || "Sem movimento no período.");
        }
        const esc = escala(todos);

        const passo = AREA.largura / Math.max(1, dados.length - 1);
        const x = function (i) {
            return dados.length === 1 ? AREA.x + AREA.largura / 2 : AREA.x + i * passo;
        };

        let caminhos = '';
        let pontosSvg = '';

        series.forEach(function (serie, s) {
            const d = dados.map(function (item, i) {
                return (i === 0 ? 'M' : 'L') + x(i).toFixed(2) + ' ' + paraY(item.valores[s] || 0, esc).toFixed(2);
            }).join(' ');

            caminhos += '<path class="marca-linha" d="' + d + '" stroke="' + serie.cor + '"/>';

            dados.forEach(function (item, i) {
                pontosSvg += '<circle class="marca-ponto" cx="' + x(i).toFixed(2) + '" cy="' +
                    paraY(item.valores[s] || 0, esc).toFixed(2) + '" r="4" fill="' + serie.cor + '"/>';
            });
        });

        const pontos = dados.map(function (d) {
            return {
                titulo: d.titulo || d.rotulo,
                linhas: d.valores.map(function (v, s) {
                    return { rotulo: series[s].rotulo || 'Valor', cor: series[s].cor, valor: formatar(v || 0, tipo) };
                }).concat(d.extras || []),
            };
        });

        const larguraAlvo = AREA.largura / dados.length;
        const destaquesSvg = dados.map(function (d, i) {
            return '<rect class="destaque-coluna" data-destaque="' + i + '" x="' +
                   (x(i) - larguraAlvo / 2).toFixed(2) + '" y="' + AREA.y +
                   '" width="' + larguraAlvo.toFixed(2) + '" height="' + AREA.altura + '" rx="6"/>';
        }).join('');
        const alvos = dados.map(function (d, i) {
            return '<rect class="alvo" data-indice="' + i + '" x="' + (x(i) - larguraAlvo / 2).toFixed(2) +
                   '" y="' + AREA.y + '" width="' + larguraAlvo.toFixed(2) + '" height="' + AREA.altura + '"/>';
        }).join('');

        const salto = saltoDosRotulos(alvo, dados.length);
        const ultimo = dados.length - 1;
        const eixoX = dados.map(function (d, i) {
            if ((ultimo - i) % salto !== 0) return '';
            return '<text class="rotulo" x="' + x(i).toFixed(2) + '" y="' + (AREA.y + AREA.altura + 19) +
                   '" text-anchor="middle">' + escapar(d.rotulo) + '</text>';
        }).join('');

        alvo.innerHTML = legenda(series) + abrirSvg() +
            grade(esc, tipo) + destaquesSvg + caminhos + pontosSvg +
            '<line class="eixo" x1="' + AREA.x + '" y1="' + (AREA.y + AREA.altura) +
                '" x2="' + (AREA.x + AREA.largura) + '" y2="' + (AREA.y + AREA.altura) + '"/>' +
            eixoX + alvos + '</svg>';

        ligarHover(alvo, pontos);
    }

    // ------------------------------------------------------------------
    // Proporcao (uma barra dividida)
    // ------------------------------------------------------------------
    /*
     * Parte-do-todo com poucas fatias. Barra, e nao pizza: comparar dois
     * pedacos de pizza parecidos e adivinhacao; comparar comprimentos nao.
     */
    function proporcao(alvo, config) {
        const partes = (config.partes || []).filter(function (p) { return p.valor > 0; });
        const total = partes.reduce(function (s, p) { return s + p.valor; }, 0);

        if (!total) {
            return vazio(alvo, config.vazio || 'Sem dados no período.');
        }

        const altura = 26;
        const larguraTotal = LARGURA - 28;
        let x = 14;
        let barras = '';
        const pontos = [];

        partes.forEach(function (parte, i) {
            // 2px de folga entre as fatias: separa sem desenhar borda.
            const largura = Math.max(2, (parte.valor / total) * larguraTotal - (i < partes.length - 1 ? 2 : 0));
            barras += '<rect x="' + x.toFixed(2) + '" y="0" width="' + largura.toFixed(2) +
                      '" height="' + altura + '" rx="5" fill="' + parte.cor + '"/>' +
                      '<rect class="alvo" data-indice="' + i + '" x="' + x.toFixed(2) + '" y="0" width="' +
                      largura.toFixed(2) + '" height="' + altura + '"/>';
            x += largura + 2;

            pontos.push({
                titulo: parte.rotulo,
                linhas: [
                    { rotulo: 'Valor', cor: parte.cor, valor: moeda(parte.valor) },
                    { rotulo: 'Do total', valor: (Math.round(parte.valor / total * 1000) / 10).toString().replace('.', ',') + '%' },
                ],
            });
        });

        const legendaHtml = '<div class="legenda">' + partes.map(function (p) {
            return '<span class="legenda-item"><i class="legenda-marca" style="background:' + p.cor + '"></i>' +
                   escapar(p.rotulo) + ' — <strong style="color:var(--tinta)">' +
                   (Math.round(p.valor / total * 1000) / 10).toString().replace('.', ',') + '%</strong></span>';
        }).join('') + '</div>';

        alvo.innerHTML =
            '<svg class="grafico" viewBox="0 0 ' + LARGURA + ' ' + altura + '" preserveAspectRatio="none" ' +
            'style="height:' + altura + 'px" role="img">' + barras + '</svg>' +
            legendaHtml +
            '<div class="lista-dados" style="margin-top:6px">' +
            partes.map(function (p) {
                return '<div><span>' + escapar(p.rotulo) + '</span><strong>' + escapar(moeda(p.valor)) + '</strong></div>';
            }).join('') +
            '<div><span>Total</span><strong>' + escapar(moeda(total)) + '</strong></div>' +
            '</div>';

        ligarHover(alvo, pontos);
    }

    // ------------------------------------------------------------------
    // Rosca (pizza com furo)
    // ------------------------------------------------------------------
    /*
     * Parte-do-todo. Serve para responder "quanto do bolo cada um pegou",
     * nao para comparar fatias parecidas - dois pedacos de 24% e 26% sao
     * indistinguiveis num circulo, e por isso a legenda traz o valor e o
     * percentual de cada um por escrito.
     *
     * Rosca em vez de pizza cheia porque o furo do meio guarda o total:
     * o numero que a pessoa quer ler primeiro fica no centro, em vez de
     * ter de ser somado de cabeca.
     *
     * Maximo de 6 fatias. Acima disso o olho nao separa mais os arcos, e
     * o excedente vira "Outros" - com o detalhe preservado na legenda.
     */
    const MAX_FATIAS = 6;

    function rosca(alvo, config) {
        const todas = (config.partes || []).filter(function (p) { return p.valor > 0; })
            .sort(function (a, b) { return b.valor - a.valor; });

        if (!todas.length) {
            return vazio(alvo, config.vazio || 'Sem dados no período.');
        }

        // Junta a cauda em "Outros", somando o que ela representa.
        let partes = todas;
        if (todas.length > MAX_FATIAS) {
            const cabeca = todas.slice(0, MAX_FATIAS - 1);
            const cauda = todas.slice(MAX_FATIAS - 1);
            cabeca.push({
                rotulo: 'Outros (' + cauda.length + ')',
                valor: cauda.reduce(function (s, p) { return s + p.valor; }, 0),
                detalhe: cauda.map(function (p) { return p.rotulo; }).join(', '),
            });
            partes = cabeca;
        }

        const cores = [cor('--serie-1'), cor('--serie-2'), cor('--serie-3'),
                       cor('--serie-4'), cor('--serie-5'), cor('--tinta-fraca')];

        const total = partes.reduce(function (s, p) { return s + p.valor; }, 0);
        const LADO = 240;
        const centro = LADO / 2;
        const raio = 92;
        const grossura = 30;

        let angulo = -Math.PI / 2;   // começa no topo, como um relógio
        let arcos = '';
        const pontos = [];

        partes.forEach(function (parte, i) {
            const fatia = (parte.valor / total) * Math.PI * 2;
            const cordaCor = parte.cor || cores[i % cores.length];

            /*
             * Uma fatia de 100% nao pode ser desenhada como arco: o ponto
             * inicial e o final coincidem e o path vira nada. Nesse caso
             * o desenho e um circulo.
             */
            if (partes.length === 1) {
                arcos += '<circle cx="' + centro + '" cy="' + centro + '" r="' + (raio - grossura / 2) +
                         '" fill="none" stroke="' + cordaCor + '" stroke-width="' + grossura + '"/>' +
                         '<circle class="alvo" data-indice="0" cx="' + centro + '" cy="' + centro +
                         '" r="' + raio + '"/>';
            } else {
                const fim = angulo + fatia;
                // 2px de folga entre fatias: separa sem desenhar borda.
                const folga = Math.min(0.035, fatia / 4);
                const a1 = angulo + folga / 2;
                const a2 = fim - folga / 2;
                const grande = (a2 - a1) > Math.PI ? 1 : 0;
                const r = raio - grossura / 2;

                const x1 = centro + r * Math.cos(a1), y1 = centro + r * Math.sin(a1);
                const x2 = centro + r * Math.cos(a2), y2 = centro + r * Math.sin(a2);

                arcos += '<path class="fatia" data-indice="' + i + '" d="M' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
                         ' A' + r + ' ' + r + ' 0 ' + grande + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + '"' +
                         ' fill="none" stroke="' + cordaCor + '" stroke-width="' + grossura +
                         '" stroke-linecap="butt"/>';
                angulo = fim;
            }

            const pct = parte.valor / total * 100;
            pontos.push({
                titulo: parte.rotulo,
                linhas: [
                    { rotulo: 'Valor', cor: cordaCor, valor: formatar(parte.valor, config.tipo || 'dinheiro') },
                    { rotulo: 'Do total', valor: (Math.round(pct * 10) / 10).toString().replace('.', ',') + '%' },
                ].concat(parte.detalhe ? [{ rotulo: 'Inclui', valor: parte.detalhe }] : []),
            });
        });

        // O total mora no furo do meio.
        const miolo =
            '<text class="rosca-total" x="' + centro + '" y="' + (centro - 2) + '" text-anchor="middle">' +
                escapar(formatar(total, config.tipo || 'dinheiro')) + '</text>' +
            '<text class="rosca-rotulo" x="' + centro + '" y="' + (centro + 16) + '" text-anchor="middle">' +
                escapar(config.rotuloTotal || 'total') + '</text>';

        const legenda = '<div class="legenda-rosca">' + partes.map(function (p, i) {
            const pct = p.valor / total * 100;
            return '<div class="legenda-linha" data-indice="' + i + '">' +
                '<i class="legenda-marca" style="background:' + (p.cor || cores[i % cores.length]) + '"></i>' +
                '<span class="legenda-nome" title="' + escapar(p.detalhe || p.rotulo) + '">' + escapar(p.rotulo) + '</span>' +
                '<span class="legenda-pct">' + (Math.round(pct * 10) / 10).toString().replace('.', ',') + '%</span>' +
                '<span class="legenda-valor">' + escapar(formatar(p.valor, config.tipo || 'dinheiro')) + '</span>' +
                '</div>';
        }).join('') + '</div>';

        alvo.innerHTML =
            '<div class="rosca-caixa">' +
            '  <svg class="grafico rosca" viewBox="0 0 ' + LADO + ' ' + LADO + '" role="img">' +
                 arcos + miolo +
            '  </svg>' +
                 legenda +
            '</div>';

        /* Rosca: acende a fatia e a linha da legenda, apaga as outras. */
        const fatias = alvo.querySelectorAll('svg [data-indice]');
        const linhas = alvo.querySelectorAll('.legenda-linha');
        ligarHover(alvo, pontos, function (indice, ligado) {
            fatias.forEach(function (f) {
                f.style.opacity = !ligado ? '' : (Number(f.dataset.indice) === indice ? 1 : 0.35);
            });
            linhas.forEach(function (l) {
                l.classList.toggle('ativa', ligado && Number(l.dataset.indice) === indice);
            });
        }, linhas);
    }

    // ------------------------------------------------------------------
    // Ranking (barras horizontais)
    // ------------------------------------------------------------------
    /*
     * Nomes longos cabem melhor deitados. Uma serie so, entao uma cor so
     * para todas as barras: pintar cada uma de um jeito coloriria o
     * ranking, que o comprimento da barra ja mostra.
     */
    function ranking(alvo, config) {
        const itens = config.itens || [];
        if (!itens.length) {
            return vazio(alvo, config.vazio || 'Nada registrado ainda.');
        }

        const maximo = Math.max.apply(null, itens.map(function (i) { return i.valor; })) || 1;
        const pintura = config.cor || cor('--serie-1');

        alvo.innerHTML = '<div class="ranking">' + itens.map(function (item) {
            return '<div class="ranking-item">' +
                '<span class="ranking-nome" title="' + escapar(item.rotulo) + '">' + escapar(item.rotulo) + '</span>' +
                '<span class="ranking-valor">' + escapar(item.texto || moeda(item.valor)) + '</span>' +
                '<span class="ranking-trilho"><i style="width:' +
                    Math.max(2, item.valor / maximo * 100).toFixed(1) + '%;background:' + pintura + '"></i></span>' +
                '</div>';
        }).join('') + '</div>';
    }

    janela.Graficos = {
        barras: barras,
        linha: linha,
        proporcao: proporcao,
        rosca: rosca,
        ranking: ranking,
        cor: cor,
    };
})(window);
