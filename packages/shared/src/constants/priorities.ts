export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const PRIORITY_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};
