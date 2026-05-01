-- ============================================================
-- SmartDiet — Setup completo do banco de dados
-- Execute no SQL Editor do Supabase (em ordem)
-- É seguro rodar mais de uma vez (idempotente)
-- ============================================================

-- ============================================================
-- 1. TABELA: meals (refeições)
-- ============================================================
CREATE TABLE IF NOT EXISTS meals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  emoji       text NOT NULL DEFAULT '🍽️' CHECK (char_length(emoji) <= 10),
  time        text NOT NULL DEFAULT '--:--' CHECK (char_length(time) <= 10),
  date        date NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Índice para queries por usuário + data (padrão mais comum do app)
CREATE INDEX IF NOT EXISTS meals_user_date_idx ON meals (user_id, date);

-- ============================================================
-- 2. TABELA: meal_foods (alimentos dentro de refeições)
-- ============================================================
CREATE TABLE IF NOT EXISTS meal_foods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id      uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  qty          numeric(8,2) NOT NULL CHECK (qty > 0 AND qty <= 10000),
  kcal_per100  numeric(7,2) NOT NULL DEFAULT 0 CHECK (kcal_per100 >= 0 AND kcal_per100 <= 900),
  prot_per100  numeric(6,2) NOT NULL DEFAULT 0 CHECK (prot_per100 >= 0 AND prot_per100 <= 100),
  carb_per100  numeric(6,2) NOT NULL DEFAULT 0 CHECK (carb_per100 >= 0 AND carb_per100 <= 100),
  fat_per100   numeric(6,2) NOT NULL DEFAULT 0 CHECK (fat_per100 >= 0 AND fat_per100 <= 100),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Índice para join meals → meal_foods
CREATE INDEX IF NOT EXISTS meal_foods_meal_idx ON meal_foods (meal_id);
-- Índice para queries diretas por usuário
CREATE INDEX IF NOT EXISTS meal_foods_user_idx ON meal_foods (user_id);

-- ============================================================
-- 3. TABELA: food_library (biblioteca pessoal de alimentos)
-- ============================================================
CREATE TABLE IF NOT EXISTS food_library (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  kcal_per100  numeric(7,2) NOT NULL DEFAULT 0 CHECK (kcal_per100 >= 0 AND kcal_per100 <= 900),
  prot_per100  numeric(6,2) NOT NULL DEFAULT 0 CHECK (prot_per100 >= 0 AND prot_per100 <= 100),
  carb_per100  numeric(6,2) NOT NULL DEFAULT 0 CHECK (carb_per100 >= 0 AND carb_per100 <= 100),
  fat_per100   numeric(6,2) NOT NULL DEFAULT 0 CHECK (fat_per100 >= 0 AND fat_per100 <= 100),
  usage_count  integer NOT NULL DEFAULT 1 CHECK (usage_count >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Índice para busca por usuário (ordenado por uso)
CREATE INDEX IF NOT EXISTS food_library_user_idx ON food_library (user_id, usage_count DESC);

-- ============================================================
-- 4. TABELA: user_goals (metas de macros)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_goals (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  kcal     numeric(7,2) NOT NULL DEFAULT 2000 CHECK (kcal >= 0 AND kcal <= 20000),
  prot     numeric(6,2) NOT NULL DEFAULT 150  CHECK (prot >= 0 AND prot <= 1000),
  carb     numeric(6,2) NOT NULL DEFAULT 200  CHECK (carb >= 0 AND carb <= 1000),
  fat      numeric(6,2) NOT NULL DEFAULT 65   CHECK (fat >= 0 AND fat <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. TABELA: weight_logs (registro de peso corporal)
-- ============================================================
CREATE TABLE IF NOT EXISTS weight_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date        date NOT NULL,
  weight_kg   numeric(5,2) NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Um registro de peso por usuário por dia
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS weight_logs_user_date_idx ON weight_logs (user_id, date DESC);

-- ============================================================
-- 6. RLS — Row Level Security
-- Cada usuário só enxerga e modifica os próprios dados.
-- Sem RLS, qualquer usuário autenticado veria dados de todos.
-- ============================================================
ALTER TABLE meals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_foods  ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_goals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. POLICIES — meals
-- DROP IF EXISTS para poder rodar o script de novo sem erro
-- ============================================================
DROP POLICY IF EXISTS "meals_select"  ON meals;
DROP POLICY IF EXISTS "meals_insert"  ON meals;
DROP POLICY IF EXISTS "meals_update"  ON meals;
DROP POLICY IF EXISTS "meals_delete"  ON meals;

CREATE POLICY "meals_select" ON meals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "meals_insert" ON meals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "meals_update" ON meals
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "meals_delete" ON meals
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 8. POLICIES — meal_foods
-- Dupla verificação: user_id direto E via meal (defesa em profundidade)
-- ============================================================
DROP POLICY IF EXISTS "meal_foods_select"  ON meal_foods;
DROP POLICY IF EXISTS "meal_foods_insert"  ON meal_foods;
DROP POLICY IF EXISTS "meal_foods_update"  ON meal_foods;
DROP POLICY IF EXISTS "meal_foods_delete"  ON meal_foods;

CREATE POLICY "meal_foods_select" ON meal_foods
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "meal_foods_insert" ON meal_foods
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (SELECT 1 FROM meals WHERE id = meal_id AND user_id = auth.uid())
  );

CREATE POLICY "meal_foods_update" ON meal_foods
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "meal_foods_delete" ON meal_foods
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 9. POLICIES — food_library
-- ============================================================
DROP POLICY IF EXISTS "food_library_select"  ON food_library;
DROP POLICY IF EXISTS "food_library_insert"  ON food_library;
DROP POLICY IF EXISTS "food_library_update"  ON food_library;
DROP POLICY IF EXISTS "food_library_delete"  ON food_library;

CREATE POLICY "food_library_select" ON food_library
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "food_library_insert" ON food_library
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "food_library_update" ON food_library
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "food_library_delete" ON food_library
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 10. POLICIES — user_goals
-- ============================================================
DROP POLICY IF EXISTS "user_goals_select"  ON user_goals;
DROP POLICY IF EXISTS "user_goals_insert"  ON user_goals;
DROP POLICY IF EXISTS "user_goals_update"  ON user_goals;
DROP POLICY IF EXISTS "user_goals_delete"  ON user_goals;

CREATE POLICY "user_goals_select" ON user_goals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_goals_insert" ON user_goals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_goals_update" ON user_goals
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_goals_delete" ON user_goals
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 11. POLICIES — weight_logs
-- ============================================================
DROP POLICY IF EXISTS "weight_logs_select"  ON weight_logs;
DROP POLICY IF EXISTS "weight_logs_insert"  ON weight_logs;
DROP POLICY IF EXISTS "weight_logs_update"  ON weight_logs;
DROP POLICY IF EXISTS "weight_logs_delete"  ON weight_logs;

CREATE POLICY "weight_logs_select" ON weight_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "weight_logs_insert" ON weight_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "weight_logs_update" ON weight_logs
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "weight_logs_delete" ON weight_logs
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 12. VERIFICAÇÃO — confere se tudo foi criado corretamente
-- ============================================================
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_ativo
FROM pg_tables
WHERE tablename IN ('meals', 'meal_foods', 'food_library', 'user_goals', 'weight_logs')
ORDER BY tablename;

SELECT
  schemaname,
  tablename,
  policyname,
  cmd AS operacao
FROM pg_policies
WHERE tablename IN ('meals', 'meal_foods', 'food_library', 'user_goals', 'weight_logs')
ORDER BY tablename, cmd;
