/**
 * Reusable Stat Card Component
 * 
 * Demonstrates:
 * 1. Synchronous component factory with typed props
 * 2. Explicit ref forwarding through component props
 * 3. Dynamic styling based on status and value metrics
 */

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: string;
  accent?: 'emerald' | 'amber' | 'stone';
  ref?: unknown;
  cardRef?: unknown;
}

export function StatCard({
  title,
  value,
  subtitle,
  change,
  trend = 'neutral',
  icon = '📊',
  accent = 'emerald',
  ref: forwardedRef,
  cardRef,
}: StatCardProps) {
  // Pure derived border and accent colors
  const accentBorder = 
    accent === 'amber'
      ? 'border-amber-700/40 hover:border-amber-500/60'
      : accent === 'emerald'
      ? 'border-emerald-800/40 hover:border-emerald-500/60'
      : 'border-stone-800 hover:border-stone-700';

  const trendColor =
    trend === 'up'
      ? 'text-emerald-400 bg-emerald-950/80 border-emerald-800/60'
      : trend === 'down'
      ? 'text-rose-400 bg-rose-950/80 border-rose-800/60'
      : 'text-stone-400 bg-stone-900 border-stone-800';

  return (
    <div
      ref={[forwardedRef, cardRef]}
      className={`p-5 rounded-2xl bg-stone-900/90 border ${accentBorder} shadow-lg shadow-black/20 transition-all group`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-400 font-mono">
          {title}
        </span>
        <div className="w-8 h-8 rounded-lg bg-stone-800/80 flex items-center justify-center text-sm border border-stone-700/50 group-hover:scale-110 transition-transform">
          {icon}
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl sm:text-3xl font-extrabold text-stone-100 font-mono tracking-tight">
          {value}
        </span>
        
        {/* Sibling conditional or inline badge */}
        <span if={!!change} className={`text-xs font-mono px-2 py-0.5 rounded-full border ${trendColor}`}>
          {change}
        </span>
      </div>

      <p if={!!subtitle} className="mt-2 text-xs text-stone-400 line-clamp-1">
        {subtitle}
      </p>
    </div>
  );
}
