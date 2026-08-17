interface MessageInputProps {
  channelName: string;
  draft: string;
  isSending: boolean;
  notification: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}

export function MessageInput({
  channelName,
  draft,
  isSending,
  notification,
  onDraftChange,
  onSend,
}: MessageInputProps) {
  let textareaElement: HTMLTextAreaElement | undefined;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim() && !isSending) {
        onSend();
      }
    }
  }

  function insertFormatting(prefix: string, suffix = prefix) {
    if (!textareaElement) return;
    const start = textareaElement.selectionStart;
    const end = textareaElement.selectionEnd;
    const selected = draft.substring(start, end);
    const updated =
      draft.substring(0, start) +
      prefix +
      selected +
      suffix +
      draft.substring(end);
    onDraftChange(updated);
  }

  return (
    <div class="composer-container">
      {/* Activity / Optimistic Notification Bar */}
      {notification ? (
        <div class="composer-notification-bar">
          <span class="notification-text">{notification}</span>
        </div>
      ) : null}

      <div class="composer-box">
        {/* Formatting Toolbar */}
        <div class="composer-toolbar">
          <div class="toolbar-group">
            <button
              class="toolbar-tool-btn"
              onClick={() => insertFormatting('**')}
              title="Bold (**text**)"
            >
              <strong>B</strong>
            </button>
            <button
              class="toolbar-tool-btn"
              onClick={() => insertFormatting('*')}
              title="Italic (*text*)"
            >
              <em>I</em>
            </button>
            <button
              class="toolbar-tool-btn"
              onClick={() => insertFormatting('`')}
              title="Inline code (`code`)"
            >
              <code>&lt;/&gt;</code>
            </button>
            <button
              class="toolbar-tool-btn"
              onClick={() => insertFormatting('```\n', '\n```')}
              title="Code block"
            >
              <code>{'{ }'}</code>
            </button>
          </div>

          <div class="toolbar-group">
            <button
              class="toolbar-tool-btn"
              onClick={() => insertFormatting('@')}
              title="Mention teammate"
            >
              @
            </button>
            <button
              class="toolbar-tool-btn"
              onClick={() => insertFormatting('🚀')}
              title="Insert rocket"
            >
              🚀
            </button>
            <button
              class="toolbar-tool-btn"
              onClick={() => insertFormatting('✨')}
              title="Insert sparkles"
            >
              ✨
            </button>
          </div>
        </div>

        {/* Multiline Textarea */}
        <textarea
          ref={textareaElement}
          class="composer-textarea"
          rows={3}
          placeholder={`Message #${channelName}...`}
          value={draft}
          onInput={(e: Event) =>
            onDraftChange((e.target as HTMLTextAreaElement).value)
          }
          onKeyDown={handleKeyDown}
        />

        {/* Footer Row */}
        <div class="composer-footer">
          <span class="keyboard-hint">
            Press <kbd>Enter</kbd> to send, <kbd>Shift + Enter</kbd> for newline
          </span>

          <button
            class="composer-send-btn"
            disabled={!draft.trim() || isSending}
            onClick={onSend}
          >
            <span>Send Message</span>
            <span class="send-icon">↑</span>
          </button>
        </div>
      </div>
    </div>
  );
}
