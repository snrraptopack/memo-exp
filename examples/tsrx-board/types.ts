export type Priority = 'low' | 'medium' | 'high';

export interface Task {
  id: number;
  title: string;
  category: string;
  priority: Priority;
  completed: boolean;
}

export interface ColumnData {
  id: string;
  title: string;
  tasks: Task[];
}
