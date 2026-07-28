export interface MetricCardProps {
  title: string;
  subtitle?: string;
  children?: any;
}

export function MetricCard({ title, subtitle, children }: MetricCardProps) {
  return (
    <div class="metric-card">
      <div class="metric-card-header">
        <h3>{title}</h3>
        {subtitle ? <span class="subtitle">{subtitle}</span> : null}
      </div>
      <div class="metric-card-body">
        {children}
      </div>
    </div>
  );
}
