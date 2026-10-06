export type TaskPerson = {
  id: string | number;
  name: string;
  email: string;
};

export type TaskRow = {
  id: string;
  created_by: TaskPerson | string;
  assignee?: TaskPerson | null;
  title: string;
  description: string;
  estimated_complexity: number;
  status: string;
  deadline: Date;
  created_at: Date;
  bid_count?: string | number;
  lowest_bid?: string | number | null;
};

export type TaskLockRow = {
  id: string;
  status: string;
  created_by: string;
};

export type StatusError = Error & { statusCode?: number };
