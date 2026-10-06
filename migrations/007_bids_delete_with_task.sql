ALTER TABLE bids DROP CONSTRAINT bids_task_id_fkey;

ALTER TABLE bids
  ADD CONSTRAINT bids_task_id_fkey
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE;
