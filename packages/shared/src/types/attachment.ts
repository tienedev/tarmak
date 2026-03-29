export interface Attachment {
  id: string;
  task_id: string;
  board_id: string;
  uploaded_by: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  created_at: string;
}
