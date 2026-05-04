# CLAUDE.md — Contexto do projeto SmartDiet

## O que é este projeto

SmartDiet é um app web de rastreamento de dieta com macronutrientes. Permite registrar refeições, alimentos (com quantidade em gramas), calcular macros automaticamente (proteína, carboidrato, gordura, calorias) e acompanhar o progresso diário em relação a metas configuráveis.

O app é acessível de qualquer dispositivo (PC, celular, trabalho) — os dados ficam sincronizados na nuvem via Supabase.

## Stack tecnológica

- **Frontend:** HTML + CSS + JavaScript puro (arquivo único `index.html`)
- **Backend/Banco:** Supabase (PostgreSQL na nuvem + autenticação + API automática)
- **Hospedagem:** Vercel (deploy automático via GitHub)
- **PWA:** manifest.json + sw.js (instalável como app no celular)

### Por que HTML/CSS/JS puro?

O desenvolvedor está aprendendo dev web. A decisão foi começar sem frameworks para entender os fundamentos. A arquitetura já está preparada para migração futura para React/Vue se desejado.

## Arquitetura do código

### Arquivo único (`index.html`)

Tudo está em um único arquivo: CSS no `<style>`, HTML no `<body>`, JS no `<script>`. Isso é intencional para o momento de aprendizado. Futuramente pode ser separado em `style.css`, `app.js`, etc.

### Camada de storage (abstração)

As funções de dados são separadas em duas camadas:

1. **Funções de cloud** — falam diretamente com o Supabase:
   - `saveMealToCloud()`, `saveFoodToCloud()`, `deleteFoodFromCloud()`, `updateFoodQtyInCloud()`
   - `loadDayFromCloud()`, `loadLibraryFromCloud()`
   
2. **Funções de ação** — o app chama essas, elas atualizam o estado local e chamam as de cloud:
   - `addMeal()`, `addFood()`, `deleteFood()`, `updateFoodQty()`, `deleteMeal()`

Essa separação permite trocar o backend sem mexer na UI.

### Padrão de renderização

O app segue o padrão: **dados mudam → `render()` redesenha tudo**.
- `render()` chama `renderDate()`, `renderMacros()`, `renderMeals()`
- `createMealCard()` gera o HTML de cada card de refeição
- Toda inserção de dados do usuário no DOM passa por `escapeHTML()` para prevenir XSS

### Sistema de modais

Cada funcionalidade tem seu modal:
- `modal-meal` — criar nova refeição
- `modal-food` — adicionar alimento (com busca na biblioteca)
- `modal-edit-qty` — editar quantidade de alimento
- `modal-edit-meal` — editar tipo/horário da refeição
- `modal-goals` — configurar metas de macros
- `modal-duplicate` — copiar refeições de outro dia

## Supabase — configuração

### URL e chave

```
URL: https://xxjfursxhsppjmrkwgeb.supabase.co
Anon Key: (está no index.html — é pública por design do Supabase)
```

### Tabelas

| Tabela | Descrição |
|---|---|
| `meals` | Refeições (id, user_id, name, emoji, time, date, sort_order) |
| `meal_foods` | Alimentos dentro de refeições (id, meal_id, user_id, name, qty, macros per 100g) |
| `food_library` | Biblioteca pessoal de alimentos reutilizáveis (name, macros, usage_count) |
| `user_goals` | Metas de macros do usuário (kcal, prot, carb, fat) |

### Segurança

- **RLS (Row Level Security)** ativo em todas as tabelas — cada usuário só vê seus dados
- Policies: SELECT, INSERT, UPDATE, DELETE com `auth.uid() = user_id`
- `ON DELETE CASCADE` em meal_foods → meals (deletar refeição apaga alimentos)
- Índices em `(user_id, date)` para queries rápidas

## Segurança do frontend

### Vulnerabilidades corrigidas

1. **XSS** — função `escapeHTML()` aplicada em todos os pontos de `innerHTML` que recebem dados do usuário
2. **CSP** — Content-Security-Policy via meta tag, whitelist de domínios permitidos
3. **Rate limiting** — login bloqueado por 30s após 5 tentativas falhas
4. **Validação de inputs** — limites: qty ≤ 10.000g, kcal ≤ 900/100g, macros ≤ 100g/100g, nome ≤ 100 chars
5. **Information leakage** — `console.error` substituído por `logError()` que não expõe estrutura do banco
6. **CSRF** — mitigado pelo JWT do Supabase + CSP com `frame-src: none` e `form-action: self`

### Frameworks de referência

As vulnerabilidades foram classificadas usando OWASP Top 10 (2021) e CWE.

## Funcionalidades implementadas

- [x] Registro de refeições (criar, editar, excluir)
- [x] Alimentos com quantidade em gramas + macros por 100g
- [x] Cálculo automático de macros
- [x] Cards de resumo diário com barras de progresso + porcentagem
- [x] Navegação entre datas
- [x] Metas configuráveis (modal de objetivo)
- [x] Biblioteca pessoal de alimentos (auto-salva, busca, exclusão)
- [x] Editar quantidade de alimento já adicionado
- [x] Excluir alimento da refeição
- [x] Excluir/editar refeição inteira
- [x] Duplicar refeições de outro dia
- [x] Login/cadastro com email e senha (Supabase Auth)
- [x] Sincronização na nuvem (acesso multi-dispositivo)
- [x] Migração automática de dados do localStorage para Supabase
- [x] PWA (manifest.json + service worker)
- [x] Design responsivo (mobile + desktop)
- [x] Correções de segurança (XSS, CSP, rate limiting, validação)

## Próximos passos (backlog)

### Prioridade alta
- [ ] Gráficos de evolução semanal/mensal (consumo vs metas ao longo do tempo)
- [ ] Histórico com filtros e busca por data
- [ ] Registro de peso corporal com gráfico de evolução

### Prioridade média
- [ ] Registro de água consumida diariamente
- [ ] Modo claro/escuro (toggle de tema)
- [ ] Exportar dados (CSV ou PDF)
- [ ] Separar código em arquivos (style.css, app.js, auth.js)

### Prioridade baixa / futuro
- [ ] Migrar para React ou Vue (quando o dev estiver confortável com frameworks)
- [ ] Usar Vite como bundler
- [ ] Testes automatizados
- [ ] CI/CD pipeline

## Convenções

- **Idioma do app:** Português brasileiro
- **Idioma do código:** variáveis e funções em inglês, comentários em português
- **Chaves do localStorage:** prefixo `dietlog_` (mantidas por compatibilidade, mesmo com rebrand para SmartDiet)
- **IDs do Supabase:** UUID v4 gerado por `crypto.randomUUID()`
- **Estilo visual:** tema escuro, cor de destaque verde (#4ade80), fontes DM Sans + DM Mono
- **Segurança:** todo dado do usuário inserido via innerHTML DEVE passar por `escapeHTML()`

## Comandos úteis

```bash
# Ver o projeto
npx serve .

# Deploy (automático via Vercel + GitHub push)
git add .
git commit -m "feat: descrição"
git push
```

## Estrutura de arquivos

```
smartdiet/
├── README.md                # Visão geral do projeto (cartão de visita)
├── CLAUDE.md                # Este arquivo
├── index.html               # Shell HTML (sem JS/CSS inline)
├── style.css                # Estilos
├── app.js                   # Lógica do app
├── sw.js                    # Service Worker (PWA)
├── manifest.json            # PWA manifest
├── vercel.json              # Headers de segurança + cache
├── docs/
│   └── SECURITY-CHECKLIST.md
└── supabase/
    ├── setup.sql            # Schema completo (idempotente)
    └── migrations/
        ├── 001-initial.sql
        └── 002-weight-history.sql
```
