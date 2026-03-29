export type FieldType = "text" | "number" | "url" | "enum" | "date";

export interface CustomField {
  id: string;
  board_id: string;
  name: string;
  field_type: FieldType;
  config: string | null;
  position: number;
}

export interface TaskCustomFieldValue {
  task_id: string;
  field_id: string;
  value: string;
}
