import { mountBenchmarkPage } from './BenchmarkUI';
import { startRawWebXR } from './RawWebXR';

void mountBenchmarkPage({
  title: 'Raw WebXR baseline',
  description: 'One WebGL2 cube, no THREE renderer and no KOTOR engine code.',
  start: startRawWebXR,
});
