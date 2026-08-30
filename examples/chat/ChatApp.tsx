import { createDataRuntime } from '@memoized-dom/data';
import {
  currentUser,
  mockFetch,
  serverConfig,
  teammates,
} from './mock-server';
import type {
  Channel,
  CreateMessageInput,
  Message,
  ReactMessageInput,
  ReplyThreadInput,
} from './types';
import { Sidebar } from './components/Sidebar';
import { ChatHeader } from './components/ChatHeader';
import { MessageList } from './components/MessageList';
import { MessageInput } from './components/MessageInput';
import { ThreadDrawer } from './components/ThreadDrawer';

export function ChatApp() {
  const dataRuntime = createDataRuntime({
    fetch: mockFetch as typeof fetch,
  });

  const sendMessageAction = dataRuntime.$action<Message, CreateMessageInput>(
    '/api/messages',
    {
      method: 'POST',
      onSuccess(result, input) {
        messagesResource.mutate((items) => {
          const index = items?.findIndex(
            item => item.isOptimistic && item.content === input.content,
          ) ?? -1;
          if (items && index >= 0) items[index] = result;
        });
        actionNotification = '✓ Server verified: message committed in-place!';
        isSending = false;
      },
      onError(error, input) {
        messagesResource.mutate((items) => {
          const index = items?.findIndex(
            item => item.isOptimistic && item.content === input.content,
          ) ?? -1;
          if (items && index >= 0) items.splice(index, 1);
        });
        actionNotification = `❌ Network Error: Optimistic message rolled back! (${error.message})`;
        isSending = false;
      },
    },
  );

  const reactMessageAction = dataRuntime.$action<Message, ReactMessageInput>(
    '/api/messages/react',
    {
      method: 'POST',
      onSuccess(result) {
        messagesResource.mutate((items) => {
          const index = items?.findIndex(item => item.id === result.id) ?? -1;
          if (items && index >= 0) items[index] = result;
        });
        actionNotification = '✓ Reaction confirmed by server!';
      },
      onError() {
        actionNotification = '❌ Reaction failed!';
      },
    },
  );

  const replyThreadAction = dataRuntime.$action<Message, ReplyThreadInput>(
    '/api/messages/reply',
    {
      method: 'POST',
      onSuccess(result) {
        messagesResource.mutate((items) => {
          const index = items?.findIndex(item => item.id === result.id) ?? -1;
          if (items && index >= 0) items[index] = result;
        });
        activeThreadMessage = result;
        actionNotification = '✓ Thread reply committed!';
        isSendingReply = false;
      },
      onError() {
        actionNotification = '❌ Thread reply failed!';
        isSendingReply = false;
      },
    },
  );

  let activeChannelId = 'c-engineering';
  let searchQuery = '';
  let draftMessage = '';
  let replyDraft = '';
  let activeThreadMessage: Message | null = null;
  let actionNotification = '';
  let isSending = false;
  let isSendingReply = false;

  // Channels Resource
  const channelsResource = dataRuntime.$fetch<Channel[]>('/api/channels');

  // Messages Resource loader for the active channel & search query
  function loadMessages() {
    return dataRuntime.$fetch<Message[]>('/api/messages', {
      query: {
        channelId: activeChannelId,
        search: searchQuery,
      },
    });
  }

  let messagesResource = loadMessages();
  cleanup(dataRuntime.clear);

  function reloadMessages() {
    const previous = messagesResource;
    messagesResource = loadMessages();
    previous.abort();
  }

  function handleSelectChannel(channelId: string) {
    if (activeChannelId === channelId) return;
    activeChannelId = channelId;
    activeThreadMessage = null;
    draftMessage = '';
    actionNotification = '';
    reloadMessages();
    channelsResource.refresh().catch(() => {});
  }

  function handleSearchChange(query: string) {
    searchQuery = query;
    reloadMessages();
  }

  function handleSendMessage() {
    if (!draftMessage.trim() || isSending) return;

    const content = draftMessage.trim();
    draftMessage = '';
    isSending = true;

    const tempMessage: Message = {
      id: `temp-${Date.now()}`,
      channelId: activeChannelId,
      author: currentUser,
      content,
      createdAt: 'Just now',
      reactions: [],
      replyCount: 0,
      replies: [],
      isOptimistic: true,
    };

    const inputData: CreateMessageInput = {
      channelId: activeChannelId,
      content,
      authorId: currentUser.id,
    };

    actionNotification = '⚡ In-flight: message rendered optimistically to real DOM...';
    messagesResource.mutate(items => items?.push(tempMessage));
    const sending = sendMessageAction(inputData);
    void sending;
  }

  function handleReact(message: Message, emoji: string) {
    const currentReactions = [...message.reactions];
    const existingIndex = currentReactions.findIndex((r) => r.emoji === emoji);
    let nextReactions = [...currentReactions];

    if (existingIndex >= 0) {
      const existing = nextReactions[existingIndex]!;
      const hasReacted = existing.userIds.includes(currentUser.id);
      const nextUserIds = hasReacted
        ? existing.userIds.filter((id) => id !== currentUser.id)
        : [...existing.userIds, currentUser.id];

      if (nextUserIds.length === 0) {
        nextReactions.splice(existingIndex, 1);
      } else {
        nextReactions[existingIndex] = {
          emoji: existing.emoji,
          count: nextUserIds.length,
          userIds: nextUserIds,
        };
      }
    } else {
      nextReactions.push({
        emoji,
        count: 1,
        userIds: [currentUser.id],
      });
    }

    const optimisticMessage: Message = {
      ...message,
      reactions: nextReactions,
    };

    actionNotification = `⚡ Reacted with ${emoji} (optimistic UI update)...`;
    messagesResource.mutate(items => {
      const index = items?.indexOf(message) ?? -1;
      if (items && index >= 0) items[index] = optimisticMessage;
    });
    const reaction = reactMessageAction({
      messageId: message.id,
      emoji,
      userId: currentUser.id,
    });
    void reaction;
  }

  function handleSendReply() {
    if (!activeThreadMessage || !replyDraft.trim() || isSendingReply) return;

    const content = replyDraft.trim();
    replyDraft = '';
    isSendingReply = true;

    const tempReply = {
      id: `rep-temp-${Date.now()}`,
      parentId: activeThreadMessage.id,
      author: currentUser,
      content,
      createdAt: 'Just now',
      isOptimistic: true,
    };

    const currentReplies = activeThreadMessage.replies ?? [];
    const optimisticParent: Message = {
      ...activeThreadMessage,
      replyCount: currentReplies.length + 1,
      replies: [...currentReplies, tempReply],
    };

    // Update active thread view reference
    const parentRef = activeThreadMessage;
    activeThreadMessage = optimisticParent;

    actionNotification = '⚡ Submitting thread reply with optimistic drawer update...';
    messagesResource.mutate(items => {
      const index = items?.indexOf(parentRef) ?? -1;
      if (items && index >= 0) items[index] = optimisticParent;
    });
    const reply = replyThreadAction({
      parentId: parentRef.id,
      content,
      authorId: currentUser.id,
    });
    void reply;
  }

  function handleOpenThread(message: Message) {
    activeThreadMessage = message;
  }

  function handleCloseThread() {
    activeThreadMessage = null;
  }

  // Simulated Live Teammates background stream
  effect(() => {
    if (!serverConfig.simulateLiveTeammates) return;

    const interval = setInterval(() => {
      // Pick random teammate (other than current user)
      const otherTeammates = teammates.filter((u) => u.id !== currentUser.id);
      const randomTeammate =
        otherTeammates[Math.floor(Math.random() * otherTeammates.length)]!;
      const phrases = [
        'Checked the access table regex matchers—incremental caching keeps per-commit latency near zero.',
        'Working on the new design system components. Typography line-heights are locked in.',
        'Benchmarked the Vite 8 HMR adapter: module diffs swap component factories in 4ms without reloading.',
        'Great work on the latest release PR! Looks ready to merge.',
      ];
      const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)]!;

      const autoMessage: Message = {
        id: `sim-msg-${Date.now()}`,
        channelId: activeChannelId,
        author: randomTeammate,
        content: randomPhrase,
        createdAt: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        reactions: [{ emoji: '🚀', count: 1, userIds: [randomTeammate.id] }],
        replyCount: 0,
        replies: [],
      };

      // Append incoming message through active resource
      messagesResource.append(autoMessage);
    }, 14000);

    return () => clearInterval(interval);
  });

  const activeChannel = channelsResource.data?.find(
    (c) => c.id === activeChannelId,
  );
  const unreadTotal = (channelsResource.data ?? []).reduce(
    (acc, c) => acc + (c.id !== activeChannelId ? c.unreadCount : 0),
    0,
  );

  return (
    <div class="chat-app-root">
      {/* Sidebar Navigation */}
      <Sidebar
        channels={channelsResource.data}
        activeChannelId={activeChannelId}
        unreadTotal={unreadTotal}
        onSelectChannel={handleSelectChannel}
      />

      {/* Main Chat Content Area */}
      <main class="chat-main">
        <ChatHeader
          channel={activeChannel}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onRefresh={() => messagesResource.refresh()}
          onConfigChange={() => {}}
        />

        <div class="chat-content-split">
          <div class="chat-flow-column">
            <MessageList
              messages={messagesResource.data}
              isLoading={messagesResource.pending}
              searchQuery={searchQuery}
              onReact={handleReact}
              onOpenThread={handleOpenThread}
            />

            <MessageInput
              channelName={activeChannel?.name ?? 'channel'}
              draft={draftMessage}
              isSending={isSending}
              notification={actionNotification}
              onDraftChange={(val) => {
                draftMessage = val;
              }}
              onSend={handleSendMessage}
            />
          </div>

          {/* Slide-out Thread Drawer */}
          {activeThreadMessage ? (
            <ThreadDrawer
              message={activeThreadMessage}
              replyDraft={replyDraft}
              isSendingReply={isSendingReply}
              onClose={handleCloseThread}
              onReplyDraftChange={(val) => {
                replyDraft = val;
              }}
              onSendReply={handleSendReply}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
