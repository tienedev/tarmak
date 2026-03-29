export type Row = string[];

export type Delta =
  | { type: "update"; id: string; field: string; value: string }
  | { type: "create"; row: Row }
  | { type: "delete"; id: string };
