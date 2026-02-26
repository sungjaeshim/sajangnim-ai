-- Narrative Continuity: 대화 요약 컬럼 추가
-- Supabase SQL Editor에서 실행 필요

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS turn_count INTEGER DEFAULT 0;
