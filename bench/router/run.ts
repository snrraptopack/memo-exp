import './query.bench';
import './path.bench';
import './matcher.bench';
import './manifest.bench';
import './runtime.bench';
import { runBenchmarks } from './harness';

runBenchmarks(process.argv.includes('--smoke'));
