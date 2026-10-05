export type TaskRow = {
  id: string;
  created_by: string;
  title: string;
  description: string;
  estimated_complexity: number;
  status: string;
  deadline: Date;
  created_at: Date;
};

export type TaskLockRow = {
  id: string;
  status: string;
};

export type StatusError = Error & { statusCode?: number };
