-- ============================================================
-- SmartDiet — Script de MIGRAÇÃO (não apaga dados existentes)
-- Cole no SQL Editor do Supabase e clique Run
-- ============================================================

-- ============================================================
-- 1. Cria weight_logs (tabela nova — não existia antes)
-- ============================================================
CREATE TABLE IF NOT EXISTS weight_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  weight_kg   NUMERIC(5,2) NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS weight_logs_user_date_idx
  ON weight_logs (user_id, date DESC);

ALTER TABLE weight_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weight_logs_select" ON weight_logs;
DROP POLICY IF EXISTS "weight_logs_insert" ON weight_logs;
DROP POLICY IF EXISTS "weight_logs_update" ON weight_logs;
DROP POLICY IF EXISTS "weight_logs_delete" ON weight_logs;

CREATE POLICY "weight_logs_select" ON weight_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "weight_logs_insert" ON weight_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "weight_logs_update" ON weight_logs
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "weight_logs_delete" ON weight_logs
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 2. Índices que faltavam nas tabelas existentes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_meal_foods_user
  ON meal_foods (user_id);

CREATE INDEX IF NOT EXISTS food_library_usage_idx
  ON food_library (user_id, usage_count DESC);

-- ============================================================
-- 3. Corrige policies das tabelas existentes
--    Remove as antigas (pelo nome que foram criadas) e recria
--    com WITH CHECK no UPDATE — mais seguro
-- ============================================================

-- meals
DROP POLICY IF EXISTS "Users read own meals"   ON meals;
DROP POLICY IF EXISTS "Users insert own meals" ON meals;
DROP POLICY IF EXISTS "Users update own meals" ON meals;
DROP POLICY IF EXISTS "Users delete own meals" ON meals;

CREATE POLICY "meals_select" ON meals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "meals_insert" ON meals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "meals_update" ON meals
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "meals_delete" ON meals
  FOR DELETE USING (auth.uid() = user_id);

-- meal_foods
DROP POLICY IF EXISTS "Users read own foods"   ON meal_foods;
DROP POLICY IF EXISTS "Users insert own foods" ON meal_foods;
DROP POLICY IF EXISTS "Users update own foods" ON meal_foods;
DROP POLICY IF EXISTS "Users delete own foods" ON meal_foods;

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

-- food_library
DROP POLICY IF EXISTS "Users read own library"   ON food_library;
DROP POLICY IF EXISTS "Users insert own library" ON food_library;
DROP POLICY IF EXISTS "Users update own library" ON food_library;
DROP POLICY IF EXISTS "Users delete own library" ON food_library;

CREATE POLICY "food_library_select" ON food_library
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "food_library_insert" ON food_library
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "food_library_update" ON food_library
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "food_library_delete" ON food_library
  FOR DELETE USING (auth.uid() = user_id);

-- user_goals
DROP POLICY IF EXISTS "Users read own goals"   ON user_goals;
DROP POLICY IF EXISTS "Users insert own goals" ON user_goals;
DROP POLICY IF EXISTS "Users update own goals" ON user_goals;

CREATE POLICY "user_goals_select" ON user_goals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_goals_insert" ON user_goals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_goals_update" ON user_goals
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_goals_delete" ON user_goals
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 4. Verificação final — deve mostrar rls_ativo = true
--    para todas as 5 tabelas e listar as policies
-- ============================================================
SELECT tablename, rowsecurity AS rls_ativo
FROM pg_tables
WHERE tablename IN ('meals','meal_foods','food_library','user_goals','weight_logs')
ORDER BY tablename;

SELECT tablename, policyname, cmd AS operacao
FROM pg_policies
WHERE tablename IN ('meals','meal_foods','food_library','user_goals','weight_logs')
ORDER BY tablename, cmd;
