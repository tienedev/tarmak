export type Role = "owner" | "member" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  is_agent: boolean;
  created_at: string;
}

export interface BoardMember {
  user_id: string;
  board_id: string;
  role: Role;
  user_name: string;
  user_email: string;
}
