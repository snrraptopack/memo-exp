import type { Message } from '../types';
import { currentUser } from '../mock-server';

interface MessageItemProps {
  message: Message;
  onReact: (message: Message, emoji: string) => void;
  onOpenThread: (message: Message) => void;
}

const QUICK_EMOJIS = ['👍', '❤️', '🚀', '👀', '🔥', '💯'];

export function MessageItem({
  message,
  onReact,
  onOpenThread,
}: MessageItemProps) {
  return (
    <article
      class={
        message.isOptimistic
          ? 'message-item optimistic-pending'
          : 'message-item'
      }
    >
      <div class="message-avatar-col">
        <img
          class="message-avatar"
          src={message.author.avatar}
          alt={message.author.name}
        />
      </div>

      <div class="message-body-col">
        <div class="message-meta-row">
          <span class="message-author-name">{message.author.name}</span>
          <span class="message-author-role">{message.author.role}</span>
          <span class="message-timestamp">{message.createdAt}</span>

          {message.isOptimistic ? (
            <span class="optimistic-badge">
              <span class="optimistic-pulse" />
              Optimistic (in-flight...)
            </span>
          ) : null}
        </div>

        <div class="message-text-content">
          <p>{message.content}</p>
        </div>

        {/* Emoji Reactions List */}
        {message.reactions.length > 0 ? (
          <div class="reactions-row">
            {message.reactions.map((reaction) => {
              //const hasReacted = reaction.userIds.includes(currentUser.id);
              return (
                <button
                  key={reaction.emoji}
                  class={
                    reaction.userIds.includes(currentUser.id)
                      ? 'reaction-pill reaction-active'
                      : 'reaction-pill'
                  }
                  onClick={() => onReact(message, reaction.emoji)}
                  title={`Reacted by ${reaction.userIds.length} members`}
                >
                  <span class="reaction-emoji">{reaction.emoji}</span>
                  <span class="reaction-count">{reaction.count}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Thread Replies Button */}
        {message.replyCount > 0 ? (
          <button
            class="thread-summary-btn"
            onClick={() => onOpenThread(message)}
          >
            <span class="thread-icon">💬</span>
            <span class="thread-count-text">
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </span>
            <span class="thread-view-label">View thread →</span>
          </button>
        ) : null}
      </div>

      {/* Floating Action Bar on Hover */}
      <div class="message-hover-toolbar">
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            class="toolbar-emoji-btn"
            onClick={() => onReact(message, emoji)}
            title={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
        <button
          class="toolbar-thread-btn"
          onClick={() => onOpenThread(message)}
          title="Start or reply to thread"
        >
          💬 Reply
        </button>
      </div>
    </article>
  );
}
