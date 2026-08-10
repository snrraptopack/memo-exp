export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: string;
  createdAt: string;
  isOptimistic?: boolean;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  priority: TaskPriority;
  category: string;
}

export interface UpdateTaskInput {
  id: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  title?: string;
}

export interface DeleteTaskInput {
  id: string;
}

export interface ServerConfig {
  latencyMs: number;
  shouldFail: boolean;
  failProbability: number;
}
