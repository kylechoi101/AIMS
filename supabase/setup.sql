-- Edge function calls this RPC to prevent double-tap race conditions
CREATE OR REPLACE FUNCTION increment_chime_usage(p_user_id UUID, p_limit INT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO chime_usage (user_id, date, count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date) 
  DO UPDATE SET count = chime_usage.count + 1
  WHERE chime_usage.count < p_limit;

  -- If the WHERE clause failed, FOUND will be false
  RETURN FOUND;
END;
$$;
