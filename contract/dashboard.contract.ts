export type AverageBidRow = { complexity: number; average_bid: string | number | null };
export type TopUserRow = { name: string; completed_tasks: string | number };
export type ZeroBidRow = { complexity: number; count: string | number };

export type DashboardRow = {
  tasks_by_status: Record<string, number> | null;
  average_bid_by_complexity: AverageBidRow[] | null;
  top_users: TopUserRow[] | null;
  tasks_with_zero_bids: ZeroBidRow[] | null;
};
