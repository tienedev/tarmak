export interface Notification {
  id: string;
  user_id: string;
  board_id: string;
  task_id: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read: boolean;
}
