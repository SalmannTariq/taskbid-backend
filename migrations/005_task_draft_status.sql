ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('draft', 'open', 'assigned', 'completed', 'cancelled'));

ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'draft';

CREATE OR REPLACE FUNCTION prevent_invalid_task_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('open', 'cancelled')) OR
    (OLD.status = 'open' AND NEW.status IN ('assigned', 'cancelled')) OR
    (OLD.status = 'assigned' AND NEW.status IN ('completed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid task status transition from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;
