import * as THREE from 'three';
import { mountBenchmarkPage } from './BenchmarkUI';
import { startThreeBenchmark } from './ThreeBenchmark';

void mountBenchmarkPage({
  title: 'THREE r149 baseline',
  description: 'One cube through the renderer version currently used by KotOR.js.',
  start: (hooks) => startThreeBenchmark(THREE, 'three-r149', hooks),
});
