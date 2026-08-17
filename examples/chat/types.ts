export type UserStatus = 'online' | 'busy' | 'away' | 'offline';

export interface User {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly avatar: string;
  readonly role: string;
  readonly status: UserStatus;
}

export interface Channel {
  readonly id: string;
  readonly name: string;
  readonly topic: string;
  readonly isPrivate: boolean;
  readonly memberCount: number;
  readonly unreadCount: number;
}

export interface Reaction {
  readonly emoji: string;
  readonly count: number;
  readonly userIds: readonly string[];
}

export interface ThreadReply {
  readonly id: string;
  readonly parentId: string;
  readonly author: User;
  readonly content: string;
  readonly createdAt: string;
  readonly isOptimistic?: boolean;
}

export interface Message {
  readonly id: string;
  readonly channelId: string;
  readonly author: User;
  readonly content: string;
  readonly createdAt: string;
  readonly reactions: readonly Reaction[];
  readonly replyCount: number;
  readonly replies?: readonly ThreadReply[];
  readonly isOptimistic?: boolean;
}

export interface CreateMessageInput {
  readonly channelId: string;
  readonly content: string;
  readonly authorId: string;
}

export interface ReactMessageInput {
  readonly messageId: string;
  readonly emoji: string;
  readonly userId: string;
}

export interface ReplyThreadInput {
  readonly parentId: string;
  readonly content: string;
  readonly authorId: string;
}

export interface ServerConfig {
  latencyMs: number;
  shouldFail: boolean;
  simulateLiveTeammates: boolean;
}
