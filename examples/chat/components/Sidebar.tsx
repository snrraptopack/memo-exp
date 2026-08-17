import type { Channel } from '../types';
import { teammates, currentUser } from '../mock-server';

interface SidebarProps {
  channels: readonly Channel[] | undefined;
  activeChannelId: string;
  onSelectChannel: (channelId: string) => void;
  unreadTotal: number;
}

export function Sidebar({
  channels,
  activeChannelId,
  onSelectChannel,
  unreadTotal,
}: SidebarProps) {
  return (
    <aside class="sidebar">
      {/* Workspace Header */}
      <div class="sidebar-header">
        <div class="workspace-badge">
          <div class="workspace-icon">A</div>
          <div class="workspace-meta">
            <span class="workspace-name">Apex Engineering</span>
            <span class="workspace-plan">Production Workspace</span>
          </div>
        </div>
      </div>

      {/* Navigation Sections */}
      <div class="sidebar-scrollable">
        {/* Channels Section */}
        <div class="sidebar-group">
          <div class="sidebar-group-header">
            <span class="sidebar-group-title">Channels</span>
            {unreadTotal > 0 ? (
              <span class="unread-pill">{unreadTotal} new</span>
            ) : null}
          </div>

          <div class="channel-list">
            {channels?.map((channel) => (
              <button
                key={channel.id}
                class={
                  channel.id === activeChannelId
                    ? 'channel-btn active'
                    : 'channel-btn'
                }
                onClick={() => onSelectChannel(channel.id)}
              >
                <span class="channel-hash">
                  {channel.isPrivate ? '🔒' : '#'}
                </span>
                <span class="channel-name">{channel.name}</span>
                {channel.unreadCount > 0 && channel.id !== activeChannelId ? (
                  <span class="channel-unread-badge">
                    {channel.unreadCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* Direct Messages / Teammates */}
        <div class="sidebar-group">
          <div class="sidebar-group-header">
            <span class="sidebar-group-title">Team Presence</span>
            <span class="member-count-badge">{teammates.length}</span>
          </div>

          <div class="user-presence-list">
            {teammates.map((member) => (
              <div key={member.id} class="presence-item">
                <div class="presence-avatar-wrap">
                  <img
                    class="presence-avatar"
                    src={member.avatar}
                    alt={member.name}
                  />
                  <span class={`status-dot status-${member.status}`} />
                </div>
                <div class="presence-info">
                  <span class="presence-name">
                    {member.name}
                    {member.id === currentUser.id ? ' (you)' : ''}
                  </span>
                  <span class="presence-role">{member.role}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* User Footer Card */}
      <div class="sidebar-footer">
        <div class="user-card">
          <div class="presence-avatar-wrap">
            <img
              class="presence-avatar"
              src={currentUser.avatar}
              alt={currentUser.name}
            />
            <span class={`status-dot status-${currentUser.status}`} />
          </div>
          <div class="user-card-meta">
            <span class="user-card-name">{currentUser.name}</span>
            <span class="user-card-handle">@{currentUser.handle}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
