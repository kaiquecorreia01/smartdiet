# SmartDiet — Checklist de Hardening (fora do código)

Itens que **só você** consegue aplicar pelos painéis. Marque conforme for fazendo.

## Supabase (dashboard)

- [ ] **Confirmar que `service_role` key NUNCA foi commitada nem usada no frontend.**
      Settings → API. A chave que está no `app.js` é a `anon` (✅ verificado).
- [ ] **Auth → Settings → Email → "Confirm email" = ON.** Sem confirmação,
      qualquer um cria conta com email alheio (impacto baixo aqui, mas é boa prática).
- [ ] **Auth → Rate Limits.** Reduzir "Sign in / Sign up" para algo como
      30/hora por IP. O lockout do frontend é só UX — atacante bypassa fácil.
- [ ] **Auth → Hooks → CAPTCHA (hCaptcha/Turnstile).** Ativar em sign-up
      previne criação automatizada de contas (DoS de cota / spam).
- [ ] **Auth → Password requirements**: mínimo 8 chars, exigir letras+números
      (já validado client-side em `app.js`, mas configurar no Supabase reforça).
- [ ] **Auth → URL Configuration → Site URL**: apontar SOMENTE para o domínio
      do Vercel (ex.: `https://smartdiet.vercel.app`). Sem `localhost` em prod.
- [ ] **Auth → URL Configuration → Redirect URLs**: lista branca estrita.
- [ ] **Database → Tables → Enable RLS em todas as tabelas.** Já feito via
      `supabase/migrations/001-initial.sql`, mas confirme nos toggles do dashboard.
- [ ] **Database → Indexes**: verificar que `idx_meal_foods_user`,
      `meals_user_date_idx`, `weight_logs_user_date_idx`, `food_library_usage_idx`
      existem (ajudam contra DoS por slow queries).
- [ ] **Storage → Buckets**: você não usa storage. Se criar no futuro,
      por padrão buckets devem ser PRIVATE.
- [ ] **Edge Functions / Triggers**: sem nada agora — OK.
- [ ] **Logs → Activity**: revisar de tempos em tempos para detectar inserts
      em massa anômalos (sinal de abuso).
- [ ] **Backups**: PG dumps diários no Supabase (Pro plan) ou export manual
      mensal se estiver no Free.

## Vercel (dashboard)

- [ ] **Settings → Environment Variables**: nenhuma var de produção contém
      secrets (você não usa nenhuma — ✅).
- [ ] **Settings → Deployment Protection**: deixar Production aberto, mas
      considerar habilitar **Vercel Authentication em Preview deployments**
      para evitar que branches expostos recebam tráfego público.
- [ ] **Settings → Git → Ignored Build Step**: opcional.
- [ ] **Settings → Domains**: garantir HTTPS-only (default).
- [ ] **Settings → Advanced → Skew Protection**: ON em produção (evita
      mistura de versões de assets durante deploy).

## GitHub (repositório)

- [ ] **Settings → Secret scanning**: ON (free para repos públicos).
- [ ] **Settings → Push protection**: ON (bloqueia push com secret detectado).
- [ ] **Settings → Branches → main → Protection rules**:
  - [ ] Require pull request review before merging
  - [ ] Require status checks (se adicionar CI no futuro)
  - [ ] Require linear history
  - [ ] Block force pushes
- [ ] **Settings → Actions → General → Workflow permissions**: Read-only
      por padrão (até você adicionar workflows).
- [ ] **Confirmar que `.git/`, `.env*`, `.vercel/`, `node_modules/` estão
      no `.gitignore`** (✅ adicionado).
- [ ] **Histórico de commits**: rodar `git log -p --all -S "service_role"`
      e similares para garantir que nenhuma chave sensível foi commitada
      em algum commit antigo. Se foi: revogar a chave NO supabase
      (rotação de JWT secret) — não basta `git rebase`.

## Tokens / Sessões

- [ ] **Supabase JWT TTL** (default 3600s) está OK. Refresh token rotation
      já é automático no SDK supabase-js.
- [ ] **Logout em todos os dispositivos**: o app não expõe esse botão hoje.
      Se quiser, adicione: `sb.auth.signOut({ scope: 'global' })`.

## Itens médios/baixos não corrigidos (para você decidir)

- `style-src 'unsafe-inline'` no CSP — necessário pelos `style="..."`
  inline em vários lugares do `index.html`. Para remover, mova esses
  estilos para classes em `style.css`.
- `Cross-Origin-Embedder-Policy: credentialless` foi adicionado, mas
  pode quebrar futuras embeds (ex: vídeos do YouTube). Se quebrar,
  remova a linha do `vercel.json`.
- Auditoria de dependências CDN: hoje você importa apenas Supabase e
  Chart.js da `cdn.jsdelivr.net`, ambos com SRI — risco baixo, mas
  num projeto maior considere bundlar tudo localmente.
- Não há monitoramento (Sentry / LogRocket). Para detectar erros em
  produção sem quebrar privacidade, considere uma solução com
  scrubbing de PII.
