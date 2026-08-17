import type { Message } from '../types';

interface ThreadDrawerProps {
  message: Message | null;
  replyDraft: string;
  isSendingReply: boolean;
  onClose: () => void;
  onReplyDraftChange: (value: string) => void;
  onSendReply: () => void;
}

export function ThreadDrawer({
  message,
  replyDraft,
  isSendingReply,
  onClose,
  onReplyDraftChange,
  onSendReply,
}: ThreadDrawerProps) {
  if (!message) return <></>;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (replyDraft.trim() && !isSendingReply) {
        onSendReply();
      }
    }
  }

  const replies = message.replies ?? [];

  return (
    <aside class="thread-drawer">
      {/* Thread Header */}
      <div class="thread-header">
        <div class="thread-header-meta">
          <span class="thread-header-title">Thread</span>
          <span class="thread-channel-tag">#{message.channelId.replace('c-', '')}</span>
        </div>
        <button class="thread-close-btn" onClick={onClose} title="Close thread">
          ✕
        </button>
      </div>

      {/* Parent Message Card */}
      <div class="thread-parent-card">
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
            <span class="message-timestamp">{message.createdAt}</span>
          </div>
          <div class="message-text-content">
            <p>{message.content}</p>
          </div>
        </div>
      </div>

      <div class="thread-replies-divider">
        <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
      </div>

      {/* Thread Replies List */}
      <div class="thread-replies-list">
        {replies.map((reply) => (
          <div
            key={reply.id}
            class={
              reply.isOptimistic
                ? 'thread-reply-item optimistic-pending'
                : 'thread-reply-item'
            }
          >
            <img
              class="thread-reply-avatar"
              src={reply.author.avatar}
              alt={reply.author.name}
            />
            <div class="thread-reply-body">
              <div class="thread-reply-meta">
                <span class="thread-reply-author">{reply.author.name}</span>
                <span class="thread-reply-time">{reply.createdAt}</span>
                {reply.isOptimistic ? (
                  <span class="optimistic-badge">Sending...</span>
                ) : null}
              </div>
              <p class="thread-reply-content">{reply.content}</p>
            </div>
          </div>
        ))}

        {replies.length === 0 ? (
          <div class="thread-empty-state">
            <p>No replies yet. Be the first to start the thread!</p>
          </div>
        ) : null}
      </div>

      {/* Thread Composer */}
      <div class="thread-composer-box">
        <textarea
          class="thread-textarea"
          rows={2}
          placeholder="Reply in thread..."
          value={replyDraft}
          onInput={(e: Event) =>
            onReplyDraftChange((e.target as HTMLTextAreaElement).value)
          }
          onKeyDown={handleKeyDown}
        />
        <div class="thread-composer-footer">
          <button
            class="thread-send-btn"
            disabled={!replyDraft.trim() || isSendingReply}
            onClick={onSendReply}
          >
            Reply
          </button>
        </div>
      </div>
    </aside>
  );
}
