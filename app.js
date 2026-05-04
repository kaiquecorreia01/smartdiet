/* =====================================================================
   SUPABASE — conexão com o banco
===================================================================== */
const SUPABASE_URL = 'https://xxjfursxhsppjmrkwgeb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4amZ1cnN4aHNwcGptcmt3Z2ViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDQ5OTcsImV4cCI6MjA5MzA4MDk5N30.LHun7Br2weqEvWsyIpnL8oyPhMHBBOiGF5ndHzgKPLM';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =====================================================================
   ESTADO GLOBAL
===================================================================== */
let currentDate         = getTodayStr();
let allData             = {};
let activeMealId        = null;
let selectedLibraryFood = null;
let selectedMealType    = 'Café da manhã';
let selectedMealEmoji   = '☀️';
let goals               = { kcal: 2000, prot: 150, carb: 200, fat: 65 };
let currentUser         = null;
let currentView         = 'hoje';
let isLoadingDate       = false;
let _confirmCallback    = null;
let chartWeekly         = null;
let chartMacros         = null;
let chartWeight         = null;
let editingMealRef      = null;
let editMealType        = '';
let editMealEmoji       = '';
let editingMealId       = null;
let editingFoodId       = null;
let authMode            = 'login';
let foodLibraryCache    = []; // escopo do módulo (fora de window — não acessível por scripts terceiros)

/* =====================================================================
   TEMA (dark/light) — inicializa antes de tudo
===================================================================== */
(function initTheme() {
  const saved = localStorage.getItem('smartdiet_theme') || 'dark';
  document.documentElement.dataset.theme = saved;
})();

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('smartdiet_theme', next);
  renderThemeToggle();
}

function renderThemeToggle() {
  const isDark = (document.documentElement.dataset.theme || 'dark') === 'dark';
  const sw = document.getElementById('theme-switch');
  const lbl = document.getElementById('theme-switch-label');
  if (sw) sw.classList.toggle('on', !isDark);
  if (lbl) lbl.textContent = isDark ? 'Modo claro' : 'Modo escuro';
  const btnHeader = document.getElementById('btn-theme-header');
  if (btnHeader) btnHeader.textContent = isDark ? '☀️' : '🌙';
}

/* =====================================================================
   UTILITÁRIOS
===================================================================== */
function getTodayStr() { return new Date().toISOString().split('T')[0]; }

function strToDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateLong(str) {
  return strToDate(str).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatDateShort(str) { return strToDate(str).toLocaleDateString('pt-BR'); }

function offsetDate(str, days) {
  const d = strToDate(str);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function calcMacro(valuePer100, qty) { return Math.round((valuePer100 / 100) * qty * 10) / 10; }

/* escapeHTML — bloqueia XSS em todo innerHTML com dados do usuário */
function escapeHTML(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* logError — não expõe stack trace ou estrutura do banco ao usuário */
function logError(context, error) {
  if (error) showToast('Erro ao sincronizar. Tente novamente.');
}

/* =====================================================================
   AUTENTICAÇÃO
===================================================================== */
function toggleAuthMode() {
  authMode = authMode === 'login' ? 'signup' : 'login';
  const isLogin = authMode === 'login';
  document.getElementById('btn-auth').textContent = isLogin ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-toggle-text').textContent = isLogin ? 'Não tem conta?' : 'Já tem conta?';
  document.getElementById('auth-toggle-link').textContent = isLogin ? 'Criar conta' : 'Entrar';
  document.getElementById('auth-subtitle').textContent = isLogin
    ? 'Entre para acessar seus dados de qualquer lugar'
    : 'Crie sua conta gratuita para começar';
  document.getElementById('auth-error').classList.remove('visible');
  document.getElementById('auth-password').autocomplete = isLogin ? 'current-password' : 'new-password';

  // Mostra "confirmar senha" apenas no signup; "esqueci minha senha" apenas no login
  document.getElementById('auth-confirm-group').style.display = isLogin ? 'none' : '';
  document.getElementById('auth-forgot-row').style.display    = isLogin ? '' : 'none';
  // Limpa o campo de confirmar para evitar valores velhos atrapalhando
  document.getElementById('auth-password-confirm').value = '';
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.add('visible');
}

let authFailCount = 0;
let authLockUntil = 0;
let isAuthInFlight = false; // guarda contra cliques duplos / Enter repetido

document.getElementById('btn-auth').addEventListener('click', async () => {
  // Guard de re-entrada — bloqueia dupla submissão antes mesmo de tocar no DOM.
  // Sem isso, dois cliques (ou dois Enters) disparam dois requests ao Supabase
  // e o servidor responde com rate-limit.
  if (isAuthInFlight) return;

  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const btn      = document.getElementById('btn-auth');

  const now = Date.now();
  if (now < authLockUntil) {
    const secsLeft = Math.ceil((authLockUntil - now) / 1000);
    showAuthError(`Muitas tentativas. Aguarde ${secsLeft} segundos.`);
    return;
  }

  if (!email || !password) { showAuthError('Preencha email e senha'); return; }
  if (email.length > 254)  { showAuthError('Email muito longo'); return; }
  if (password.length > 128) { showAuthError('Senha muito longa'); return; }
  if (authMode === 'signup') {
    const passwordConfirm = document.getElementById('auth-password-confirm').value;
    if (password.length < 8)        { showAuthError('A senha precisa ter pelo menos 8 caracteres'); return; }
    if (!/[A-Za-z]/.test(password)) { showAuthError('A senha deve conter letras'); return; }
    if (!/\d/.test(password))       { showAuthError('A senha deve conter pelo menos um número'); return; }
    if (!passwordConfirm)           { showAuthError('Confirme sua senha'); return; }
    if (password !== passwordConfirm) { showAuthError('As senhas não coincidem'); return; }
  } else {
    // login: aceita senhas antigas curtas (compatibilidade), mas bloqueia inputs absurdos
    if (password.length < 6) { showAuthError('Senha inválida'); return; }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError('Formato de email inválido'); return; }

  isAuthInFlight = true;
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.textContent = 'Aguarde...';
  document.getElementById('auth-error').classList.remove('visible');

  try {
    let result;
    if (authMode === 'login') {
      result = await sb.auth.signInWithPassword({ email, password });
    } else {
      result = await sb.auth.signUp({ email, password });
    }

    if (result.error) {
      const rawMsg = (result.error.message || '').toLowerCase();
      const status = result.error.status || 0;

      // O Supabase tem DOIS tipos de rate-limit que podem aparecer aqui:
      //  1) "email send rate limit" — cota de envios de email do projeto inteiro
      //     (default: ~3-4 emails/hora no plano free). Atinge signup e recovery.
      //  2) Rate-limit de IP — proteção contra brute-force, por endereço.
      // Diferenciar é importante porque o usuário não pode "trocar de IP" para
      // contornar o caso 1.
      const isEmailQuota =
        rawMsg.includes('email rate limit') ||
        rawMsg.includes('over_email_send_rate_limit') ||
        rawMsg.includes('email send rate');

      const isIpRateLimit =
        !isEmailQuota && (
          status === 429 ||
          rawMsg.includes('rate limit') ||
          rawMsg.includes('too many requests')
        );

      if (isEmailQuota) {
        // Bloqueia cliques por 60s para evitar mais tentativas inúteis
        authLockUntil = Date.now() + 60000;
        showAuthError('O sistema de envio de emails atingiu o limite por hora. Aguarde cerca de 1 hora e tente novamente — ou peça ao desenvolvedor para configurar SMTP customizado no Supabase.');
      } else if (isIpRateLimit) {
        authLockUntil = Date.now() + 60000;
        showAuthError('Muitas tentativas vindas deste IP. Aguarde cerca de 1 minuto e tente de novo.');
      } else {
        // erros reais de credencial / validação contam para o lockout local
        authFailCount++;
        if (authFailCount >= 5) {
          authLockUntil = Date.now() + 30000;
          authFailCount = 0;
          showAuthError('Muitas tentativas falhas. Bloqueado por 30 segundos.');
        } else {
          let msg = result.error.message;
          if (rawMsg.includes('invalid login') || rawMsg.includes('invalid credentials')) {
            msg = 'Email ou senha incorretos';
          } else if (rawMsg.includes('email not confirmed')) {
            msg = 'Confirme seu email antes de entrar (verifique sua caixa de entrada).';
          } else if (rawMsg.includes('already registered') || rawMsg.includes('user already')) {
            // genérica — não confirma existência da conta (evita user enumeration)
            msg = 'Não foi possível criar a conta. Verifique seus dados ou entre na conta existente.';
          }
          showAuthError(msg);
        }
      }
    } else {
      authFailCount = 0;
    }
  } catch (_) {
    showAuthError('Erro de conexão. Tente novamente.');
  } finally {
    isAuthInFlight = false;
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    btn.textContent = authMode === 'login' ? 'Entrar' : 'Criar conta';
  }
});

document.getElementById('auth-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-auth').click();
});

// Confirmar senha — Enter dispara o botão de cadastro
document.getElementById('auth-password-confirm').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-auth').click();
});

// Toggle de visibilidade da senha (olhinho) — handler único para todos os botões.
// Cada botão tem data-target apontando para o id do input correspondente.
document.querySelectorAll('.password-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const input    = document.getElementById(targetId);
    if (!input) return;
    const willShow = input.type === 'password';
    input.type = willShow ? 'text' : 'password';
    btn.classList.toggle('is-visible', willShow);
    btn.setAttribute('aria-label',  willShow ? 'Ocultar senha' : 'Mostrar senha');
    btn.setAttribute('title',       willShow ? 'Ocultar senha' : 'Mostrar senha');
  });
});

// Auth toggle — sem onclick inline (permite remover 'unsafe-inline' do CSP)
document.getElementById('auth-toggle-link').addEventListener('click', toggleAuthMode);
document.getElementById('auth-toggle-link').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAuthMode(); }
});

/* =====================================================================
   ESQUECI MINHA SENHA — abre modal, envia link de recuperação
===================================================================== */
function showForgotError(msg) {
  const el = document.getElementById('forgot-error');
  el.textContent = msg;
  el.classList.add('visible');
}

function openForgotModal() {
  document.getElementById('forgot-error').classList.remove('visible');
  document.getElementById('forgot-email').value = document.getElementById('auth-email').value.trim();
  document.getElementById('modal-forgot').classList.add('active');
  setTimeout(() => document.getElementById('forgot-email').focus(), 50);
}

function closeForgotModal() {
  document.getElementById('modal-forgot').classList.remove('active');
}

let isForgotInFlight = false;

async function sendForgotEmail() {
  if (isForgotInFlight) return;
  const email = document.getElementById('forgot-email').value.trim();
  const btn   = document.getElementById('btn-send-forgot');

  if (!email) { showForgotError('Informe seu email'); return; }
  if (email.length > 254) { showForgotError('Email muito longo'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showForgotError('Formato de email inválido'); return; }

  isForgotInFlight = true;
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.textContent = 'Enviando...';
  document.getElementById('forgot-error').classList.remove('visible');

  try {
    // O Supabase processa o link automaticamente quando o app carrega
    // (parsing do hash). O event PASSWORD_RECOVERY dispara em onAuthStateChange.
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    });
    if (error) {
      const rawMsg = (error.message || '').toLowerCase();
      const isEmailQuota =
        rawMsg.includes('email rate limit') ||
        rawMsg.includes('over_email_send_rate_limit') ||
        rawMsg.includes('email send rate');
      if (isEmailQuota) {
        showForgotError('O sistema de envio de emails atingiu o limite por hora. Aguarde cerca de 1 hora antes de tentar novamente.');
      } else if (error.status === 429 || rawMsg.includes('rate limit') || rawMsg.includes('too many')) {
        showForgotError('Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.');
      } else {
        showForgotError('Não foi possível enviar o email. Tente novamente em instantes.');
      }
    } else {
      // Sempre mostra mensagem genérica de sucesso (não confirma se o email existe — evita user enumeration)
      closeForgotModal();
      showToast('Se o email estiver cadastrado, você receberá o link em instantes.');
    }
  } catch (_) {
    showForgotError('Erro de conexão. Tente novamente.');
  } finally {
    isForgotInFlight = false;
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    btn.textContent = 'Enviar email';
  }
}

document.getElementById('auth-forgot-link').addEventListener('click', openForgotModal);
document.getElementById('auth-forgot-link').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openForgotModal(); }
});
document.getElementById('btn-cancel-forgot').addEventListener('click', closeForgotModal);
document.getElementById('btn-send-forgot').addEventListener('click', sendForgotEmail);
document.getElementById('forgot-email').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendForgotEmail();
});

/* =====================================================================
   REDEFINIR SENHA — modal aparece quando o usuário entra via link de recovery
===================================================================== */
let isResetInFlight = false;
let isInRecoveryFlow = false; // bloqueia o init do app durante o reset

function showResetError(msg) {
  const el = document.getElementById('reset-error');
  el.textContent = msg;
  el.classList.add('visible');
}

function openResetPasswordModal() {
  document.getElementById('reset-error').classList.remove('visible');
  document.getElementById('reset-password').value = '';
  document.getElementById('reset-password-confirm').value = '';
  // Garante que a tela de auth está visível por trás (não o app)
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-container').classList.add('hidden');
  document.getElementById('bottom-nav').classList.add('hidden');
  document.getElementById('modal-reset-password').classList.add('active');
  setTimeout(() => document.getElementById('reset-password').focus(), 50);
}

function closeResetPasswordModal() {
  document.getElementById('modal-reset-password').classList.remove('active');
}

async function saveNewPassword() {
  if (isResetInFlight) return;
  const pw1 = document.getElementById('reset-password').value;
  const pw2 = document.getElementById('reset-password-confirm').value;
  const btn = document.getElementById('btn-save-new-password');

  if (!pw1 || !pw2)            { showResetError('Preencha as duas senhas'); return; }
  if (pw1.length < 8)          { showResetError('A senha precisa ter pelo menos 8 caracteres'); return; }
  if (pw1.length > 128)        { showResetError('Senha muito longa'); return; }
  if (!/[A-Za-z]/.test(pw1))   { showResetError('A senha deve conter letras'); return; }
  if (!/\d/.test(pw1))         { showResetError('A senha deve conter pelo menos um número'); return; }
  if (pw1 !== pw2)             { showResetError('As senhas não coincidem'); return; }

  isResetInFlight = true;
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.textContent = 'Salvando...';
  document.getElementById('reset-error').classList.remove('visible');

  try {
    const { error } = await sb.auth.updateUser({ password: pw1 });
    if (error) {
      const rawMsg = (error.message || '').toLowerCase();
      if (rawMsg.includes('same') && rawMsg.includes('password')) {
        showResetError('A nova senha não pode ser igual à anterior.');
      } else if (rawMsg.includes('session') || rawMsg.includes('token')) {
        showResetError('O link de recuperação expirou. Solicite outro.');
      } else {
        showResetError('Não foi possível atualizar a senha. Tente novamente.');
      }
    } else {
      // Sucesso — desloga, fecha tudo e volta pro login com a nova senha
      isInRecoveryFlow = false;
      closeResetPasswordModal();
      await sb.auth.signOut();
      showToast('Senha atualizada! Entre com a nova senha.');
    }
  } catch (_) {
    showResetError('Erro de conexão. Tente novamente.');
  } finally {
    isResetInFlight = false;
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    btn.textContent = 'Salvar nova senha';
  }
}

document.getElementById('btn-save-new-password').addEventListener('click', saveNewPassword);
document.getElementById('reset-password-confirm').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveNewPassword();
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
});

let _appInitialized = false;

sb.auth.onAuthStateChange(async (event, session) => {
  // Fluxo de "esqueci minha senha": quando o usuário clica no link do email,
  // o SDK do Supabase abre uma sessão temporária e dispara PASSWORD_RECOVERY.
  // Não inicializamos o app — abrimos o modal de definir nova senha.
  if (event === 'PASSWORD_RECOVERY') {
    isInRecoveryFlow = true;
    currentUser = session?.user || null;
    openResetPasswordModal();
    return;
  }

  // Se estamos no fluxo de recovery, ignoramos SIGNED_IN/TOKEN_REFRESHED
  // (a sessão temporária não deve abrir o app, só serve para o updateUser).
  if (isInRecoveryFlow && event !== 'SIGNED_OUT') return;

  if (session && session.user) {
    currentUser = session.user; // sempre atualiza — TOKEN_REFRESHED rota o JWT sem reinicializar
    if (_appInitialized) return;

    // Valida a sessão contra o servidor — se a conta foi apagada/banida,
    // o JWT cacheado no localStorage ainda parece válido (assinado, não expirou),
    // mas o user não existe mais. Sem essa checagem, o app entra "logado em
    // fantasma" e todas as queries falham silenciosamente.
    const { data: verified, error: verifyError } = await sb.auth.getUser();
    if (verifyError || !verified?.user) {
      await sb.auth.signOut(); // dispara o branch de logout abaixo
      return;
    }

    _appInitialized = true;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('bottom-nav').classList.remove('hidden');
    await initApp();
  } else {
    // Logout — zera TODO o estado em memória para evitar vazamento entre usuários
    // no mesmo browser (CWE-200 / OWASP A01:2021).
    currentUser = null;
    _appInitialized = false;
    allData = {};
    goals = { kcal: 2000, prot: 150, carb: 200, fat: 65 };
    foodLibraryCache = [];
    activeMealId = null;
    selectedLibraryFood = null;
    editingMealId = null;
    editingFoodId = null;
    editingMealRef = null;
    currentDate = getTodayStr();
    _confirmCallback = null;

    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-container').classList.add('hidden');
    document.getElementById('bottom-nav').classList.add('hidden');
    destroyCharts();
  }
});

/* =====================================================================
   SUPABASE — CAMADA DE DADOS
===================================================================== */
async function loadDayFromCloud(date) {
  const { data: meals, error } = await sb
    .from('meals')
    .select('*, meal_foods(*)')
    .eq('user_id', currentUser.id)
    .eq('date', date)
    .order('sort_order');

  if (error || !meals) return { meals: [] };

  return {
    meals: meals.map(m => ({
      id: m.id, name: m.name, emoji: m.emoji, time: m.time,
      foods: (m.meal_foods || [])
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
        .map(f => ({
          id: f.id, name: f.name, qty: f.qty,
          kcalPer100: f.kcal_per100, protPer100: f.prot_per100,
          carbPer100: f.carb_per100, fatPer100: f.fat_per100,
        })),
    }))
  };
}

async function loadDiaryData() {
  allData[currentDate] = await loadDayFromCloud(currentDate);
}

async function saveMealToCloud(meal) {
  const { data, error } = await sb.from('meals').insert({
    id: meal.id, user_id: currentUser.id, name: meal.name,
    emoji: meal.emoji, time: meal.time, date: currentDate,
    sort_order: getMeals().length,
  }).select().single();
  logError('saveMeal', error);
  return data;
}

async function saveFoodToCloud(mealId, food) {
  const { error } = await sb.from('meal_foods').insert({
    id: food.id, meal_id: mealId, user_id: currentUser.id,
    name: food.name, qty: food.qty,
    kcal_per100: food.kcalPer100, prot_per100: food.protPer100,
    carb_per100: food.carbPer100, fat_per100: food.fatPer100,
  });
  logError('saveFood', error);
}

async function deleteFoodFromCloud(foodId) {
  const { error } = await sb.from('meal_foods').delete().eq('id', foodId);
  logError('deleteFood', error);
}

async function updateFoodQtyInCloud(foodId, newQty) {
  const { error } = await sb.from('meal_foods').update({ qty: newQty }).eq('id', foodId);
  logError('updateQty', error);
}

/* --- BIBLIOTECA --- */
function loadLibrary() { return foodLibraryCache; }

async function loadLibraryFromCloud() {
  const { data, error } = await sb
    .from('food_library').select('*')
    .eq('user_id', currentUser.id)
    .order('usage_count', { ascending: false });
  if (error || !data) return [];
  return data.map(f => ({
    id: f.id, name: f.name,
    kcalPer100: f.kcal_per100, protPer100: f.prot_per100,
    carbPer100: f.carb_per100, fatPer100: f.fat_per100,
    usageCount: f.usage_count,
  }));
}

async function upsertLibraryFood(food) {
  const library   = loadLibrary();
  const nameLower = food.name.toLowerCase().trim();
  const existing  = library.find(item => item.name.toLowerCase().trim() === nameLower);

  if (existing) {
    existing.usageCount = (existing.usageCount || 0) + 1;
    await sb.from('food_library').update({ usage_count: existing.usageCount }).eq('id', existing.id);
  } else {
    const { data } = await sb.from('food_library').insert({
      user_id: currentUser.id, name: food.name.trim(),
      kcal_per100: food.kcalPer100, prot_per100: food.protPer100,
      carb_per100: food.carbPer100, fat_per100: food.fatPer100, usage_count: 1,
    }).select().single();
    if (data) library.push({
      id: data.id, name: data.name,
      kcalPer100: data.kcal_per100, protPer100: data.prot_per100,
      carbPer100: data.carb_per100, fatPer100: data.fat_per100,
      usageCount: data.usage_count,
    });
  }
  foodLibraryCache = library;
  return library;
}

function searchLibrary(query) {
  if (!query || query.trim().length < 1) return [];
  const library    = loadLibrary();
  const queryLower = query.toLowerCase().trim();
  return library
    .filter(item => item.name.toLowerCase().includes(queryLower))
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
    .slice(0, 6);
}

async function deleteLibraryFood(foodId) {
  await sb.from('food_library').delete().eq('id', foodId);
  foodLibraryCache = foodLibraryCache.filter(item => item.id !== foodId);
}

/* --- METAS --- */
async function loadGoals() {
  const { data } = await sb.from('user_goals').select('*')
    .eq('user_id', currentUser.id).maybeSingle();
  if (data) goals = { kcal: data.kcal, prot: data.prot, carb: data.carb, fat: data.fat };
}

async function saveGoals() {
  await sb.from('user_goals').upsert(
    { user_id: currentUser.id, kcal: goals.kcal, prot: goals.prot, carb: goals.carb, fat: goals.fat },
    { onConflict: 'user_id' }
  );
}

/* --- LIMPEZA DE LOCALSTORAGE LEGADO ---
   A migração one-shot do localStorage foi removida (CWE-639):
   se um User A usasse o app antes da migração e User B logasse no mesmo
   browser, os dados de A iam para o DB de B. Apenas removemos restos. */
function purgeLegacyLocalStorage() {
  ['dietlog_diary','dietlog_library','dietlog_goals','dietlog_data']
    .forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
}

/* =====================================================================
   INICIALIZAÇÃO
===================================================================== */
async function initApp() {
  purgeLegacyLocalStorage();
  await loadGoals();
  foodLibraryCache = await loadLibraryFromCloud();
  await loadDiaryData();
  renderThemeToggle();
  render();
  switchView('hoje');
}

/* =====================================================================
   NAVEGAÇÃO ENTRE VIEWS
===================================================================== */
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${view}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });

  if (view === 'historico') loadHistoryView();
  if (view === 'graficos')  loadChartsView();
  if (view === 'perfil')    loadProfileView();
}

/* =====================================================================
   ESTADO DO DIÁRIO
===================================================================== */
function ensureDay(date) {
  if (!allData[date]) allData[date] = { meals: [] };
}
function getMeals() {
  ensureDay(currentDate);
  return allData[currentDate].meals;
}
function calcDayTotals() {
  const t = { kcal: 0, prot: 0, carb: 0, fat: 0 };
  getMeals().forEach(meal => {
    meal.foods.forEach(food => {
      t.kcal += calcMacro(food.kcalPer100, food.qty);
      t.prot += calcMacro(food.protPer100, food.qty);
      t.carb += calcMacro(food.carbPer100, food.qty);
      t.fat  += calcMacro(food.fatPer100,  food.qty);
    });
  });
  t.kcal = Math.round(t.kcal);
  t.prot = Math.round(t.prot * 10) / 10;
  t.carb = Math.round(t.carb * 10) / 10;
  t.fat  = Math.round(t.fat  * 10) / 10;
  return t;
}

/* =====================================================================
   RENDERIZAÇÃO — VIEW HOJE
===================================================================== */
function render() {
  renderDate();
  renderMacros();
  renderMeals();
  renderLibraryCount();
}

function renderDate() {
  const today   = getTodayStr();
  const isToday = currentDate === today;
  const longDate = formatDateLong(currentDate);
  const dateText = longDate.charAt(0).toUpperCase() + longDate.slice(1);

  document.getElementById('date-main').innerHTML =
    escapeHTML(dateText) +
    (isToday ? ' <span class="date-today-badge">hoje</span>' : '');
  document.getElementById('date-sub').textContent = formatDateShort(currentDate);
  document.getElementById('btn-next-day').disabled = isToday;
  document.getElementById('btn-next-day').style.opacity = isToday ? '0.3' : '1';
}

function renderMacros() {
  const t = calcDayTotals();
  document.getElementById('total-kcal').textContent = t.kcal;
  document.getElementById('total-prot').textContent = t.prot + 'g';
  document.getElementById('total-carb').textContent = t.carb + 'g';
  document.getElementById('total-fat').textContent  = t.fat  + 'g';
  document.getElementById('goal-kcal').textContent = goals.kcal;
  document.getElementById('goal-prot').textContent = goals.prot;
  document.getElementById('goal-carb').textContent = goals.carb;
  document.getElementById('goal-fat').textContent  = goals.fat;

  const pct = (val, goal) => goal > 0 ? Math.min(100, Math.round((val / goal) * 100)) : 0;
  const pctKcal = pct(t.kcal, goals.kcal);
  const pctProt = pct(t.prot, goals.prot);
  const pctCarb = pct(t.carb, goals.carb);
  const pctFat  = pct(t.fat,  goals.fat);

  ['kcal','prot','carb','fat'].forEach(m => {
    const val = m === 'kcal' ? pctKcal : m === 'prot' ? pctProt : m === 'carb' ? pctCarb : pctFat;
    document.getElementById(`bar-${m}`).style.width = val + '%';
    document.getElementById(`pct-${m}`).textContent = val + '%';
  });
}

function renderMeals() {
  const meals      = getMeals();
  const container  = document.getElementById('meals-list');
  const emptyState = document.getElementById('empty-state');
  emptyState.style.display = meals.length === 0 ? 'block' : 'none';
  container.querySelectorAll('.meal-card').forEach(el => el.remove());
  meals.forEach(meal => container.appendChild(createMealCard(meal)));
}

function renderLibraryCount() {
  const count = loadLibrary().length;
  document.getElementById('library-count').textContent = `📚 ${count} alimento${count !== 1 ? 's' : ''}`;
}

function createMealCard(meal) {
  const mealKcal = Math.round(
    meal.foods.reduce((sum, f) => sum + calcMacro(f.kcalPer100, f.qty), 0)
  );
  const card = document.createElement('div');
  card.className = 'meal-card';
  card.dataset.id = meal.id;
  card.innerHTML = `
    <div class="meal-card-header">
      <div class="meal-info">
        <div class="meal-icon">${escapeHTML(meal.emoji)}</div>
        <div>
          <div class="meal-name">${escapeHTML(meal.name)}</div>
          <div class="meal-time">${escapeHTML(meal.time)}</div>
        </div>
      </div>
      <div class="meal-summary">
        <span class="meal-kcal">${mealKcal} kcal</span>
        <div class="meal-actions">
          <button class="meal-action-btn" data-action="edit" data-meal-id="${escapeHTML(meal.id)}" title="Editar refeição">✎</button>
          <button class="meal-action-btn delete" data-action="delete" data-meal-id="${escapeHTML(meal.id)}" title="Excluir refeição">✕</button>
        </div>
        <span class="meal-chevron">▼</span>
      </div>
    </div>
    <div class="meal-body">
      <div class="food-table-header">
        <span>Alimento</span><span>Qtd</span><span>Kcal</span>
        <span>Prot</span><span>Carb</span><span class="col-fat">Gord</span>
      </div>
      ${meal.foods.map(food => `
        <div class="food-row" data-meal-id="${escapeHTML(meal.id)}" data-food-id="${escapeHTML(food.id)}" title="Clique para editar quantidade">
          <span class="food-name">${escapeHTML(food.name)}</span>
          <span class="food-val">${food.qty}g</span>
          <span class="food-kcal">${Math.round(calcMacro(food.kcalPer100, food.qty))}</span>
          <span class="food-val">${calcMacro(food.protPer100, food.qty)}g</span>
          <span class="food-val">${calcMacro(food.carbPer100, food.qty)}g</span>
          <span class="food-val col-fat">${calcMacro(food.fatPer100, food.qty)}g</span>
          <button class="food-delete-btn" data-action="delete-food" data-meal-id="${escapeHTML(meal.id)}" data-food-id="${escapeHTML(food.id)}">✕</button>
        </div>
      `).join('')}
      <div class="add-food-area">
        <button class="btn-add-food" data-action="add-food" data-meal-id="${escapeHTML(meal.id)}">+ Adicionar alimento</button>
      </div>
    </div>
  `;

  card.querySelector('.meal-card-header').addEventListener('click', () => card.classList.toggle('expanded'));

  // Delegação de eventos — um único handler. A condição que disparava
  // dois `openEditQtyModal` foi removida; a edição de quantidade é tratada
  // pelo handler abaixo de `food-row` (sem `data-action`).
  card.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset?.action;
    if (!action) return;
    e.stopPropagation();
    const mealId = e.target.closest('[data-meal-id]')?.dataset?.mealId;
    const foodId = e.target.closest('[data-food-id]')?.dataset?.foodId;

    if (action === 'edit')        openEditMealModal(mealId);
    if (action === 'delete')      confirmDeleteMeal(mealId);
    if (action === 'add-food')    openFoodModal(mealId);
    if (action === 'delete-food') confirmDeleteFood(mealId, foodId);
  });

  // Clique na food-row (exceto no botão de excluir) abre edição de quantidade
  card.querySelectorAll('.food-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.food-delete-btn')) return;
      openEditQtyModal(row.dataset.mealId, row.dataset.foodId);
    });
  });

  return card;
}

/* =====================================================================
   AÇÕES DO DIÁRIO
===================================================================== */
async function addMeal(name, emoji, time) {
  ensureDay(currentDate);
  const newMeal = { id: crypto.randomUUID(), name, emoji, time: time || '--:--', foods: [] };
  allData[currentDate].meals.push(newMeal);
  render();
  showToast(`Refeição "${name}" criada`);
  await saveMealToCloud(newMeal);
}

async function addFood(mealId, food) {
  const meal = getMeals().find(m => m.id === mealId);
  if (!meal) return;
  const newFood = { id: crypto.randomUUID(), ...food };
  meal.foods.push(newFood);
  render();
  setTimeout(() => {
    const card = document.querySelector(`.meal-card[data-id="${mealId}"]`);
    if (card) card.classList.add('expanded');
  }, 0);
  showToast(`"${food.name}" adicionado`);
  await saveFoodToCloud(mealId, newFood);
  await upsertLibraryFood(food);
  renderLibraryCount();
}

async function deleteFood(mealId, foodId) {
  const meal = getMeals().find(m => m.id === mealId);
  if (!meal) return;
  meal.foods = meal.foods.filter(f => f.id !== foodId);
  render();
  showToast('Alimento removido');
  await deleteFoodFromCloud(foodId);
}

function confirmDeleteFood(mealId, foodId) {
  const meal = getMeals().find(m => m.id === mealId);
  const food = meal?.foods.find(f => f.id === foodId);
  if (!food) return;
  showConfirm(
    `Remover "${food.name}" desta refeição?`,
    'Remover alimento',
    () => deleteFood(mealId, foodId),
    false
  );
}

async function updateFoodQty(mealId, foodId, newQty) {
  const meal = getMeals().find(m => m.id === mealId);
  if (!meal) return;
  const food = meal.foods.find(f => f.id === foodId);
  if (!food) return;
  food.qty = newQty;
  render();
  showToast('Quantidade atualizada');
  await updateFoodQtyInCloud(foodId, newQty);
}

function confirmDeleteMeal(mealId) {
  const meal = getMeals().find(m => m.id === mealId);
  if (!meal) return;
  showConfirm(
    `Excluir "${meal.name}" e todos os alimentos?\n\nEssa ação não pode ser desfeita.`,
    'Excluir refeição',
    async () => {
      allData[currentDate].meals = getMeals().filter(m => m.id !== mealId);
      render();
      showToast(`"${meal.name}" excluída`);
      await sb.from('meals').delete().eq('id', mealId);
    },
    true
  );
}

/* =====================================================================
   MODAL DE CONFIRMAÇÃO CUSTOMIZADO
   Substitui window.confirm() — não bloqueia a UI e mantém o design
===================================================================== */
function showConfirm(message, title, onConfirm, isDanger = true) {
  _confirmCallback = onConfirm;
  document.getElementById('confirm-title').textContent = title || 'Confirmar';
  document.getElementById('confirm-message').textContent = message;
  const btn = document.getElementById('btn-confirm-yes');
  btn.className = `btn ${isDanger ? 'btn-danger' : 'btn-confirm'}`;
  btn.textContent = isDanger ? 'Excluir' : 'Confirmar';
  document.getElementById('modal-confirm').classList.add('active');
}

function closeConfirmModal() {
  document.getElementById('modal-confirm').classList.remove('active');
  _confirmCallback = null;
}

/* =====================================================================
   EDITAR REFEIÇÃO
===================================================================== */
function openEditMealModal(mealId) {
  const meal = getMeals().find(m => m.id === mealId);
  if (!meal) return;
  editingMealRef = meal;
  editMealType   = meal.name;
  editMealEmoji  = meal.emoji;
  document.querySelectorAll('#edit-meal-type-grid .meal-type-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.type === meal.name);
  });
  document.getElementById('edit-meal-time').value = meal.time !== '--:--' ? meal.time : '';
  document.getElementById('modal-edit-meal').classList.add('active');
}

function closeEditMealModal() {
  document.getElementById('modal-edit-meal').classList.remove('active');
  editingMealRef = null;
}

async function saveEditMeal() {
  if (!editingMealRef) return;
  const time = document.getElementById('edit-meal-time').value || '--:--';
  editingMealRef.name  = editMealType;
  editingMealRef.emoji = editMealEmoji;
  editingMealRef.time  = time;
  render();
  closeEditMealModal();
  showToast('Refeição atualizada');
  await sb.from('meals').update({ name: editMealType, emoji: editMealEmoji, time }).eq('id', editingMealRef.id);
}

/* =====================================================================
   DUPLICAR DIA
===================================================================== */
// Handler do click no list — registrado UMA vez, na inicialização
function handleDuplicateListClick(e) {
  const item = e.target.closest('.duplicate-day-item');
  if (item) executeDuplicate(item.dataset.date);
}

async function openDuplicateModal() {
  document.getElementById('modal-duplicate').classList.add('active');
  const listEl = document.getElementById('duplicate-day-list');
  listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">Carregando...</div>';

  const { data: recentMeals } = await sb
    .from('meals').select('date').eq('user_id', currentUser.id)
    .neq('date', currentDate).order('date', { ascending: false }).limit(50);

  if (!recentMeals || recentMeals.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">Nenhum dia anterior com refeições encontrado.</div>';
    return;
  }

  const dateMap = {};
  recentMeals.forEach(m => { dateMap[m.date] = (dateMap[m.date] || 0) + 1; });
  const uniqueDates = Object.keys(dateMap).slice(0, 7);

  listEl.innerHTML = uniqueDates.map(date => {
    const longDate = formatDateLong(date);
    const label = longDate.charAt(0).toUpperCase() + longDate.slice(1);
    return `<div class="duplicate-day-item" data-date="${escapeHTML(date)}">
      <span class="duplicate-day-date">${escapeHTML(label)}</span>
      <span class="duplicate-day-info">${dateMap[date]} refeição(ões)</span>
    </div>`;
  }).join('');
}

function closeDuplicateModal() {
  document.getElementById('modal-duplicate').classList.remove('active');
}

async function executeDuplicate(sourceDate) {
  closeDuplicateModal();
  showToast('Copiando refeições...');
  const sourceDay = await loadDayFromCloud(sourceDate);
  if (!sourceDay.meals || sourceDay.meals.length === 0) { showToast('Dia sem refeições'); return; }

  // Defesa em profundidade: aplica os mesmos limites do modal de cadastro
  // antes de inserir (CHECK constraints no DB são a 2ª camada).
  const clamp = (v, max) => Math.max(0, Math.min(Number(v) || 0, max));
  const MAX_QTY = 10000, MAX_KCAL = 900, MAX_MACRO = 100, MAX_NAME = 100;

  for (const meal of sourceDay.meals) {
    const newMealId = crypto.randomUUID();
    const cleanName  = String(meal.name || '').slice(0, MAX_NAME);
    const cleanEmoji = String(meal.emoji || '🍽️').slice(0, 10);
    const cleanTime  = String(meal.time || '--:--').slice(0, 10);
    const newMeal = { id: newMealId, name: cleanName, emoji: cleanEmoji, time: cleanTime, foods: [] };
    await sb.from('meals').insert({
      id: newMealId, user_id: currentUser.id,
      name: cleanName, emoji: cleanEmoji, time: cleanTime,
      date: currentDate, sort_order: getMeals().length,
    });
    for (const food of meal.foods) {
      const newFoodId = crypto.randomUUID();
      const cleanFood = {
        id: newFoodId,
        name: String(food.name || '').slice(0, MAX_NAME),
        qty: clamp(food.qty, MAX_QTY),
        kcalPer100: clamp(food.kcalPer100, MAX_KCAL),
        protPer100: clamp(food.protPer100, MAX_MACRO),
        carbPer100: clamp(food.carbPer100, MAX_MACRO),
        fatPer100:  clamp(food.fatPer100,  MAX_MACRO),
      };
      await sb.from('meal_foods').insert({
        id: newFoodId, meal_id: newMealId, user_id: currentUser.id,
        name: cleanFood.name, qty: cleanFood.qty,
        kcal_per100: cleanFood.kcalPer100, prot_per100: cleanFood.protPer100,
        carb_per100: cleanFood.carbPer100, fat_per100: cleanFood.fatPer100,
      });
      newMeal.foods.push(cleanFood);
    }
    ensureDay(currentDate);
    allData[currentDate].meals.push(newMeal);
  }
  render();
  showToast(`${sourceDay.meals.length} refeição(ões) copiadas!`);
}

/* =====================================================================
   MODAL DE REFEIÇÃO
===================================================================== */
function openMealModal() {
  const now = new Date();
  document.getElementById('meal-time-input').value =
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  document.getElementById('modal-meal').classList.add('active');
}
function closeMealModal() { document.getElementById('modal-meal').classList.remove('active'); }

/* =====================================================================
   MODAL EDITAR QUANTIDADE
===================================================================== */
function openEditQtyModal(mealId, foodId) {
  const meal = getMeals().find(m => m.id === mealId);
  if (!meal) return;
  const food = meal.foods.find(f => f.id === foodId);
  if (!food) return;

  editingMealId = mealId;
  editingFoodId = foodId;

  document.getElementById('edit-qty-food-name').textContent = food.name;
  document.getElementById('edit-qty-current-macros').textContent =
    `Atual: ${food.qty}g · ${Math.round(calcMacro(food.kcalPer100, food.qty))} kcal · ` +
    `P${calcMacro(food.protPer100, food.qty)}g · C${calcMacro(food.carbPer100, food.qty)}g · ` +
    `G${calcMacro(food.fatPer100, food.qty)}g`;

  const qtyInput = document.getElementById('edit-qty-input');
  qtyInput.value = food.qty;
  document.getElementById('edit-qty-preview').style.display = 'none';
  document.getElementById('modal-edit-qty').classList.add('active');
  setTimeout(() => { qtyInput.focus(); qtyInput.select(); }, 100);
}

function closeEditQtyModal() {
  document.getElementById('modal-edit-qty').classList.remove('active');
  editingMealId = null;
  editingFoodId = null;
}

function updateEditQtyPreview() {
  if (!editingMealId || !editingFoodId) return;
  const meal = getMeals().find(m => m.id === editingMealId);
  if (!meal) return;
  const food = meal.foods.find(f => f.id === editingFoodId);
  if (!food) return;
  const newQty = parseFloat(document.getElementById('edit-qty-input').value) || 0;
  const preview = document.getElementById('edit-qty-preview');
  if (newQty <= 0) { preview.style.display = 'none'; return; }
  preview.style.display = 'block';
  preview.textContent =
    `Novo: ${newQty}g · ${Math.round(calcMacro(food.kcalPer100, newQty))} kcal · ` +
    `P${calcMacro(food.protPer100, newQty)}g · C${calcMacro(food.carbPer100, newQty)}g · ` +
    `G${calcMacro(food.fatPer100, newQty)}g`;
}

/* =====================================================================
   MODAL DE ALIMENTO
===================================================================== */
function openFoodModal(mealId) {
  activeMealId = mealId;
  selectedLibraryFood = null;
  ['food-search-input','food-name-input','food-qty-input',
   'food-kcal-input','food-prot-input','food-carb-input','food-fat-input']
    .forEach(id => { document.getElementById(id).value = ''; });
  setLibrarySelectionMode(false);
  document.getElementById('food-suggestions').classList.remove('visible');
  document.getElementById('food-suggestions').innerHTML = '';
  document.getElementById('modal-food').classList.add('active');
  setTimeout(() => document.getElementById('food-search-input').focus(), 100);
}

function closeFoodModal() {
  document.getElementById('modal-food').classList.remove('active');
  activeMealId = null;
  selectedLibraryFood = null;
}

function setLibrarySelectionMode(isSelected) {
  const indicator   = document.getElementById('selected-food-indicator');
  const nameGroup   = document.getElementById('food-name-group');
  const macroFields = document.getElementById('macro-fields');
  const dividerText = document.getElementById('divider-text');
  if (isSelected) {
    indicator.classList.add('visible');
    nameGroup.style.display = 'none';
    macroFields.classList.add('locked');
    dividerText.textContent = 'macros preenchidos automaticamente';
  } else {
    indicator.classList.remove('visible');
    nameGroup.style.display = 'block';
    macroFields.classList.remove('locked');
    dividerText.textContent = 'ou cadastre um novo';
  }
}

function selectLibraryFood(food) {
  selectedLibraryFood = food;
  document.getElementById('food-kcal-input').value = food.kcalPer100;
  document.getElementById('food-prot-input').value = food.protPer100;
  document.getElementById('food-carb-input').value = food.carbPer100;
  document.getElementById('food-fat-input').value  = food.fatPer100;
  document.getElementById('selected-food-name').textContent = food.name;
  setLibrarySelectionMode(true);
  document.getElementById('food-suggestions').classList.remove('visible');
  document.getElementById('food-search-input').value = '';
  document.getElementById('food-qty-input').focus();
}

function renderSuggestions(query) {
  const suggestionsEl = document.getElementById('food-suggestions');
  const results = searchLibrary(query);
  if (results.length === 0) {
    suggestionsEl.classList.remove('visible');
    suggestionsEl.innerHTML = '';
    return;
  }
  suggestionsEl.innerHTML = results.map(food => `
    <div class="food-suggestion-item" data-food-id="${escapeHTML(food.id)}">
      <div class="suggestion-content">
        <span class="suggestion-name">${escapeHTML(food.name)}</span>
        <span class="suggestion-macros">${food.kcalPer100} kcal · P${food.protPer100} C${food.carbPer100} G${food.fatPer100}</span>
      </div>
      <button class="suggestion-delete-btn" data-food-id="${escapeHTML(food.id)}" title="Remover da biblioteca">✕</button>
    </div>`).join('');
  suggestionsEl.classList.add('visible');

  suggestionsEl.querySelectorAll('.suggestion-content').forEach(content => {
    content.addEventListener('click', () => {
      const foodId = content.parentElement.dataset.foodId;
      const food = results.find(f => f.id === foodId);
      if (food) selectLibraryFood(food);
    });
  });

  suggestionsEl.querySelectorAll('.suggestion-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const foodId = btn.dataset.foodId;
      const food = results.find(f => f.id === foodId);
      if (!food) return;
      showConfirm(
        `Remover "${food.name}" da biblioteca?\n(suas refeições antigas continuam intactas)`,
        'Remover da biblioteca',
        async () => {
          await deleteLibraryFood(foodId);
          renderSuggestions(query);
          renderLibraryCount();
          showToast(`"${food.name}" removido da biblioteca`);
        },
        true
      );
    });
  });
}

/* =====================================================================
   MODAL DE OBJETIVOS
===================================================================== */
function openGoalsModal() {
  document.getElementById('goal-kcal-input').value = goals.kcal;
  document.getElementById('goal-prot-input').value = goals.prot;
  document.getElementById('goal-carb-input').value = goals.carb;
  document.getElementById('goal-fat-input').value  = goals.fat;
  document.getElementById('modal-goals').classList.add('active');
}
function closeGoalsModal() { document.getElementById('modal-goals').classList.remove('active'); }

/* =====================================================================
   HISTÓRICO
===================================================================== */
async function loadHistoryView() {
  const container = document.getElementById('history-list');
  container.innerHTML = '<div class="history-empty">Carregando...</div>';

  const { data: mealsRaw } = await sb
    .from('meals')
    .select('date, meal_foods(kcal_per100, qty, prot_per100, carb_per100, fat_per100)')
    .eq('user_id', currentUser.id)
    .order('date', { ascending: false })
    .limit(200);

  if (!mealsRaw || mealsRaw.length === 0) {
    container.innerHTML = '<div class="history-empty">Nenhum registro encontrado.</div>';
    return;
  }

  // Agrupa por data e calcula totais
  const byDate = {};
  mealsRaw.forEach(meal => {
    if (!byDate[meal.date]) byDate[meal.date] = { meals: 0, kcal: 0, prot: 0, carb: 0, fat: 0 };
    byDate[meal.date].meals++;
    (meal.meal_foods || []).forEach(f => {
      byDate[meal.date].kcal += calcMacro(f.kcal_per100, f.qty);
      byDate[meal.date].prot += calcMacro(f.prot_per100, f.qty);
      byDate[meal.date].carb += calcMacro(f.carb_per100, f.qty);
      byDate[meal.date].fat  += calcMacro(f.fat_per100,  f.qty);
    });
  });

  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  container.innerHTML = dates.map(date => {
    const d = byDate[date];
    const kcal = Math.round(d.kcal);
    const longDate = formatDateLong(date);
    const label = longDate.charAt(0).toUpperCase() + longDate.slice(1);
    const pctKcal = goals.kcal > 0 ? Math.round((kcal / goals.kcal) * 100) : 0;
    return `<div class="history-day-item" data-date="${escapeHTML(date)}">
      <div class="history-day-left">
        <span class="history-day-date">${escapeHTML(label)}</span>
        <span class="history-day-meals">${d.meals} refeição(ões)</span>
      </div>
      <div class="history-day-right">
        <span class="history-day-kcal">${kcal} kcal</span>
        <span class="history-day-macros">P${Math.round(d.prot)}g C${Math.round(d.carb)}g G${Math.round(d.fat)}g · ${pctKcal}% da meta</span>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.history-day-item').forEach(item => {
    item.addEventListener('click', async () => {
      currentDate = item.dataset.date;
      await loadDiaryData();
      render();
      switchView('hoje');
    });
  });
}

/* =====================================================================
   GRÁFICOS (Chart.js)
===================================================================== */
function destroyCharts() {
  if (chartWeekly) { chartWeekly.destroy(); chartWeekly = null; }
  if (chartMacros) { chartMacros.destroy(); chartMacros = null; }
  if (chartWeight) { chartWeight.destroy(); chartWeight = null; }
}

async function loadChartsView() {
  destroyCharts();

  // Últimos 7 dias
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });

  const { data: mealsRaw } = await sb
    .from('meals')
    .select('date, meal_foods(kcal_per100, qty, prot_per100, carb_per100, fat_per100)')
    .eq('user_id', currentUser.id)
    .in('date', last7);

  // Totais por dia
  const byDate = {};
  last7.forEach(d => { byDate[d] = { kcal: 0, prot: 0, carb: 0, fat: 0 }; });
  (mealsRaw || []).forEach(meal => {
    (meal.meal_foods || []).forEach(f => {
      if (!byDate[meal.date]) return;
      byDate[meal.date].kcal += calcMacro(f.kcal_per100, f.qty);
      byDate[meal.date].prot += calcMacro(f.prot_per100, f.qty);
      byDate[meal.date].carb += calcMacro(f.carb_per100, f.qty);
      byDate[meal.date].fat  += calcMacro(f.fat_per100,  f.qty);
    });
  });

  const labels = last7.map(d => strToDate(d).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }));
  const kcalData = last7.map(d => Math.round(byDate[d].kcal));
  const isDark   = (document.documentElement.dataset.theme || 'dark') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  const textColor = isDark ? '#8b90a0' : '#6b7280';

  // Gráfico semanal de calorias
  const ctxWeekly = document.getElementById('chart-weekly').getContext('2d');
  chartWeekly = new Chart(ctxWeekly, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Calorias',
        data: kcalData,
        backgroundColor: kcalData.map(v =>
          v >= goals.kcal * 0.9 && v <= goals.kcal * 1.1 ? '#4ade80' : '#f472b6'
        ),
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.raw} kcal` } }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor } },
        y: {
          grid: { color: gridColor }, ticks: { color: textColor },
          suggestedMax: Math.max(goals.kcal * 1.2, ...kcalData) || goals.kcal,
        }
      }
    }
  });

  // Linha de meta
  chartWeekly.options.plugins.annotation = {};

  // Donut de macros de hoje
  const today  = byDate[getTodayStr()];
  const ctxMacros = document.getElementById('chart-macros').getContext('2d');
  const totalG = today.prot + today.carb + today.fat;

  chartMacros = new Chart(ctxMacros, {
    type: 'doughnut',
    data: {
      labels: ['Proteína', 'Carboidrato', 'Gordura'],
      datasets: [{
        data: totalG > 0
          ? [Math.round(today.prot), Math.round(today.carb), Math.round(today.fat)]
          : [1, 1, 1],
        backgroundColor: ['#818cf8', '#fb923c', '#facc15'],
        borderWidth: 0,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw}g` } }
      }
    }
  });

  // Dados de peso (se tabela existir)
  await loadWeightChart(last7, gridColor, textColor);
}

async function loadWeightChart(_last7, gridColor, textColor) {
  try {
    // Carrega TODO o histórico de peso (até 365 registros), ordenado cronologicamente.
    // O usuário pode ter vários registros no mesmo dia (histórico real).
    const { data, error } = await sb
      .from('weight_logs').select('date, weight_kg, created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true })
      .limit(365);

    if (error) {
      const sec = document.getElementById('weight-chart-section');
      sec.textContent = '';
      const p = document.createElement('p');
      p.style.cssText = 'font-size:13px;color:var(--text-muted);text-align:center;padding:16px 0;';
      p.textContent = 'Tabela de peso indisponível. Execute supabase/migrations/002-weight-history.sql no painel do Supabase.';
      sec.appendChild(p);
      return;
    }

    const entries = data || [];
    if (entries.length === 0) {
      // Sem registros — mostra mensagem amigável dentro do canvas wrapper
      const ctx = document.getElementById('chart-weight').getContext('2d');
      chartWeight = new Chart(ctx, {
        type: 'line',
        data: { labels: ['—'], datasets: [{ label: 'Peso (kg)', data: [null] }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
            title: { display: true, text: 'Nenhum peso registrado ainda', color: textColor, font: { size: 13, weight: 'normal' } }
          },
          scales: {
            x: { grid: { color: gridColor }, ticks: { color: textColor } },
            y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => v + ' kg' } }
          }
        }
      });
      return;
    }

    // Cada ponto = um registro do histórico. Label é a data (curta) — se houver
    // vários no mesmo dia, mostra a hora também.
    const labels = entries.map((w, i) => {
      const sameDayCount = entries.filter(x => x.date === w.date).length;
      const dt = w.created_at ? new Date(w.created_at) : strToDate(w.date);
      if (sameDayCount > 1) {
        return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      }
      return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    });
    const weightData = entries.map(w => Number(w.weight_kg));

    const ctx = document.getElementById('chart-weight').getContext('2d');
    chartWeight = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Peso (kg)',
          data: weightData,
          borderColor: '#818cf8',
          backgroundColor: 'rgba(129,140,248,0.1)',
          tension: 0.3,
          spanGaps: true,
          pointBackgroundColor: '#818cf8',
          pointRadius: entries.length > 50 ? 2 : 4,
          fill: true,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.raw} kg` } }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => v + ' kg' } }
        }
      }
    });
  } catch (_) { /* tabela não existe ainda */ }
}

/* =====================================================================
   PERFIL
===================================================================== */
async function loadProfileView() {
  // Avatar e email
  const email   = currentUser?.email || '';
  const initial = email.charAt(0).toUpperCase();
  document.getElementById('profile-avatar').textContent = initial;
  document.getElementById('profile-email').textContent  = email;

  const createdAt = currentUser?.created_at;
  if (createdAt) {
    const since = new Date(createdAt).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    document.getElementById('profile-since').textContent = `Membro desde ${since}`;
  }

  // Stats
  const { data: mealDays } = await sb
    .from('meals').select('date').eq('user_id', currentUser.id);
  const uniqueDays = new Set((mealDays || []).map(m => m.date)).size;
  document.getElementById('stat-days').textContent  = uniqueDays;
  document.getElementById('stat-foods').textContent = loadLibrary().length;

  // Sequência atual (streak)
  const allDates = [...new Set((mealDays || []).map(m => m.date))].sort((a, b) => b.localeCompare(a));
  let streak = 0;
  const today = getTodayStr();
  for (let i = 0; i < allDates.length; i++) {
    const expected = offsetDate(today, -i);
    if (allDates[i] === expected) streak++;
    else break;
  }
  document.getElementById('stat-streak').textContent = streak;

  // Goals summary
  document.getElementById('profile-goal-kcal').textContent = goals.kcal + ' kcal';
  document.getElementById('profile-goal-prot').textContent = goals.prot + 'g';
  document.getElementById('profile-goal-carb').textContent = goals.carb + 'g';
  document.getElementById('profile-goal-fat').textContent  = goals.fat  + 'g';

  renderThemeToggle();
  await loadWeightProfile();
}

/* --- PESO CORPORAL no perfil — histórico completo --- */
async function loadWeightProfile() {
  try {
    // Ordena por created_at DESC (mais recentes primeiro). Usamos created_at
    // em vez de date porque pode haver vários registros no mesmo dia.
    const { data, error } = await sb
      .from('weight_logs').select('id, date, weight_kg, created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      const body = document.getElementById('weight-section-body');
      body.textContent = '';
      const p = document.createElement('p');
      p.style.cssText = 'font-size:13px;color:var(--text-muted);';
      p.textContent = 'Registro de peso indisponível. Execute supabase/migrations/002-weight-history.sql no painel do Supabase.';
      body.appendChild(p);
      return;
    }

    renderWeightList(data || []);
  } catch (_) { }
}

function renderWeightList(entries) {
  const el = document.getElementById('weight-list');
  if (entries.length === 0) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0;">Nenhum registro ainda.</div>';
    return;
  }
  el.innerHTML = entries.map(w => {
    const dt = w.created_at ? new Date(w.created_at) : strToDate(w.date);
    const dateStr = dt.toLocaleDateString('pt-BR');
    const timeStr = w.created_at
      ? dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '';
    return `
    <div class="weight-entry">
      <span class="weight-entry-date">
        ${escapeHTML(dateStr)}
        ${timeStr ? `<span class="weight-entry-time">${escapeHTML(timeStr)}</span>` : ''}
      </span>
      <span class="weight-entry-value">${w.weight_kg} kg</span>
      <button class="weight-entry-delete" data-id="${escapeHTML(w.id)}" title="Remover">✕</button>
    </div>`;
  }).join('');

  el.querySelectorAll('.weight-entry-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      showConfirm('Remover este registro de peso?', 'Remover peso', async () => {
        await sb.from('weight_logs').delete().eq('id', btn.dataset.id);
        await loadWeightProfile();
        // Atualiza o gráfico se a view de gráficos já estiver montada
        if (currentView === 'graficos') await loadChartsView();
      }, true);
    });
  });
}

let isSavingWeight = false; // evita duplo save

async function saveWeight() {
  if (isSavingWeight) return;
  const input = document.getElementById('weight-input');
  const btn   = document.getElementById('btn-save-weight');
  const val   = parseFloat(input.value);
  if (!val || val <= 0 || val > 500) { showToast('Peso inválido (1–500 kg)'); return; }

  const weight_kg = Math.round(val * 10) / 10;
  const date      = getTodayStr();

  isSavingWeight = true;
  btn.disabled = true;

  // INSERT (não upsert) — cada save vira um novo registro do histórico
  const { error } = await sb.from('weight_logs').insert({
    user_id: currentUser.id, date, weight_kg
  });

  isSavingWeight = false;
  btn.disabled = false;

  if (error) { logError('saveWeight', error); return; }
  input.value = '';
  showToast(`Peso ${weight_kg} kg registrado`);
  await loadWeightProfile();
  // Mantém o gráfico em sincronia se o usuário voltar para a view de gráficos
  if (currentView === 'graficos') await loadChartsView();
}

/* =====================================================================
   EXPORTAR CSV
   Sanitiza contra formula injection (células que começam com = + - @ |)
===================================================================== */
async function exportCSV() {
  showToast('Gerando CSV...');
  const { data: mealsRaw } = await sb
    .from('meals')
    .select('date, name, time, meal_foods(name, qty, kcal_per100, prot_per100, carb_per100, fat_per100)')
    .eq('user_id', currentUser.id)
    .order('date', { ascending: false });

  if (!mealsRaw || mealsRaw.length === 0) { showToast('Nenhum dado para exportar'); return; }

  // Sanitiza célula CSV contra formula injection
  const cell = v => {
    const s = String(v === null || v === undefined ? '' : v);
    const dangerous = /^[=+\-@|]/.test(s);
    const escaped = s.replace(/"/g, '""');
    return `"${dangerous ? "'" + escaped : escaped}"`;
  };

  const rows = ['Data,Refeição,Horário,Alimento,Qtd(g),Kcal,Prot(g),Carb(g),Gord(g)'];
  mealsRaw.forEach(meal => {
    (meal.meal_foods || []).forEach(f => {
      rows.push([
        cell(meal.date), cell(meal.name), cell(meal.time),
        cell(f.name), cell(f.qty),
        cell(Math.round(calcMacro(f.kcal_per100, f.qty))),
        cell(calcMacro(f.prot_per100, f.qty)),
        cell(calcMacro(f.carb_per100, f.qty)),
        cell(calcMacro(f.fat_per100,  f.qty)),
      ].join(','));
    });
  });

  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `smartdiet-${getTodayStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV exportado!');
}

/* =====================================================================
   TOAST
===================================================================== */
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

/* =====================================================================
   EVENT LISTENERS
===================================================================== */

// Navegação de datas
async function navigateDate(delta) {
  if (isLoadingDate) return;
  const newDate = offsetDate(currentDate, delta);
  if (delta > 0 && newDate > getTodayStr()) return;
  isLoadingDate = true;
  const list = document.getElementById('meals-list');
  list.classList.add('loading');
  document.getElementById('btn-prev-day').disabled = true;
  document.getElementById('btn-next-day').disabled = true;
  currentDate = newDate;
  await loadDiaryData();
  render();
  list.classList.remove('loading');
  isLoadingDate = false;
}
document.getElementById('btn-prev-day').addEventListener('click', () => navigateDate(-1));
document.getElementById('btn-next-day').addEventListener('click', () => navigateDate(+1));

// Navegação por tabs
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// Botão de tema no header
document.getElementById('btn-theme-header').addEventListener('click', toggleTheme);

// Modal de refeição
document.getElementById('btn-open-meal-modal').addEventListener('click', openMealModal);
document.getElementById('btn-cancel-meal').addEventListener('click', closeMealModal);
document.getElementById('meal-type-grid').addEventListener('click', e => {
  const option = e.target.closest('.meal-type-option');
  if (!option) return;
  document.querySelectorAll('#meal-type-grid .meal-type-option').forEach(o => o.classList.remove('selected'));
  option.classList.add('selected');
  selectedMealType  = option.dataset.type;
  selectedMealEmoji = option.dataset.emoji;
});
document.getElementById('btn-confirm-meal').addEventListener('click', () => {
  const time = document.getElementById('meal-time-input').value;
  addMeal(selectedMealType, selectedMealEmoji, time);
  closeMealModal();
});

// Modal editar refeição
document.getElementById('btn-cancel-edit-meal').addEventListener('click', closeEditMealModal);
document.getElementById('btn-confirm-edit-meal').addEventListener('click', saveEditMeal);
document.getElementById('edit-meal-type-grid').addEventListener('click', e => {
  const option = e.target.closest('.meal-type-option');
  if (!option) return;
  document.querySelectorAll('#edit-meal-type-grid .meal-type-option').forEach(o => o.classList.remove('selected'));
  option.classList.add('selected');
  editMealType  = option.dataset.type;
  editMealEmoji = option.dataset.emoji;
});

// Modal duplicar — handler do list registrado UMA vez (evita memory leak)
document.getElementById('btn-duplicate-day').addEventListener('click', openDuplicateModal);
document.getElementById('btn-cancel-duplicate').addEventListener('click', closeDuplicateModal);
document.getElementById('duplicate-day-list').addEventListener('click', handleDuplicateListClick);

// Modal objetivos
document.getElementById('btn-open-goals').addEventListener('click', openGoalsModal);
document.getElementById('btn-cancel-goals').addEventListener('click', closeGoalsModal);
document.getElementById('btn-confirm-goals').addEventListener('click', async () => {
  goals.kcal = parseFloat(document.getElementById('goal-kcal-input').value) || 0;
  goals.prot = parseFloat(document.getElementById('goal-prot-input').value) || 0;
  goals.carb = parseFloat(document.getElementById('goal-carb-input').value) || 0;
  goals.fat  = parseFloat(document.getElementById('goal-fat-input').value)  || 0;
  await saveGoals();
  render();
  closeGoalsModal();
  showToast('Objetivos atualizados');
});

// Modal alimento
document.getElementById('btn-cancel-food').addEventListener('click', closeFoodModal);
document.getElementById('btn-clear-selection').addEventListener('click', () => {
  selectedLibraryFood = null;
  setLibrarySelectionMode(false);
  ['food-kcal-input','food-prot-input','food-carb-input','food-fat-input']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('food-search-input').focus();
});
document.getElementById('food-search-input').addEventListener('input', e => {
  const query = e.target.value.trim();
  if (query.length >= 1) renderSuggestions(query);
  else document.getElementById('food-suggestions').classList.remove('visible');
});
document.getElementById('btn-confirm-food').addEventListener('click', () => {
  const qty = parseFloat(document.getElementById('food-qty-input').value) || 0;
  if (qty <= 0) { showToast('Digite a quantidade em gramas'); document.getElementById('food-qty-input').focus(); return; }
  const MAX_QTY = 10000, MAX_KCAL = 900, MAX_MACRO = 100, MAX_NAME = 100;
  if (qty > MAX_QTY) { showToast(`Quantidade máxima: ${MAX_QTY}g`); return; }
  const clamp = (v, max) => Math.max(0, Math.min(v, max));
  let foodData;
  if (selectedLibraryFood) {
    foodData = {
      name: selectedLibraryFood.name.slice(0, MAX_NAME), qty: clamp(qty, MAX_QTY),
      kcalPer100: clamp(selectedLibraryFood.kcalPer100, MAX_KCAL),
      protPer100: clamp(selectedLibraryFood.protPer100, MAX_MACRO),
      carbPer100: clamp(selectedLibraryFood.carbPer100, MAX_MACRO),
      fatPer100:  clamp(selectedLibraryFood.fatPer100,  MAX_MACRO),
    };
  } else {
    const name = document.getElementById('food-name-input').value.trim();
    if (!name) { showToast('Digite o nome do alimento'); document.getElementById('food-name-input').focus(); return; }
    if (name.length > MAX_NAME) { showToast(`Nome muito longo (máx ${MAX_NAME} caracteres)`); return; }
    foodData = {
      name: name.slice(0, MAX_NAME), qty: clamp(qty, MAX_QTY),
      kcalPer100: clamp(parseFloat(document.getElementById('food-kcal-input').value) || 0, MAX_KCAL),
      protPer100: clamp(parseFloat(document.getElementById('food-prot-input').value) || 0, MAX_MACRO),
      carbPer100: clamp(parseFloat(document.getElementById('food-carb-input').value) || 0, MAX_MACRO),
      fatPer100:  clamp(parseFloat(document.getElementById('food-fat-input').value)  || 0, MAX_MACRO),
    };
  }
  addFood(activeMealId, foodData);
  closeFoodModal();
});

// Modal editar quantidade
document.getElementById('btn-cancel-edit-qty').addEventListener('click', closeEditQtyModal);
document.getElementById('edit-qty-input').addEventListener('input', updateEditQtyPreview);
document.getElementById('edit-qty-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-confirm-edit-qty').click();
});
document.getElementById('btn-confirm-edit-qty').addEventListener('click', () => {
  const newQty = parseFloat(document.getElementById('edit-qty-input').value) || 0;
  if (newQty <= 0) { showToast('Digite uma quantidade válida'); return; }
  if (newQty > 10000) { showToast('Quantidade máxima: 10.000g'); return; }
  updateFoodQty(editingMealId, editingFoodId, newQty);
  closeEditQtyModal();
});

// Modal confirmação customizado
document.getElementById('btn-confirm-yes').addEventListener('click', () => {
  if (_confirmCallback) _confirmCallback();
  closeConfirmModal();
});
document.getElementById('btn-confirm-no').addEventListener('click', closeConfirmModal);

// Fechar modais clicando fora
// (modal-reset-password fica de fora — não pode ser fechado: usuário precisa
// definir uma nova senha, senão fica numa sessão temporária inutilizável)
['modal-meal','modal-food','modal-edit-qty','modal-goals','modal-duplicate','modal-edit-meal','modal-confirm','modal-forgot'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target.id === id) {
      closeMealModal(); closeFoodModal(); closeEditQtyModal();
      closeGoalsModal(); closeDuplicateModal(); closeEditMealModal(); closeConfirmModal();
      closeForgotModal();
    }
  });
});

// Escape fecha todos os modais (exceto reset-password — ver acima)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeMealModal(); closeFoodModal(); closeEditQtyModal();
    closeGoalsModal(); closeDuplicateModal(); closeEditMealModal(); closeConfirmModal();
    closeForgotModal();
  }
});

// Perfil: peso, export, logout, tema
document.getElementById('btn-save-weight').addEventListener('click', saveWeight);
document.getElementById('weight-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveWeight();
});
document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
document.getElementById('btn-open-goals-profile').addEventListener('click', openGoalsModal);
document.getElementById('btn-logout-profile').addEventListener('click', async () => {
  showConfirm('Sair da sua conta?', 'Sair', async () => { await sb.auth.signOut(); }, false);
});
document.getElementById('theme-switch').addEventListener('click', () => {
  toggleTheme();
  renderThemeToggle();
});

/* =====================================================================
   SERVICE WORKER (PWA)
===================================================================== */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
