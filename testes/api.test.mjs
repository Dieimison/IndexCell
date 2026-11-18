// Testes de API do Index Celulares - "o testador".
// Sem framework: Node 22 (fetch nativo). Uso:
//   node api.test.mjs                 (alvo padrao http://127.0.0.1:5603)
//   set BASE_URL=http://127.0.0.1:5613 && node api.test.mjs
// O oraculo e a regra escrita (LEIA-ME.txt / memory.md), nao o codigo.
// Toda massa criada leva o prefixo TST-<run> e telefones ficticios (00) 9xxxx-xxxx.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5603';
const RUN = 'TST-' + Date.now().toString(36).toUpperCase();
const LOG = [];
const hoje = new Date();
const pad = (n) => String(n).padStart(2, '0');
const MES = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}`;
const DIA = `${MES}-${pad(hoje.getDate())}`;
const c = (x) => Math.round(Number(x) * 100);            // em centavos
const soma = (arr, f = (x) => x) => arr.reduce((a, b) => a + f(b), 0);

// SETUP r2 (unica mudanca alem de senhas/IMEI): login do admin vem do ambiente, com troca
// obrigatoria da senha provisoria em preparar(). Nenhuma assercao foi alterada.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_SENHA_INICIAL = process.env.ADMIN_SENHA_INICIAL || '';
const ADMIN_SENHA = process.env.ADMIN_SENHA || 'Testador-R2-2026';
const SENHA_U = 'Usuario-Teste-77';                                  // era 'abcd' (minimo agora 8)
let seqImei = Date.now() % 1e9;
// ADAPTADO-r3 (decisao 25): o IMEI agora confere o digito verificador (Luhn).
const comLuhn = (n14) => { let s = 0; for (let i = 0; i < 14; i++) { let d = +n14[i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; } return n14 + ((10 - s % 10) % 10); };
const imeiUnico = () => comLuhn('35' + String(++seqImei).padStart(12, '0')); // era '000000000000000'
// ADAPTADO-r3 (decisao 27): usuario criado pelo admin nasce com troca obrigatoria; o setup faz o 1o acesso.
const SENHA_PROVISORIA = 'Provisoria-r3-01';
async function criarUsuarioPronto(corpo) {
  const r = await A.post('/api/usuarios', { ...corpo, senha: SENHA_PROVISORIA });
  if (r.status === 201) {
    const s1 = new Sessao('primeiro-acesso');
    await s1.login(corpo.usuario, SENHA_PROVISORIA);
    await s1.post('/api/trocar-senha', { senha_atual: SENHA_PROVISORIA, senha_nova: corpo.senha });
  }
  return r;
}

// ------------------------------------------------------------------ HTTP
class Sessao {
  constructor(nome) { this.nome = nome; this.cookie = ''; }
  async r(metodo, caminho, corpo) {
    const headers = { origin: BASE };   // ADAPTADO-r3 (decisao 29): mutacao exige Origin do proprio host
    if (this.cookie) headers.cookie = this.cookie;
    let body;
    if (corpo !== undefined) {
      headers['content-type'] = 'application/json';
      body = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    }
    const res = await fetch(BASE + caminho, { method: metodo, headers, body, redirect: 'manual' });
    for (const ck of res.headers.getSetCookie?.() || []) {
      const m = ck.match(/^PHPSESSID=([^;]*)/);
      if (m) this.cookie = m[1] && m[1] !== 'deleted' ? 'PHPSESSID=' + m[1] : '';
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* nao-JSON */ }
    const req = `${metodo} ${caminho}` + (body ? ' ' + body.slice(0, 400) : '');
    LOG.push(`[${this.nome}] ${req}\n   -> ${res.status} ${text.slice(0, 400)}`);
    return { status: res.status, json, text, req };
  }
  get(p) { return this.r('GET', p); }
  post(p, b) { return this.r('POST', p, b ?? {}); }
  put(p, b) { return this.r('PUT', p, b ?? {}); }
  del(p) { return this.r('DELETE', p); }
  async login(u, s) { return this.post('/api/login', { usuario: u, senha: s }); }
}

// ------------------------------------------------------------------ mini-framework
class Falha extends Error {
  constructor(d) { super(d.esperado); this.d = d; }
}
const resumo = (r) => (r.json ? JSON.stringify(r.json) : r.text).replace(/\s+/g, ' ').slice(0, 260);
/** exige(condicao, esperado, r|obtido) */
function exige(cond, esperado, r, obtido) {
  if (cond) return;
  throw new Falha({
    esperado,
    obtido: obtido ?? (r ? `${r.status} ${resumo(r)}` : '(sem resposta)'),
    req: r?.req ?? '',
  });
}
function exigeStatus(r, codigos, esperado) {
  const lista = Array.isArray(codigos) ? codigos : [codigos];
  exige(lista.includes(r.status), esperado ?? `HTTP ${lista.join(' ou ')}`, r);
}
const casos = [];
function caso(id, grupo, titulo, onde, fn) { casos.push({ id, grupo, titulo, onde, fn }); }

// ------------------------------------------------------------------ massa
const A = new Sessao('admin');
const M = {};            // ids da massa compartilhada
let seq = 0;
const unico = (p) => `${RUN} ${p} ${++seq}`;
const telFicticio = () => {
  const n = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  return { formatado: `(00) 9${n.slice(0, 4)}-${n.slice(4)}`, digitos: `009${n}` };
};

async function novaPecaCatalogo() {
  const r = await A.post('/api/pecas', { nome: unico('Peca'), categoria: 'tela' });
  exigeStatus(r, 201, 'criar peca de apoio deveria dar 201');
  return r.json.id;
}
async function novaEntradaPeca(qtd = 5, custo = 20, venda = 50, extra = {}) {
  const pecaId = await novaPecaCatalogo();
  const r = await A.post('/api/entradas', {
    tipo: 'peca', peca_id: pecaId, quantidade: qtd, valor_investimento: custo,
    valor_venda: venda, gerar_conta_pagar: '', ...extra,
  });
  exigeStatus(r, 201, 'criar entrada de apoio deveria dar 201');
  return r.json.id;
}
async function novaEntradaCelular(custo = 500, venda = 900) {
  const r = await A.post('/api/entradas', {
    tipo: 'celular', modelo_nome: unico('Modelo'), marca: 'TST', imei: imeiUnico(),
    valor_investimento: custo, valor_venda: venda, situacao: 'ready', gerar_conta_pagar: '',
  });
  exigeStatus(r, 201, 'criar celular de apoio deveria dar 201');
  return r.json.id;
}
async function entrada(id) {
  const r = await A.get('/api/entradas/' + id);
  exigeStatus(r, 200, 'ler entrada');
  return r.json.entrada;
}
async function saldo(id) { return (await entrada(id)).saldo; }
async function disponivel(id) {
  const r = await A.get('/api/entradas?disponivel=1');
  return r.json.itens.some((e) => e.id === id);
}
async function novoCliente(extra = {}) {
  const r = await A.post('/api/clientes', { nome: unico('Cliente'), ...extra });
  exigeStatus(r, 201, 'criar cliente de apoio');
  return r.json.id;
}
async function venda(id) {
  const r = await A.get('/api/vendas/' + id);
  exigeStatus(r, 200, 'ler venda ' + id);
  return r.json.venda;
}
async function ordem(id) {
  const r = await A.get('/api/os/' + id);
  exigeStatus(r, 200, 'ler OS ' + id);
  return r.json.os;
}
async function lancamento(id) {
  const r = await A.get('/api/lancamentos/' + id);
  return r;
}
async function vendaAvulsa(valor, parcelas = 1, extra = {}) {
  const r = await A.post('/api/vendas', {
    itens: [{ descricao: unico('Servico avulso'), quantidade: 1, valor_unitario: valor }],
    parcelas, forma_pagamento_id: M.f1, ...extra,
  });
  exigeStatus(r, 201, 'criar venda avulsa');
  return r.json.id;
}
const ativos = (ls) => ls.filter((l) => l.status !== 'cancelado');
async function novaOs(corpo) {
  const r = await A.post('/api/os', { cliente_id: M.cliente, modelo_id: M.modelo, defeito_relatado: 'teste', ...corpo });
  return r;
}
async function relat() { const r = await A.get('/api/relatorios'); exigeStatus(r, 200, 'relatorios'); return r.json; }
async function fin() { const r = await A.get('/api/financeiro'); exigeStatus(r, 200, 'financeiro'); return r.json; }
// ADAPTADO-r2 (decisao item 30): /api/relatorios nao manda mais "mensal"/"totais" - o DRE e
// calculado pela tela sobre a serie diaria. O mes atual e a soma da mesma serie diaria.
const mesAtual = (rel) => {
  const dias = (rel.diario || []).filter((d) => d.dia.startsWith(MES));
  const s = (k) => Math.round(soma(dias, (d) => c(d[k] || 0))) / 100;
  const receita = s('receita_vendas') + s('receita_os');
  const custo = s('custo_vendas') + s('custo_os');
  return { mes: MES, receita, custo, despesas: s('despesas'), lucro_liquido: receita - custo - s('despesas'),
           receita_vendas: s('receita_vendas'), receita_os: s('receita_os') };
};

// ==================================================================
// CASOS
// ==================================================================

// ---------- 1. Login e sessao ----------
caso('C01', 'Login/sessao', 'login admin/admin certo entra e /sessao devolve o usuario', 'api/api.php:315', async () => {
  const s = new Sessao('c01');
  const r = await s.login(ADMIN_USER, ADMIN_SENHA);
  exigeStatus(r, 200);
  exige(r.json?.usuario?.perfil === 'admin', 'perfil admin no corpo', r);
  const ss = await s.get('/api/sessao');
  exige(ss.status === 200 && ss.json.usuario.usuario === ADMIN_USER, '/sessao 200 com usuario admin', ss);
});
caso('C02', 'Login/sessao', 'senha errada, usuario inexistente e campos vazios nao entram', 'api/api.php:315', async () => {
  const s = new Sessao('c02');
  const r1 = await s.login('admin', 'errada');
  exigeStatus(r1, 401, 'senha errada -> 401');
  const r2 = await s.login('nao-existe-' + RUN, 'admin');
  exigeStatus(r2, 401, 'usuario inexistente -> 401');
  const r3 = await s.login('', '');
  exigeStatus(r3, 400, 'vazio -> 400');
  const r4 = await s.get('/api/sessao');
  exigeStatus(r4, 401, 'depois de errar, /sessao continua 401');
});
caso('C03', 'Login/sessao', 'toda rota (menos login) exige sessao: 401 sem cookie', 'api/api.php:285', async () => {
  const s = new Sessao('anonimo');
  const rotas = ['resumo', 'financeiro', 'relatorios', 'entradas', 'clientes', 'fornecedores', 'modelos', 'pecas',
    'produtos', 'servicos', 'formas-pagamento', 'os', 'vendas', 'lancamentos', 'usuarios', 'movimentacoes?peca_id=1'];
  for (const rt of rotas) {
    const r = await s.get('/api/' + rt);
    exigeStatus(r, 401, `GET /api/${rt} sem login -> 401`);
  }
  const w = await s.post('/api/clientes', { nome: 'x' });
  exigeStatus(w, 401, 'POST sem login -> 401');
});
caso('C04', 'Login/sessao', 'logout derruba a sessao (cookie antigo nao vale mais)', 'api/api.php:277', async () => {
  const s = new Sessao('c04');
  await s.login(ADMIN_USER, ADMIN_SENHA);
  const antigo = s.cookie;
  const r = await s.post('/api/logout');
  exigeStatus(r, 200);
  s.cookie = antigo;
  const d = await s.get('/api/resumo');
  exigeStatus(d, 401, 'cookie de antes do logout -> 401');
});
caso('C05', 'Login/sessao', 'trocar senha: atual errada recusa, curta recusa, certa troca e a velha deixa de valer', 'api/api.php:393', async () => {
  const login = ('tsenha' + RUN).toLowerCase();
  const cri = await A.post('/api/usuarios', { usuario: login, nome: unico('Usuario'), senha: SENHA_U, perfil: 'balcao' });
  exigeStatus(cri, 201);
  const s = new Sessao('c05');
  exigeStatus(await s.login(login, SENHA_U), 200);
  exigeStatus(await s.post('/api/trocar-senha', { senha_atual: 'xxxx', senha_nova: 'Nova-12345' }), 400, 'senha atual errada -> 400');
  exigeStatus(await s.post('/api/trocar-senha', { senha_atual: SENHA_U, senha_nova: '12' }), 400, 'senha curta -> 400');
  exigeStatus(await s.post('/api/trocar-senha', { senha_atual: SENHA_U, senha_nova: 'Nova-12345' }), 200);
  exigeStatus(await new Sessao('c05b').login(login, SENHA_U), 401, 'senha velha nao entra mais');
  exigeStatus(await new Sessao('c05c').login(login, 'Nova-12345'), 200, 'senha nova entra');
});
caso('C06', 'Login/sessao', 'usuario desativado perde a sessao aberta e nao loga mais', 'api/api.php:244', async () => {
  const login = ('tdesat' + RUN).toLowerCase();
  const cri = await A.post('/api/usuarios', { usuario: login, nome: unico('Usuario'), senha: SENHA_U, perfil: 'tecnico' });
  exigeStatus(cri, 201);
  const s = new Sessao('c06');
  exigeStatus(await s.login(login, SENHA_U), 200);
  exigeStatus(await A.put('/api/usuarios/' + cri.json.id, { ativo: 0 }), 200);
  exigeStatus(await s.get('/api/resumo'), 401, 'sessao de usuario desativado -> 401');
  exigeStatus(await new Sessao('c06b').login(login, SENHA_U), 401, 'login de desativado -> 401');
});
caso('C07', 'Login/sessao', 'sessao dura 8 horas (LEIA-ME "Sessao de 8 horas") - inspecao estatica', 'api/api.php:229-235', async () => {
  // Nao da para esperar 8h; confere se ha QUALQUER controle de 8h no codigo
  // ou na configuracao efetiva do PHP.
  const raiz = path.resolve(AQUI, '..');
  // ADAPTADO-r3 (decisao 15): o api.php foi dividido; a sessao mora em api/nucleo.php.
  const api = ['api.php', 'nucleo.php'].map((a) => fs.readFileSync(path.join(raiz, 'api', a), 'utf8')).join('\n');
  const temControle = /28800|8\s*\*\s*3600|gc_maxlifetime|cookie_lifetime|lifetime'\s*=>/.test(api);
  exige(temControle, 'api.php define expiracao de 8h (gc_maxlifetime/cookie lifetime/timestamp de login)', null,
    'nenhum controle de tempo na sessao: vale o php.ini (session.gc_maxlifetime=1440 s = 24 min ocioso, coleta 1/1000) e, com uso continuo, a sessao nunca expira');
});

// ---------- 2. Permissoes ----------
caso('C10', 'Permissoes', 'tecnico e balcao nao gerenciam usuarios (403), admin sim', 'api/api.php:3493', async () => {
  for (const perfil of ['tecnico', 'balcao']) {
    const login = (`p${perfil}${RUN}`).toLowerCase();
    exigeStatus(await criarUsuarioPronto({ usuario: login, nome: unico('U'), senha: SENHA_U, perfil }), 201); // ADAPTADO-r3 (decisao 27)
    const s = new Sessao(perfil);
    exigeStatus(await s.login(login, SENHA_U), 200);
    exigeStatus(await s.get('/api/usuarios'), 403, `${perfil} GET /usuarios -> 403`);
    exigeStatus(await s.post('/api/usuarios', { usuario: 'x' + login, nome: 'x', senha: SENHA_U }), 403, `${perfil} POST /usuarios -> 403`);
    exigeStatus(await s.put('/api/usuarios/1', { perfil: 'admin' }), 403, `${perfil} nao se promove`);
    exigeStatus(await s.get('/api/resumo'), 200, `${perfil} usa o resto do sistema`);
  }
  exigeStatus(await A.get('/api/usuarios'), 200, 'admin lista usuarios');
});
caso('C11', 'Permissoes', 'admin nao exclui nem desativa a si mesmo; perfil invalido e login repetido recusados', 'api/api.php:3536', async () => {
  const eu = (await A.get('/api/sessao')).json.usuario.id;
  exigeStatus(await A.del('/api/usuarios/' + eu), 400, 'excluir a si mesmo -> 400');
  exigeStatus(await A.put('/api/usuarios/' + eu, { ativo: 0 }), 400, 'desativar a si mesmo -> 400');
  exigeStatus(await A.post('/api/usuarios', { usuario: 'pinv' + RUN, nome: 'x', senha: SENHA_U, perfil: 'root' }), 400, 'perfil invalido -> 400');
  exigeStatus(await A.post('/api/usuarios', { usuario: 'admin', nome: 'x', senha: SENHA_U }), 400, 'login repetido -> 400');
  exigeStatus(await A.put('/api/usuarios/99999999', { nome: 'x' }), 404, 'PUT usuario inexistente -> 404');
  exigeStatus(await A.del('/api/usuarios/99999999'), 404, 'DELETE usuario inexistente -> 404');
});

// ---------- 3. Cadastros (CRUD) ----------
const CADASTROS = [
  { rota: 'clientes', corpo: () => ({ nome: unico('Cli'), telefone: telFicticio().formatado }) },
  { rota: 'fornecedores', corpo: () => ({ nome: unico('Forn') }) },
  { rota: 'modelos', corpo: () => ({ marca: 'TST', modelo: unico('Mod'), armazenamento: '64GB' }), campoNome: 'modelo' },
  { rota: 'pecas', corpo: () => ({ nome: unico('Peca'), categoria: 'bateria' }) },
  { rota: 'produtos', corpo: () => ({ nome: unico('Prod'), categoria: 'capa' }) },
  { rota: 'servicos', corpo: () => ({ nome: unico('Serv'), valor_padrao: 10 }) },
  { rota: 'formas-pagamento', corpo: () => ({ nome: unico('Forma'), tipo: 'vista' }) },
];
let nCad = 20;
for (const cad of CADASTROS) {
  const id = 'C' + nCad++;
  caso(id, 'Cadastros', `CRUD /api/${cad.rota}: cria, lista, edita, exclui; sem nome -> 400; id inexistente -> 404`, 'api/api.php (rota ' + cad.rota + ')', async () => {
    const campo = cad.campoNome || 'nome';
    const sem = cad.corpo(); delete sem[campo];
    exigeStatus(await A.post('/api/' + cad.rota, sem), 400, `POST sem "${campo}" -> 400`);
    const b = cad.corpo();
    const cr = await A.post('/api/' + cad.rota, b);
    exigeStatus(cr, 201, 'POST valido -> 201');
    const novoId = cr.json.id;
    const ls = await A.get('/api/' + cad.rota);
    exige(ls.json.itens.some((x) => x.id === novoId), 'registro novo aparece no GET da lista', ls);
    const b2 = { ...b, [campo]: b[campo] + ' editado' };
    exigeStatus(await A.put(`/api/${cad.rota}/${novoId}`, b2), 200, 'PUT valido -> 200');
    const ls2 = await A.get('/api/' + cad.rota);
    exige(ls2.json.itens.find((x) => x.id === novoId)?.[campo] === b2[campo], 'GET reflete a edicao', ls2);
    exigeStatus(await A.put(`/api/${cad.rota}/99999999`, cad.corpo()), 404, 'PUT id inexistente -> 404');
    exigeStatus(await A.del(`/api/${cad.rota}/99999999`), 404, 'DELETE id inexistente -> 404');
    exigeStatus(await A.del(`/api/${cad.rota}/${novoId}`), 200, 'DELETE -> 200');
    const ls3 = await A.get('/api/' + cad.rota);
    exige(!ls3.json.itens.some((x) => x.id === novoId), 'excluido some da lista', ls3);
  });
}
caso('C27', 'Cadastros', 'GET /api/<cadastro>/{id inexistente} -> 404 (nao a lista inteira com 200)', 'api/api.php:1270,1575,1703,1779,1835,1897,2063', async () => {
  const falhos = [];
  for (const cad of CADASTROS) {
    const r = await A.get(`/api/${cad.rota}/99999999`);
    if (r.status !== 404) falhos.push(`${cad.rota}=${r.status}${r.json?.itens ? ' (lista com ' + r.json.itens.length + ' itens)' : ''}`);
  }
  exige(falhos.length === 0, '404 em todos os cadastros', null, falhos.join('; '));
});
caso('C28', 'Cadastros', 'duplicidades e enums: modelo repetido, forma repetida (sem caixa), categoria e tipo invalidos -> 400', 'api/api.php:1723,2090,1798,2084', async () => {
  const m = { marca: 'TST', modelo: unico('Dup'), armazenamento: '' };
  exigeStatus(await A.post('/api/modelos', m), 201);
  exigeStatus(await A.post('/api/modelos', m), 400, 'modelo repetido -> 400');
  const nome = unico('FormaDup');
  exigeStatus(await A.post('/api/formas-pagamento', { nome }), 201);
  exigeStatus(await A.post('/api/formas-pagamento', { nome: nome.toUpperCase() }), 400, 'forma repetida em maiusculas -> 400');
  exigeStatus(await A.post('/api/pecas', { nome: unico('p'), categoria: 'motor' }), 400, 'categoria de peca invalida -> 400');
  exigeStatus(await A.post('/api/formas-pagamento', { nome: unico('f'), tipo: 'cheque' }), 400, 'tipo de forma invalido -> 400');
});
caso('C29', 'Cadastros', 'cadastro em uso nao se exclui (cliente com venda, fornecedor/peca/produto/modelo com entrada)', 'api/api.php:1304,1610,1745,1818,1866', async () => {
  const cli = await novoCliente();
  await vendaAvulsa(10, 1, { cliente_id: cli });
  const r1 = await A.del('/api/clientes/' + cli);
  exigeStatus(r1, 400, 'cliente com venda -> 400');
  exige(/venda/i.test(r1.json?.erro || ''), 'mensagem diz que ha venda', r1);
  const forn = (await A.post('/api/fornecedores', { nome: unico('F') })).json.id;
  const pecaId = await novaPecaCatalogo();
  await A.post('/api/entradas', { tipo: 'peca', peca_id: pecaId, quantidade: 1, valor_investimento: 1, fornecedor_id: forn });
  exigeStatus(await A.del('/api/fornecedores/' + forn), 400, 'fornecedor com entrada -> 400');
  exigeStatus(await A.del('/api/pecas/' + pecaId), 400, 'peca com entrada -> 400');
  const prod = (await A.post('/api/produtos', { nome: unico('P') })).json.id;
  await A.post('/api/entradas', { tipo: 'produto', produto_id: prod, quantidade: 1, valor_investimento: 1 });
  exigeStatus(await A.del('/api/produtos/' + prod), 400, 'produto com entrada -> 400');
  exigeStatus(await A.del('/api/modelos/' + M.modelo), 400, 'modelo com aparelho/entrada -> 400');
});
caso('C30', 'Cadastros', 'servico usado em OS nao se exclui; desativado some de ?ativos=1', 'api/api.php:1938', async () => {
  const sv = (await A.post('/api/servicos', { nome: unico('SvUso'), valor_padrao: 30 })).json.id;
  const o = await novaOs({ itens: [{ servico_id: sv, descricao: 'svc', quantidade: 1, valor_unitario: 30 }] });
  exigeStatus(o, 201);
  exigeStatus(await A.del('/api/servicos/' + sv), 400, 'servico em uso -> 400');
  exigeStatus(await A.put('/api/servicos/' + sv, { nome: 'desativado ' + RUN, valor_padrao: 30, ativo: 0 }), 200);
  const at = await A.get('/api/servicos?ativos=1');
  exige(!at.json.itens.some((s) => s.id === sv), 'servico desativado fora de ?ativos=1', at);
});
caso('C31', 'Cadastros', 'forma de pagamento em uso nao se exclui; desativada some de ?ativas=1; renomear atualiza o texto dos documentos', 'api/api.php:2124,2131', async () => {
  const f = (await A.post('/api/formas-pagamento', { nome: unico('FUso') })).json.id;
  const v = await vendaAvulsa(15, 1, { forma_pagamento_id: f });
  exigeStatus(await A.del('/api/formas-pagamento/' + f), 400, 'forma em uso -> 400');
  const novoNome = unico('FRenomeada');
  exigeStatus(await A.put('/api/formas-pagamento/' + f, { nome: novoNome, ativo: 0 }), 200);
  exige((await venda(v)).forma_pagamento === novoNome, 'venda passa a mostrar o nome novo', null, (await venda(v)).forma_pagamento);
  const at = await A.get('/api/formas-pagamento?ativas=1');
  exige(!at.json.itens.some((x) => x.id === f), 'forma desativada fora de ?ativas=1', at);
});
caso('C32', 'Cadastros', 'forma usada so como 2a forma de pagamento de uma OS: excluir recusa com aviso proprio (e nao conta 0 usos)', 'api/api.php:2131-2145', async () => {
  const f = (await A.post('/api/formas-pagamento', { nome: unico('FSegunda') })).json.id;
  const o = await novaOs({ valor_mao_obra: 100, pagamentos: [{ forma_pagamento_id: M.f1, valor: 60 }, { forma_pagamento_id: f, valor: 40 }] });
  exigeStatus(o, 201);
  const ls = await A.get('/api/formas-pagamento');
  const usos = ls.json.itens.find((x) => x.id === f)?.usos;
  const r = await A.del('/api/formas-pagamento/' + f);
  exige(r.status === 400 && /em uso|registro|Desative/i.test(r.json?.erro || '') && usos > 0,
    'usos >= 1 na lista e DELETE 400 com o aviso "esta em N registro(s)... Desative-a"', r,
    `usos=${usos}; DELETE -> ${r.status} ${resumo(r)}`);
});

// ---------- 4. Entradas ----------
caso('C40', 'Entradas', 'entrada de peca qtd 5 vira saldo 5 e aparece em ?disponivel=1', 'dados/estrutura.sql:541', async () => {
  const e = await novaEntradaPeca(5);
  exige((await saldo(e)) === 5, 'saldo 5', null, String(await saldo(e)));
  exige(await disponivel(e), 'na lista ?disponivel=1', null, 'ausente');
});
caso('C41', 'Entradas', 'celular e sempre 1 unidade (mesmo pedindo 3)', 'api/api.php:1211', async () => {
  const r = await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, quantidade: 3, valor_investimento: 100, gerar_conta_pagar: '' });
  exigeStatus(r, 201);
  exige((await entrada(r.json.id)).quantidade === 1, 'quantidade 1', null, String((await entrada(r.json.id)).quantidade));
});
caso('C42', 'Entradas', 'compra gera lancamento: "pago" baixa na hora, "pagar" fica pendente, vazio nao lanca; valor = custo x qtd', 'api/api.php:1066-1090', async () => {
  const p1 = await novaPecaCatalogo();
  const r1 = await A.post('/api/entradas', { tipo: 'peca', peca_id: p1, quantidade: 3, valor_investimento: 12.5, gerar_conta_pagar: 'pago', forma_pagamento_id: M.f1 });
  const p2 = await novaPecaCatalogo();
  const r2 = await A.post('/api/entradas', { tipo: 'peca', peca_id: p2, quantidade: 2, valor_investimento: 10, gerar_conta_pagar: 'pagar' });
  const p3 = await novaPecaCatalogo();
  const r3 = await A.post('/api/entradas', { tipo: 'peca', peca_id: p3, quantidade: 2, valor_investimento: 10, gerar_conta_pagar: '' });
  const ls = (await A.get('/api/lancamentos')).json.itens;
  const l1 = ls.filter((l) => l.entrada_id === r1.json.id);
  const l2 = ls.filter((l) => l.entrada_id === r2.json.id);
  const l3 = ls.filter((l) => l.entrada_id === r3.json.id);
  exige(l1.length === 1 && l1[0].status === 'pago' && c(l1[0].valor) === 3750 && l1[0].tipo === 'pagar' && l1[0].origem === 'entrada',
    '"pago": 1 lancamento pagar 37,50 pago', null, JSON.stringify(l1));
  exige(l2.length === 1 && l2[0].status === 'pendente' && c(l2[0].valor) === 2000, '"pagar": 1 pendente 20,00', null, JSON.stringify(l2));
  exige(l3.length === 0, 'vazio: nenhum lancamento', null, JSON.stringify(l3));
});
caso('C43', 'Entradas', 'valor negativo na entrada e recusado', 'api/api.php:1229-1230', async () => {
  const p = await novaPecaCatalogo();
  const r = await A.post('/api/entradas', { tipo: 'peca', peca_id: p, quantidade: 1, valor_investimento: -10, valor_venda: -5 });
  exigeStatus(r, 400, 'custo/preco negativo -> 400');
});
caso('C44', 'Entradas', 'quantidade 0 ou negativa e recusada (nao vira 1 em silencio)', 'api/api.php:1211-1214', async () => {
  const p = await novaPecaCatalogo();
  const r = await A.post('/api/entradas', { tipo: 'peca', peca_id: p, quantidade: -3, valor_investimento: 1 });
  exigeStatus(r, 400, 'quantidade -3 -> 400');
});
caso('C45', 'Entradas', 'validacoes: tipo invalido, peca ausente, condicao invalida -> 400', 'api/api.php:1164', async () => {
  exigeStatus(await A.post('/api/entradas', { tipo: 'drone' }), 400, 'tipo invalido');
  exigeStatus(await A.post('/api/entradas', { tipo: 'peca', quantidade: 1 }), 400, 'sem peca');
  exigeStatus(await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, condicao: 'quebrado' }), 400, 'condicao invalida');
});
caso('C46', 'Entradas', 'PUT nao deixa quantidade abaixo do que ja saiu por venda', 'api/api.php:1105', async () => {
  const e = await novaEntradaPeca(5);
  exigeStatus(await A.post('/api/vendas', { itens: [{ entrada_id: e, quantidade: 3 }] }), 201);
  exigeStatus(await A.put('/api/entradas/' + e, { quantidade: 2 }), 400, 'quantidade 2 com 3 vendidas -> 400');
});
caso('C47', 'Entradas', 'PUT nao deixa quantidade abaixo do que saiu por MOVIMENTACAO (perda) - saldo nunca negativo', 'api/api.php:1105-1112', async () => {
  const e = await novaEntradaPeca(5);
  exigeStatus(await A.post('/api/movimentacoes', { entrada_id: e, motivo: 'perda', quantidade: 4 }), 201);
  const r = await A.put('/api/entradas/' + e, { quantidade: 1 });
  const s = await saldo(e);
  exige(r.status === 400 && s >= 0, 'PUT 400 e saldo >= 0', r, `PUT -> ${r.status}; saldo agora = ${s}`);
});
caso('C48', 'Entradas', 'excluir entrada: com venda -> 400; sem saida -> 200; inexistente -> 404', 'api/api.php:1129', async () => {
  const e = await novaEntradaPeca(2);
  exigeStatus(await A.post('/api/vendas', { itens: [{ entrada_id: e, quantidade: 1 }] }), 201);
  exigeStatus(await A.del('/api/entradas/' + e), 400, 'com venda -> 400');
  const e2 = await novaEntradaPeca(2);
  exigeStatus(await A.del('/api/entradas/' + e2), 200, 'sem saida -> 200');
  exigeStatus(await A.del('/api/entradas/99999999'), 404, 'inexistente -> 404');
  exigeStatus(await A.get('/api/entradas/99999999'), 404, 'GET inexistente -> 404');
  exigeStatus(await A.put('/api/entradas/99999999', { quantidade: 1 }), 404, 'PUT inexistente -> 404');
});
caso('C49', 'Entradas', 'excluir entrada que ja teve saida por movimentacao (perda) e recusado - nao apaga o historico', 'api/api.php:1141 + estrutura.sql:445 (CASCADE)', async () => {
  const e = await novaEntradaPeca(3);
  exigeStatus(await A.post('/api/movimentacoes', { entrada_id: e, motivo: 'perda', quantidade: 1 }), 201);
  const r = await A.del('/api/entradas/' + e);
  exigeStatus(r, 400, 'entrada com baixa por perda -> 400 ("ja teve saida")');
});

// ---------- 5. Vendas ----------
caso('C60', 'Vendas', 'venda de 2 pecas com desconto: baixa saldo, total = bruto - desconto, custo certo, 1 lancamento receber pago', 'api/api.php:2368', async () => {
  const e = await novaEntradaPeca(5, 20, 50);
  const r = await A.post('/api/vendas', { itens: [{ entrada_id: e, quantidade: 2 }], desconto: 10, parcelas: 1, pago: true, forma_pagamento_id: M.f1 });
  exigeStatus(r, 201);
  const v = await venda(r.json.id);
  exige((await saldo(e)) === 3, 'saldo 5 -> 3', null, String(await saldo(e)));
  exige(c(v.valor_total) === 9000 && c(v.custo_total) === 4000 && c(v.lucro) === 5000, 'total 90, custo 40, lucro 50', null, JSON.stringify({ t: v.valor_total, c: v.custo_total, l: v.lucro }));
  exige(v.lancamentos.length === 1 && v.lancamentos[0].status === 'pago' && c(v.lancamentos[0].valor) === 9000 && v.lancamentos[0].origem === 'venda',
    '1 lancamento 90,00 pago origem venda', null, JSON.stringify(v.lancamentos));
  exige(/^VD-\d{4}-\d{4}$/.test(v.numero), 'numero VD-AAAA-NNNN', null, v.numero);
});
caso('C61', 'Vendas', '100,00 em 3x = 33,33 + 33,33 + 33,34, vencendo de mes em mes', 'api/api.php:2451', async () => {
  const id = await vendaAvulsa(100, 3, { vencimento: '2026-11-10' });
  const ls = (await venda(id)).lancamentos;
  exige(ls.map((l) => c(l.valor)).join(',') === '3333,3333,3334', 'parcelas 33,33/33,33/33,34', null, ls.map((l) => l.valor).join(','));
  exige(ls.map((l) => l.vencimento).join(',') === '2026-11-10,2026-12-10,2027-01-10', 'vencimentos mensais', null, ls.map((l) => l.vencimento).join(','));
});
caso('C62', 'Vendas', 'centavos: itens 0,10 + 0,20 = venda 0,30 e lancamento 0,30 exatos', 'api/api.php:2384-2396', async () => {
  const r = await A.post('/api/vendas', { itens: [{ descricao: 'a', valor_unitario: 0.1 }, { descricao: 'b', valor_unitario: 0.2 }] });
  exigeStatus(r, 201);
  const v = await venda(r.json.id);
  exige(v.valor_total === 0.3 && v.lancamentos[0].valor === 0.3, 'valor_total === 0.3 e lancamento === 0.3 (sem 0.30000000000000004)', null,
    `valor_total=${v.valor_total} lancamento=${v.lancamentos[0].valor}`);
});
caso('C63', 'Vendas', 'parcelamento nunca perde/inventa centavo e nunca gera parcela de R$ 0,00', 'api/api.php:2458-2462', async () => {
  const combos = [[10, 3], [0.05, 10], [1.13, 2], [99.99, 7], [0.1, 3], [1234.56, 12]];
  const ruins = [];
  for (const [total, n] of combos) {
    // ADAPTADO-r2 (decisao item 20/38, parcela minima R$ 0,01): 0,05 em 10x nao fecha sem
    // parcela zerada, entao o oraculo "nenhuma parcela 0,00" vira "a API recusa (400)".
    if (c(total) < n) {
      const r0 = await A.post('/api/vendas', { itens: [{ descricao: unico('Av'), quantidade: 1, valor_unitario: total }], parcelas: n, forma_pagamento_id: M.f1 });
      if (r0.status !== 400) ruins.push(`${total} em ${n}x: parcela < 0,01 deveria ser recusada (400), veio ${r0.status}`);
      continue;
    }
    const id = await vendaAvulsa(total, n);
    const ls = (await venda(id)).lancamentos;
    const s = soma(ls, (l) => c(l.valor));
    const zeros = ls.filter((l) => c(l.valor) <= 0).length;
    const max = Math.max(...ls.map((l) => c(l.valor))), min = Math.min(...ls.map((l) => c(l.valor)));
    if (s !== c(total) || zeros || ls.length !== n || max - min > n) {
      ruins.push(`${total} em ${n}x -> [${ls.map((l) => l.valor).join(', ')}] soma=${s / 100}${zeros ? `, ${zeros} parcela(s) de 0,00` : ''}`);
    }
  }
  exige(ruins.length === 0, 'soma das parcelas = total, nenhuma parcela 0,00', null, ruins.join(' | '));
});
caso('C64', 'Vendas', 'vencimento 31/01 em 3x vence no fim de fevereiro e 31/03 ("de mes em mes")', 'api/api.php:2468', async () => {
  const id = await vendaAvulsa(30, 3, { vencimento: '2027-01-31' });
  const ls = (await venda(id)).lancamentos.map((l) => l.vencimento);
  exige(ls[1] === '2027-02-28' && ls[2] === '2027-03-31', 'parcela 2 em 2027-02-28, parcela 3 em 2027-03-31', null, ls.join(', '));
});
caso('C65', 'Vendas', 'saldo insuficiente no 2o item recusa a venda inteira (nada baixa)', 'api/api.php:2382', async () => {
  const e1 = await novaEntradaPeca(5), e2 = await novaEntradaPeca(1);
  const r = await A.post('/api/vendas', { itens: [{ entrada_id: e1, quantidade: 2 }, { entrada_id: e2, quantidade: 3 }] });
  exigeStatus(r, 400);
  exige((await saldo(e1)) === 5, 'saldo do 1o item intacto (5)', null, String(await saldo(e1)));
});
caso('C66', 'Vendas', 'mesma entrada em duas linhas somando mais que o saldo e recusada (saldo nunca negativo)', 'api/api.php:2384-2390 / 2240', async () => {
  const e = await novaEntradaPeca(1);
  const r = await A.post('/api/vendas', { itens: [{ entrada_id: e, quantidade: 1 }, { entrada_id: e, quantidade: 1 }] });
  const s = await saldo(e);
  exige(r.status === 400 && s === 1, 'POST 400 e saldo continua 1', r, `POST -> ${r.status}; saldo agora = ${s}`);
});
caso('C67', 'Vendas', 'quantidade 0/negativa na linha e recusada (nao vira 1 em silencio)', 'api/api.php:2199', async () => {
  const e = await novaEntradaPeca(5);
  const r1 = await A.post('/api/vendas', { itens: [{ entrada_id: e, quantidade: -2 }] });
  exige(r1.status === 400, 'quantidade -2 -> 400', r1, `${r1.status} ${resumo(r1)}; saldo ficou ${await saldo(e)} (era 5)`);
});
caso('C67b', 'Vendas', 'preco unitario negativo na linha e recusado', 'api/api.php:2219,2245', async () => {
  // sozinho, o -50 cai por acaso na regra do desconto; junto de um item positivo, passa
  const r2 = await A.post('/api/vendas', { itens: [{ descricao: 'item', valor_unitario: 100 }, { descricao: 'estorno?', valor_unitario: -50 }] });
  let det = `${r2.status} ${resumo(r2)}`;
  if (r2.status === 201) { const v = await venda(r2.json.id); det += ` -> venda total ${v.valor_total}, lancamento ${v.lancamentos.map((l) => l.valor).join(',')}`; }
  exige(r2.status === 400, 'valor_unitario -50 -> 400', null, det);
});
caso('C68', 'Vendas', 'desconto negativo ou maior que o bruto -> 400; sem itens -> 400; cliente inexistente -> 400', 'api/api.php:2392', async () => {
  exigeStatus(await A.post('/api/vendas', { itens: [{ descricao: 'x', valor_unitario: 10 }], desconto: -1 }), 400, 'desconto negativo');
  exigeStatus(await A.post('/api/vendas', { itens: [{ descricao: 'x', valor_unitario: 10 }], desconto: 11 }), 400, 'desconto > bruto');
  exigeStatus(await A.post('/api/vendas', { itens: [] }), 400, 'sem itens');
  exigeStatus(await A.post('/api/vendas', { itens: [{ descricao: 'x', valor_unitario: 1 }], cliente_id: 99999999 }), 400, 'cliente inexistente');
});
caso('C69', 'Vendas', 'celular vendido sai da prateleira (situacao vendido, fora de ?disponivel)', 'api/api.php:2424', async () => {
  const cel = await novaEntradaCelular();
  exigeStatus(await A.post('/api/vendas', { itens: [{ entrada_id: cel }] }), 201);
  const e = await entrada(cel);
  exige(e.situacao === 'vendido' && e.saldo === 0 && !(await disponivel(cel)), 'vendido, saldo 0, fora da lista', null, JSON.stringify({ s: e.situacao, saldo: e.saldo }));
});
caso('C70', 'Vendas', 'cancelar venda devolve estoque, cancela contas em aberto e devolve celular a prateleira', 'api/api.php:2525', async () => {
  const e = await novaEntradaPeca(3);
  const cel = await novaEntradaCelular();
  const r = await A.post('/api/vendas', { itens: [{ entrada_id: e, quantidade: 2 }, { entrada_id: cel }], parcelas: 2 });
  exigeStatus(r, 201);
  exigeStatus(await A.put('/api/vendas/' + r.json.id, { status: 'cancelada' }), 200);
  const v = await venda(r.json.id);
  exige((await saldo(e)) === 3, 'saldo volta a 3', null, String(await saldo(e)));
  exige(v.lancamentos.every((l) => l.status === 'cancelado'), 'parcelas pendentes canceladas', null, JSON.stringify(v.lancamentos.map((l) => l.status)));
  exige(await disponivel(cel), 'celular de volta em ?disponivel=1', null, JSON.stringify(await entrada(cel)));
});
caso('C71', 'Vendas', 'cancelar venda com lancamento JA PAGO: o lancamento vira "cancelado" (estorno), nao fica como recebido', 'api/api.php:2528-2529 (memory.md §6)', async () => {
  const id = await vendaAvulsa(70, 1, { pago: true });
  exigeStatus(await A.put('/api/vendas/' + id, { status: 'cancelada' }), 200);
  const ls = (await venda(id)).lancamentos;
  exige(ls.every((l) => l.status === 'cancelado'), 'lancamento pago -> cancelado', null, JSON.stringify(ls.map((l) => ({ v: l.valor, s: l.status }))));
});
caso('C72', 'Vendas', 'reativar venda cancelada (cancelada -> concluida) quando a peca ja foi vendida de novo e recusado', 'api/api.php:2489-2545', async () => {
  const e = await novaEntradaPeca(1);
  const v1 = (await A.post('/api/vendas', { itens: [{ entrada_id: e }] })).json.id;
  exigeStatus(await A.put('/api/vendas/' + v1, { status: 'cancelada' }), 200);
  exigeStatus(await A.post('/api/vendas', { itens: [{ entrada_id: e }] }), 201, 'a peca devolvida vende de novo');
  const r = await A.put('/api/vendas/' + v1, { status: 'concluida' });
  const s = await saldo(e);
  exige(r.status === 400 && s === 0, 'PUT 400 (sem saldo) e saldo continua 0', r, `PUT -> ${r.status}; saldo agora = ${s}`);
});
caso('C73', 'Vendas', 'reativar venda cancelada reabre as contas a receber (financeiro acompanha)', 'api/api.php:2525', async () => {
  const id = await vendaAvulsa(40, 1);
  await A.put('/api/vendas/' + id, { status: 'cancelada' });
  const r = await A.put('/api/vendas/' + id, { status: 'concluida' });
  const v = await venda(id);
  const ativo = soma(ativos(v.lancamentos), (l) => c(l.valor));
  exige(r.status === 400 || (v.status === 'concluida' && ativo === c(v.valor_total)),
    'ou recusa a reativacao, ou a venda concluida volta a ter 40,00 a receber', r, `PUT -> ${r.status}; venda ${v.status} total ${v.valor_total}, lancamentos ativos ${ativo / 100}`);
});
caso('C74', 'Vendas', 'editar o desconto de uma venda ajusta o financeiro (soma dos lancamentos = novo total)', 'api/api.php:2502-2523', async () => {
  const id = await vendaAvulsa(100, 1);
  exigeStatus(await A.put('/api/vendas/' + id, { desconto: 20 }), 200);
  const v = await venda(id);
  const ativo = soma(ativos(v.lancamentos), (l) => c(l.valor));
  exige(c(v.valor_total) === 8000 && ativo === 8000, 'venda 80,00 e a receber 80,00', null, `venda=${v.valor_total} a_receber=${ativo / 100}`);
});
caso('C75', 'Vendas', 'excluir venda devolve tudo: peca ao saldo, celular a prateleira, lancamento pago vira cancelado (nao apagado)', 'api/api.php:2341-2357', async () => {
  const e = await novaEntradaPeca(2);
  const cel = await novaEntradaCelular();
  const r = await A.post('/api/vendas', { itens: [{ entrada_id: e, quantidade: 2 }, { entrada_id: cel }], pago: true });
  const lancId = (await venda(r.json.id)).lancamentos[0].id;
  exigeStatus(await A.del('/api/vendas/' + r.json.id), 200);
  exige((await saldo(e)) === 2, 'peca volta a 2', null, String(await saldo(e)));
  const l = await lancamento(lancId);
  exige(l.status === 200 && l.json.lancamento.status === 'cancelado', 'lancamento continua existindo como cancelado', l);
  const ce = await entrada(cel);
  exige(ce.saldo === 1 && (await disponivel(cel)), 'celular saldo 1 e de volta em ?disponivel=1 (situacao != vendido)', null,
    `saldo=${ce.saldo} situacao=${ce.situacao} disponivel=${await disponivel(cel)}`);
});
caso('C76', 'Vendas', 'GET/PUT/DELETE de venda inexistente -> 404', 'api/api.php:2272,2493,2315', async () => {
  exigeStatus(await A.get('/api/vendas/99999999'), 404);
  exigeStatus(await A.put('/api/vendas/99999999', { status: 'cancelada' }), 404);
  exigeStatus(await A.del('/api/vendas/99999999'), 404);
});
caso('C77', 'Vendas', 'lancamento de venda nao se exclui pelo financeiro (400)', 'api/api.php:2712', async () => {
  const id = await vendaAvulsa(10);
  const lid = (await venda(id)).lancamentos[0].id;
  exigeStatus(await A.del('/api/lancamentos/' + lid), 400);
});

// ---------- 6. Ordem de servico ----------
caso('C90', 'OS', 'criar OS: numero OS-AAAA-NNNN, modelo digitado vira cadastro, historico registra a abertura', 'api/api.php:3063', async () => {
  const nomeModelo = unico('ModeloOS');
  const r = await A.post('/api/os', { cliente_id: M.cliente, modelo_nome: nomeModelo, marca: 'TST', defeito_relatado: 'nao liga' });
  exigeStatus(r, 201);
  const o = await ordem(r.json.id);
  exige(/^OS-\d{4}-\d{4}$/.test(o.numero), 'numero OS-AAAA-NNNN', null, o.numero);
  const mods = (await A.get('/api/modelos')).json.itens;
  exige(mods.some((m) => m.modelo === nomeModelo), 'modelo cadastrado na hora', null, 'nao achei o modelo');
  exige(o.historico.length === 1 && o.historico[0].status_para === 'aberta', 'historico com a abertura', null, JSON.stringify(o.historico));
});
caso('C91', 'OS', 'peca lancada na OS baixa o saldo na hora; valor_pecas = soma dos itens; final = pecas + mao de obra', 'api/api.php:2993,3449', async () => {
  const e = await novaEntradaPeca(5, 20, 50);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 2, valor_unitario: 45 }], valor_mao_obra: 30, valor_pecas: 9999 });
  exigeStatus(r, 201);
  const o = await ordem(r.json.id);
  exige((await saldo(e)) === 3, 'saldo 5 -> 3', null, String(await saldo(e)));
  exige(c(o.valor_pecas) === 9000 && c(o.valor_mao_obra) === 3000 && c(o.valor_final) === 12000, 'pecas 90 (ignora 9999 digitado), mao de obra 30, final 120', null,
    JSON.stringify({ p: o.valor_pecas, m: o.valor_mao_obra, f: o.valor_final }));
});
caso('C92', 'OS', 'com servicos lancados, mao de obra = soma dos servicos (o digitado e ignorado)', 'api/api.php:3461', async () => {
  const r = await novaOs({ itens: [{ servico_id: M.servico, descricao: 'troca', quantidade: 1, valor_unitario: 80 }, { servico_id: M.servico, descricao: 'limpeza', quantidade: 2, valor_unitario: 15 }], valor_mao_obra: 50 });
  exigeStatus(r, 201);
  const o = await ordem(r.json.id);
  exige(c(o.valor_mao_obra) === 11000 && c(o.valor_final) === 11000, 'mao de obra 110 e final 110', null, JSON.stringify({ m: o.valor_mao_obra, f: o.valor_final }));
});
caso('C93', 'OS', 'entregar OS gera UMA venda (pecas + servicos, sem linha de mao de obra duplicada), total = valor final, receita contada 1 vez', 'api/api.php:3162', async () => {
  const e = await novaEntradaPeca(3, 20, 50);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 50 }, { servico_id: M.servico, descricao: 'troca', quantidade: 1, valor_unitario: 80 }] });
  exigeStatus(r, 201);
  const antes = mesAtual(await relat());
  exigeStatus(await A.put('/api/os/' + r.json.id, { status: 'entregue' }), 200);
  const o = await ordem(r.json.id);
  exige(o.venda_id, 'OS ganha venda_id', null, JSON.stringify(o));
  const v = await venda(o.venda_id);
  exige(c(v.valor_total) === 13000 && v.lista_itens.length === 2 && !v.lista_itens.some((i) => /M.o de obra/.test(i.descricao)),
    'venda 130 com 2 linhas (peca + servico)', null, JSON.stringify(v.lista_itens.map((i) => [i.descricao, i.subtotal])));
  exige((await saldo(e)) === 2, 'saldo continua 2 (a peca saiu uma vez so)', null, String(await saldo(e)));
  const ls = ativos(v.lancamentos);
  exige(ls.length === 1 && c(ls[0].valor) === 13000, '1 conta a receber 130', null, JSON.stringify(ls));
  const depois = mesAtual(await relat());
  exige(c(depois.receita_os - antes.receita_os) === 13000 && c(depois.receita_vendas - antes.receita_vendas) === 0,
    'relatorio: +130 em oficina, +0 em balcao', null, `oficina +${(depois.receita_os - antes.receita_os).toFixed(2)}, balcao +${(depois.receita_vendas - antes.receita_vendas).toFixed(2)}`);
});
caso('C94', 'OS', 'OS sem servico: mao de obra digitada vira linha "Mao de obra" na venda', 'api/api.php:3238', async () => {
  const e = await novaEntradaPeca(2, 10, 30);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 30 }], valor_mao_obra: 50, status: 'entregue' });
  exigeStatus(r, 201);
  const v = await venda((await ordem(r.json.id)).venda_id);
  exige(c(v.valor_total) === 8000 && v.lista_itens.some((i) => /o de obra/.test(i.descricao) && c(i.subtotal) === 5000), 'venda 80 com linha mao de obra 50', null, JSON.stringify(v.lista_itens));
});
caso('C95', 'OS', 'reabrir OS entregue desfaz a venda (conta cancelada, peca segue presa); reentregar nao duplica cobranca', 'api/api.php:3419,3286', async () => {
  const e = await novaEntradaPeca(2, 10, 40);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 40 }], status: 'entregue' });
  const o1 = await ordem(r.json.id);
  const v1 = await venda(o1.venda_id);
  const lid = v1.lancamentos[0].id;
  exigeStatus(await A.put('/api/os/' + r.json.id, { status: 'em_reparo' }), 200);
  exigeStatus(await A.get('/api/vendas/' + o1.venda_id), 404, 'venda gerada some');
  exige((await lancamento(lid)).json.lancamento.status === 'cancelado', 'conta da venda cancelada', null, '');
  exige((await saldo(e)) === 1, 'peca continua presa na OS (saldo 1)', null, String(await saldo(e)));
  await A.put('/api/os/' + r.json.id, { status: 'entregue' });
  await A.put('/api/os/' + r.json.id, { status: 'entregue' });
  const o2 = await ordem(r.json.id);
  const ls = (await A.get('/api/lancamentos')).json.itens.filter((l) => l.venda_id === o2.venda_id && l.status !== 'cancelado');
  exige(ls.length === 1 && c(ls[0].valor) === 4000, 'uma conta ativa de 40', null, JSON.stringify(ls));
});
caso('C96', 'OS', 'cancelar OS devolve a peca ao saldo e cancela a conta em aberto', 'api/api.php:3408', async () => {
  const e = await novaEntradaPeca(2);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 2, valor_unitario: 40 }] });
  exige((await saldo(e)) === 0, 'saldo 0 com a OS aberta', null, String(await saldo(e)));
  exigeStatus(await A.put('/api/os/' + r.json.id, { status: 'cancelada' }), 200);
  exige((await saldo(e)) === 2, 'saldo volta a 2', null, String(await saldo(e)));
});
caso('C97', 'OS', 'reabrir OS cancelada cuja peca ja foi vendida a outro cliente e recusado (saldo nunca negativo)', 'api/api.php:3332-3431', async () => {
  const e = await novaEntradaPeca(1);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 40 }] });
  await A.put('/api/os/' + r.json.id, { status: 'cancelada' });
  exigeStatus(await A.post('/api/vendas', { itens: [{ entrada_id: e }] }), 201, 'peca devolvida vende');
  const rr = await A.put('/api/os/' + r.json.id, { status: 'em_reparo' });
  const s = await saldo(e);
  exige(rr.status === 400 && s === 0, 'PUT 400 e saldo continua 0', rr, `PUT -> ${rr.status}; saldo agora = ${s}`);
});
caso('C98', 'OS', 'itens travam quando a OS esta pronta/entregue: PUT com itens e recusado pela API', 'api/api.php:3377-3379 (LEIA-ME "PECAS TRAVAM")', async () => {
  const e = await novaEntradaPeca(3, 10, 40);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 40 }], status: 'pronta' });
  const rp = await A.put('/api/os/' + r.json.id, { itens: [] });
  const op = await ordem(r.json.id);
  exige(rp.status === 400 && op.lista_itens.length === 1, 'OS pronta: PUT itens=[] -> 400 e peca continua', rp, `PUT -> ${rp.status}; itens agora=${op.lista_itens.length}; saldo=${await saldo(e)}`);
});
caso('C99', 'OS', 'OS entregue: trocar itens pela API nao pode deixar OS e venda divergentes', 'api/api.php:3377 + 3162', async () => {
  const e = await novaEntradaPeca(3, 10, 40);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 40 }], status: 'entregue' });
  const rp = await A.put('/api/os/' + r.json.id, { itens: [{ entrada_id: e, quantidade: 2, valor_unitario: 40 }], status: 'entregue' });
  const o = await ordem(r.json.id);
  const v = await venda(o.venda_id);
  exige(rp.status === 400 || c(o.valor_final) === c(v.valor_total), 'ou recusa (400) ou a venda acompanha', rp,
    `PUT -> ${rp.status}; OS valor_final=${o.valor_final}, venda=${v.valor_total}; saldo=${await saldo(e)}`);
});
caso('C100', 'OS', 'excluir OS entregue: venda desfeita, peca volta a prateleira, conta paga vira cancelada', 'api/api.php:2905', async () => {
  const e = await novaEntradaPeca(2, 10, 40);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 40 }], status: 'entregue' });
  const o = await ordem(r.json.id);
  const lid = (await venda(o.venda_id)).lancamentos[0].id;
  await A.put('/api/lancamentos/' + lid, { status: 'pago' });
  exigeStatus(await A.del('/api/os/' + r.json.id), 200);
  exige((await saldo(e)) === 2, 'saldo volta a 2', null, String(await saldo(e)));
  exigeStatus(await A.get('/api/vendas/' + o.venda_id), 404, 'venda desfeita');
  exige((await lancamento(lid)).json.lancamento.status === 'cancelado', 'conta paga -> cancelada', null, '');
});
caso('C101', 'OS', 'pagamento dividido 50 + 30: entregar gera 2 lancamentos com as formas certas', 'api/api.php:3261', async () => {
  const r = await novaOs({ valor_mao_obra: 80, pagamentos: [{ forma_pagamento_id: M.f1, valor: 50 }, { forma_pagamento_id: M.f2, valor: 30 }] });
  exigeStatus(r, 201);
  await A.put('/api/os/' + r.json.id, { status: 'entregue' });
  const v = await venda((await ordem(r.json.id)).venda_id);
  const ls = ativos(v.lancamentos).map((l) => `${l.forma_pagamento_id}:${c(l.valor)}`).sort().join(',');
  const esp = [`${M.f1}:5000`, `${M.f2}:3000`].sort().join(',');
  exige(ls === esp, `lancamentos ${esp}`, null, ls);
});
caso('C102', 'OS', 'pagamentos que nao fecham (50 + 20 para 80) sao recusados; forma inexistente recusada', 'api/api.php:2021', async () => {
  exigeStatus(await novaOs({ valor_mao_obra: 80, pagamentos: [{ forma_pagamento_id: M.f1, valor: 50 }, { forma_pagamento_id: M.f2, valor: 20 }] }), 400, 'soma 70 != 80');
  exigeStatus(await novaOs({ valor_mao_obra: 80, pagamentos: [{ forma_pagamento_id: 99999999, valor: 80 }] }), 400, 'forma inexistente');
  exigeStatus(await novaOs({ valor_mao_obra: 80, pagamentos: [{ valor: 80 }] }), 400, 'linha sem forma');
});
caso('C103', 'OS', 'centavos: 0,10 + 0,20 fecha valor final 0,30 e os lancamentos somam 0,30', 'api/api.php:1986', async () => {
  const r = await novaOs({ valor_mao_obra: 0.3, pagamentos: [{ forma_pagamento_id: M.f1, valor: 0.1 }, { forma_pagamento_id: M.f2, valor: 0.2 }] });
  exigeStatus(r, 201, '0,1 + 0,2 = 0,3 aceito');
  await A.put('/api/os/' + r.json.id, { status: 'entregue' });
  const v = await venda((await ordem(r.json.id)).venda_id);
  exige(soma(ativos(v.lancamentos), (l) => c(l.valor)) === 30 && c(v.valor_total) === 30, 'venda 0,30 e lancamentos 0,30', null, JSON.stringify(v.lancamentos.map((l) => l.valor)));
});
caso('C104', 'OS', 'folga de 1 centavo (33,33 x 3 para 100): aceita, mas o financeiro tem de bater com a venda', 'api/api.php:2021 + 3261-3266', async () => {
  const r = await novaOs({ valor_mao_obra: 100, pagamentos: [{ forma_pagamento_id: M.f1, valor: 33.33 }, { forma_pagamento_id: M.f2, valor: 33.33 }, { forma_pagamento_id: M.f1, valor: 33.33 }] });
  exigeStatus(r, 201, 'folga aceita');
  await A.put('/api/os/' + r.json.id, { status: 'entregue' });
  const v = await venda((await ordem(r.json.id)).venda_id);
  const s = soma(ativos(v.lancamentos), (l) => c(l.valor));
  exige(s === c(v.valor_total), 'soma dos lancamentos = total da venda (100,00)', null, `venda=${v.valor_total}, lancamentos=${s / 100}`);
});
caso('C105', 'OS', 'mudar o valor final depois de dividir o pagamento, sem reenviar pagamentos, e recusado ("a API recusa de novo")', 'api/api.php:3396 (memory.md §5)', async () => {
  const r = await novaOs({ valor_mao_obra: 100, pagamentos: [{ forma_pagamento_id: M.f1, valor: 50 }, { forma_pagamento_id: M.f2, valor: 50 }] });
  // ADAPTADO-r3 (decisao 7): o valor final gravado conta como digitado; para mudar o final, ele vem no corpo.
  const rp = await A.put('/api/os/' + r.json.id, { valor_mao_obra: 150, valor_final: 150 });
  let detalhe = `PUT -> ${rp.status} ${resumo(rp)}`;
  if (rp.status === 200) {
    await A.put('/api/os/' + r.json.id, { status: 'entregue' });
    const o = await ordem(r.json.id);
    const v = await venda(o.venda_id);
    detalhe += `; depois de entregar: OS ${o.valor_final}, venda ${v.valor_total}, lancamentos ${soma(ativos(v.lancamentos), (l) => c(l.valor)) / 100}`;
  }
  exige(rp.status === 400, 'PUT 400 (pagamentos 100 nao fecham com 150)', null, detalhe);
});
caso('C106', 'OS', 'cliente novo pela OS: mesmo telefone em outro formato reaproveita o cadastro', 'api/api.php:1671', async () => {
  const t = telFicticio();
  const r1 = await A.post('/api/os', { cliente_nome: unico('Pessoa'), cliente_telefone: t.formatado, modelo_id: M.modelo });
  const r2 = await A.post('/api/os', { cliente_nome: unico('Outro nome'), cliente_telefone: t.digitos, modelo_id: M.modelo });
  exigeStatus(r1, 201); exigeStatus(r2, 201);
  const a = await ordem(r1.json.id), b = await ordem(r2.json.id);
  exige(a.cliente_id === b.cliente_id, 'mesmo cliente_id', null, `${a.cliente_id} x ${b.cliente_id}`);
});
caso('C107', 'OS', 'OS que falha (peca sem saldo) nao deixa cliente novo solto (transacao)', 'api/api.php:3089-3135', async () => {
  const e = await novaEntradaPeca(1);
  const nome = unico('Rollback');
  const r = await A.post('/api/os', { cliente_nome: nome, cliente_telefone: telFicticio().formatado, modelo_id: M.modelo, itens: [{ entrada_id: e, quantidade: 5 }] });
  exigeStatus(r, 400);
  const cls = (await A.get('/api/clientes')).json.itens;
  exige(!cls.some((x) => x.nome === nome), 'cliente nao foi criado', null, 'cliente ficou no cadastro');
});
caso('C108', 'OS', 'validacoes da OS: sem cliente, sem modelo, status invalido, cliente inexistente -> 400; id inexistente -> 404', 'api/api.php:3063,3332', async () => {
  exigeStatus(await A.post('/api/os', { modelo_id: M.modelo }), 400, 'sem cliente');
  exigeStatus(await A.post('/api/os', { cliente_id: M.cliente }), 400, 'sem modelo');
  exigeStatus(await novaOs({ status: 'perdida' }), 400, 'status invalido');
  exigeStatus(await A.post('/api/os', { cliente_id: 99999999, modelo_id: M.modelo }), 400, 'cliente inexistente');
  exigeStatus(await A.get('/api/os/99999999'), 404, 'GET inexistente');
  exigeStatus(await A.put('/api/os/99999999', { status: 'aberta' }), 404, 'PUT inexistente');
  exigeStatus(await A.del('/api/os/99999999'), 404, 'DELETE inexistente');
});
caso('C109', 'OS', 'valores negativos na OS (orcamento, mao de obra, valor final) sao recusados', 'api/api.php:3449-3470', async () => {
  const r = await novaOs({ valor_orcamento: -100, valor_mao_obra: -30, valor_final: -50 });
  let det = `${r.status} ${resumo(r)}`;
  if (r.status === 201) { const o = await ordem(r.json.id); det += ` -> gravou orcamento=${o.valor_orcamento} mao_obra=${o.valor_mao_obra} final=${o.valor_final}`; }
  exige(r.status === 400, 'POST 400', null, det);
});
caso('C110', 'OS', 'valor final digitado acima da soma: venda gerada continua coerente (bruto - desconto = total)', 'api/api.php:3203-3213', async () => {
  const e = await novaEntradaPeca(2, 10, 30);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 30 }], valor_mao_obra: 50, valor_final: 100, status: 'entregue' });
  const v = await venda((await ordem(r.json.id)).venda_id);
  exige(c(v.valor_bruto) - c(v.desconto) === c(v.valor_total) && c(v.valor_total) === 10000,
    'venda: total 100 e bruto - desconto = total', null, `bruto=${v.valor_bruto} desconto=${v.desconto} total=${v.valor_total} itens=${soma(v.lista_itens, (i) => i.subtotal)}`);
});
caso('C111', 'OS', 'mesma peca em duas linhas da OS somando mais que o saldo e recusada', 'api/api.php:2997-3006', async () => {
  const e = await novaEntradaPeca(1);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 10 }, { entrada_id: e, quantidade: 1, valor_unitario: 10 }] });
  const s = await saldo(e);
  exige(r.status === 400 && s === 1, 'POST 400 e saldo 1', r, `POST -> ${r.status}; saldo agora = ${s}`);
});
caso('C112', 'OS', 'PUT que so muda o status nao apaga defeito relatado/diagnostico/observacoes', 'api/api.php:3390-3393', async () => {
  const r = await novaOs({ defeito_relatado: 'tela trincada', diagnostico: 'trocar frontal', observacoes: 'cliente volta 18h' });
  exigeStatus(await A.put('/api/os/' + r.json.id, { status: 'orcamento' }), 200);
  const o = await ordem(r.json.id);
  exige(o.defeito_relatado === 'tela trincada' && o.diagnostico === 'trocar frontal' && o.observacoes === 'cliente volta 18h',
    'campos de texto preservados', null, JSON.stringify({ d: o.defeito_relatado, g: o.diagnostico, o: o.observacoes }));
});
caso('C113', 'OS', 'venda gerada por OS nao se exclui sozinha (400 com o caminho)', 'api/api.php:2330', async () => {
  const r = await novaOs({ valor_mao_obra: 20, status: 'entregue' });
  const vid = (await ordem(r.json.id)).venda_id;
  const d = await A.del('/api/vendas/' + vid);
  exigeStatus(d, 400);
  exige(/OS|ordem/i.test(d.json?.erro || ''), 'mensagem cita a OS', d);
});
caso('C114', 'OS', 'venda gerada por OS tambem nao se CANCELA sozinha (OS entregue nao pode perder a venda)', 'api/api.php:2489-2534', async () => {
  const e = await novaEntradaPeca(1, 10, 40);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 40 }], status: 'entregue' });
  const vid = (await ordem(r.json.id)).venda_id;
  const p = await A.put('/api/vendas/' + vid, { status: 'cancelada' });
  const s = await saldo(e);
  exige(p.status === 400 && s === 0, 'PUT 400 e peca continua fora (saldo 0)', p, `PUT -> ${p.status}; OS segue "${(await ordem(r.json.id)).status}"; saldo da peca = ${s}`);
});

// ---------- 7. Movimentacoes ----------
caso('C120', 'Movimentacoes', 'perda/garantia/devolucao: motivo escolhe o lado; ficha do item bate com o saldo', 'api/api.php:1358,1436', async () => {
  const e = await novaEntradaPeca(5);
  exigeStatus(await A.post('/api/movimentacoes', { entrada_id: e, motivo: 'perda', quantidade: 2 }), 201);
  exigeStatus(await A.post('/api/movimentacoes', { entrada_id: e, motivo: 'garantia', quantidade: 1 }), 201);
  exigeStatus(await A.post('/api/movimentacoes', { entrada_id: e, motivo: 'devolucao', quantidade: 1 }), 201);
  exige((await saldo(e)) === 3, 'saldo 5 - 2 + 1 - 1 = 3', null, String(await saldo(e)));
  const f = await A.get('/api/movimentacoes?entrada_id=' + e);
  exige(f.json.saldo === 3 && f.json.movimentos.length === 4, 'ficha: saldo 3 e 4 linhas', f);
});
caso('C121', 'Movimentacoes', 'baixa maior que o saldo e recusada; motivo invalido recusado; entrada inexistente nao da 500', 'api/api.php:1391', async () => {
  const e = await novaEntradaPeca(2);
  exigeStatus(await A.post('/api/movimentacoes', { entrada_id: e, motivo: 'perda', quantidade: 3 }), 400, 'baixa 3 com saldo 2');
  exigeStatus(await A.post('/api/movimentacoes', { entrada_id: e, motivo: 'furto', quantidade: 1 }), 400, 'motivo invalido');
  exigeStatus(await A.post('/api/movimentacoes', { entrada_id: 99999999, motivo: 'perda', quantidade: 1 }), [400, 404], 'entrada inexistente 400/404');
  exigeStatus(await A.del('/api/movimentacoes/99999999'), 404, 'DELETE inexistente 404');
});
caso('C122', 'Movimentacoes', 'quantidade 0 ou negativa na movimentacao e recusada (nao vira 1)', 'api/api.php:1383', async () => {
  const e = await novaEntradaPeca(5);
  const r = await A.post('/api/movimentacoes', { entrada_id: e, motivo: 'perda', quantidade: -4 });
  exige(r.status === 400, 'POST 400', r, `POST -> ${r.status}; saldo ficou ${await saldo(e)} (era 5)`);
});
caso('C123', 'Movimentacoes', 'desfazer (DELETE) uma entrada de garantia ja consumida nao pode deixar saldo negativo', 'api/api.php:1414-1420', async () => {
  const e = await novaEntradaPeca(1);
  const m = (await A.post('/api/movimentacoes', { entrada_id: e, motivo: 'garantia', quantidade: 1 })).json.id;
  exigeStatus(await A.post('/api/vendas', { itens: [{ entrada_id: e, quantidade: 2 }] }), 201, 'vende as 2');
  const d = await A.del('/api/movimentacoes/' + m);
  const s = await saldo(e);
  exige(d.status === 400 && s === 0, 'DELETE 400 e saldo 0', d, `DELETE -> ${d.status}; saldo agora = ${s}`);
});
caso('C124', 'Movimentacoes', 'ficha consolidada do item (?peca_id) = soma dos saldos dos lotes depois de compra, venda, OS e movimentacao', 'api/api.php:1436', async () => {
  const pecaId = await novaPecaCatalogo();
  const l1 = (await A.post('/api/entradas', { tipo: 'peca', peca_id: pecaId, quantidade: 4, valor_investimento: 10, valor_venda: 30 })).json.id;
  const l2 = (await A.post('/api/entradas', { tipo: 'peca', peca_id: pecaId, quantidade: 3, valor_investimento: 11, valor_venda: 30 })).json.id;
  await A.post('/api/vendas', { itens: [{ entrada_id: l1, quantidade: 2 }] });
  const os = await novaOs({ itens: [{ entrada_id: l2, quantidade: 1, valor_unitario: 30 }], status: 'entregue' });
  await novaOs({ itens: [{ entrada_id: l2, quantidade: 1, valor_unitario: 30 }] });
  await A.post('/api/movimentacoes', { entrada_id: l1, motivo: 'perda', quantidade: 1 });
  const f = await A.get('/api/movimentacoes?peca_id=' + pecaId);
  const esperado = (await saldo(l1)) + (await saldo(l2));
  exige(f.json.saldo === esperado && esperado === 2, `ficha.saldo = ${esperado} (=2)`, f, `ficha=${f.json?.saldo} view=${esperado}`);
  exige(os.status === 201, 'OS criada', os);
});

// ---------- 8. Lancamentos ----------
caso('C130', 'Lancamentos', 'manual: cria, filtra por tipo/status/data, baixa carimba data, voltar a pendente limpa', 'api/api.php:2580,2792', async () => {
  const r = await A.post('/api/lancamentos', { tipo: 'pagar', descricao: unico('Aluguel'), valor: 150.75, vencimento: '2026-11-05', categoria: 'aluguel' });
  exigeStatus(r, 201);
  const f = await A.get('/api/lancamentos?tipo=pagar&status=pendente&de=2026-11-05&ate=2026-11-05');
  exige(f.json.itens.some((l) => l.id === r.json.id), 'aparece no filtro', f);
  exigeStatus(await A.put('/api/lancamentos/' + r.json.id, { status: 'pago' }), 200);
  const l1 = (await lancamento(r.json.id)).json.lancamento;
  exige(l1.status === 'pago' && l1.data_pagamento, 'pago com data', null, JSON.stringify(l1));
  await A.put('/api/lancamentos/' + r.json.id, { status: 'pendente' });
  const l2 = (await lancamento(r.json.id)).json.lancamento;
  exige(l2.data_pagamento === null, 'pendente sem data', null, JSON.stringify(l2));
});
caso('C131', 'Lancamentos', 'validacoes: valor 0/negativo, tipo/status invalido, sem descricao -> 400; id inexistente -> 404', 'api/api.php:2792', async () => {
  exigeStatus(await A.post('/api/lancamentos', { tipo: 'pagar', descricao: 'x', valor: 0 }), 400, 'valor 0');
  exigeStatus(await A.post('/api/lancamentos', { tipo: 'pagar', descricao: 'x', valor: -5 }), 400, 'valor negativo');
  exigeStatus(await A.post('/api/lancamentos', { tipo: 'doar', descricao: 'x', valor: 5 }), 400, 'tipo invalido');
  exigeStatus(await A.post('/api/lancamentos', { tipo: 'pagar', descricao: 'x', valor: 5, status: 'talvez' }), 400, 'status invalido');
  exigeStatus(await A.post('/api/lancamentos', { tipo: 'pagar', valor: 5 }), 400, 'sem descricao');
  exigeStatus(await A.get('/api/lancamentos/99999999'), 404);
  exigeStatus(await A.put('/api/lancamentos/99999999', { valor: 1 }), 404);
  exigeStatus(await A.del('/api/lancamentos/99999999'), 404);
});
caso('C132', 'Lancamentos', 'alterar valor/parcela grava log com antes e depois (nomes, nao ids)', 'api/api.php:2738', async () => {
  const r = await A.post('/api/lancamentos', { tipo: 'receber', descricao: unico('Log'), valor: 10, total_parcelas: 1, vencimento: DIA });
  await A.put('/api/lancamentos/' + r.json.id, { valor: 12.5, total_parcelas: 3, parcela: 2, forma_pagamento_id: M.f1 });
  const g = (await lancamento(r.json.id)).json.log;
  const campos = g.map((x) => x.campo).sort().join(',');
  exige(/Valor/.test(campos) && /Parcela/.test(campos) && /Total de parcelas/.test(campos) && /Forma/.test(campos), 'log com Valor, Parcela, Total, Forma', null, JSON.stringify(g));
});
caso('C133', 'Lancamentos', 'DELETE so para origem manual (LEIA-ME/cabecalho da API): conta de compra (origem entrada) nao se apaga', 'api/api.php:2712-2719 vs api/api.php:33', async () => {
  const p = await novaPecaCatalogo();
  const en = (await A.post('/api/entradas', { tipo: 'peca', peca_id: p, quantidade: 1, valor_investimento: 9, gerar_conta_pagar: 'pago' })).json.id;
  const lid = (await A.get('/api/lancamentos')).json.itens.find((l) => l.entrada_id === en).id;
  const d = await A.del('/api/lancamentos/' + lid);
  exigeStatus(d, 400, 'DELETE de lancamento origem "entrada" -> 400');
});
caso('C134', 'Lancamentos', 'lancamento ja quitado nunca e apagado: vira cancelado (memory.md §2)', 'api/api.php:2719', async () => {
  const r = await A.post('/api/lancamentos', { tipo: 'pagar', descricao: unico('Pago'), valor: 33, status: 'pago', vencimento: DIA });
  const d = await A.del('/api/lancamentos/' + r.json.id);
  const g = await lancamento(r.json.id);
  exige(d.status === 400 || (g.status === 200 && g.json.lancamento.status === 'cancelado'), 'recusa ou converte em cancelado', d, `DELETE -> ${d.status}; GET depois -> ${g.status}`);
});
caso('C135', 'Lancamentos', 'excluir lancamento manual pendente funciona', 'api/api.php:2719', async () => {
  const r = await A.post('/api/lancamentos', { tipo: 'pagar', descricao: unico('Apagavel'), valor: 5, vencimento: DIA });
  exigeStatus(await A.del('/api/lancamentos/' + r.json.id), 200);
  exigeStatus(await lancamento(r.json.id), 404);
});

// ---------- 9. Resumo, financeiro e relatorios ----------
caso('C140', 'Relatorios', 'DRE do mes: venda +receita/+custo, despesa manual +despesa, compra de estoque NAO e despesa, cancelado nao conta', 'api/api.php:602-707', async () => {
  const a = mesAtual(await relat());
  const e = await novaEntradaPeca(3, 25, 60, { gerar_conta_pagar: 'pago' });    // compra: nao e despesa
  await A.post('/api/vendas', { itens: [{ entrada_id: e, quantidade: 2 }] });      // +120 receita, +50 custo
  await A.post('/api/lancamentos', { tipo: 'pagar', descricao: unico('Energia'), valor: 45.5, vencimento: DIA, origem: 'manual' });
  const canc = await A.post('/api/lancamentos', { tipo: 'pagar', descricao: unico('Cancelada'), valor: 999, vencimento: DIA });
  await A.put('/api/lancamentos/' + canc.json.id, { status: 'cancelado' });
  const b = mesAtual(await relat());
  const d = (k) => c(b[k]) - c(a[k]);
  exige(d('receita') === 12000 && d('custo') === 5000 && d('despesas') === 4550 && d('lucro_liquido') === 12000 - 5000 - 4550,
    'delta receita 120, custo 50, despesas 45,50, lucro liquido 24,50', null,
    `receita ${d('receita') / 100}, custo ${d('custo') / 100}, despesas ${d('despesas') / 100}, lucro ${d('lucro_liquido') / 100}`);
});
caso('C141', 'Relatorios', 'janela de 12 meses do dia 1 (item 23); serie diaria sem dia repetido nem fora da janela; o DRE da tela (dre.js) sobre a serie fecha a conta do mes', 'api/rotas/painel.php relatorios() + Dashboard/dre.js', async () => {
  // ADAPTADO-r2 (decisao item 30): "mensal"/"totais" sairam do servidor; o DRE virou da tela.
  // Em vez de so conferir o formato (como o dev), reimporto o dre.js REAL do front e passo
  // a serie diaria por ele - prova de ponta a ponta de que a conta que o dono ve fecha.
  // ADAPTADO-r3: o front dividiu o calculos.js; a formula do DRE mora em Dashboard/dre.js (CommonJS).
  // ADAPTADO-r4 (item 19): nomes e mensagens falam do dre.js, o arquivo que existe.
  const dre = (await import('file://' + path.resolve(AQUI, '..', 'Dashboard', 'dre.js').replace(/\\/g, '/'))).default;
  const r = await relat();
  const ruins = [];
  if (r.mensal !== undefined || r.totais !== undefined) ruins.push('mensal/totais ainda vem do servidor (deveria ser so da tela)');
  const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1);
  const desdeEsperado = `${ini.getFullYear()}-${pad(ini.getMonth() + 1)}-01`;
  if (r.desde !== desdeEsperado) ruins.push(`desde=${r.desde}, esperado ${desdeEsperado}`);
  if (new Set(r.diario.map((d) => d.dia)).size !== r.diario.length) ruins.push('dia repetido na serie diaria');
  for (const d of r.diario) if (d.dia < r.desde) ruins.push(`dia ${d.dia} antes da janela`);
  // dre.js (tela) deve agregar a serie exatamente como a soma crua dela
  const baldes = dre.agregarPeriodo(r.diario, r.desde, r.ate, '');
  const t = dre.totalizar(baldes);
  const cruRec = soma(r.diario.filter((d) => d.dia >= r.desde && d.dia <= r.ate), (d) => c(d.receita_vendas) + c(d.receita_os));
  if (c(t.receita) !== cruRec) ruins.push(`dre.js receita ${t.receita} x soma crua ${cruRec / 100}`);
  if (c(t.lucro_liquido) !== c(t.receita) - c(t.custo) - c(t.despesas)) ruins.push('dre.js: lucro != receita-custo-despesas');
  // o mes atual pela tela = o mesmo mes pela minha soma independente
  const mesTela = dre.totalizar(baldes.filter((b) => b.mes === MES));
  const mesMeu = mesAtual(r);
  if (c(mesTela.receita) !== c(mesMeu.receita)) ruins.push(`mes ${MES}: tela ${mesTela.receita} x meu ${mesMeu.receita}`);
  exige(ruins.length === 0, 'janela certa e DRE da tela fecha com a serie', null, ruins.join(' | '));
});
caso('C142', 'Relatorios', 'financeiro: a receber/a pagar/recebido/pago = soma dos lancamentos; saldo previsto = receber - pagar', 'api/api.php:514-577', async () => {
  const f = await fin();
  const ls = (await A.get('/api/lancamentos')).json.itens;
  const s = (tipo, st) => soma(ls.filter((l) => l.tipo === tipo && l.status === st), (l) => c(l.valor));
  const ruins = [];
  if (c(f.lancamentos.a_receber) !== s('receber', 'pendente')) ruins.push(`a_receber ${f.lancamentos.a_receber} x ${s('receber', 'pendente') / 100}`);
  if (c(f.lancamentos.a_pagar) !== s('pagar', 'pendente')) ruins.push(`a_pagar ${f.lancamentos.a_pagar} x ${s('pagar', 'pendente') / 100}`);
  if (c(f.lancamentos.recebido) !== s('receber', 'pago')) ruins.push('recebido');
  if (c(f.lancamentos.pago) !== s('pagar', 'pago')) ruins.push('pago');
  if (c(f.saldo_previsto) !== c(f.lancamentos.a_receber) - c(f.lancamentos.a_pagar)) ruins.push('saldo_previsto');
  exige(ruins.length === 0, 'tudo bate', null, ruins.join(' | '));
});
caso('C143', 'Relatorios', 'financeiro: receita de vendas + oficina = soma das vendas concluidas (+ OS antigas sem venda), sem dupla contagem', 'api/api.php:488-576', async () => {
  const f = await fin();
  const vs = (await A.get('/api/vendas')).json.itens.filter((v) => v.status === 'concluida');
  const totalVendas = soma(vs, (v) => c(v.valor_total));
  const legado = soma((await A.get('/api/os')).json.itens.filter((o) => o.status === 'entregue' && !o.venda_id), (o) => c(o.valor_final));
  const api = c(f.vendas.receita_vendas) + c(f.os.receita_os);
  exige(api === totalVendas + legado, 'receita_vendas + receita_os = vendas concluidas + OS legado', null, `api=${api / 100} esperado=${(totalVendas + legado) / 100}`);
});
caso('C144', 'Relatorios', 'resumo: card total = soma do saldo das entradas nao vendidas com saldo', 'api/api.php:408', async () => {
  const r = (await A.get('/api/resumo')).json;
  // ADAPTADO-r2 (decisao item 29 e LEIA-ME:623 "cards do dashboard (celulares)"): os cards do
  // /resumo sao so de celular. (O texto do LEIA-ME:189 ainda diz "estoque INTEIRO" - contradicao.)
  const es = (await A.get('/api/entradas')).json.itens.filter((e) => e.tipo === 'celular' && e.situacao !== 'vendido' && e.saldo > 0);
  exige(r.cards.total.quantidade === soma(es, (e) => e.saldo), 'cards.total.quantidade = soma dos saldos de celular', null, `${r.cards.total.quantidade} x ${soma(es, (e) => e.saldo)}`);
});
caso('C145', 'Relatorios', 'rosca "como o cliente pagou": OS com pagamento dividido aparece dividida (50 forma A + 30 forma B)', 'api/api.php:884-898', async () => {
  const fa = (await A.post('/api/formas-pagamento', { nome: unico('RoscaA') })).json.id;
  const fb = (await A.post('/api/formas-pagamento', { nome: unico('RoscaB') })).json.id;
  const r = await novaOs({ valor_mao_obra: 80, pagamentos: [{ forma_pagamento_id: fa, valor: 50 }, { forma_pagamento_id: fb, valor: 30 }], status: 'entregue' });
  exigeStatus(r, 201);
  const pg = (await relat()).pagamentos;
  const nomes = (await A.get('/api/formas-pagamento')).json.itens;
  const na = nomes.find((x) => x.id === fa).nome, nb = nomes.find((x) => x.id === fb).nome;
  const va = soma(pg.filter((p) => p.forma === na), (p) => c(p.total)), vb = soma(pg.filter((p) => p.forma === nb), (p) => c(p.total));
  exige(va === 5000 && vb === 3000, 'forma A 50,00 e forma B 30,00', null, `forma A ${va / 100}, forma B ${vb / 100}`);
});

// ---------- 10. Geral ----------
caso('C150', 'Geral', 'rota inexistente 404, JSON invalido 400, metodo errado 405 - nunca 500', 'api/api.php:155,195,386', async () => {
  exigeStatus(await A.get('/api/naoexiste'), 404);
  exigeStatus(await A.r('POST', '/api/clientes', '{nome: "sem aspas"'), 400, 'JSON quebrado -> 400');
  exigeStatus(await A.del('/api/resumo'), 405);
  exigeStatus(await A.r('PATCH', '/api/clientes/1', '{}'), 405, 'PATCH -> 405');
});
caso('C151', 'Geral', 'id nao numerico na URL nao vira operacao na lista (ex.: DELETE /api/clientes/abc)', 'api/api.php:254', async () => {
  const r = await A.del('/api/clientes/abc');
  exigeStatus(r, [400, 404], 'DELETE /api/clientes/abc -> 400/404');
  const g = await A.get('/api/os/abc');
  exige(g.status === 400 || g.status === 404, 'GET /api/os/abc -> 400/404 (nao a lista)', g);
});
caso('C152', 'Geral', 'campo de texto com tipo errado (array/objeto) nao derruba a API com 500', 'api/api.php:168-184', async () => {
  const falhos = [];
  const tent = [
    ['POST', '/api/clientes', { nome: ['a', 'b'] }],
    ['POST', '/api/lancamentos', { tipo: 'pagar', descricao: 'x', valor: { a: 1 } }],
    ['POST', '/api/vendas', { itens: 'abc' }],
    ['POST', '/api/vendas', { itens: [{ descricao: 'x', valor_unitario: [1] }] }],
    ['POST', '/api/os', { cliente_id: M.cliente, modelo_id: M.modelo, pagamentos: 'x' }],
  ];
  for (const [m, p, b] of tent) {
    const r = await A.r(m, p, b);
    if (r.status >= 500) falhos.push(`${m} ${p} ${JSON.stringify(b)} -> ${r.status} ${resumo(r).slice(0, 120)}`);
  }
  exige(falhos.length === 0, 'nenhum 500', null, falhos.join(' | '));
});
caso('C153', 'Geral', 'pasta dados\\ bloqueada: o banco nao baixa por nenhuma variacao de caminho', 'servidor.php:44-60', async () => {
  const urls = ['/dados/index.sqlite', '/DADOS/index.sqlite', '/dados%2Findex.sqlite', '//dados/index.sqlite',
    '/./dados/index.sqlite', '/Login/../dados/index.sqlite', '/dados./index.sqlite', '/dados%20/index.sqlite', '/dados::$DATA/index.sqlite',
    '/Img/..%2fdados/index.sqlite', '/Login/..%2Fdados%2Findex.sqlite',
    '/dados/index.sqlite.antes-v3', '/dados/index.sqlite.antes-servicos', '/LEIA-ME.txt', '/memory.md',
    '/dados/estrutura.sql', '/dados/aplicar-estrutura.php', '/servidor.php', '/api/api.php'];
  const vazou = [];
  for (const u of urls) {
    // fetch normaliza "../" e "./"; o socket cru manda do jeito que esta
    const res = await cru(u);
    const corpo = res.replace(/^.*?\r\n\r\n/s, '');
    const ok200 = /^HTTP\/1\.\d 200/.test(res);
    if (ok200 && (/SQLite format 3/.test(res) || /admin\/admin|gilberto|2024|pbkdf2\$|<\?php/.test(corpo))) vazou.push(u);
  }
  exige(vazou.length === 0, 'nenhuma URL devolve banco, backup, fonte ou doc interno', null, 'VAZOU por: ' + vazou.join(', '));
});

// ====== CASOS NOVOS (regras da rodada 2) ======

// --- Troca obrigatoria de senha (item 2/17) ---
// v9 (12/11/2026): no banco de teste a senha fraca NAO obriga a trocar (acesso
// rapido p / p da demonstracao). Roda antes do C200, que troca a senha do legado.
caso('C200a', 'v9 Senha', 'banco de teste ligado: a conta de senha fraca entra sem trocar; desligado, volta a obrigar', 'api/rotas/acesso.php login()', async () => {
  if (!process.env.FRACO_USER) { exige(true, 'pulado: sem FRACO_USER', null, 'sem conta de senha fraca para este alvo'); return; }
  const regra = (valor) => A.post('/api/chaves', { chave: 'sistema.banco_de_teste', escopo: 'geral', valor });
  exigeStatus(await regra('1'), 200, 'liga o banco de teste');
  let r;
  try {
    const s = new Sessao('c200a');
    r = await s.login(process.env.FRACO_USER, process.env.FRACO_SENHA);
    exige(r.status === 200 && r.json.usuario.trocar_senha === false, 'banco de teste: login 200 com trocar_senha=false', r);
    exigeStatus(await s.get('/api/resumo'), 200, 'banco de teste: /resumo libera sem trocar');
  } finally {
    exigeStatus(await regra(null), 200, 'desliga o banco de teste');
  }
  r = await new Sessao('c200a2').login(process.env.FRACO_USER, process.env.FRACO_SENHA);
  exige(r.status === 200 && r.json.usuario.trocar_senha === true, 'desligado: volta a obrigar a trocar', r);
});
caso('C200', 'r2 Senha', 'conta com senha fraca: login ok mas so /config e /trocar-senha liberam (403 trocar_senha no resto); trocar libera', 'api/api.php:650-660, 686', async () => {
  // Precisa de uma conta com senha fraca. Em banco novo/real passo pelo ambiente
  // (FRACO_USER/FRACO_SENHA). Sem isso, o caso nao tem como existir e e pulado.
  if (!process.env.FRACO_USER) { exige(true, 'pulado: sem FRACO_USER', null, 'sem conta de senha fraca para este alvo'); return; }
  const s = new Sessao('c200');
  const r = await s.login(process.env.FRACO_USER, process.env.FRACO_SENHA);
  exige(r.status === 200 && r.json.usuario.trocar_senha === true, 'login 200 com trocar_senha=true', r);
  const resumo = await s.get('/api/resumo');
  exige(resumo.status === 403 && resumo.json.trocar_senha === true, '/resumo 403 com trocar_senha:true', resumo);
  exigeStatus(await s.get('/api/clientes'), 403, '/clientes 403 antes de trocar');
  exigeStatus(await s.get('/api/config'), 200, '/config liberado antes de trocar');
  exigeStatus(await s.post('/api/trocar-senha', { senha_atual: process.env.FRACO_SENHA, senha_nova: '12345678' }), 400, 'senha nova comum -> 400');
  const nova = 'Forte-R2-' + Date.now().toString(36);
  exigeStatus(await s.post('/api/trocar-senha', { senha_atual: process.env.FRACO_SENHA, senha_nova: nova }), 200, 'troca para senha forte -> 200');
  exigeStatus(await s.get('/api/resumo'), 200, 'depois de trocar, /resumo libera');
});
caso('C201', 'r2 Senha', 'POST/PUT de usuario recusa senha fraca (< 8, comum ou = login); forte passa', 'api/api.php:278-291', async () => {
  const lg = ('fraco' + RUN).toLowerCase();
  exigeStatus(await A.post('/api/usuarios', { usuario: lg, nome: 'x', senha: 'abc', perfil: 'balcao' }), 400, 'senha curta -> 400');
  exigeStatus(await A.post('/api/usuarios', { usuario: lg, nome: 'x', senha: '12345678', perfil: 'balcao' }), 400, 'senha comum -> 400');
  exigeStatus(await A.post('/api/usuarios', { usuario: lg, nome: 'x', senha: lg + 'xx', perfil: 'balcao' }), [201, 400], 'senha != login');
  const ok = await A.post('/api/usuarios', { usuario: 'ok' + lg, nome: 'x', senha: 'Senha-Forte-9', perfil: 'balcao' });
  exigeStatus(ok, 201, 'senha forte -> 201');
});

// --- Bloqueio de login (item 17) --- isola o IP: so roda com TESTAR_BLOQUEIO=1 (servidor descartavel)
caso('C202', 'r2 Login', '5 erros seguidos travam o login com 429 por 15 min, e a senha certa tambem leva 429 enquanto bloqueado', 'api/api.php:686-745', async () => {
  if (!process.env.TESTAR_BLOQUEIO) { exige(true, 'pulado: evita travar o IP das outras rodadas', null, 'rodar so em servidor descartavel'); return; }
  const lg = ('bloq' + RUN).toLowerCase();
  const senha = 'Senha-Boa-123';
  exigeStatus(await A.post('/api/usuarios', { usuario: lg, nome: 'x', senha, perfil: 'balcao' }), 201);
  const s = new Sessao('c202');
  let viu429 = false;
  for (let i = 0; i < 5; i++) {
    const r = await s.login(lg, 'errada' + i);
    if (r.status === 429) viu429 = true;
  }
  const bloqueado = await s.login(lg, 'errada-mais');
  exige(bloqueado.status === 429, 'apos 5 erros -> 429', bloqueado);
  const comSenhaCerta = await s.login(lg, senha);
  exige(comSenhaCerta.status === 429, 'senha CERTA tambem recebe 429 enquanto bloqueado (nem confere)', comSenhaCerta);
});

// --- 409 de versao da OS (item 10) ---
caso('C203', 'r2 OS', 'PUT com atualizado_em desatualizado -> 409; com o atual -> 200', 'api/api.php:4145-4149', async () => {
  const r = await novaOs({ defeito_relatado: 'teste 409' });
  exigeStatus(r, 201);
  const o = await ordem(r.json.id);
  const versao = o.atualizado_em;
  exige(versao, 'GET da OS traz atualizado_em', null, JSON.stringify(Object.keys(o)));
  const velho = await A.put('/api/os/' + r.json.id, { status: 'orcamento', atualizado_em: '2000-01-01 00:00:00.000' });
  exige(velho.status === 409, 'versao velha -> 409', velho);
  const ok = await A.put('/api/os/' + r.json.id, { status: 'orcamento', atualizado_em: versao });
  exigeStatus(ok, 200, 'versao atual -> 200');
});

// --- Perfis 403 (item 18) ---
caso('C204', 'r2 Perfis', 'tecnico/balcao: 403 em financeiro, relatorios, lancamentos e em qualquer DELETE; GET de cadastro continua', 'api/api.php:780-790', async () => {
  for (const perfil of ['tecnico', 'balcao']) {
    const lg = (`pf${perfil}${RUN}`).toLowerCase();
    exigeStatus(await criarUsuarioPronto({ usuario: lg, nome: 'x', senha: SENHA_U, perfil }), 201); // ADAPTADO-r3 (decisao 27)
    const s = new Sessao(perfil);
    exigeStatus(await s.login(lg, SENHA_U), 200);
    for (const rota of ['financeiro', 'relatorios', 'lancamentos']) {
      exigeStatus(await s.get('/api/' + rota), 403, `${perfil} GET /${rota} -> 403`);
    }
    exigeStatus(await s.del('/api/clientes/1'), 403, `${perfil} DELETE -> 403`);
    exigeStatus(await s.get('/api/clientes'), 200, `${perfil} GET /clientes -> 200`);
    const rs = await s.get('/api/resumo');
    exige(rs.status === 200 && (rs.json.cards.total.investido === undefined || rs.json.cards.total.investido === 0 || !('investido' in rs.json.cards.total)),
      `${perfil}: /resumo sem valor investido`, rs);
  }
});

// --- Venda/OS cancelada é estado final (item 5) ---
caso('C205', 'r2 Venda', 'venda cancelada nao reativa (400) e nao se altera, so observacoes', 'api/api.php:3148-3156', async () => {
  const id = await vendaAvulsa(50, 1);
  exigeStatus(await A.put('/api/vendas/' + id, { status: 'cancelada' }), 200);
  exigeStatus(await A.put('/api/vendas/' + id, { status: 'concluida' }), 400, 'reativar -> 400');
  exigeStatus(await A.put('/api/vendas/' + id, { desconto: 5 }), 400, 'mudar valor de cancelada -> 400');
  exigeStatus(await A.put('/api/vendas/' + id, { observacoes: 'obs nova' }), 200, 'so observacoes -> 200');
});
caso('C206', 'r2 OS', 'OS cancelada nao reabre (400); OS recusada pode voltar e o saldo e conferido', 'api/api.php:4157-4160', async () => {
  const c1 = await novaOs({ defeito_relatado: 'x' });
  await A.put('/api/os/' + c1.json.id, { status: 'cancelada' });
  exigeStatus(await A.put('/api/os/' + c1.json.id, { status: 'em_reparo' }), 400, 'cancelada -> 400');
  const e = await novaEntradaPeca(1);
  const c2 = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 10 }] });
  await A.put('/api/os/' + c2.json.id, { status: 'recusada' });
  await A.post('/api/vendas', { itens: [{ entrada_id: e }] });   // a peca devolvida e vendida
  const volta = await A.put('/api/os/' + c2.json.id, { status: 'em_reparo' });
  const s = await saldo(e);
  exige(volta.status === 400 && s === 0, 'recusada volta so se houver saldo; aqui 400 e saldo 0', volta, `PUT -> ${volta.status}; saldo = ${s}`);
});

// --- Venda de OS só muda pela OS (item 6) ---
caso('C207', 'r2 Venda', 'venda gerada por OS: cancelar, mudar valor/forma/cliente -> 400 ("altere pela OS")', 'api/api.php:3175-3181', async () => {
  const r = await novaOs({ valor_mao_obra: 60, status: 'entregue' });
  const vid = (await ordem(r.json.id)).venda_id;
  exige(vid, 'OS gerou venda', null, JSON.stringify(await ordem(r.json.id)));
  const cancelar = await A.put('/api/vendas/' + vid, { status: 'cancelada' });
  exige(cancelar.status === 400 && /OS|ordem/i.test(cancelar.json?.erro || ''), 'cancelar -> 400 citando a OS', cancelar);
  exigeStatus(await A.put('/api/vendas/' + vid, { desconto: 10 }), 400, 'mudar desconto -> 400');
  exigeStatus(await A.put('/api/vendas/' + vid, { forma_pagamento_id: M.f2 }), 400, 'mudar forma -> 400');
});

// --- Desconto refaz lançamentos (item 7) ---
caso('C208', 'r2 Venda', 'mudar o desconto refaz as parcelas: a receber = novo total; com parcela paga, recusa', 'api/api.php:3183-3199', async () => {
  const id = await vendaAvulsa(100, 1);
  exigeStatus(await A.put('/api/vendas/' + id, { desconto: 20 }), 200);
  let v = await venda(id);
  const aberto = soma(ativos(v.lancamentos), (l) => c(l.valor));
  exige(c(v.valor_total) === 8000 && aberto === 8000, 'venda 80 e a receber 80', null, `total=${v.valor_total} aberto=${aberto / 100}`);
  // agora com parcela paga
  const id2 = await vendaAvulsa(100, 1, { pago: true });
  // ADAPTADO-r3 (decisao 4): com parcela paga, o pago continua pago e a diferenca vira devolucao a pagar.
  const r2 = await A.put('/api/vendas/' + id2, { desconto: 30 });
  const v2 = await venda(id2);
  const pago = v2.lancamentos.filter((l) => l.tipo === 'receber' && l.status === 'pago');
  const dev = v2.lancamentos.filter((l) => l.tipo === 'pagar' && l.status === 'pendente');
  exige(r2.status === 200 && /devolu/i.test(r2.json?.mensagem || '') && pago.length === 1 && c(pago[0].valor) === 10000
    && dev.length === 1 && c(dev[0].valor) === 3000 && c(v2.valor_total) === 7000,
    'com parcela paga: 200; o pago (100) segue pago e nasce devolucao de 30 a pagar', r2, JSON.stringify(v2.lancamentos.map((l) => [l.tipo, l.status, l.valor])));
});

// --- Lançamento quitado não se apaga (item 24) ---
caso('C209', 'r2 Financeiro', 'lancamento quitado nao se exclui (400); vira cancelado pelo PUT e segue no historico', 'api/api.php:lancamentos DELETE/PUT', async () => {
  const r = await A.post('/api/lancamentos', { tipo: 'pagar', descricao: unico('Quit'), valor: 40, status: 'pago', vencimento: DIA });
  exigeStatus(await A.del('/api/lancamentos/' + r.json.id), 400, 'DELETE de quitado -> 400');
  exigeStatus(await A.put('/api/lancamentos/' + r.json.id, { status: 'cancelado' }), 200, 'PUT para cancelado -> 200');
  const l = await lancamento(r.json.id);
  exige(l.status === 200 && l.json.lancamento.status === 'cancelado', 'continua existindo como cancelado', l);
  exigeStatus(await A.del('/api/lancamentos/' + r.json.id), 400, 'cancelado tambem nao se apaga');
});
caso('C210', 'r2 Financeiro', 'lancamento de venda nao se exclui nem muda valor/tipo pelo financeiro', 'api/api.php:lancamentos', async () => {
  const id = await vendaAvulsa(70, 1);
  const lid = (await venda(id)).lancamentos[0].id;
  exigeStatus(await A.del('/api/lancamentos/' + lid), 400, 'excluir -> 400');
  exigeStatus(await A.put('/api/lancamentos/' + lid, { valor: 5 }), 400, 'mudar valor -> 400');
});

// --- IMEI único (item 27) ---
caso('C211', 'r2 Entradas', 'IMEI repetido recusado (400 citando a entrada); 14 digitos recusado; limpa espaco/traco', 'api/api.php:1730-1745', async () => {
  // ADAPTADO-r3 (decisao 25): o IMEI de teste precisa do digito verificador certo.
  const imei = comLuhn('35' + String(Date.now() % 1e12).padStart(12, '0'));
  const e1 = await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei, valor_investimento: 100, gerar_conta_pagar: '' });
  exigeStatus(e1, 201, '1o celular com IMEI novo -> 201');
  const e2 = await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei, valor_investimento: 100, gerar_conta_pagar: '' });
  exige(e2.status === 400 && /IMEI/i.test(e2.json?.erro || ''), 'IMEI repetido -> 400', e2);
  // mesmo IMEI com mascara (espaco/traco) continua sendo o mesmo -> 400
  const mascarado = imei.slice(0, 2) + ' ' + imei.slice(2, 8) + '-' + imei.slice(8);
  exigeStatus(await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei: mascarado, valor_investimento: 1, gerar_conta_pagar: '' }), 400, 'mesmo IMEI mascarado -> 400');
  exigeStatus(await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei: '12345678901234', valor_investimento: 1, gerar_conta_pagar: '' }), 400, '14 digitos -> 400');
});

// --- Parcelas 1..24 e valor máximo (item 20/14) ---
caso('C212', 'r2 Limites', 'parcelas fora de 1..24 recusadas; valor acima de R$ 10 mi recusado; parcelas sugeridas da forma limitadas', 'api/api.php:PARCELAS_MAX/VALOR_MAXIMO', async () => {
  exigeStatus(await A.post('/api/vendas', { itens: [{ descricao: 'x', valor_unitario: 10 }], parcelas: 25 }), 400, '25 parcelas -> 400');
  exigeStatus(await A.post('/api/vendas', { itens: [{ descricao: 'x', valor_unitario: 10 }], parcelas: 1000 }), 400, '1000 parcelas -> 400');
  exigeStatus(await A.post('/api/vendas', { itens: [{ descricao: 'x', valor_unitario: 20000000 }] }), 400, 'acima de 10 mi -> 400');
  exigeStatus(await A.post('/api/formas-pagamento', { nome: unico('F999'), parcelas_padrao: 999999999999 }), 400, 'parcelas sugeridas absurdas -> 400');
  const ok24 = await A.post('/api/vendas', { itens: [{ descricao: 'x', valor_unitario: 240 }], parcelas: 24 });
  exigeStatus(ok24, 201, '24 parcelas -> 201');
});

// --- Fim de mês (item 23/38) ---
caso('C213', 'r2 Datas', 'janela de relatorios comeca no dia 1 e cobre 12 meses mesmo rodando perto do fim do mes', 'api/api.php relatorios()', async () => {
  const r = await relat();
  const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1);
  const esperado = `${ini.getFullYear()}-${pad(ini.getMonth() + 1)}-01`;
  exige(r.desde === esperado, `desde = ${esperado} (dia 1, 11 meses atras)`, null, `desde=${r.desde}`);
  const meses = new Set(); for (let i = 0; i < 12; i++) { const m = new Date(ini.getFullYear(), ini.getMonth() + i, 1); meses.add(`${m.getFullYear()}-${pad(m.getMonth() + 1)}`); }
  exige(meses.size === 12 && meses.has(MES), '12 meses distintos terminando no mes atual', null, [...meses].join(','));
});
caso('C214', 'r2 Datas', 'vencimento 31/01 parcelado nao pula fevereiro (28/02) nem 31/03', 'api/api.php somarMeses', async () => {
  const id = await vendaAvulsa(30, 3, { vencimento: '2027-01-31' });
  const ls = (await venda(id)).lancamentos.map((l) => l.vencimento);
  exige(ls[0] === '2027-01-31' && ls[1] === '2027-02-28' && ls[2] === '2027-03-31', 'vencimentos 31/01, 28/02, 31/03', null, ls.join(', '));
});
caso('C215', 'r2 OS', 'OS com valor final acima da soma dos itens: a venda gerada fica coerente (bruto - desconto = total = valor final)', 'api/api.php gerarVendaDaOs (item 28)', async () => {
  const e = await novaEntradaPeca(2, 10, 30);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 30 }], valor_mao_obra: 50, valor_final: 100, status: 'entregue' });
  const v = await venda((await ordem(r.json.id)).venda_id);
  exige(c(v.valor_bruto) - c(v.desconto) === c(v.valor_total) && c(v.valor_total) === 10000,
    'venda coerente e total 100', null, `bruto=${v.valor_bruto} desc=${v.desconto} total=${v.valor_total} itens=${soma(v.lista_itens, (i) => i.subtotal)}`);
});

// ==================================================================
// RODADA 3 - casos novos (backend, 8-backend-r3.md). Um caso por decisao.
// ==================================================================
async function usuarioDeTeste(perfil = 'balcao') {
  const lg = (`r3${perfil}${seq++}${RUN}`).toLowerCase();
  exigeStatus(await criarUsuarioPronto({ usuario: lg, nome: unico('R3'), senha: SENHA_U, perfil }), 201);
  const r = await A.get('/api/usuarios');
  return { login: lg, id: r.json.itens.find((u) => u.usuario === lg).id };
}
async function sessaoDe(perfil) {
  const u = await usuarioDeTeste(perfil);
  const s = new Sessao(perfil + '-r3');
  exigeStatus(await s.login(u.login, SENHA_U), 200, 'login ' + perfil);
  return s;
}

caso('C300', 'r3 Login', 'erro de senha: "restam" a partir da 3a tentativa; 5a -> 429; so ESSE login trava (IP local nao trava os outros)', 'api/rotas/acesso.php login', async () => {
  const u = await usuarioDeTeste();
  const s = new Sessao('c300');
  const r1 = await s.login(u.login, 'errada-1');
  const r2 = await s.login(u.login, 'errada-2');
  const r3 = await s.login(u.login, 'errada-3');
  const r4 = await s.login(u.login, 'errada-4');
  exige(r1.status === 401 && r1.json.restam === null && r2.json.restam === null, '1o e 2o erro: 401 sem restam', r2);
  exige(r3.json.restam === 2 && /Restam 2 tentativa\(s\) antes de bloquear por 15 minutos/.test(r3.json.erro), '3o erro: restam 2 com a frase', r3);
  exige(r4.json.restam === 1, '4o erro: restam 1', r4);
  exigeStatus(await s.login(u.login, 'errada-5'), 429, '5o erro -> 429');
  exigeStatus(await s.login(u.login, SENHA_U), 429, 'senha certa desse login tambem 429');
  exigeStatus(await new Sessao('c300-admin').login(ADMIN_USER, ADMIN_SENHA), 200, 'o admin (outro login, mesmo IP local) entra');
});
caso('C301', 'r3 Login', 'admin ve bloqueado_ate e destrava o login (POST /usuarios/{id}/destravar)', 'api/rotas/acesso.php usuarios', async () => {
  const u = await usuarioDeTeste();
  for (let i = 0; i < 5; i++) await new Sessao('c301').login(u.login, 'errada' + i);
  let lista = (await A.get('/api/usuarios')).json.itens;
  exige(lista.find((x) => x.id === u.id).bloqueado_ate, 'GET /usuarios traz bloqueado_ate', null, JSON.stringify(lista.find((x) => x.id === u.id)));
  const s = await sessaoDe('balcao');
  exigeStatus(await s.post(`/api/usuarios/${u.id}/destravar`), 403, 'balcao nao destrava');
  exigeStatus(await A.post(`/api/usuarios/${u.id}/destravar`), 200, 'admin destrava');
  lista = (await A.get('/api/usuarios')).json.itens;
  exige(lista.find((x) => x.id === u.id).bloqueado_ate === null, 'bloqueado_ate volta a null', null, '');
  exigeStatus(await new Sessao('c301b').login(u.login, SENHA_U), 200, 'depois de destravar, entra');
});
caso('C302', 'r3 Login', 'login certo de OUTRA conta nao zera as tentativas contra um login (contorno da R2)', 'api/rotas/acesso.php limparTentativas', async () => {
  const alvo = await usuarioDeTeste();
  const outro = await usuarioDeTeste();
  for (let i = 0; i < 4; i++) await new Sessao('c302').login(alvo.login, 'chute' + i);
  exigeStatus(await new Sessao('c302b').login(outro.login, SENHA_U), 200, 'login certo de outra conta');
  exigeStatus(await new Sessao('c302').login(alvo.login, 'chute-5'), 429, 'o 5o chute contra o alvo ainda trava');
});
caso('C303', 'r3 Senha', 'regra de senha: letras e numeros, sem o login, sem repeticao, sem comuns (criar, redefinir e trocar)', 'api/nucleo.php senhaFraca', async () => {
  const lg = ('balcao' + seq++ + RUN).toLowerCase();
  for (const [senha, motivo] of [['senhasenha', 'so letras'], ['aaaaaaaa', 'repetida'], ['12121212', 'so numeros'],
    [lg + '12', 'contem o login'], ['ab12ab12', 'repeticao'], ['senha123', 'comum']]) {
    exigeStatus(await A.post('/api/usuarios', { usuario: lg, nome: 'x', senha, perfil: 'balcao' }), 400, `"${senha}" (${motivo}) -> 400`);
  }
  const u = await usuarioDeTeste();
  exigeStatus(await A.put('/api/usuarios/' + u.id, { senha: 'aaaaaaaa' }), 400, 'redefinir para senha fraca -> 400');
  const s = new Sessao('c303');
  await s.login(u.login, SENHA_U);
  exigeStatus(await s.post('/api/trocar-senha', { senha_atual: SENHA_U, senha_nova: 'senhasenha' }), 400, 'trocar para fraca -> 400');
  const cfg = (await A.get('/api/config')).json.config;
  exige(typeof cfg.regra_senha === 'string' && /letras e números/.test(cfg.regra_senha), '/config.regra_senha traz o texto da regra', null, cfg.regra_senha);
});
caso('C304', 'r3 Senha', 'errar a senha atual na troca conta como tentativa (5 -> 429)', 'api/rotas/acesso.php trocarSenha', async () => {
  const u = await usuarioDeTeste();
  const s = new Sessao('c304');
  await s.login(u.login, SENHA_U);
  let ultimo;
  for (let i = 0; i < 5; i++) ultimo = await s.post('/api/trocar-senha', { senha_atual: 'errada' + i, senha_nova: 'Nova-Senha-123' });
  exigeStatus(ultimo, 429, '5a senha atual errada -> 429');
});
caso('C305', 'r3 Senha', 'usuario criado pelo admin, ou com senha redefinida, entra com trocar_senha=true', 'api/rotas/acesso.php usuarios', async () => {
  const lg = ('novo' + seq++ + RUN).toLowerCase();
  const cri = await A.post('/api/usuarios', { usuario: lg, nome: 'x', senha: 'Provisoria-123', perfil: 'tecnico' });
  exigeStatus(cri, 201);
  const r = await new Sessao('c305').login(lg, 'Provisoria-123');
  exige(r.status === 200 && r.json.usuario.trocar_senha === true, 'criado: trocar_senha true', r);
  const u = await usuarioDeTeste();
  exigeStatus(await A.put('/api/usuarios/' + u.id, { senha: 'Redefinida-456' }), 200);
  const r2 = await new Sessao('c305b').login(u.login, 'Redefinida-456');
  exige(r2.json?.usuario?.trocar_senha === true, 'redefinida pelo admin: trocar_senha true', r2);
});
caso('C306', 'r3 IMEI', 'IMEI: recompra do celular ja vendido passa; no estoque e recusado com o que a tela mostra; digito errado recusado', 'api/rotas/estoque.php conferirImei', async () => {
  const imei = imeiUnico();
  const e1 = await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei, valor_investimento: 100, valor_venda: 200 });
  exigeStatus(e1, 201);
  const dup = await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei, valor_investimento: 100 });
  exige(dup.status === 400 && /já está no estoque: .+, entrada de \d\d\/\d\d\/\d{4}\./.test(dup.json?.erro || ''), 'no estoque -> 400 com modelo e data', dup);
  exigeStatus(await A.post('/api/vendas', { itens: [{ entrada_id: e1.json.id }] }), 201, 'vende o aparelho');
  exigeStatus(await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei, valor_investimento: 120, condicao: 'usado' }), 201, 'recompra do mesmo IMEI -> 201');
  const errado = imei.slice(0, 14) + ((+imei[14] + 1) % 10);
  exigeStatus(await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei: errado, valor_investimento: 1 }), 400, 'digito verificador errado -> 400');
});
caso('C307', 'r3 Venda', 'venda parcelada com 1 parcela paga: desconto mantem o pago, cancela os pendentes e lanca UMA diferenca', 'api/rotas/vendas.php atualizarVenda', async () => {
  const id = await vendaAvulsa(300, 3);
  const v = await venda(id);
  exigeStatus(await A.put('/api/lancamentos/' + v.lancamentos[0].id, { status: 'pago' }), 200);
  const r = await A.put('/api/vendas/' + id, { desconto: 30 });
  const d = await venda(id);
  const ativos2 = ativos(d.lancamentos);
  exige(r.status === 200 && /continua recebido/.test(r.json.mensagem), '200 com mensagem explicando', r);
  exige(ativos2.length === 2 && ativos2.some((l) => l.status === 'pago' && c(l.valor) === 10000)
    && ativos2.some((l) => l.status === 'pendente' && c(l.valor) === 17000), 'pago 100 segue; nasce 170 a receber', null, JSON.stringify(ativos2.map((l) => [l.status, l.valor])));
  exige(!/Financeiro/.test(r.json.mensagem), 'a mensagem nao manda ninguem ao Financeiro', r);
});
caso('C308', 'r3 Perfis', 'balcao: nao cancela venda ja recebida (403), cancela a nao recebida; nao ve custo/lucro em vendas e OS; ve custo em entradas', 'api/rotas/vendas.php', async () => {
  const s = await sessaoDe('balcao');
  const paga = await vendaAvulsa(50, 1, { pago: true });
  exigeStatus(await s.put('/api/vendas/' + paga, { status: 'cancelada' }), 403, 'cancelar venda paga -> 403');
  const aberta = await vendaAvulsa(50, 1);
  exigeStatus(await s.put('/api/vendas/' + aberta, { status: 'cancelada' }), 200, 'cancelar venda nao recebida -> 200');
  const lv = (await s.get('/api/vendas')).json.itens[0];
  exige(!('custo_total' in lv) && !('lucro' in lv), '/vendas sem custo_total/lucro para o balcao', null, Object.keys(lv).join(','));
  const umaVenda = (await s.get('/api/vendas/' + paga)).json.venda;
  exige(umaVenda.lista_itens.every((i) => !('custo_unitario' in i)), 'itens da venda sem custo', null, '');
  const e = await novaEntradaPeca(2, 10, 30);
  const os = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 30 }] });
  const ov = (await s.get('/api/os/' + os.json.id)).json.os;
  exige(ov.lista_itens.every((i) => !('custo_unitario' in i)), 'itens da OS sem custo', null, '');
  const ent = (await s.get('/api/entradas/' + e)).json.entrada;
  exige('valor_investimento' in ent, '/entradas mantem o custo (o balcao cadastra)', null, '');
  const pv = (await s.get('/api/vendas')).json.itens.find((x) => x.id === paga);
  exige(pv.pode_cancelar === false && pv.pode_excluir === false, 'flags: balcao nao cancela venda paga nem exclui', null, JSON.stringify(pv));
});
caso('C309', 'r3 Formas', 'forma padrao: uma so (Dinheiro na semente), PUT {padrao:true} troca; forma nova nasce depois da ultima; padrao nao se desativa', 'api/rotas/catalogo.php', async () => {
  let fs1 = (await A.get('/api/formas-pagamento')).json.itens;
  exige(fs1.filter((f) => f.padrao === true).length === 1 && fs1.every((f) => typeof f.padrao === 'boolean'), 'uma padrao, padrao booleano', null, '');
  const maxOrdem = Math.max(...fs1.map((f) => f.ordem));
  const nova = await A.post('/api/formas-pagamento', { nome: unico('Vale'), ordem: 0 });
  const criada = (await A.get('/api/formas-pagamento/' + nova.json.id)).json.item;
  exige(criada.ordem > maxOrdem && criada.padrao === false, 'nova com ordem depois da ultima e nao padrao', null, JSON.stringify(criada));
  const antiga = fs1.find((f) => f.padrao);
  exigeStatus(await A.put('/api/formas-pagamento/' + nova.json.id, { padrao: true }), 200);
  fs1 = (await A.get('/api/formas-pagamento')).json.itens;
  exige(fs1.filter((f) => f.padrao).map((f) => f.id).join() === String(nova.json.id), 'so a nova e padrao', null, '');
  exigeStatus(await A.put('/api/formas-pagamento/' + nova.json.id, { ativo: 0 }), 400, 'desativar a padrao -> 400');
  exigeStatus(await A.put('/api/formas-pagamento/' + antiga.id, { padrao: true }), 200, 'devolve a padrao');
});
caso('C310', 'r3 Config', '/config: limites novos, regra_senha e dominios com valor/rotulo (motivo brinde com lado)', 'api/rotas/acesso.php configuracao', async () => {
  const c0 = (await A.get('/api/config')).json.config;
  exige(c0.quantidade_maxima === 100000 && c0.garantia_maxima === 3650 && c0.janela_vencimentos === 90 && c0.tempo_medio_maximo === 100000,
    'limites novos', null, JSON.stringify(c0));
  const mot = c0.dominios.motivos_movimentacao;
  exige(mot.some((m) => m.valor === 'brinde' && m.rotulo === 'Brinde / cortesia' && m.lado === 'saida')
    && mot.some((m) => m.valor === 'devolucao' && m.rotulo === 'Devolvido ao fornecedor')
    && mot.some((m) => m.valor === 'ajuste' && m.rotulo === 'Ajuste de estoque'), 'motivos com rotulos certos', null, JSON.stringify(mot));
  for (const d of ['status_os', 'status_venda', 'categorias_peca', 'tipos_pagamento', 'condicoes']) {
    exige(Array.isArray(c0.dominios[d]) && c0.dominios[d].every((x) => x.valor && x.rotulo), `dominio ${d}`, null, JSON.stringify(c0.dominios[d]));
  }
});
caso('C311', 'r3 Permissoes', 'pode_editar_valor/pode_excluir/pode_cancelar vem do servidor (venda, venda de OS, lancamento)', 'api/rotas/*.php permissoes*', async () => {
  const id = await vendaAvulsa(40, 1);
  const v = (await A.get('/api/vendas/' + id)).json.venda;
  exige(v.pode_editar_valor === true && v.pode_cancelar === true && v.pode_excluir === true, 'venda de balcao: tudo liberado para o admin', null, JSON.stringify(v));
  exige(v.lancamentos[0].pode_editar_valor === false && v.lancamentos[0].pode_excluir === false, 'lancamento de venda: valor travado', null, JSON.stringify(v.lancamentos[0]));
  const os = await novaOs({ valor_mao_obra: 30, status: 'entregue' });
  const vo = (await A.get('/api/vendas/' + (await ordem(os.json.id)).venda_id)).json.venda;
  exige(vo.pode_cancelar === false && vo.pode_excluir === false && vo.pode_editar_valor === false, 'venda de OS: nada pelo /vendas', null, JSON.stringify(vo));
  const m = await A.post('/api/lancamentos', { tipo: 'pagar', descricao: unico('Manual'), valor: 10, vencimento: DIA });
  const l = (await A.get('/api/lancamentos/' + m.json.id)).json.lancamento;
  exige(l.pode_excluir === true && l.pode_editar_valor === true, 'manual pendente: exclui e edita', null, JSON.stringify(l));
});
caso('C312', 'r3 OS', 'status_permitidos: OS cancelada devolve [] ; OS aberta devolve todos', 'api/rotas/os.php permissoesOs', async () => {
  const o = await novaOs({});
  exige((await ordem(o.json.id)).status_permitidos.length === 8, 'aberta: 8 status', null, '');
  await A.put('/api/os/' + o.json.id, { status: 'cancelada' });
  const oc = await ordem(o.json.id);
  exige(Array.isArray(oc.status_permitidos) && oc.status_permitidos.length === 0 && oc.pode_cancelar === false, 'cancelada: []', null, JSON.stringify(oc.status_permitidos));
});
caso('C313', 'r3 OS', 'pagamento com forma escolhida e valor vazio -> 400 com a frase', 'api/rotas/os.php conferirPagamentos', async () => {
  const r = await novaOs({ valor_mao_obra: 100, pagamentos: [{ forma_pagamento_id: M.f1, valor: '' }] });
  exige(r.status === 400 && r.json.erro === 'Informe o valor de cada forma de pagamento escolhida.', '400 com a frase do contrato', r);
});
caso('C314', 'r3 Brinde', 'brinde sai por Movimentar estoque (motivo brinde); venda de R$ 0,00 recusada apontando o caminho', 'api/rotas/estoque.php + vendas.php', async () => {
  const e = await novaEntradaPeca(3);
  exigeStatus(await A.post('/api/movimentacoes', { entrada_id: e, motivo: 'brinde', quantidade: 1 }), 201, 'brinde -> 201');
  exige((await saldo(e)) === 2, 'brinde baixa o saldo', null, String(await saldo(e)));
  const f = await A.get('/api/movimentacoes?entrada_id=' + e);
  exige(f.json.movimentos.some((m) => m.descricao === 'Brinde / cortesia'), 'a ficha mostra o rotulo do dominio', f);
  const r = await A.post('/api/vendas', { itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 0 }] });
  exige(r.status === 400 && /Brinde \/ cortesia/.test(r.json.erro), 'venda R$ 0 -> 400 apontando Brinde / cortesia', r);
});
caso('C315', 'r3 OS', 'OS entregue com valor final 0 nao gera venda; a peca sai pela propria OS', 'api/rotas/os.php gerarVendaDaOs', async () => {
  const e = await novaEntradaPeca(2, 10, 30);
  const r = await novaOs({ itens: [{ entrada_id: e, quantidade: 1, valor_unitario: 30 }], valor_final: 0, status: 'entregue' });
  exigeStatus(r, 201);
  const o = await ordem(r.json.id);
  exige(o.venda_id === null && c(o.valor_final) === 0 && (await saldo(e)) === 1, 'sem venda, final 0, saldo 1', null, JSON.stringify({ v: o.venda_id, f: o.valor_final, s: await saldo(e) }));
});
caso('C316', 'r3 OS', 'senha do aparelho: so no GET da OS aberta; nunca na lista; apagada ao entregar (com nota no historico)', 'api/rotas/os.php', async () => {
  const r = await novaOs({ modelo_id: M.modelo, senha_aparelho: '1234-padrao', valor_mao_obra: 10 });
  exige((await ordem(r.json.id)).senha_aparelho === '1234-padrao', 'GET da OS aberta traz a senha', null, '');
  const lista = (await A.get('/api/os')).json.itens;
  exige(lista.every((o) => !('senha_aparelho' in o)), 'lista nunca traz senha_aparelho', null, '');
  exigeStatus(await A.put('/api/os/' + r.json.id, { status: 'entregue' }), 200);
  const o = await ordem(r.json.id);
  exige(o.senha_aparelho === null && o.historico.some((h) => /Senha do aparelho apagada/.test(h.comentario || '')), 'entregue: senha apagada e anotada', null, JSON.stringify(o.historico));
});
caso('C317', 'r3 Cadastros', 'homonimo sem telefone e permitido; mesmo nome + mesmo telefone continua recusado; nome sem acento duplica', 'api/rotas/catalogo.php', async () => {
  const nome = unico('Homonimo');
  exigeStatus(await A.post('/api/clientes', { nome }), 201);
  exigeStatus(await A.post('/api/clientes', { nome }), 201, 'mesmo nome, sem telefone -> 201');
  const t = telFicticio();
  exigeStatus(await A.post('/api/clientes', { nome, telefone: t.formatado }), 201);
  exigeStatus(await A.post('/api/clientes', { nome: nome.toUpperCase(), telefone: t.digitos }), 400, 'mesmo nome + telefone -> 400');
  exigeStatus(await A.post('/api/formas-pagamento', { nome: 'cartao de credito' }), 400, '"cartao de credito" sem acento ja existe');
});
caso('C318', 'r3 CSRF', 'mutacao sem Origin/Referer, de outro host, ou sem JSON -> 403; com Referer do host -> passa', 'api/nucleo.php conferirOrigem', async () => {
  const post = (h, corpo = '{"nome":"x"}') => fetch(BASE + '/api/clientes', { method: 'POST', headers: { cookie: A.cookie, ...h }, body: corpo });
  exige((await post({ 'content-type': 'application/json' })).status === 403, 'sem Origin nem Referer -> 403', null, '');
  exige((await post({ 'content-type': 'application/json', origin: 'http://outro.exemplo' })).status === 403, 'Origin de outro host -> 403', null, '');
  exige((await post({ 'content-type': 'text/plain', origin: BASE })).status === 403, 'text/plain -> 403', null, '');
  exige((await post({ 'content-type': 'application/json', referer: BASE + '/Dashboard/dashboard.html' }, JSON.stringify({ nome: unico('Ref') }))).status === 201, 'Referer do proprio host -> 201', null, '');
});
caso('C319', 'r3 Limites', 'mensagem de limite diz o que se esta gravando (entrada, venda, OS)', 'api/nucleo.php conferirTeto', async () => {
  const p = await novaPecaCatalogo();
  const e = await A.post('/api/entradas', { tipo: 'peca', peca_id: p, quantidade: 1000, valor_investimento: 20000, gerar_conta_pagar: 'pago' });
  exige(e.status === 400 && /entrada/.test(e.json.erro), 'entrada: cita a entrada', e);
  const v = await A.post('/api/vendas', { itens: [{ descricao: 'x', quantidade: 2, valor_unitario: 9000000 }] });
  exige(v.status === 400 && /venda/.test(v.json.erro), 'venda: cita a venda', v);
  const o = await novaOs({ itens: [{ descricao: 'x', quantidade: 3, valor_unitario: 9000000 }] });
  exige(o.status === 400 && /OS/.test(o.json.erro), 'OS: cita a OS', o);
});
caso('C320', 'r3 Painel', '/resumo traz cards (celular) e os_em_andamento; /financeiro traz os.os_abertas = mesma conta', 'api/rotas/painel.php', async () => {
  const r = (await A.get('/api/resumo')).json;
  const f = (await fin());
  const lista = (await A.get('/api/os')).json.itens;
  const cfg = (await A.get('/api/config')).json.config;
  const andamento = lista.filter((o) => cfg.status_os_em_andamento.includes(o.status)).length;
  exige(r.os_em_andamento === andamento && f.os.os_abertas === andamento && r.cards.total, 'os_em_andamento = os_abertas = contagem pela constante', null,
    `resumo ${r.os_em_andamento}, financeiro ${f.os.os_abertas}, lista ${andamento}`);
});
caso('C321', 'r3 Sessao', 'cookie de sessao HttpOnly e SameSite=Strict', 'api/nucleo.php iniciarSessao', async () => {
  const res = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ usuario: ADMIN_USER, senha: ADMIN_SENHA }) });
  const ck = (res.headers.getSetCookie?.() || []).find((x) => /^PHPSESSID=/.test(x)) || '';
  exige(/HttpOnly/i.test(ck) && /SameSite=Strict/i.test(ck), 'HttpOnly + SameSite=Strict', null, ck);
});
caso('C322', 'r3 OS', 'regra unica da OS pela API: abrir e salvar so o status preserva 300/300/250 (desconto de balcao, A1)', 'api/rotas/os.php valoresOs', async () => {
  const r = await novaOs({ valor_orcamento: 300, valor_mao_obra: 300, valor_final: 250 });
  exigeStatus(await A.put('/api/os/' + r.json.id, { status: 'em_reparo' }), 200);
  const o = await ordem(r.json.id);
  exige(c(o.valor_orcamento) === 30000 && c(o.valor_mao_obra) === 30000 && c(o.valor_final) === 25000, '300/300/250 preservado', null,
    JSON.stringify([o.valor_orcamento, o.valor_mao_obra, o.valor_final]));
  const s = await novaOs({ valor_orcamento: 300, itens: [{ descricao: 'peca avulsa', valor_unitario: 100 }] });
  const os2 = await ordem(s.json.id);
  exige(c(os2.valor_mao_obra) === 20000 && c(os2.valor_final) === 30000, 'sem mao digitada: mao = orcamento - pecas (200), final 300', null,
    JSON.stringify([os2.valor_mao_obra, os2.valor_final]));
});

// ------------------------------------------------------------------
// Rodada 4 (r3-5-chefe.md, secao 3)
// ------------------------------------------------------------------
/** Celular vendido e depois RECOMPRADO (outra entrada, mesmo IMEI). */
async function celularVendidoERecomprado(vendaExtra = {}) {
  const imei = imeiUnico();
  const velha = await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei, valor_investimento: 400, valor_venda: 800, situacao: 'ready' });
  exigeStatus(velha, 201, 'celular de apoio');
  const v = await A.post('/api/vendas', { itens: [{ entrada_id: velha.json.id }], forma_pagamento_id: M.f1, ...vendaExtra });
  exigeStatus(v, 201, 'venda do celular');
  const nova = await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei, valor_investimento: 300, condicao: 'usado' });
  exigeStatus(nova, 201, 'recompra do mesmo IMEI');
  return { imei, velha: velha.json.id, venda: v.json.id, nova: nova.json.id };
}
const RE_RECOMPRA = (imei) => new RegExp(`O IMEI ${imei} já voltou ao estoque pela entrada de \\d\\d/\\d\\d/\\d{4} \\(recompra: .+\\)\\. Nada foi gravado\\. Cancele ou ajuste aquela entrada antes`);
async function nadaMudou(x, vendaAntes) {
  const v = await venda(x.venda);
  const ev = await entrada(x.velha);
  const en = await entrada(x.nova);
  exige(v.status === 'concluida' && ev.situacao === 'vendido' && ev.saldo === 0 && en.saldo === 1
    && JSON.stringify(v.lancamentos.map((l) => l.status)) === JSON.stringify(vendaAntes.lancamentos.map((l) => l.status)),
  'nada gravado: venda concluida, contas iguais, entrada antiga vendida (saldo 0), recompra com saldo 1', null,
  JSON.stringify([v.status, ev.situacao, ev.saldo, en.saldo, v.lancamentos.map((l) => l.status)]));
}
caso('C323', 'r4 IMEI', 'recompra + CANCELAR a venda antiga -> 400 com a entrada da recompra; nada gravado (um aparelho = uma unidade)', 'api/rotas/estoque.php devolverCelularesAPrateleira', async () => {
  const x = await celularVendidoERecomprado({ pago: true });
  const antes = await venda(x.venda);
  const r = await A.put('/api/vendas/' + x.venda, { status: 'cancelada' });
  exige(r.status === 400 && RE_RECOMPRA(x.imei).test(r.json?.erro || '') && /cancelar esta venda/.test(r.json.erro), '400 com IMEI, data da recompra e o que fazer', r);
  await nadaMudou(x, antes);
});
caso('C324', 'r4 IMEI', 'recompra + EXCLUIR a venda antiga -> 400; a venda continua la', 'api/rotas/vendas.php DELETE', async () => {
  const x = await celularVendidoERecomprado();
  const antes = await venda(x.venda);
  const r = await A.del('/api/vendas/' + x.venda);
  exige(r.status === 400 && RE_RECOMPRA(x.imei).test(r.json?.erro || '') && /excluir esta venda/.test(r.json.erro), '400 com a mensagem da recompra', r);
  await nadaMudou(x, antes);
});
caso('C325', 'r4 IMEI', 'recompra + desfazer pela OS (tirar de "entregue" e excluir a OS) -> 400; nada gravado', 'api/rotas/os.php desfazerVendaDaOs', async () => {
  const imei = imeiUnico();
  const cel = await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei, valor_investimento: 400, valor_venda: 800, situacao: 'ready' });
  exigeStatus(cel, 201);
  const os = await novaOs({ itens: [{ entrada_id: cel.json.id, quantidade: 1, valor_unitario: 800 }], valor_final: 800 });
  exigeStatus(os, 201, 'OS com o celular');
  exigeStatus(await A.put('/api/os/' + os.json.id, { status: 'entregue' }), 200, 'entregar (gera a venda)');
  const o1 = await ordem(os.json.id);
  exigeStatus(await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, imei, valor_investimento: 300 }), 201, 'recompra');
  const reabrir = await A.put('/api/os/' + os.json.id, { status: 'pronta' });
  exige(reabrir.status === 400 && RE_RECOMPRA(imei).test(reabrir.json?.erro || '') && /tirar esta OS de "entregue"/.test(reabrir.json.erro), 'tirar de entregue -> 400', reabrir);
  const excluir = await A.del('/api/os/' + os.json.id);
  exige(excluir.status === 400 && /excluir esta OS/.test(excluir.json?.erro || ''), 'excluir a OS -> 400', excluir);
  const o2 = await ordem(os.json.id);
  exige(o2.status === 'entregue' && o2.venda_id === o1.venda_id && (await venda(o1.venda_id)).status === 'concluida', 'OS entregue com a mesma venda', null, JSON.stringify([o2.status, o2.venda_id]));
});
caso('C326', 'r4 IMEI', 'recompra + movimentacao "retorno" na entrada antiga -> 400 (outro caminho de volta ao estoque)', 'api/rotas/estoque.php conferirImeiNoEstoque', async () => {
  const x = await celularVendidoERecomprado();
  const r = await A.post('/api/movimentacoes', { entrada_id: x.velha, motivo: 'retorno', quantidade: 1 });
  exige(r.status === 400 && RE_RECOMPRA(x.imei).test(r.json?.erro || ''), 'retorno -> 400', r);
  exige((await entrada(x.velha)).saldo === 0, 'saldo da antiga continua 0', null, '');
});
caso('C327', 'r4 Formas', 'forma padrao: balcao/tecnico nao escolhem (403 no POST e no PUT); reenviar padrao:true da que ja e padrao passa', 'api/rotas/catalogo.php conferirQuemEscolhePadrao', async () => {
  for (const perfil of ['balcao', 'tecnico']) {
    const s = await sessaoDe(perfil);
    const fs1 = (await A.get('/api/formas-pagamento')).json.itens;
    const atual = fs1.find((f) => f.padrao);
    const outra = fs1.find((f) => !f.padrao && f.ativo);
    const post = await s.post('/api/formas-pagamento', { nome: unico('Vale ' + perfil), padrao: true });
    exige(post.status === 403 && /administrador/.test(post.json?.erro || ''), perfil + ': POST com padrao -> 403', post);
    exigeStatus(await s.put('/api/formas-pagamento/' + outra.id, { padrao: true }), 403, perfil + ': PUT padrao em outra -> 403');
    exigeStatus(await s.put('/api/formas-pagamento/' + atual.id, { padrao: true }), 200, perfil + ': reenviar a padrao atual -> 200');
    const depois = (await A.get('/api/formas-pagamento')).json.itens.filter((f) => f.padrao).map((f) => f.id);
    exige(depois.join() === String(atual.id), perfil + ': a padrao nao mudou', null, depois.join());
  }
});
caso('C328', 'r4 OS', 'OS recusada apaga a senha do aparelho (com nota no historico)', 'api/nucleo.php STATUS_OS_APAGA_SENHA', async () => {
  const r = await novaOs({ senha_aparelho: '9876', valor_orcamento: 200 });
  exigeStatus(r, 201);
  exigeStatus(await A.put('/api/os/' + r.json.id, { status: 'recusada' }), 200);
  const o = await ordem(r.json.id);
  exige(o.senha_aparelho === null && o.historico.some((h) => /Senha do aparelho apagada/.test(h.comentario || '')), 'recusada: senha apagada e anotada', null, JSON.stringify(o.historico));
});
caso('C329', 'r4 OS', '409 da OS: diz que nada foi gravado e manda usar Recarregar (o botao da tela)', 'api/rotas/os.php atualizarOs', async () => {
  const r = await novaOs({ valor_orcamento: 100 });
  const velha = (await ordem(r.json.id)).atualizado_em;
  exigeStatus(await A.put('/api/os/' + r.json.id, { diagnostico: 'primeira' }), 200);
  const c409 = await A.put('/api/os/' + r.json.id, { diagnostico: 'segunda', atualizado_em: velha });
  exige(c409.status === 409 && c409.json?.erro === 'Esta OS foi alterada por outra pessoa depois que você abriu. Nada foi gravado. Use Recarregar e confira.', '409 com a frase nova', c409);
});

import net from 'node:net';
function cru(caminho) {
  const { hostname, port } = new URL(BASE);
  return new Promise((ok) => {
    const s = net.connect(Number(port), hostname, () => s.write(`GET ${caminho} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`));
    let buf = '';
    s.setEncoding('latin1');
    s.on('data', (d) => { buf += d; if (buf.length > 4096) s.destroy(); });
    s.on('close', () => ok(buf));
    s.on('error', () => ok(buf));
    setTimeout(() => s.destroy(), 4000);
  });
}

// ==================================================================
// Execucao
// ==================================================================
async function preparar() {
  let r = await A.login(ADMIN_USER, ADMIN_SENHA);
  if (r.status === 401 && ADMIN_SENHA_INICIAL) {           // SETUP r2: 1a vez troca a provisoria
    r = await A.login(ADMIN_USER, ADMIN_SENHA_INICIAL);
    if (r.status === 200) {
      const t = await A.post('/api/trocar-senha', { senha_atual: ADMIN_SENHA_INICIAL, senha_nova: ADMIN_SENHA });
      if (t.status !== 200) throw new Error('troca da senha inicial falhou: ' + t.status + ' ' + t.text);
    }
  }
  if (r.status !== 200) throw new Error('nao consegui logar como admin: ' + r.status + ' ' + r.text);
  M.cliente = await novoCliente({ telefone: telFicticio().formatado });
  M.modelo = (await A.post('/api/modelos', { marca: 'TST', modelo: unico('ModeloBase') })).json.id;
  M.servico = (await A.post('/api/servicos', { nome: unico('Troca de tela'), valor_padrao: 80 })).json.id;
  M.f1 = (await A.post('/api/formas-pagamento', { nome: unico('Dinheiro'), tipo: 'vista' })).json.id;
  M.f2 = (await A.post('/api/formas-pagamento', { nome: unico('Debito'), tipo: 'vista' })).json.id;
  // amarra o modelo base a uma entrada para o teste de "modelo em uso"
  await A.post('/api/entradas', { tipo: 'celular', modelo_id: M.modelo, valor_investimento: 1, gerar_conta_pagar: '' });
}

// ------------------------------------------------------------------ v6: listas, regras por chave, empresa
async function sessaoBalcaoV6() {
  const lg = ('v6balcao' + RUN).toLowerCase();
  exigeStatus(await criarUsuarioPronto({ usuario: lg, nome: 'Balcao v6', senha: SENHA_U, perfil: 'balcao' }), [201, 400]);
  const s = new Sessao('balcao-v6');
  exigeStatus(await s.login(lg, SENHA_U), 200, 'login do balcao v6');
  return s;
}

caso('C400', 'v6 Listas', 'listas: todos leem; balcao cadastra valor novo; repetido (outra caixa) devolve o existente; tirar da lista so admin; DELETE nao existe', 'api/rotas/admin.php listas()', async () => {
  const s = await sessaoBalcaoV6();
  const g = await s.get('/api/listas');
  exige(g.status === 200 && g.json.listas.marcas.some((v) => v.valor === 'Apple'), 'GET /listas 200 com Apple nas marcas', g);
  const nome = 'Cor ' + RUN;
  const novo = await s.post('/api/listas', { lista: 'cores', valor: nome });
  exigeStatus(novo, 201, 'balcao cadastra valor novo -> 201');
  const repetido = await s.post('/api/listas', { lista: 'cores', valor: nome.toUpperCase() });
  exige(repetido.status === 200 && repetido.json.valor === nome, 'mesmo valor em maiuscula -> 200 com a grafia gravada', repetido);
  exigeStatus(await s.put('/api/listas/' + novo.json.id, { ativo: false }), 403, 'balcao tira da lista -> 403');
  exigeStatus(await A.put('/api/listas/' + novo.json.id, { ativo: false }), 200, 'admin tira da lista -> 200');
  exigeStatus(await A.del('/api/listas/' + novo.json.id), 405, 'DELETE /listas -> 405 (desativa, nao exclui)');
  exigeStatus(await s.post('/api/listas', { lista: 'senhas', valor: 'x' }), 400, 'lista desconhecida -> 400');
});

caso('C401', 'v6 Listas', 'cadastro de modelo grava a marca com a grafia da lista ("samsung" -> "Samsung")', 'api/rotas/catalogo.php lerCamposDoCatalogo', async () => {
  const r = await A.post('/api/modelos', { marca: 'samsung', modelo: unico('Galaxy v6'), armazenamento: '256gb' });
  exigeStatus(r, 201);
  const m = (await A.get('/api/modelos/' + r.json.id)).json.item;
  exige(m.marca === 'Samsung' && m.armazenamento === '256GB', 'marca Samsung e armazenamento 256GB', null, `${m.marca} / ${m.armazenamento}`);
});

caso('C402', 'v6 Regras', 'regras por chave: so admin le e grava (403 para balcao); valor invalido 400; /config traz as chaves', 'api/rotas/admin.php chaves()', async () => {
  const s = await sessaoBalcaoV6();
  exigeStatus(await s.get('/api/chaves'), 403, 'balcao GET /chaves -> 403');
  exigeStatus(await s.post('/api/chaves', { chave: 'venda.exigir_cliente', escopo: 'geral', valor: '1' }), 403, 'balcao POST /chaves -> 403');
  const g = await A.get('/api/chaves');
  exige(g.status === 200 && g.json.chaves.length >= 4 && g.json.empresa && g.json.empresa.id, 'admin GET /chaves com as regras e a empresa', g);
  exigeStatus(await A.post('/api/chaves', { chave: 'venda.desconto_maximo_balcao', escopo: 'geral', valor: '150' }), 400, 'numero fora da faixa -> 400');
  exigeStatus(await A.post('/api/chaves', { chave: 'nao.existe', escopo: 'geral', valor: '1' }), 400, 'chave desconhecida -> 400');
  const cfg = (await s.get('/api/config')).json.config;
  exige(cfg.chaves && typeof cfg.chaves['venda.exigir_cliente'] === 'boolean' && cfg.pode_admin === false,
    '/config do balcao traz as chaves (bool) e pode_admin=false', null, JSON.stringify(cfg.chaves));
});

caso('C403', 'v6 Regras', 'limite de desconto do balcao conferido NO SERVIDOR: acima = 403 e nada gravado; no limite = 201; empresa vence o geral', 'api/rotas/vendas.php conferirRegrasDaVenda', async () => {
  const s = await sessaoBalcaoV6();
  const ent = await novaEntradaPeca(10, 20, 100);
  const corpo = (desconto) => ({ itens: [{ entrada_id: ent, quantidade: 1 }], forma_pagamento_id: M.f1, pago: true, desconto });
  try {
    exigeStatus(await A.post('/api/chaves', { chave: 'venda.desconto_maximo_balcao', escopo: 'geral', valor: '10' }), 200, 'admin: geral 10%');
    const antes = (await A.get('/api/vendas')).json.itens.length;
    exigeStatus(await s.post('/api/vendas', corpo(10.01)), 403, 'balcao 10,01 de 100 -> 403');
    exige((await A.get('/api/vendas')).json.itens.length === antes, 'a venda recusada nao foi gravada', null, 'contagem mudou');
    exigeStatus(await s.post('/api/vendas', corpo(10)), 201, 'balcao 10,00 de 100 -> 201');
    exigeStatus(await A.post('/api/chaves', { chave: 'venda.desconto_maximo_balcao', escopo: 'empresa', valor: '30' }), 200, 'admin: empresa 30%');
    exigeStatus(await s.post('/api/vendas', corpo(25)), 201, 'balcao 25 de 100 com a empresa em 30% -> 201');
    exigeStatus(await A.post('/api/vendas', corpo(80)), 201, 'admin sem limite -> 201');
  } finally {
    await A.post('/api/chaves', { chave: 'venda.desconto_maximo_balcao', escopo: 'empresa', valor: null });
    await A.post('/api/chaves', { chave: 'venda.desconto_maximo_balcao', escopo: 'geral', valor: null });
  }
  const h = (await A.get('/api/chaves')).json.historico;
  exige(h.length >= 4 && h[0].chave === 'venda.desconto_maximo_balcao', 'historico registrou as mudancas', null, JSON.stringify(h.slice(0, 2)));
});

caso('C404', 'v6 Empresa', 'empresa: so admin; CNPJ com digito errado 400; certo grava so os digitos', 'api/rotas/admin.php empresa()', async () => {
  const s = await sessaoBalcaoV6();
  exigeStatus(await s.get('/api/empresa'), 403, 'balcao GET /empresa -> 403');
  const e = (await A.get('/api/empresa')).json.empresa;
  exigeStatus(await A.put('/api/empresa/' + e.id, { cnpj: '11.222.333/0001-80' }), 400, 'CNPJ errado -> 400');
  const ok = await A.put('/api/empresa/' + e.id, { cnpj: '11.222.333/0001-81' });
  exige(ok.status === 200 && ok.json.empresa.cnpj === '11222333000181', 'CNPJ certo grava 14 digitos', ok);
  exigeStatus(await A.put('/api/empresa/' + e.id, { cnpj: '' }), 200, 'apagar o CNPJ -> 200');
});

caso('C405', 'v7 Fiscal', 'fiscal: dados da empresa so admin; CFOP e naturezas todos leem, so admin grava', 'api/rotas/fiscal.php', async () => {
  const s = await sessaoBalcaoV6();
  exigeStatus(await s.get('/api/fiscal'), 403, 'balcao GET /fiscal -> 403');
  exigeStatus(await A.get('/api/fiscal'), 200, 'admin GET /fiscal -> 200');
  const c = await s.get('/api/cfops');
  exige(c.status === 200 && c.json.itens.some((x) => x.codigo === '1102'), 'balcao le os CFOPs (tem 1102)', c);
  exigeStatus(await s.put('/api/cfops/1102', { permitido: false }), 403, 'balcao PUT /cfops -> 403');
  exigeStatus(await s.post('/api/naturezas', { codigo: 'X', descricao: 'X', sentido: 'entrada' }), 403, 'balcao POST /naturezas -> 403');
  exigeStatus(await s.get('/api/naturezas'), 200, 'balcao GET /naturezas -> 200');
});

caso('C406', 'v7 Pedido', 'pedido de entrada: balcao monta o rascunho; confirmar so admin (403); apagar so admin; acao desconhecida 404', 'api/rotas/pedidos.php', async () => {
  const s = await sessaoBalcaoV6();
  const nat = (await A.get('/api/naturezas')).json.itens.find((n) => n.codigo === 'COMPRA_REVENDA').id;
  const prod = (await A.post('/api/produtos', { nome: unico('Produto pedido') })).json.id;
  const forn = (await A.post('/api/fornecedores', { nome: unico('Fornecedor pedido') })).json.id;
  const r = await s.post('/api/pedidos', { natureza_id: nat, fornecedor_id: forn, itens: [{ tipo_item: 'produto', produto_id: prod, descricao: 'x', quantidade: 2, valor_unitario: 10 }] });
  exige(r.status === 201 && /^PE-\d{4}-\d{4}$/.test(r.json.numero), 'balcao cria rascunho 201 com numero PE-AAAA-NNNN', r);
  exigeStatus(await s.post('/api/pedidos/' + r.json.id + '/confirmar', {}), 403, 'balcao confirma -> 403');
  exigeStatus(await s.post('/api/pedidos/' + r.json.id + '/xpto', {}), 404, 'acao desconhecida -> 404');
  exigeStatus(await s.del('/api/pedidos/' + r.json.id), 403, 'balcao apaga -> 403');
  exigeStatus(await A.post('/api/pedidos/' + r.json.id + '/confirmar', {}), 200, 'admin confirma -> 200');
  exigeStatus(await A.put('/api/pedidos/' + r.json.id, { natureza_id: nat, fornecedor_id: forn, itens: [] }), 400, 'confirmado nao edita -> 400');
  exigeStatus(await A.post('/api/pedidos', { xml: '<nao-e-nfe/>' }), 400, 'XML que nao e NF-e -> 400');
});

const filtro = process.argv[2] ? new RegExp(process.argv[2]) : null;
const inicio = Date.now();
await preparar();
const res = [];
for (const k of casos) {
  if (filtro && !filtro.test(k.id)) continue;
  const t0 = Date.now();
  try {
    await k.fn();
    res.push({ ...k, ok: true, ms: Date.now() - t0 });
    console.log(`PASSOU  ${k.id.padEnd(5)} ${k.titulo}`);
  } catch (e) {
    const d = e instanceof Falha ? e.d : { esperado: '(excecao no teste)', obtido: String(e?.stack || e) };
    res.push({ ...k, ok: false, ms: Date.now() - t0, ...d });
    console.log(`FALHOU  ${k.id.padEnd(5)} ${k.titulo}`);
    console.log(`        req:      ${d.req || '-'}`);
    console.log(`        esperado: ${d.esperado}`);
    console.log(`        obtido:   ${d.obtido}`);
    console.log(`        onde:     ${k.onde}`);
  }
}
const ok = res.filter((r) => r.ok).length;
console.log(`\nRUN ${RUN} em ${BASE}: ${ok} passaram, ${res.length - ok} falharam, ${res.length} casos (${((Date.now() - inicio) / 1000).toFixed(1)} s)`);
// ADAPTADO-r4 (item 19): a saida fica fora do controle de versao (testes\rodar.php passa SAIDA_TESTES).
// 12/11/2026: uma pasta so por projeto, a saida mora em testes\saida\ (no .gitignore).
const SAIDA = process.env.SAIDA_TESTES || path.join(AQUI, 'saida');
fs.mkdirSync(SAIDA, { recursive: true });
fs.writeFileSync(path.join(SAIDA, 'resultado' + (process.env.TAG ? '-' + process.env.TAG : '') + '.json'), JSON.stringify({ run: RUN, base: BASE, resultados: res.map(({ fn, ...x }) => x) }, null, 2));
fs.writeFileSync(path.join(SAIDA, 'requisicoes' + (process.env.TAG ? '-' + process.env.TAG : '') + '.log'), LOG.join('\n'));
process.exitCode = res.length - ok ? 1 : 0;
