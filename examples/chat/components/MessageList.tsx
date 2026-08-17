import type { Message } from '../types';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  messages: readonly Message[] | undefined;
  isLoading: boolean;
  searchQuery: string;
  onReact: (message: Message, emoji: string) => void;
  onOpenThread: (message: Message) => void;
}

export function MessageList({
  messages,
  isLoading,
  searchQuery,
  onReact,
  onOpenThread,
}: MessageListProps) {
  let listElement: HTMLElement | undefined;

  return (
    <div class="message-list-container" ref={listElement}>
      {isLoading && (!messages || messages.length === 0) ? (
        <div class="list-loading-state">
          <span class="loading-spinner" />
          <p>Connecting to message stream...</p>
        </div>
      ) : null}

      {messages && messages.length > 0 ? (
        <div class="messages-flow">
          <div class="date-divider">
            <span class="date-divider-line" />
            <span class="date-divider-text">Today</span>
            <span class="date-divider-line" />
          </div>

          <div class="messages-stack">
            {messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                onReact={onReact}
                onOpenThread={onOpenThread}
              />
            ))}
          </div>
        </div>
      ) : null}

      {!isLoading && (!messages || messages.length === 0) ? (
        <div class="list-empty-state">
          <div class="empty-icon">💬</div>
          <h3>
            {searchQuery
              ? `No messages matching "${searchQuery}"`
              : 'No messages in this channel yet.'}
          </h3>
          <p>
            {searchQuery
              ? 'Try adjusting your search terms.'
              : 'Start the conversation by sending the first message below.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
