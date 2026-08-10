import type { StandardSchemaV1 } from '@memoized-dom/data';
import type { Task, TaskPriority } from './types';

// Initial dataset representing a production sprint board
const initialTasks: Task[] = [
  {
    id: 'task-101',
    title: 'Implement Fine-Grained Reactive Signal Store',
    description: 'Integrate compiler dirty-routing with fine-grained DOM slot update markers.',
    status: 'in_progress',
    priority: 'critical',
    category: 'Core Runtime',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
  {
    id: 'task-102',
    title: 'Optimize Query Identity Normalization in $fetch',
    description: 'Ensure identical query parameter keys share single active HTTP request entries.',
    status: 'done',
    priority: 'high',
    category: 'Data Layer',
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
  {
    id: 'task-103',
    title: 'Add Standard Schema Response Validation',
    description: 'Validate untrusted API JSON payloads before writing into resource snapshots.',
    status: 'todo',
    priority: 'medium',
    category: 'Validation',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: 'task-104',
    title: 'Build Optimistic Rollback Test Harness',
    description: 'Exercise automatic collection restoration on simulated 500 mutation failures.',
    status: 'in_progress',
    priority: 'high',
    category: 'Testing',
    createdAt: new Date(Date.now() - 3600000 * 1).toISOString(),
  },
  {
    id: 'task-105',
    title: 'Opaque Animation Frame Pull Profiling',
    description: 'Verify dirty-marked volatile components reevaluate only while mounted.',
    status: 'todo',
    priority: 'low',
    category: 'Compiler',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
];

let database: Task[] = [...initialTasks];

export const serverConfig = {
  latencyMs: 350,
  shouldFail: false,
  requestCount: 0,
};

export function resetDatabase() {
  database = [...initialTasks];
}

/** Standard Schema V1 validator for validating task arrays from server */
export const TaskListSchema: StandardSchemaV1<unknown, Task[]> = {
  '~standard': {
    version: 1,
    vendor: 'memoized-dom-example',
    validate(value: unknown) {
      if (!Array.isArray(value)) {
        return { issues: [{ message: 'Response payload must be an array of Tasks' }] };
      }
      for (const item of value) {
        if (typeof item !== 'object' || item === null || !('id' in item) || !('title' in item)) {
          return { issues: [{ message: 'Invalid task object structure in response payload' }] };
        }
      }
      return { value: value as Task[] };
    },
  },
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Custom fetch implementation intercepting /api/tasks calls
 */
export const mockFetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  serverConfig.requestCount++;
  const urlString = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(urlString, 'http://localhost');
  const method = (init?.method || 'GET').toUpperCase();

  await delay(serverConfig.latencyMs);

  if (serverConfig.shouldFail) {
    return jsonResponse(
      { error: 'Simulated Server Error (500 Internal Server Failure)', status: 500 },
      500,
    );
  }

  // GET /api/tasks (with query parameters)
  if (url.pathname === '/api/tasks' && method === 'GET') {
    const statusParam = url.searchParams.get('status');
    const searchParam = url.searchParams.get('search')?.toLowerCase() || '';

    let filtered = [...database];

    if (statusParam && statusParam !== 'all') {
      filtered = filtered.filter(t => t.status === statusParam);
    }

    if (searchParam) {
      filtered = filtered.filter(
        t =>
          t.title.toLowerCase().includes(searchParam) ||
          t.description.toLowerCase().includes(searchParam) ||
          t.category.toLowerCase().includes(searchParam),
      );
    }

    return jsonResponse(filtered);
  }

  // POST /api/tasks
  if (url.pathname === '/api/tasks' && method === 'POST') {
    const bodyText = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(bodyText);

    const newTask: Task = {
      id: `task-${Date.now()}`,
      title: body.title || 'Untitled Task',
      description: body.description || '',
      priority: (body.priority as TaskPriority) || 'medium',
      category: body.category || 'General',
      status: 'todo',
      createdAt: new Date().toISOString(),
    };

    database.unshift(newTask);
    return jsonResponse(newTask, 201);
  }

  // PATCH /api/tasks/update
  if (url.pathname === '/api/tasks/update' && method === 'PATCH') {
    const bodyText = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(bodyText);

    const index = database.findIndex(t => t.id === body.id);
    if (index === -1) {
      return jsonResponse({ error: 'Task not found' }, 404);
    }

    const updatedTask: Task = {
      ...database[index]!,
      ...body,
    };
    database[index] = updatedTask;

    return jsonResponse(updatedTask);
  }

  // DELETE /api/tasks/delete
  if (url.pathname === '/api/tasks/delete' && method === 'DELETE') {
    const bodyText = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(bodyText);

    const index = database.findIndex(t => t.id === body.id);
    if (index !== -1) {
      database.splice(index, 1);
    }

    return jsonResponse({ id: body.id, deleted: true });
  }

  return jsonResponse({ error: 'Endpoint Not Found' }, 404);
}) as typeof fetch;
