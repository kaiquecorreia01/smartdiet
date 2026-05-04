# SmartDiet

> Web app de rastreamento de macronutrientes com sincronização em nuvem, autenticação multi-conta e instalável como PWA. **Construído sem frameworks** — HTML, CSS e JavaScript puro — como exercício deliberado de fundamentos.

**Demo em produção:** [smartdiet.vercel.app](https://smartdiet.vercel.app)

---

## Visão geral

SmartDiet permite ao usuário registrar refeições e alimentos (em gramas), calcular automaticamente proteína, carboidrato, gordura e calorias, e acompanhar o progresso diário em relação a metas configuráveis. Os dados ficam na nuvem (Supabase) e o usuário acessa de qualquer dispositivo.

### O que dá pra fazer

- Criar conta com email/senha, recuperar senha por email
- Registrar refeições (Café, Almoço, Lanche, Jantar) e adicionar alimentos com quantidade em gramas
- Manter uma biblioteca pessoal de alimentos reutilizáveis (com auto-sugestão por uso mais frequente)
- Definir metas diárias de macros e ver o progresso em tempo real
- Duplicar refeições de outro dia
- Registrar histórico de peso corporal e visualizar evolução
- Ver gráficos semanais (calorias) e donut de macros do dia
- Exportar dados em CSV
- Alternar entre tema claro/escuro
- Instalar como app no celular (PWA)

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | HTML + CSS + JavaScript puro, sem build step |
| Backend / DB | [Supabase](https://supabase.com) (PostgreSQL + Auth + PostgREST) |
| Hospedagem | [Vercel](https://vercel.com) (deploy contínuo a partir do `main`) |
| PWA | `manifest.json` + Service Worker |
| Charts | Chart.js 4.4.4 (CDN com SRI) |
| Auth SDK | `@supabase/supabase-js` 2.105.1 (CDN com SRI) |

### Por que sem framework?

Decisão deliberada de aprendizado. O foco era entender bem os fundamentos (DOM, eventos, fetch, CSP, Service Worker, RLS) antes de adicionar a complexidade de React/Vue. A arquitetura já está separada em camadas (cloud / ação / render) o suficiente para uma migração futura ser direta.

---

## Estrutura

```
smartdiet/
├── index.html               # Shell HTML — sem JS/CSS inline (CSP-friendly)
├── style.css                # Todos os estilos (~700 linhas)
├── app.js                   # Toda a lógica (~1700 linhas)
├── sw.js                    # Service Worker (cache versionado)
├── manifest.json            # PWA manifest
├── vercel.json              # Headers de segurança + Cache-Control
├── docs/
│   └── SECURITY-CHECKLIST.md   # Hardening manual (Supabase / Vercel / GitHub)
├── supabase/
│   ├── setup.sql            # Schema completo (idempotente)
│   └── migrations/
│       ├── 001-initial.sql
│       └── 002-weight-history.sql
├── README.md                # Este arquivo
└── CLAUDE.md                # Contexto do projeto para o assistente Claude
```

### Camadas no `app.js`

1. **Cloud** — interage diretamente com Supabase (`saveMealToCloud`, `loadDayFromCloud`, `loadLibraryFromCloud`, etc.)
2. **Ação** — atualiza estado local e chama as funções cloud (`addMeal`, `addFood`, `updateFoodQty`, `deleteMeal`)
3. **Render** — desenha o DOM a partir do estado (`render`, `renderMacros`, `renderMeals`, `createMealCard`)

Padrão é `dados mudam → render() redesenha tudo`, similar ao que React faz por baixo.

---

## Banco de dados

Cinco tabelas no Supabase, todas com **Row Level Security** (`auth.uid() = user_id`):

| Tabela | Finalidade |
|---|---|
| `meals` | Refeições do dia (tipo, emoji, hora, data) |
| `meal_foods` | Alimentos dentro de cada refeição (com macros por 100g) |
| `food_library` | Biblioteca pessoal de alimentos com `usage_count` |
| `user_goals` | Metas diárias de macros |
| `weight_logs` | Histórico de peso corporal (timestamp completo) |

Defesas no banco:
- `ON DELETE CASCADE` em `meal_foods → meals`
- CHECK constraints (qty ≤ 10000g, kcal ≤ 900/100g, macros ≤ 100g/100g, nome ≤ 100 chars)
- Índices em `(user_id, date)` e `(user_id, usage_count DESC)`
- Policies RLS com `WITH CHECK` em UPDATE — impede mudar `user_id` de registro existente
- `meal_foods_insert` faz subquery na tabela `meals` (defesa em profundidade)

---

## Segurança

Auditoria com base em **OWASP Top 10 (2021)** e **CWE**. As principais defesas:

### No frontend
- `escapeHTML()` aplicada em **todo** `innerHTML` que recebe dados do usuário (anti-XSS)
- Sem `onclick` inline; tudo via `addEventListener` (CSP sem `'unsafe-inline'` em `script-src`)
- Sem `eval`, `Function()`, `setTimeout(string)`
- CSV export com sanitização de Formula Injection (`= + - @ |`)
- Validação client-side com clamp em todos os inputs numéricos
- Senha de cadastro: 8+ caracteres com letras + números + confirmação
- Limites: qty ≤ 10000g, kcal ≤ 900/100g, macros ≤ 100g/100g, nome ≤ 100 chars
- Email maxlength 254 (RFC 5321), senha maxlength 128
- Lockout local de 30s após 5 tentativas falhas de login
- Detecção e tradução PT-BR de rate-limits do servidor
- Validação de sessão contra o servidor via `getUser()` na entrada (detecta JWTs de contas deletadas)
- Logout zera **todo** o estado em memória (anti-vazamento entre usuários no mesmo browser)

### Headers HTTP (`vercel.json`)
- HSTS (`max-age=63072000; includeSubDomains; preload`)
- CSP restrito (`default-src 'self'` + jsdelivr + Google Fonts + Supabase)
- `frame-ancestors 'none'` (anti-clickjacking moderno) + `X-Frame-Options: DENY` (legacy fallback)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` com ~22 features bloqueadas
- COOP / CORP / COEP (isolamento cross-origin)
- `Cache-Control` por tipo: `no-cache` em HTML/SW, `immutable` em CSS/JS/imgs

### Supply chain
- CDN com **SRI** (Subresource Integrity) em Supabase SDK e Chart.js — o navegador rejeita o script se o hash não bater
- Versões pinadas (não `@latest`)

Detalhes completos do hardening manual em [`docs/SECURITY-CHECKLIST.md`](docs/SECURITY-CHECKLIST.md).

---

## Como rodar local

Pré-requisitos: nada além de um servidor estático (não há build step).

```bash
# clona o repo
git clone https://github.com/kaiquecorreia01/smartdiet.git
cd smartdiet

# serve estaticamente (qualquer servidor funciona)
npx serve .
```

Abre `http://localhost:3000` (ou a porta que o `serve` mostrar). O app já vai conectar no Supabase de produção — para usar uma instância própria, basta trocar `SUPABASE_URL` e `SUPABASE_KEY` no topo de [`app.js`](app.js) e rodar [`supabase/setup.sql`](supabase/setup.sql) no SQL Editor do seu projeto Supabase.

---

## Deploy

Push para `main` → Vercel deploya automaticamente.

```bash
git add .
git commit -m "feat: descrição"
git push
```

Sempre que alterar assets (`app.js`, `style.css`, `index.html`), incrementar `CACHE_NAME` em [`sw.js`](sw.js) para invalidar o Service Worker dos clientes.

---

## Roadmap

### Próximo
- [ ] Histórico com filtros e busca por data
- [ ] Refinar gráficos (filtros semanal/mensal)
- [ ] Edge cases no fluxo de peso (validações extras)

### Médio prazo
- [ ] Registro de água diária
- [ ] Exportar PDF (CSV já feito)
- [ ] Modularizar `app.js` em arquivos por feature

### Longo prazo
- [ ] Migração para React/Vue + Vite
- [ ] Testes automatizados (Vitest + Playwright)
- [ ] Pipeline de CI (lint + build check)
- [ ] Sync em background (PWA)

---

## Contribuindo

Issues e PRs são bem-vindos. Para mudanças grandes, abrir uma issue antes para discutir a abordagem.

Convenções:
- **Idioma da UI:** PT-BR
- **Idioma do código:** identificadores em inglês, comentários em português
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `security:`, `docs:`)
- **IDs:** UUID v4 (`crypto.randomUUID()`)
- **Toda inserção de dado de usuário em `innerHTML` DEVE passar por `escapeHTML()`**
- **Toda query nova em tabela DEVE confiar no RLS, nunca apenas em filtros JS**

---

## Autor

[@kaiquecorreia01](https://github.com/kaiquecorreia01)
