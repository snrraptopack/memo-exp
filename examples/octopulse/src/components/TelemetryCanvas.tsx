/**
 * Real-Time Telemetry Canvas Visualizer
 * 
 * Demonstrates:
 * 1. Callback ref on a real DOM `<canvas>` node
 * 2. Ambient `effect` coordinating an animation loop with reactive data
 * 3. Proper synchronous teardown callback canceling animation frame and timers
 */

import { requestsPerSecond, avgLatencyMs } from '../state/telemetry';

export function TelemetryCanvas() {
  let canvasElement: HTMLCanvasElement | undefined;

  // Ambient effect to initialize and manage canvas animation
  effect(() => {
    if (!canvasElement) return;

    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    const history: number[] = new Array(40).fill(30);

    function render() {
      if (!canvasElement || !ctx) return;

      // Adjust canvas resolution dynamically
      const width = canvasElement.clientWidth;
      const height = canvasElement.clientHeight;
      if (canvasElement.width !== width || canvasElement.height !== height) {
        canvasElement.width = width;
        canvasElement.height = height;
      }

      // Add latest normalized latency value with subtle fluctuation
      const latestVal = Math.min(height - 10, Math.max(10, avgLatencyMs + (Math.sin(Date.now() / 200) * 8)));
      history.push(latestVal);
      if (history.length > 40) history.shift();

      // Clear frame with deep stone backdrop
      ctx.clearRect(0, 0, width, height);

      // Draw subtle grid lines
      ctx.strokeStyle = 'rgba(39, 51, 46, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 20; y < height; y += 25) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Draw smooth Emerald waveform gradient
      const step = width / (history.length - 1);
      ctx.beginPath();
      ctx.moveTo(0, height - (history[0] ?? 20));

      for (let i = 1; i < history.length; i++) {
        const x = i * step;
        const y = height - (history[i] ?? 20);
        ctx.lineTo(x, y);
      }

      ctx.strokeStyle = '#10b981'; // Emerald 500
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(16, 185, 129, 0.5)';
      ctx.shadowBlur = 8;
      ctx.stroke();

      // Fill area under curve
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      const fillGradient = ctx.createLinearGradient(0, 0, 0, height);
      fillGradient.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
      fillGradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
      ctx.fillStyle = fillGradient;
      ctx.shadowBlur = 0;
      ctx.fill();

      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);

    // Teardown callback runs automatically when component unmounts or re-evaluates
    return () => {
      cancelAnimationFrame(animId);
    };
  });

  return (
    <div className="p-5 rounded-2xl bg-surface border border-line shadow-xl relative overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
            Real-Time Latency Waveform
          </h3>
          <p className="text-xs text-ink-soft">Live request latency telemetry (ms)</p>
        </div>
        <div className="text-right font-mono">
          <span className="text-xs text-emerald-400 font-semibold">{requestsPerSecond} req/s</span>
          <span className="text-xs text-ink-faint block">Avg: {avgLatencyMs}ms</span>
        </div>
      </div>

      <div className="w-full h-36 rounded-xl bg-base border border-line overflow-hidden relative">
        <canvas ref={canvasElement} className="w-full h-full block" />
      </div>
    </div>
  );
}
