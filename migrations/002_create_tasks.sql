CREATE TABLE tasks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  estimated_complexity SMALLINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  deadline TIMESTAMPTZ NOT NULL,
  assigned_to BIGINT REFERENCES users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tasks_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT tasks_complexity_range CHECK (estimated_complexity BETWEEN 1 AND 5),
  CONSTRAINT tasks_status_check CHECK (status IN ('draft', 'open', 'bidding_closed', 'assigned', 'in_progress', 'review', 'done'))
);

CREATE INDEX tasks_created_by_idx ON tasks (created_by);
CREATE INDEX tasks_status_idx ON tasks (status);

CREATE FUNCTION prevent_invalid_task_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status = 'open') OR
    (OLD.status = 'open' AND NEW.status = 'bidding_closed') OR
    (OLD.status = 'bidding_closed' AND NEW.status = 'assigned') OR
    (OLD.status = 'assigned' AND NEW.status = 'in_progress') OR
    (OLD.status = 'in_progress' AND NEW.status = 'review') OR
    (OLD.status = 'review' AND NEW.status = 'done')
  ) THEN
    RAISE EXCEPTION 'invalid task status transition from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_status_transition
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION prevent_invalid_task_status_change();
