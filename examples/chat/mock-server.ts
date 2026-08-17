/**
 * In-browser mock REST server for the Team Workspace Chat example.
 * Intercepts requests, validates inputs, applies network latency, and handles
 * optimistic transactions, reactions, and simulated live teammate activity.
 */
import type {
  Channel,
  CreateMessageInput,
  Message,
  ReactMessageInput,
  ReplyThreadInput,
  ServerConfig,
  ThreadReply,
  User,
} from './types';

export const serverConfig: ServerConfig = {
  latencyMs: 180,
  shouldFail: false,
  simulateLiveTeammates: true,
};

export const currentUser: User = {
  id: 'usr-1',
  name: 'Alex Mercer',
  handle: 'alex.m',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=128&auto=format&fit=crop&q=80',
  role: 'Lead Architect',
  status: 'online',
};

export const teammates: User[] = [
  currentUser,
  {
    id: 'usr-2',
    name: 'Elena Rostova',
    handle: 'elena.r',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=128&auto=format&fit=crop&q=80',
    role: 'Systems Engineer',
    status: 'online',
  },
  {
    id: 'usr-3',
    name: 'Marcus Vance',
    handle: 'marcus.v',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=128&auto=format&fit=crop&q=80',
    role: 'UI Designer',
    status: 'busy',
  },
  {
    id: 'usr-4',
    name: 'Sarah Chen',
    handle: 'sarah.c',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=128&auto=format&fit=crop&q=80',
    role: 'Product Lead',
    status: 'online',
  },
  {
    id: 'usr-5',
    name: 'David Kim',
    handle: 'david.k',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=128&auto=format&fit=crop&q=80',
    role: 'Security Engineer',
    status: 'away',
  },
];

const initialChannels: Channel[] = [
  {
    id: 'c-general',
    name: 'general',
    topic: 'Company-wide announcements and team banter',
    isPrivate: false,
    memberCount: 24,
    unreadCount: 0,
  },
  {
    id: 'c-engineering',
    name: 'engineering',
    topic: 'Compiler design, kernel optimizations, and runtime benchmarks',
    isPrivate: false,
    memberCount: 12,
    unreadCount: 2,
  },
  {
    id: 'c-product-design',
    name: 'product-design',
    topic: 'UI specs, design tokens, and interaction reviews',
    isPrivate: false,
    memberCount: 8,
    unreadCount: 0,
  },
  {
    id: 'c-releases',
    name: 'releases',
    topic: 'Automated deployment pipelines and release changelogs',
    isPrivate: true,
    memberCount: 16,
    unreadCount: 5,
  },
];

const initialMessages: Message[] = [
  {
    id: 'msg-101',
    channelId: 'c-engineering',
    author: teammates[1]!, // Elena
    content: 'Just analyzed the latest Chromium microbenchmarks. The LIS list reconciler completely eliminated DOM node churn during rapid row swaps! 🚀',
    createdAt: '10:14 AM',
    reactions: [
      { emoji: '🚀', count: 4, userIds: ['usr-1', 'usr-3', 'usr-4', 'usr-5'] },
      { emoji: '🔥', count: 2, userIds: ['usr-1', 'usr-2'] },
    ],
    replyCount: 2,
    replies: [
      {
        id: 'rep-1',
        parentId: 'msg-101',
        author: teammates[0]!, // Alex
        content: 'That matches our static analysis expectations. The patience sort keeps unchanged rows untouched.',
        createdAt: '10:16 AM',
      },
      {
        id: 'rep-2',
        parentId: 'msg-101',
        author: teammates[1]!, // Elena
        content: 'Exactly, 1000-row reorders take under 0.8ms now with pooled buffer arrays.',
        createdAt: '10:18 AM',
      },
    ],
  },
  {
    id: 'msg-102',
    channelId: 'c-engineering',
    author: teammates[3]!, // Sarah
    content: 'Are we ready to ship the `@memoized-dom/data` optimistic transaction support for the customer portal?',
    createdAt: '10:25 AM',
    reactions: [
      { emoji: '👀', count: 3, userIds: ['usr-1', 'usr-2', 'usr-3'] },
    ],
    replyCount: 0,
  },
  {
    id: 'msg-103',
    channelId: 'c-engineering',
    author: teammates[0]!, // Alex
    content: 'Yes! The `ReplacementChain` handles concurrent out-of-order rollbacks and in-place DOM commits seamlessly.',
    createdAt: '10:28 AM',
    reactions: [
      { emoji: '🙌', count: 3, userIds: ['usr-2', 'usr-3', 'usr-4'] },
    ],
    replyCount: 0,
  },
  {
    id: 'msg-201',
    channelId: 'c-general',
    author: teammates[3]!, // Sarah
    content: 'Welcome everyone! Please remember to review the Q3 product roadmap before our 2 PM all-hands.',
    createdAt: '09:00 AM',
    reactions: [
      { emoji: '👍', count: 6, userIds: ['usr-1', 'usr-2', 'usr-3', 'usr-4', 'usr-5'] },
    ],
    replyCount: 0,
  },
  {
    id: 'msg-301',
    channelId: 'c-product-design',
    author: teammates[2]!, // Marcus
    content: 'Finished the new dark theme tokens: deep slate neutrals (#090a0f, #181b24) with crisp micro-borders. Zero violet cyber slop.',
    createdAt: '09:45 AM',
    reactions: [
      { emoji: '✨', count: 5, userIds: ['usr-1', 'usr-2', 'usr-3', 'usr-4'] },
      { emoji: '💯', count: 3, userIds: ['usr-1', 'usr-4'] },
    ],
    replyCount: 0,
  },
];

let channelsDb = [...initialChannels];
let messagesDb = [...initialMessages];

export function resetDatabase(): void {
  channelsDb = [...initialChannels];
  messagesDb = [...initialMessages];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const mockFetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const urlString = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(urlString, 'http://localhost');
  const method = init?.method ?? 'GET';

  if (serverConfig.latencyMs > 0) {
    await sleep(serverConfig.latencyMs);
  }

  if (serverConfig.shouldFail && method !== 'GET') {
    return new Response(
      JSON.stringify({
        error: 'Simulated HTTP 500 Server Error: Action rejected by gateway.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // GET /api/channels
  if (url.pathname === '/api/channels' && method === 'GET') {
    return new Response(JSON.stringify(channelsDb), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/messages?channelId=...&search=...
  if (url.pathname === '/api/messages' && method === 'GET') {
    const channelId = url.searchParams.get('channelId') ?? 'c-general';
    const search = (url.searchParams.get('search') ?? '').toLowerCase();

    let filtered = messagesDb.filter(m => m.channelId === channelId);
    if (search.trim()) {
      filtered = filtered.filter(
        m =>
          m.content.toLowerCase().includes(search) ||
          m.author.name.toLowerCase().includes(search),
      );
    }

    return new Response(JSON.stringify(filtered), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/messages
  if (url.pathname === '/api/messages' && method === 'POST') {
    const payload = JSON.parse(String(init?.body ?? '{}')) as CreateMessageInput;
    const author = teammates.find(u => u.id === payload.authorId) ?? currentUser;

    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      channelId: payload.channelId,
      author,
      content: payload.content,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      reactions: [],
      replyCount: 0,
      replies: [],
    };

    messagesDb.push(newMessage);

    return new Response(JSON.stringify(newMessage), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/messages/react
  if (url.pathname === '/api/messages/react' && method === 'POST') {
    const payload = JSON.parse(String(init?.body ?? '{}')) as ReactMessageInput;
    const target = messagesDb.find(m => m.id === payload.messageId);

    if (!target) {
      return new Response(JSON.stringify({ error: 'Message not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const reactions = [...target.reactions];
    const existingIndex = reactions.findIndex(r => r.emoji === payload.emoji);

    if (existingIndex >= 0) {
      const existing = reactions[existingIndex]!;
      const hasReacted = existing.userIds.includes(payload.userId);
      const nextUserIds = hasReacted
        ? existing.userIds.filter(id => id !== payload.userId)
        : [...existing.userIds, payload.userId];

      if (nextUserIds.length === 0) {
        reactions.splice(existingIndex, 1);
      } else {
        reactions[existingIndex] = {
          emoji: existing.emoji,
          count: nextUserIds.length,
          userIds: nextUserIds,
        };
      }
    } else {
      reactions.push({
        emoji: payload.emoji,
        count: 1,
        userIds: [payload.userId],
      });
    }

    const updatedMessage: Message = {
      ...target,
      reactions,
    };

    messagesDb = messagesDb.map(m => (m.id === target.id ? updatedMessage : m));

    return new Response(JSON.stringify(updatedMessage), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/messages/reply
  if (url.pathname === '/api/messages/reply' && method === 'POST') {
    const payload = JSON.parse(String(init?.body ?? '{}')) as ReplyThreadInput;
    const parent = messagesDb.find(m => m.id === payload.parentId);

    if (!parent) {
      return new Response(JSON.stringify({ error: 'Parent message not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const author = teammates.find(u => u.id === payload.authorId) ?? currentUser;
    const reply: ThreadReply = {
      id: `rep-${Date.now()}`,
      parentId: payload.parentId,
      author,
      content: payload.content,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const currentReplies = parent.replies ?? [];
    const updatedMessage: Message = {
      ...parent,
      replyCount: currentReplies.length + 1,
      replies: [...currentReplies, reply],
    };

    messagesDb = messagesDb.map(m => (m.id === parent.id ? updatedMessage : m));

    return new Response(JSON.stringify(updatedMessage), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/channels/read
  if (url.pathname === '/api/channels/read' && method === 'POST') {
    const channelId = url.searchParams.get('channelId');
    channelsDb = channelsDb.map(c =>
      c.id === channelId ? { ...c, unreadCount: 0 } : c,
    );
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;
